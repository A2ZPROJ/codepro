# -*- coding: utf-8 -*-
"""
Exporta CADA ABA de uma planilha Excel como um PDF separado.
O nome de cada PDF = nome da aba (sanitizado), ex.: OSE-001.pdf, OSE-002.pdf...

Motor de LINHA DE COMANDO que o Nexus (Electron) chama. Usa o Excel instalado
na maquina via COM (win32com / pywin32): abre a planilha invisivel e para cada
aba roda Worksheet.ExportAsFixedFormat(0, <caminho.pdf>) (0 = xlTypePDF).

Interface:
  --config <json>  arquivo JSON com os campos:
     planilha    (str)  xlsx de entrada (obrigatorio)
     destino     (str)  pasta de saida (obrigatorio; criada se nao existir)
     prefixo     (str)  opcional; se preenchido, so exporta abas cujo nome
                        comeca com esse prefixo (ex.: "OSE"). Vazio = todas.
     abrir_pasta (bool) opcional; sem efeito aqui (o Nexus abre a pasta).

  (tambem aceita as mesmas chaves via flags CLI; CLI sobrepoe o JSON.)

Saida (stdout, ULTIMA linha): JSON
  ok:    {"ok":true,"n_pdfs":N,"pasta":"<destino>","abas":[...]}
  erro:  {"ok":false,"erro":"..."}  + exit 1

Robustez:
  - cria a pasta destino se nao existir;
  - se win32com/pywin32 nao estiver instalado, tenta `pip install pywin32`;
  - garante xl.Quit() mesmo em erro (try/finally); DisplayAlerts=False, Visible=False.

Autor: Claude Code (Opus) p/ Lucas Abdala / 2S Engenharia.
"""
import os
import sys
import json
import argparse
import subprocess


def _eprint(*a):
    print(*a, file=sys.stderr)


def _emit_ok(n_pdfs, pasta, abas):
    print(json.dumps({"ok": True, "n_pdfs": n_pdfs, "pasta": pasta, "abas": abas},
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
    ap.add_argument("--abrir-pasta", dest="abrir_pasta", action="store_true")
    args = ap.parse_args()

    cfg = {"planilha": None, "destino": None, "prefixo": "", "abrir_pasta": False}

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
    if "abrir_pasta" in explicit:
        cfg["abrir_pasta"] = True

    cfg["prefixo"] = (cfg.get("prefixo") or "").strip()
    return cfg


# ---------------------------------------------------------------------------
# win32com (pywin32) — importa, instalando sob demanda se faltar
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
# Exportacao via Excel COM
# ---------------------------------------------------------------------------
def exportar(cfg):
    planilha = cfg.get("planilha")
    destino = cfg.get("destino")
    prefixo = (cfg.get("prefixo") or "").strip()

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
    usados = {}
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
            # 0 = xlTypePDF
            ws.ExportAsFixedFormat(0, pdf_path)
            abas_geradas.append({"aba": nome, "pdf": pdf_path})

        return abas_geradas, destino
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
        abas, destino = exportar(cfg)
    except Exception as e:
        _emit_err(e)
        return 1

    if not abas:
        pref = (cfg.get("prefixo") or "").strip()
        msg = ("Nenhuma aba exportada."
               + (" Nenhuma aba comeca com o prefixo '%s'." % pref if pref else ""))
        _emit_err(msg)
        return 1

    _emit_ok(len(abas), destino, [a["aba"] for a in abas])
    return 0


if __name__ == "__main__":
    sys.exit(main())
