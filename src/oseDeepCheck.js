// oseDeepCheck.js — Verificação profunda paralela da rede de OSEs.
// Roda sobre o array gerado por buildComparison (parseOse.js) e cruza:
//   A. Topologia — grafo OSE→OSE, ciclos, órfãs, múltiplas saídas
//   B. Hidráulica — CF_saída=min(CF_chegadas), degrau/TQ, contra-declive,
//      declividade única por OSE, decl real vs declarada
//   C. Geometria — distância euclidiana mapa vs L planilha, CT consistente
//      em PV compartilhado, perfil ext_acum vs excel_L
//
// NÃO depende de eletron — puro Node. Pode ser chamado do main process
// (via IPC) ou importado direto no renderer (contextIsolation:false).
'use strict';

const { isExistingPv, classifyOse } = require('./oseStatus');

// Tolerâncias (espelham oseStatus onde fizer sentido e adicionam específicas).
const TOL = {
  CT:       0.05,   // CT em PV compartilhado entre OSEs
  CF:       0.01,   // 1cm — cf_saída vs cf_pv exato (mesma grandeza)
  L_DIST:   0.05,   // 5% — distância euclidiana no mapa vs L planilha
  L_DIST_ABS: 1.0,  // OU até 1m de folga absoluta (pra trechos muito curtos)
  DECL:     1e-4,   // decl única por OSE — 0,01pp de folga entre PVs
  I_REAL:   5e-4,   // decl real calculada vs declarada — 0,05pp
  H_MAX_L:  200,    // trecho > 200m é suspeito, provavelmente faltou PV intermediário
  TQ_THRESH: 0.50,  // ≤0,50m = degrau; >0,50m = TQ (tubo de queda)
  STEP_EPS: 0.005,  // 5mm mínimo pra contar como degrau (ignora ruído numérico)
};

// ── UTIL ───────────────────────────────────────────────────────────────────
function rnd(v, d) {
  if (v == null || isNaN(v)) return v;
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

function fmt(v, d) {
  if (v == null || isNaN(v)) return '?';
  return Number(v).toFixed(d);
}

function normalizeId(s) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/[\s\-]+/g, '').toUpperCase()
    .replace(/([A-Z]+)0*(\d+)$/, (_, p, n) => p + parseInt(n, 10));
}

function pushV(arr, v) {
  // default severity = erro
  if (!v.severity) v.severity = 'erro';
  arr.push(v);
}

// ── BUILD GRAPH ────────────────────────────────────────────────────────────
// Retorna:
//   byPv[pvNorm] = {
//     ct: number|null,
//     ctSources: [{ ose, ct }],
//     asMontante: [{ ose, cf_saida }],  // OSEs que SAEM deste PV (cabeceira)
//     asJusante:  [{ ose, cf_pv, cf_chegada }], // OSEs que CHEGAM (último PV)
//     isTerminal: bool (heurística),
//     isExisting: bool (PV-EX- / PV-INT-),
//     coord: { x, y } | null,
//   }
function buildGraph(data) {
  const byPv = {};
  const byOse = {};

  function ensure(pvNorm, rawId) {
    if (!byPv[pvNorm]) {
      byPv[pvNorm] = {
        id: rawId,
        ct: null, ctSources: [],
        asMontante: [], asJusante: [],
        isTerminal: false,
        isExisting: isExistingPv(rawId),
        coord: null,
      };
    }
    return byPv[pvNorm];
  }

  for (const r of data) {
    const pvs = (r.pvs || []).filter(p => p && p.id && !/^PIT/i.test(p.id));
    if (!pvs.length) continue;

    // CONVENÇÃO SANEPAR: na planilha, pvs[0] é o JUSANTE (ponto baixo onde a
    // água chega) e pvs[último] é o MONTANTE (cabeceira, ponto alto).
    // As PITs intermediárias vão do jusante rumo ao montante com CF crescente.
    const jusantePv  = pvs[0];
    const montantePv = pvs[pvs.length - 1];

    const oseInfo = {
      ose: r.ose,
      montanteId: montantePv.id, jusanteId: jusantePv.id,
      montanteNorm: normalizeId(montantePv.id), jusanteNorm: normalizeId(jusantePv.id),
      L: r.excel_L, i: r.excel_i,
      cf_montante: montantePv.excel_cf_pv, cf_jusante: jusantePv.excel_cf_pv,
      mapa_L: r.mapa_L, mapa_i: r.mapa_i,
      pvs,
    };
    byOse[r.ose] = oseInfo;

    for (const pv of pvs) {
      const norm = normalizeId(pv.id);
      const node = ensure(norm, pv.id);
      if (pv.excel_ct != null) {
        if (node.ct == null) node.ct = pv.excel_ct;
        node.ctSources.push({ ose: r.ose, ct: pv.excel_ct });
      }
      if (pv.coord_x != null && pv.coord_y != null && !node.coord) {
        node.coord = { x: pv.coord_x, y: pv.coord_y };
      }
    }

    // OSE sai do MONTANTE (cabeceira) rumo ao JUSANTE (onde desemboca).
    const montanteNode = ensure(oseInfo.montanteNorm, montantePv.id);
    const jusanteNode  = ensure(oseInfo.jusanteNorm,  jusantePv.id);
    montanteNode.asMontante.push({
      ose: r.ose,
      cf_saida: montantePv.excel_cf_pv,  // CF do fundo de onde a água sai
    });
    jusanteNode.asJusante.push({
      ose: r.ose,
      cf_pv: jusantePv.excel_cf_pv,
      cf_chegada: jusantePv.excel_cf_chegada, // CF no momento em que chega (pode ter degrau)
    });
  }

  // Heurística de terminal: PV marcado como PVP, ETE, FIM no nome; ou
  // out-degree 0 mas marcado como existente (rede termina em PV de campo).
  for (const norm in byPv) {
    const node = byPv[norm];
    if (/\b(PVP|ETE|FIM|TERM|PT)\b/i.test(node.id)) node.isTerminal = true;
  }

  return { byPv, byOse };
}

