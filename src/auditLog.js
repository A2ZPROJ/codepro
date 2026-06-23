// src/auditLog.js — escrita JSONL local no diretório do user.
// Roda no main process; cliente chama via IPC `audit-log:append`.
// Append-only por design (cada entrada vira 1 linha).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

const LOG_DIR = path.join(os.homedir(), '.codepro', 'audit-log');

// — Google Geolocation API key (restrita só pra Geolocation API + cota baixa) —
// Usada apenas internamente pra triangulação Wi-Fi. Key embutida no build pra
// equipe ganhar precisão de rua sem precisar configurar nada.
const EMBEDDED_GOOGLE_KEY = 'AIzaSyDoQqZmzLy8RhXUnM1mbeJpPmBpgQdeyWU';

function getGoogleApiKey() {
  if (process.env.GOOGLE_GEOLOCATION_API_KEY) return process.env.GOOGLE_GEOLOCATION_API_KEY;
  try {
    const p = path.join(os.homedir(), '.codepro', 'google-key.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch {}
  return EMBEDDED_GOOGLE_KEY || null;
}

// — Lista Wi-Fi access points visíveis (Windows via netsh) —
function listWifiBssids() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    exec('netsh wlan show networks mode=bssid', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const aps = [];
      const lines = stdout.split(/\r?\n/);
      let currentBssid = null;
      for (const raw of lines) {
        const line = raw.trim();
        const bssidMatch = line.match(/BSSID\s+\d+\s*:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
        if (bssidMatch) {
          currentBssid = bssidMatch[1].toUpperCase();
          continue;
        }
        const sigMatch = line.match(/(?:Sinal|Signal)\s*:\s*(\d+)\s*%/i);
        if (sigMatch && currentBssid) {
          const pct = parseInt(sigMatch[1], 10);
          // Conversão %→dBm aproximada do Windows (0%=-100dBm, 100%=-50dBm)
          const rssi = Math.round((pct / 2) - 100);
          aps.push({ macAddress: currentBssid, signalStrength: rssi });
          currentBssid = null;
        }
      }
      resolve(aps);
    });
  });
}

function postGoogleGeolocate(apiKey, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      method: 'POST',
      hostname: 'www.googleapis.com',
      path: '/geolocation/v1/geolocate?key=' + encodeURIComponent(apiKey),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const txt = Buffer.concat(chunks).toString('utf8');
          const j = JSON.parse(txt);
          if (j.location) {
            resolve({
              lat: j.location.lat,
              lng: j.location.lng,
              accuracy: j.accuracy,
              source: 'gps',
            });
          } else {
            resolve({ error: j.error?.message || 'sem location no response', raw: txt });
          }
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(12000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// — netsh wlan retorna o último scan cacheado pelo Windows. Pra ter mais
// BSSIDs (necessário pra triangulação precisa), juntamos 5 scans com pausas
// de 3s — o Windows costuma refazer scan automático nesse intervalo.
async function listWifiBssidsRobust(rounds = 5, pauseMs = 3000) {
  const merged = new Map();
  for (let i = 0; i < rounds; i++) {
    const aps = await listWifiBssids();
    for (const ap of aps) {
      const existing = merged.get(ap.macAddress);
      if (!existing || ap.signalStrength > existing.signalStrength) {
        merged.set(ap.macAddress, ap);
      }
    }
    // Sai cedo se já temos 5+ APs (suficiente pra boa triangulação)
    if (merged.size >= 5 && i >= 1) break;
    if (i < rounds - 1) await new Promise(r => setTimeout(r, pauseMs));
  }
  return [...merged.values()];
}

// — Geolocalização precisa via Wi-Fi triangulation no Google —
async function fetchGeoFine() {
  const apiKey = getGoogleApiKey();
  if (!apiKey) return { error: 'no_api_key' };

  const aps = await listWifiBssidsRobust();
  if (aps.length === 0) return { error: 'no_wifi_visible', wifi_count: 0 };

  // Com poucos APs (≤2), considerIp ajuda a estabilizar; com muitos, não.
  const useIpHint = aps.length < 3;

  const result = await postGoogleGeolocate(apiKey, {
    wifiAccessPoints: aps,
    considerIp: useIpHint,
  });
  if (result?.error || result?.lat == null) {
    return { ...result, wifi_count: aps.length };
  }
  return { ...result, wifi_count: aps.length };
}

// Fetch sem deps (Node native https) — bypassa CSP/restrições do renderer.
function httpsGet(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

async function fetchIpGeo() {
  let ip = null;
  try {
    const r = await httpsGet('https://api.ipify.org?format=json');
    if (r.status === 200) ip = JSON.parse(r.body)?.ip || null;
  } catch (e) { /* silent */ }

  let geo = null;
  if (ip) {
    // Tenta freegeoip.app primeiro
    try {
      const r = await httpsGet(`https://freegeoip.app/json/${encodeURIComponent(ip)}`);
      if (r.status === 200) {
        const j = JSON.parse(r.body);
        if (j && j.latitude != null) {
          geo = {
            lat: Number(j.latitude),
            lng: Number(j.longitude),
            city:    j.city || null,
            region:  j.region_name || null,
            country: j.country_name || null,
            source:  'ip',
          };
        }
      }
    } catch (e) { /* silent */ }

    // Fallback: geolocation-db.com
    if (!geo) {
      try {
        const r = await httpsGet(`https://geolocation-db.com/json/${encodeURIComponent(ip)}`);
        if (r.status === 200) {
          const j = JSON.parse(r.body);
          if (j && j.latitude != null) {
            geo = {
              lat: Number(j.latitude),
              lng: Number(j.longitude),
              city:    j.city || null,
              region:  j.state || null,
              country: j.country_name || null,
              source:  'ip',
            };
          }
        }
      } catch (e) { /* silent */ }
    }
  }

  return { ip, geo };
}

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function todayStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
}

function pathForToday() {
  return path.join(LOG_DIR, `eventos-${todayStamp()}.jsonl`);
}

function appendLog(entry) {
  try {
    ensureDir();
    const enriched = {
      ts: entry.ts || new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(pathForToday(), JSON.stringify(enriched) + '\n', 'utf8');
    return true;
  } catch (e) {
    // Nunca quebra o app se falhar aqui — log local é best-effort
    console.warn('[auditLog] append falhou:', e.message);
    return false;
  }
}

function listLogs() {
  ensureDir();
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('eventos-') && f.endsWith('.jsonl'))
    .sort();
}

module.exports = { appendLog, listLogs, LOG_DIR, fetchIpGeo, fetchGeoFine };
