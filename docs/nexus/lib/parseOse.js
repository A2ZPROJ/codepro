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

// Detecta formato DXF lendo os primeiros bytes.
// DXF binário começa com a string fixa "AutoCAD Binary DXF\r\n\x1A\x00" (22 bytes).
// DXF ASCII tipicamente começa com "  0\n" ou "0\r\n" seguido de SECTION.
// Retorna 'binary' | 'ascii' | 'unknown'.
function detectDxfFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32);
    const n = fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    if (n < 22) return 'unknown';
    const head = buf.toString('binary', 0, 22);
    if (head === 'AutoCAD Binary DXF\r\n\x1A\x00') return 'binary';
    return 'ascii';
  } catch (e) {
    return 'unknown';
  }
}

// Erro estruturado para problemas que o renderer deve tratar com UI dedicada.
class DxfFormatError extends Error {
  constructor(filePath, format) {
    const name = filePath.split(/[\\/]/).pop();
    super('DXF em formato ' + format + ' não suportado: ' + name);
    this.code = 'DXF_FORMAT';
    this.format = format;   // 'binary' | 'unknown'
    this.filePath = filePath;
    this.fileName = name;
  }
}

// Lê o DXF como texto detectando encoding. Suporta:
//   - UTF-8 com BOM (EF BB BF)
//   - UTF-16 LE com BOM (FF FE)
//   - UTF-16 BE com BOM (FE FF)
//   - UTF-8 puro (sem BOM)
//   - Windows-1252 / Latin-1 como fallback quando UTF-8 gera replacement
//     characters (DXF antigos salvos com ANSI/CP1252 no AutoCAD)
// Retorna { text, encoding, warnings[] }.
function readDxfText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf-8-bom', warnings: [] };
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    // utf16le; slice(2) remove BOM. Node suporta encoding 'utf16le'.
    return { text: buf.slice(2).toString('utf16le'), encoding: 'utf-16le', warnings: [] };
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    // utf-16be não é suportado direto por Node; fazemos swap
    const swapped = Buffer.allocUnsafe(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be', warnings: [] };
  }
  // Sem BOM — tenta UTF-8. Se surgir replacement char (0xFFFD), o arquivo
  // provavelmente é Latin-1 / Windows-1252. Relê como latin1 (Node.js trata
  // latin1 ≈ Windows-1252 pra nossos fins de conferência).
  const asUtf8 = buf.toString('utf8');
  if (asUtf8.indexOf('\uFFFD') === -1) {
    return { text: asUtf8, encoding: 'utf-8', warnings: [] };
  }
  const asLatin1 = buf.toString('latin1');
  return {
    text: asLatin1,
    encoding: 'latin1',
    warnings: [
      'DXF salvo em Latin-1/Windows-1252 (não é UTF-8). Acentos podem ter sido lidos por fallback; recomendo exportar novamente com SAVEAS → DXF 2013 UTF-8.',
    ],
  };
}

// Varre avisos "soft" do DXF: entidades PROXY (objetos de plugin de outro
// CAD — BricsCAD/ZWCAD exportam assim), entidades REGION complexas, etc.
// Retorna array de strings com os problemas. NÃO aborta a conferência.
function scanDxfWarnings(text, fileName) {
  const warnings = [];
  // ACAD_PROXY_ENTITY aparece como tipo "ACAD_PROXY_ENTITY" após group code 0.
  // Threshold: só avisa se tiver 10+ — menos que isso costuma ser extensão
  // inócua (Mesh Autodesk, AecDbDictionary, etc) que não carrega dados OSE.
  const proxyMatches = text.match(/\bACAD_PROXY_ENTITY\b/gi);
  const proxyCount = proxyMatches ? proxyMatches.length : 0;
  if (proxyCount >= 10) {
    warnings.push(
      fileName + ': ' + proxyCount + ' entidades ACAD_PROXY_ENTITY detectadas (objetos de plugin de outro CAD). Se faltar OSE/PV na conferência, explodir as proxies no CAD (XPLODE ou BURST) e reexportar.'
    );
  }
  // Regions/Solids complexas podem envelopar texto
  const regionMatches = text.match(/^\s*0\s*\r?\n\s*REGION\s*\r?\n/gmi);
  if (regionMatches && regionMatches.length > 20) {
    warnings.push(
      fileName + ': ' + regionMatches.length + ' REGIONs encontradas — se os dados estão dentro delas, podem não ser extraídos. Verifique se PVs aparecem na conferência; se faltarem, explodir as regions no CAD.'
    );
  }
  return warnings;
}

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

