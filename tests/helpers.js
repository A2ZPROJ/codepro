import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const xlsx = require('xlsx');

const FIXTURES = path.join(__dirname, 'fixtures');

export function fixturePath(...segments) {
  return path.join(FIXTURES, ...segments);
}

export function readFixture(...segments) {
  return fs.readFileSync(fixturePath(...segments), 'utf8');
}

// DXF mínimo em memória — array de {code, val} pares
export function makeDxfFromGroups(groups) {
  return groups.map(g => `${g.code}\n${g.val}`).join('\n') + '\n';
}

export function makeMtext({ layer, text, x = 0, y = 0 }) {
  return [
    { code: 0,  val: 'MTEXT' },
    { code: 8,  val: layer },
    { code: 10, val: String(x) },
    { code: 20, val: String(y) },
    { code: 30, val: '0' },
    { code: 1,  val: text },
  ];
}

export function makeInsert({ name, x = 0, y = 0 }) {
  return [
    { code: 0,  val: 'INSERT' },
    { code: 2,  val: name },
    { code: 10, val: String(x) },
    { code: 20, val: String(y) },
    { code: 30, val: '0' },
  ];
}

export function wrapEntities(entitiesGroups) {
  return [
    { code: 0, val: 'SECTION' },
    { code: 2, val: 'ENTITIES' },
    ...entitiesGroups,
    { code: 0, val: 'ENDSEC' },
    { code: 0, val: 'EOF' },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers pra construir XLSX no formato esperado pelo parseExcel().
// Layout (parseOse.js:676+):
//   Cell C6 = comprimento total da OSE
//   Row 10 (1-idx) = header — colunas Este/Norte/Cota detectadas por regex
//   Row 11+ = dados, Coluna A = id (PV/TL/PIT-NNN)
//   Cols fixas: H=ct, J=cf, G=dist_acum, O=decl, P=diam, S=prof, U=obs
// ──────────────────────────────────────────────────────────────────────────

// rows: array de { id, este, norte, cota, ct, cf, dist, decl, diam, prof, obs }
export function buildOseSheet({ comprimento = 100, rows = [] }) {
  const aoa = [];
  // Linhas 1-9 vazias salvo C6 (comprimento)
  for (let i = 0; i < 9; i++) aoa.push([]);
  aoa[5] = [null, null, comprimento]; // row index 5 = linha 6 (1-idx); col index 2 = C
  // Row 10 (1-idx) = header
  aoa.push([
    'ID',      // A
    'Este',    // B
    'Norte',   // C
    'Cota',    // D
    null,      // E
    null,      // F
    'Dist',    // G
    'C.Topo',  // H
    null,      // I
    'C.Fundo', // J
    null,      // K
    null,      // L
    null,      // M
    null,      // N
    'Decl',    // O
    'Diam',    // P
    null,      // Q
    null,      // R
    'Prof',    // S
    null,      // T
    'Obs',     // U
  ]);
  // Rows de dados
  for (const r of rows) {
    aoa.push([
      r.id,
      r.este ?? null,
      r.norte ?? null,
      r.cota ?? null,
      null,
      null,
      r.dist ?? null,
      r.ct ?? null,
      null,
      r.cf ?? null,
      null,
      null,
      null,
      null,
      r.decl ?? null,
      r.diam ?? null,
      null,
      null,
      r.prof ?? null,
      null,
      r.obs ?? null,
    ]);
  }
  return xlsx.utils.aoa_to_sheet(aoa);
}

// sheets: { 'OSE-005': { comprimento, rows }, 'OSE-005A': {...} }
export function buildOseWorkbook(sheets) {
  const wb = xlsx.utils.book_new();
  for (const [name, def] of Object.entries(sheets)) {
    const ws = buildOseSheet(def);
    xlsx.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}

// Escreve workbook num arquivo temporário e devolve o path; o caller deve
// chamar fs.unlinkSync() depois.
export function writeTempXlsx(wb, name = 'tmp_test.xlsx') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
  const file = path.join(dir, name);
  xlsx.writeFile(wb, file);
  return file;
}

export function cleanupTempFile(file) {
  try {
    fs.unlinkSync(file);
    fs.rmdirSync(path.dirname(file));
  } catch {}
}
