// Construção do relatório XLSX de OSE (Trechos + abas por OSE).
// Separado de main.js para permitir uso fora do Electron (testes).

const { classifyOse, crossCheckPVs, TOL, tlShouldBePv } = require('./oseStatus');

function buildOseWorkbook(data) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nexus - A2Z Projetos';
  wb.created = new Date();

  const CT_TOL = TOL.CT, CF_TOL = TOL.CF, L_TOL = TOL.L, I_TOL = TOL.I;
  const GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
  const RED_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  const YELLOW_FILL= { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  const HDR_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  const HDR_FONT   = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
  const MONO       = 'Courier New';

  function applyHeader(row, fill, font) {
    row.eachCell(cell => {
      cell.fill = fill;
      cell.font = font || {};
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
    });
  }

  function setColWidths(ws, widths) {
    ws.columns = widths.map(w => ({ width: w }));
  }

  function maxProf(pv) {
    const vals = [pv.excel_prof_pv, pv.excel_prof_chegada, pv.mapa_h, pv.perf_h]
      .filter(v => v != null && !isNaN(v));
    return vals.length ? Math.max(...vals) : null;
  }
  // Pre-compute classificação por OSE (lógica única em oseStatus.js)
  const oseMeta = data.map(r => classifyOse(r));

  // ============================================================
  // ABA TRECHOS — 1 linha por OSE
  // ============================================================
  {
    const wsT = wb.addWorksheet('Trechos');
    setColWidths(wsT, [10, 18, 11, 11, 11, 13, 13, 11, 11, 11, 13, 13, 18, 36]);
    const hdr = wsT.addRow([
      'OSE', 'Trecho',
      'L Mapa (m)', 'L Planilha (m)', 'L Perfil (m)', 'Dif. L Mapa-Plan.', 'Dif. L Mapa-Perf.',
      'i Mapa', 'i Planilha', 'i Perfil', 'Dif. i Mapa-Plan.', 'Dif. i Mapa-Perf.',
      'Status', 'Avisos',
    ]);
    applyHeader(hdr, HDR_FILL, HDR_FONT);
    hdr.height = 30;

    data.forEach((r, idx) => {
      const meta = oseMeta[idx];
      const pvA = r.pvs[0] || null;
      const pvB = r.pvs[r.pvs.length - 1] || null;
      const trecho = (pvA && pvB) ? (pvA.id + ' -> ' + pvB.id) : (pvA ? pvA.id : '');

      const Lm = r.mapa_L  != null ? r.mapa_L  : null;
      const Lp = r.excel_L != null ? r.excel_L : null;
      const Lf = r.perfil_L != null ? r.perfil_L : null;
      const Im = r.mapa_i  != null ? r.mapa_i  : null;
      const Ip = r.excel_i != null ? r.excel_i : null;
      const If = r.perfil_i != null ? r.perfil_i : null;

      const dLmp = (Lm != null && Lp != null) ? Math.abs(Lm - Lp) : null;
      const dLmf = (Lm != null && Lf != null) ? Math.abs(Lm - Lf) : null;
      const dImp = (Im != null && Ip != null) ? Math.abs(Im - Ip) : null;
      const dImf = (Im != null && If != null) ? Math.abs(Im - If) : null;

      const status = meta.status;
      const fill = meta.fill === 'red' ? RED_FILL : meta.fill === 'yellow' ? YELLOW_FILL : GREEN_FILL;

      const row = wsT.addRow([
        'OSE-' + r.ose, trecho,
        Lm, Lp, Lf, dLmp, dLmf,
        Im, Ip, If, dImp, dImf,
        status, meta.avisos,
      ]);
      row.fill = fill;
      row.font = { size: 10 };
      row.getCell(1).font = { bold: true, size: 10, name: MONO };
      row.getCell(2).font = { size: 10, name: MONO };
      [3,4,5,6,7].forEach(c => { row.getCell(c).numFmt = '0.000'; row.getCell(c).alignment = { horizontal: 'right' }; });
      [8,9,10,11,12].forEach(c => { row.getCell(c).numFmt = '0.00000'; row.getCell(c).alignment = { horizontal: 'right' }; });
      row.getCell(13).alignment = { horizontal: 'center' };
      row.getCell(13).font = { bold: true, size: 9 };
      row.getCell(14).alignment = { horizontal: 'left', wrapText: true };
      row.getCell(14).font = { size: 9 };
    });

    wsT.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
    wsT.autoFilter = { from: 'A1', to: 'N1' };
  }

  // ============================================================
  // ABA POR OSE — só info dos PVs (CT/CF/h)
  // ============================================================
  function rnd(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }
  const abs2 = (a, b, d) => (a == null || b == null) ? null : rnd(Math.abs(a - b), d != null ? d : 4);

  data.forEach(r => {
    if (!r.pvs.length) return;
    const sheetName = 'OSE-' + r.ose;
    const ws2 = wb.addWorksheet(sheetName);

    setColWidths(ws2, [
      14,
      12, 11, 11, 13, 13,           // CT (5)
      13, 13, 11, 13, 13, 11, 13, 13, // CF (8)
      12, 11, 11, 11, 13, 13,       // Prof (6)
    ]);

    const Lm = r.mapa_L  != null ? r.mapa_L.toFixed(2)  + ' m' : '—';
    const Lp = r.excel_L != null ? r.excel_L.toFixed(2) + ' m' : '—';
    const Lf = r.perfil_L != null ? r.perfil_L.toFixed(2) + ' m' : '—';
    const dLmp = (r.mapa_L != null && r.excel_L != null) ? Math.abs(r.mapa_L - r.excel_L).toFixed(3) + ' m' : '—';
    const dLmf = (r.mapa_L != null && r.perfil_L != null) ? Math.abs(r.mapa_L - r.perfil_L).toFixed(3) + ' m' : '—';
    const Im = r.mapa_i  != null ? r.mapa_i.toFixed(5)  : '—';
    const Ip = r.excel_i != null ? r.excel_i.toFixed(5) : '—';
    const If = r.perfil_i != null ? r.perfil_i.toFixed(5) : '—';
    const dImp = (r.mapa_i != null && r.excel_i != null) ? Math.abs(r.mapa_i - r.excel_i).toFixed(5) : '—';
    const dImf = (r.mapa_i != null && r.perfil_i != null) ? Math.abs(r.mapa_i - r.perfil_i).toFixed(5) : '—';

    const titleRow1 = ws2.addRow([
      'OSE-' + r.ose,
      'L Mapa: ' + Lm, 'L Planilha: ' + Lp, 'L Perfil: ' + Lf,
      'Dif. L M-P: ' + dLmp, 'Dif. L M-Pf: ' + dLmf,
      '', '', '', '', '', '', '', '',
      '', '', '', '', '', '',
    ]);
    applyHeader(titleRow1, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }, { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 });

    const titleRow2 = ws2.addRow([
      '',
      'i Mapa: ' + Im, 'i Planilha: ' + Ip, 'i Perfil: ' + If,
      'Dif. i M-P: ' + dImp, 'Dif. i M-Pf: ' + dImf,
      '', '', '', '', '', '', '', '',
      '', '', '', '', '', '',
    ]);
    applyHeader(titleRow2, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }, { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 });

    const grpHdr = ws2.addRow([
      'PV/TL',
      'COTA DE TOPO (CT)', '', '', '', '',
      'COTA DE FUNDO (CF) — GI do Tubo', '', '', '', '', '', '', '',
      'PROFUNDIDADE (h)', '', '', '', '', '',
    ]);
    grpHdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    grpHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    grpHdr.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.mergeCells('B3:F3');
    ws2.mergeCells('G3:N3');
    ws2.mergeCells('O3:T3');

    const subHdr = ws2.addRow([
      '',
      'Planilha', 'Mapa', 'Perfil', 'Dif. Plan.-Mapa', 'Dif. Plan.-Perfil',
      'Chegada Plan.', 'Fundo PV Plan.', 'Mapa', 'Chegada Perfil', 'Saída Perfil', 'T.Q. (m) Plan.', 'Dif. Plan.-Mapa', 'Dif. Plan.-Perfil',
      'Chegada Plan.', 'Fundo PV Plan.', 'Mapa', 'Perfil', 'Dif. Plan.-Mapa', 'Dif. Plan.-Perfil',
    ]);
    applyHeader(subHdr, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }, HDR_FONT);

    r.pvs.forEach(pv => {
      const mapa_h = pv.mapa_h != null ? pv.mapa_h : null;
      const diff_h_plan_mapa = abs2(pv.excel_prof_pv, mapa_h, 3);
      const diff_h_plan_perf = abs2(pv.excel_prof_pv, pv.perf_h, 3);
      const ctErrMapa = pv.diff_ct      !== null && pv.diff_ct      > CT_TOL;
      const cfErrMapa = pv.diff_cf      !== null && pv.diff_cf      > CF_TOL;
      const ctErrPerf = pv.diff_ct_perf !== null && pv.diff_ct_perf > CT_TOL;
      const cfErrPerf = pv.diff_cf_perf !== null && pv.diff_cf_perf > CF_TOL;
      const pvErr = ctErrMapa || cfErrMapa || ctErrPerf || cfErrPerf;
      const tlBadH = tlShouldBePv(pv);
      const idLabel = tlBadH != null ? (pv.id + ' <- deve ser PV') : pv.id;

      const row = ws2.addRow([
        idLabel,
        pv.excel_ct          != null ? pv.excel_ct          : null,
        pv.mapa_ct           != null ? pv.mapa_ct           : null,
        pv.perf_ct           != null ? pv.perf_ct           : null,
        pv.diff_ct           != null ? pv.diff_ct           : null,
        pv.diff_ct_perf      != null ? pv.diff_ct_perf      : null,
        pv.excel_cf_chegada  != null ? pv.excel_cf_chegada  : null,
        pv.excel_cf_pv       != null ? pv.excel_cf_pv       : null,
        pv.mapa_cf           != null ? pv.mapa_cf           : null,
        pv.perf_cf_chegada   != null ? pv.perf_cf_chegada   : null,
        pv.perf_cf_saida     != null ? pv.perf_cf_saida     : null,
        pv.excel_tq          != null ? pv.excel_tq          : null,
        pv.diff_cf           != null ? pv.diff_cf           : null,
        pv.diff_cf_perf      != null ? pv.diff_cf_perf      : null,
        pv.excel_prof_chegada!= null ? pv.excel_prof_chegada: null,
        pv.excel_prof_pv     != null ? pv.excel_prof_pv     : null,
        mapa_h,
        pv.perf_h            != null ? pv.perf_h            : null,
        diff_h_plan_mapa,
        diff_h_plan_perf,
      ]);
      row.fill = (pvErr || tlBadH != null) ? RED_FILL : (pv.excel_has_tq ? YELLOW_FILL : GREEN_FILL);
      row.font = { size: 10 };
      row.getCell(1).font = { bold: true, size: 10, name: MONO };
      for (let c = 2; c <= 20; c++) {
        row.getCell(c).numFmt = '0.000';
        row.getCell(c).alignment = { horizontal: 'right' };
      }
    });

    ws2.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
  });

  // ============================================================
  // ABA CRUZAMENTO — PVs compartilhados entre OSEs
  // ============================================================
  {
    const alertas = crossCheckPVs(data);
    if (alertas.length) {
      const wsC = wb.addWorksheet('Cruzamento');
      setColWidths(wsC, [10, 14, 12, 12, 14, 14, 14, 14, 14, 36]);

      // Título
      const titleRow = wsC.addRow(['CRUZAMENTO ENTRE OSEs — PVs COMPARTILHADOS']);
      wsC.mergeCells('A1:J1');
      titleRow.getCell(1).fill = HDR_FILL;
      titleRow.getCell(1).font = { ...HDR_FONT, size: 12 };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;

      const legendRow = wsC.addRow([
        'ERRO = CT ou Profundidade diverge entre OSEs no mesmo PV.  ' +
        'ALERTA = só CF diverge (possível degrau / tubo de queda).'
      ]);
      wsC.mergeCells('A2:J2');
      legendRow.getCell(1).fill = YELLOW_FILL;
      legendRow.getCell(1).font = { size: 9, italic: true };
      legendRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      legendRow.height = 24;

      const hdr = wsC.addRow([
        'Tipo', 'PV', 'OSE', 'Papel', 'CT', 'CF', 'Prof.', 'ΔCF', 'ΔProf.', 'Motivo',
      ]);
      applyHeader(hdr, HDR_FILL, HDR_FONT);
      hdr.height = 22;

      for (const al of alertas) {
        const isErr = al.tipo === 'erro';
        const fill = isErr ? RED_FILL : YELLOW_FILL;
        let first = true;
        for (const e of al.oses) {
          const row = wsC.addRow([
            first ? (isErr ? 'ERRO' : 'ALERTA') : '',
            first ? al.pv : '',
            'OSE-' + e.ose,
            e.papel === 'inicial' ? 'Inicial' : 'Final',
            e.ct, e.cf, e.prof,
            first ? al.delta_cf : null,
            first ? al.delta_prof : null,
            first ? al.motivo : '',
          ]);
          row.fill = fill;
          row.font = { size: 10 };
          if (first) {
            row.getCell(1).font = { bold: true, size: 10, color: { argb: isErr ? 'FF8B0000' : 'FF7A4F00' } };
            row.getCell(2).font = { bold: true, size: 10 };
          }
          [5,6,7,8,9].forEach(c => {
            row.getCell(c).numFmt = '0.000';
            row.getCell(c).alignment = { horizontal: 'right' };
          });
          row.getCell(10).alignment = { wrapText: true };
          first = false;
        }
        // Espaço entre grupos
        wsC.addRow([]);
      }

      wsC.views = [{ state: 'frozen', ySplit: 3, xSplit: 0 }];
    }
  }

  return wb;
}

module.exports = { buildOseWorkbook };
