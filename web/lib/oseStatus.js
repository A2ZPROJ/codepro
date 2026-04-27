// oseStatus.js — Lógica única de classificação de OSE.
// Usado por exportOse.js (Excel) e pelo renderer (UI), via preload.
//
// Recebe um objeto OSE (resultado do buildComparison em parseOse.js)
// e devolve { status, fill, errors, warnings, avisos, hasErr, hasTQ, hasTLbad }.
//
// Tolerâncias canônicas (alinhadas com o padrão do Excel/relatório):
//   CT_TOL = 0.05 m
//   CF_TOL = 0.05 m
//   H_TOL  = 0.05 m
//   L_TOL  = 0.01 m (1 cm — tolerância na segunda casa decimal)
//   I_TOL  = 0.005 (m/m)
//
// Regras adicionais (além das tolerâncias):
//   H_MIN      = 1.10 m   — qualquer PV/TL com profundidade menor é ERRO
//   TL_MAX_H   = 1.30 m   — TL acima disso deve ser PV (ERRO, antes era aviso)
//   DECL_MIN_SHALLOW = 0.01   (1%)    — OSE com max h ≤ 3m exige i ≥ 1%
//   DECL_MIN_DEEP    = 0.0055 (0,55%) — OSE com max h > 3m pode ter i < 1%, mas ≥ 0,55%
'use strict';

const TOL = {
  CT: 0.05,
  CF: 0.05,
  H:  0.05,
  L:  0.01,
  I:  0.005,
  TQ: 0.02,  // degrau / tubo de queda (2 cm)
};

const H_MIN            = 1.10;
const TL_MAX_H         = 1.30;
const DECL_MIN_SHALLOW = 0.01;    // h ≤ 3m
const DECL_MIN_DEEP    = 0.0055;  // h > 3m
const DECL_DEPTH_LIMIT = 3.0;

function isTL(id) {
  return typeof id === 'string' && id.trim().toUpperCase().startsWith('TL');
}

// PV existente (levantado em campo) — h e CT imutáveis, fora das regras de
// profundidade mínima do projeto. Casa "PV-EX-###" e também "PV-EXIST-###".
function isExistingPv(id) {
  if (typeof id !== 'string') return false;
  return /^PV-EX/i.test(id.trim()) || /^PV-INT/i.test(id.trim());
}

function maxProf(pv) {
  const vals = [pv.excel_prof_pv, pv.excel_prof_chegada, pv.mapa_h, pv.perf_h]
    .filter(v => v != null && !isNaN(v));
  return vals.length ? Math.max(...vals) : null;
}

function tlShouldBePv(pv) {
  if (!isTL(pv.id)) return null;
  const h = maxProf(pv);
  if (h != null && h > TL_MAX_H) return h;
  return null;
}

// Profundidade máxima observada entre todos os PVs/TLs da OSE.
function maxProfOse(r) {
  let m = null;
  for (const pv of (r.pvs || [])) {
    const h = maxProf(pv);
    if (h != null && (m == null || h > m)) m = h;
  }
  return m;
}

function fmt(v, d) {
  if (v == null || isNaN(v)) return '?';
  return Number(v).toFixed(d);
}

