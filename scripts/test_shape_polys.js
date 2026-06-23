// test_shape_polys.js
// FASE 1c (modo OFF) — Detecção geométrica de polígono via shapefile
// Lê shapefile (com atributo SBB), lê planilha GIS, faz point-in-polygon
// para classificar cada linha pela sua bacia (SBB), e identifica OSEs divididas.
//
// Uso: node test_shape_polys.js "<shapefile.shp>" "<planilha.xls/.xlsx>"

'use strict';

const xlsx = require('xlsx');
const shapefile = require('shapefile');
const path = require('path');
const fs = require('fs');

// === Configuração (lida dos headers reais da PO R200.xls) ===
const COL = {
  OSE1a: 5,    // F
  OSE: 6,      // G
  px_x: 12,    // M (UTM Easting)
  px_y: 13,    // N (UTM Northing)
  pv_jus: 14,  // O
};

// === Helpers de célula ===
function cellVal(ws, r, c) {
  const addr = xlsx.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return { val: null };
  return { val: cell.v };
}
function cellStr(ws, r, c) {
  const v = cellVal(ws, r, c).val;
  return (v != null && v !== '') ? String(v) : '';
}
function cellNum(ws, r, c) {
  const v = cellVal(ws, r, c).val;
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : null;
}
function findMainDataEnd(ws, ref) {
  for (let r = ref.e.r; r >= 1; r--) {
    if (cellStr(ws, r, COL.pv_jus)) return r;
  }
  return ref.e.r;
}

// === Point-in-polygon (ray casting) ===
// Funciona com anéis (array de [x,y]); ignora anéis internos (holes) por simplicidade
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Polygon = array de rings; primeiro = exterior, demais = holes
function pointInPolygon(x, y, polygon) {
  if (!polygon.length) return false;
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(x, y, polygon[i])) return false; // dentro de hole
  }
  return true;
}

// MultiPolygon = array de polygons
function pointInGeometry(x, y, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(x, y, geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    for (const p of geom.coordinates) {
      if (pointInPolygon(x, y, p)) return true;
    }
  }
  return false;
}

// Bounding box helper para acelerar
function bboxOfGeom(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geom.type === 'Polygon') geom.coordinates.forEach(visit);
  else if (geom.type === 'MultiPolygon') {
    for (const p of geom.coordinates) p.forEach(visit);
  }
  return [minX, minY, maxX, maxY];
}

// === Carrega shapefile como array de {sbb, geom, bbox} ===
async function loadShape(shpPath) {
  const polys = [];
  const source = await shapefile.open(shpPath);
  while (true) {
    const r = await source.read();
    if (r.done) break;
    const feat = r.value;
    const sbb = feat.properties && (feat.properties.SBB || feat.properties.sbb || feat.properties.Sbb);
    if (sbb == null) continue;
    polys.push({
      sbb: String(sbb),
      geom: feat.geometry,
      bbox: bboxOfGeom(feat.geometry),
    });
  }
  return polys;
}

// === Classifica ponto: retorna SBB ou null ===
function classifyPoint(x, y, polys) {
  for (const p of polys) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (pointInGeometry(x, y, p.geom)) return p.sbb;
  }
  return null;
}

