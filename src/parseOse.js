/**
 * parseOse.js — Parser OSE em Node.js puro (sem Python)
 * Alinhado ao script de referência extract_ose_v2.py.
 *
 * Mudanças importantes vs versão anterior:
 *  - parseExcel agora agrupa LINHAS por PV/TL dentro da aba e expõe
 *    cf_chegada / cf_pv / prof_chegada / prof_pv / tq / has_tq.
 *  - Coluna correta de C.Topo (xlsx 0-indexed: c=7, col H).
 *  - parsePerfisDxf separa cota de chegada (≈ -12.2) e saída (≈ -9.6)
 *    relativas ao dy_pv detectado dinamicamente. Aceita layer
 *    SES-TXT e A-ANOTACAO. Usa 3ª linha numerica de cada bloco
 *    multilinha (GI do tubo).
 *  - parseMapaDxf inalterado nos casos felizes; regex já casa
 *    `\PCT:` `\PCF:` `\Ph:`.
 *  - buildComparison devolve excel_cf_chegada/excel_cf_pv/etc. e
 *    perf_cf_chegada/perf_cf_saida, mantendo excel_cf/excel_h legados.
 */
'use strict';

const fs   = require('fs');
const xlsx = require('xlsx');

// ── UTILS ──────────────────────────────────────────────────────────────────
function normalizeId(s) {
  return String(s).trim().replace(/[\s\-]+/g, '').toUpperCase()
    .replace(/([A-Z]+)0*(\d+)$/, (_, prefix, num) => prefix + parseInt(num, 10));
}

