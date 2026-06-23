// test_fix_grafo.js
// FASE 3 (modo OFF) — Auto-fix de cotas via grafo topológico INTER-OSE
//
// Algoritmo:
//   1. Constrói grafo: cada PV é nó, cada trecho (linha XLSX) é aresta dirigida mont→jus.
//   2. Identifica PVs cabeceira (sem chegadas) — sua CF inicial é mantida do original.
//   3. Ordenação topológica (Kahn). Processa cada PV apenas após todas as chegadas
//      estarem resolvidas.
//   4. Em cada PV intermediário com múltiplas chegadas:
//        CF_saída = min(CF_chegadas)   (regra hidráulica do usuário)
//   5. Para cada trecho saindo do PV:
//        proj_jus_novo = proj_mont_novo - i_alvo * L
//        i_alvo = se i_atual já é OK e segue regras → mantém; senão → i_min
//   6. Detecta TQ externo: chegadas com CF muito acima do CF_saída
//        diff ≤ 0,50m → degrau
//        diff > 0,50m → tubo de queda
//   7. Aviso quando h corrigido > 3m (sem teto, conforme regra acordada).
//
// Uso: node test_fix_grafo.js "<planilha.xls/.xlsx>"

'use strict';
const xlsx = require('xlsx');
const path = require('path');

const H_MIN = 1.10;
const H_WARN = 3.0;
const I_MIN_SHALLOW = 0.01;
const I_MIN_DEEP = 0.0055;
const DEPTH_LIMIT = 3.0;
const EPS = 5e-5;

function cellVal(ws, r, c) { const a = xlsx.utils.encode_cell({r,c}); const cell = ws[a]; return cell?{val:cell.v}:{val:null}; }
function cellStr(ws, r, c) { const v = cellVal(ws,r,c).val; return (v!=null && v!=='') ? String(v) : ''; }
function cellNum(ws, r, c) { const v = cellVal(ws,r,c).val; const n = typeof v==='number'?v:Number(v); return isFinite(n)?n:null; }

