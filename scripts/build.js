#!/usr/bin/env node
/**
 * build.js — wrapper do build/publish que GARANTE o restore do fonte.
 *
 * Problema que resolve (risco real de PERDA DE FONTE):
 *   O pipeline antigo era `precompile && electron-builder && postrestore`.
 *   Se o electron-builder (ou o sentry-upload) FALHAVA, o `postrestore` nunca
 *   rodava → os src/*.js ficavam OFUSCADOS no disco e os backups .src ficavam
 *   pendurados. Pior: num build seguinte, o compile-obfuscate via o .src velho
 *   como "original" e o restore sobrescrevia edições novas com o backup velho.
 *
 * Aqui o restore roda SEMPRE (finally), e o build aborta de cara se já existir
 * estado sujo (.src/.jsc/.map) de um build anterior que não limpou.
 *
 * Uso:
 *   node scripts/build.js            -> build local (electron-builder --win)
 *   node scripts/build.js --publish  -> build + publish + sentry maps + commit-release
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');
const publish = process.argv.includes('--publish');

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// --- Pré-checagem: estado limpo? (sem .src/.jsc/.map pendurados) ---
const dirty = walk(SRC).filter(f => /\.(src|jsc|map)$/.test(f));
if (dirty.length) {
  console.error('\n✗ ESTADO SUJO de um build anterior — arquivos temporários encontrados em src/:');
  for (const f of dirty) console.error('    ' + path.relative(root, f));
  console.error('\n  Um build anterior não terminou o restore. Antes de continuar:');
  console.error('    1) confira `git status` e seus arquivos em src/');
  console.error('    2) se o src/ estiver OFUSCADO, rode: node scripts/restore-source.js');
  console.error('    3) só então rode o build de novo.\n');
  process.exit(1);
}

let buildError = null;
try {
  // precompile
  run('node scripts/embed-civil3d.js');
  run('node scripts/compile-obfuscate.js');
  run('node scripts/obfuscate-html.js');

  // build
  run(`electron-builder --win${publish ? ' --publish always' : ''}`);

  // só no publish: sobe os source maps pro Sentry (antes do restore, que apaga os .map)
  if (publish) run('node scripts/sentry-upload-sourcemaps.js');
} catch (e) {
  buildError = e;
  console.error('\n✗ Build falhou — restaurando o fonte mesmo assim (finally).');
} finally {
  // SEMPRE restaura — é o ponto central do fix.
  try { run('node scripts/restore-source.js'); }
  catch (e) { console.error('✗ ERRO no restore-source: ' + e.message); if (!buildError) buildError = e; }
}

if (buildError) process.exit(1);

// pós-build do publish (depois do restore): commita o fonte legível + tag
if (publish) run('node scripts/commit-release.js');

console.log('\n✓ Build concluído.');