// Remove groups dentro de blocos órfãos (sem INSERT apontando pra eles).
// Blocos anônimos tipo `A$C118d4c76` ou `*D123` ficam na seção BLOCKS mesmo
// quando foram órfãos por deleção/copy-paste — contêm multileaders antigos
// com cotas incorretas que contaminam a conferência. Este filtro dropa eles.
// Retorna: { groups: filtrado, orphansSkipped: nº de blocos pulados }.
function filterOrphanBlocks(groups) {
  // Passe 1: coleta nomes de bloco referenciados por INSERT em qualquer lugar.
  // (Em ENTITIES + dentro de outros blocos — cobre cenário de nested blocks.)
  const referenced = new Set();
  let curEntity = null;
  for (let i = 0; i < groups.length; i++) {
    const { code, val } = groups[i];
    if (code === 0) curEntity = val;
    else if (curEntity === 'INSERT' && code === 2) referenced.add(val);
  }

  // Passe 2: identifica ranges [start..end] de cada BLOCK e se é órfão.
  // Blocos especiais *Model_Space e *Paper_Space são SEMPRE mantidos
  // (são o próprio model/paper space, não são "verdadeiros" blocos).
  const dropRanges = []; // [[startIdx, endIdx], ...] inclusive
  let section = null;
  let blockStart = -1;
  let blockName = null;
  let curEt = null;
  for (let i = 0; i < groups.length; i++) {
    const { code, val } = groups[i];
    if (code === 0) {
      curEt = val;
      if (val === 'SECTION') {
        section = null; // será setado na próxima 'code 2'
      } else if (val === 'ENDSEC') {
        section = null;
        blockStart = -1; blockName = null;
      } else if (val === 'BLOCK' && section === 'BLOCKS') {
        blockStart = i;
        blockName = null;
      } else if (val === 'ENDBLK' && section === 'BLOCKS' && blockStart >= 0) {
        const special = blockName && /^\*(model_space|paper_space|Model_Space|Paper_Space)/i.test(blockName);
        const isOrphan = blockName && !special && !referenced.has(blockName);
        if (isOrphan) dropRanges.push([blockStart, i]);
        blockStart = -1; blockName = null;
      }
    } else if (curEt === 'SECTION' && code === 2) {
      section = val;
    } else if (curEt === 'BLOCK' && code === 2 && section === 'BLOCKS' && blockStart >= 0 && blockName == null) {
      blockName = val;
    }
  }

  // Passe 3: constrói array filtrado. Como ranges são crescentes e não
  // sobrepostos, dá pra usar índice de range pra skip eficiente.
  if (!dropRanges.length) return { groups, orphansSkipped: 0 };
  const filtered = [];
  let rangeIdx = 0;
  for (let i = 0; i < groups.length; i++) {
    // Avança o rangeIdx se já passamos dele
    while (rangeIdx < dropRanges.length && i > dropRanges[rangeIdx][1]) rangeIdx++;
    // Se está dentro de um range de drop, pula
    if (rangeIdx < dropRanges.length && i >= dropRanges[rangeIdx][0] && i <= dropRanges[rangeIdx][1]) {
      continue;
    }
    filtered.push(groups[i]);
  }
  return { groups: filtered, orphansSkipped: dropRanges.length };
}

