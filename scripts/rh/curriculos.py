# -*- coding: utf-8 -*-
r"""
Banco de Curriculos (modulo RH do Nexus) — motor de indice local + busca.
Operacoes (via --config <json>): importar | buscar | excluir | listar | reindex.
Saida: 1 linha JSON no stdout (padrao dos scripts do Nexus).

Store: <store>\arquivos\<id>__<nome>  +  <store>\index.json
index.json = [ {id, nome, origem, regiao, tags[], cidade, estado, sexo, estado_civil, texto, chars, data} ]

Extracao de texto: pdf (pypdf -> pdfplumber fallback), docx, odt, txt/rtf.
Sem libs -> arquivo entra no indice sem texto (ainda buscavel por nome).
"""
import os, sys, json, re, shutil, unicodedata, zipfile, uuid, datetime, glob
from collections import Counter

EXTS = ('.pdf', '.docx', '.doc', '.odt', '.txt', '.rtf')

def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()

KW_PROJ = ['projetista','desenhista','cadista','autocad','civil 3d','civil3d','revit','sewergems','epanet','prancha','desenho tecnico']
KW_TOPO = ['topograf','agrimens','estacao total','nivelamento','planialt','geodes','gnss','georreferenc']
KW_AGUA = ['abastecimento de agua','rede de agua','adutora','aducao','reservatorio','saneamento','agua potavel','hidraulic']

def tags_de(texto):
    n = norm(texto)
    t = []
    if any(k in n for k in KW_PROJ): t.append('projetista')
    if any(k in n for k in KW_TOPO): t.append('topografo')
    if any(k in n for k in KW_AGUA): t.append('agua')
    return t

# ---------- extracao de CAMPOS estruturados (cidade/estado/sexo/estado civil) ----------
UFS = {'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'}
# nomes por extenso -> UF (mais especifico primeiro)
UF_NOME = [('mato grosso do sul','MS'),('mato grosso','MT'),('rio grande do sul','RS'),('rio grande do norte','RN'),
 ('rio de janeiro','RJ'),('espirito santo','ES'),('minas gerais','MG'),('sao paulo','SP'),('santa catarina','SC'),
 ('distrito federal','DF'),('parana','PR'),('paraiba','PB'),('para','PA'),('pernambuco','PE'),('piaui','PI'),
 ('bahia','BA'),('ceara','CE'),('goias','GO'),('maranhao','MA'),('amazonas','AM'),('amapa','AP'),('acre','AC'),
 ('alagoas','AL'),('sergipe','SE'),('tocantins','TO'),('rondonia','RO'),('roraima','RR')]
UFRE = '|'.join(sorted(UFS))
RE_CIDUF = re.compile(r"([A-ZÀ-Ý][A-Za-zÀ-ÿ'’.]+(?:\s+(?:de|do|da|dos|das)\s+|\s+)?(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.]+){0,3})\s*[-/–]\s*(" + UFRE + r")(?![A-Za-z])")

def _estado_civil(n):
    m = re.search(r'estado civil[:\s]+([a-z\(\)/ ]{3,25})', n)
    seg = m.group(1) if m else n
    for k, v in [('uniao estavel','União estável'),('divorciad','Divorciado(a)'),('desquitad','Divorciado(a)'),
                 ('separad','Separado(a)'),('viuv','Viúvo(a)'),('casad','Casado(a)'),('solteir','Solteiro(a)')]:
        if k in seg: return v
    return ''

def _sexo(n):
    m = re.search(r'sexo[:\s]+(masculino|feminino|m|f)\b', n)
    if m:
        return 'Masculino' if m.group(1) in ('masculino','m') else 'Feminino'
    masc = len(re.findall(r'\b(brasileiro|solteiro|casado|divorciado|viuvo|separado|nascido)\b', n))
    fem  = len(re.findall(r'\b(brasileira|solteira|casada|divorciada|viuva|separada|nascida)\b', n))
    if masc > fem and masc: return 'Masculino'
    if fem > masc and fem:  return 'Feminino'
    return ''

