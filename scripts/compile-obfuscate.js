#!/usr/bin/env node
/**
 * compile-obfuscate.js — Ofusca os .js de src/ via javascript-obfuscator.
 *
 * Substitui o compile-bytecode.js (bytenode) que sofria de cachedDataRejected
 * cross-machine — o bytecode V8 não é portátil entre CPUs/releases diferentes.
 *
 * Uso: node scripts/compile-obfuscate.js
 *
 * O que faz:
 *   1. Para cada .js listado (src/main.js, src/parseOse.js, etc.)
 *   2. Salva backup como .js.src (se ainda não existir)
 *   3. Ofusca o JS e grava no lugar do original
 *
 * Config do obfuscator:
 *   - Renomeia variáveis locais, mantém exports + window.X
 *   - String array com base64
 *   - Control flow flattening moderado (50%)
 *   - SEM deadCodeInjection (infla 3×), SEM selfDefending (quebra Electron)
 *
 * Restaurar: node scripts/restore-source.js (já existente)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, '..', 'src');

// Alvos do processo Node (main + preload + módulos)
const targets = [
  'main.js',
  'preload.js',
  'parseOse.js',
  'oseStatus.js',
  'oseDeepCheck.js',
  'exportOse.js',
  'memorialGenerator.js',
  'license.js',
  'store.js',
  'dashboardParser.js',
  'auditLog.js',  // contém Google API key embutida (string array base64 esconde melhor)
];

const OBF_OPTIONS = {
  compact: true,
  // controlFlowFlattening: DESLIGADO — causa travamento em parseOse/oseDeepCheck
  // com loops pesados (performance degrada 10-100x em runtime). v2.19.2 regression fix.
  controlFlowFlattening: false,
  controlFlowFlatteningThreshold: 0,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'node',
};

console.log('╔═══════════════════════════════════════╗');
console.log('║  JS Obfuscator — Nexus                ║');
console.log('╚═══════════════════════════════════════╝');
console.log('');

// Guarda anti-perda-de-fonte: se já existe um .src, é backup VELHO de um build
// que não terminou o restore. Continuar obfuscaria por cima e o restore depois
// sobrescreveria edições novas com o backup velho. Aborta pra forçar estado limpo.
const stale = targets
  .map(f => path.join(SRC, f) + '.src')
  .filter(p => fs.existsSync(p));
if (stale.length) {
  console.error('✗ Backups .src de um build anterior ainda existem em src/:');
  for (const p of stale) console.error('    ' + path.basename(p));
  console.error('  Rode `node scripts/restore-source.js` (e confira git status) antes de obfuscar de novo.');
  process.exit(1);
}

let done = 0, skipped = 0;

for (const file of targets) {
  const srcPath = path.join(SRC, file);
  if (!fs.existsSync(srcPath)) {
    console.log(`  ⏭  ${file} — não encontrado, pulando`);
    skipped++;
    continue;
  }
  const original = fs.readFileSync(srcPath, 'utf8');
  // Backup .js.src (só cria uma vez — restore-source.js restaura depois do build)
  const backup = srcPath + '.src';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);

  try {
    // sourceMap separado: gera <file>.map ao lado do ofuscado pra o Sentry
    // de-ofuscar os stacks (sem isso o stack vem como _0x1a2b...). Os .map
    // são SUBIDOS pro Sentry no build (scripts/sentry-upload-sourcemaps.js) e
    // NÃO vão pro instalador (electron-builder exclui **/*.map). Limpos pelo
    // restore-source.js no fim.
    const obf = JavaScriptObfuscator.obfuscate(original, {
      ...OBF_OPTIONS,
      sourceMap: true,
      sourceMapMode: 'separate',
      inputFileName: file,
      sourceMapFileName: file + '.map',
    });
    const result = obf.getObfuscatedCode();
    fs.writeFileSync(srcPath, result);
    try {
      const map = obf.getSourceMap();
      if (map) fs.writeFileSync(srcPath + '.map', map);
    } catch {}
    const origKB = (Buffer.byteLength(original) / 1024).toFixed(1);
    const obfKB = (Buffer.byteLength(result) / 1024).toFixed(1);
    console.log(`  ✓  ${file}  ${origKB}KB → ${obfKB}KB  (+map)`);
    done++;
  } catch (e) {
    console.error(`  ✗  ${file} — erro: ${e.message}`);
    // Restaura original se falhou
    if (fs.existsSync(backup)) fs.writeFileSync(srcPath, fs.readFileSync(backup, 'utf8'));
  }
}

console.log('');
console.log(`Ofuscados: ${done}  |  Pulados: ${skipped}`);
console.log('');
console.log('Próximo passo: rodar electron-builder para empacotar.');
console.log('Restaurar: node scripts/restore-source.js');
