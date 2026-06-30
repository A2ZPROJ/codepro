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

// Erro: DXF gigante demais pra parser síncrono aguentar (OOM ou 30+ min).
// Acima de 500 MB o parser trava a UI e pode crashar por memória. Aborta rápido
// com instrução clara em vez de deixar o usuário esperando indefinidamente.
class DxfTooLargeError extends Error {
  constructor(filePath, sizeBytes) {
    const name = filePath.split(/[\\/]/).pop();
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(0);
    super('DXF muito grande (' + sizeMB + ' MB): ' + name);
    this.code = 'DXF_TOO_LARGE';
    this.sizeBytes = sizeBytes;
    this.sizeMB = sizeMB;
    this.filePath = filePath;
    this.fileName = name;
  }
}

// Limite de tamanho pra abortar o parsing rápido. 500 MB é o ponto onde o
// parser síncrono começa a travar a UI por 10+ minutos e pode OOM.
const DXF_MAX_BYTES = 500 * 1024 * 1024;

// Normaliza ID de OSE: aceita sufixo de letra (A/B/C/...) — OSE-590A é uma
// OSE legítima e SEPARADA da OSE-590. Ambas convivem como chaves distintas.
// Tira zeros à esquerda antes de aplicar o pad mínimo de 3 dígitos, pra que
// "OSE-00101" (planilha) e "OSE-0101" (DXF/mapa) virem a mesma chave "101".
// Exemplos:
//   "590"   → "590"
//   "73"    → "073"
//   "590A"  → "590A"
//   "73a"   → "073A"
//   "5B"    → "005B"
//   "00101" → "101"
//   "0101"  → "101"
//   "00073" → "073"
// Usa UPPER na letra pra normalizar consistência ("a" e "A" → mesma chave).
function normOseNum(raw) {
  const s = String(raw || '').toUpperCase().trim();
  const m = s.match(/^(\d+)([A-Z]?)$/);
  if (!m) return s.padStart(3, '0');
  const digits = m[1].replace(/^0+/, '') || '0';
  return digits.padStart(3, '0') + m[2];
}

// Extrai o número da OSE de um rótulo-título de perfil (string já passada por
// cleanMtext). Aceita duas convenções de título no MODEL SPACE:
//   "OSE - 001" / "OSE-001"               → template 2S clássico (VCA)
//   "PERFIL: OSE-001" / "PERFIL OSE-001"  → perfis MND. Nesses DXF o número
//        "oficial" da OSE só existe num ATTRIB NUM_OSE de carimbo no PAPER
//        SPACE (mesma coordenada em todo layout → inútil como âncora). O título
//        "PERFIL: OSE-NNN" desenhado no topo de cada bloco é a única âncora
//        espacial utilizável. Sufixo de letra (A/B) preservado.
// Retorna a string do número (não-normalizada) ou null.
function matchOseTitle(t) {
  let m = t.match(/^OSE(?:-|\s+-\s+)(\d+[A-Za-z]?)$/);
  if (m) return m[1];
  m = t.match(/^PERFIL\s*:?\s*OSE\s*[-\s]+(\d+[A-Za-z]?)$/i);
  if (m) return m[1];
  return null;
}

function checkDxfSize(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size > DXF_MAX_BYTES) throw new DxfTooLargeError(filePath, st.size);
    return st.size;
  } catch (e) {
    if (e.code === 'DXF_TOO_LARGE') throw e;
    return 0; // se statSync falhar, deixa o parser tentar e reportar erro depois
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

// Limpa control codes de MTEXT raw, preservando quebras (\P → \n, ^J → \n).
// Também decodifica \U+XXXX (escape de Unicode do AutoCAD) — caracteres
// acentuados em rótulos textuais frequentemente são salvos assim no DXF
// (ex.: "EXTENS\U+00C3O" em vez de "EXTENSÃO"). Sem decodificar, rótulos
// com acento nunca casam por regex no detectPerfilLabels.
function cleanMtext(raw) {
  let s = String(raw);
  s = s.replace(/\\f[^;]*;/gi, '');
  s = s.replace(/\\[Cc]\d+;/g, '');
  s = s.replace(/\\pxqc;/gi, '');
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/\\P/g, '\n').replace(/\^J/g, '\n');
  s = s.replace(/[{}]/g, '');
  return s.trim();
}

