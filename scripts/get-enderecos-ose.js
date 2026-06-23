/**
 * get-enderecos-ose.js
 *
 * Script one-off: lê PO1-2_REV01.xlsx, pega coordenada do primeiro PV de cada
 * OSE, converte UTM SIRGAS 2000 22S → WGS84 lat/lon, consulta Nominatim,
 * extrai nome da rua em MAIÚSCULO e gera xlsx novo com OSE → RUA.
 */

const xlsx = require('xlsx');
const proj4 = require('proj4');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// UTM SIRGAS 2000 22S (EPSG:31982) — usado em Paraná
proj4.defs('EPSG:31982',
  '+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const SRC = 'C:\\Users\\lcabd\\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA\\001. SERVIDOR PARANÁ\\002. ACCIONA\\004. CT-027.2025 - PROJETOS\\001. UBIRATÃ e YOLANDA\\006. PROJ EXECUTIVO\\001. PO-01\\004. SUB BACIA 02\\DXF\\PLANILHA\\PO1-2_REV01.xlsx';
const OUT = path.join(path.dirname(SRC), 'ENDERECOS_OSE_PO1-2.xlsx');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeo(lat, lon) {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat
    + '&lon=' + lon + '&addressdetails=1&accept-language=pt-BR';
  const res = await fetch(url, { headers: { 'User-Agent': 'Nexus-A2Z-Projetos/2.19' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function extractRua(data) {
  const a = data?.address || {};
  return (a.road || a.pedestrian || a.residential || a.street || a.footway || '').trim();
}

function extractFirstPvCoord(ws) {
  // Estrutura observada: rows começam em index 10+ com PV data.
  // Col B (index 1) = X (Easting), Col C (index 2) = Y (Northing).
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
  for (let i = 10; i < rows.length; i++) {
    const r = rows[i] || [];
    const x = parseFloat(r[1]);
    const y = parseFloat(r[2]);
    if (isFinite(x) && isFinite(y) && x > 100000 && y > 1000000) {
      return { x, y };
    }
  }
  return null;
}

(async () => {
  console.log('Lendo:', SRC);
  const wb = xlsx.readFile(SRC);
  console.log('Abas totais:', wb.SheetNames.length);

  // Ordem das OSEs: usa a coluna A da aba ENDEREÇOS (já tem todas listadas).
  const endWs = wb.Sheets['ENDEREÇOS'];
  const endRows = xlsx.utils.sheet_to_json(endWs, { header: 1, blankrows: false, defval: null });
  const oses = [];
  for (let i = 1; i < endRows.length; i++) {
    const nome = String((endRows[i] || [])[0] || '').trim();
    if (/^OSE[\s\-]+\d+[A-Za-z]?$/i.test(nome)) oses.push(nome);
  }
  console.log('OSEs a processar:', oses.length);

  // Preparar output workbook
  const outWb = new ExcelJS.Workbook();
  const outWs = outWb.addWorksheet('Endereços OSE');
  outWs.columns = [
    { header: 'OSE',      key: 'ose', width: 16 },
    { header: 'NOME RUA', key: 'rua', width: 55 },
  ];
  outWs.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  outWs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  outWs.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

  const results = [];
  let ok = 0, skipNoCoord = 0, skipNoRua = 0, err = 0;

  for (let i = 0; i < oses.length; i++) {
    const oseName = oses[i];
    const label = '[' + (i + 1) + '/' + oses.length + '] ' + oseName;

    const sheet = wb.Sheets[oseName];
    if (!sheet) {
      console.log(label + ': aba não existe, pulando');
      results.push({ ose: oseName, rua: '(aba ausente)' });
      skipNoCoord++;
      continue;
    }

    const coord = extractFirstPvCoord(sheet);
    if (!coord) {
      console.log(label + ': sem coordenada UTM válida');
      results.push({ ose: oseName, rua: '(sem coordenada)' });
      skipNoCoord++;
      continue;
    }

    // UTM → WGS84 (proj4 devolve [lon, lat])
    const [lon, lat] = proj4('EPSG:31982', 'EPSG:4326', [coord.x, coord.y]);

    try {
      const data = await reverseGeo(lat, lon);
      const rua = extractRua(data);
      if (!rua) {
        console.log(label + ': Nominatim sem rua (lat=' + lat.toFixed(5) + ',lon=' + lon.toFixed(5) + ')');
        results.push({ ose: oseName, rua: '' });
        skipNoRua++;
      } else {
        const ruaUpper = rua.toUpperCase();
        console.log(label + ' → ' + ruaUpper);
        results.push({ ose: oseName, rua: ruaUpper });
        ok++;
      }
    } catch (e) {
      console.log(label + ': ERRO ' + e.message);
      results.push({ ose: oseName, rua: 'ERRO' });
      err++;
    }

    // Respeita rate limit do Nominatim: 1 req/s máximo
    await sleep(1100);
  }

  // Escreve no output
  for (const r of results) outWs.addRow(r);
  await outWb.xlsx.writeFile(OUT);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Total:', oses.length);
  console.log('OK:', ok);
  console.log('Sem coordenada:', skipNoCoord);
  console.log('Sem rua:', skipNoRua);
  console.log('Erro:', err);
  console.log('\nArquivo gerado:\n' + OUT);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
