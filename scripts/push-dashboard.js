#!/usr/bin/env node
/**
 * PUSH DO DASHBOARD DA DIRETORIA — independente do app Nexus.
 *
 * POR QUE ISSO EXISTE
 * O push pro Supabase morava SÓ dentro do Electron (src/main.js), então o painel
 * público só atualizava enquanto alguém deixava o Nexus aberto numa máquina que
 * enxergasse a planilha. Em 13/07/2026 a reorganização das pastas da Acciona
 * quebrou o caminho e o painel ficou 28 DIAS congelado — em silêncio, porque a
 * falha era engolida. Este script tira o painel dessa dependência.
 *
 * O QUE FAZ
 *   1. resolve a planilha (mesmo dashboardParser do app — fonte única de verdade)
 *   2. faz o parse
 *   3. upsert em dashboard_data (id=1) + snapshot diário em dashboard_history
 *   4. grava estado em ~/.nexus-dashboard-push.json (mtime do último push)
 *
 * USO
 *   node push-dashboard.js            → só empurra se a planilha mudou desde o último push
 *   node push-dashboard.js --force    → empurra sempre (é o modo do horário fixo 12:00)
 *
 * Sai com código 0 em sucesso OU quando não havia nada a fazer; 1 em erro real
 * (o Agendador de Tarefas mostra isso na coluna "Resultado da última execução").
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { createClient } = require('@supabase/supabase-js');
const { resolveXlsxPath, parseXlsxFile } = require('../src/dashboardParser');

const SUPA_URL = 'https://xszpzsmdpbgaiodeqcpi.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenB6c21kcGJnYWlvZGVxY3BpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTI5ODYsImV4cCI6MjA4OTg4ODk4Nn0.Wv_tcovD5nc13tmrfkgsVb6M6tS-CC7q6HVjphpzTrQ';

const STATE = path.join(os.homedir(), '.nexus-dashboard-push.json');
const FORCE = process.argv.includes('--force');

const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const log = (m) => console.log(`[${ts()}] ${m}`);

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) { return {}; }
}
function writeState(o) {
  try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch (e) { log('aviso: nao gravou estado: ' + e.message); }
}

// Mesma agregação do app (main.js::pushDashboardHistory) — curva S por dia.
function buildHistory(parsed) {
  const muns = (parsed.municipalities || []).filter(m => !String(m.seq).includes('.'));
  if (!muns.length) return null;
  const KEYS = ['topo', 'stream', 'sondT', 'sondS', 'projB', 'projR', 'projE'];
  let sum = 0, cnt = 0;
  const acc = {}; KEYS.forEach(k => acc[k] = { s: 0, n: 0 });
  const byMun = [];
  for (const m of muns) {
    let mS = 0, mN = 0;
    for (const k of KEYS) {
      const sv = m.svc?.[k]; if (!sv) continue;
      const p = (sv.pct != null) ? sv.pct : (sv.st === 'Finalizado' ? 100 : (sv.st === 'Em Execução' ? 50 : 0));
      sum += p; cnt++; acc[k].s += p; acc[k].n++; mS += p; mN++;
    }
    byMun.push({ mun: m.mun, pct: mN ? Math.round(mS / mN) : 0 });
  }
  const services = {};
  KEYS.forEach(k => services[k] = acc[k].n ? Math.round(acc[k].s / acc[k].n) : 0);
  return {
    snap_date: new Date().toISOString().slice(0, 10),
    avanco_geral: cnt ? +(sum / cnt).toFixed(2) : 0,
    snapshot: { services, byMun },
  };
}

(async () => {
  const xlsx = resolveXlsxPath(readState().xlsxPath || null);
  if (!xlsx) {
    log('ERRO: planilha nao encontrada. Confira REL_DIRS em src/dashboardParser.js.');
    process.exit(1);
  }
  const mtime = fs.statSync(xlsx).mtimeMs;
  const st = readState();
  log('planilha: ' + xlsx);

  if (!FORCE && st.lastMtime === mtime) {
    log('sem mudanca desde o ultimo push (' + (st.lastPush || '?') + ') — nada a fazer.');
    process.exit(0);
  }

  const data = parseXlsxFile(xlsx);
  const nMun = (data.municipalities || []).length;
  if (!nMun) { log('ERRO: parse devolveu 0 municipios — planilha errada ou aba "Controle" mudou.'); process.exit(1); }

  const supabase = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });

  const { error } = await supabase
    .from('dashboard_data')
    .upsert({ id: 1, data, updated_at: data.updatedAt }, { onConflict: 'id' });
  if (error) { log('ERRO push dashboard_data: ' + error.message); process.exit(1); }
  log(`dashboard_data OK — ${nMun} municipios, ${(data.entregas || []).length} entregas`);

  const hist = buildHistory(data);
  if (hist) {
    const { error: e2 } = await supabase.from('dashboard_history').upsert(hist, { onConflict: 'snap_date' });
    if (e2) log('aviso: dashboard_history falhou: ' + e2.message);
    else log(`dashboard_history OK — ${hist.snap_date} avanco=${hist.avanco_geral}`);
  }

  writeState({ xlsxPath: xlsx, lastMtime: mtime, lastPush: ts(), municipios: nMun });
  log('FIM');
})().catch(e => { log('EXCECAO: ' + (e && e.stack || e)); process.exit(1); });
