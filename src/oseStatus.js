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
//   L_TOL  = 0.10 m   (apertado — antes 0.5m mascarava divergências tipo 49,31 vs 49,21)
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
  L:  0.10,
  I:  0.005,
};

const H_MIN            = 1.10;
const TL_MAX_H         = 1.30;
const DECL_MIN_SHALLOW = 0.01;    // h ≤ 3m
const DECL_MIN_DEEP    = 0.0055;  // h > 3m
const DECL_DEPTH_LIMIT = 3.0;

function isTL(id) {
  return typeof id === 'string' && id.trim().toUpperCase().startsWith('TL');
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

  // Extensão L
  const Lm = r.mapa_L, Lp = r.excel_L, Lf = r.perfil_L;
  if (Lm != null && Lp != null && Math.abs(Lm - Lp) > TOL.L) {
    errors.push('L: ' + fmt(Lm, 2) + ' vs ' + fmt(Lp, 2) + ' (Mapa-Plan)');
  }
  if (Lm != null && Lf != null && Math.abs(Lm - Lf) > TOL.L) {
    errors.push('L: ' + fmt(Lm, 2) + ' vs ' + fmt(Lf, 2) + ' (Mapa-Perfil)');
  }

  // Declividade i
  const Im = r.mapa_i, Ip = r.excel_i, If = r.perfil_i;
  if (Im != null && Ip != null && Math.abs(Im - Ip) > TOL.I) {
    errors.push('i: ' + fmt(Im, 5) + ' vs ' + fmt(Ip, 5) + ' (Mapa-Plan)');
  }
  if (Im != null && If != null && Math.abs(Im - If) > TOL.I) {
    errors.push('i: ' + fmt(Im, 5) + ' vs ' + fmt(If, 5) + ' (Mapa-Perfil)');
  }

  // Por PV
  let hasTQ = false, hasTLbad = false, hasShallow = false, hasDeepTL = false;
  for (const pv of (r.pvs || [])) {
    // CT
    if (pv.diff_ct != null && pv.diff_ct > TOL.CT) {
      errors.push('CT divergente em ' + pv.id + ' (' + fmt(pv.excel_ct, 3) + ' vs ' + fmt(pv.mapa_ct, 3) + ' Mapa)');
    }
    if (pv.diff_ct_perf != null && pv.diff_ct_perf > TOL.CT) {
      errors.push('CT divergente em ' + pv.id + ' (' + fmt(pv.excel_ct, 3) + ' vs ' + fmt(pv.perf_ct, 3) + ' Perfil)');
    }
    // CF (compara fundo do PV)
    if (pv.diff_cf != null && pv.diff_cf > TOL.CF) {
      errors.push('CF divergente em ' + pv.id + ' (' + fmt(pv.excel_cf_pv, 3) + ' vs ' + fmt(pv.mapa_cf, 3) + ' Mapa)');
    }
    if (pv.diff_cf_perf != null && pv.diff_cf_perf > TOL.CF) {
      errors.push('CF divergente em ' + pv.id + ' (' + fmt(pv.excel_cf_pv, 3) + ' vs ' + fmt(pv.perf_cf, 3) + ' Perfil)');
    }
    // h (profundidade) — só compara contra mapa (perfil h ainda não confiável)
    if (pv.diff_h != null && pv.diff_h > TOL.H) {
      errors.push('h divergente em ' + pv.id + ' (' + fmt(pv.excel_prof_pv, 3) + ' vs ' + fmt(pv.mapa_h, 3) + ' Mapa)');
    }

    // Profundidade mínima (qualquer PV/TL) — regra nova
    const hPv = maxProf(pv);
    if (hPv != null && hPv < H_MIN) {
      hasShallow = true;
      errors.push(pv.id + ' raso (h=' + hPv.toFixed(3) + 'm < ' + H_MIN.toFixed(2) + 'm mínimo)');
    }

    // T.Q.
    if (pv.excel_has_tq) {
      hasTQ = true;
      warnings.push('T.Q. ' + pv.id + ' (' + (pv.excel_tq != null ? pv.excel_tq.toFixed(3) : '?') + 'm)');
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
  // Epsilon de 5e-5 absorve ruído de arredondamento (1,000% arredonda para 1,00%).
  const iCheck = r.excel_i != null ? r.excel_i : r.mapa_i;
  const maxH   = maxProfOse(r);
  const DECL_EPS = 5e-5;
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
  isTL, tlShouldBePv, maxProf, maxProfOse,
  H_MIN, TL_MAX_H, DECL_MIN_SHALLOW, DECL_MIN_DEEP, DECL_DEPTH_LIMIT,
};
