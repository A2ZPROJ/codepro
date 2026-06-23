// test_normalize_polys.js
// FASE 1 (modo OFF) — Normalização de polígonos
// Lê uma planilha GIS, identifica OSEs divididas entre múltiplos polígonos
// e reatribui todas as linhas da OSE ao polígono majoritário.
// Gera planilha corrigida + log de alterações.
//
// Uso: node test_normalize_polys.js "<caminho do .xls/.xlsx>"

'use strict';

const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// === Configuração (espelha src/app/index.html) ===
const COL = {
  OSE1a: 5,    // F
  OSE: 6,      // G
  pv_mont: 9,  // J
  pv_jus: 12,  // M
};

// === Helpers de célula ===
function cellVal(ws, r, c) {
  const addr = xlsx.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return { val: null, error: false };
  if (cell.t === 'e') return { val: cell.w || '#N/A', error: true };
  return { val: cell.v, error: false };
}
function cellStr(ws, r, c) {
  const { val } = cellVal(ws, r, c);
  return (val != null && val !== '') ? String(val) : '';
}

// === Detecção de coluna POLIGONO (header) ===
function findPolygonCol(ws, ref) {
  for (let c = 26; c < Math.min(ref.e.c + 1, 50); c++) {
    const h = cellStr(ws, 0, c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (h.includes('poligono') || h.includes('polygon')) return c;
  }
  return -1;
}

// === Detecção de fim do bloco principal ===
function findMainDataEnd(ws, ref) {
  for (let r = ref.e.r; r >= 1; r--) {
    const jus = cellStr(ws, r, COL.pv_jus);
    if (jus) return r;
  }
  return ref.e.r;
}

// === Calcula plano de normalização ===
// Retorna { polyCol, lastMainRow, oses: {ose1a: {polyCount, polyRows, majPoly, totalRows}}, splits: [...] }
function computeNormalizationPlan(ws, ref) {
  const polyCol = findPolygonCol(ws, ref);
  if (polyCol < 0) {
    throw new Error('Coluna POLIGONO não encontrada na planilha.');
  }
  const lastMainRow = findMainDataEnd(ws, ref);

  const oses = {};   // ose1a -> { polyCount: {p:n}, polyRows: {p:[r,...]}, totalRows }
  const polygons = new Set();

  for (let r = 1; r <= lastMainRow; r++) {
    const ose1a = cellStr(ws, r, COL.OSE1a);
    if (!ose1a) continue;

    const polyRaw = cellVal(ws, r, polyCol).val;
    const polyNum = polyRaw != null && polyRaw !== '' ? Number(polyRaw) : NaN;
    if (!isFinite(polyNum)) continue;
    const polyStr = String(Math.round(polyNum));
    polygons.add(polyStr);

    if (!oses[ose1a]) oses[ose1a] = { polyCount: {}, polyRows: {}, totalRows: 0 };
    oses[ose1a].polyCount[polyStr] = (oses[ose1a].polyCount[polyStr] || 0) + 1;
    if (!oses[ose1a].polyRows[polyStr]) oses[ose1a].polyRows[polyStr] = [];
    oses[ose1a].polyRows[polyStr].push(r);
    oses[ose1a].totalRows++;
  }

  // Identificar splits e majoritário
  const splits = [];
  for (const [ose1a, info] of Object.entries(oses)) {
    const polys = Object.keys(info.polyCount);
    if (polys.length <= 1) continue;
    // Majoritário: maior count; tiebreak = menor número de polígono (estável e previsível)
    let majPoly = polys[0];
    for (const p of polys) {
      if (info.polyCount[p] > info.polyCount[majPoly] ||
          (info.polyCount[p] === info.polyCount[majPoly] && Number(p) < Number(majPoly))) {
        majPoly = p;
      }
    }
    info.majPoly = majPoly;
    const movedRows = [];
    for (const p of polys) {
      if (p === majPoly) continue;
      for (const r of info.polyRows[p]) movedRows.push({ row: r, fromPoly: p });
    }
    splits.push({
      ose1a,
      polyCount: info.polyCount,
      majPoly,
      movedRows,
      movedCount: movedRows.length,
      totalRows: info.totalRows,
    });
  }

  splits.sort((a, b) => b.movedCount - a.movedCount);

  return {
    polyCol, lastMainRow,
    totalOses: Object.keys(oses).length,
    polygons: [...polygons].sort((a, b) => Number(a) - Number(b)),
    splits,
  };
}

// === Aplica plano: escreve novo polígono nas células e grava XLSX ===
function applyPlan(ws, polyCol, splits, outPath) {
  let cellsChanged = 0;
  for (const s of splits) {
    const newPolyNum = Number(s.majPoly);
    for (const m of s.movedRows) {
      const addr = xlsx.utils.encode_cell({ r: m.row, c: polyCol });
      const cell = ws[addr] || {};
      cell.v = newPolyNum;
      cell.t = 'n';
      delete cell.w;
      delete cell.f;
      ws[addr] = cell;
      cellsChanged++;
    }
  }
  return cellsChanged;
}

// === Monta sheet de log ===
function buildLogSheet(splits) {
  const rows = [
    ['OSE', 'Polígono Original', 'Linhas Originais', 'Polígono Novo (majoritário)', 'Linhas Movidas', 'Linha XLSX (1-indexed)'],
  ];
  for (const s of splits) {
    const detail = Object.entries(s.polyCount)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([p, n]) => `POLY ${p}: ${n}`)
      .join(' | ');
    for (const m of s.movedRows) {
      rows.push([
        s.ose1a,
        m.fromPoly,
        detail,
        s.majPoly,
        s.movedCount,
        m.row + 1,
      ]);
    }
  }
  return xlsx.utils.aoa_to_sheet(rows);
}

