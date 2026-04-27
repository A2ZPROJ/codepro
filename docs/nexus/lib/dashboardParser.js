// Dashboard Diretoria — parser da planilha "01-Planilha Acompanhamento e Controle_2S INTERNA.xlsx"
// Baseado em dashboard_2s_10.html (parseData) e dashboard-2s/src/main.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

// Caminho base configurado por Lucas (usuário atual lcabd)
const BASE_PATH_LCABD = 'C:\\Users\\lcabd\\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA\\001. SERVIDOR PARANÁ\\002. ACCIONA\\004. CT-027.2025 - PROJETOS\\000. CRONOGRAMAS\\DASHBOARD ONLINE\\01-Planilha Acompanhamento e Controle_2S INTERNA.xlsx';

// Relativo a partir do diretório de usuário
const REL_FROM_HOME = path.join(
  'OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA',
  '001. SERVIDOR PARANÁ',
  '002. ACCIONA',
  '004. CT-027.2025 - PROJETOS',
  '000. CRONOGRAMAS',
  'DASHBOARD ONLINE',
  '01-Planilha Acompanhamento e Controle_2S INTERNA.xlsx'
);

const SVC = [
  { key: 'topo',   lbl: 'Topografia',        sh: 'Topografia',     cs: 4,  cp: 5,  cr: 6  },
  { key: 'stream', lbl: 'Stream DP',          sh: 'Stream DP',      cs: 10, cp: 11, cr: 12 },
  { key: 'sondT',  lbl: 'Sondagem Trado',     sh: 'Sond. Trado',    cs: 16, cp: 17, cr: 18 },
  { key: 'sondS',  lbl: 'Sondagem SPT',       sh: 'Sond. SPT',      cs: 22, cp: 23, cr: 24 },
  { key: 'projB',  lbl: 'Projeto Básico',     sh: 'Proj. Básico',   cs: 28, cp: null, cr: null },
  { key: 'projR',  lbl: 'Proj. Exec. Redes',  sh: 'Proj. Ex. Redes',cs: 29, cp: 30, cr: 31 },
  { key: 'projE',  lbl: 'Proj. Exec. EEE',    sh: 'Proj. Ex. EEE',  cs: 35, cp: 36, cr: 37 },
];

/**
 * Resolve o caminho do XLSX considerando múltiplos usuários/máquinas.
 * 1) Substitui C:\Users\lcabd pelo %USERPROFILE% atual
 * 2) Se não existir, tenta o REL_FROM_HOME a partir do os.homedir()
 * 3) Se ainda não achar, glob manual por OneDrive*2S ENGENHARIA* dentro do home
 * 4) Retorna null se nada achado
 */
function resolveXlsxPath(savedPath) {
  const home = os.homedir();
  const candidates = [];

  if (savedPath) candidates.push(savedPath);

  // Troca C:\Users\lcabd pelo home atual
  candidates.push(BASE_PATH_LCABD.replace(/^C:\\Users\\lcabd/i, home));
  candidates.push(path.join(home, REL_FROM_HOME));

  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch(_) {}
  }

  // Glob manual: dentro de home, procura pastas OneDrive* com "2S ENGENHARIA"
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!/OneDrive/i.test(e.name)) continue;
      if (!/2S ENGENHARIA/i.test(e.name)) continue;
      const rest = REL_FROM_HOME.split(path.sep).slice(1).join(path.sep);
      const p = path.join(home, e.name, rest);
      if (fs.existsSync(p)) return p;
    }
  } catch(_) {}

  return null;
}

function parseXlsxFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Controle'];
  if (!ws) throw new Error('Aba "Controle" não encontrada na planilha.');
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const municipalities = [];
  for (let i = 4; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[1] || !row[2]) continue;
    const entry = { seq: row[1], mun: String(row[2]).trim(), svc: {} };
    SVC.forEach(s => {
      const st = row[s.cs] || 'A Executar';
      const pv = s.cp != null ? (parseFloat(row[s.cp]) || 0) : null;
      const re = s.cr != null ? (parseFloat(row[s.cr]) || 0) : null;
      const pct = (pv != null && re != null && pv > 0) ? Math.min(100, Math.round(re / pv * 100)) : null;
      entry.svc[s.key] = { st: String(st).trim(), pv, re, pct };
    });
    municipalities.push(entry);
  }

  // Aba "Entregas" (opcional). Lookup case-insensitive + mapeamento por nome do header.
  let entregas = [];
  try {
    const sheetName = wb.SheetNames.find(n => /entregas?/i.test(n));
    const wsE = sheetName ? wb.Sheets[sheetName] : null;
    if (wsE) {
      const rawE = XLSX.utils.sheet_to_json(wsE, { header: 1, defval: null, raw: true });
      // Header: linha 1 (índice 0)
      const header = (rawE[0] || []).map(h => String(h || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      const find = (...keys) => {
        for (const k of keys) {
          const idx = header.findIndex(h => h === k || h.includes(k));
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const iDate = find('data', 'date');
      const iDesc = find('descricao', 'descricao', 'desc', 'description');
      const iMun  = find('municipio', 'mun', 'cidade', 'city');
      const iTipo = find('tipo', 'type');
      const iStat = find('status', 'situacao');
      const pad2 = (n) => String(n).padStart(2,'0');
      const dkey = (y,m,d) => `${y}-${pad2(m)}-${pad2(d)}`;
      for (let i = 1; i < rawE.length; i++) {
        const r = rawE[i];
        if (!r) continue;
        let dt = iDate >= 0 ? r[iDate] : r[0];
        if (dt == null || dt === '') continue;
        let dateKey = null;
        if (dt instanceof Date && !isNaN(dt)) {
          // xlsx com cellDates devolve Date local; usa get* (não getUTC*)
          dateKey = dkey(dt.getFullYear(), dt.getMonth()+1, dt.getDate());
        } else if (typeof dt === 'number') {
          // Excel serial → Date local equivalente
          const ms = Math.round((dt - 25569) * 86400 * 1000);
          const d = new Date(ms);
          dateKey = dkey(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate());
        } else if (typeof dt === 'string' && dt.trim()) {
          const m = dt.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
          if (m) {
            const yy = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
            dateKey = dkey(yy, parseInt(m[2]), parseInt(m[1]));
          } else {
            const d = new Date(dt);
            if (!isNaN(d)) dateKey = dkey(d.getFullYear(), d.getMonth()+1, d.getDate());
          }
        }
        if (!dateKey) continue;
        const get = (i) => (i >= 0 && r[i] != null) ? String(r[i]).trim() : '';
        entregas.push({
          dateKey,                 // 'YYYY-MM-DD' canônico, sem fuso
          date: dateKey + 'T12:00:00', // mantém retro-compat se algo usar .date
          descricao: get(iDesc),
          municipio: get(iMun),
          tipo:      get(iTipo),
          status:    get(iStat),
        });
      }
    }
  } catch (_) { entregas = []; }

  return {
    municipalities,
    entregas,
    updatedAt: new Date().toISOString(),
    fileMtime: fs.statSync(filePath).mtime.toISOString(),
    filePath,
  };
}

module.exports = { resolveXlsxPath, parseXlsxFile, SVC, BASE_PATH_LCABD, REL_FROM_HOME };
