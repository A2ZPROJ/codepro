// oseStatus.js — Lógica única de classificação de OSE.
// Usado por exportOse.js (Excel) e pelo renderer (UI), via preload.
//
// Recebe um objeto OSE (resultado do buildComparison em parseOse.js)
// e devolve { status, fill, errors, warnings, avisos, hasErr, hasTQ, hasTLbad }.
//
// Tolerâncias canônicas (alinhadas com o padrão do Excel/relatório):
//   CT_TOL = 0.05 m
//   CF_TOL = 0.01 m (1 cm — alinhado com oseDeepCheck; cota de fundo é exata)
//   H_TOL  = 0.05 m
//   L_TOL  = 0.01 m (1 cm — tolerância na segunda casa decimal)
//   I_TOL  = 0.005 (m/m)
//
// Regras por tipo de obra (selecionável via ctx.tipoObra ou auto-detect):
//   MND (Método Não Destrutivo)
//     - L máx trecho:    80 m (folga +5m)
//     - i mín shallow (h ≤ 3m):  1,00%
//     - i mín deep    (h > 3m):  0,29%
//   VCA (Vala Comum Aberta)
//     - L máx trecho:   100 m (folga +5m)
//     - i mín:          0,29% em qualquer profundidade
//   H_MIN     = 1.10 m   (ambos)  — qualquer PV/TL com h menor é ERRO
//   TL_MAX_H  = 1.30 m   (ambos)  — TL acima disso deve ser PV (ERRO)
'use strict';

const TOL = {
  CT: 0.05,
  CF: 0.01,
  H:  0.05,
  L:  0.01,
  I:  0.005,
  TQ: 0.02,  // degrau / tubo de queda (2 cm)
};

const H_MIN            = 1.10;       // piso absoluto — mantido como fallback
const TL_MAX_H         = 1.30;
// Tolerância de 5 mm absorve ruído de arredondamento (h=1.0996m exibido como
// "1.100m" não deve virar erro — ainda flagra rasos genuínos como 1.044m).
const H_EPS            = 0.005;
const DECL_DEPTH_LIMIT = 3.0;

// Profundidade mínima por DN — regra Lucas A2Z 2026-05-23:
//   h_min(DN) = max(1,10 ; 0,95 + DN/1000)
// O recobrimento mínimo (terra sobre o topo do tubo) é 0,95m. Como h é medido
// até o FUNDO do tubo, h_min cresce com o DN:
//   DN 150 → 1,10m | DN 200 → 1,15m | DN 300 → 1,25m | DN 400 → 1,35m
// Sem DN disponível, usa o piso de 1,10m.
function minHForDn(dn) {
  if (dn == null || isNaN(dn)) return H_MIN;
  return Math.max(H_MIN, 0.95 + dn / 1000);
}

// DN mínimo de coletor sanitário (SANEPAR / ABNT): 150mm.
// Tubos abaixo disso só são aceitos como ramais prediais, não rede coletora.
const DN_MIN_COLETOR   = 150;
// Regras por tipo de obra. Folga de 5m na distância para absorver
// arredondamento de medição/locação.
const DIST_FOLGA       = 5;
const RULES = {
  mnd: {
    distMax:         80,
    distMaxTol:      80 + DIST_FOLGA,
    declMinShallow:  0.01,    // 1% para h ≤ 3m
    declMinDeep:     0.0029,  // 0,29% para h > 3m
    label:           'MND',
  },
  vca: {
    distMax:        100,
    distMaxTol:     100 + DIST_FOLGA,
    declMinShallow: 0.0029,   // 0,29% qualquer profundidade
    declMinDeep:    0.0029,
    label:          'VCA',
  },
};

// Resolve o tipo de obra efetivo para esta OSE.
// Prioridade: ctx.tipoObra explícito ('vca'|'mnd') > auto (per-OSE: PIT→MND,
// estaca→VCA) > ctx.tipoObraAuto (auto detectado do dataset/filename) > 'mnd'
// como fallback (preserva comportamento anterior).
function resolveTipoObra(r, ctx) {
  const explicit = ctx && ctx.tipoObra;
  if (explicit === 'vca' || explicit === 'mnd') return explicit;
  if (r) {
    if (r.has_pit)    return 'mnd';
    if (r.has_estaca) return 'vca';
  }
  const auto = ctx && ctx.tipoObraAuto;
  if (auto === 'vca' || auto === 'mnd') return auto;
  return 'mnd';
}