// === MAIN ===
function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node test_normalize_polys.js "<caminho do .xls/.xlsx>"');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('Arquivo não encontrado:', filePath);
    process.exit(1);
  }

  console.log('=== FASE 1 — Normalização de Polígonos (TESTE OFF) ===\n');
  console.log('Arquivo:', filePath);
  console.log('Lendo...\n');

  const wb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, cellStyles: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const ref = xlsx.utils.decode_range(ws['!ref']);

  const plan = computeNormalizationPlan(ws, ref);

  console.log('Sheet:               ', sheetName);
  console.log('Última linha de dados:', plan.lastMainRow + 1);
  console.log('Coluna POLIGONO:     ', xlsx.utils.encode_col(plan.polyCol), '(idx', plan.polyCol + ')');
  console.log('Polígonos detectados:', plan.polygons.join(', '));
  console.log('Total de OSEs:       ', plan.totalOses);
  console.log('OSEs divididas:      ', plan.splits.length);

  const totalMoved = plan.splits.reduce((a, s) => a + s.movedCount, 0);
  console.log('Linhas a reatribuir: ', totalMoved);
  console.log();

  if (plan.splits.length === 0) {
    console.log('Nenhuma OSE dividida — nada a normalizar.');
    return;
  }

  console.log('--- Top 30 OSEs divididas ---');
  for (const s of plan.splits.slice(0, 30)) {
    const detail = Object.entries(s.polyCount)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([p, n]) => `POLY ${p}=${n}`)
      .join(' + ');
    console.log(`  ${s.ose1a.padEnd(14)} ${detail.padEnd(40)} → POLY ${s.majPoly}  [move ${s.movedCount}]`);
  }
  if (plan.splits.length > 30) {
    console.log(`  ... e mais ${plan.splits.length - 30} OSEs`);
  }
  console.log();

  // Aplica e salva
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const outPath = path.join(dir, `${base}_NORMALIZADO.xlsx`);

  const cellsChanged = applyPlan(ws, plan.polyCol, plan.splits);
  const logSheet = buildLogSheet(plan.splits);
  xlsx.utils.book_append_sheet(wb, logSheet, 'Log Normalizacao');

  xlsx.writeFile(wb, outPath);
  console.log('Células alteradas:   ', cellsChanged);
  console.log('Planilha salva em:   ', outPath);
  console.log('Sheet adicionada:    ', '"Log Normalizacao"');
}

try { main(); }
catch (e) { console.error('ERRO:', e.message); process.exit(1); }
