/* ============================================================
 * sw.js — Service Worker do Nexus PWA
 * ------------------------------------------------------------
 *  - Precache do shell (index, adapter, login, CSS, manifest, ícones)
 *  - Estratégia network-first pros HTML (pra pegar atualizações)
 *  - Cache-first pros assets estáticos com revalidação
 *  - Nunca intercepta chamadas Supabase nem CDN de libs (deixa passar)
 * ============================================================ */

const VERSION = 'nexus-web-v3-' + '2026-04-23-css4';
const SHELL_CACHE = 'nexus-shell-' + VERSION;
const ASSET_CACHE = 'nexus-assets-' + VERSION;

const SHELL_URLS = [
  './',
  './index.html',
  './web-adapter.js',
  './web-login.js',
  './mobile.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Precache resiliente — adiciona um por um, ignora falhas individuais.
  // cache.addAll() falha tudo se 1 url der 404, então usamos add() em loop.
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      for (const url of SHELL_URLS) {
        try { await cache.add(url); }
        catch (e) { console.warn('[SW] precache pulou ' + url + ':', e.message); }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== SHELL_CACHE && k !== ASSET_CACHE) return caches.delete(k);
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase e Google Fonts CSS/fontes: sempre network, cacheia fallback silencioso
  if (url.hostname.endsWith('supabase.co') || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return; // deixa o browser cuidar
  }

  // APIs externas que não devem ser cacheadas com staleness agressiva
  if (url.hostname.endsWith('servicodados.ibge.gov.br') ||
      url.hostname.endsWith('brasilapi.com.br') ||
      url.hostname.endsWith('nominatim.openstreetmap.org') ||
      url.hostname.endsWith('api.github.com') ||
      url.hostname === 'github.com') {
    return;
  }

  // HTML navegação → network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // CDN de libs conhecidas (Chart.js, Leaflet, etc.) → cache-first revalida
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'unpkg.com' || url.hostname === 'esm.sh' ||
      url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdn.sheetjs.com') {
    event.respondWith(cacheFirstSWR(req, ASSET_CACHE));
    return;
  }

  // Mesmo domínio → cache-first revalida
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstSWR(req, SHELL_CACHE));
    return;
  }
});

async function networkFirst(req){
  try {
    const res = await fetch(req);
    // Só cacheia respostas 2xx — não cacheia 5xx/redirects que podem ser temporários
    if (res && res.ok && res.status >= 200 && res.status < 300) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone());
      return res;
    }
    // Resposta não-OK: tenta cache primeiro
    const cached = await caches.match(req) || await caches.match('./index.html');
    return cached || res;
  } catch(e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    // Fallback final: HTML mínimo de offline
    return new Response(
      '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title><style>body{font-family:sans-serif;padding:40px;text-align:center;background:#0a1224;color:#f1f5f9}</style></head><body><h1>Offline</h1><p>Sem conexão. Verifique sua internet e atualize.</p><button onclick="location.reload()" style="padding:10px 20px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer">Tentar novamente</button></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirstSWR(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response('offline', { status: 503, statusText: 'Offline' });
}

// Mensagens do app (ex: SKIP_WAITING pra atualização imediata)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
