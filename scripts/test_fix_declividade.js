// test_fix_declividade.js
// FASE 2 (modo OFF) — Auto-fix de declividade
// Lê planilha GIS, agrupa trechos por OSE, percorre montante→jusante,
// corrige declividade baixa propagando o rebaixamento jusante.
// Detecta também trechos com declividade alta desnecessária (candidatos a TQ).
//
// Limites:
//   h_min = 1.10 m
//   (sem limite máximo — corrige sempre; gera AVISO quando h corrigido > 3m)
//   i_min = 1%  se h ≤ 3m   |   0.55%  se h > 3m
//   i_alta_threshold = 5%  (acima disso = candidato a TQ se h_jus ainda permite)
//
// Uso: node test_fix_declividade.js "<planilha.xls/.xlsx>"

'use strict';

const xlsx = require('xlsx');
const path = require('path');

const H_MIN = 1.10;
const H_WARN = 3.0;            // acima disso, gera aviso (mas corrige mesmo assim)
const I_MIN_SHALLOW = 0.01;    // h ≤ 3m
const I_MIN_DEEP    = 0.0055;  // h > 3m
const DEPTH_LIMIT   = 3.0;
const I_ALTA = 0.05;           // 5% — acima disso é "alta", candidato a TQ
const EPS = 5e-5;

// ===== Cell helpers =====
function cellVal(ws, r, c) {
  const a = xlsx.utils.encode_cell({ r, c });
  const cell = ws[a];
  return cell ? { val: cell.v } : { val: null };
}
function cellStr(ws, r, c) {
  const v = cellVal(ws, r, c).val;
  return (v != null && v !== '') ? String(v) : '';
}
function cellNum(ws, r, c) {
  const v = cellVal(ws, r, c).val;
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : null;
}

