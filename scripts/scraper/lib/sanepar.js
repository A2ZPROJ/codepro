// Scraper SANEPAR — busca a tabela MOS 5ª Ed. Obras Civis mais recente
// publicada em https://www.sanepar.com.br/tabelas-de-precos
'use strict';

const AdmZip = require('adm-zip');
const { parseXlsxTabela } = require('./xlsxParser');

const BASE = 'https://www.sanepar.com.br';
const PAGE = BASE + '/tabelas-de-precos';

const MONTHS_PT = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

function parseDataFromFilename(filename) {
  // Ex: "MOS 5a ed JUN25.zip" → { year: 2025, month: 6, data_ref: '2025-06-01' }
  const m = filename.toUpperCase().match(/(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*(\d{2,4})/);
  if (!m) return null;
  const month = MONTHS_PT[m[1]];
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  return { year, month, data_ref: `${year}-${String(month).padStart(2, '0')}-01` };
}

async function fetchLatestMos5Url() {
  const res = await fetch(PAGE, {
    headers: { 'User-Agent': 'Mozilla/5.0 (NexusScraper)' },
  });
  if (!res.ok) throw new Error(`SANEPAR page HTTP ${res.status}`);
  const html = await res.text();

  // Busca hrefs que contêm "MOS 5" + ".zip" (encoded ou não).
  // OBS: HTML do CMS Drupal da SANEPAR tem whitespace interno nos hrefs — trim é mandatório.
  const rawHrefs = [...html.matchAll(/href="([^"]+)"/gi)].map(m => m[1].trim());
  const matches = rawHrefs
    .map(h => {
      let decoded = h;
      try { decoded = decodeURIComponent(h); } catch {}
      return { raw: h, decoded: decoded.trim() };
    })
    .filter(h => /MOS\s*5/i.test(h.decoded) && /\.zip$/i.test(h.decoded))
    // exclui URLs que contêm EA (Elétricas), MOEP, SGM, etc.
    .filter(h => !/\bEA\b|MOEP|SGM|SME|POC|POÇ|CORTINA|VERD|COMERCIAL|SOCIOAMBIENT|CONTROLE/i.test(h.decoded));

  if (!matches.length) {
    throw new Error('Nenhum link de "MOS 5" encontrado na página SANEPAR');
  }

  // Pega o primeiro (página lista em ordem decrescente)
  const rel = matches[0].decoded;
  return rel.startsWith('http') ? rel : BASE + rel;
}

async function downloadZip(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (NexusScraper)' },
  });
  if (!res.ok) throw new Error(`ZIP download HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function pickMainXlsx(zipBuf) {
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();
  const xlsx = entries.filter(e => !e.isDirectory && /\.xls[xm]?$/i.test(e.entryName));
  if (!xlsx.length) {
    const names = entries.map(e => e.entryName).join(', ');
    throw new Error('Nenhum XLSX dentro do ZIP. Conteúdo: ' + names);
  }
  // Prioriza nomes com "PRECOS"/"TABELA" e, em empate, o maior
  xlsx.sort((a, b) => {
    const aScore = /PRECO|TABELA|COMPOS/i.test(a.entryName) ? 1 : 0;
    const bScore = /PRECO|TABELA|COMPOS/i.test(b.entryName) ? 1 : 0;
    if (aScore !== bScore) return bScore - aScore;
    return b.header.size - a.header.size;
  });
  return { name: xlsx[0].entryName, buf: xlsx[0].getData() };
}

async function scrapeSanepar({ dryRun = false } = {}) {
  console.log('[SANEPAR] Buscando página', PAGE);
  const url = await fetchLatestMos5Url();
  console.log('[SANEPAR] Link encontrado:', url);

  const filename = decodeURIComponent(url.split('/').pop() || '');
  const dateInfo = parseDataFromFilename(filename);
  if (!dateInfo) {
    throw new Error(`Não consegui extrair data do nome do arquivo: "${filename}"`);
  }
  console.log('[SANEPAR] Data ref:', dateInfo.data_ref);

  console.log('[SANEPAR] Baixando ZIP...');
  const zipBuf = await downloadZip(url);
  console.log('[SANEPAR] ZIP baixado:', (zipBuf.length / 1024).toFixed(1), 'KB');

  const { name: xlsxName, buf: xlsxBuf } = pickMainXlsx(zipBuf);
  console.log('[SANEPAR] XLSX escolhido:', xlsxName, `(${(xlsxBuf.length / 1024).toFixed(1)} KB)`);

  const { sheetName, headerRow, items } = parseXlsxTabela(xlsxBuf);
  console.log(`[SANEPAR] Aba "${sheetName}", header row ${headerRow}, ${items.length} itens parseados`);

  if (dryRun) {
    console.log('[SANEPAR] (DRY RUN) Primeiros 3 itens:');
    items.slice(0, 3).forEach(it => console.log('  ', JSON.stringify(it)));
    return { fonte: 'SANEPAR', data_ref: dateInfo.data_ref, items_count: items.length, dryRun: true };
  }

  const { upsertTabela } = require('./supabase');
  const nome = `SANEPAR MOS 5ª Ed. — ${filename.replace(/\.zip$/i, '')}`;
  const result = await upsertTabela(
    {
      fonte: 'SANEPAR',
      nome,
      data_ref: dateInfo.data_ref,
      uf: 'PR',
      descricao: `Importação automática via GitHub Action. Fonte: ${url}`,
    },
    items
  );
  return { fonte: 'SANEPAR', data_ref: dateInfo.data_ref, items_count: items.length, ...result };
}

module.exports = { scrapeSanepar, parseDataFromFilename };
