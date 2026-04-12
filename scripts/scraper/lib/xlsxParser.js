// Parser de tabela de preço — detecta automaticamente o header
// (Código/Descrição/Un./Valor) e extrai todos os itens.
// Espelha a função parseXlsxSanepar do renderer (src/app/index.html).
'use strict';

const xlsx = require('xlsx');

function parseXlsxTabela(buffer, opts = {}) {
  const wb = xlsx.read(buffer, { type: 'buffer', cellFormula: false, cellNF: false });

  // Escolhe a aba: prioriza nomes com TAB/PREÇ/COMPOS, senão usa a 1ª
  const preferred = wb.SheetNames.find(n => /TAB|PRE[ÇC]|COMPOS/i.test(n));
  const sheetName = opts.sheetName || preferred || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) throw new Error('Aba vazia ou inválida: ' + sheetName);
  const ref = xlsx.utils.decode_range(ws['!ref']);

  // Acha linha de cabeçalho (procura Código/Descrição/Valor)
  let headerRow = -1;
  let colCodigo = -1, colDesc = -1, colUn = -1, colVal = -1;
  for (let r = 0; r <= Math.min(ref.e.r, 60); r++) {
    const cells = [];
    for (let c = 0; c <= ref.e.c; c++) {
      const cell = ws[xlsx.utils.encode_cell({ r, c })];
      cells.push(cell && cell.v != null ? String(cell.v).toLowerCase().trim() : '');
    }
    const hCod = cells.findIndex(v => v === 'código' || v === 'codigo' || v === 'cód.' || v === 'cod');
    const hDesc = cells.findIndex(v => v.startsWith('descri'));
    const hUn = cells.findIndex(v => /un\.?\s*med|unidade$|^un$|^und$/i.test(v));
    const hVal = cells.findIndex(v =>
      (v.includes('valor') && (v.includes('unit') || v.includes('r$'))) ||
      v === 'valor unitário' || v === 'valor unit' || v === 'valor' ||
      v === 'preço' || v === 'preco unitario' || v === 'preço unitário'
    );
    if (hCod >= 0 && hDesc >= 0 && hVal >= 0) {
      headerRow = r;
      colCodigo = hCod;
      colDesc = hDesc;
      colUn = hUn >= 0 ? hUn : -1;
      colVal = hVal;
      break;
    }
  }
  if (headerRow < 0) {
    throw new Error(
      'Cabeçalho não encontrado (Código/Descrição/Valor) na aba "' + sheetName + '"'
    );
  }

  const items = [];
  let emptyStreak = 0;
  for (let r = headerRow + 1; r <= ref.e.r; r++) {
    const cC = ws[xlsx.utils.encode_cell({ r, c: colCodigo })];
    const cD = ws[xlsx.utils.encode_cell({ r, c: colDesc })];
    const cU = colUn >= 0 ? ws[xlsx.utils.encode_cell({ r, c: colUn })] : null;
    const cV = ws[xlsx.utils.encode_cell({ r, c: colVal })];
    const cod = cC && cC.v != null ? String(cC.v).trim() : '';
    const desc = cD && cD.v != null ? String(cD.v).trim() : '';
    if (!cod && !desc) { if (++emptyStreak >= 10) break; continue; }
    emptyStreak = 0;
    if (!cod) continue;
    const un = cU && cU.v != null ? String(cU.v).trim() : null;
    let val = null;
    if (cV && cV.v != null) {
      const n = typeof cV.v === 'number'
        ? cV.v
        : parseFloat(String(cV.v).replace(/\./g, '').replace(',', '.'));
      if (!isNaN(n)) val = n;
    }
    // Detecta nível hierárquico pelo formato do código
    let nivel = 3;
    if (/^\d{3}$/.test(cod)) nivel = 1;
    else if (/^\d{3}\.\d{3}$/.test(cod)) nivel = 2;
    items.push({ codigo: cod, descricao: desc, unidade: un, valor_unitario: val, nivel });
  }

  return { sheetName, headerRow, items };
}

module.exports = { parseXlsxTabela };