// ── A. TOPOLOGIA ───────────────────────────────────────────────────────────
function checkTopology(data, graph, V) {
  const { byPv, byOse } = graph;

  // A1. PV com múltiplas OSEs saindo (out-degree > 1).
  for (const norm in byPv) {
    const node = byPv[norm];
    if (node.asMontante.length > 1) {
      pushV(V, {
        category: 'topologia', code: 'PV_MULTI_OUT',
        severity: 'alerta',
        pv: node.id,
        oses: node.asMontante.map(x => x.ose),
        message: 'PV ' + node.id + ' tem ' + node.asMontante.length +
          ' OSEs saindo (' + node.asMontante.map(x => 'OSE-' + x.ose).join(', ') +
          ') — rede gravitacional normalmente tem 1 saída por PV.',
      });
    }
  }

  // A2. OSE órfã — jusante da OSE não tem nenhuma OSE saindo dele (água não
  //     tem pra onde ir) e o PV não é terminal conhecido nem existente.
  //     Ignora quando o jusante é cabeceira de pelo menos uma OSE (é junção).
  for (const ose in byOse) {
    const info = byOse[ose];
    const jus = byPv[info.jusanteNorm];
    if (!jus) continue;
    const hasOutgoing = jus.asMontante.length > 0;
    if (!hasOutgoing && !jus.isTerminal && !jus.isExisting) {
      pushV(V, {
        category: 'topologia', code: 'OSE_SEM_JUSANTE',
        severity: 'alerta',
        ose, pv: jus.id,
        message: 'OSE-' + ose + ' desemboca em ' + jus.id +
          ' mas nenhuma OSE sai desse PV e ele não é terminal (PVP/ETE/PV-EX).',
      });
    }
  }

  // A3. Cabeceira é TERMINAL — OSE nasce num PVP/ETE: inversão de fluxo.
  for (const ose in byOse) {
    const info = byOse[ose];
    const mont = byPv[info.montanteNorm];
    if (!mont) continue;
    if (mont.isTerminal) {
      pushV(V, {
        category: 'topologia', code: 'OSE_CABECEIRA_EM_TERMINAL',
        severity: 'erro',
        ose, pv: mont.id,
        message: 'OSE-' + ose + ' nasce em ' + mont.id +
          ' que parece terminal da rede (PVP/ETE) — possível inversão de fluxo.',
      });
    }
  }

  // A4. Ciclos — DFS sobre grafo OSE→OSE. Aresta A→B se jus(A) == mont(B).
  const adj = {};
  for (const oseA in byOse) {
    const A = byOse[oseA];
    const jusNode = byPv[A.jusanteNorm];
    if (!jusNode) continue;
    for (const out of jusNode.asMontante) {
      if (out.ose === oseA) continue;
      if (!adj[oseA]) adj[oseA] = [];
      adj[oseA].push(out.ose);
    }
  }
  // Detecta ciclos via DFS com cores.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  const parent = {};
  const cycles = [];
  function dfs(u) {
    color[u] = GRAY;
    for (const v of (adj[u] || [])) {
      if (color[v] === GRAY) {
        // Reconstroi ciclo
        const cyc = [v];
        let cur = u;
        while (cur != null && cur !== v) {
          cyc.push(cur);
          cur = parent[cur];
        }
        cyc.push(v);
        cycles.push(cyc.reverse());
      } else if (color[v] !== BLACK) {
        parent[v] = u;
        dfs(v);
      }
    }
    color[u] = BLACK;
  }
  for (const u in byOse) {
    if (color[u] == null) dfs(u);
  }
  // Deduplica ciclos (mesmo conjunto)
  const seenCyc = new Set();
  for (const cyc of cycles) {
    const key = [...cyc].sort().join(',');
    if (seenCyc.has(key)) continue;
    seenCyc.add(key);
    pushV(V, {
      category: 'topologia', code: 'CICLO',
      severity: 'erro',
      oses: cyc,
      message: 'Ciclo detectado: ' + cyc.map(x => 'OSE-' + x).join(' → '),
    });
  }
}