// === MAIN ===
async function main() {
  const shpPath = process.argv[2];
  const xlsPath = process.argv[3];
  if (!shpPath || !xlsPath) {
    console.error('Uso: node test_shape_polys.js "<shapefile.shp>" "<planilha.xls/.xlsx>"');
    process.exit(1);
  }

  console.log('=== FASE 1c — Polígono via Shapefile (TESTE OFF) ===\n');
  console.log('Shapefile:', shpPath);
  console.log('Planilha: ', xlsPath);
  console.log();

  console.log('Lendo shapefile...');
  const polys = await loadShape(shpPath);
  console.log('Polígonos carregados:', polys.length);
  console.log('SBBs:', polys.map(p => p.sbb).join(', '));
  console.log();

  console.log('Lendo planilha...');
  const wb = xlsx.readFile(xlsPath, { cellFormula: false, cellNF: false, cellStyles: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = xlsx.utils.decode_range(ws['!ref']);
  const lastMainRow = findMainDataEnd(ws, ref);
  console.log('Última linha de dados:', lastMainRow + 1);
  console.log();

  console.log('Classificando pontos...');
  const t0 = Date.now();

  const oseSbb = {};       // ose1a -> { sbbCount: {sbb:n}, totalRows, noCoord, outside }
  const sbbCount = {};     // sbb -> n linhas
  let withCoord = 0, noCoord = 0, outside = 0;

  for (let r = 1; r <= lastMainRow; r++) {
    const ose1a = cellStr(ws, r, COL.OSE1a);
    if (!ose1a) continue;

    const x = cellNum(ws, r, COL.px_x);
    const y = cellNum(ws, r, COL.px_y);
    if (!oseSbb[ose1a]) oseSbb[ose1a] = { sbbCount: {}, totalRows: 0, noCoord: 0, outside: 0 };
    oseSbb[ose1a].totalRows++;

    if (x == null || y == null) {
      oseSbb[ose1a].noCoord++;
      noCoord++;
      continue;
    }
    withCoord++;
    const sbb = classifyPoint(x, y, polys);
    if (sbb == null) {
      oseSbb[ose1a].outside++;
      outside++;
    } else {
      oseSbb[ose1a].sbbCount[sbb] = (oseSbb[ose1a].sbbCount[sbb] || 0) + 1;
      sbbCount[sbb] = (sbbCount[sbb] || 0) + 1;
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`Concluído em ${dt}s`);
  console.log();

  console.log('--- Estatísticas ---');
  console.log('Linhas com coords:    ', withCoord);
  console.log('Linhas sem coords:    ', noCoord);
  console.log('Fora de qualquer SBB: ', outside);
  console.log();

  console.log('--- Linhas por SBB ---');
  for (const [sbb, n] of Object.entries(sbbCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sbb.padEnd(20)} ${n}`);
  }
  console.log();

  // OSEs divididas
  const splits = [];
  for (const [ose, info] of Object.entries(oseSbb)) {
    const sbbs = Object.keys(info.sbbCount);
    if (sbbs.length <= 1) continue;
    let majSbb = sbbs[0];
    for (const s of sbbs) {
      if (info.sbbCount[s] > info.sbbCount[majSbb]) majSbb = s;
    }
    let moved = 0;
    for (const s of sbbs) if (s !== majSbb) moved += info.sbbCount[s];
    splits.push({ ose, sbbCount: info.sbbCount, majSbb, moved, total: info.totalRows });
  }
  splits.sort((a, b) => b.moved - a.moved);

  console.log('--- OSEs divididas entre SBBs ---');
  console.log('Total:', splits.length);
  for (const s of splits.slice(0, 30)) {
    const detail = Object.entries(s.sbbCount)
      .sort((a, b) => b[1] - a[1])
      .map(([sbb, n]) => `${sbb}=${n}`).join(' + ');
    console.log(`  ${s.ose.padEnd(14)} ${detail.padEnd(50)} → ${s.majSbb}  [move ${s.moved}]`);
  }
  if (splits.length > 30) console.log(`  ... e mais ${splits.length - 30} OSEs`);
  console.log();

  // OSEs com pontos fora de qualquer SBB
  const orphans = Object.entries(oseSbb)
    .filter(([_, i]) => i.outside > 0)
    .sort((a, b) => b[1].outside - a[1].outside);
  if (orphans.length) {
    console.log('--- OSEs com pontos FORA de qualquer SBB ---');
    console.log('Total:', orphans.length);
    for (const [ose, i] of orphans.slice(0, 20)) {
      console.log(`  ${ose.padEnd(14)} ${i.outside}/${i.totalRows} pontos fora`);
    }
    if (orphans.length > 20) console.log(`  ... e mais ${orphans.length - 20} OSEs`);
  }
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
