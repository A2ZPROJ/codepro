// audit_real.js — Auditoria standalone com colunas CORRETAS (lidas do header)
// Reproduz a lógica de gisAudit() do app, mas detectando colunas pelos headers reais.
// Uso: node audit_real.js "<planilha.xls/.xlsx>"

'use strict';
const xlsx = require('xlsx');

const H_MIN = 1.10;
const TL_MAX_H = 1.30;
const DECL_MIN_SHALLOW = 0.01;
const DECL_MIN_DEEP = 0.0055;
const DECL_DEPTH_LIMIT = 3.0;
const DECL_EPS = 5e-5;

function cellVal(ws, r, c) {
  const a = xlsx.utils.encode_cell({ r, c });
  const cell = ws[a];
  if (!cell) return { val: null, error: false };
  if (cell.t === 'e') return { val: cell.w || '#N/A', error: true };
  return { val: cell.v, error: false };
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

// === Detecção dinâmica de colunas pelo header da row 1 ===
function detectCols(ws, ref) {
  const map = {};
  const aliases = {
    OSE1a:     ['ose1a'],
    OSE:       ['ose'],
    tipo_pv:   ['tipo_pv'],
    tipo_tubo: ['tipo_tubo'],
    pv_mont:   ['pv_mont1', 'pv_mont'],
    px_x:      ['px_x'],
    px_y:      ['px_y'],
    pv_jus:    ['pv_jus'],
    terr_mont: ['terr_mont'],
    terr_jus:  ['terr_jus'],
    proj_mont: ['proj_mont'],
    proj_jus:  ['proj_jus'],
    prof_mont: ['prof_mont'],
    prof_jus:  ['prof_jus'],
    compr:     ['compr', 'comprimento'],
    material:  ['material'],
    diam:      ['diam', 'diametro'],
    POLIGONO:  ['poligono', 'polygon'],
  };
  for (let c = 0; c <= ref.e.c; c++) {
    const h = cellStr(ws, 0, c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!h) continue;
    for (const [key, names] of Object.entries(aliases)) {
      if (names.includes(h) && map[key] == null) { map[key] = c; break; }
    }
  }
  return map;
}

function findMainDataEnd(ws, ref, pvJusCol) {
  for (let r = ref.e.r; r >= 1; r--) {
    if (cellStr(ws, r, pvJusCol)) return r;
  }
  return ref.e.r;
}

function isTL(s) { return typeof s === 'string' && s.toUpperCase().startsWith('TL'); }
function isTQ(s) { return typeof s === 'string' && s.toUpperCase().startsWith('TQ-'); }

// === MAIN ===
const filePath = process.argv[2];
if (!filePath) { console.error('Uso: node audit_real.js "<planilha>"'); process.exit(1); }

console.log('=== Auditoria com colunas REAIS (detectadas por header) ===\n');
console.log('Arquivo:', filePath, '\n');

const wb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, cellStyles: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const ref = xlsx.utils.decode_range(ws['!ref']);
const COL = detectCols(ws, ref);

console.log('--- Colunas detectadas ---');
for (const [k, v] of Object.entries(COL)) {
  console.log(`  ${k.padEnd(12)} = ${xlsx.utils.encode_col(v)} (idx ${v})`);
}
console.log();

const lastMain = findMainDataEnd(ws, ref, COL.pv_jus);
console.log('Última linha:', lastMain + 1, '\n');

const errors = [];
const counts = {};
const oses = new Set();
function add(type, row, ose, motivo) {
  errors.push({ type, row, ose, motivo });
  counts[type] = (counts[type] || 0) + 1;
}

for (let r = 1; r <= lastMain; r++) {
  const ose1a = cellStr(ws, r, COL.OSE1a);
  const ose = cellStr(ws, r, COL.OSE);
  if (!ose1a && !ose) continue;
  if (ose1a) oses.add(ose1a);

  const rowNum = r + 1;
  const pvMont = cellVal(ws, r, COL.pv_mont);
  const pvJus  = cellVal(ws, r, COL.pv_jus);
  const profMont = cellNum(ws, r, COL.prof_mont);
  const profJus  = cellNum(ws, r, COL.prof_jus);
  const projMont = cellNum(ws, r, COL.proj_mont);
  const projJus  = cellNum(ws, r, COL.proj_jus);
  const compr    = cellNum(ws, r, COL.compr);

  // 1. Formula errors
  for (const [name, ci] of Object.entries(COL)) {
    const cv = cellVal(ws, r, ci);
    if (cv.error) add('formula_error', rowNum, ose1a || ose, `#N/A em ${name}`);
  }

  // 2. TQ- nomenclatura
  if (!pvMont.error && isTQ(pvMont.val)) add('tq_nomenclatura', rowNum, ose1a || ose, `pv_mont=${pvMont.val} deveria ser PV-`);
  if (!pvJus.error  && isTQ(pvJus.val))  add('tq_nomenclatura', rowNum, ose1a || ose, `pv_jus=${pvJus.val} deveria ser PV-`);

  // 3. TL com h > 1.30
  if (!pvMont.error && isTL(pvMont.val) && profMont != null && profMont > TL_MAX_H)
    add('tl_deveria_pv', rowNum, ose1a || ose, `TL h=${profMont.toFixed(3)}m no pv_mont (${pvMont.val})`);
  if (!pvJus.error && isTL(pvJus.val) && profJus != null && profJus > TL_MAX_H)
    add('tl_deveria_pv', rowNum, ose1a || ose, `TL h=${profJus.toFixed(3)}m no pv_jus (${pvJus.val})`);

  // 4. Profundidade < 1.10
  if (profMont != null && profMont >= 0 && profMont < H_MIN)
    add('prof_rasa', rowNum, ose1a || ose, `prof_mont=${profMont.toFixed(3)} < ${H_MIN}`);
  if (profJus != null && profJus >= 0 && profJus < H_MIN)
    add('prof_rasa', rowNum, ose1a || ose, `prof_jus=${profJus.toFixed(3)} < ${H_MIN}`);

  // 5. Profundidade negativa
  if (profMont != null && profMont < 0) add('prof_negativa', rowNum, ose1a || ose, `prof_mont=${profMont.toFixed(3)}`);
  if (profJus != null && profJus < 0)  add('prof_negativa', rowNum, ose1a || ose, `prof_jus=${profJus.toFixed(3)}`);

  // 6. Declividade baixa  e  7. Contra-declive
  if (compr != null && compr > 0 && projMont != null && projJus != null) {
    const desn = projMont - projJus;
    const decl = Math.abs(desn) / compr;
    const maxH = Math.max(profMont || 0, profJus || 0);
    if (maxH <= DECL_DEPTH_LIMIT) {
      if (decl < DECL_MIN_SHALLOW - DECL_EPS)
        add('decl_baixa', rowNum, ose1a || ose, `decl=${(decl*100).toFixed(2)}% < 1% (h_max=${maxH.toFixed(2)}m)`);
    } else {
      if (decl < DECL_MIN_DEEP - DECL_EPS)
        add('decl_baixa', rowNum, ose1a || ose, `decl=${(decl*100).toFixed(2)}% < 0,55% (h_max=${maxH.toFixed(2)}m)`);
    }
    if (desn < -0.001) add('contra_declive', rowNum, ose1a || ose, `desnivel=${desn.toFixed(3)}m (proj_mont=${projMont.toFixed(3)} < proj_jus=${projJus.toFixed(3)})`);
  }
}

console.log('--- Resumo ---');
console.log('Linhas analisadas:  ', lastMain);
console.log('OSEs únicas:        ', oses.size);
console.log('Erros totais:       ', errors.length);
console.log();
console.log('--- Por tipo ---');
const order = ['formula_error', 'tq_nomenclatura', 'tl_deveria_pv', 'prof_rasa', 'prof_negativa', 'decl_baixa', 'contra_declive'];
for (const t of order) {
  if (counts[t]) console.log(`  ${t.padEnd(20)} ${counts[t]}`);
}
console.log();

console.log('--- Amostra: 30 primeiros erros ---');
for (const e of errors.slice(0, 30)) {
  console.log(`  L${String(e.row).padEnd(6)} ${e.ose.padEnd(14)} [${e.type}] ${e.motivo}`);
}
if (errors.length > 30) console.log(`  ... e mais ${errors.length - 30}`);
