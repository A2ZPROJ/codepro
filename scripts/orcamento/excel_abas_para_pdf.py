# -*- coding: utf-8 -*-
"""
Exporta CADA ABA de uma planilha Excel como um PDF separado.
O nome de cada PDF = nome da aba (sanitizado), ex.: OSE-001.pdf, OSE-002.pdf...

Motor de LINHA DE COMANDO que o Nexus (Electron) chama. Usa o Excel instalado
na maquina via COM (win32com / pywin32): abre a planilha invisivel e para cada
aba roda ExportAsFixedFormat(0, <caminho.pdf>) (0 = xlTypePDF).

AREA IMPRESSA (o pulo do gato)
------------------------------
ws.ExportAsFixedFormat() joga no PDF a USED RANGE INTEIRA da aba. Nas planilhas
de OSE isso arrasta as colunas auxiliares (dados brutos, tabelas de apoio,
"NAO MEXER"...) e o PDF sai gigante - foi exatamente o defeito reclamado.
Como as abas de OSE NAO tem Print_Area definida (conferido: 0 print areas em
937 abas), nao adianta so pedir pro Excel respeitar a area de impressao.

Ordem de decisao, por aba:
  1. cfg["area"]                -> usa esse range (ex.: "E1:U75");
  2. PageSetup.PrintArea != ""  -> respeita a area de impressao da aba;
  3. auto_area (padrao ligado)  -> DETECTA o quadro da OSE:
        - acha a celula da ancora (padrao "ORDEM DE SERVI");
        - esquerda/topo = inicio da celula mesclada do titulo;
        - direita = anda pra direita enquanto a moldura (bordas) continuar;
        - baixo   = ultima linha com conteudo dentro dessas colunas;
  4. senao                      -> aba inteira (comportamento antigo).
Linhas ocultas continuam ocultas no PDF (o Excel nao imprime linha oculta).
O arquivo fonte NUNCA e alterado (ReadOnly + export por Range).

PAPEL A4
--------
O Excel usa o papel do DRIVER da impressora padrao (aqui, Foxit PDF Editor
Printer), que ignora PageSetup.PaperSize: o PDF sai 966x746 pt em vez de A4.
Por isso o papel e acertado depois, no PDF (padronizar_papel), mantendo vetor.

Interface:
  --config <json>  arquivo JSON com os campos:
     planilha    (str)  xlsx de entrada (obrigatorio)
     destino     (str)  pasta de saida (obrigatorio; criada se nao existir)
     prefixo     (str)  opcional; so exporta abas cujo nome comeca com esse
                        prefixo (ex.: "OSE"). Vazio = todas.
     area        (str)  opcional; range fixo pra todas as abas (ex.: "E1:U75").
     auto_area   (bool) opcional, padrao True; detecta o quadro automaticamente.
     ancora      (str)  opcional; texto que ancora a deteccao.
     papel       (str)  "a4" (padrao) reencaixa cada PDF em A4; "original"
                        deixa o papel que o driver da impressora impuser.
     abrir_pasta (bool) opcional; sem efeito aqui (o Nexus abre a pasta).

  (tambem aceita as mesmas chaves via flags CLI; CLI sobrepoe o JSON.)

Saida (stdout, ULTIMA linha): JSON
  ok:    {"ok":true,"n_pdfs":N,"pasta":"...","abas":[...],"area":"E1:U75",
          "modo_area":"auto","papel":"a4","avisos":[]}
  erro:  {"ok":false,"erro":"..."}  + exit 1

Robustez:
  - cria a pasta destino se nao existir;
  - se win32com/pywin32 nao estiver instalado, tenta `pip install pywin32`;
  - garante xl.Quit() mesmo em erro (try/finally); DisplayAlerts=False, Visible=False;
  - se a deteccao falhar numa aba, cai pra aba inteira e registra em "avisos".

Autor: Claude Code (Opus) p/ Lucas Abdala / 2S Engenharia.
"""
import os
import sys
import json
import argparse
import subprocess


# --- constantes COM do Excel ------------------------------------------------
XL_TYPE_PDF = 0
XL_LINESTYLE_NONE = -4142
XL_EDGES = (7, 8, 9, 10)      # xlEdgeLeft, Top, Bottom, Right
XL_VALUES = -4163
XL_FORMULAS = -4123
XL_PART = 2
XL_BY_ROWS = 1
XL_PREVIOUS = 2

ANCORA_PADRAO = "ORDEM DE SERVI"   # pega "ORDEM DE SERVICO" com ou sem cedilha
MAX_COLS_DIREITA = 200             # trava de seguranca no passeio pra direita
MAX_LINHAS_REF = 40                # ate onde procurar a linha de referencia


