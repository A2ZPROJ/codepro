// Scraper SINAPI (Caixa) — tenta o padrão conhecido de URL
// (Caixa publica mensalmente no formato:
//  https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2014-{uf}/
//    SINAPI_ref_Insumos_Composicoes_{UF}_{MMAAAA}_NaoDesonerado.zip)
//
// A página oficial (downloads.aspx) é dinâmica e não se presta a scraping
// HTML simples — por isso apostamos no padrão direto de URL.
'use strict';

const AdmZip = require('adm-zip');
const { parseXlsxTabela } = require('./xlsxParser');

function buildUrl(uf, year, month) {
  const mm = String(month).padStart(2, '0');
  const ufLower = uf.toLowerCase();
  // Tipo "NaoDesonerado" — se quiser desonerado, trocar aqui
  return `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2014-${ufLower}/SINAPI_ref_Insumos_Composicoes_${uf}_${mm}${year}_NaoDesonerado.zip`;
}

async function tryDownload(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (NexusScraper)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Tamanho mínimo: 100KB (página de erro é HTML < 50KB)
    if (buf.length < 100 * 1024) return null;
    // Checa assinatura de ZIP (50 4B — "PK")
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
    return buf;
  } catch {
    return null;
  }
}

async function findLatest(uf) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  // Tenta o mês atual e volta até 4 meses atrás
  for (let i = 0; i < 5; i++) {
    const url = buildUrl(uf, year, month);
    console.log('[SINAPI] Tentando', url);
    const buf = await tryDownload(url);
    if (buf) return { url, year, month, buf };
    month--;
    if (month === 0) { month = 12; year--; }
  }
  return null;
}

async function scrapeSinapi({ dryRun = false, uf = 'PR' } = {}) {
  // NOTA IMPORTANTE: A Caixa bloqueia scraping direto (HTTP 429 + links AJAX-loaded).
  // Por enquanto este scraper está desabilitado — a importação SINAPI precisa
  // ser manual via aba Orçamento do Nexus (ou via Puppeteer no futuro).
  throw new Error(
    '[SINAPI] Scraping automático desabilitado. A Caixa bloqueia requisições diretas (HTTP 429) e os links são carregados via AJAX. ' +
      'Importe manualmente: Nexus → aba Orçamento → Tabelas de Preço → Importar XLSX.'
  );
  // eslint-disable-next-line no-unreachable
  const found = await findLatest(uf);
  if (!found) {
    throw new Error(
      '[SINAPI] Nenhum ZIP encontrado tentando o padrão de URL nos últimos 5 meses. ' +
        'Pode ser que a Caixa tenha mudado o formato — abrir manualmente https://www.caixa.gov.br/site/Paginas/downloads.aspx'
    );
  }
  const { url, year, month, buf: zipBuf } = found;
  const data_ref = `${year}-${String(month).padStart(2, '0')}-01`;
  console.log(
    '[SINAPI] Baixado:',
    (zipBuf.length / 1024 / 1024).toFixed(2),
    'MB. Data ref:',
    data_ref
  );

  const zip = new AdmZip(zipBuf);
  const xlsxEntries = zip
    .getEntries()
    .filter(e => !e.isDirectory && /\.xls[xm]?$/i.test(e.entryName));
  if (!xlsxEntries.length) {
    const names = zip.getEntries().map(e => e.entryName).join(', ');
    throw new Error('[SINAPI] Nenhum XLSX dentro do ZIP. Conteúdo: ' + names);
  }

  // SINAPI costuma ter várias planilhas. Prioriza "SINTETICO" (composições analíticas).
  xlsxEntries.sort((a, b) => {
    const aS = /sintetico|sintético/i.test(a.entryName) ? 1 : 0;
    const bS = /sintetico|sintético/i.test(b.entryName) ? 1 : 0;
    if (aS !== bS) return bS - aS;
    return b.header.size - a.header.size;
  });
  const pick = xlsxEntries[0];
  console.log('[SINAPI] XLSX escolhido:', pick.entryName);

  const { sheetName, headerRow, items } = parseXlsxTabela(pick.getData());
  console.log(`[SINAPI] Aba "${sheetName}", header row ${headerRow}, ${items.length} itens parseados`);

  if (dryRun) {
    console.log('[SINAPI] (DRY RUN) Primeiros 3 itens:');
    items.slice(0, 3).forEach(it => console.log('  ', JSON.stringify(it)));
    return { fonte: 'SINAPI', data_ref, items_count: items.length, dryRun: true };
  }

  const { upsertTabela } = require('./supabase');
  const nome = `SINAPI ${uf} ${String(month).padStart(2, '0')}/${year}`;
  const result = await upsertTabela(
    {
      fonte: 'SINAPI',
      nome,
      data_ref,
      uf,
      descricao: `Importação automática via GitHub Action. Fonte: ${url}`,
    },
    items
  );
  return { fonte: 'SINAPI', data_ref, items_count: items.length, ...result };
}

module.exports = { scrapeSinapi, buildUrl };