// ── MAPA DXF ───────────────────────────────────────────────────────────────
function parseMapaDxf(filePath) {
  const fmt = detectDxfFormat(filePath);
  if (fmt !== 'ascii') throw new DxfFormatError(filePath, fmt);
  const fileName = filePath.split(/[\\/]/).pop();
  const { text, encoding, warnings: readWarnings } = readDxfText(filePath);
  const scanWarnings = scanDxfWarnings(text, fileName);
  const warnings = readWarnings.concat(scanWarnings);
  const rawGroups = parseDxfGroups(text);
  const filt = filterOrphanBlocks(rawGroups);
  const groups = filt.groups;
  if (filt.orphansSkipped > 0) {
    warnings.push(fileName + ': ' + filt.orphansSkipped + ' bloco(s) órfão(s) ignorado(s) (sem INSERT apontando — copies/lixo de revisões). Rode PURGE no CAD pra limpar.');
  }

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
    // Antes tinha `(\d+)\b` — quebrava quando o label vem colado: "OSE - 380L=73,16m"
    // (sem espaço entre 380 e L). `\b` não casa entre `0` e `L` (ambos word chars).
    const m = plain.match(/OSE[\s\-]+(\d+)[\s\S]*?L=\s*([\d.,]+)\s*m?[\s\S]*?i\s*=\s*([\d.,]+)/i);
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

  return { pvs, oses, pvCoords, encoding, warnings };
}

