#!/usr/bin/env node
/**
 * restore-source.js — Restaura os .js originais após o build com bytenode.
 *
 * Uso: node scripts/restore-source.js
 *
 * Restaura os .js.src e .html.src (backups) e remove os .jsc.
 * Deve ser rodado APÓS electron-builder terminar, para que o repositório
 * volte ao estado normal (com código legível para desenvolvimento).
 * Restaura tanto bytenode (.js.src→.js) quanto obfuscator (.html.src→.html).
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

// Restaura .js.src → .js e .html.src → .html
for (const f of files) {
  if (f.endsWith('.src')) {
    const origPath = f.replace(/\.src$/, '');
    fs.copyFileSync(f, origPath);
    fs.unlinkSync(f);
    console.log('  ↩  ' + path.relative(SRC, origPath));
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