// Detecta dinamicamente as linhas verticais do bloco do perfil olhando
// os rótulos textuais da coluna de cabeçalho (geralmente em dx < 0 da
// anchor da OSE). Retorna dy ABSOLUTO de cada rótulo, ou null se não
// encontrado. Isso permite que projetos com escala vertical diferente
// (ex.: Amaporã) sejam parseados sem ajuste manual de offsets.
//
// Os rótulos padrão do template 2S são:
//   "COTA TOPO"          → linha do CT
//   "CC:GI DO TUBO"      → linha da CF de chegada (cota fundo de chegada)
//   "CS:GI DO TUBO"      → linha da CF de saída
//   "PROFUNDIDADE"       → linha da profundidade
//   "EXTENSÃO" / "EXTENSAO" → linha do ext_acum
//   "DECLIVIDADE"        → linha da declividade
//   "PV"                 → linha onde estão os IDs PV-NNN / TL-NNN
function detectPerfilLabels(items, cx, cy) {
  // Janela de busca: à esquerda do bloco (dx < 5) e abaixo da anchor.
  // Aumentamos pra dy = -250 pra cobrir blocos de perfil em escalas altas.
  const labels = { topo: null, cc: null, cs: null, gi: null, prof: null, ext: null, decl: null, pv: null, diam: null,
                   gs: null, eixo: null, declpct: null, dnalarg: null };
  const PATTERNS = [
    { key: 'topo', re: /^COTA\s*TOPO\b/i },
    { key: 'cc',   re: /^CC[:.\s]+GI/i },
    { key: 'cs',   re: /^CS[:.\s]+GI/i },
    // MND template: bandas extras do alargador (cravação). Detectá-las é o que
    // permite identificar o template como MND e ler as bandas pelo índice
    // (a posição do RÓTULO não casa com a do VALOR, então janela por rótulo erra).
    { key: 'gs',   re: /^GS\s*ALARG/i },         // GS ALARGADOR (logo abaixo de COTA TOPO)
    { key: 'eixo', re: /^EIXO\s*ALARG/i },       // EIXO ALARGADOR
    // MND: banda única de GI ("GI TUBO / ALARG.", "GI DO TUBO") sem prefixo CC/CS.
    // Usada como fallback de cc/cs quando o template não separa chegada/saída.
    { key: 'gi',   re: /^GI[\s:.\/]/i },
    { key: 'prof', re: /^PROFUNDIDADE\b/i },
    // DECLIV. (%) precisa ser detectada ANTES da regra `decl` genérica casar a
    // banda errada; usamos pra fixar a ordem das bandas no MND.
    { key: 'declpct', re: /^DECLIV.*%/i },
    { key: 'ext',  re: /^EXTENS[ÃA]O\b/i },
    // Aceita "DECLIVIDADE" (VCA) e "DECLIV. (m/m)" / "DECLIV. (%)" (MND).
    { key: 'decl', re: /^DECLIV/i },
    { key: 'pv',   re: /^PV$/i },
    // DN ALARG. (mm) — banda do alargador, NÃO é o DN do tubo. Detectada à parte
    // pra não ser confundida com a banda DN TUBO pelo padrão genérico abaixo.
    { key: 'dnalarg', re: /^DN\s*ALARG/i },
    // DN do tubo: aceita "DIÂMETRO", "DIAMETRO", "DN", "Ø", "MATERIAL/DIAM".
    // No MND a banda correta é "DN TUBO (mm)" — o lookahead negativo evita casar
    // "DN ALARG. (mm)" (alargador). Linha geralmente entre EXTENSÃO e DECLIVIDADE.
    { key: 'diam', re: /^(?:DI[ÂA]METRO|D[ÂA]M|DN(?!\s*ALARG)|MATERIAL|Ø|TUBO)\b/i },
  ];
  for (const it of items) {
    const dx = it.x - cx, dy = it.y - cy;
    if (dx > 10) continue;                         // só lado esquerdo do bloco
    if (dy > 30 || dy < -300) continue;            // dentro da altura do bloco
    const t = cleanMtext(it.text);
    if (!t) continue;
    for (const { key, re } of PATTERNS) {
      if (labels[key] != null) continue;           // mantém primeira ocorrência
      if (re.test(t)) {
        labels[key] = dy;
        break;
      }
    }
  }
  // MND tem uma única linha de GI ("GI TUBO / ALARG.") em vez de CC:GI + CS:GI.
  // Quando o template não traz chegada/saída separadas, usa a linha GI única
  // para ambos — assim o parser lê a cf da geratriz inferior REAL (que casa com
  // a planilha) e não cai na 2ª passada "wide" que sobrescreve CT/h com as
  // linhas vizinhas (GS ALARGADOR, DECLIV).
  if (labels.gi != null) {
    if (labels.cc == null) labels.cc = labels.gi;
    if (labels.cs == null) labels.cs = labels.gi;
  }
  return labels;
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
  checkDxfSize(filePath);
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
  let mtX = null, mtY = null;

  // Tenta extrair um rótulo de PV (PV-/TL-/PIT-/TQ- com CT/CF/h) de um blob de
  // texto. O rótulo de PV pode vir como MULTILEADER OU como MTEXT (entrega
  // recente do mapa põe o texto do PV em MTEXT, não em mleader). Compartilhado.
  function ingestPvLabel(buf, x, y) {
    if (!buf) return;
    // Aceita PV-###, TL-###, PIT-###, TQ-### e variantes com qualificador
    // intermediário como PV-EX-### (existente) ou PV-INT-### (interligação).
    // Também aceita PV EXISTENTE / PV-EXIST (sem número) — PV de campo levantado
    // que o mapa rotula só como "PV-EXISTENTE" (sem código), antes era ignorado
    // porque o regex exigia um número no fim.
    const mId = buf.match(/;?\b((?:PV|TL|PIT|TQ)(?:[\s\-]+[A-Z]{1,4})?[\s\-]+\d+)/i)
             || buf.match(/;?\b((?:PV|TL|PIT|TQ)[\s\-]+EXIST\w*)/i);
    const cleaned = buf.replace(/\\f[^;]*;/gi, '').replace(/[{}]/g, '');
    const mCt = cleaned.match(/(?:\\P|^|\s)CT\s*:\s*([\d.,]+)/i);
    const mCf = cleaned.match(/(?:\\P|^|\s)CF\s*:\s*([\d.,]+)/i);
    const mH  = cleaned.match(/(?:\\P|^|\s|;)h\s*:\s*([\d.,]+)/i);
    if (mId && mCt && mCf) {
      const pid = normalizeId(mId[1]);
      const ct = parseFloat(mCt[1].replace(',', '.'));
      const cf = parseFloat(mCf[1].replace(',', '.'));
      const h  = mH ? parseFloat(mH[1].replace(',', '.')) : null;
      // Um mesmo PV pode ter vários rótulos no mapa (um por tubo chegando/
      // saindo). CF_chegada > CF_fundo; para casar com a cf_pv da planilha
      // (fundo real = min) pegamos a CF MÍNIMA, e o h MÁXIMO (fundo mais
      // profundo). Antes o parser sobrescrevia com o último rótulo, que
      // poderia ser o da chegada e virava falso "CF divergente".
      const prev = pvs[pid];
      if (!prev) {
        pvs[pid] = { ct, cf, h };
      } else {
        if (cf < prev.cf) prev.cf = cf;
        if (h != null && (prev.h == null || h > prev.h)) prev.h = h;
        if (prev.ct == null && ct != null) prev.ct = ct;
      }
      if (x != null && y != null && !pvCoords[pid]) pvCoords[pid] = { x, y };
    }
  }

  // Extrai um rótulo de OSE (L=, i=, DN) de um blob de texto. O rótulo da OSE
  // (nome/L/i/DN) é SEMPRE MTEXT (só o rótulo de PV é que pode vir como
  // MULTILEADER ou MTEXT). Por isso esta função só é chamada no flushMtext.
  function ingestOseLabel(buf) {
    if (!buf) return;
    const plain = buf.replace(/\\f[^;]*;/gi, '').replace(/[{}]/g, '');
    // Unidade `m` após o valor de L é OPCIONAL — muitos rótulos vêm como
    // `L=25,09\PØ150mm  i=0,0470` (o `m` só aparece em `mm` depois).
    // Antes o regex exigia `m` logo após o número, derrubando a OSE.
    // Antes tinha `(\d+)\b` — quebrava quando o label vem colado: "OSE - 380L=73,16m"
    // (sem espaço entre 380 e L). `\b` não casa entre `0` e `L` (ambos word chars).
    // i pode ser NEGATIVO (declividade adversa / contra-caimento): "i=-0,0100".
    // Sem o `-?` o regex inteiro não casava e a OSE sumia do mapa (in_mapa=false)
    // — era o caso da OSE-003/004/005 de Amaporã BACIA-02-B.
    const m = plain.match(/OSE[\s\-]+(\d+[A-Za-z]?)[\s\S]*?L=\s*(-?[\d.,]+)\s*m?[\s\S]*?i\s*=\s*(-?[\d.,]+)/i);
    if (!m) return;
    const num = normOseNum(m[1]);
    // Captura DN se presente no MESMO label da OSE — formatos comuns:
    //   "Ø150mm" / "Ø 200" / "DN150" / "DN 200" / "PVC 150mm"
    // Limita a 4 dígitos pra evitar casar com cota (ex.: 380.5). Range
    // 50..1500 cobre coletor sanitário típico (mínimo PVC 100, máximo PEAD 1500).
    let dn = null;
    const dnMatch = plain.match(/(?:Ø|DN|D\.N\.)\s*(\d{2,4})/i);
    if (dnMatch) {
      const n = parseInt(dnMatch[1], 10);
      if (n >= 50 && n <= 1500) dn = n;
    }
    oses[num] = {
      L: parseFloat(m[2].replace(',', '.')),
      i: parseFloat(m[3].replace(',', '.')),
      diam: dn,
    };
  }

  function flushMultiLeader() {
    ingestPvLabel(mlBuf, mlX, mlY);
    mlBuf = ''; mlX = null; mlY = null;
  }

  function flushMtext() {
    if (!mtText) { mtX = null; mtY = null; return; }
    // PV (e OSE) podem estar em MTEXT (entrega recente do mapa) — extrai ambos.
    ingestPvLabel(mtText, mtX, mtY);
    ingestOseLabel(mtText);
    mtText = ''; mtX = null; mtY = null;
  }

  for (const { code, val } of groups) {
    if (code === 0) {
      flushMultiLeader();
      flushMtext();
      etype = val;
      mlBuf = ''; mlX = null; mlY = null;
      mtText = ''; mtX = null; mtY = null;
    } else if (etype === 'MULTILEADER' || etype === 'MLEADER') {
      // PV em multileader — qualquer variante de nome de entidade
      if (code === 304 || code === 302 || code === 1) mlBuf += val;
      if (code === 10 && mlX == null) mlX = parseFloat(val);
      if (code === 20 && mlY == null) mlY = parseFloat(val);
    } else if (etype === 'MTEXT') {
      // PV (e OSE) em MTEXT — ingestPvLabel roda no flushMtext
      if (code === 1 || code === 3) mtText += val;
      if (code === 10 && mtX == null) mtX = parseFloat(val);
      if (code === 20 && mtY == null) mtY = parseFloat(val);
    }
  }
  flushMultiLeader();
  flushMtext();

  return { pvs, oses, pvCoords, encoding, warnings };
}