function classifyOse(r) {
  const errors  = [];   // erros (vermelho)
  const warnings = [];  // flags (amarelo)

  // Presença
  if (!r.in_mapa)   errors.push('ausente no Mapa');
  if (!r.in_perfil) errors.push('ausente no Perfil');
  if (!r.in_excel)  errors.push('ausente na Planilha');

  // Helper: mensagem no formato "X em REF (Planilha=A · Mapa=B · Perfil=C)"
  // Inclui sempre as 3 fontes — a ausente vira "—". Assim o engenheiro sabe
  // exatamente de onde veio cada número e pode ir direto conferir a fonte.
  function divergMsg(label, ref, unit, dec, sources) {
    const parts = sources.map(s => s.name + '=' +
      (s.v == null ? '—' : fmt(s.v, dec) + (unit || '')));
    return label + ' divergente em ' + ref + ' (' + parts.join(' · ') + ')';
  }

  // Extensão L — tolerância de 1 cm (0.01 m), com pequeno epsilon para absorver arredondamento.
  const Lm = r.mapa_L, Lp = r.excel_L, Lf = r.perfil_L;
  const L_EPS = 5e-5;
  const L_DIV = [
    Lm != null && Lp != null && Math.abs(Lm - Lp) > TOL.L + L_EPS,
    Lm != null && Lf != null && Math.abs(Lm - Lf) > TOL.L + L_EPS,
    Lp != null && Lf != null && Math.abs(Lp - Lf) > TOL.L + L_EPS,
  ].some(Boolean);
  if (L_DIV) {
    errors.push(divergMsg('L', 'OSE', 'm', 3, [
      { name: 'Planilha', v: Lp },
      { name: 'Mapa',     v: Lm },
      { name: 'Perfil',   v: Lf },
    ]));
  }

  // Declividade i
  const Im = r.mapa_i, Ip = r.excel_i, If = r.perfil_i;
  const I_DIV = [
    Im != null && Ip != null && Math.abs(Im - Ip) > TOL.I,
    Im != null && If != null && Math.abs(Im - If) > TOL.I,
    Ip != null && If != null && Math.abs(Ip - If) > TOL.I,
  ].some(Boolean);
  if (I_DIV) {
    errors.push(divergMsg('i', 'OSE', '', 5, [
      { name: 'Planilha', v: Ip },
      { name: 'Mapa',     v: Im },
      { name: 'Perfil',   v: If },
    ]));
  }

  // Por PV
  let hasTQ = false, hasTLbad = false, hasShallow = false, hasDeepTL = false;
  for (const pv of (r.pvs || [])) {
    // CT — compara as 3 fontes juntas
    const ctDiv = [
      pv.diff_ct != null && pv.diff_ct > TOL.CT,
      pv.diff_ct_perf != null && pv.diff_ct_perf > TOL.CT,
    ].some(Boolean);
    if (ctDiv) {
      errors.push(divergMsg('CT', pv.id, '', 3, [
        { name: 'Planilha', v: pv.excel_ct },
        { name: 'Mapa',     v: pv.mapa_ct },
        { name: 'Perfil',   v: pv.perf_ct },
      ]));
    }
    // CF — compara fundo do PV (excel_cf_pv) contra mapa_cf e perf_cf
    const cfDiv = [
      pv.diff_cf != null && pv.diff_cf > TOL.CF,
      pv.diff_cf_perf != null && pv.diff_cf_perf > TOL.CF,
    ].some(Boolean);
    if (cfDiv) {
      errors.push(divergMsg('CF', pv.id, '', 3, [
        { name: 'Planilha', v: pv.excel_cf_pv },
        { name: 'Mapa',     v: pv.mapa_cf },
        { name: 'Perfil',   v: pv.perf_cf },
      ]));
    }
    // h (profundidade)
    const hDiv = [
      pv.diff_h != null && pv.diff_h > TOL.H,
      pv.diff_h_perf != null && pv.diff_h_perf > TOL.H,
    ].some(Boolean);
    if (hDiv) {
      errors.push(divergMsg('h', pv.id, 'm', 3, [
        { name: 'Planilha', v: pv.excel_prof_pv },
        { name: 'Mapa',     v: pv.mapa_h },
        { name: 'Perfil',   v: pv.perf_h },
      ]));
    }

    // Profundidade mínima (qualquer PV/TL) — regra nova.
    // PVs existentes / de interligação (PV-EX-###, PV-INT-###) ficam fora
    // da regra — são levantamentos de campo, h é imutável, não é erro.
    const hPv = maxProf(pv);
    if (hPv != null && hPv < H_MIN && !isExistingPv(pv.id)) {
      hasShallow = true;
      errors.push(pv.id + ' raso (h=' + hPv.toFixed(3) + 'm < ' + H_MIN.toFixed(2) + 'm mínimo)');
    }

    // T.Q.
    if (pv.excel_has_tq) {
      hasTQ = true;
      warnings.push('T.Q. ' + pv.id + ' (' + (pv.excel_tq != null ? pv.excel_tq.toFixed(3) : '?') + 'm)');
    }
    // T.Q. calculado (via perfil) vs planilha
    if (pv.diff_tq != null && pv.diff_tq > TOL.TQ) {
      errors.push('T.Q. ' + pv.id + ' divergente: planilha=' + fmt(pv.excel_tq, 3) + 'm, calculado=' + fmt(pv.tq_calc, 3) + 'm (Δ=' + fmt(pv.diff_tq, 3) + 'm)');
    }
    // Degrau declarado na obs vs delta CF real (pega copy-paste de obs antiga).
    if (pv.diff_degrau_decl != null && pv.diff_degrau_decl > TOL.TQ) {
      const cfDelta = (pv.excel_cf_chegada != null && pv.excel_cf_pv != null)
                        ? (pv.excel_cf_chegada - pv.excel_cf_pv) : null;
      errors.push('Degrau declarado em ' + pv.id + ' (' + fmt(pv.excel_tq_decl, 3) + 'm) não bate com ΔCF da planilha (' + fmt(cfDelta, 3) + 'm)');
    }
    // TL deve ser PV (h > 1,30) → agora é ERRO
    const tlH = tlShouldBePv(pv);
    if (tlH != null) {
      hasTLbad = true;
      hasDeepTL = true;
      errors.push(pv.id + ' deve ser PV (h=' + tlH.toFixed(3) + 'm > ' + TL_MAX_H.toFixed(2) + 'm)');
    }
  }

  // Declividade mínima por profundidade da OSE (regra nova)
  // Usa a declividade da planilha (canônica); se ausente, cai para mapa.
  // Epsilon de 5e-4 (0,05pp) absorve arredondamento ao exibir 2 casas
  // decimais: uma OSE com i real = 0,0099 (planilha/mapa exibem "0,99%")
  // não deve virar ERRO quando o engenheiro claramente dimensionou pra 1%.
  // Continua flagrando declividades genuinamente baixas (≤ ~0,95%).
  const iCheck = r.excel_i != null ? r.excel_i : r.mapa_i;
  const maxH   = maxProfOse(r);
  const DECL_EPS = 5e-4;
  if (iCheck != null && maxH != null) {
    if (maxH <= DECL_DEPTH_LIMIT) {
      if (iCheck < DECL_MIN_SHALLOW - DECL_EPS) {
        errors.push('i=' + (iCheck * 100).toFixed(2) + '% < 1,00% (h máx=' + maxH.toFixed(2) + 'm ≤ 3m)');
      }
    } else {
      if (iCheck < DECL_MIN_DEEP - DECL_EPS) {
        errors.push('i=' + (iCheck * 100).toFixed(2) + '% < 0,55% (h máx=' + maxH.toFixed(2) + 'm > 3m)');
      }
    }
  }

  const hasErr = errors.length > 0;

  // Status final
  const flags = [];
  if (hasErr)   flags.push('ERRO');
  if (!hasErr && hasTQ) flags.push('T.Q.');
  if (!flags.length) flags.push('OK');
  const status = flags.join('/');

  // Avisos: erros + warnings, separados por ';'
  const avisos = errors.concat(warnings).join('; ');

  // Cor de fill
  let fill = 'green';
  if (hasErr) fill = 'red';
  else if (hasTLbad || hasTQ) fill = 'yellow';

  return { status, fill, errors, warnings, avisos, hasErr, hasTQ, hasTLbad };
}