function pf(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function rnd(v, d) {
  if (v == null) return null;
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function lastNum(raw) {
  const s = raw
    .replace(/\\f[^;]*;/gi, '')
    .replace(/\\[A-Za-z]\d*;?/g, '')
    .replace(/[{}]/g, '');
  const matches = [...s.matchAll(/\d+[.,]\d+|\d+/g)];
  if (!matches.length) return null;
  return parseFloat(matches[matches.length - 1][0].replace(',', '.'));
}

function firstNum(raw) {
  const s = raw
    .replace(/\\f[^;]*;/gi, '')
    .replace(/\\[A-Za-z]\d*;?/g, '')
    .replace(/[{}]/g, '');
  const m = s.match(/\d+[.,]\d+|\d+/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

// Limpa control codes de MTEXT raw, preservando quebras (\P → \n, ^J → \n)
function cleanMtext(raw) {
  let s = String(raw);
  s = s.replace(/\\f[^;]*;/gi, '');
  s = s.replace(/\\[Cc]\d+;/g, '');
  s = s.replace(/\\pxqc;/gi, '');
  s = s.replace(/\\P/g, '\n').replace(/\^J/g, '\n');
  s = s.replace(/[{}]/g, '');
  return s.trim();
}

// Extrai o "GI do tubo" (3ª linha numérica de um bloco multilinha)
function extractGiTubo(raw) {
  const t = cleanMtext(raw);
  const lines = t.split('\n')
    .map(l => l.trim())
    .filter(l => /^\d{2,4}[.,]\d{2,4}$/.test(l));
  if (lines.length >= 3) {
    return parseFloat(lines[2].replace(',', '.'));
  }
  return null;
}

// ── DXF GROUP PAIRS ────────────────────────────────────────────────────────
function parseDxfGroups(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!isNaN(code)) {
      out.push({ code, val: lines[i + 1] });
    } else {
      i -= 1;
    }
  }
  return out;
}

// ── MAPA DXF ───────────────────────────────────────────────────────────────
function parseMapaDxf(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const groups = parseDxfGroups(text);

  const pvs  = {};
  const oses = {};
  const pvCoords = {};  // id_norm → { x, y } (UTM do DXF)

  let etype  = null;
  let mlBuf  = '';
  let mtText = '';
  let mlX = null, mlY = null;

  function flushMultiLeader() {
    if (!mlBuf) return;
    // Aceita PV-###, TL-###, PIT-###, TQ-### e variantes com qualificador
    // intermediário como PV-EX-### (existente) ou PV-INT-### (interligação).
    const mId = mlBuf.match(/;((?:PV|TL|PIT|TQ)(?:[\s\-]+[A-Z]{1,4})?[\s\-]+\d+)/i);
    const cleaned = mlBuf.replace(/\\f[^;]*;/gi, '').replace(/[{}]/g, '');
    const mCt = cleaned.match(/(?:\\P|^|\s)CT\s*:\s*([\d.,]+)/i);
    const mCf = cleaned.match(/(?:\\P|^|\s)CF\s*:\s*([\d.,]+)/i);
    const mH  = cleaned.match(/(?:\\P|^|\s|;)h\s*:\s*([\d.,]+)/i);
    if (mId && mCt && mCf) {
      const pid = normalizeId(mId[1]);
      const ct = parseFloat(mCt[1].replace(',', '.'));
      const cf = parseFloat(mCf[1].replace(',', '.'));
      const h  = mH ? parseFloat(mH[1].replace(',', '.')) : null;
      // Um mesmo PV pode ter vários multileaders no mapa (um por tubo
      // chegando/saindo). CF_chegada > CF_fundo; para casar com a cf_pv
      // da planilha (fundo real = min) pegamos a CF MÍNIMA, e o h MÁXIMO
      // (fundo mais profundo). Antes o parser sobrescrevia com o último
      // rótulo, que poderia ser o da chegada e virava falso "CF divergente".
      const prev = pvs[pid];
      if (!prev) {
        pvs[pid] = { ct, cf, h };
      } else {
        if (cf < prev.cf) prev.cf = cf;
        if (h != null && (prev.h == null || h > prev.h)) prev.h = h;
        // CT teoricamente é o mesmo; mantém o primeiro, mas se faltar registra
        if (prev.ct == null && ct != null) prev.ct = ct;
      }
      if (mlX != null && mlY != null) pvCoords[pid] = { x: mlX, y: mlY };
    }
    mlBuf = ''; mlX = null; mlY = null;
  }

  function flushMtext() {
    if (!mtText) return;
    const plain = mtText.replace(/\\f[^;]*;/gi, '').replace(/[{}]/g, '');
    // Unidade `m` após o valor de L é OPCIONAL — muitos rótulos vêm como
    // `L=25,09\PØ150mm  i=0,0470` (o `m` só aparece em `mm` depois).
    // Antes o regex exigia `m` logo após o número, derrubando a OSE.
    const m = plain.match(/OSE[\s\-]+(\d+)\b[\s\S]*?L=\s*([\d.,]+)\s*m?[\s\S]*?i\s*=\s*([\d.,]+)/i);
    if (m) {
      const num = m[1].padStart(3, '0');
      oses[num] = {
        L: parseFloat(m[2].replace(',', '.')),
        i: parseFloat(m[3].replace(',', '.')),
      };
    }
    mtText = '';
  }

  for (const { code, val } of groups) {
    if (code === 0) {
      flushMultiLeader();
      flushMtext();
      etype = val;
      mlBuf = ''; mlX = null; mlY = null;
      mtText = '';
    } else if (etype === 'MULTILEADER') {
      if (code === 304 || code === 302 || code === 1) mlBuf += val;
      if (code === 10 && mlX == null) mlX = parseFloat(val);
      if (code === 20 && mlY == null) mlY = parseFloat(val);
    } else if (etype === 'MTEXT') {
      if (code === 1 || code === 3) mtText += val;
    }
  }
  flushMultiLeader();
  flushMtext();

  return { pvs, oses, pvCoords };
}

// ── PERFIS DXF ─────────────────────────────────────────────────────────────
function parsePerfisDxf(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const groups = parseDxfGroups(text);

  // Coleta TODAS as TEXT e MTEXT (independente do layer; filtramos depois)
  const items = []; // { x, y, layer, text, type }
  let etype = null, layer = '', x = null, y = null, txt = '';
  function flush() {
    if ((etype === 'MTEXT' || etype === 'TEXT') && x != null && y != null) {
      items.push({ x, y, layer, text: txt, type: etype });
    }
    layer = ''; x = null; y = null; txt = '';
  }
  for (const { code, val } of groups) {
    if (code === 0) {
      flush();
      etype = val;
    } else if (etype === 'MTEXT' || etype === 'TEXT') {
      if      (code === 8)  layer = val;
      else if (code === 10) x = parseFloat(val);
      else if (code === 20) y = parseFloat(val);
      else if (etype === 'TEXT' && code === 1) txt = val;
      else if (etype === 'MTEXT' && (code === 1 || code === 3)) txt += val;
    }
  }
  flush();

  // 1) acha presença das OSEs via layouts (compat com formato antigo)
  const present = new Set();
  // procurar em items qualquer "OSE - NNN" ancorado em SES-TXT como anchor de presença
  for (const it of items) {
    const t = cleanMtext(it.text);
    const m = t.match(/OSE\s*-\s*(\d+)/);
    if (m && it.layer === 'SES-TXT') present.add(m[1].padStart(3, '0'));
  }

  // 2) Para cada OSE presente: localizar anchor, dy_pv, columns, e extrair PV data
  // Mas o consumidor (buildComparison) pede um dict global pv_id → dados.
  // Vamos varrer cada anchor "OSE - NNN" SES-TXT, achar candidatos PV/TL nas
  // janelas, calcular dy_pv local e extrair os blocos.
  const pvResult = {}; // id_norm → { ct, h, cf, cf_chegada, cf_saida, decl, ext_acum }
  // Per-OSE info: ose → { L: max ext_acum in block, i: declividade do trecho, pvs: { id_norm: { ext_acum, decl } } }
  const perOse = {};

  // todas as anchors "OSE - NNN" em SES-TXT
  const anchors = [];
  for (const it of items) {
    if (it.layer !== 'SES-TXT') continue;
    const t = cleanMtext(it.text);
    const m = t.match(/^OSE\s*-\s*(\d+)$/) || t.match(/OSE\s*-\s*(\d+)/);
    if (m && /OSE/.test(t)) {
      anchors.push({ x: it.x, y: it.y, ose: m[1].padStart(3, '0') });
    }
  }

  for (const a of anchors) {
    const cx = a.x, cy = a.y;
    // candidatos PV/TL na janela típica
    const cands = [];
    for (const it of items) {
      const dx = it.x - cx, dy = it.y - cy;
      if (!(dy > -100 && dy < -15 && dx > -150 && dx < 150)) continue;
      if (it.layer !== 'SES-TXT' && it.layer !== 'A-ANOTACAO') continue;
      const t = cleanMtext(it.text);
      // Aceita PV/TL/PIT/TQ e variantes com qualificador intermediário
      // (PV-EX-###, PV-INT-### etc.). Sem isso, blocos de OSE que começam
      // num PV existente/interligação ficavam com 1 só candidato, dy_pv
      // distorcido e ext_acum=0 → falso "Perfil ausente".
      if (/^(?:PV|TL|PIT|TQ)(?:-[A-Z]{1,4})?-\d+$/.test(t)) {
        cands.push({ name: t, dx, dy, x: it.x, y: it.y });
      }
    }
    if (!cands.length) continue;
    const dyPv = cands.reduce((s, c) => s + c.dy, 0) / cands.length;

    // por nome → primeira ocorrência (col_dx, col_y)
    const cols = {};
    for (const c of cands) {
      if (!(c.name in cols)) cols[c.name] = c;
    }

    // Offsets relativos ao dy_pv
    const OFF_TOPO   = [-7.5, -6.0];
    const OFF_CS     = [-10.0, -9.0];
    const OFF_CC     = [-12.8, -11.5];
    const OFF_PROF   = [-16.25, -15.25];
    const OFF_EXTAC  = [-23.0, -22.0];
    const OFF_DECL   = [-25.0, -23.5];

    const blockPvs = {}; // id_norm → { ext_acum, decl }
    for (const name in cols) {
      const colDx = cols[name].dx;
      const rec = { ct: null, h: null, cf: null,
                    cf_chegada: null, cf_saida: null,
                    ext_acum: null, decl: null };

      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx - colDx) > 2.0) continue;
        const rdy = dy - dyPv;
        if (!(rdy > -30 && rdy < 5)) continue;
        const t = cleanMtext(it.text);

        if (rdy > OFF_TOPO[0] && rdy < OFF_TOPO[1] && /^\d{2,4}[.,]\d{2,4}/.test(t)) {
          const n = parseFloat(t.split(/\s+/)[0].replace(',', '.'));
          if (!isNaN(n) && n >= 100) rec.ct = n;
        } else if (rdy > OFF_CS[0] && rdy < OFF_CS[1] && t.includes('\n')) {
          const v = extractGiTubo(it.text);
          if (v != null) rec.cf_saida = v;
        } else if (rdy > OFF_CC[0] && rdy < OFF_CC[1] && t.includes('\n')) {
          const v = extractGiTubo(it.text);
          if (v != null) rec.cf_chegada = v;
        } else if (rdy > OFF_PROF[0] && rdy < OFF_PROF[1] && /^\d+[.,]\d+$/.test(t)) {
          const n = parseFloat(t.replace(',', '.'));
          if (!isNaN(n) && n > 0 && n < 20) rec.h = n;
        } else if (rdy > OFF_EXTAC[0] && rdy < OFF_EXTAC[1] && /\d+\.\d+m/.test(t)) {
          const m = t.match(/([\d.]+)m/);
          if (m) rec.ext_acum = parseFloat(m[1]);
        } else if (rdy > OFF_DECL[0] && rdy < OFF_DECL[1]) {
          // No DXF real a célula de declividade vem como MTEXT multi-linha:
          //   "0.0224\n2.24%"   (m/m + percentual, empilhados)
          // Pode também vir só uma linha em qualquer formato. Estratégia:
          // varre linhas, tenta casar decimal (com ou sem %); aceita a primeira
          // que for válida. Se tem % OU n>=1 → divide por 100 pra pt no formato m/m.
          const lines = t.split('\n').map(l => l.trim().replace(',', '.'));
          for (const ln of lines) {
            const m = ln.match(/^([\d.]+)\s*%?$/);
            if (!m) continue;
            let n = parseFloat(m[1]);
            if (isNaN(n) || n <= 0) continue;
            if (ln.includes('%') || n >= 1) n = n / 100;
            if (n > 0 && n < 0.2) { rec.decl = n; break; }
          }
        }
      }
      // canonical cf = fundo real do PV = menor entre saída e chegada
      if (rec.cf_saida != null && rec.cf_chegada != null) {
        rec.cf = Math.min(rec.cf_saida, rec.cf_chegada);
      } else {
        rec.cf = rec.cf_saida != null ? rec.cf_saida : rec.cf_chegada;
      }

      const id_norm = normalizeId(name);
      // Bloco-local: guarda dados deste PV neste bloco da OSE
      blockPvs[id_norm] = {
        ext_acum: rec.ext_acum, decl: rec.decl,
        cf: rec.cf, cf_chegada: rec.cf_chegada, cf_saida: rec.cf_saida,
        ct: rec.ct, h: rec.h,
      };

      // só armazena no global se houver algum dado
      if (rec.ct != null || rec.cf != null || rec.h != null || rec.ext_acum != null || rec.decl != null) {
        // Para campos NÃO-locais (ct, cf, cf_chegada, cf_saida, h) — merge global é OK
        // pois esses valores não dependem da OSE. Mas ext_acum e decl PODEM variar
        // entre blocos do mesmo PV (PV é compartilhado entre trechos), então NÃO
        // mescla esses no global — guardamos só os "estáveis".
        const prev = pvResult[id_norm];
        const stable = {
          ct: rec.ct, h: rec.h,
          cf: rec.cf, cf_chegada: rec.cf_chegada, cf_saida: rec.cf_saida,
          // mantém ext_acum/decl no global apenas como fallback (primeiro visto)
          ext_acum: rec.ext_acum, decl: rec.decl,
        };
        if (!prev) {
          pvResult[id_norm] = stable;
        } else {
          for (const k of Object.keys(stable)) {
            if (stable[k] != null && prev[k] == null) prev[k] = stable[k];
          }
          // cf canônico = menor entre todos os blocos (fundo real do PV)
          if (stable.cf != null && prev.cf != null) {
            prev.cf = Math.min(prev.cf, stable.cf);
          }
          // Acumula cf_chegada (maior) e cf_saida (menor) de todos os blocos
          if (stable.cf_chegada != null) {
            prev.cf_chegada = prev.cf_chegada != null ? Math.max(prev.cf_chegada, stable.cf_chegada) : stable.cf_chegada;
          }
          if (stable.cf_saida != null) {
            prev.cf_saida = prev.cf_saida != null ? Math.min(prev.cf_saida, stable.cf_saida) : stable.cf_saida;
          }
        }
      }
    }

    // Calcula L e i do trecho desta OSE a partir do bloco
    const exts = Object.values(blockPvs).map(b => b.ext_acum).filter(v => v != null);
    const decls = Object.values(blockPvs).map(b => b.decl).filter(v => v != null);
    const Lblock = exts.length ? Math.max(...exts) : null;
    const Iblock = decls.length ? Math.max(...decls) : null;
    if (!perOse[a.ose] || (Lblock != null && (perOse[a.ose].L == null || Lblock > perOse[a.ose].L))) {
      perOse[a.ose] = { L: Lblock, i: Iblock, pvs: blockPvs };
    }
  }

  return { present: Array.from(present).sort(), pvs: pvResult, perOse };
}