def _local(raw, n):
    cidade = ''; estado = ''
    for mm in RE_CIDUF.finditer(raw):
        c = mm.group(1).strip(" .,-'’"); uf = mm.group(2).upper()
        if uf in UFS and 2 <= len(c) <= 38 and not re.search(r'\d', c) and 'rua' not in norm(c) and 'av ' not in norm(c):
            cidade = c; estado = uf; break
    if not estado:
        for nome, uf in UF_NOME:
            if re.search(r'\b' + re.escape(nome) + r'\b', n): estado = uf; break
    return cidade, estado

def extrair_campos(texto, nome=''):
    raw = (texto or '') + ' ' + (nome or '')
    n = norm(raw)
    cidade, estado = _local(raw, n)
    return dict(cidade=cidade, estado=estado, sexo=_sexo(n), estado_civil=_estado_civil(n))

# ---------- extracao de texto ----------
def _pdf(p):
    txt = ''
    try:
        import pypdf
        for pg in pypdf.PdfReader(p).pages[:8]:
            try: txt += ' ' + (pg.extract_text() or '')
            except: pass
    except Exception: pass
    if len(txt.strip()) < 30:
        try:
            import pdfplumber
            with pdfplumber.open(p) as pdf:
                for pg in pdf.pages[:5]:
                    txt += ' ' + (pg.extract_text() or '')
        except Exception: pass
    return txt

def _docx(p):
    try:
        import docx
        return ' '.join(x.text for x in docx.Document(p).paragraphs)
    except Exception: return ''

def _odt(p):
    try:
        with zipfile.ZipFile(p) as z:
            return re.sub(r'<[^>]+>', ' ', z.read('content.xml').decode('utf-8','ignore'))
    except Exception: return ''

def _txt(p):
    for enc in ('utf-8','latin-1'):
        try: return open(p, encoding=enc).read()
        except: pass
    return ''

def extrair(p):
    e = p.lower().rsplit('.', 1)[-1]
    if e == 'pdf': return _pdf(p)
    if e == 'docx': return _docx(p)
    if e == 'odt': return _odt(p)
    if e in ('txt','rtf'):
        t = _txt(p)
        return re.sub(r'\\[a-z]+\d* ?', ' ', t) if e == 'rtf' else t
    return ''   # .doc antigo: sem extracao (entra so com nome)

# ---------- indice ----------
def load_index(store):
    p = os.path.join(store, 'index.json')
    try: return json.load(open(p, encoding='utf-8'))
    except: return []

def save_index(store, idx):
    os.makedirs(store, exist_ok=True)
    json.dump(idx, open(os.path.join(store,'index.json'),'w',encoding='utf-8'), ensure_ascii=False)

def safe(n): return re.sub(r'[<>:"/\\|?*\r\n]', '_', n)

def importar(c):
    store = c['store']; arqdir = os.path.join(store,'arquivos'); os.makedirs(arqdir, exist_ok=True)
    idx = load_index(store)
    vistos = set(os.path.normcase(os.path.abspath(it.get('origem',''))) for it in idx)
    alvos = []
    for raw in c.get('paths', []):
        if os.path.isdir(raw):
            for root,_,fs_ in os.walk(raw):
                for f in fs_:
                    if f.lower().endswith(EXTS): alvos.append(os.path.join(root,f))
        elif os.path.isfile(raw) and raw.lower().endswith(EXTS):
            alvos.append(raw)
    novos = 0; dup = 0; data = datetime.datetime.now().isoformat(timespec='seconds')
    for src in alvos:
        ab = os.path.normcase(os.path.abspath(src))
        if ab in vistos: dup += 1; continue
        vistos.add(ab)
        rid = uuid.uuid4().hex[:12]
        nome = os.path.basename(src)
        rel = os.path.relpath(src, c.get('raiz', os.path.dirname(src))) if c.get('raiz') else nome
        regiao = (rel.split(os.sep)[0] if os.sep in rel else '').replace('CURRÍCULOS ','').replace('Currículos_','')
        dst = os.path.join(arqdir, rid + '__' + safe(nome))
        try: shutil.copyfile(src, dst)
        except Exception: continue
        txt = extrair(src)
        it = dict(id=rid, nome=nome, origem=src, arquivo=dst, regiao=regiao,
                  tags=tags_de(txt+' '+nome), texto=(txt or '')[:200000],
                  chars=len(txt or ''), data=data)
        it.update(extrair_campos(txt, nome))
        idx.append(it)
        novos += 1
    save_index(store, idx)
    return dict(ok=True, importados=novos, duplicados=dup, encontrados=len(alvos), total=len(idx))

