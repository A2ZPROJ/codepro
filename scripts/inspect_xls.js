'use strict';
const xlsx = require('xlsx');
const wb = xlsx.readFile(process.argv[2], { cellFormula: false, cellNF: false, cellStyles: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const ref = xlsx.utils.decode_range(ws['!ref']);
console.log('Sheet:', wb.SheetNames[0]);
console.log('Range:', ws['!ref'], '— rows:', ref.e.r + 1, 'cols:', ref.e.c + 1);
console.log();

// Headers row 0
console.log('--- Headers (row 1) ---');
for (let c = 0; c <= Math.min(ref.e.c, 35); c++) {
  const addr = xlsx.utils.encode_cell({ r: 0, c });
  const v = ws[addr] ? ws[addr].v : '';
  if (v) console.log(`  ${xlsx.utils.encode_col(c).padEnd(3)} (${c}): ${v}`);
}
console.log();

// Sample rows
const samples = [1, 2, 3, 5, 10, 100, 500, 1000, 5000, 12070, 12080, 12500, 12805];
for (const r of samples) {
  if (r > ref.e.r) continue;
  console.log(`--- Row ${r + 1} ---`);
  for (let c = 0; c <= Math.min(ref.e.c, 35); c++) {
    const addr = xlsx.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (cell && cell.v !== undefined && cell.v !== '') {
      console.log(`  ${xlsx.utils.encode_col(c)} (t=${cell.t}): ${JSON.stringify(cell.v)}`);
    }
  }
  console.log();
}
