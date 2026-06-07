// Geração do XLSX do Cronograma de Entregas — replica o Cronograma_2S_E-Agua_R02.
// 2 abas: "Cronograma Geral" (atividades por município) + "Calendario" (parâmetros + feriados).
// Roda no processo principal (Electron) via IPC, igual ao exportOse.js.

const ATIV_LABEL = {
  STREAM: 'STREAM',
  PROJ_BASICO: 'PROJ. BÁSICO',
  PROJ_EXECUTIVO: 'PROJ. EXECUTIVO',
  EEE_LRE: '↳ EEE + LRE',
};

const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function toDate(iso) {
  if (!iso) return null;
  const x = String(iso).slice(0, 10).split('-');
  if (x.length !== 3) return null;
  return new Date(+x[0], +x[1] - 1, +x[2], 12, 0, 0); // meio-dia local evita shift de fuso
}

function buildCronogramaWorkbook(rows, params) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nexus - A2Z Projetos';
  wb.created = new Date();

  const HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  const HDR_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
  const TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const GROUP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  const EAGUA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
  const DATE_FMT = 'dd/mm/yyyy';

  // ════════ ABA: Cronograma Geral ════════
  const ws = wb.addWorksheet('Cronograma Geral');
  ws.columns = [
    { width: 6 }, { width: 22 }, { width: 17 }, { width: 7 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 11 }, { width: 8 }, { width: 9 }, { width: 13 }, { width: 13 }, { width: 15 },
  ];

  const titleRow = ws.addRow(['CRONOGRAMA GERAL COMPLETO']);
  ws.mergeCells('A1:O1');
  titleRow.getCell(1).fill = HDR_FILL;
  titleRow.getCell(1).font = { ...HDR_FONT, size: 13 };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 26;
  ws.addRow([]);

  const hdr = ws.addRow([
    'Ord', 'Município', 'Atividade', 'Parte',
    'RCE (km)', 'CTIE (km)', 'LRE (km)', 'Qtd EEE\n≤5 L/s', 'Qtd EEE\n>5 L/s',
    'Ext.Cálc.', 'PROD', 'Dias', 'Início', 'Fim', 'Status',
  ]);
  hdr.height = 30;
  hdr.eachCell(c => {
    c.fill = HDR_FILL; c.font = HDR_FONT;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  let prevOrd = null;
  rows.forEach(r => {
    const newGroup = r.ord !== prevOrd;
    const dias = (r.dias == null || +r.dias <= 0) ? '-' : +(+r.dias).toFixed(4);
    const row = ws.addRow([
      newGroup ? (r.ord ?? '') : '',
      newGroup ? (r.municipio || '') : '',
      ATIV_LABEL[r.atividade] || r.atividade || '',
      r.parte || '',
      r.rce_km != null && +r.rce_km ? +r.rce_km : null,
      r.ctie_km != null && +r.ctie_km ? +r.ctie_km : null,
      r.lre_km != null && +r.lre_km ? +r.lre_km : null,
      r.qtd_eee_low != null && +r.qtd_eee_low ? +r.qtd_eee_low : null,
      r.qtd_eee_high != null && +r.qtd_eee_high ? +r.qtd_eee_high : null,
      r.ext_calc != null ? +(+r.ext_calc).toFixed(5) : 0,
      r.prod != null ? +r.prod : null,
      dias,
      toDate(r.previsao_inicio),
      toDate(r.previsao_fim),
      r.status || '',
    ]);
    row.font = { size: 10 };
    if (newGroup) {
      row.getCell(1).font = { size: 10, bold: true };
      row.getCell(2).font = { size: 10, bold: true };
    }
    [5, 6, 7, 10].forEach(c => { row.getCell(c).numFmt = '0.000'; row.getCell(c).alignment = { horizontal: 'right' }; });
    [8, 9, 11].forEach(c => { row.getCell(c).alignment = { horizontal: 'center' }; });
    row.getCell(12).alignment = { horizontal: 'right' };
    row.getCell(13).numFmt = DATE_FMT; row.getCell(14).numFmt = DATE_FMT;
    row.getCell(13).alignment = { horizontal: 'center' }; row.getCell(14).alignment = { horizontal: 'center' };
    row.getCell(15).alignment = { horizontal: 'center' };
    if (r.track === 'E-AGUA') { for (let c = 1; c <= 15; c++) row.getCell(c).fill = EAGUA_FILL; }
    else if (newGroup) { for (let c = 1; c <= 4; c++) row.getCell(c).fill = GROUP_FILL; }
    prevOrd = r.ord;
  });

  ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }];
  ws.autoFilter = { from: 'A3', to: 'O3' };

  // ════════ ABA: Calendario ════════
  const P = params || {};
  const wc = wb.addWorksheet('Calendario');
  wc.columns = [{ width: 18 }, { width: 14 }, { width: 48 }, { width: 4 }, { width: 4 }];

  const t1 = wc.addRow(['CALENDÁRIO & PARÂMETROS — Controle do Cronograma']);
  wc.mergeCells('A1:C1');
  t1.getCell(1).fill = TITLE_FILL; t1.getCell(1).font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
  wc.addRow(['Edite as células e recalcule no Nexus']).getCell(1).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  wc.addRow([]);
  wc.addRow(['PARÂMETROS DE PRODUÇÃO']).getCell(1).font = { bold: true };
  const param = (k, v, d) => { const r = wc.addRow([k, v, d]); r.getCell(1).font = { bold: true, size: 10 }; r.getCell(2).alignment = { horizontal: 'left' }; r.getCell(3).font = { size: 9, color: { argb: 'FF64748B' } }; return r; };
  param('PROD_STREAM', P.PROD_STREAM, 'Produtividade STREAM (km/dia)');
  param('PROD_BASICO', P.PROD_BASICO, 'Produtividade Projeto Básico');
  param('PROD_EXEC', P.PROD_EXEC, 'Produtividade Projeto Executivo');
  param('D_BASE', toDate(P.D_BASE), 'Data base do Projeto Básico').getCell(2).numFmt = DATE_FMT;
  param('D_INI_STREAM', toDate(P.D_INI_STREAM), 'Início do STREAM').getCell(2).numFmt = DATE_FMT;
  param('PROD_LRE', P.PROD_LRE, 'Produtividade Linha de Recalque');
  param('GAP_PE', P.GAP_PE, 'Gap entre fim do Básico e início do Executivo (Aprovação Acciona)');
  param('DIAS_EEE_LOW', P.DIAS_EEE_LOW, 'Dias por EEE com vazão ≤ 5 L/s');
  param('DIAS_EEE_HIGH', P.DIAS_EEE_HIGH, 'Dias por EEE com vazão > 5 L/s');
  wc.addRow([]);

  const fh = wc.addRow(['FERIADOS NACIONAIS']); fh.getCell(1).font = { bold: true };
  const fhdr = wc.addRow(['Data', 'Dia da semana', 'Descrição']);
  fhdr.eachCell(c => { c.font = HDR_FONT; c.fill = HDR_FILL; });
  (P.FERIADOS || []).forEach(f => {
    const d = toDate(f);
    const r = wc.addRow([d, d ? DOW[d.getDay()] : '', '']);
    r.getCell(1).numFmt = DATE_FMT;
  });

  return wb;
}

module.exports = { buildCronogramaWorkbook };