// ── EXCEL ──────────────────────────────────────────────────────────────────
function parseExcel(filePath) {
  const wb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, sheetStubs: false });
  const result = {};

  for (const sheetName of wb.SheetNames) {
    // Aceita somente `OSE-NNN` exato (sem sufixo). Sheets como `OSE-077A`,
    // `OSE-052A` etc. são cópias/trechos alternativos: o mapa sempre
    // rotula apenas a OSE principal. Se incluíssemos o sufixo, o A
    // sobrescrevia a OSE principal e o i/cf ficava divergente do mapa
    // (falso "i mapa vs planilha").
    const m = sheetName.match(/^OSE[\s\-]+(\d+)$/i);
    if (!m) continue;
    const oseNum = m[1].padStart(3, '0');
    const ws = wb.Sheets[sheetName];

    // Comprimento total: cell C6
    let comp = null;
    const c6 = ws[xlsx.utils.encode_cell({ r: 5, c: 2 })];
    if (c6 && typeof c6.v === 'number') comp = rnd(c6.v, 4);

    // Header em row 10 (0-indexed 9), data a partir de row 11 (0-indexed 10)
    const dataStart = 10;
    const ref = ws['!ref'] ? xlsx.utils.decode_range(ws['!ref']) : null;
    const lastRow = ref ? ref.e.r : (dataStart + 500);

    // Agrupa por nome (TL|PV)-\d+
    const order = [];
    const grouped = {};
    let emptyStreak = 0;

    for (let r = dataStart; r <= lastRow; r++) {
      const cellA = ws[xlsx.utils.encode_cell({ r, c: 0 })];
      if (!cellA || cellA.v == null || String(cellA.v).trim() === '') {
        if (++emptyStreak >= 5) break;
        continue;
      }
      emptyStreak = 0;
      const id = String(cellA.v).trim();
      if (!/^(TL|PV|PIT)/i.test(id)) continue;

      const get = (c) => {
        const cell = ws[xlsx.utils.encode_cell({ r, c })];
        return cell && typeof cell.v === 'number' ? cell.v : null;
      };
      const getStr = (c) => {
        const cell = ws[xlsx.utils.encode_cell({ r, c })];
        return cell && cell.v != null ? String(cell.v) : '';
      };

      const rec = {
        id,
        ct:        get(7),   // col H — C. Topo
        cf:        get(9),   // col J — C. Fundo
        dist_acum: get(6),   // col G — Dist. Acumulada
        decl:      get(14),  // col O — Declividade
        diam:      get(15),  // col P — Diam. Interno (mm)
        prof:      get(18),  // col S — Prof. Vala
        obs:       getStr(20), // col U — Observações
      };

      if (!grouped[id]) {
        grouped[id] = [];
        order.push(id);
      }
      grouped[id].push(rec);
    }

    // Filtra: só PV/TL (sem PIT) para o relatório consolidado, mas mantemos PIT
    // disponíveis se necessário. Para casamento de PVs com mapa/perfil vamos
    // expor um array `pvs` consolidado por nome (1 entrada por PV).
    const pvs = [];
    for (const id of order) {
      if (/^PIT/i.test(id)) continue;  // PITs fora do relatório principal
      const rows = grouped[id];

      // Filtra linhas "lixo" (valor sentinel 42 em todas as colunas numéricas
      // ou rows com cf duvidoso). Critério simples: cf precisa ser número
      // razoável (>= 50). Alternativa: ignorar linhas em que ct == cf == prof.
      const cleanRows = rows.filter(row => {
        if (row.cf == null) return false;
        if (row.cf < 50) return false;       // 42 sentinel etc.
        if (row.ct != null && row.ct < 50) return false;
        return true;
      });
      if (!cleanRows.length) continue;

      // limita a 2 primeiras linhas (chegada + fundo PV)
      const useRows = cleanRows.slice(0, 2);
      const cfs   = useRows.map(r => r.cf).filter(v => v != null);
      const profs = useRows.map(r => r.prof).filter(v => v != null);
      const cf_pv = cfs.length ? Math.min(...cfs) : null;
      const cf_ch = cfs.length ? Math.max(...cfs) : null;
      const pr_pv = profs.length ? Math.max(...profs) : null;
      const pr_ch = profs.length ? Math.min(...profs) : null;

      let tq = 0;
      for (const row of useRows) {
        const m = row.obs.match(/T\.Q\.\s*([\d.,]+)\s*m/i);
        if (m) {
          const v = parseFloat(m[1].replace(',', '.'));
          if (!isNaN(v) && v > tq) tq = v;
        }
      }
      // se obs traz "T.Q.  m" (sem valor), não conta como degrau
      if (tq === 0 && cf_ch != null && cf_pv != null) {
        const diff = cf_ch - cf_pv;
        if (diff > 0.001) tq = diff;
      }
      const has_tq = tq > 0.001;

      const base = useRows[0];
      pvs.push({
        id,
        id_norm:    normalizeId(id),
        ct:         rnd(base.ct, 4),
        cf:         rnd(cf_pv, 4),               // legado: cf == cf_pv
        cf_pv:      rnd(cf_pv, 4),
        cf_chegada: rnd(cf_ch, 4),
        prof:       rnd(pr_pv, 4),               // legado: prof == prof_pv
        prof_pv:    rnd(pr_pv, 4),
        prof_chegada: rnd(pr_ch, 4),
        dist_acum:  rnd(base.dist_acum, 4),
        decl:       rnd(base.decl, 6),
        diam:       base.diam != null ? Math.round(base.diam) : null, // DN interno (mm)
        tq:         rnd(tq, 4),
        has_tq,
      });
    }

    result[oseNum] = { comprimento: comp, pvs };
  }

  return result;
}

