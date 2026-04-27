#!/usr/bin/env node
/**
 * sync-web.js — Sincroniza web/index.html com src/app/index.html
 *
 * Mantém as primeiras N linhas do web/index.html (que têm o setup PWA:
 * viewport mobile, manifest, web-adapter.js, web-login.js, mobile.css)
 * e substitui o restante pelo conteúdo do desktop a partir do primeiro
 * <script src="https://cdnjs.cloudflare.com/...Chart.js..."> (linha ~64
 * no desktop, depois do bootstrap específico de Electron).
 *
 * Bumpa também sw.js VERSION pra invalidar cache do navegador.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'src/app/index.html');
const WEB  = path.join(ROOT, 'web/index.html');
const SW   = path.join(ROOT, 'web/sw.js');

const srcContent = fs.readFileSync(SRC, 'utf8');
const webContent = fs.readFileSync(WEB, 'utf8');

// 1. Encontra o primeiro <script src="https://cdnjs..."Chart.js"> em ambos
const CDN_MARKER = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js/;
const srcMarkerIdx = srcContent.search(CDN_MARKER);
const webMarkerIdx = webContent.search(CDN_MARKER);

if (srcMarkerIdx < 0) { console.error('Marcador não achado em src/app/index.html'); process.exit(1); }
if (webMarkerIdx < 0) { console.error('Marcador não achado em web/index.html');     process.exit(1); }

// 2. Pega prefixo web (PWA setup) e sufixo desktop (todo o app)
const webPrefix = webContent.slice(0, webMarkerIdx);
const srcSuffix = srcContent.slice(srcMarkerIdx);

// 3. Monta novo conteúdo
const newWebContent = webPrefix + srcSuffix;
fs.writeFileSync(WEB, newWebContent, 'utf8');

// 4. Bump SW version
const swContent = fs.readFileSync(SW, 'utf8');
const today = new Date().toISOString().slice(0,10);
const ver = 'nexus-web-v4-' + today + '-' + Date.now().toString(36);
// Regex robusto: pega a linha INTEIRA "const VERSION = ...;" mesmo se tiver
// concatenações com + ou ternários no meio.
const newSw = swContent.replace(/^const VERSION = .+;$/m, `const VERSION = '${ver}';`);
fs.writeFileSync(SW, newSw, 'utf8');

const oldLines = webContent.split('\n').length;
const newLines = newWebContent.split('\n').length;
console.log('✓ web/index.html sincronizado: ' + oldLines + ' → ' + newLines + ' linhas');
console.log('✓ sw.js VERSION = ' + ver);

// 5. Copia web/ → docs/nexus/ (GitHub Pages serve a pasta docs/)
const DOCS_NEXUS = path.join(ROOT, 'docs', 'nexus');
const WEB_DIR = path.join(ROOT, 'web');
function copyRecursive(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRecursive(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
function rmRecursive(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const sp = path.join(p, entry.name);
    if (entry.isDirectory()) { rmRecursive(sp); fs.rmdirSync(sp); }
    else fs.unlinkSync(sp);
  }
}
rmRecursive(DOCS_NEXUS);
copyRecursive(WEB_DIR, DOCS_NEXUS);
console.log('✓ docs/nexus/ atualizado (espelho de web/)');
console.log('');
console.log('Pra deploy:');
console.log('  git add web/ docs/nexus/');
console.log('  git commit -m "sync web pwa"');
console.log('  git push');
console.log('  → GitHub Pages rebuilda em ~1min');
console.log('  URL: https://a2zproj.github.io/codepro/nexus/');