/**
 * crossCheckPVs — Cruzamento entre OSEs.
 * Detecta PVs compartilhados entre OSEs e verifica:
 *  - CT deve ser igual (mesmo PV, mesmo terreno)
 *  - Profundidade deve ser igual (mesmo poço, mesma profundidade)
 *  - CF pode ser diferente (degrau / tubo de queda) → alerta
 *
 * @param {Array} data  — array de resultados (buildComparison output)
 * @returns {Array} alertas — [{ pv, oses, delta_ct, delta_cf, delta_prof, tipo, motivo }]
 */
function crossCheckPVs(data) {
  // pv_norm → [{ ose, papel, ct, cf, prof }]
  const pvMap = {};

  for (const r of data) {
    if (!r.pvs || !r.pvs.length) continue;
    const first = r.pvs[0];
    const last  = r.pvs[r.pvs.length - 1];
    for (const [papel, pv] of [['inicial', first], ['final', last]]) {
      if (!pv || !pv.id) continue;
      const norm = pv.id.trim().replace(/[\s\-]+/g, '').toUpperCase()
        .replace(/([A-Z]+)0*(\d+)$/, (_, p, n) => p + parseInt(n, 10));
      if (!pvMap[norm]) pvMap[norm] = [];
      pvMap[norm].push({
        ose: r.ose,
        papel,
        ct:   pv.excel_ct      != null ? pv.excel_ct      : null,
        cf:   pv.excel_cf_pv   != null ? pv.excel_cf_pv   : null,
        prof: pv.excel_prof_pv != null ? pv.excel_prof_pv : null,
      });
    }
  }

  const alertas = [];
  for (const [pv, entradas] of Object.entries(pvMap)) {
    if (entradas.length < 2) continue;

    const cts   = entradas.map(e => e.ct).filter(v => v != null);
    const cfs   = entradas.map(e => e.cf).filter(v => v != null);
    const profs = entradas.map(e => e.prof).filter(v => v != null);

    const delta_ct   = cts.length   >= 2 ? Math.max(...cts)   - Math.min(...cts)   : 0;
    const delta_cf   = cfs.length   >= 2 ? Math.max(...cfs)   - Math.min(...cfs)   : 0;
    const delta_prof = profs.length >= 2 ? Math.max(...profs) - Math.min(...profs) : 0;

    const erros = [];
    if (delta_ct   > TOL.CT) erros.push('CT diverge entre OSEs');
    if (delta_prof > TOL.H)  erros.push('Profundidade diverge entre OSEs');

    if (erros.length) {
      alertas.push({
        pv, oses: entradas,
        delta_ct:   Math.round(delta_ct   * 1000) / 1000,
        delta_cf:   Math.round(delta_cf   * 1000) / 1000,
        delta_prof: Math.round(delta_prof * 1000) / 1000,
        tipo: 'erro',
        motivo: erros.join(' | '),
      });
    } else if (delta_cf > TOL.CF) {
      alertas.push({
        pv, oses: entradas,
        delta_ct:   Math.round(delta_ct   * 1000) / 1000,
        delta_cf:   Math.round(delta_cf   * 1000) / 1000,
        delta_prof: Math.round(delta_prof * 1000) / 1000,
        tipo: 'alerta',
        motivo: 'CF diferente — possível degrau / tubo de queda',
      });
    }
  }
  return alertas;
}

module.exports = {
  classifyOse, crossCheckPVs, TOL,
  isTL, isExistingPv, tlShouldBePv, maxProf, maxProfOse,
  H_MIN, TL_MAX_H, DECL_MIN_SHALLOW, DECL_MIN_DEEP, DECL_DEPTH_LIMIT,
};
