// Dashboard Diretoria — parser da planilha "01-Planilha Acompanhamento e Controle_2S INTERNA.xlsx"
// Baseado em dashboard_2s_10.html (parseData) e dashboard-2s/src/main.js
//
// ⚠ HISTÓRICO (11/08/2026): o painel público ficou 28 DIAS congelado (último push
// 13/07 15:38) porque a reorganização das pastas da Acciona levou
// "004. CT-027.2025 - PROJETOS" para "BACKUP_CT-027.2025 - PROJETOS" E a planilha
// foi renomeada (espaços → underscores). Os 3 fallbacks antigos partiam todos do
// mesmo trecho de caminho, então nenhum sobreviveu — e a falha era SILENCIOSA.
// Por isso agora: (1) pasta e nome separados, (2) lista de pastas candidatas
// incluindo a antiga, (3) match por PADRÃO de nome, não nome exato.

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

// Nome atual do arquivo (11/08/2026). NÃO confiar só nele — ver NAME_RE abaixo.
const XLSX_NAME = '01-Planilha_Acompanhamento_e_Controle_2S INTERNA.xlsx';

// Qualquer "01-Planilha ... Acompanhamento ... Controle ... .xlsx", com espaço ou
// underscore, ignorando temporários do Excel (~$...). Sobrevive a renomeação.
const NAME_RE = /^(?!~\$).*planilha[ _-]*acompanhamento[ _-]*e[ _-]*controle.*\.xlsx?$/i;

// Pasta ATUAL da planilha (relativa ao home), + as antigas como fallback.
const REL_DIRS = [
  path.join('OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA', '001. SERVIDOR PARANÁ',
            '002. ACCIONA', '001. BLOCO 02', '_CRONOGRAMAS', 'DASHBOARD ONLINE'),
  // legado — antes da reorganização de julho/2026
  path.join('OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA', '001. SERVIDOR PARANÁ',
            '002. ACCIONA', '004. CT-027.2025 - PROJETOS', '000. CRONOGRAMAS', 'DASHBOARD ONLINE'),
  path.join('OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA', '001. SERVIDOR PARANÁ',
            '002. ACCIONA', 'BACKUP_CT-027.2025 - PROJETOS', '000. CRONOGRAMAS', 'DASHBOARD ONLINE'),
];

const BASE_PATH_LCABD = path.join('C:\\Users\\lcabd', REL_DIRS[0], XLSX_NAME);
const REL_FROM_HOME = path.join(REL_DIRS[0], XLSX_NAME);   // mantido p/ compat.

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
 * Procura na PASTA um arquivo que case com NAME_RE. Se houver mais de um
 * (ex.: nome antigo + nome novo convivendo), devolve o de mtime mais recente.
 * Ignora a subpasta OBSOLETO — lá mora a versão morta da planilha.
 */
function pickInDir(dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    const hits = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && NAME_RE.test(e.name))
      .map(e => {
        const full = path.join(dir, e.name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch(_) {}
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return hits.length ? hits[0].full : null;
  } catch(_) { return null; }
}

/**
 * Resolve o caminho do XLSX considerando múltiplos usuários/máquinas.
 * 1) savedPath (escolha manual do usuário), se ainda existir
 * 2) para cada raiz OneDrive*2S ENGENHARIA* do home (e o home cru), tenta cada
 *    pasta de REL_DIRS — atual primeiro, legado depois — casando por PADRÃO de nome
 * 3) null se nada achado
 *
 * Casa por padrão (NAME_RE) em vez de nome exato de propósito: em 07/2026 a
 * planilha foi renomeada trocando espaços por underscores e o painel congelou.
 */
function resolveXlsxPath(savedPath) {
  const home = os.homedir();

  if (savedPath) {
    try { if (fs.existsSync(savedPath)) return savedPath; } catch(_) {}
    // savedPath morreu (renomearam o arquivo?) — tenta o padrão na mesma pasta
    const sibling = pickInDir(path.dirname(savedPath));
    if (sibling) return sibling;
  }

  // Raízes: o home direto + cada pasta OneDrive*2S ENGENHARIA* dentro dele.
  const roots = [home];
  try {
    for (const e of fs.readdirSync(home, { withFileTypes: true })) {
      if (e.isDirectory() && /OneDrive/i.test(e.name) && /2S ENGENHARIA/i.test(e.name)) {
        // REL_DIRS já começa com a pasta OneDrive; aqui entramos a partir dela,
        // então cortamos o 1º segmento do relativo.
        roots.push({ base: home, oneDrive: e.name });
      }
    }
  } catch(_) {}

  for (const rel of REL_DIRS) {
    // a) home + relativo completo (inclui o nome padrão da pasta OneDrive)
    const hit = pickInDir(path.join(home, rel));
    if (hit) return hit;
    // b) pasta OneDrive com nome diferente (outro tenant/usuário)
    const rest = rel.split(path.sep).slice(1).join(path.sep);
    for (const r of roots) {
      if (typeof r === 'string') continue;
      const h = pickInDir(path.join(r.base, r.oneDrive, rest));
      if (h) return h;
    }
  }

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
