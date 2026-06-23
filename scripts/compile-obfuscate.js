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
    const result = JavaScriptObfuscator.obfuscate(original, OBF_OPTIONS).getObfuscatedCode();
    fs.writeFileSync(srcPath, result);
    const origKB = (Buffer.byteLength(original) / 1024).toFixed(1);
    const obfKB = (Buffer.byteLength(result) / 1024).toFixed(1);
    console.log(`  ✓  ${file}  ${origKB}KB → ${obfKB}KB`);
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