def _eprint(*a):
    print(*a, file=sys.stderr)


def _emit_ok(n_pdfs, pasta, abas, area, modo_area, papel, avisos):
    print(json.dumps({"ok": True, "n_pdfs": n_pdfs, "pasta": pasta, "abas": abas,
                      "area": area or "", "modo_area": modo_area or "",
                      "papel": papel or "original", "avisos": avisos or []},
                     ensure_ascii=False))
    sys.stdout.flush()


def _emit_err(msg):
    print(json.dumps({"ok": False, "erro": str(msg)}, ensure_ascii=False))
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# CONFIG / CLI
# ---------------------------------------------------------------------------
def build_config():
    ap = argparse.ArgumentParser(
        description="Exporta cada aba de um Excel como um PDF separado (nome=aba).")
    ap.add_argument("--config", help="Arquivo JSON com os campos (o Nexus passa este).")
    ap.add_argument("--planilha", help="Caminho do .xlsx de entrada.")
    ap.add_argument("--destino", help="Pasta de saida dos PDFs.")
    ap.add_argument("--prefixo", help="So exporta abas que comecam com este prefixo.")
    ap.add_argument("--area", help="Range fixo a exportar em todas as abas (ex.: E1:U75).")
    ap.add_argument("--ancora", help="Texto que ancora a deteccao do quadro.")
    ap.add_argument("--papel", help="a4 (padrao) ou original (papel do driver).")
    ap.add_argument("--sem-auto-area", dest="sem_auto_area", action="store_true",
                    help="Nao detectar o quadro; exporta a aba inteira.")
    ap.add_argument("--abrir-pasta", dest="abrir_pasta", action="store_true")
    args = ap.parse_args()

    cfg = {"planilha": None, "destino": None, "prefixo": "", "area": "",
           "auto_area": True, "ancora": ANCORA_PADRAO, "papel": "a4",
           "abrir_pasta": False}

    if args.config:
        with open(args.config, "r", encoding="utf-8") as f:
            jc = json.load(f)
        for k, v in jc.items():
            cfg[k.replace("-", "_")] = v

    explicit = {a.split("=")[0].lstrip("-").replace("-", "_")
                for a in sys.argv[1:] if a.startswith("--")}
    if "planilha" in explicit and args.planilha is not None:
        cfg["planilha"] = args.planilha
    if "destino" in explicit and args.destino is not None:
        cfg["destino"] = args.destino
    if "prefixo" in explicit and args.prefixo is not None:
        cfg["prefixo"] = args.prefixo
    if "area" in explicit and args.area is not None:
        cfg["area"] = args.area
    if "ancora" in explicit and args.ancora is not None:
        cfg["ancora"] = args.ancora
    if "papel" in explicit and args.papel is not None:
        cfg["papel"] = args.papel
    if "sem_auto_area" in explicit:
        cfg["auto_area"] = False
    if "abrir_pasta" in explicit:
        cfg["abrir_pasta"] = True

    cfg["prefixo"] = (cfg.get("prefixo") or "").strip()
    cfg["area"] = (cfg.get("area") or "").strip()
    cfg["ancora"] = (cfg.get("ancora") or ANCORA_PADRAO).strip() or ANCORA_PADRAO
    cfg["auto_area"] = bool(cfg.get("auto_area", True))
    cfg["papel"] = (cfg.get("papel") or "").strip().lower()
    if cfg["papel"] in ("", "original", "driver", "nao", "false"):
        cfg["papel"] = ""
    return cfg