// ── B. HIDRÁULICA ──────────────────────────────────────────────────────────
function checkHydraulics(data, graph, V) {
  const { byPv, byOse } = graph;

  // B1. CF_saída = min(CF_chegadas) em PV compartilhado.
  //     Para cada PV com chegadas (asJusante) E saída (asMontante):
  //     cf_saida da saída deve = cf_pv do PV = min(cf_chegadas).
  for (const norm in byPv) {
    const node = byPv[norm];
    if (!node.asJusante.length || !node.asMontante.length) continue;
    const chegadas = node.asJusante
      .map(x => x.cf_chegada != null ? x.cf_chegada : x.cf_pv)
      .filter(v => v != null);
    if (!chegadas.length) continue;
    const minChegada = Math.min(...chegadas);
    for (const out of node.asMontante) {
      if (out.cf_saida == null) continue;
      // CF da saída não pode ser MAIOR que min(chegadas) — tubo afogaria.
      if (out.cf_saida - minChegada > TOL.CF) {
        pushV(V, {
          category: 'hidraulica', code: 'CF_SAIDA_ALTA',
          severity: 'erro',
          ose: out.ose, pv: node.id,
          message: 'CF saída de OSE-' + out.ose + ' em ' + node.id +
            ' = ' + fmt(out.cf_saida, 3) + 'm > min(chegadas)=' + fmt(minChegada, 3) +
            'm — tubo de saída acima da chegada mais baixa (afoga o PV).',
          details: { cf_saida: out.cf_saida, min_chegada: minChegada },
        });
      }
    }
  }

  // B2. Degrau/TQ classification por PV (cf_chegada > cf_pv).
  for (const r of data) {
    for (const pv of (r.pvs || [])) {
      if (!pv.excel_cf_chegada || !pv.excel_cf_pv) continue;
      const delta = pv.excel_cf_chegada - pv.excel_cf_pv;
      if (delta < TOL.STEP_EPS) continue;
      const isTQ = delta > TOL.TQ_THRESH;
      const tipo = isTQ ? 'tubo de queda' : 'degrau';
      const declared = pv.excel_has_tq === true;
      // Se Δ > 0.50 e a planilha NÃO declarou TQ → alerta (pode estar faltando).
      if (isTQ && !declared) {
        pushV(V, {
          category: 'hidraulica', code: 'TQ_NAO_DECLARADO',
          severity: 'alerta',
          ose: r.ose, pv: pv.id,
          message: pv.id + ' em OSE-' + r.ose + ': Δ=' + fmt(delta, 3) +
            'm (>' + TOL.TQ_THRESH.toFixed(2) + ') — deveria ser TQ mas planilha não marcou.',
          details: { delta, declared, classificacao: tipo },
        });
      } else {
        // Info descritiva — útil pro painel
        pushV(V, {
          category: 'hidraulica', code: 'DEGRAU_TQ',
          severity: 'info',
          ose: r.ose, pv: pv.id,
          message: pv.id + ' em OSE-' + r.ose + ': ' + tipo + ' de ' +
            fmt(delta, 3) + 'm' + (declared ? ' (declarado)' : ''),
          details: { delta, declared, classificacao: tipo },
        });
      }
    }
  }

  // B3. Declividade única por OSE. Todos PVs (não-PIT) devem ter mesmo excel_decl.
  for (const r of data) {
    const decls = (r.pvs || [])
      .filter(p => !/^PIT/i.test(p.id) && p.excel_decl != null)
      .map(p => ({ id: p.id, decl: p.excel_decl }));
    if (decls.length < 2) continue;
    const first = decls[0].decl;
    const diffs = decls.filter(d => Math.abs(d.decl - first) > TOL.DECL);
    if (diffs.length) {
      pushV(V, {
        category: 'hidraulica', code: 'DECL_MULTIPLA',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' tem declividades diferentes entre PVs: ' +
          decls.map(d => d.id + '=' + fmt(d.decl, 5)).join(', '),
      });
    }
  }

  // B4. Contra-declive — CF jusante > CF montante (água teria que subir).
  //     Na convenção SANEPAR: pvs[0]=jusante (baixo), pvs[last]=montante (alto).
  for (const r of data) {
    const pvs = (r.pvs || []).filter(p => !/^PIT/i.test(p.id) && p.excel_cf_pv != null);
    if (pvs.length < 2) continue;
    const cfJus  = pvs[0].excel_cf_pv;
    const cfMont = pvs[pvs.length - 1].excel_cf_pv;
    if (cfJus - cfMont > TOL.CF) {
      pushV(V, {
        category: 'hidraulica', code: 'CONTRA_DECLIVE',
        severity: 'erro',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' contra-declive: CF jusante (' +
          fmt(cfJus, 3) + ') > CF montante (' + fmt(cfMont, 3) +
          ') — água teria que subir.',
      });
    }
  }

  // B5. Decl real calculada vs declarada. i_real = (cf_mont − cf_jus) / L.
  for (const r of data) {
    const pvs = (r.pvs || []).filter(p => !/^PIT/i.test(p.id) && p.excel_cf_pv != null);
    if (pvs.length < 2 || r.excel_L == null || r.excel_L <= 0) continue;
    const cfJus  = pvs[0].excel_cf_pv;
    const cfMont = pvs[pvs.length - 1].excel_cf_pv;
    const iReal = (cfMont - cfJus) / r.excel_L;
    if (r.excel_i != null && Math.abs(iReal - r.excel_i) > TOL.I_REAL) {
      pushV(V, {
        category: 'hidraulica', code: 'I_REAL_VS_DECLARADA',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' i real calculada=' + fmt(iReal * 100, 2) +
          '% ≠ declarada=' + fmt(r.excel_i * 100, 2) + '% (Δ=' +
          fmt(Math.abs(iReal - r.excel_i) * 100, 3) + 'pp).',
        details: { i_real: iReal, i_declarada: r.excel_i },
      });
    }
  }

  // B6. Trecho muito longo (>200m) — possível PV intermediário faltando.
  for (const r of data) {
    if (r.excel_L != null && r.excel_L > TOL.H_MAX_L) {
      pushV(V, {
        category: 'hidraulica', code: 'TRECHO_LONGO',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' com L=' + fmt(r.excel_L, 2) + 'm > ' +
          TOL.H_MAX_L + 'm — conferir se não está faltando PV intermediário.',
      });
    }
  }
}