def reindex(c):
    """Recalcula campos (cidade/estado/sexo/estado_civil) + tags dos itens ja indexados, a partir do texto guardado."""
    store = c['store']; idx = load_index(store); n = 0
    for it in idx:
        it.update(extrair_campos(it.get('texto',''), it.get('nome','')))
        it['tags'] = tags_de((it.get('texto','') or '') + ' ' + it.get('nome',''))
        n += 1
    save_index(store, idx)
    return dict(ok=True, reindexados=n, total=len(idx))

def _facetas(items):
    def fac(key, multi=False):
        c = Counter()
        for it in items:
            v = it.get(key)
            if multi:
                for x in (v or []):
                    if x: c[x] += 1
            elif v: c[v] += 1
        return [{'v': k, 'n': c[k]} for k in sorted(c, key=lambda x: (-c[x], x))]
    return dict(estado=fac('estado'), cidade=fac('cidade'), sexo=fac('sexo'),
                estado_civil=fac('estado_civil'), tag=fac('tags', True))

def buscar(c):
    store = c['store']; q = norm(c.get('query','')).strip()
    filtros = c.get('filtros') or {}
    idx = load_index(store)
    termos = [t for t in q.split() if t]
    # passo 1: filtro por TEXTO (palavra-chave)
    matched = []
    for it in idx:
        hay = norm(it.get('nome','') + ' ' + it.get('texto','') + ' ' + ' '.join(it.get('tags',[])))
        if all(t in hay for t in termos):
            score = sum(hay.count(t) for t in termos) if termos else 0
            matched.append((score, it))
    facetas = _facetas([it for _, it in matched])   # opcoes disponiveis p/ a busca textual atual
    # passo 2: filtros ESTRUTURADOS
    def passa(it):
        for k in ('estado','cidade','sexo','estado_civil'):
            fv = filtros.get(k)
            if fv and it.get(k) != fv: return False
        tagf = filtros.get('tag')
        if tagf and tagf not in (it.get('tags') or []): return False
        return True
    res = [(s, it) for s, it in matched if passa(it)]
    res.sort(key=lambda r: r[0], reverse=True)
    out = [dict(id=it['id'], nome=it['nome'], regiao=it.get('regiao',''), tags=it.get('tags',[]),
                arquivo=it['arquivo'], chars=it.get('chars',0), data=it.get('data',''),
                cidade=it.get('cidade',''), estado=it.get('estado',''),
                sexo=it.get('sexo',''), estado_civil=it.get('estado_civil','')) for _, it in res[:500]]
    return dict(ok=True, total=len(idx), encontrados=len(res), itens=out, facetas=facetas)

def excluir(c):
    store = c['store']; ids = set(c.get('ids', []))
    idx = load_index(store); rem = 0; novo = []
    for it in idx:
        if it['id'] in ids:
            try:
                if os.path.exists(it['arquivo']): os.remove(it['arquivo'])
            except: pass
            rem += 1
        else: novo.append(it)
    save_index(store, novo)
    return dict(ok=True, removidos=rem, total=len(novo))

def listar(c):
    return buscar(dict(store=c['store'], query='', filtros=c.get('filtros')))

def main():
    cfgp = None
    for i,a in enumerate(sys.argv):
        if a == '--config' and i+1 < len(sys.argv): cfgp = sys.argv[i+1]
    if not cfgp:
        print(json.dumps(dict(ok=False, erro='sem --config'))); return
    c = json.load(open(cfgp, encoding='utf-8'))
    op = c.get('op')
    try:
        r = {'importar':importar,'buscar':buscar,'excluir':excluir,'listar':listar,'reindex':reindex}[op](c)
    except Exception as e:
        r = dict(ok=False, erro=str(e))
    print(json.dumps(r, ensure_ascii=False))

if __name__ == '__main__':
    main()