# ---------------------------------------------------------------------------
# win32com (pywin32) - importa, instalando sob demanda se faltar
# ---------------------------------------------------------------------------
def _ensure_win32com():
    try:
        import win32com.client  # noqa: F401
        return
    except ImportError:
        pass
    # tenta instalar pywin32 no MESMO interpretador
    _eprint("pywin32 nao encontrado; tentando instalar (pip install pywin32)...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "pywin32"])
    except Exception as e:
        raise RuntimeError(
            "pywin32 nao esta instalado e a instalacao automatica falhou (%s). "
            "Instale manualmente: pip install pywin32." % e)
    try:
        import win32com.client  # noqa: F401
    except ImportError as e:
        raise RuntimeError("pywin32 instalado mas import falhou: %s" % e)


# ---------------------------------------------------------------------------
# Saneamento de nome de arquivo
# ---------------------------------------------------------------------------
_INVALID = '\\/:*?"<>|'


def sanitize_filename(name):
    s = "".join((" " if ch in _INVALID else ch) for ch in str(name))
    s = s.replace("\t", " ").replace("\n", " ").replace("\r", " ")
    s = " ".join(s.split()).strip().strip(".")
    # nomes reservados do Windows
    reserved = {"CON", "PRN", "AUX", "NUL"} | {"COM%d" % i for i in range(1, 10)} \
        | {"LPT%d" % i for i in range(1, 10)}
    if s.upper() in reserved:
        s = "_" + s
    return s or "aba"


# ---------------------------------------------------------------------------
# Deteccao do quadro (area a imprimir)
# ---------------------------------------------------------------------------
def _n_bordas(cell):
    """Quantas das 4 bordas da celula estao desenhadas (0..4)."""
    n = 0
    for edge in XL_EDGES:
        try:
            if cell.Borders(edge).LineStyle != XL_LINESTYLE_NONE:
                n += 1
        except Exception:
            pass
    return n


def detectar_colunas(ws, ancora):
    """(topo, col_esq, col_dir) do quadro ancorado no titulo. None se nao achar.

    Anda pra direita a partir do fim do titulo mesclado enquanto a MOLDURA
    continuar: as colunas auxiliares coladas no quadro (rotulos verticais,
    tabelas de apoio) nao tem borda, entao param o passeio.
    """
    try:
        achou = ws.Cells.Find(What=ancora, LookIn=XL_VALUES, LookAt=XL_PART)
    except Exception:
        achou = None
    if achou is None:
        return None

    try:
        ma = achou.MergeArea
        topo = int(ma.Row)
        esq = int(ma.Column)
        dir_ = esq + int(ma.Columns.Count) - 1
    except Exception:
        topo = int(achou.Row)
        esq = dir_ = int(achou.Column)

    # linha de referencia = primeira linha (do topo pra baixo) em que a celula
    # da coluna da esquerda tem as 4 bordas: e a moldura fechada da tabela.
    ref = None
    for r in range(topo, topo + MAX_LINHAS_REF):
        if _n_bordas(ws.Cells(r, esq)) >= 4:
            ref = r
            break
    if ref is None:
        ref = topo

    col = dir_ + 1
    limite = esq + MAX_COLS_DIREITA
    while col <= limite:
        if _n_bordas(ws.Cells(ref, col)) >= 2:
            dir_ = col
            col += 1
        else:
            break
    return topo, esq, dir_


def _conta_a(xl, ws, r1, c1, r2, c2):
    try:
        return float(xl.WorksheetFunction.CountA(
            ws.Range(ws.Cells(r1, c1), ws.Cells(r2, c2))))
    except Exception:
        return 0.0


def detectar_ultima_linha(xl, ws, topo, esq, dir_, cache=None):
    """Ultima linha com conteudo DENTRO das colunas do quadro.

    Range.Find(SearchDirection=xlPrevious) mente aqui (devolve a 1a linha),
    entao a varredura e por CountA linha a linha, de baixo pra cima. Como as
    abas de OSE sao clones do MODELO, o resultado da 1a aba vira `cache` e nas
    demais so se confere, com UMA chamada, se sobrou algo abaixo dele.
    """
    try:
        ur = ws.UsedRange
        ultima = int(ur.Row) + int(ur.Rows.Count) - 1
    except Exception:
        ultima = topo
    if ultima < topo:
        return topo

    if cache is not None and topo <= cache:
        if ultima <= cache:
            return cache
        if _conta_a(xl, ws, cache + 1, esq, ultima, dir_) == 0:
            return cache

    linha = ultima
    while linha > topo:
        if _conta_a(xl, ws, linha, esq, linha, dir_) > 0:
            return linha
        linha -= 1
    return topo


def _ensure_fitz():
    """PyMuPDF, instalando sob demanda. None se nao rolar."""
    try:
        import fitz
        return fitz
    except ImportError:
        pass
    _eprint("PyMuPDF nao encontrado; tentando instalar (pip install pymupdf)...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "pymupdf"])
        import fitz
        return fitz
    except Exception as e:
        _eprint("falhou instalar/importar PyMuPDF: %s" % e)
        return None


def padronizar_papel(caminhos, papel):
    """Reencaixa cada PDF num papel fixo (hoje: A4), mantendo vetor.

    O Excel usa o papel do DRIVER da impressora padrao: com a Foxit PDF Editor
    Printer default, `PageSetup.PaperSize = xlPaperA4` e simplesmente ignorado e
    o PDF sai 966x746 pt. Trocar a impressora padrao pelo Windows tambem nao
    resolve (o Excel continua reportando a Foxit). Entao o papel e acertado
    DEPOIS, no proprio PDF: pagina A4 nova + a pagina exportada centralizada e
    escalada pra caber. Continua vetorial, so muda a moldura.
    Orientacao segue o desenho (paisagem se for mais largo que alto).
    """
    if not caminhos or (papel or "").lower() not in ("a4",):
        return None
    fitz = _ensure_fitz()
    if fitz is None:
        return ("Nao consegui instalar o PyMuPDF: os PDFs ficaram no papel do "
                "driver da impressora (nao A4).")

    A4_MAIOR, A4_MENOR = 841.89, 595.28
    falhas = 0
    for caminho in caminhos:
        try:
            origem = fitz.open(caminho)
            saida = fitz.open()
            for pg in origem:
                r = pg.rect
                if r.width <= 0 or r.height <= 0:
                    continue
                larg, alt = ((A4_MAIOR, A4_MENOR) if r.width >= r.height
                             else (A4_MENOR, A4_MAIOR))
                nova = saida.new_page(width=larg, height=alt)
                esc = min(larg / r.width, alt / r.height)
                w, h = r.width * esc, r.height * esc
                alvo = fitz.Rect((larg - w) / 2.0, (alt - h) / 2.0,
                                 (larg + w) / 2.0, (alt + h) / 2.0)
                nova.show_pdf_page(alvo, origem, pg.number)
            tmp = caminho + ".a4.tmp"
            saida.save(tmp, garbage=3, deflate=True)
            saida.close()
            origem.close()
            os.replace(tmp, caminho)
        except Exception as e:
            falhas += 1
            _eprint("papel A4 falhou em %s: %s" % (caminho, e))
    if falhas:
        return "%d PDF(s) ficaram no papel original (falha no ajuste pra A4)." % falhas
    return None


def _col_letra(n):
    """1 -> A, 27 -> AA."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _addr(topo, esq, base, dir_):
    # montado na mao: Range.Address em late binding volta string, nao aceita
    # ser chamado com argumentos.
    return "%s%d:%s%d" % (_col_letra(esq), topo, _col_letra(dir_), base)


# ---------------------------------------------------------------------------
# Exportacao via Excel COM
# ---------------------------------------------------------------------------
def exportar(cfg):
    planilha = cfg.get("planilha")
    destino = cfg.get("destino")
    prefixo = (cfg.get("prefixo") or "").strip()
    area_fixa = (cfg.get("area") or "").strip()
    auto_area = bool(cfg.get("auto_area", True))
    ancora = (cfg.get("ancora") or ANCORA_PADRAO).strip()
    papel = (cfg.get("papel") or "").strip().lower()

    if not planilha:
        raise RuntimeError("Campo 'planilha' (xlsx de entrada) e obrigatorio.")
    if not destino:
        raise RuntimeError("Campo 'destino' (pasta de saida) e obrigatorio.")
    planilha = os.path.abspath(planilha)
    destino = os.path.abspath(destino)
    if not os.path.isfile(planilha):
        raise RuntimeError("Planilha nao encontrada: %s" % planilha)

    # cria pasta destino
    os.makedirs(destino, exist_ok=True)

    _ensure_win32com()
    import win32com.client
    import pythoncom

    pythoncom.CoInitialize()
    xl = None
    wb = None
    abas_geradas = []
    avisos = []
    usados = {}
    colunas_cache = None       # (topo, esq, dir): as abas sao clones do MODELO
    linha_cache = None         # ultima linha do quadro na aba anterior
    sem_quadro = []            # abas em que nao achei quadro nenhum
    area_reportada = area_fixa
    modo_reportado = "explicita" if area_fixa else ""
    try:
        try:
            xl = win32com.client.DispatchEx("Excel.Application")
        except Exception:
            xl = win32com.client.Dispatch("Excel.Application")
        xl.Visible = False
        xl.DisplayAlerts = False
        try:
            xl.ScreenUpdating = False
        except Exception:
            pass

        # ReadOnly=True pra nunca alterar o arquivo fonte
        wb = xl.Workbooks.Open(planilha, ReadOnly=True, UpdateLinks=0)
        try:
            xl.Calculation = -4135      # xlCalculationManual: sem isso, cada
        except Exception:               # export recalcula as 937 abas.
            pass

        pref_up = prefixo.upper()
        for ws in wb.Worksheets:
            nome = str(ws.Name)
            if pref_up and not nome.upper().startswith(pref_up):
                continue
            base = sanitize_filename(nome)
            # evita colisao se dois nomes sanitizarem pro mesmo arquivo
            key = base.lower()
            if key in usados:
                usados[key] += 1
                base = "%s (%d)" % (base, usados[key])
            else:
                usados[key] = 0
            pdf_path = os.path.join(destino, base + ".pdf")

            # ---- qual area exportar --------------------------------------
            rng_addr = None
            modo = "aba_inteira"
            if area_fixa:
                rng_addr = area_fixa
                modo = "explicita"
            else:
                try:
                    pa = str(ws.PageSetup.PrintArea or "").strip()
                except Exception:
                    pa = ""
                if pa:
                    modo = "print_area"      # o Excel ja respeita sozinho
                elif auto_area:
                    # tenta em CADA aba ate achar. Cachear a FALHA da 1a aba era
                    # bug: num arquivo de OSE a 1a aba e a RESUMO, que nao tem
                    # quadro nenhum - e todas as OSEs saiam inteiras atras dela.
                    if colunas_cache is None:
                        colunas_cache = detectar_colunas(ws, ancora)
                    if colunas_cache:
                        topo, esq, dir_ = colunas_cache
                        base_row = detectar_ultima_linha(xl, ws, topo, esq, dir_,
                                                         linha_cache)
                        linha_cache = base_row
                        rng_addr = _addr(topo, esq, base_row, dir_)
                        modo = "auto"
                    else:
                        sem_quadro.append(nome)

            # ---- exporta --------------------------------------------------
            try:
                if rng_addr:
                    ws.Range(rng_addr).ExportAsFixedFormat(XL_TYPE_PDF, pdf_path)
                else:
                    # sem 3o/4o/5o argumentos: em late binding o Excel derruba a
                    # chamada ("Excecao" 0x800A03EC). O padrao de IgnorePrintAreas
                    # ja e False, entao a Print_Area continua sendo respeitada.
                    ws.ExportAsFixedFormat(XL_TYPE_PDF, pdf_path)
            except Exception as e:
                # ultimo recurso: aba inteira, pra nao perder o PDF
                avisos.append("Aba '%s': falha exportando %s (%s); exportei a aba inteira."
                              % (nome, rng_addr or "aba", e))
                ws.ExportAsFixedFormat(XL_TYPE_PDF, pdf_path)
                modo = "aba_inteira"
                rng_addr = None

            # o resumo da UI mostra a PRIMEIRA aba que teve area de verdade:
            # se a 1a aba do arquivo for a RESUMO (sem quadro), reportar o modo
            # dela daria a impressao de que tudo saiu inteiro.
            if not area_reportada and rng_addr:
                area_reportada = rng_addr
                modo_reportado = modo
            elif not modo_reportado:
                modo_reportado = modo
            abas_geradas.append({"aba": nome, "pdf": pdf_path,
                                 "area": rng_addr or "", "modo": modo})

        if sem_quadro:
            mostra = ", ".join(sem_quadro[:5])
            if len(sem_quadro) > 5:
                mostra += " (+%d)" % (len(sem_quadro) - 5)
            avisos.append(
                "Sem quadro (ancora '%s') e sem area de impressao em %d aba(s) - "
                "essas sairam inteiras: %s. Informe a area na UI se precisar "
                "recortar, ou use o prefixo pra exportar so as OSEs."
                % (ancora, len(sem_quadro), mostra))

        papel_feito = ""
        if papel and abas_geradas:
            # fora do laco: o Excel ja terminou, mexer no PDF nao custa Excel
            problema = padronizar_papel([a["pdf"] for a in abas_geradas], papel)
            if problema:
                avisos.append(problema)
            else:
                papel_feito = papel
        return (abas_geradas, destino, area_reportada, modo_reportado,
                papel_feito, avisos)
    finally:
        try:
            if wb is not None:
                wb.Close(SaveChanges=False)
        except Exception:
            pass
        try:
            if xl is not None:
                xl.Quit()
        except Exception:
            pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def main():
    try:
        cfg = build_config()
    except SystemExit:
        # argparse ja imprimiu o erro
        _emit_err("Argumentos invalidos.")
        return 1
    try:
        abas, destino, area, modo, papel, avisos = exportar(cfg)
    except Exception as e:
        _emit_err(e)
        return 1

    if not abas:
        pref = (cfg.get("prefixo") or "").strip()
        msg = ("Nenhuma aba exportada."
               + (" Nenhuma aba comeca com o prefixo '%s'." % pref if pref else ""))
        _emit_err(msg)
        return 1

    _emit_ok(len(abas), destino, [a["aba"] for a in abas], area, modo, papel, avisos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