// ── C. CROSS-SOURCE (planilha × mapa × perfil no mesmo PV/OSE) ────────────
function checkGeometry(data, graph, V) {
  const { byPv, byOse } = graph;

  // LIMITAÇÃO: DXFs deste projeto estão "explodidos em paperspace" — os
  // CIRCLEs dos PVs e LWPOLYLINEs dos tubos estão em coordenadas de PÁGINA
  // (ex.: 361, 118), não em UTM real. Só os MULTILEADER preservam content
  // position UTM, mas é a posição do RÓTULO, não do PV. Logo, nada de
  // análise geométrica confiável via geometria do DXF neste formato.
  // Mantemos apenas checks cross-source baseados em valores numéricos.

  // C1. CF_PV consistente em PV compartilhado entre OSEs.
  //     Quando OSE-A desemboca em X (X é jusante de A) e OSE-B nasce em X
  //     (X é montante de B), o cf_pv de X deve ser igual em ambas as
  //     leituras da planilha. Se diverge, planilha tem erro de lançamento.
  for (const norm in byPv) {
    const node = byPv[norm];
    const cfs = [];
    for (const m of node.asMontante)   if (m.cf_saida != null) cfs.push({ ose: m.ose, cf: m.cf_saida, tipo: 'saída' });
    for (const j of node.asJusante)    if (j.cf_pv   != null) cfs.push({ ose: j.ose, cf: j.cf_pv,   tipo: 'fundo' });
    if (cfs.length < 2) continue;
    const min = Math.min(...cfs.map(x => x.cf));
    const max = Math.max(...cfs.map(x => x.cf));
    if (max - min > TOL.CF) {
      pushV(V, {
        category: 'geometria', code: 'CF_PV_INCONSISTENTE',
        severity: 'erro',
        pv: node.id,
        oses: cfs.map(x => x.ose),
        message: 'PV ' + node.id + ' tem CF divergente entre OSEs (Δ=' +
          fmt(max - min, 3) + 'm): ' +
          cfs.map(x => 'OSE-' + x.ose + ' ' + x.tipo + '=' + fmt(x.cf, 3)).join(', '),
      });
    }
  }

  // C2. CT consistente em PV compartilhado (mantido — CT é dado do terreno).
  for (const norm in byPv) {
    const node = byPv[norm];
    if (node.ctSources.length < 2) continue;
    const cts = node.ctSources.map(s => s.ct).filter(v => v != null);
    if (cts.length < 2) continue;
    const delta = Math.max(...cts) - Math.min(...cts);
    if (delta > TOL.CT) {
      pushV(V, {
        category: 'geometria', code: 'CT_INCONSISTENTE',
        severity: 'erro',
        pv: node.id,
        oses: node.ctSources.map(s => s.ose),
        message: 'CT de ' + node.id + ' difere entre OSEs (Δ=' + fmt(delta, 3) +
          'm): ' + node.ctSources.map(s => 'OSE-' + s.ose + '=' + fmt(s.ct, 3)).join(', '),
      });
    }
  }

  // C3. Perfil ext.acum último ≈ excel_L (última ext.acum do perfil deve
  //     bater com a extensão total da OSE).
  for (const r of data) {
    const pvs = (r.pvs || []).filter(p => !/^PIT/i.test(p.id) && p.perf_ext != null);
    if (!pvs.length || r.excel_L == null) continue;
    const maxExt = Math.max(...pvs.map(p => p.perf_ext));
    if (Math.abs(maxExt - r.excel_L) > 0.5) {
      pushV(V, {
        category: 'geometria', code: 'PERFIL_EXT_DIFERE_L',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' perfil ext.acum máx=' + fmt(maxExt, 2) +
          'm vs L planilha=' + fmt(r.excel_L, 2) + 'm (Δ=' +
          fmt(Math.abs(maxExt - r.excel_L), 2) + 'm).',
      });
    }
  }

  // C2. CT consistente em PV compartilhado — já existe em crossCheckPVs
  //     com TOL.CT=0.05. Aqui repetimos via grafo pra integrar no relatório.
  for (const norm in byPv) {
    const node = byPv[norm];
    if (node.ctSources.length < 2) continue;
    const cts = node.ctSources.map(s => s.ct).filter(v => v != null);
    if (cts.length < 2) continue;
    const delta = Math.max(...cts) - Math.min(...cts);
    if (delta > TOL.CT) {
      pushV(V, {
        category: 'geometria', code: 'CT_INCONSISTENTE',
        severity: 'erro',
        pv: node.id,
        oses: node.ctSources.map(s => s.ose),
        message: 'CT de ' + node.id + ' difere entre OSEs (Δ=' + fmt(delta, 3) +
          'm): ' + node.ctSources.map(s => 'OSE-' + s.ose + '=' + fmt(s.ct, 3)).join(', '),
      });
    }
  }

  // C3. Perfil ext_acum último ≈ excel_L.
  //     O perf_ext vem per-PV em pv.perf_ext (último PV do bloco tem maior ext_acum).
  for (const r of data) {
    const pvs = (r.pvs || []).filter(p => !/^PIT/i.test(p.id) && p.perf_ext != null);
    if (!pvs.length || r.excel_L == null) continue;
    const maxExt = Math.max(...pvs.map(p => p.perf_ext));
    if (Math.abs(maxExt - r.excel_L) > 0.5) {
      pushV(V, {
        category: 'geometria', code: 'PERFIL_EXT_DIFERE_L',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ' perfil ext.acum máx=' + fmt(maxExt, 2) +
          'm vs L planilha=' + fmt(r.excel_L, 2) + 'm (Δ=' +
          fmt(Math.abs(maxExt - r.excel_L), 2) + 'm).',
      });
    }
  }
}