// Constantes legadas — preservadas para compat com módulos que ainda importam
// (Planilhas GIS lê estas via index.html duplicado). Reflete o default MND.
const DECL_MIN_SHALLOW = RULES.mnd.declMinShallow;
const DECL_MIN_DEEP    = RULES.mnd.declMinDeep;

function isTL(id) {
  return typeof id === 'string' && id.trim().toUpperCase().startsWith('TL');
}

// PV existente (levantado em campo) — h e CT imutáveis, fora das regras de
// profundidade mínima do projeto. Casa "PV-EX-###", "PV-EXIST-###" e também
// "PV-EXISTENTE" (sem número). Tolera a forma normalizada sem traço/espaço
// (normalizeId vira "PVEXISTENTE"/"PVEX1"/"PVINT5") removendo separadores antes.
function isExistingPv(id) {
  if (typeof id !== 'string') return false;
  const s = id.trim().replace(/[\s\-]+/g, '').toUpperCase();
  return /^PV(EX|INT)/.test(s);
}

function maxProf(pv) {
  const vals = [pv.excel_prof_pv, pv.excel_prof_chegada, pv.mapa_h, pv.perf_h]
    .filter(v => v != null && !isNaN(v));
  return vals.length ? Math.max(...vals) : null;
}

// TL co-locado com um PV (mesma cota de topo E de fundo) = terminal de limpeza
// junto do PV de cabeceira. O PV já cumpre o requisito de profundidade, então
// NÃO se acusa o TL (evita falso "deve ser PV" quando o PV já existe no ponto).
function hasColocatedPv(tl, nodes) {
  if (!Array.isArray(nodes)) return false;
  const ct = tl.excel_ct, cf = tl.excel_cf_pv;
  if (ct == null && cf == null) return false;
  for (const n of nodes) {
    if (n === tl || !n || typeof n.id !== 'string') continue;
    if (isTL(n.id) || !/^PV/i.test(n.id.trim())) continue;
    const sameCf = cf != null && n.excel_cf_pv != null && Math.abs(n.excel_cf_pv - cf) <= 0.01;
    const sameCt = ct != null && n.excel_ct    != null && Math.abs(n.excel_ct    - ct) <= 0.01;
    if (sameCf && sameCt) return true;
  }
  return false;
}

