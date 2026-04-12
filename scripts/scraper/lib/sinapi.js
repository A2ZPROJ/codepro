// Scraper SINAPI (Caixa) — usa Puppeteer para navegar na página dinâmica
// da Caixa que carrega downloads via AJAX.
//
// Fluxo:
//   1. Abre a página de downloads com Puppeteer (headless Chromium)
//   2. Navega até a categoria SINAPI
//   3. Procura o link de download do Paraná (NãoDesonerado)
//   4. Baixa o ZIP, descompacta, parseia o XLSX
//   5. Upsert no Supabase
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { parseXlsxTabela } = require('./xlsxParser');

const DOWNLOADS_URL = 'https://www.caixa.gov.br/site/Paginas/downloads.aspx#categoria_655';

async function scrapeSinapi({ dryRun = false, uf = 'PR' } = {}) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    console.log('[SINAPI] Iniciando Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 60000,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    console.log('[SINAPI] Abrindo página de downloads da Caixa...');
    await page.goto(DOWNLOADS_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Espera o conteúdo AJAX carregar
    console.log('[SINAPI] Aguardando conteúdo carregar...');
    await page.waitForSelector('a[href*=".zip"], a[href*="sinapi"], .link-download, .categoria-item', { timeout: 30000 }).catch(() => {});

    // Espera um pouco mais pro AJAX terminar
    await new Promise(r => setTimeout(r, 5000));

    // Busca todos os links de download na página
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .filter(a => a.href && (a.href.includes('.zip') || a.href.toLowerCase().includes('sinapi')))
        .map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 200) }));
    });

    console.log('[SINAPI] Links encontrados:', links.length);
    links.slice(0, 10).forEach(l => console.log('  ', l.href.slice(-80), '|', l.text.slice(0, 60)));

    // Procura o link do PR NãoDesonerado
    const prLink = links.find(l => {
      const h = l.href.toLowerCase();
      const t = l.text.toLowerCase();
      return (h.includes(uf.toLowerCase()) || t.includes(uf.toLowerCase()) || t.includes('paraná') || t.includes('parana'))
        && (h.includes('.zip') || h.includes('sinapi'))
        && (h.includes('naodesonerado') || h.includes('nao_desonerado') || t.includes('não desonerado') || t.includes('nao desonerado') || !h.includes('desonerado'));
    }) || links.find(l => l.href.toLowerCase().includes(uf.toLowerCase()) && l.href.includes('.zip'));

    if (!prLink) {
      // Log todos os links pra debug
      console.log('[SINAPI] Nenhum link PR encontrado. Todos os links ZIP:');
      links.forEach(l => console.log('  HREF:', l.href));
      throw new Error('Link SINAPI para ' + uf + ' não encontrado na página da Caixa.');
    }

    console.log('[SINAPI] Link encontrado:', prLink.href);

    // Baixa o ZIP
    console.log('[SINAPI] Baixando ZIP...');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinapi-'));
    const zipPath = path.join(tmpDir, 'sinapi.zip');

    // Usa o page pra baixar (herda cookies/sessão)
    const cdpSession = await page.createCDPSession();
    await cdpSession.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmpDir });

    // Tenta download direto via fetch no contexto do browser
    const zipBuf = await page.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ab = await res.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    }, prLink.href).catch(async () => {
      // Fallback: usa Node fetch com cookies do browser
      const cookies = await page.cookies();
      const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
      const res = await fetch(prLink.href, { headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('Download HTTP ' + res.status);
      return Array.from(new Uint8Array(await res.arrayBuffer()));
    });

    const zipBuffer = Buffer.from(zipBuf);
    console.log('[SINAPI] ZIP:', (zipBuffer.length / 1024 / 1024).toFixed(2), 'MB');

    // Verifica se é ZIP válido
    if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
      throw new Error('Arquivo baixado não é um ZIP válido (provável página de erro HTML)');
    }

    // Descompacta e parseia
    const zip = new AdmZip(zipBuffer);
    const xlsxEntries = zip.getEntries().filter(e => !e.isDirectory && /\.xls[xm]?$/i.test(e.entryName));
    if (!xlsxEntries.length) throw new Error('Nenhum XLSX dentro do ZIP');

    // Prioriza "sintetico"
    xlsxEntries.sort((a, b) => {
      const aS = /sintetico|sintético/i.test(a.entryName) ? 1 : 0;
      const bS = /sintetico|sintético/i.test(b.entryName) ? 1 : 0;
      return bS - aS || b.header.size - a.header.size;
    });
    const pick = xlsxEntries[0];
    console.log('[SINAPI] XLSX:', pick.entryName);

    const { items } = parseXlsxTabela(pick.getData());
    console.log('[SINAPI] Itens parseados:', items.length);

    // Extrai data de referência do nome do arquivo ou URL
    const now = new Date();
    let month = now.getMonth() + 1, year = now.getFullYear();
    const mMatch = prLink.href.match(/(\d{2})(\d{4})/);
    if (mMatch) { month = parseInt(mMatch[1]); year = parseInt(mMatch[2]); }
    const data_ref = `${year}-${String(month).padStart(2, '0')}-01`;

    // Limpa temp
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

    if (dryRun) {
      console.log('[SINAPI] (DRY RUN) Primeiros 3:');
      items.slice(0, 3).forEach(it => console.log('  ', JSON.stringify(it)));
      return { fonte: 'SINAPI', data_ref, items_count: items.length, dryRun: true };
    }

    const { upsertTabela } = require('./supabase');
    const result = await upsertTabela(
      { fonte: 'SINAPI', nome: `SINAPI ${uf} ${String(month).padStart(2,'0')}/${year}`, data_ref, uf, descricao: 'Importação automática via Puppeteer' },
      items
    );
    return { fonte: 'SINAPI', data_ref, items_count: items.length, ...result };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { scrapeSinapi };