// ── COMPARAÇÃO ─────────────────────────────────────────────────────────────
function diff(a, b, digits) {
  if (a == null || b == null) return null;
  return rnd(Math.abs(a - b), digits != null ? digits : 4);
}

function buildComparison(mapa, perfis, excel) {
  const perfisList = perfis.present;
  const perfisPvs  = perfis.pvs;
  const perOse     = perfis.perOse || {};
  const mapCoords  = mapa.pvCoords || {};

  const allNums = [...new Set([
    ...Object.keys(mapa.oses),
    ...Object.keys(excel),
    ...perfisList,
  ])].sort();

  return allNums.map(num => {
    const mapaOse  = mapa.oses[num]  || {};
    const excelOse = excel[num]      || {};
    const inPerfil = perfisList.includes(num);
    const inMapa   = num in mapa.oses;
    const inExcel  = num in excel;

    const excelPvs = excelOse.pvs || [];
    const excelL   = excelOse.comprimento != null ? excelOse.comprimento : null;

    let excelI = null;
    for (const ep of excelPvs) {
      if (ep.decl != null) { excelI = ep.decl; break; }
    }

    const mapaL = mapaOse.L != null ? mapaOse.L : null;
    const mapaI = mapaOse.i != null ? mapaOse.i : null;

    const pvComps = [];
    const seen = new Set();
    for (const ep of excelPvs) {
      const pid = ep.id_norm;
      if (seen.has(pid)) continue;
      seen.add(pid);

      const mpv = mapa.pvs[pid]   || {};
      const ppv = perfisPvs[pid]  || {};
      const blockPv = (perOse[num] && perOse[num].pvs && perOse[num].pvs[pid]) || {};
      const pv_ext_local  = blockPv.ext_acum != null ? blockPv.ext_acum : ppv.ext_acum;
      const pv_decl_local = blockPv.decl     != null ? blockPv.decl     : ppv.decl;

      // CF do perfil: usa dados do bloco desta OSE se disponível, senão global.
      // Para cf_chegada e cf_saida: bloco tem prioridade.
      // Para cf canônico: se o bloco tem cf_saida, usa ele (fundo real);
      // senão fallback para global cf (que é o min de todos os blocos).
      const blk_cf_chegada  = blockPv.cf_chegada  != null ? blockPv.cf_chegada  : ppv.cf_chegada;
      const blk_cf_saida    = blockPv.cf_saida    != null ? blockPv.cf_saida    : ppv.cf_saida;
      // cf canônico para comparação com excel_cf_pv:
      // Escolhe o cf do perfil que melhor corresponde ao cf_pv da planilha.
      // Se o bloco tem ambos (cf_chegada e cf_saida), pega o mais próximo do excel_cf_pv.
      // Senão, pega o que existir (bloco ou global).
      let blk_cf;
      if (blk_cf_saida != null && blk_cf_chegada != null && ep.cf_pv != null) {
        // Escolhe o mais próximo do valor da planilha
        const dSaida   = Math.abs(ep.cf_pv - blk_cf_saida);
        const dChegada = Math.abs(ep.cf_pv - blk_cf_chegada);
        blk_cf = dSaida <= dChegada ? blk_cf_saida : blk_cf_chegada;
      } else {
        blk_cf = blk_cf_saida != null ? blk_cf_saida
               : blk_cf_chegada != null ? blk_cf_chegada
               : (blockPv.cf != null ? blockPv.cf : ppv.cf);
      }
      const blk_ct          = blockPv.ct          != null ? blockPv.ct          : ppv.ct;
      const blk_h           = blockPv.h           != null ? blockPv.h           : ppv.h;

      // T.Q. calculado pelo perfil + planilha:
      //   CF PV (calc)    = CT planilha − profundidade planilha
      //   T.Q. calculado  = GI tubo de chegada (perfil) − CF PV (calc)
      //
      // Só calcula quando a PLANILHA declara que existe degrau neste PV
      // (cf_chegada > cf_pv). Em PVs de junção (início do trecho desta OSE
      // mas ponto de chegada de outra OSE), o perfil mostra o GI do tubo
      // da OUTRA OSE, o que faria o cálculo virar falso positivo. Quando
      // a planilha diz "sem degrau", confiamos na planilha e não validamos.
      let tq_calc   = null;
      let diff_tq   = null;
      const gi_cheg = blk_cf_chegada != null ? blk_cf_chegada : null;
      const planilhaDeclaraStep = ep.cf_chegada != null
                               && ep.cf_pv      != null
                               && (ep.cf_chegada - ep.cf_pv) > 1e-4;
      if (planilhaDeclaraStep && ep.ct != null && ep.prof_pv != null && gi_cheg != null) {
        const cfCalc = ep.ct - ep.prof_pv;
        tq_calc = rnd(gi_cheg - cfCalc, 4);
        // Arredonda T.Q. negativos muito pequenos pra zero (ruído numérico).
        if (tq_calc < 0 && tq_calc > -0.005) tq_calc = 0;
        if (ep.tq != null) diff_tq = rnd(Math.abs(tq_calc - ep.tq), 4);
      }

      pvComps.push({
        id:           ep.id,
        excel_dist:   ep.dist_acum,
        excel_decl:   ep.decl,
        excel_diam:   ep.diam,
        excel_ct:     ep.ct,
        // legados
        excel_cf:     ep.cf_pv,
        excel_h:      ep.prof_pv,
        // novos campos T.Q.
        excel_cf_pv:        ep.cf_pv,
        excel_cf_chegada:   ep.cf_chegada,
        excel_prof_pv:      ep.prof_pv,
        excel_prof_chegada: ep.prof_chegada,
        excel_tq:           ep.tq,
        excel_has_tq:       ep.has_tq,
        // T.Q. calculado (pela fórmula GI_chegada − (CT − prof))
        tq_calc,
        diff_tq,

        mapa_ct:      mpv.ct  != null ? mpv.ct  : null,
        mapa_cf:      mpv.cf  != null ? mpv.cf  : null,
        mapa_h:       mpv.h   != null ? mpv.h   : null,
        // mapa só tem 1 cota — comparar sempre com cf_pv (fundo real)
        diff_ct:      diff(ep.ct,    mpv.ct),
        diff_cf:      diff(ep.cf_pv, mpv.cf),
        diff_h:       diff(ep.prof_pv, mpv.h),

        perf_ct:           blk_ct          != null ? blk_ct          : null,
        perf_cf:           blk_cf          != null ? blk_cf          : null,
        perf_cf_chegada:   blk_cf_chegada  != null ? blk_cf_chegada  : null,
        perf_cf_saida:     blk_cf_saida    != null ? blk_cf_saida    : null,
        perf_h:            blk_h           != null ? blk_h           : null,
        perf_decl:         pv_decl_local != null ? pv_decl_local : null,
        perf_ext:          pv_ext_local  != null ? pv_ext_local  : null,
        diff_ct_perf:      diff(ep.ct,        blk_ct, 3),
        diff_cf_perf:      diff(ep.cf_pv,     blk_cf, 3),
        diff_h_perf:       diff(ep.prof_pv,   blk_h,  3),
        diff_decl_perf:    diff(ep.decl,      pv_decl_local, 6),
        diff_ext_perf:     diff(ep.dist_acum, pv_ext_local, 3),
        // Coordenadas UTM do mapa DXF (para plotar no mapa interativo)
        coord_x:           mapCoords[pid] ? mapCoords[pid].x : null,
        coord_y:           mapCoords[pid] ? mapCoords[pid].y : null,
      });
    }

    const inPerfilByData = pvComps.some(pv => pv.perf_ct != null || pv.perf_cf != null || pv.perf_h != null);

    return {
      ose:       num,
      in_mapa:   inMapa,
      in_perfil: inPerfil || inPerfilByData,
      in_excel:  inExcel,
      mapa_L:    mapaL,
      mapa_i:    mapaI,
      excel_L:   excelL,
      excel_i:   excelI,
      perfil_L:  perOse[num] ? perOse[num].L : null,
      perfil_i:  perOse[num] ? perOse[num].i : null,
      diff_L:    diff(mapaL, excelL, 3),
      diff_i:    diff(mapaI, excelI, 6),
      diff_L_perf: diff(mapaL, perOse[num] ? perOse[num].L : null, 3),
      diff_i_perf: diff(mapaI, perOse[num] ? perOse[num].i : null, 6),
      pvs:       pvComps,
    };
  });
}

// ── ENTRY POINT ────────────────────────────────────────────────────────────
function parseOse({ mapaDxf, perfisDxf, excelPath }) {
  const mapa   = parseMapaDxf(mapaDxf);
  const perfis = parsePerfisDxf(perfisDxf);
  const excel  = parseExcel(excelPath);
  return buildComparison(mapa, perfis, excel);
}

module.exports = { parseOse, parseMapaDxf, parsePerfisDxf, parseExcel, buildComparison };