// ── D. CONFERÊNCIA (inclui erros do classifyOse pra ter visão única) ──────
function checkConferencia(data, V) {
  for (const r of data) {
    const c = classifyOse(r);
    // errors são ERRO real, warnings são ALERTA (T.Q. etc.)
    for (const msg of (c.errors || [])) {
      pushV(V, {
        category: 'conferencia', code: 'CONFERENCIA_ERRO',
        severity: 'erro',
        ose: r.ose,
        message: 'OSE-' + r.ose + ': ' + msg,
      });
    }
    for (const msg of (c.warnings || [])) {
      pushV(V, {
        category: 'conferencia', code: 'CONFERENCIA_AVISO',
        severity: 'alerta',
        ose: r.ose,
        message: 'OSE-' + r.ose + ': ' + msg,
      });
    }
  }
}

// ── ENTRY ──────────────────────────────────────────────────────────────────
function deepCheck(data) {
  const graph = buildGraph(data);
  const V = [];
  checkConferencia(data, V);
  checkTopology(data, graph, V);
  checkHydraulics(data, graph, V);
  checkGeometry(data, graph, V);

  // Dedup — idênticas por (code, ose, pv, message).
  const seen = new Set();
  const dedup = [];
  for (const v of V) {
    const key = v.code + '|' + (v.ose || '') + '|' + (v.pv || '') + '|' + v.message;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(v);
  }
  V.length = 0;
  for (const v of dedup) V.push(v);

  // Ordena: erro > alerta > info, depois por OSE, depois por código.
  const sevRank = { erro: 0, alerta: 1, info: 2 };
  V.sort((a, b) => {
    const ds = sevRank[a.severity] - sevRank[b.severity];
    if (ds) return ds;
    const da = (a.ose || '') + (a.pv || '');
    const db = (b.ose || '') + (b.pv || '');
    return da.localeCompare(db);
  });

  const stats = {
    total: V.length,
    erros:   V.filter(v => v.severity === 'erro').length,
    alertas: V.filter(v => v.severity === 'alerta').length,
    infos:   V.filter(v => v.severity === 'info').length,
    por_categoria: {
      conferencia: V.filter(v => v.category === 'conferencia').length,
      topologia:   V.filter(v => v.category === 'topologia').length,
      hidraulica:  V.filter(v => v.category === 'hidraulica').length,
      geometria:   V.filter(v => v.category === 'geometria').length,
    },
    oses_total:        data.length,
    oses_com_erro:     new Set(V.filter(v => v.severity === 'erro' && v.ose).map(v => v.ose)).size,
    oses_com_alerta:   new Set(V.filter(v => v.severity === 'alerta' && v.ose).map(v => v.ose)).size,
  };

  // Grafo serializável (sem funções) pra uso no renderer/mapa.
  const graphOut = {
    pvs: Object.fromEntries(Object.entries(graph.byPv).map(([k, n]) => [k, {
      id: n.id, ct: n.ct,
      out: n.asMontante.map(x => x.ose),
      in:  n.asJusante.map(x => x.ose),
      isTerminal: n.isTerminal,
      isExisting: n.isExisting,
      coord: n.coord,
    }])),
    oses: Object.fromEntries(Object.entries(graph.byOse).map(([k, o]) => [k, {
      montante: o.montanteId, jusante: o.jusanteId,
      L: o.L, i: o.i,
      cf_montante: o.cf_montante, cf_jusante: o.cf_jusante,
    }])),
  };

  return { violations: V, stats, graph: graphOut };
}

module.exports = { deepCheck, TOL };
