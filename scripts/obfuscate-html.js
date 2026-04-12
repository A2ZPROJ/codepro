#!/usr/bin/env node
/**
 * obfuscate-html.js — Ofusca todos os blocos <script> inline do index.html.
 *
 * Uso: node scripts/obfuscate-html.js
 *
 * - Lê src/app/index.html
 * - Salva backup como index.html.src (se não existir)
 * - Para cada <script>...</script> (exceto type="module"), ofusca o JS
 * - Reescreve o index.html com os scripts ofuscados
 * - Após o build, rodar restore-source.js pra restaurar
 *
 * Configuração do obfuscator:
 *   - Renomeia variáveis (compact: true, renameGlobals: false)
 *   - Codifica strings (stringArray + rotateStringArray)
 *   - Transforma fluxo de controle (controlFlowFlattening)
 *   - NÃO usa deadCodeInjection (aumenta muito o tamanho)
 *   - NÃO usa selfDefending (pode causar crash em Electron)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const HTML_PATH = path.join(__dirname, '..', 'src', 'app', 'index.html');
const BACKUP_PATH = HTML_PATH + '.src';

// Config do obfuscator — balanceada entre proteção e performance
const OBF_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,       // já temos anti-debug no renderer
  disableConsoleOutput: false,   // precisa de console.log/error em produção
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,          // NÃO renomeia window.X (quebraria onclick handlers)
  selfDefending: false,          // pode causar crash em Electron
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,    // NÃO transforma chaves de objeto (quebraria Supabase queries)
  unicodeEscapeSequence: false,
};

function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  JS Obfuscator — index.html           ║');
  console.log('╚═══════════════════════════════════════╝');

  if (!fs.existsSync(HTML_PATH)) {
    console.error('index.html não encontrado:', HTML_PATH);
    process.exit(1);
  }

  let html = fs.readFileSync(HTML_PATH, 'utf8');

  // Salva backup
  if (!fs.existsSync(BACKUP_PATH)) {
    fs.writeFileSync(BACKUP_PATH, html);
    console.log('  Backup salvo:', BACKUP_PATH);
  }

  // Regex para pegar blocos <script>...</script> (exceto type="module")
  const scriptRegex = /(<script(?![^>]*type\s*=\s*['"]module)[^>]*>)([\s\S]*?)(<\/script>)/gi;

  let count = 0;
  let totalOrigSize = 0;
  let totalObfSize = 0;

  html = html.replace(scriptRegex, (match, openTag, code, closeTag) => {
    const trimmed = code.trim();
    // Pula scripts vazios ou muito pequenos (< 100 chars)
    if (!trimmed || trimmed.length < 100) return match;

    count++;
    totalOrigSize += trimmed.length;

    try {
      const result = JavaScriptObfuscator.obfuscate(trimmed, OBF_OPTIONS);
      const obfuscated = result.getObfuscatedCode();
      totalObfSize += obfuscated.length;
      console.log(`  ✓  Script #${count}: ${(trimmed.length/1024).toFixed(1)}KB → ${(obfuscated.length/1024).toFixed(1)}KB`);
      return openTag + '\n' + obfuscated + '\n' + closeTag;
    } catch (e) {
      console.error(`  ✗  Script #${count}: erro — ${e.message}`);
      totalObfSize += trimmed.length;
      return match; // mantém o original se falhar
    }
  });

  fs.writeFileSync(HTML_PATH, html);

  console.log('');
  console.log(`Total: ${count} scripts ofuscados`);
  console.log(`Tamanho: ${(totalOrigSize/1024).toFixed(1)}KB → ${(totalObfSize/1024).toFixed(1)}KB`);
  console.log(`Resultado salvo em: ${HTML_PATH}`);
  console.log('Para restaurar: node scripts/restore-source.js');
}

main();