function tlShouldBePv(pv, nodes) {
  if (!isTL(pv.id)) return null;
  const h = maxProf(pv);
  if (h == null || h <= TL_MAX_H + H_EPS) return null;
  if (hasColocatedPv(pv, nodes)) return null;   // PV co-locado já cumpre o papel
  return h;
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

function classifyOse(r, ctx) {
  const errors  = [];   // erros (vermelho)
  const warnings = [];  // flags (amarelo)
  const tipo    = resolveTipoObra(r, ctx);
  const rules   = RULES[tipo];

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

  // Declividade i — compara o MÓDULO arredondado à 4ª casa decimal.
  // Por quê: (1) a 5ª casa em diante é ruído de arredondamento entre as fontes e
  // NÃO deve acusar divergência — se planilha/perfil/mapa batem até a 4ª casa,
  // está OK; (2) o mapa às vezes traz o SINAL da declividade enquanto a planilha/
  // perfil trazem só o módulo — comparar |i| evita o falso "i divergente" nesse
  // caso (o sentido do fluxo já é checado pelos testes de contra-declive).
  const r4i = (x) => (x == null ? null : Math.round(Math.abs(x) * 1e4) / 1e4);
  const Im = r.mapa_i, Ip = r.excel_i, If = r.perfil_i;
  const Ima = r4i(Im), Ipa = r4i(Ip), Ifa = r4i(If);
  const I_DIV = [
    Ima != null && Ipa != null && Math.abs(Ima - Ipa) > TOL.I,
    Ima != null && Ifa != null && Math.abs(Ima - Ifa) > TOL.I,
    Ipa != null && Ifa != null && Math.abs(Ipa - Ifa) > TOL.I,
  ].some(Boolean);
  if (I_DIV) {
    errors.push(divergMsg('i', 'OSE', '', 4, [
      { name: 'Planilha', v: Ip },
      { name: 'Mapa',     v: Im },
      { name: 'Perfil',   v: If },
    ]));
  }

  // Por PV
  let hasTQ = false, hasTLbad = false, hasShallow = false, hasDeepTL = false;
  for (const pv of (r.pvs || [])) {
    // Presença individual do PV em cada fonte. Bug típico: PV adicionado na
    // planilha mas não desenhado no mapa/perfil (ou vice-versa). O Nexus
    // antigo só flagrava OSE inteira ausente; agora flagra POR PV.
    // Em layouts onde o perfil não foi extraído na OSE inteira, esse check
    // viraria ruído — só dispara quando ALGUM PV da OSE tem dado no perfil,
    // sinalizando que o perfil foi parseado mas esse PV específico falta.
    const anyPvHasPerf = (r.pvs || []).some(p => p.in_pv_perfil);
    const anyPvHasMapa = (r.pvs || []).some(p => p.in_pv_mapa);
    // TL co-locado com um PV (mesmo ponto): o PV representa o ponto no mapa/perfil.
    // O TL é só o terminal de limpeza desenhado junto — não acusar "ausente".
    const colocatedTL = isTL(pv.id) && hasColocatedPv(pv, r.pvs);
    if (anyPvHasMapa && pv.in_pv_mapa === false && !isExistingPv(pv.id) && !colocatedTL) {
      errors.push(pv.id + ' ausente no Mapa (existe na Planilha mas falta multileader CT/CF no desenho)');
    }
    if (anyPvHasPerf && pv.in_pv_perfil === false && !isExistingPv(pv.id) && !colocatedTL) {
      errors.push(pv.id + ' ausente no Perfil (existe na Planilha mas falta bloco no perfil DXF)');
    }

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
    // CT planilha vs cota do TERRENO da planilha (col D). Se a planilha
    // diverge internamente, é levantamento topo desatualizado vs cota usada
    // no projeto. Tolerância maior (10 cm) — col D é o levantamento original
    // e pode ter pequenas correções de cravação no projeto.
    if (pv.excel_ct != null && pv.excel_cota != null
        && Math.abs(pv.excel_ct - pv.excel_cota) > 0.10) {
      errors.push('Cota TOPO ≠ Cota terreno (planilha) em ' + pv.id
        + ' (CT=' + pv.excel_ct.toFixed(3) + 'm, terreno=' + pv.excel_cota.toFixed(3)
        + 'm, Δ=' + Math.abs(pv.excel_ct - pv.excel_cota).toFixed(3) + 'm)');
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

    // Profundidade mínima por DN — regra A2Z: h ≥ max(1,10 ; 0,95 + DN/1000).
    // O h precisa garantir recobrimento de 0,95m sobre o TOPO do tubo, então
    // h cresce com o DN. PVs existentes / de interligação ficam fora da regra
    // (são levantamentos de campo, h é imutável).
    const hPv = maxProf(pv);
    const dnPv = pv.excel_diam;
    const hMinPv = minHForDn(dnPv);
    if (hPv != null && hPv < hMinPv - H_EPS && !isExistingPv(pv.id)) {
      hasShallow = true;
      const msg = dnPv != null
        ? pv.id + ' sem recobrimento (h=' + hPv.toFixed(3) + 'm < ' + hMinPv.toFixed(2)
          + 'm mínimo p/ DN ' + dnPv + ': 0,95m + DN)'
        : pv.id + ' raso (h=' + hPv.toFixed(3) + 'm < ' + hMinPv.toFixed(2) + 'm mínimo)';
      errors.push(msg);
    }

    // DN mínimo de coletor (regra Item 9). 150mm = mínimo SANEPAR/ABNT.
    if (dnPv != null && dnPv < DN_MIN_COLETOR && !isExistingPv(pv.id)) {
      errors.push(pv.id + ' DN ' + dnPv + 'mm abaixo do mínimo de coletor ('
        + DN_MIN_COLETOR + 'mm) — só admitido em ramal predial');
    }

    // DN consistente entre fontes (Mapa/Perfil/Planilha). Diferença em DN
    // significa que o desenho mostra um tubo de diâmetro diferente do que a
    // planilha lança — bug crítico de compatibilização, exatamente o que
    // o cliente flagrou. Itens 2 e 3.
    if (pv.excel_diam != null && pv.mapa_diam != null && pv.excel_diam !== pv.mapa_diam) {
      errors.push('DN divergente em ' + pv.id + ' (Planilha=' + pv.excel_diam
        + 'mm · Mapa=' + pv.mapa_diam + 'mm)');
    }
    if (pv.excel_diam != null && pv.perf_diam != null && pv.excel_diam !== pv.perf_diam) {
      errors.push('DN divergente em ' + pv.id + ' (Planilha=' + pv.excel_diam
        + 'mm · Perfil=' + pv.perf_diam + 'mm)');
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
    // T.Q. invertido — cf_chegada deve ser ≥ cf_pv (tubo entra acima ou
    // igual ao fundo do PV). Se cf_chegada < cf_pv, é geometricamente
    // impossível (tubo cruzaria abaixo do fundo).
    if (pv.excel_cf_chegada != null && pv.excel_cf_pv != null
        && pv.excel_cf_chegada < pv.excel_cf_pv - TOL.TQ) {
      errors.push('Degrau invertido em ' + pv.id
        + ' (CF chegada=' + pv.excel_cf_chegada.toFixed(3)
        + 'm < CF fundo=' + pv.excel_cf_pv.toFixed(3) + 'm) — impossível');
    }
    // Mesma checagem no perfil (DXF)
    if (pv.perf_cf_chegada != null && pv.perf_cf != null
        && pv.perf_cf_chegada < pv.perf_cf - TOL.TQ) {
      errors.push('Degrau invertido no PERFIL em ' + pv.id
        + ' (CF chegada=' + pv.perf_cf_chegada.toFixed(3)
        + 'm < CF fundo=' + pv.perf_cf.toFixed(3) + 'm)');
    }
    // TL deve ser PV (h > 1,30) → agora é ERRO
    const tlH = tlShouldBePv(pv, r.pvs);
    if (tlH != null) {
      hasTLbad = true;
      hasDeepTL = true;
      errors.push(pv.id + ' deve ser PV (h=' + tlH.toFixed(3) + 'm > ' + TL_MAX_H.toFixed(2) + 'm)');
    }
  }

  // ── Checks trecho-a-trecho (PV[i] → PV[i+1]) ──────────────────────────
  // Pega bugs DENTRO da OSE: cota errada num PV, contra-declive,
  // distância irreal, DN não-monotônico, coords UTM x L incoerente.
  // Lógica é direção-agnóstica: a planilha 2S/SANEPAR lista pvs[0]=jusante
  // (CF baixo) e pvs[last]=montante (CF alto), mas comparamos magnitudes
  // pra evitar quebrar caso a convenção seja inversa em outro projeto.
  const pvs = (r.pvs || []).filter(p => p && p.id);
  if (pvs.length >= 2) {
    const I_TRECHO_TOL  = 0.001;   // 0,1pp — |i real| vs |i declarada|
    const HUMP_EPS      = 0.0005;  // 0,5mm/m — variação ignorada como ruído
    const DIST_MAX_PV   = rules.distMaxTol;  // MND=85m, VCA=105m (oficial + 5m folga)
    const UTM_DIST_TOL  = 0.5;     // 0,5m diff entre UTM e L declarada

    // Pré-computa slopes (sinal preservado) e o sinal dominante da OSE.
    // Regra física: a declividade do tubo é (cota_saída_montante − cota_chegada_jusante) / L.
    // - No PV montante, o tubo sai pelo fundo → usa cf_pv.
    // - No PV jusante, o tubo chega na cota cf_chegada (antes do TQ, se houver).
    // Quando há T.Q. no jusante, cf_chegada > cf_pv, e usar cf_pv inflaria o slope
    // (caso OSE-002 Portal do Vale: planilha 9,665% virava 10,263% por erro de fórmula).
    // Guarda { slope, cfA_eff, cfB_eff } pra mensagem de erro mostrar os CFs usados.
    const slopes = [];
    for (let i = 0; i < pvs.length - 1; i++) {
      const a = pvs[i], b = pvs[i + 1];
      const cfA = a.excel_cf_pv, cfB = b.excel_cf_pv;
      const dA = a.excel_dist, dB = b.excel_dist;
      if (cfA == null || cfB == null || dA == null || dB == null) { slopes.push(null); continue; }
      const L = dB - dA;
      if (Math.abs(L) < 1e-3) { slopes.push(null); continue; }
      // Identifica jusante (CF menor) / montante (CF maior) — direção-agnóstica.
      const aIsJus = cfA < cfB;
      const cfA_eff = aIsJus
        ? (a.excel_cf_chegada != null ? a.excel_cf_chegada : cfA)
        : cfA;
      const cfB_eff = aIsJus
        ? cfB
        : (b.excel_cf_chegada != null ? b.excel_cf_chegada : cfB);
      slopes.push({ slope: (cfB_eff - cfA_eff) / L, cfA_eff, cfB_eff });
    }
    let mainSign = 0;
    for (const s of slopes) {
      if (s != null && Math.abs(s.slope) > HUMP_EPS) { mainSign = Math.sign(s.slope); break; }
    }

    for (let i = 0; i < pvs.length - 1; i++) {
      const a = pvs[i], b = pvs[i + 1];
      const trecho = a.id + '→' + b.id;
      const Ltrecho = (a.excel_dist != null && b.excel_dist != null)
                        ? Math.abs(b.excel_dist - a.excel_dist) : null;
      const slopeRec = slopes[i];
      const slope = slopeRec ? slopeRec.slope : null;

      // 1) Contra-declive: trecho com sinal contrário ao restante da OSE
      // (CF "sobe" no meio da rede gravitacional → bug de cota).
      if (slope != null && mainSign !== 0
          && Math.sign(slope) !== mainSign && Math.abs(slope) > HUMP_EPS) {
        errors.push('Contra-declive em ' + trecho
          + ' (i=' + (Math.abs(slope) * 100).toFixed(3) + '%, sentido inverso ao da OSE — CF '
          + a.id + '=' + a.excel_cf_pv.toFixed(3) + ', '
          + b.id + '=' + b.excel_cf_pv.toFixed(3) + ')');
      }

      // 2) |i_real| vs |i_decl| (planilha) — pega cota interna errada
      const iDecl = b.excel_decl != null ? b.excel_decl : a.excel_decl;
      if (slope != null && iDecl != null
          && Math.abs(Math.abs(slope) - Math.abs(iDecl)) > I_TRECHO_TOL) {
        errors.push('i trecho ' + trecho
          + ' divergente: planilha=' + (Math.abs(iDecl) * 100).toFixed(3)
          + '%, real=' + (Math.abs(slope) * 100).toFixed(3) + '% (CF '
          + slopeRec.cfA_eff.toFixed(3) + '↔' + slopeRec.cfB_eff.toFixed(3) + ', L='
          + (Ltrecho != null ? Ltrecho.toFixed(2) : '?') + 'm)');
      }

      // 3) Distância máxima entre PVs — MND=80m, VCA=100m (folga +5m)
      if (Ltrecho != null && Ltrecho > DIST_MAX_PV + 0.01) {
        errors.push('Trecho ' + trecho + ' tem ' + Ltrecho.toFixed(2)
          + 'm > ' + rules.distMax + 'm (distância máxima entre PVs, ' + rules.label + ')');
      }

      // 4) UTM vs L declarado — só com coords vindas do excel
      const haveUtmExcel = a.coord_x != null && a.coord_y != null
                        && b.coord_x != null && b.coord_y != null
                        && a.coord_src === 'excel' && b.coord_src === 'excel';
      if (haveUtmExcel && Ltrecho != null) {
        const dx = b.coord_x - a.coord_x;
        const dy = b.coord_y - a.coord_y;
        const distUtm = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(distUtm - Ltrecho) > UTM_DIST_TOL) {
          errors.push('Coords UTM × L incoerentes em ' + trecho
            + ' (UTM=' + distUtm.toFixed(2) + 'm, planilha=' + Ltrecho.toFixed(2)
            + 'm, Δ=' + Math.abs(distUtm - Ltrecho).toFixed(2)
            + 'm) — coordenada ou L errada');
        }
      }
    }

    // 5) DN monotônico ao longo da OSE — só pode crescer (ou ficar igual)
    // na direção do fluxo. Como CF segue mainSign, DN deve seguir o sinal
    // OPOSTO (DN maior pra jusante = onde CF é menor).
    let dnDir = 0; // +1 cresce com index, -1 decresce com index
    for (let i = 0; i < pvs.length - 1; i++) {
      const dnA = pvs[i].excel_diam, dnB = pvs[i + 1].excel_diam;
      if (dnA == null || dnB == null) continue;
      const delta = dnB - dnA;
      if (Math.abs(delta) < 0.5) continue;
      const dir = Math.sign(delta);
      if (dnDir === 0) {
        dnDir = dir;
      } else if (dir !== dnDir) {
        errors.push('DN não-monotônico em ' + pvs[i].id + '→' + pvs[i + 1].id
          + ' (' + dnA + 'mm → ' + dnB + 'mm) — DN só muda numa direção pela OSE');
        break;
      }
    }

    // 6) Mesma análise trecho-a-trecho NO PERFIL DXF — pega bug de cota
    // desenhada errada no DXF (planilha pode estar OK mas o perfil errado).
    // Mesma regra física da planilha: usa cf_chegada do jusante e cf_saida
    // (ou cf_pv) do montante. perf_cf_chegada/perf_cf_saida vêm de colunas
    // separadas no perfil 2S; quando uma falta, cai pra perf_cf (fundo).
    const slopesP = [];
    for (let i = 0; i < pvs.length - 1; i++) {
      const a = pvs[i], b = pvs[i + 1];
      const cfA = a.perf_cf, cfB = b.perf_cf;
      const dA = a.perf_ext, dB = b.perf_ext;
      if (cfA == null || cfB == null || dA == null || dB == null) { slopesP.push(null); continue; }
      const L = dB - dA;
      if (Math.abs(L) < 1e-3) { slopesP.push(null); continue; }
      const aIsJus = cfA < cfB;
      const cfA_eff = aIsJus
        ? (a.perf_cf_chegada != null ? a.perf_cf_chegada : cfA)
        : (a.perf_cf_saida != null ? a.perf_cf_saida : cfA);
      const cfB_eff = aIsJus
        ? (b.perf_cf_saida != null ? b.perf_cf_saida : cfB)
        : (b.perf_cf_chegada != null ? b.perf_cf_chegada : cfB);
      slopesP.push({ slope: (cfB_eff - cfA_eff) / L, cfA_eff, cfB_eff });
    }
    let mainSignP = 0;
    for (const s of slopesP) {
      if (s != null && Math.abs(s.slope) > HUMP_EPS) { mainSignP = Math.sign(s.slope); break; }
    }
    for (let i = 0; i < pvs.length - 1; i++) {
      const a = pvs[i], b = pvs[i + 1];
      const trecho = a.id + '→' + b.id;
      const slopeRec = slopesP[i];
      if (slopeRec == null) continue;
      const slope = slopeRec.slope;

      // Contra-declive no perfil
      if (mainSignP !== 0 && Math.sign(slope) !== mainSignP && Math.abs(slope) > HUMP_EPS) {
        errors.push('Contra-declive no PERFIL em ' + trecho
          + ' (i=' + (Math.abs(slope) * 100).toFixed(3) + '%, sentido inverso ao da OSE — CF '
          + a.id + '=' + a.perf_cf.toFixed(3) + ', '
          + b.id + '=' + b.perf_cf.toFixed(3) + ')');
      }

      // |i_real_perfil| vs declarada (planilha) — pega cota errada no DXF
      const iDecl = b.excel_decl != null ? b.excel_decl
                  : a.excel_decl != null ? a.excel_decl
                  : (b.perf_decl != null ? b.perf_decl : a.perf_decl);
      if (iDecl != null && Math.abs(Math.abs(slope) - Math.abs(iDecl)) > I_TRECHO_TOL) {
        errors.push('i trecho ' + trecho
          + ' no PERFIL divergente: declarada=' + (Math.abs(iDecl) * 100).toFixed(3)
          + '%, real=' + (Math.abs(slope) * 100).toFixed(3) + '% (CF perfil '
          + slopeRec.cfA_eff.toFixed(3) + '↔' + slopeRec.cfB_eff.toFixed(3) + ')');
      }
    }

    // 7) TL fora da cabeceira — TL é Terminal de Limpeza e fica SEMPRE no
    // PV de montante (maior CF). Se aparecer no jusante ou no meio da OSE,
    // é erro (perfil/desenho errado OU nomenclatura trocada).
    const cfFirst = pvs[0].excel_cf_pv;
    const cfLast  = pvs[pvs.length - 1].excel_cf_pv;
    let cabeceiraIdx = pvs.length - 1; // default: pvs[last] é montante (convenção 2S)
    if (cfFirst != null && cfLast != null && cfFirst > cfLast) {
      cabeceiraIdx = 0; // convenção invertida — pvs[0] é montante
    }
    for (let i = 0; i < pvs.length; i++) {
      if (isTL(pvs[i].id) && i !== cabeceiraIdx) {
        const ondeIdx = i === 0 ? 'no jusante' : 'no meio da OSE';
        errors.push(pvs[i].id + ' está ' + ondeIdx
          + ' (TL deve ficar SEMPRE na cabeceira/montante; cabeceira aqui é '
          + pvs[cabeceiraIdx].id + ' por ter o maior CF)');
      }
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
    const shallow = maxH <= DECL_DEPTH_LIMIT;
    const limite  = shallow ? rules.declMinShallow : rules.declMinDeep;
    if (iCheck < limite - DECL_EPS) {
      const faixa = shallow ? 'h máx=' + maxH.toFixed(2) + 'm ≤ 3m'
                            : 'h máx=' + maxH.toFixed(2) + 'm > 3m';
      errors.push('i=' + (iCheck * 100).toFixed(2) + '% < '
        + (limite * 100).toFixed(2).replace('.', ',') + '% ('
        + rules.label + ', ' + faixa + ')');
    }
  }

  // Cross-OSE: T.Q. implícito não documentado em PV de junção
  if (ctx && ctx.implicitTQ && ctx.implicitTQ[r.ose]) {
    for (const m of ctx.implicitTQ[r.ose]) errors.push(m);
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

/**
 * detectImplicitTQs — Detecta degraus (T.Q.) entre OSEs que não foram
 * declarados em nenhuma das planilhas envolvidas.
 *
 * Caso típico: PV final da OSE-A tem CF=100,5 e PV inicial da OSE-B
 * (mesmo poço) tem CF=100,0 — diferença de 50 cm sem declaração de
 * degrau em nenhuma das duas planilhas. É um T.Q. silencioso: aparece
 * no perfil mas ninguém anotou na obs.
 *
 * Retorna { [ose_num]: [errMsg, ...] } — lista de mensagens por OSE
 * envolvida. Se as duas planilhas declararam (has_tq=true OU
 * cf_chegada > cf_pv > TOL), considera documentado e não flagra.
 */
function detectImplicitTQs(data) {
  const result = {};
  if (!Array.isArray(data) || !data.length) return result;

  // pv_norm → [{ ose, cf_pv, cf_chegada, has_tq, role, pvId }]
  const pvMap = {};

  for (const r of data) {
    if (!r.pvs || !r.pvs.length) continue;
    for (let i = 0; i < r.pvs.length; i++) {
      const pv = r.pvs[i];
      if (!pv || !pv.id) continue;
      // Normaliza ID — alinha com o crossCheckPVs já existente
      const norm = pv.id.trim().replace(/[\s\-]+/g, '').toUpperCase()
        .replace(/([A-Z]+)0*(\d+)$/, (_, p, n) => p + parseInt(n, 10));
      const role = i === 0 ? 'inicial'
                 : i === r.pvs.length - 1 ? 'final'
                 : 'intermediario';
      if (!pvMap[norm]) pvMap[norm] = [];
      pvMap[norm].push({
        ose: r.ose,
        cf_pv: pv.excel_cf_pv,
        cf_chegada: pv.excel_cf_chegada,
        has_tq: !!pv.excel_has_tq,
        role,
        pvId: pv.id,
      });
    }
  }

  for (const entries of Object.values(pvMap)) {
    if (entries.length < 2) continue;

    const cfs = entries.map(e => e.cf_pv).filter(v => v != null);
    if (cfs.length < 2) continue;

    const minCf = Math.min(...cfs);
    const maxCf = Math.max(...cfs);
    const delta = maxCf - minCf;

    // Toleramos até TOL.TQ (2 cm) — abaixo disso é ruído de arredondamento.
    if (delta <= TOL.TQ) continue;

    // Se ALGUMA OSE declarou T.Q. (excel_has_tq=true) ou tem cf_chegada
    // acima do cf_pv (mesmo sem flag), considera o degrau documentado.
    const declared = entries.some(e =>
      e.has_tq ||
      (e.cf_chegada != null && e.cf_pv != null && (e.cf_chegada - e.cf_pv) > TOL.TQ)
    );
    if (declared) continue;

    const oses = [...new Set(entries.map(e => e.ose))];
    const pvId = entries[0].pvId;
    const cfList = entries
      .filter(e => e.cf_pv != null)
      .map(e => 'OSE-' + e.ose + '=' + e.cf_pv.toFixed(3))
      .join(' · ');
    const msg = 'T.Q. implícito não documentado em ' + pvId
              + ' (Δ=' + delta.toFixed(3) + 'm — ' + cfList
              + ') — declarar degrau na obs ou alinhar cota';
    for (const ose of oses) {
      if (!result[ose]) result[ose] = [];
      result[ose].push(msg);
    }
  }

  return result;
}

/**
 * detectTipoObraAuto — heurística que olha o conjunto completo de OSEs e
 * deduz se a obra é VCA ou MND. Usado quando o usuário deixa "Auto" no
 * dropdown e nenhuma OSE individual sinaliza PIT/estaca.
 *
 * Sinais (ordem de prioridade):
 *  1. Alguma OSE com r.has_pit → MND
 *  2. Alguma OSE com r.has_estaca → VCA
 *  3. Nome do arquivo de planilha contém "VCA" → VCA, "MND" → MND
 *  4. null (caller usa fallback)
 */
function detectTipoObraAuto(data, opts) {
  if (Array.isArray(data)) {
    for (const r of data) if (r && r.has_pit)    return 'mnd';
    for (const r of data) if (r && r.has_estaca) return 'vca';
  }
  const fn = opts && opts.excelFilename;
  if (typeof fn === 'string') {
    if (/\bvca\b/i.test(fn)) return 'vca';
    if (/\bmnd\b/i.test(fn)) return 'mnd';
  }
  return null;
}

/**
 * buildCrossContext — pré-computa todos os checks que dependem do
 * conjunto completo de OSEs (cross-OSE). Passado como segundo argumento
 * pra classifyOse(r, ctx) injeta os erros adicionais.
 *
 * @param {Array} data — array de OSEs
 * @param {Object} [opts]
 * @param {'vca'|'mnd'|'auto'} [opts.tipoObra] — escolha do usuário no dropdown
 * @param {string} [opts.excelFilename] — usado pra auto-detect via nome
 */
function buildCrossContext(data, opts) {
  const ctx = { implicitTQ: detectImplicitTQs(data) };
  const escolha = opts && opts.tipoObra;
  if (escolha === 'vca' || escolha === 'mnd') {
    ctx.tipoObra = escolha;
  }
  ctx.tipoObraAuto = detectTipoObraAuto(data, opts);
  return ctx;
}

module.exports = {
  classifyOse, crossCheckPVs, TOL,
  detectImplicitTQs, buildCrossContext, detectTipoObraAuto, resolveTipoObra,
  isTL, isExistingPv, tlShouldBePv, maxProf, maxProfOse,
  H_MIN, TL_MAX_H, DECL_MIN_SHALLOW, DECL_MIN_DEEP, DECL_DEPTH_LIMIT,
  DN_MIN_COLETOR, minHForDn,
  RULES,
};