// ── PERFIS DXF ─────────────────────────────────────────────────────────────
function parsePerfisDxf(filePath) {
  checkDxfSize(filePath);
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
  // inteira do item precisa ser "OSE - NNN" ou "OSE - NNNA"). Evita pegar
  // anotações antigas tipo "Sub-bacia OSE-006..." que sobram em layers não
  // usadas. Sufixo de letra (A/B/C) aceito: OSE-590A é OSE distinta da 590.
  const present = new Set();
  for (const it of items) {
    const t = cleanMtext(it.text);
    const num = matchOseTitle(t);
    if (num) present.add(normOseNum(num));
  }

  // 1b) Fallback: também coleta OSEs por NOME DE LAYOUT (AcDbLayout) e nome
  // de BLOCK_RECORD. Isso cobre casos onde o perfil foi exportado sem o
  // label textual visível (o título "OSE - NNN" no topo só existe como
  // nome da aba do paper space, não como MTEXT). O match fica solto pra
  // pegar "OSE - 356", "OSE-356", com/sem espaços. Não adiciona anchors
  // (x/y), só sinaliza presença pra comparação com a planilha.
  {
    const layoutRe = /\n\s*1\s*\r?\n\s*OSE\s*[-\s]+(\d+[A-Za-z]?)\s*\r?\n/g;
    const blockRe  = /\n\s*3\s*\r?\n\s*OSE\s*[-\s]+(\d+[A-Za-z]?)\s*\r?\n/g;
    let mm;
    while ((mm = layoutRe.exec(text)) !== null) {
      present.add(normOseNum(mm[1]));
    }
    while ((mm = blockRe.exec(text)) !== null) {
      present.add(normOseNum(mm[1]));
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
    const num = matchOseTitle(t);
    if (num) {
      const oseNum = normOseNum(num);
      const key = oseNum + '@' + Math.round(it.x * 10) + ',' + Math.round(it.y * 10);
      if (anchorSeen.has(key)) continue;
      anchorSeen.add(key);
      anchors.push({ x: it.x, y: it.y, ose: oseNum });
    }
  }

  for (const a of anchors) {
    const cx = a.x, cy = a.y;

    // Detecta dinamicamente as posições verticais dos rótulos COTA TOPO,
    // CC/CS:GI DO TUBO, PROFUNDIDADE, EXTENSÃO, DECLIVIDADE, PV — assim o
    // parser funciona em qualquer escala vertical de layout, não só na
    // escala canônica do template 2S original. Bug histórico: o DXF do
    // Amaporã usa escala ~2,5x maior, deixando os números fora das janelas
    // hardcoded e nada era extraído (silenciosamente).
    const labels = detectPerfilLabels(items, cx, cy);

    // candidatos PV/TL na janela típica — layer-agnostic.
    // Aceita PV/TL/PIT/TQ com:
    //   - prefixo simples: PV-001, TL-001, PIT-0040
    //   - qualificador intermediário: PV-EX-123, PV-INT-456
    //   - letra(s) colada(s) antes do número: PV-M001 (SANEPAR usa pra ramal/junção)
    //   - sufixo letra após o número: PV-041A, PV-092A (OSEs com letra de revisão)
    // O ÚLTIMO PV do bloco do perfil tipicamente carrega essas variações; perdê-lo
    // faz o Math.max(ext_acum) parar no penúltimo (bug histórico).
    // Dedupe por (nome, x arredondado) pra não duplicar quando o mesmo
    // rótulo aparece em várias layers (ex.: cópias de anotação).
    //
    // Janela vertical: se detectamos a label "PV" e a label "DECLIVIDADE"
    // (extremos verticais do bloco), usamos essas posições pra delimitar
    // a janela dinamicamente. Senão, fallback pros valores históricos.
    const yMaxCand = labels.pv   != null ? labels.pv   + 5  : -15;
    const yMinCand = labels.decl != null ? labels.decl - 5  : -100;
    const cands = [];
    const candSeen = new Set();
    for (const it of items) {
      const dx = it.x - cx, dy = it.y - cy;
      if (!(dy > yMinCand && dy < yMaxCand && dx > -150 && dx < 150)) continue;
      const t = cleanMtext(it.text);
      if (/^(?:PV|TL|PIT|TQ)(?:-[A-Z]{1,4})?-[A-Z]*\d+[A-Z]?$/.test(t)) {
        const key = t + '@' + Math.round(it.x * 10) + ',' + Math.round(it.y * 10);
        if (candSeen.has(key)) continue;
        candSeen.add(key);
        cands.push({ name: t, dx, dy, x: it.x, y: it.y });
      }
    }
    if (!cands.length) continue;
    const dyPv = labels.pv != null
      ? labels.pv
      : cands.reduce((s, c) => s + c.dy, 0) / cands.length;

    // por nome → primeira ocorrência (col_dx, col_y)
    const cols = {};
    for (const c of cands) {
      if (!(c.name in cols)) cols[c.name] = c;
    }

    // Tolerância vertical em torno do dy de cada label. ~½ do espaçamento
    // típico entre linhas adjacentes é seguro (não invade a linha vizinha).
    // Usamos o menor espaçamento detectado entre labels consecutivas como base.
    const labelDys = [labels.topo, labels.gs, labels.eixo, labels.cc, labels.cs, labels.prof,
                      labels.declpct, labels.ext, labels.decl, labels.pv, labels.diam, labels.dnalarg]
      .filter(v => v != null).sort((a, b) => a - b);
    let lineGap = 7.5; // espaçamento típico no template 2S
    if (labelDys.length >= 2) {
      let minGap = Infinity;
      for (let i = 1; i < labelDys.length; i++) {
        const g = labelDys[i] - labelDys[i - 1];
        if (g > 0 && g < minGap) minGap = g;
      }
      if (isFinite(minGap)) lineGap = minGap;
    }
    const HALF_GAP = lineGap * 0.5;

    // Constrói janela de offset relativa a dyPv para cada label detectado.
    // Quando o label não foi encontrado (perfil fora do padrão), cai pros
    // offsets canônicos do template 2S antigo.
    function dynOff(absDy, half, fallback) {
      if (absDy == null) return fallback;
      const rdy = absDy - dyPv;
      return [rdy - half, rdy + half];
    }
    const OFF_TOPO   = dynOff(labels.topo, HALF_GAP, [-7.5, -6.0]);
    const OFF_CS     = dynOff(labels.cs,   HALF_GAP, [-10.0, -9.0]);
    const OFF_CC     = dynOff(labels.cc,   HALF_GAP, [-12.8, -11.5]);
    const OFF_PROF   = dynOff(labels.prof, HALF_GAP, [-16.25, -15.25]);
    const OFF_EXTAC  = dynOff(labels.ext,  HALF_GAP, [-23.0, -22.0]);
    const OFF_DECL   = dynOff(labels.decl, HALF_GAP, [-25.0, -23.5]);
    // DN é opcional — só dispara extração se a label foi detectada no perfil.
    // Sem fallback hardcoded: se não tem label, perf_diam fica null (UI sabe).
    const OFF_DIAM   = labels.diam != null ? dynOff(labels.diam, HALF_GAP, null) : null;

    // Amplia janela em ~20% (cada lado) — fallback quando o layout vem com
    // escala ligeiramente diferente (perfis exportados com escala ou altura
    // de texto customizada acabam deslocando offsets fixos).
    function expand(range) {
      const [a, b] = range;
      const w = Math.abs(b - a);
      return [a - w * 0.2, b + w * 0.2];
    }

    // Limites verticais dinâmicos: pega o range completo dos labels
    // detectados +/- 1 lineGap de folga. Em layouts grandes (Amaporã), o
    // DECL pode estar a rdy=-60; sem isso o filtro hardcoded antigo
    // (-30 a +5) descartaria todos os valores abaixo da metade do bloco.
    const allOffs = [OFF_TOPO, OFF_CS, OFF_CC, OFF_PROF, OFF_EXTAC, OFF_DECL];
    const rdyMin = Math.min(-30, ...allOffs.map(o => o[0])) - lineGap;
    const rdyMax = Math.max(5,   ...allOffs.map(o => o[1])) + lineGap;

    // Cota lida de uma única célula. Aceita tanto "378.592" (uma linha) quanto
    // o formato multilinha "0+0.00\n2.141\n378.592" (template antigo, 3 linhas).
    // Quando vier multilinha, usa extractGiTubo (3ª linha). Quando vier uma só,
    // retorna parseFloat direto. Ambos os formatos aparecem na prática.
    function parseCotaCell(rawText) {
      const t = cleanMtext(rawText);
      if (t.includes('\n')) {
        const gi = extractGiTubo(rawText);
        if (gi != null) return gi;
        // fallback: pega a maior linha numérica que pareça cota (>= 100)
        const lines = t.split('\n').map(l => l.trim());
        for (const ln of lines) {
          if (/^\d+[.,]\d+$/.test(ln)) {
            const n = parseFloat(ln.replace(',', '.'));
            if (!isNaN(n) && n >= 100) return n;
          }
        }
        return null;
      }
      if (/^\d+[.,]\d+$/.test(t)) {
        const n = parseFloat(t.replace(',', '.'));
        if (!isNaN(n) && n >= 100) return n;
      }
      return null;
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
        if (!(rdy > rdyMin && rdy < rdyMax)) continue;
        const t = cleanMtext(it.text);

        if (rdy > OT[0] && rdy < OT[1] && /^\d{2,4}[.,]\d{2,4}/.test(t)) {
          const n = parseFloat(t.split(/\s+/)[0].replace(',', '.'));
          if (!isNaN(n) && n >= 100) rec.ct = n;
        } else if (rdy > OS[0] && rdy < OS[1]) {
          const v = parseCotaCell(it.text);
          if (v != null) rec.cf_saida = v;
        } else if (rdy > OC[0] && rdy < OC[1]) {
          const v = parseCotaCell(it.text);
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

    // Template MND (cravação): tem as bandas extras do alargador
    //   COTA TOPO / GS ALARGADOR / EIXO ALARGADOR / GI TUBO / ALARG. /
    //   PROFUNDIDADE / DECLIV.(m/m) / DECLIV.(%) / DN TUBO / DN ALARG. / EXTENSÃO …
    // Nesse template a posição do RÓTULO da banda NÃO coincide com a do VALOR
    // (justificação de texto diferente), então a janela por rótulo lê a banda
    // de cima ou de baixo (CT vira GS, declividade vira PROFUNDIDADE).
    // Como as bandas têm passo fixo (lineGap) e ordem rígida, lemos por ÍNDICE
    // ancorando na COTA TOPO (o maior valor de cota da coluna): o número de
    // cada banda é o item cujo dy fica a k*lineGap abaixo do topo.
    const isMnd = labels.gs != null && labels.eixo != null;
    function extractPvMnd(colDx) {
      const tolDx = 2.0;
      const rec = { ct: null, h: null, cf: null, cf_chegada: null, cf_saida: null, ext_acum: null, decl: null, diam: null };
      // Junta os itens numéricos desta coluna com seu dy. Limita à janela
      // vertical do bloco (rdyMin..rdyMax em torno do dyPv) — sem isso, colunas
      // de OUTROS blocos no MESMO X (layouts empilhados no model space) entram
      // e o "maior cota" cai em outro perfil (bug OSE-121: lia bloco 4000u acima).
      const cells = [];
      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx - colDx) > tolDx) continue;
        const rdy = dy - dyPv;
        if (!(rdy > rdyMin && rdy < rdyMax)) continue;
        const t = cleanMtext(it.text);
        cells.push({ dy, t });
      }
      // COTA TOPO = maior cota (>=100) da coluna; é sempre a banda mais alta.
      let topoDy = null, topoVal = null;
      for (const c of cells) {
        const m = c.t.match(/^(\d{2,4}[.,]\d{2,4})$/);
        if (!m) continue;
        const n = parseFloat(m[1].replace(',', '.'));
        if (n >= 100 && (topoDy == null || c.dy > topoDy)) { topoDy = c.dy; topoVal = n; }
      }
      if (topoDy == null) return rec;
      rec.ct = topoVal;
      // slot(k) = dy esperado da k-ésima banda abaixo do topo (k=0 é o topo).
      const slot = (k) => topoDy - k * lineGap;
      const tolY = lineGap * 0.5;
      // Pega o item cujo dy mais se aproxima de slot(k), dentro de tolY.
      const pick = (k) => {
        let best = null, bestD = tolY;
        for (const c of cells) {
          const d = Math.abs(c.dy - slot(k));
          if (d < bestD) { bestD = d; best = c; }
        }
        return best;
      };
      const cotaAt = (k) => {
        const c = pick(k);
        if (!c) return null;
        const m = c.t.match(/^(\d{2,4}[.,]\d{2,4})$/);
        if (!m) return null;
        const n = parseFloat(m[1].replace(',', '.'));
        return n >= 100 ? n : null;
      };
      // Bandas: 0=CT, 1=GS ALARG, 2=EIXO ALARG, 3=GI TUBO (fundo real),
      //         4=PROFUNDIDADE, 5=DECLIV(m/m), 6=DECLIV(%), 7=DN TUBO, 8=DN ALARG.
      const giVal = cotaAt(3);
      if (giVal != null) { rec.cf_saida = giVal; rec.cf_chegada = giVal; }
      const profC = pick(4);
      if (profC) {
        const m = profC.t.match(/^(\d+[.,]\d+)$/);
        if (m) { const n = parseFloat(m[1].replace(',', '.')); if (n > 0 && n < 20) rec.h = n; }
      }
      const declC = pick(5);
      if (declC) {
        const m = declC.t.match(/^(\d+[.,]\d+)$/);
        if (m) { let n = parseFloat(m[1].replace(',', '.')); if (n >= 1) n = n / 100; if (n > 0 && n < 0.2) rec.decl = n; }
      }
      // Banda 7 = DN TUBO (mm) — o DN do TUBO, não o do alargador (banda 8).
      // Ler por índice evita pegar a banda DN ALARG. logo abaixo (bug: 142 lia 200).
      const dnC = pick(7);
      if (dnC) {
        const m = dnC.t.match(/^(\d{2,4})$/);
        if (m) { const n = parseInt(m[1], 10); if (n >= 50 && n <= 1500) rec.diam = n; }
      }
      return rec;
    }

    const blockPvs = {}; // id_norm → { ext_acum, decl }
    for (const name in cols) {
      const colDx = cols[name].dx;
      let rec;
      if (isMnd) {
        // No MND a leitura por índice de banda é confiável; janela por rótulo
        // (extractPv) erra a banda. ext_acum no MND fica em coluna central
        // do trecho (não no PV) — resolvido pelo fallback "por trecho" abaixo.
        rec = extractPvMnd(colDx);
      } else {
      rec = extractPv(colDx, false);

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
        diam: rec.diam != null ? rec.diam : null,   // DN TUBO por PV (só MND)
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
    let Lblock = exts.length ? Math.max(...exts) : null;
    let Iblock = decls.length ? Math.max(...decls) : null;

    // Fallback "por trecho": em layouts onde EXT/DECL aparecem na coluna
    // central do trecho (não na coluna do PV), o extractPv não acha esses
    // valores. Buscamos qualquer item dentro da janela vertical do label,
    // ignorando o dx — pega o valor que está no centro do trecho da OSE.
    if (Lblock == null && OFF_EXTAC) {
      const candExt = [];
      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx) > 200) continue;
        const rdy = dy - dyPv;
        if (!(rdy > OFF_EXTAC[0] && rdy < OFF_EXTAC[1])) continue;
        const t = cleanMtext(it.text);
        const m = t.match(/(\d+[.,]\d+)\s*m\b/);
        if (m) candExt.push(parseFloat(m[1].replace(',', '.')));
      }
      if (candExt.length) Lblock = Math.max(...candExt);
    }
    if (Iblock == null && OFF_DECL) {
      const candDecl = [];
      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx) > 200) continue;
        const rdy = dy - dyPv;
        if (!(rdy > OFF_DECL[0] && rdy < OFF_DECL[1])) continue;
        const t = cleanMtext(it.text);
        const ls = t.split('\n').map(l => l.trim().replace(',', '.'));
        for (const ln of ls) {
          const m = ln.match(/^([\d.]+)\s*%?$/);
          if (!m) continue;
          let n = parseFloat(m[1]);
          if (isNaN(n) || n <= 0) continue;
          if (ln.includes('%') || n >= 1) n = n / 100;
          if (n > 0 && n < 0.2) { candDecl.push(n); break; }
        }
      }
      if (candDecl.length) Iblock = Math.max(...candDecl);
    }

    // DN do tubo: extraído da linha da label "DIÂMETRO/DN/Ø/MATERIAL" no
    // perfil 2S. Pode estar como "150" puro, "DN 150", "Ø150", "PVC 200 mm",
    // "MATERIAL/DIÂMETRO: PVC OCRE 150". Pegamos o MAIOR DN encontrado na linha
    // (caso o desenho mostre "150" e "DN150" lado a lado, dá no mesmo).
    let Dblock = null;
    if (isMnd) {
      // No MND lemos o DN TUBO por banda-índice em cada coluna de PV (banda 7,
      // distinta da banda DN ALARG.). Pega o DN do tubo mais frequente do bloco.
      const dnByPv = Object.values(blockPvs).map(b => b.diam).filter(v => v != null);
      if (dnByPv.length) {
        const counts = {};
        for (const d of dnByPv) counts[d] = (counts[d] || 0) + 1;
        Dblock = parseInt(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0], 10);
      }
    } else if (OFF_DIAM) {
      const candDiam = [];
      for (const it of items) {
        const dx = it.x - cx, dy = it.y - cy;
        if (Math.abs(dx) > 200) continue;
        const rdy = dy - dyPv;
        if (!(rdy > OFF_DIAM[0] && rdy < OFF_DIAM[1])) continue;
        const t = cleanMtext(it.text);
        // Casa qualquer número de 2-4 dígitos. Range 50..1500 cobre o domínio
        // de DN sanitário; descarta ruído tipo "2020" (ano) ou anos/cotas.
        const all = t.matchAll(/(?:Ø|DN|D\.?N\.?)?\s*(\d{2,4})(?:\s*mm)?/gi);
        for (const m of all) {
          const n = parseInt(m[1], 10);
          if (n >= 50 && n <= 1500) candDiam.push(n);
        }
      }
      if (candDiam.length) Dblock = Math.max(...candDiam);
    }

    if (!perOse[a.ose] || (Lblock != null && (perOse[a.ose].L == null || Lblock > perOse[a.ose].L))) {
      perOse[a.ose] = { L: Lblock, i: Iblock, diam: Dblock, pvs: blockPvs };
    } else if (perOse[a.ose] && perOse[a.ose].diam == null && Dblock != null) {
      perOse[a.ose].diam = Dblock;
    }
  }

  // Aviso crítico se a extração de PVs do perfil falhou em grande escala —
  // anchors achadas mas nenhum (ou quase nenhum) dado lido. Caso comum: layout
  // do DXF fora do template esperado (escala diferente, rótulos renomeados).
  // Sem esse aviso, a Conferência mostra "Perfil: —" silenciosamente em todas
  // as colunas e o engenheiro acredita que está OK quando na verdade o parser
  // desistiu. Threshold: anchors >= 5 mas data extraída em < 30% delas.
  const anchorCount = anchors.length;
  const pvsWithData = Object.keys(pvResult).length;
  const pvDataRatio = anchorCount > 0 ? pvsWithData / anchorCount : 1;
  if (anchorCount >= 5 && pvDataRatio < 0.30) {
    warnings.push(
      '[CRÍTICO] ' + fileName + ': ' + anchorCount + ' OSEs presentes no perfil mas dados extraídos em apenas ' +
      pvsWithData + ' PVs (' + Math.round(pvDataRatio * 100) + '%). Layout do DXF fora do template padrão — ' +
      'comparação Mapa↔Perfil DESATIVADA. Verifique se os rótulos "COTA TOPO", "CC:GI DO TUBO", "CS:GI DO TUBO", ' +
      '"PROFUNDIDADE", "EXTENSÃO", "DECLIVIDADE" estão presentes na coluna esquerda do bloco do perfil.'
    );
  }

  return { present: Array.from(present).sort(), pvs: pvResult, perOse, encoding, warnings,
           extractStats: { anchors: anchorCount, pvsWithData, pvDataRatio } };
}