// ===== detectCols (mesma lógica do app) =====
const COL_ALIASES = {
  OSE1a:['ose1a'], OSE:['ose'], pv_mont:['pv_mont1','pv_mont'],
  pv_jus:['pv_jus'], terr_mont:['terr_mont'], terr_jus:['terr_jus'],
  proj_mont:['proj_mont'], proj_jus:['proj_jus'], prof_mont:['prof_mont'],
  prof_jus:['prof_jus'], compr:['compr','comprimento'],
};
function detectCols(ws, ref) {
  const map = {};
  for (let c = 0; c <= ref.e.c; c++) {
    const h = cellStr(ws, 0, c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if (!h) continue;
    for (const [k, ns] of Object.entries(COL_ALIASES)) {
      if (ns.includes(h) && map[k] == null) { map[k] = c; break; }
    }
  }
  for (const k of Object.keys(COL_ALIASES)) if (map[k] == null) map[k] = -1;
  return map;
}
function findMainEnd(ws, ref, pvJusCol) {
  for (let r = ref.e.r; r >= 1; r--) if (cellStr(ws, r, pvJusCol)) return r;
  return ref.e.r;
}

// ===== i_min em função de h =====
function iMinFor(h) {
  return h > DEPTH_LIMIT ? I_MIN_DEEP : I_MIN_SHALLOW;
}

// ===== MAIN =====
const filePath = process.argv[2];
if (!filePath) { console.error('Uso: node test_fix_declividade.js "<planilha>"'); process.exit(1); }

console.log('=== FASE 2 — Auto-fix de Declividade (TESTE OFF) ===\n');
console.log('Arquivo:', filePath);
console.log('Regras: h_min=' + H_MIN + 'm, AVISO quando h>' + H_WARN + 'm, i_min=1%/0.55%, i_alta_threshold=' + (I_ALTA*100) + '%\n');

const wb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, cellStyles: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const ref = xlsx.utils.decode_range(ws['!ref']);
const C = detectCols(ws, ref);
const lastMain = findMainEnd(ws, ref, C.pv_jus);
console.log('Linhas:', lastMain);

// 1) Coleta todos os trechos
const trechos = [];   // {row, ose1a, ose, pvMont, pvJus, terrMont, terrJus, projMont, projJus, profMont, profJus, compr}
for (let r = 1; r <= lastMain; r++) {
  const ose1a = cellStr(ws, r, C.OSE1a);
  if (!ose1a) continue;
  trechos.push({
    row: r,
    ose1a,
    ose: cellStr(ws, r, C.OSE),
    pvMont: cellStr(ws, r, C.pv_mont),
    pvJus:  cellStr(ws, r, C.pv_jus),
    terrMont: cellNum(ws, r, C.terr_mont),
    terrJus:  cellNum(ws, r, C.terr_jus),
    projMont: cellNum(ws, r, C.proj_mont),
    projJus:  cellNum(ws, r, C.proj_jus),
    compr:    cellNum(ws, r, C.compr),
  });
}

// 2) Agrupa por OSE
const oseGroups = {};
for (const t of trechos) {
  if (!oseGroups[t.ose1a]) oseGroups[t.ose1a] = [];
  oseGroups[t.ose1a].push(t);
}

// 3) Para cada OSE, ordena por sequência (usa pv_mont == pv_jus do anterior)
function sortOseChain(arr) {
  if (arr.length <= 1) return arr.slice();
  // Constrói mapa pvMont→trecho
  const byMont = {};
  for (const t of arr) byMont[t.pvMont] = t;
  // Encontra cabeça: pvMont não é pvJus de nenhum outro
  const justAll = new Set(arr.map(t => t.pvJus));
  const heads = arr.filter(t => !justAll.has(t.pvMont));
  if (!heads.length) return arr.slice();  // ciclo? retorna como está
  // Walk
  const ordered = [];
  let cur = heads[0];
  const visited = new Set();
  while (cur && !visited.has(cur.pvMont)) {
    visited.add(cur.pvMont);
    ordered.push(cur);
    cur = byMont[cur.pvJus] || null;
  }
  // Adiciona os que ficaram (bifurcações ou desconectados)
  for (const t of arr) if (!ordered.includes(t)) ordered.push(t);
  return ordered;
}

// 4) Processa cada OSE
const stats = {
  totalOses: Object.keys(oseGroups).length,
  totalTrechos: trechos.length,
  fixedDecl: 0,         // declividade baixa corrigida
  fixedContra: 0,       // contra-declive corrigido
  hExceeded: 0,         // h_min violado (caso raro)
  hWarn: 0,             // h > 3m (apenas aviso, correção aplicada)
  candidatosTQ: 0,      // i alta desnecessária
  jaOk: 0,
};
const fixes = [];      // [{row, ose1a, motivo, antes, depois}]
const manualReview = []; // [{row, ose1a, motivo}]
const warnings = [];   // [{row, ose1a, h, decl}]
const tqCandidates = []; // [{row, ose1a, i_atual, i_otimizada, ganho}]

for (const [ose1a, group] of Object.entries(oseGroups)) {
  const chain = sortOseChain(group);
  let prevProjJus = null;

  for (let i = 0; i < chain.length; i++) {
    const t = chain[i];
    if (t.compr == null || t.compr <= 0) continue;
    if (t.terrMont == null || t.terrJus == null) continue;
    if (t.projMont == null || t.projJus == null) continue;

    // 4.1) Propaga proj_mont do trecho anterior (mesma cadeia da OSE)
    if (prevProjJus != null) t.projMont = prevProjJus;

    // 4.2) Estado atual
    let hMont = t.terrMont - t.projMont;
    let hJus  = t.terrJus  - t.projJus;
    let desn  = t.projMont - t.projJus;
    let decl  = desn / t.compr;

    // 4.3) Verifica necessidade de correção
    const iMinAtual = iMinFor(Math.max(hMont, hJus));
    const needsFix = (decl < iMinAtual - EPS) || (desn < -0.001);

    if (needsFix) {
      // Recalcula proj_jus pra atender i_min — sempre aplica, sem teto
      let iAlvo = iMinAtual;
      let novoProjJus = t.projMont - iAlvo * t.compr;
      let novoH = t.terrJus - novoProjJus;
      // Se h passou de 3m, pode usar 0.55% (i mínimo mais brando) — economiza profundidade
      if (novoH > DEPTH_LIMIT) {
        iAlvo = I_MIN_DEEP;
        novoProjJus = t.projMont - iAlvo * t.compr;
        novoH = t.terrJus - novoProjJus;
      }

      if (novoH < H_MIN) {
        // Terreno jus muito raso ou cota errada — não dá pra corrigir baixando
        stats.hExceeded++;
        manualReview.push({
          row: t.row + 1, ose1a, ose: t.ose,
          motivo: 'h_jus corrigido seria ' + novoH.toFixed(2) + 'm < h_min=' + H_MIN + 'm',
          decl_atual: (decl*100).toFixed(2) + '%',
        });
      } else {
        const tipo = desn < -0.001 ? 'contra_declive' : 'decl_baixa';
        const antesDecl = (decl*100).toFixed(2) + '%';
        t.projJus = novoProjJus;
        const novaDecl = ((t.projMont - t.projJus) / t.compr * 100).toFixed(2) + '%';
        if (tipo === 'contra_declive') stats.fixedContra++;
        else stats.fixedDecl++;
        fixes.push({
          row: t.row + 1, ose1a, ose: t.ose, tipo,
          decl_antes: antesDecl, decl_depois: novaDecl,
          h_jus_novo: novoH.toFixed(2),
        });
        // Se profundidade ficou > H_WARN, gera aviso (mas correção foi aplicada)
        if (novoH > H_WARN) {
          stats.hWarn++;
          warnings.push({
            row: t.row + 1, ose1a, ose: t.ose,
            h_jus: novoH.toFixed(2), decl: novaDecl,
            motivo: 'Profundidade corrigida ' + novoH.toFixed(2) + 'm > ' + H_WARN + 'm — verifique se aceitável',
          });
        }
      }
    } else {
      stats.jaOk++;
      // Aviso pra trechos JÁ profundos (mesmo sem correção)
      if (Math.max(hMont, hJus) > H_WARN) {
        stats.hWarn++;
        warnings.push({
          row: t.row + 1, ose1a, ose: t.ose,
          h_jus: Math.max(hMont, hJus).toFixed(2), decl: (decl*100).toFixed(2) + '%',
          motivo: 'Profundidade ' + Math.max(hMont, hJus).toFixed(2) + 'm > ' + H_WARN + 'm (já no original)',
        });
      }
      // Detecta declividade alta desnecessária (candidato a TQ)
      if (decl > I_ALTA) {
        const iOtimo = iMinAtual;
        const projJusOtimo = t.projMont - iOtimo * t.compr;
        const ganhoCotaJus = t.projJus - projJusOtimo;
        if (ganhoCotaJus > 0.30) {
          stats.candidatosTQ++;
          tqCandidates.push({
            row: t.row + 1, ose1a, ose: t.ose,
            i_atual: (decl*100).toFixed(2) + '%',
            i_otimizada: (iOtimo*100).toFixed(2) + '%',
            ganho_cm: (ganhoCotaJus*100).toFixed(0),
          });
        }
      }
    }

    prevProjJus = t.projJus;
  }
}

// ===== Relatório =====
console.log('--- Resumo ---');
console.log('OSEs:                       ', stats.totalOses);
console.log('Trechos totais:             ', stats.totalTrechos);
console.log('Já OK (declividade boa):    ', stats.jaOk);
console.log('Corrigidos (decl baixa):    ', stats.fixedDecl);
console.log('Corrigidos (contra-decl):   ', stats.fixedContra);
console.log('Revisão manual (h<h_min):   ', stats.hExceeded);
console.log('⚠ Avisos (h>3m):            ', stats.hWarn);
console.log('Candidatos a TQ (i>5%):     ', stats.candidatosTQ);
console.log();

console.log('--- Amostra de correções (15 primeiras) ---');
for (const f of fixes.slice(0, 15)) {
  console.log(`  L${f.row}  ${f.ose1a}/${f.ose}  [${f.tipo}]  ${f.decl_antes} → ${f.decl_depois}  h_jus=${f.h_jus_novo}m`);
}
if (fixes.length > 15) console.log(`  ... e mais ${fixes.length - 15}`);
console.log();

if (warnings.length) {
  console.log('--- ⚠ Avisos de profundidade > 3m (20 primeiros) ---');
  for (const w of warnings.slice(0, 20)) {
    console.log(`  L${w.row}  ${w.ose1a}/${w.ose}  h=${w.h_jus}m  i=${w.decl}  ${w.motivo}`);
  }
  if (warnings.length > 20) console.log(`  ... e mais ${warnings.length - 20}`);
  console.log();
}

if (manualReview.length) {
  console.log('--- Revisão manual ---');
  for (const m of manualReview.slice(0, 15)) {
    console.log(`  L${m.row}  ${m.ose1a}/${m.ose}  [decl=${m.decl_atual}]  ${m.motivo}`);
  }
  if (manualReview.length > 15) console.log(`  ... e mais ${manualReview.length - 15}`);
  console.log();
}

if (tqCandidates.length) {
  console.log('--- Candidatos a otimização com TQ (15 primeiros) ---');
  for (const t of tqCandidates.slice(0, 15)) {
    console.log(`  L${t.row}  ${t.ose1a}/${t.ose}  i:${t.i_atual} → ${t.i_otimizada}  (CF jus +${t.ganho_cm}cm = TQ ext.)`);
  }
  if (tqCandidates.length > 15) console.log(`  ... e mais ${tqCandidates.length - 15}`);
}

// ===== Gera planilha CORRIGIDA =====
console.log('\n--- Gerando planilha corrigida ---');
const outWb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, cellStyles: false });
const outWs = outWb.Sheets[outWb.SheetNames[0]];
let cellsChanged = 0;
for (const t of trechos) {
  const addr = xlsx.utils.encode_cell({ r: t.row, c: C.proj_jus });
  const cur = outWs[addr];
  const newVal = t.projJus;
  if (cur && Math.abs((cur.v || 0) - newVal) > 1e-6) {
    outWs[addr] = { v: newVal, t: 'n' };
    cellsChanged++;
  }
  // Atualiza proj_mont também (propagação)
  const addrM = xlsx.utils.encode_cell({ r: t.row, c: C.proj_mont });
  const curM = outWs[addrM];
  if (curM && Math.abs((curM.v || 0) - t.projMont) > 1e-6) {
    outWs[addrM] = { v: t.projMont, t: 'n' };
    cellsChanged++;
  }
}