// ── PERFIS DXF ─────────────────────────────────────────────────────────────
function parsePerfisDxf(filePath) {
  const fmt = detectDxfFormat(filePath);
  if (fmt !== 'ascii') throw new DxfFormatError(filePath, fmt);
  const fileName = filePath.split(/[\\/]/).pop();
  const { text, encoding, warnings: readWarnings } = readDxfText(filePath);
  const scanWarnings = scanDxfWarnings(text, fileName);
  const warnings = readWarnings.concat(scanWarnings);
  const rawGroups = parseDxfGroups(text);
  const filt = filterOrphanBlocks(rawGroups);
  const groups = filt.groups;
  if (filt.orphansSkipped > 0) {
    warnings.push(fileName + ': ' + filt.orphansSkipped + ' bloco(s) órfão(s) ignorado(s) (sem INSERT apontando — copies/lixo de revisões). Rode PURGE no CAD pra limpar.');
  }

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

  // 1) acha presença das OSEs — layer-agnostic, mas regex ESTRITA (a string
  // inteira do item precisa ser "OSE - NNN"). Evita pegar anotações antigas
  // tipo "Sub-bacia OSE-006..." que sobram em layers não usadas.
  const present = new Set();
  for (const it of items) {
    const t = cleanMtext(it.text);
    const m = t.match(/^OSE(?:-|\s+-\s+)(\d+)$/);
    if (m) present.add(m[1].padStart(3, '0'));
  }

  // 1b) Fallback: também coleta OSEs por NOME DE LAYOUT (AcDbLayout) e nome
  // de BLOCK_RECORD. Isso cobre casos onde o perfil foi exportado sem o
  // label textual visível (o título "OSE - NNN" no topo só existe como
  // nome da aba do paper space, não como MTEXT). O match fica solto pra
  // pegar "OSE - 356", "OSE-356", com/sem espaços. Não adiciona anchors
  // (x/y), só sinaliza presença pra comparação com a planilha.
  {
    const layoutRe = /\n\s*1\s*\r?\n\s*OSE\s*[-\s]+(\d+)\s*\r?\n/g;
    const blockRe  = /\n\s*3\s*\r?\n\s*OSE\s*[-\s]+(\d+)\s*\r?\n/g;
    let mm;
    while ((mm = layoutRe.exec(text)) !== null) {
      present.add(mm[1].padStart(3, '0'));
    }
    while ((mm = blockRe.exec(text)) !== null) {
      present.add(mm[1].padStart(3, '0'));
    }
  }

  // 2) Para cada OSE presente: localizar anchor, dy_pv, columns, e extrair PV data
  // Mas o consumidor (buildComparison) pede um dict global pv_id → dados.
  // Vamos varrer cada anchor "OSE - NNN" SES-TXT, achar candidatos PV/TL nas
  // janelas, calcular dy_pv local e extrair os blocos.
  const pvResult = {}; // id_norm → { ct, h, cf, cf_chegada, cf_saida, decl, ext_acum }
  // Per-OSE info: ose → { L: max ext_acum in block, i: declividade do trecho, pvs: { id_norm: { ext_acum, decl } } }
  const perOse = {};

  // todas as anchors "OSE - NNN" — layer-agnostic com regex ESTRITA. Dedupe
  // por (ose, x, y) arredondado pra não contar a mesma âncora duas vezes
  // quando o mesmo texto existe em layers diferentes (bloco base + cópia).
  const anchors = [];
  const anchorSeen = new Set();
  for (const it of items) {
    const t = cleanMtext(it.text);
    const m = t.match(/^OSE(?:-|\s+-\s+)(\d+)$/);
    if (m) {
      const key = m[1].padStart(3, '0') + '@' + Math.round(it.x * 10) + ',' + Math.round(it.y * 10);
      if (anchorSeen.has(key)) continue;
      anchorSeen.add(key);
      anchors.push({ x: it.x, y: it.y, ose: m[1].padStart(3, '0') });
    }
  }

  for (const a of anchors) {
    const cx = a.x, cy = a.y;
    // candidatos PV/TL na janela típica — layer-agnostic.
    // A regex `^(PV|TL|PIT|TQ)(-\w{1,4})?-\d+$` é específica o bastante.
    // Dedupe por (nome, x arredondado) pra não duplicar quando o mesmo
    // rótulo aparece em várias layers (ex.: cópias de anotação).
    const cands = [];
    const candSeen = new Set();
    for (const it of items) {
      const dx = it.x - cx, dy = it.y - cy;
      if (!(dy > -100 && dy < -15 && dx > -150 && dx < 150)) continue;
      const t = cleanMtext(it.text);
      if (/^(?:PV|TL|PIT|TQ)(?:-[A-Z]{1,4})?-\d+$/.test(t)) {
        const key = t + '@' + Math.round(it.x * 10) + ',' + Math.round(it.y * 10);
        if (candSeen.has(key)) continue;
        candSeen.add(key);
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

    // Offsets relativos ao dy_pv (faixas conservadoras — o layout padrão 2S)
    const OFF_TOPO   = [-7.5, -6.0];
    const OFF_CS     = [-10.0, -9.0];
    const OFF_CC     = [-12.8, -11.5];
    const OFF_PROF   = [-16.25, -15.25];
    const OFF_EXTAC  = [-23.0, -22.0];
    const OFF_DECL   = [-25.0, -23.5];

    // Amplia janela em ~20% (cada lado) — fallback quando o layout vem com
    // escala ligeiramente diferente (perfis exportados com escala ou altura
    // de texto customizada acabam deslocando offsets fixos).
    function expand(range) {
      const [a, b] = range;
      const w = Math.abs(b - a);
      return [a - w * 0.2, b + w * 0.2];
    }

    // Tenta extrair todos os campos do PV a partir da coluna colDx.
    // Se `wide` = true, usa janelas ampliadas.
    function extractPv(colDx, wide) {
      const OT = wide ? expand(OFF_TOPO)  : OFF_TOPO;
      const OS = wide ? expand(OFF_CS)    : OFF_CS;
      const OC = wide ? expand(OFF_CC)    : OFF_CC;
      const OP = wide ? expand(OFF_PROF)  : OFF_PROF;
      const OE = wide ? expand(OFF_EXTAC) : OFF_EXTAC;
      const OD = wide ? expand(OFF_DECL)  : OFF_DECL;
      // tolDx sempre estreito (2.0) — alargar horizontal captura valores da
      // coluna vizinha (PVs/PITs adjacentes têm colunas próximas no perfil).
      // A 2ª passada amplia só o eixo vertical (offsets rdy).
      const tolDx = 2.0;
      const rec = { ct: null, h: null, cf: null,
                    cf_chegada: null, cf_saida: null,
                    ext_acum: null, decl: null };
      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx - colDx) > tolDx) continue;
        const rdy = dy - dyPv;
        if (!(rdy > -30 && rdy < 5)) continue;
        const t = cleanMtext(it.text);

        if (rdy > OT[0] && rdy < OT[1] && /^\d{2,4}[.,]\d{2,4}/.test(t)) {
          const n = parseFloat(t.split(/\s+/)[0].replace(',', '.'));
          if (!isNaN(n) && n >= 100) rec.ct = n;
        } else if (rdy > OS[0] && rdy < OS[1] && t.includes('\n')) {
          const v = extractGiTubo(it.text);
          if (v != null) rec.cf_saida = v;
        } else if (rdy > OC[0] && rdy < OC[1] && t.includes('\n')) {
          const v = extractGiTubo(it.text);
          if (v != null) rec.cf_chegada = v;
        } else if (rdy > OP[0] && rdy < OP[1] && /^\d+[.,]\d+$/.test(t)) {
          const n = parseFloat(t.replace(',', '.'));
          if (!isNaN(n) && n > 0 && n < 20) rec.h = n;
        } else if (rdy > OE[0] && rdy < OE[1] && /\d+\.\d+m/.test(t)) {
          const m = t.match(/([\d.]+)m/);
          if (m) rec.ext_acum = parseFloat(m[1]);
        } else if (rdy > OD[0] && rdy < OD[1]) {
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
      return rec;
    }

    const blockPvs = {}; // id_norm → { ext_acum, decl }
    for (const name in cols) {
      const colDx = cols[name].dx;
      const rec = extractPv(colDx, false);

      // Segunda passada ampliada preenche APENAS campos que ficaram null
      // — não sobrescreve o que já foi detectado no offset canônico.
      const missing = rec.ct == null || rec.h == null || rec.cf_saida == null
                   || rec.cf_chegada == null || rec.ext_acum == null || rec.decl == null;
      if (missing) {
        const rec2 = extractPv(colDx, true);
        for (const k of Object.keys(rec)) {
          if (rec[k] == null && rec2[k] != null) rec[k] = rec2[k];
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

  return { present: Array.from(present).sort(), pvs: pvResult, perOse, encoding, warnings };
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

    // Detecta colunas Este/Norte/Cota pelo cabeçalho (row 10, 0-idx 9). Fallback: B/C/D.
    let colEste = 1, colNorte = 2, colCota = 3;
    try {
      const headerRow = dataStart - 1; // 0-idx 9
      for (let c = 0; c <= Math.min(10, ref ? ref.e.c : 10); c++) {
        const cell = ws[xlsx.utils.encode_cell({ r: headerRow, c })];
        const txt = (cell && cell.v != null) ? String(cell.v).trim().toLowerCase() : '';
        if (/^este\b|coord.*este|\bx\b|easting/.test(txt)) colEste = c;
        else if (/^norte\b|coord.*norte|\by\b|northing/.test(txt)) colNorte = c;
        else if (/^cota\b|elev/.test(txt)) colCota = c;
      }
    } catch {}

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
        // Coordenadas UTM declaradas na planilha (mais confiáveis do que o DXF,
        // que pode vir em sistema local). Colunas detectadas pelo cabeçalho.
        este:      get(colEste),   // Este (UTM X)
        norte:     get(colNorte),  // Norte (UTM Y)
        cota:      get(colCota),   // Cota do terreno
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

      // Valor DECLARADO de degrau/T.Q. na coluna Observações.
      // Aceita "T.Q. X m" ou "DEGRAU X m" (convenção SANEPAR/2S alterna as duas).
      // Se aparece sem valor numérico ("DEGRAU  m"), trata como não-declarado.
      // Regex exige ao menos 1 dígito no grupo capturado pra não casar com "."
      // solto ou "," solto (parseFloat daria NaN, mas ainda assim evitamos).
      let tq_decl = null;
      for (const row of useRows) {
        const m = row.obs.match(/(?:T\.?\s*Q\.?|DEGRAU)\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*m/i);
        if (m) {
          const v = parseFloat(m[1].replace(',', '.'));
          if (!isNaN(v) && (tq_decl == null || v > tq_decl)) tq_decl = v;
        }
      }
      // tq canônico: se declarado na obs usa isso; senão cai pro diff cf_ch-cf_pv
      let tq = tq_decl != null ? tq_decl : 0;
      if (tq === 0 && cf_ch != null && cf_pv != null) {
        const diff = cf_ch - cf_pv;
        if (diff > 0.001) tq = diff;
      }
      const has_tq = tq > 0.001;

      const base = useRows[0];
      // Coordenadas: pega a primeira linha que TENHA este+norte válidos (UTM).
      // Filtra valores obviamente locais (magnitude baixa) — UTM real tem X > 100k e Y > 0.
      let este = null, norte = null, cota = null;
      for (const row of rows) {
        if (row.este != null && row.norte != null
            && row.este > 100000 && row.este < 1000000
            && row.norte > 0 && row.norte < 10500000) {
          este = row.este; norte = row.norte; cota = row.cota; break;
        }
      }
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
        tq_decl:    rnd(tq_decl, 4),   // degrau declarado na obs (null se ausente)
        has_tq,
        // Coordenadas UTM declaradas na planilha (mais confiáveis que DXF)
        excel_este:  rnd(este,  3),
        excel_norte: rnd(norte, 3),
        excel_cota:  rnd(cota,  3),
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
        excel_tq_decl:      ep.tq_decl,     // valor declarado na obs (pode ser null)
        excel_has_tq:       ep.has_tq,
        // Divergência entre degrau declarado na obs e o delta CF real na
        // planilha (cf_chegada − cf_pv). Pega copy-paste/esquecimento de
        // atualizar a obs quando a cota muda.
        diff_degrau_decl:   (ep.tq_decl != null && ep.cf_chegada != null && ep.cf_pv != null)
                              ? rnd(Math.abs(ep.tq_decl - (ep.cf_chegada - ep.cf_pv)), 4)
                              : null,
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
        // Coordenadas UTM — prioridade Planilha (Este/Norte). Fallback: DXF mapa.
        // A planilha é mais confiável porque o DXF pode estar em sistema CAD local
        // (caso comum quando o projetista ancorou o desenho em 0,0 ou outro ref).
        coord_x:           (ep.excel_este  != null && ep.excel_este  > 100000) ? ep.excel_este
                          : (mapCoords[pid] ? mapCoords[pid].x : null),
        coord_y:           (ep.excel_norte != null && ep.excel_norte > 0)      ? ep.excel_norte
                          : (mapCoords[pid] ? mapCoords[pid].y : null),
        coord_src:         (ep.excel_este != null && ep.excel_este > 100000) ? 'excel' : (mapCoords[pid] ? 'dxf' : null),
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
// Retorna SEMPRE um array (o array de comparação). Warnings ficam anexados
// como propriedade `.warnings` do array pra manter compat com chamadores
// antigos que fazem `data.length`, `data.map(...)`, etc. Renderer lê
// `res.data.warnings` se quiser exibir o banner amarelo.
function parseOse({ mapaDxf, perfisDxf, excelPath }) {
  const mapa   = parseMapaDxf(mapaDxf);
  const perfis = parsePerfisDxf(perfisDxf);
  const excel  = parseExcel(excelPath);
  const data = buildComparison(mapa, perfis, excel);
  data.warnings = [].concat(mapa.warnings || [], perfis.warnings || []);
  data.encoding = { mapa: mapa.encoding, perfis: perfis.encoding };
  return data;
}

module.exports = {
  parseOse, parseMapaDxf, parsePerfisDxf, parseExcel, buildComparison,
  detectDxfFormat, DxfFormatError, readDxfText, scanDxfWarnings,
};