const COL_ALIASES = {
  OSE1a:['ose1a'], OSE:['ose'], pv_mont:['pv_mont1','pv_mont'], pv_jus:['pv_jus'],
  terr_mont:['terr_mont'], terr_jus:['terr_jus'], proj_mont:['proj_mont'], proj_jus:['proj_jus'],
  prof_mont:['prof_mont'], prof_jus:['prof_jus'], compr:['compr','comprimento'],
};
function detectCols(ws, ref) {
  const map = {};
  for (let c = 0; c <= ref.e.c; c++) {
    const h = cellStr(ws,0,c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if (!h) continue;
    for (const [k, ns] of Object.entries(COL_ALIASES)) if (ns.includes(h) && map[k]==null) { map[k]=c; break; }
  }
  for (const k of Object.keys(COL_ALIASES)) if (map[k]==null) map[k]=-1;
  return map;
}
function findMainEnd(ws, ref, pvJusCol) {
  for (let r = ref.e.r; r >= 1; r--) if (cellStr(ws, r, pvJusCol)) return r;
  return ref.e.r;
}

const iMinFor = (h) => h > DEPTH_LIMIT ? I_MIN_DEEP : I_MIN_SHALLOW;

// ===== MAIN =====
const filePath = process.argv[2];
if (!filePath) { console.error('Uso: node test_fix_grafo.js "<planilha>"'); process.exit(1); }

console.log('=== FASE 3 — Auto-fix Grafo Topológico Inter-OSE (TESTE OFF) ===\n');
console.log('Arquivo:', filePath);
console.log('Regras: h_min=' + H_MIN + 'm, AVISO h>' + H_WARN + 'm, i_min=1%/0.55%, CF_saída=min(CF_chegadas)\n');

const wb = xlsx.readFile(filePath, { cellFormula:false, cellNF:false, cellStyles:false });
const ws = wb.Sheets[wb.SheetNames[0]];
const ref = xlsx.utils.decode_range(ws['!ref']);
const C = detectCols(ws, ref);
const lastMain = findMainEnd(ws, ref, C.pv_jus);

// 1) Coleta trechos
const edges = [];   // [{row, ose1a, ose, mont, jus, terrMont, terrJus, projMontOrig, projJusOrig, compr}]
for (let r = 1; r <= lastMain; r++) {
  const ose1a = cellStr(ws,r,C.OSE1a);
  const mont = cellStr(ws,r,C.pv_mont);
  const jus = cellStr(ws,r,C.pv_jus);
  if (!mont || !jus) continue;
  edges.push({
    row: r, ose1a, ose: cellStr(ws,r,C.OSE),
    mont, jus,
    terrMont: cellNum(ws,r,C.terr_mont), terrJus: cellNum(ws,r,C.terr_jus),
    projMontOrig: cellNum(ws,r,C.proj_mont), projJusOrig: cellNum(ws,r,C.proj_jus),
    compr: cellNum(ws,r,C.compr),
    // Estes campos serão preenchidos na propagação:
    projMontFinal: null, projJusFinal: null,
  });
}
console.log('Trechos:', edges.length);

// 2) Constrói grafo
const inEdges = {};   // pvId -> [edge, ...] que CHEGAM em pvId
const outEdges = {};  // pvId -> [edge, ...] que SAEM de pvId
const allPvs = new Set();
for (const e of edges) {
  allPvs.add(e.mont); allPvs.add(e.jus);
  (outEdges[e.mont] = outEdges[e.mont] || []).push(e);
  (inEdges[e.jus] = inEdges[e.jus] || []).push(e);
}
console.log('PVs únicos:', allPvs.size);

// 3) Cabeceiras (sem chegadas)
const heads = [...allPvs].filter(p => !inEdges[p] || !inEdges[p].length);
console.log('Cabeceiras (sem chegada):', heads.length);

// 4) Ordenação topológica (Kahn)
//    Resolve PV após todas as chegadas terem CF definida.
const cfSaida = {};   // pvId -> { cf, ct, source }
const ctByPv = {};    // pvId -> ct (do terreno; usa primeiro encontrado)
for (const e of edges) {
  if (e.terrMont != null && ctByPv[e.mont] == null) ctByPv[e.mont] = e.terrMont;
  if (e.terrJus != null && ctByPv[e.jus] == null) ctByPv[e.jus] = e.terrJus;
}

// Inicializa cabeceiras com sua CF original (do trecho que sai dela)
for (const head of heads) {
  const out = outEdges[head] || [];
  if (!out.length) continue;
  // Pega o proj_mont do primeiro trecho que sai (todos deveriam ser iguais)
  let cfHead = null;
  for (const e of out) if (e.projMontOrig != null) { cfHead = e.projMontOrig; break; }
  if (cfHead != null) cfSaida[head] = { cf: cfHead, ct: ctByPv[head], source: 'cabeceira' };
}

// Kahn: fila com PVs prontos (todas chegadas resolvidas)
const remainingIn = {};  // pvId -> set de edges ainda não resolvidas
for (const [pv, arr] of Object.entries(inEdges)) remainingIn[pv] = new Set(arr);

const queue = heads.slice();
const stats = {
  pvsHarmonizados: 0,    // PVs com >1 chegada onde escolhemos min
  trechosCorrigidos: 0,
  trechosOk: 0,
  tqsExt: 0,             // tubos de queda externos detectados
  degraus: 0,            // degraus externos
  warnings: 0,           // h corrigido > 3m
  manualReview: 0,       // h < h_min após correção
  cycles: 0,
};
const fixes = [];
const harmonizations = [];   // [{pv, chegadas: [{src, cf}], escolhido, degraus/tqs: [{src, diff, tipo}]}]
const warnings = [];
const manualReview = [];
let processed = 0;
const guard = allPvs.size + 100;
let iter = 0;

while (queue.length && iter++ < guard) {
  const pv = queue.shift();
  processed++;

  // Determina CF de saída deste PV
  if (cfSaida[pv] == null) {
    // PV intermediário: pega min das chegadas resolvidas
    const chegadas = (inEdges[pv] || [])
      .filter(e => e.projJusFinal != null)
      .map(e => ({ src: e.ose1a + ' ' + e.ose, cf: e.projJusFinal }));
    if (!chegadas.length) continue;  // ainda não pronto
    let minCf = chegadas[0].cf;
    for (const c of chegadas) if (c.cf < minCf) minCf = c.cf;
    cfSaida[pv] = { cf: minCf, ct: ctByPv[pv], source: 'intermediario' };

    if (chegadas.length > 1) {
      stats.pvsHarmonizados++;
      // Detecta degraus/TQs (chegadas acima do escolhido)
      const drops = [];
      for (const c of chegadas) {
        const diff = c.cf - minCf;
        if (diff > 0.001) {
          const tipo = diff > 0.50 ? 'TQ' : 'degrau';
          if (tipo === 'TQ') stats.tqsExt++;
          else stats.degraus++;
          drops.push({ src: c.src, diff: diff.toFixed(3), tipo });
        }
      }
      harmonizations.push({ pv, chegadas, escolhido: minCf.toFixed(3), drops });
    }
  }

  // Processa trechos saindo deste PV
  const out = outEdges[pv] || [];
  const cfOut = cfSaida[pv].cf;

  for (const e of out) {
    e.projMontFinal = cfOut;
    if (e.compr == null || e.compr <= 0 || e.terrJus == null) continue;

    // Decide i alvo
    const hMont = (ctByPv[e.mont] != null) ? ctByPv[e.mont] - cfOut : 0;
    const iMinAtual = iMinFor(hMont);
    let projJusNovo;
    let used = 'i_min';

    // Tenta manter projJusOrig se ele resulta em i válida e não-negativa
    if (e.projJusOrig != null) {
      const desn = cfOut - e.projJusOrig;
      const declCand = desn / e.compr;
      const hJusCand = (e.terrJus != null) ? e.terrJus - e.projJusOrig : 0;
      const iMinCand = iMinFor(Math.max(hMont, hJusCand));
      if (declCand >= iMinCand - EPS && desn > -0.001) {
        projJusNovo = e.projJusOrig;
        used = 'mantida';
      }
    }
    if (projJusNovo == null) {
      projJusNovo = cfOut - iMinAtual * e.compr;
      let hJusCand = e.terrJus - projJusNovo;
      if (hJusCand > DEPTH_LIMIT) {
        projJusNovo = cfOut - I_MIN_DEEP * e.compr;
        hJusCand = e.terrJus - projJusNovo;
      }
    }
    e.projJusFinal = projJusNovo;
    const hJusFinal = e.terrJus - projJusNovo;

    if (used === 'mantida') stats.trechosOk++;
    else stats.trechosCorrigidos++;

    if (hJusFinal < H_MIN) {
      stats.manualReview++;
      manualReview.push({ row: e.row + 1, ose1a: e.ose1a, ose: e.ose, motivo: 'h_jus = ' + hJusFinal.toFixed(2) + 'm < h_min', cf: projJusNovo.toFixed(3) });
    } else if (hJusFinal > H_WARN) {
      stats.warnings++;
      warnings.push({ row: e.row + 1, ose1a: e.ose1a, ose: e.ose, h: hJusFinal.toFixed(2), origem: used });
    }

    if (used === 'i_min') {
      const declOrig = (e.projMontOrig != null && e.projJusOrig != null) ? ((e.projMontOrig - e.projJusOrig)/e.compr*100).toFixed(2)+'%' : '?';
      const declNova = ((cfOut - projJusNovo)/e.compr*100).toFixed(2)+'%';
      fixes.push({ row: e.row + 1, ose1a: e.ose1a, ose: e.ose, mont: e.mont, jus: e.jus, decl_antes: declOrig, decl_depois: declNova, h_jus: hJusFinal.toFixed(2) });
    }

    // Marca chegada do PV jusante como resolvida; se todas resolvidas, enfileira
    const remIn = remainingIn[e.jus];
    if (remIn) {
      remIn.delete(e);
      if (remIn.size === 0) queue.push(e.jus);
    } else {
      queue.push(e.jus);
    }
  }
}

// PVs que sobraram (ciclo ou desconectado)
let nUnresolved = 0;
for (const pv of allPvs) if (cfSaida[pv] == null) nUnresolved++;
stats.cycles = nUnresolved;

// ===== Relatório =====
console.log();
console.log('--- Resumo ---');
console.log('Trechos totais:               ', edges.length);
console.log('Trechos OK (i mantida):       ', stats.trechosOk);
console.log('Trechos corrigidos (i_min):   ', stats.trechosCorrigidos);
console.log('PVs harmonizados (>1 entrada):', stats.pvsHarmonizados);
console.log('   ↳ degraus externos (≤50cm):', stats.degraus);
console.log('   ↳ tubos de queda (>50cm):  ', stats.tqsExt);
console.log('⚠ Avisos h>3m:               ', stats.warnings);
console.log('Revisão manual (h<h_min):    ', stats.manualReview);
console.log('PVs não resolvidos (ciclos): ', stats.cycles);
console.log();

if (harmonizations.length) {
  console.log('--- Harmonizações em PVs (15 primeiras) ---');
  for (const h of harmonizations.slice(0, 15)) {
    const drops = h.drops.length ? ' | drops: ' + h.drops.map(d => d.src + ' (' + d.tipo + ' ' + (Number(d.diff)*100).toFixed(0) + 'cm)').join(', ') : '';
    console.log(`  ${h.pv}  CF_saída=${h.escolhido}m  | ${h.chegadas.length} chegadas${drops}`);
  }
  if (harmonizations.length > 15) console.log(`  ... e mais ${harmonizations.length - 15}`);
  console.log();
}

if (fixes.length) {
  console.log('--- Trechos corrigidos (15 primeiros) ---');
  for (const f of fixes.slice(0, 15)) console.log(`  L${f.row}  ${f.ose1a}/${f.ose}  ${f.mont}→${f.jus}  i: ${f.decl_antes} → ${f.decl_depois}  h_jus=${f.h_jus}m`);
  if (fixes.length > 15) console.log(`  ... e mais ${fixes.length - 15}`);
  console.log();
}

if (manualReview.length) {
  console.log('--- Revisão manual ---');
  for (const m of manualReview.slice(0, 15)) console.log(`  L${m.row}  ${m.ose1a}/${m.ose}  ${m.motivo}`);
  console.log();
}

// ===== Gera planilha CORRIGIDA =====
console.log('--- Gerando planilha corrigida ---');
const outWb = xlsx.readFile(filePath, { cellFormula:false, cellNF:false, cellStyles:false });
const outWs = outWb.Sheets[outWb.SheetNames[0]];
let cellsChanged = 0;
for (const e of edges) {
  if (e.projMontFinal != null) {
    const a = xlsx.utils.encode_cell({ r: e.row, c: C.proj_mont });
    const cur = outWs[a];
    if (!cur || Math.abs((cur.v||0) - e.projMontFinal) > 1e-6) { outWs[a] = { v: e.projMontFinal, t: 'n' }; cellsChanged++; }
  }
  if (e.projJusFinal != null) {
    const a = xlsx.utils.encode_cell({ r: e.row, c: C.proj_jus });
    const cur = outWs[a];
    if (!cur || Math.abs((cur.v||0) - e.projJusFinal) > 1e-6) { outWs[a] = { v: e.projJusFinal, t: 'n' }; cellsChanged++; }
  }
}

const sFixes = [['Linha','OSE','Trecho','Mont','Jus','i antes','i depois','h_jus']];
for (const f of fixes) sFixes.push([f.row,f.ose1a,f.ose,f.mont,f.jus,f.decl_antes,f.decl_depois,f.h_jus]);
const sHarm = [['PV','Chegadas','CF_saída','Drops (degrau/TQ)']];
for (const h of harmonizations) sHarm.push([h.pv, h.chegadas.length, h.escolhido, h.drops.map(d=>d.src+' '+d.tipo+' '+(Number(d.diff)*100).toFixed(0)+'cm').join(' | ')]);
const sWarn = [['Linha','OSE','Trecho','h','Origem']];
for (const w of warnings) sWarn.push([w.row,w.ose1a,w.ose,w.h,w.origem]);
const sManual = [['Linha','OSE','Trecho','Motivo','CF']];
for (const m of manualReview) sManual.push([m.row,m.ose1a,m.ose,m.motivo,m.cf]);

xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(sFixes), 'Log Fixes');
xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(sHarm), 'Harmonizacoes');
if (warnings.length) xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(sWarn), 'Avisos h>3m');
if (manualReview.length) xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(sManual), 'Revisao Manual');

const dir = path.dirname(filePath);
const base = path.basename(filePath, path.extname(filePath));
const outPath = path.join(dir, base + '_GRAFO_FIX.xlsx');
xlsx.writeFile(outWb, outPath);
console.log('Células alteradas:', cellsChanged);
console.log('Salvo em:        ', outPath);