// ── EXCEL ──────────────────────────────────────────────────────────────────
function parseExcel(filePath) {
  const wb = xlsx.readFile(filePath, { cellFormula: false, cellNF: false, sheetStubs: false });
  const result = {};

  for (const sheetName of wb.SheetNames) {
    // Aceita `OSE-NNN` e `OSE-NNNA/B/C` (sufixo opcional de letra).
    // Em projetos como Ubiratã, OSE-590A é uma OSE legítima e DISTINTA
    // da OSE-590 — precisam conviver como chaves separadas.
    const m = sheetName.match(/^OSE[\s\-]+(\d+[A-Za-z]?)$/i);
    if (!m) continue;
    const oseNum = normOseNum(m[1]);
    const ws = wb.Sheets[sheetName];

    // Comprimento total: cell C6. CUIDADO: quando a fórmula dá erro (#N/A, #REF!,
    // etc.) o SheetJS marca a célula com t==='e' e v = CÓDIGO do erro — e o código
    // do #N/A é 42. Sem checar t!=='e', o parser lia "42" como se fosse o
    // comprimento → bug "TODAS as OSEs com 42 m" (planilhas REV02 do Diamante têm
    // C6 = #N/A). O fallback por coordenadas abaixo cobre esse caso.
    let comp = null;
    const c6 = ws[xlsx.utils.encode_cell({ r: 5, c: 2 })];
    if (c6 && c6.t !== 'e' && typeof c6.v === 'number') comp = rnd(c6.v, 4);

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
    const seq = [];   // poligonal (este,norte) de TODOS os pontos p/ comprimento real
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
        // Coluna P = "Diam. Interno" (DI) na convenção 2S/SANEPAR. Convertemos
        // pra DN NOMINAL (150, 200, ...) usando a tabela NBR 14486 — assim o
        // valor casa com o que aparece no DXF e o check de "DN divergente" só
        // dispara quando o tubo realmente foi desenhado com DN diferente.
        diam:          diamToNominal(get(15)),  // col P → DN nominal
        diam_interno:  get(15),                 // mantido pra debug/legado
        prof:      get(18),  // col S — Prof. Vala
        obs:       getStr(20), // col U — Observações
      };

      if (!grouped[id]) {
        grouped[id] = [];
        order.push(id);
      }
      grouped[id].push(rec);
      // poligonal p/ comprimento real (fallback): coords levantadas em ordem.
      if (rec.este != null && rec.norte != null) seq.push([rec.este, rec.norte]);
    }

    // Fallback do comprimento: se a planilha não traz (C6 #N/A/erro), calcula
    // pela poligonal das coordenadas (PV+TL+PIT em ordem de lançamento) — é o
    // comprimento REAL da vala. Ignora pontos repetidos e saltos absurdos.
    if (comp == null && seq.length >= 2) {
      let L = 0;
      for (let i = 1; i < seq.length; i++) {
        const dx = seq[i][0] - seq[i - 1][0], dy = seq[i][1] - seq[i - 1][1];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.001 && d < 1000) L += d;
      }
      if (L > 0) comp = rnd(L, 2);
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
        // DN nominal (já convertido de DI no parseExcel via diamToNominal).
        diam:           base.diam != null ? Math.round(base.diam) : null,
        diam_interno:   base.diam_interno != null ? Math.round(base.diam_interno) : null,
        tq:         rnd(tq, 4),
        tq_decl:    rnd(tq_decl, 4),   // degrau declarado na obs (null se ausente)
        has_tq,
        // Coordenadas UTM declaradas na planilha (mais confiáveis que DXF)
        excel_este:  rnd(este,  3),
        excel_norte: rnd(norte, 3),
        excel_cota:  rnd(cota,  3),
      });
    }

    // Sinaliza tipo de obra por OSE: PIT → MND (cravação), estaca → VCA.
    // ESTACA pode aparecer na coluna A como "E-NNN"/"EST-NNN" ou descrita na
    // coluna de observações. Verifica ambos.
    const has_pit    = order.some(id => /^PIT/i.test(id));
    const has_estaca = order.some(id => /^(?:E|EST|ESTACA)[\s\-]?\d/i.test(id))
                    || Object.values(grouped).some(rows =>
                         rows.some(row => /\bESTACA\b|\bESTAQUEAD/i.test(row.obs || '')));

    result[oseNum] = { comprimento: comp, pvs, has_pit, has_estaca };
  }

  return result;
}