// Sheet de log
const logAvisos = [['Linha', 'OSE', 'Trecho', 'h (m)', 'i', 'Motivo']];
for (const w of warnings) logAvisos.push([w.row, w.ose1a, w.ose, w.h_jus, w.decl, w.motivo]);
const logFixes = [['Linha', 'OSE', 'Trecho', 'Tipo', 'i antes', 'i depois', 'h_jus (m)']];
for (const f of fixes) logFixes.push([f.row, f.ose1a, f.ose, f.tipo, f.decl_antes, f.decl_depois, f.h_jus_novo]);
const logManual = [['Linha', 'OSE', 'Trecho', 'i atual', 'Motivo']];
for (const m of manualReview) logManual.push([m.row, m.ose1a, m.ose, m.decl_atual, m.motivo]);

xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(logFixes), 'Log Fixes');
if (warnings.length) xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(logAvisos), 'Avisos h>3m');
if (manualReview.length) xlsx.utils.book_append_sheet(outWb, xlsx.utils.aoa_to_sheet(logManual), 'Revisao Manual');

const dir = path.dirname(filePath);
const base = path.basename(filePath, path.extname(filePath));
const outPath = path.join(dir, base + '_DECL_FIX.xlsx');
xlsx.writeFile(outWb, outPath);
console.log('Células alteradas:  ', cellsChanged);
console.log('Salvo em:           ', outPath);
console.log('Sheets adicionadas: Log Fixes' + (warnings.length ? ', Avisos h>3m' : '') + (manualReview.length ? ', Revisao Manual' : ''));
