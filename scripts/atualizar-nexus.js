#!/usr/bin/env node
/*
 * atualizar-nexus.js — Atualiza a instalação LOCAL do Nexus para a última versão
 * PUBLICADA (GitHub release A2ZPROJ/codepro) e abre, SEM clicar em nada.
 *
 * Resolve a última versão pelo GitHub (funciona em qualquer máquina — ACER/PREDATOR).
 * Se a máquina acabou de publicar essa versão, usa o instalador de `dist/` (não baixa).
 * Fecha o Nexus aberto, roda o instalador em silêncio (/S) — como é oneClick +
 * runAfterFinish, ele instala e reabre o Nexus novo sozinho.
 *
 * Uso:
 *   node scripts/atualizar-nexus.js          (ou: npm run atualizar)
 *   node scripts/atualizar-nexus.js --dry     (só mostra o que faria, não instala)
 */
'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const OWNER = 'A2ZPROJ', REPO = 'codepro';
const DRY = process.argv.includes('--dry');

function getJSON(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'nexus-updater', 'Accept': 'application/vnd.github+json' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return res(getJSON(r.headers.location));
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
function download(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'nexus-updater' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return res(download(r.headers.location, dest));
      if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode + ' ao baixar'));
      const f = fs.createWriteStream(dest);
      r.pipe(f); f.on('finish', () => f.close(() => res(dest))); f.on('error', rej);
    }).on('error', rej);
  });
}

(async () => {
  console.log('[atualizar] buscando ultima versao publicada...');
  const rel = await getJSON(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
  if (!rel || !rel.tag_name) throw new Error('release nao encontrado (resposta da API invalida)');
  const ver = String(rel.tag_name).replace(/^v/, '');
  const asset = (rel.assets || []).find(a => /^Nexus-Setup-.*\.exe$/.test(a.name));
  if (!asset) throw new Error('asset Nexus-Setup-*.exe nao achado no release ' + rel.tag_name);
  console.log('[atualizar] ultima versao: ' + ver);

  // Prefere o instalador local (maquina que acabou de publicar) — evita baixar 130MB.
  const localDist = path.join(__dirname, '..', 'dist', `Nexus Setup ${ver}.exe`);
  let setup;
  if (fs.existsSync(localDist)) {
    setup = localDist;
    console.log('[atualizar] usando instalador local: ' + setup);
  } else {
    setup = path.join(os.tmpdir(), asset.name);
    console.log('[atualizar] baixando ' + asset.name + ' (' + (asset.size / 1048576 | 0) + ' MB)...');
    if (!DRY) await download(asset.browser_download_url, setup);
    console.log('[atualizar] ' + (DRY ? '(dry) baixaria para ' : 'baixado: ') + setup);
  }

  if (DRY) { console.log('[atualizar] --dry: pararia aqui (fecharia o Nexus e rodaria "' + setup + ' /S").'); return; }

  // Fecha o Nexus aberto pra liberar os arquivos.
  try { execSync('taskkill /IM Nexus.exe /F', { stdio: 'ignore' }); console.log('[atualizar] Nexus aberto foi fechado.'); } catch { /* nao estava aberto */ }

  // Instala em silencio. oneClick + runAfterFinish => instala e reabre o Nexus sozinho.
  console.log('[atualizar] instalando v' + ver + ' em silencio + reabrindo...');
  const ch = spawn(setup, ['/S'], { detached: true, stdio: 'ignore' });
  ch.unref();
  console.log('[atualizar] OK — o Nexus v' + ver + ' vai instalar e abrir sozinho em alguns segundos.');
})().catch(e => { console.error('[atualizar] FALHOU: ' + e.message); process.exit(1); });