// Converte Diâmetro Interno (DI) declarado na planilha (NBR 14486 / PVC
// OCRE PBA SANEPAR) para o DN NOMINAL correspondente. A planilha 2S grava
// o DI ("Diam. Interno") na coluna P; o desenho (mapa/perfil) mostra o DN
// nominal. Sem conversão, comparar 144mm (planilha) com 150mm (desenho)
// vira falso positivo de DN divergente em TODAS as OSEs.
//
// Tabela de pares (DI → DN) baseada nos diâmetros típicos de PVC OCRE PBA
// e PEAD usados em coletor sanitário. Tolerância de 6mm no match.
const DI_TO_DN_TABLE = [
  { di: 75,   dn: 75 },
  { di: 97,   dn: 100 },
  { di: 144,  dn: 150 },
  { di: 192,  dn: 200 },
  { di: 240,  dn: 250 },
  { di: 287,  dn: 300 },
  { di: 333,  dn: 350 },
  { di: 384,  dn: 400 },
  { di: 480,  dn: 500 },
  { di: 575,  dn: 600 },
  { di: 670,  dn: 700 },
  { di: 768,  dn: 800 },
  { di: 864,  dn: 900 },
  { di: 960,  dn: 1000 },
  { di: 1152, dn: 1200 },
  { di: 1440, dn: 1500 },
];
const DN_NOMINAIS = new Set([75, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500]);
function diamToNominal(value) {
  if (value == null || isNaN(value)) return null;
  const v = Math.round(value);
  if (DN_NOMINAIS.has(v)) return v;
  for (const p of DI_TO_DN_TABLE) {
    if (Math.abs(p.di - v) <= 6) return p.dn;
  }
  // Sem match — devolve o valor lido pra não ocultar dado ruim.
  return v;
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
    // DN do tubo extraído do label da OSE no DXF de mapas (Ø150mm / DN200).
    // Sempre por-OSE: a convenção 2S/SANEPAR mantém DN único por trecho de OSE.
    const mapaDiam = mapaOse.diam != null ? mapaOse.diam : null;
    // DN extraído do bloco do perfil (max dentre os PVs do bloco). Mesmo
    // raciocínio: DN é por-OSE — qualquer divergência DENTRO do bloco já
    // seria erro de desenho e seria pego pela média do bloco.
    const perfDiamOse = (perOse[num] && perOse[num].diam != null) ? perOse[num].diam : null;

    const pvComps = [];
    const seen = new Set();
    for (const ep of excelPvs) {
      const pid = ep.id_norm;
      if (seen.has(pid)) continue;
      seen.add(pid);

      const mpv = mapa.pvs[pid]   || {};
      const ppv = perfisPvs[pid]  || {};
      const blockPv = (perOse[num] && perOse[num].pvs && perOse[num].pvs[pid]) || {};
      // ext_acum e decl SÃO específicos do bloco da OSE — PVs compartilhados
      // entre OSEs têm valores diferentes em cada bloco. NÃO cair pro global
      // ppv.ext_acum/decl, pois o global é o do PRIMEIRO bloco visto e leva
      // a falso slope (ex.: 129% por L errado). Se o bloco desta OSE não
      // tem o dado (layout com ext/decl em coluna central, não no PV), o
      // check trecho-a-trecho no perfil é desabilitado pra esse trecho —
      // que é o comportamento correto.
      const pv_ext_local  = blockPv.ext_acum != null ? blockPv.ext_acum : null;
      const pv_decl_local = blockPv.decl     != null ? blockPv.decl     : null;

      // CF do perfil: usa dados do bloco desta OSE se disponível, senão global.
      // Para cf_chegada e cf_saida: bloco tem prioridade.
      // Para cf canônico: se o bloco tem cf_saida, usa ele (fundo real);
      // senão fallback para global cf (que é o min de todos os blocos).
      // CORREÇÃO GI MND (Lucas 2026-06-05): SÓ em MND. Em VCA o perfil já sai na
      // geratriz inferior (testado: bate com a planilha ao mm). Em MND a banda
      // "GI DO TUBO" mostra o EIXO do tubo/alargador → GI real = eixo − DN_tubo/2.
      // Gate por has_pit (planilha MND tem PITs; VCA tem estacas → sem desconto).
      const dnOse = mapaDiam != null ? mapaDiam
                  : (perfDiamOse != null ? perfDiamOse
                  : (ep.diam != null ? ep.diam : null));
      // offGi: desconto da GI ficou OBSOLETO. Antes o perfil MND era lido das
      // linhas erradas (GS/EIXO do alargador) e descontava DN/2 pra aproximar a
      // GI. Agora detectPerfilLabels lê a linha "GI TUBO / ALARG." direto (= GI
      // real, casa com a planilha), então NÃO desconta nada. dnOse mantido só
      // para diagnóstico de DN.
      const offGi = 0;

      let blk_cf_chegada  = blockPv.cf_chegada  != null ? blockPv.cf_chegada  : ppv.cf_chegada;
      let blk_cf_saida    = blockPv.cf_saida    != null ? blockPv.cf_saida    : ppv.cf_saida;
      if (blk_cf_chegada != null) blk_cf_chegada = +(blk_cf_chegada - offGi).toFixed(3);
      if (blk_cf_saida   != null) blk_cf_saida   = +(blk_cf_saida   - offGi).toFixed(3);
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
               : (blockPv.cf != null ? +(blockPv.cf - offGi).toFixed(3)
               : (ppv.cf != null ? +(ppv.cf - offGi).toFixed(3) : null));
      }
      const blk_ct          = blockPv.ct          != null ? blockPv.ct          : ppv.ct;
      const blk_h           = blockPv.h           != null ? blockPv.h           : ppv.h;

      // diff_cf_perf = MELHOR par entre {chegada, saída, canônico} do perfil e
      // {chegada, fundo} da planilha. Um PV compartilhado aparece em vários
      // blocos de OSE: no bloco onde a OSE CHEGA nele, o perfil mostra a cota
      // de CHEGADA (alta), que casa com a "Chegada Plan." da planilha — não com
      // o FUNDO. Comparar so contra o fundo flagava falsa divergencia (1m+).
      const _cfPairs = [];
      const _add = (a, b) => { if (a != null && b != null) _cfPairs.push(rnd(a - b, 3)); };
      _add(ep.cf_pv,      blk_cf);
      _add(ep.cf_pv,      blk_cf_saida);
      _add(ep.cf_chegada, blk_cf_chegada);
      _add(ep.cf_chegada, blk_cf);
      const diffCfPerf = _cfPairs.length
        ? _cfPairs.reduce((m, v) => Math.abs(v) < Math.abs(m) ? v : m)
        : null;

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
      // Só usa cf_chegada do BLOCO desta OSE — sem fallback global. Em PV de
      // junção (cabeceira de uma OSE que é PV final de outra), o global vem
      // do bloco da OUTRA OSE e gera falso positivo de T.Q. divergente.
      const gi_cheg = blockPv.cf_chegada != null ? blockPv.cf_chegada : null;
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
        // Cota do TERRENO declarada na coluna D da planilha. Diferente de
        // excel_ct (que é a cota do TOPO do PV). Útil pra cross-check: o CT
        // do perfil deve casar com excel_cota; se divergir muito, indica
        // que o levantamento topográfico não foi atualizado no perfil.
        excel_cota:   ep.excel_cota,
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
        // DN do tubo é por-OSE (lido do label OSE no mapa) — replicado em cada
        // PV pra simplificar comparação no classifyOse e exportação.
        mapa_diam:    mapaDiam,
        perf_diam:    perfDiamOse,
        diff_diam_map_exc: (ep.diam != null && mapaDiam   != null) ? Math.abs(ep.diam - mapaDiam)   : null,
        diff_diam_per_exc: (ep.diam != null && perfDiamOse != null) ? Math.abs(ep.diam - perfDiamOse) : null,
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
        diff_cf_perf:      diffCfPerf,
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
        // Presença individual do PV em cada fonte. PV existe na PLANILHA (porque
        // estamos iterando ep), mas pode faltar no MAPA (multileader ausente) ou
        // no PERFIL (bloco do perfil não desenhado). Bug típico: PV adicionado
        // só na planilha sem atualizar o desenho.
        in_pv_mapa:    !!(mpv && (mpv.ct != null || mpv.cf != null || mpv.h != null)),
        in_pv_perfil:  !!(blockPv && (blockPv.ct != null || blockPv.cf != null || blockPv.h != null)),
        in_pv_excel:   true,
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
      mapa_diam:   mapaDiam,
      perfil_diam: perfDiamOse,
      diff_L:    diff(mapaL, excelL, 3),
      diff_i:    diff(mapaI, excelI, 6),
      diff_L_perf: diff(mapaL, perOse[num] ? perOse[num].L : null, 3),
      diff_i_perf: diff(mapaI, perOse[num] ? perOse[num].i : null, 6),
      // Tipo de obra detectado da planilha: PIT → MND, ESTACA → VCA.
      // Usado por classifyOse pra decidir as regras (distância máx + decl mín).
      has_pit:    !!excelOse.has_pit,
      has_estaca: !!excelOse.has_estaca,
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
  detectDxfFormat, DxfFormatError, DxfTooLargeError, readDxfText, scanDxfWarnings,
  DXF_MAX_BYTES,
  // Utilities puras expostas pra testes unitários (sem fixtures).
  utils: {
    normOseNum, normalizeId, pf, rnd, firstNum, lastNum, cleanMtext, extractGiTubo,
  },
};
