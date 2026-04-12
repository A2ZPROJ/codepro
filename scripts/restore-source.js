#!/usr/bin/env node
/**
 * restore-source.js — Restaura os .js originais após o build com bytenode.
 *
 * Uso: node scripts/restore-source.js
 *
 * Restaura os .js.src (backups) de volta para .js e remove os .jsc.
 * Deve ser rodado APÓS electron-builder terminar, para que o repositório
 * volte ao estado normal (com código legível para desenvolvimento).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function walk(dir) {
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) items.push(...walk(full));
    else items.push(full);
  }
  return items;
}

const files = walk(SRC);
let restored = 0, cleaned = 0;

// Restaura .js.src → .js
for (const f of files) {
  if (f.endsWith('.js.src')) {
    const jsPath = f.replace(/\.src$/, '');
    fs.copyFileSync(f, jsPath);
    fs.unlinkSync(f);
    console.log('  ↩  ' + path.relative(SRC, jsPath));
    restored++;
  }
}

// Remove .jsc
for (const f of files) {
  if (f.endsWith('.jsc')) {
    fs.unlinkSync(f);
    console.log('  🗑  ' + path.relative(SRC, f));
    cleaned++;
  }
}

console.log('');
console.log(`Restaurados: ${restored}  |  .jsc removidos: ${cleaned}`);
