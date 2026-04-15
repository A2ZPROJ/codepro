#!/usr/bin/env node
/**
 * compile-bytecode.js — Compila os .js de src/ para .jsc (V8 bytecode) via bytenode.
 *
 * Uso: node scripts/compile-bytecode.js
 *
 * O que faz:
 *   1. Para cada .js em src/ (exceto src/app/), compila para .jsc
 *   2. Substitui o .js original por um "loader" mínimo que faz require('.jsc')
 *   3. O index.html do renderer NÃO é compilado (é HTML, não Node)
 *   4. Após o build, os .js originais ficam no git — o electron-builder
 *      empacota a pasta src/ que neste ponto contém loaders + .jsc
 *
 * IMPORTANTE: Rodar com o electron do projeto (não com node global) para
 * que o bytecode seja compatível com a versão V8 do Electron:
 *   npx electron scripts/compile-bytecode.js
 */
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

const SRC = path.join(__dirname, '..', 'src');

// Arquivos a compilar (Node process — main + preload + módulos)
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
];

async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  Bytenode Compiler — Nexus            ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  let compiled = 0, skipped = 0;

  for (const file of targets) {
    const srcPath = path.join(SRC, file);
    if (!fs.existsSync(srcPath)) {
      console.log(`  ⏭  ${file} — não encontrado, pulando`);
      skipped++;
      continue;
    }

    const jscPath = srcPath.replace(/\.js$/, '.jsc');
    const originalCode = fs.readFileSync(srcPath, 'utf8');

    // Salva backup do original (.js.src) pra restaurar depois do build
    const backupPath = srcPath + '.src';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, originalCode);
    }

    try {
      // Compila para bytecode
      await bytenode.compileFile(srcPath, jscPath);

      // Substitui o .js por um loader mínimo
      const loaderCode = `'use strict';\nrequire('bytenode');\nmodule.exports = require('./${path.basename(jscPath)}');\n`;
      fs.writeFileSync(srcPath, loaderCode);

      const origSize = (Buffer.byteLength(originalCode) / 1024).toFixed(1);
      const jscSize = (fs.statSync(jscPath).size / 1024).toFixed(1);
      console.log(`  ✓  ${file}  ${origSize}KB → ${jscPath.split(path.sep).pop()}  ${jscSize}KB`);
      compiled++;
    } catch (e) {
      console.error(`  ✗  ${file} — erro: ${e.message}`);
      // Restaura o original se falhou
      if (fs.existsSync(backupPath)) {
        fs.writeFileSync(srcPath, fs.readFileSync(backupPath, 'utf8'));
      }
    }
  }

  console.log('');
  console.log(`Compilados: ${compiled}  |  Pulados: ${skipped}`);
  console.log('');
  console.log('Próximo passo: rodar electron-builder para empacotar.');
  console.log('Para restaurar os .js originais: node scripts/restore-source.js');
}

app.whenReady().then(() => main()).then(() => app.quit()).catch(e => { console.error('FATAL:', e); app.quit(); process.exit(1); });
