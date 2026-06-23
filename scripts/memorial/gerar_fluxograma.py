# -*- coding: utf-8 -*-
"""
Fluxograma do Sistema de Esgotamento Sanitario - PARAMETRICO (2S Engenharia)
============================================================================
v2 - Construtor generico de fluxograma.

Recebe uma LISTA de etapas (cada uma com TIPO + DESCRICAO) e monta o
fluxograma com a simbologia certa de cada tipo, em layout SERPENTINA
(adapta de 2 a 20+ etapas), com setas conectando na sequencia, legenda
dos tipos efetivamente usados e identidade visual 2S.

Saida: PNG ~300 dpi, A4 paisagem.

USO
---
  # modo default (gera um exemplo embutido):
  python gerar_fluxograma.py

  # parametrico via JSON:
  python gerar_fluxograma.py --config exemplo_5etapas.json --out Fluxograma.png

SCHEMA DO JSON DE ENTRADA
-------------------------
{
  "municipio": "Amapora",
  "subbacia": "02",
  "titulo":   "(opcional) sobrescreve o titulo principal",
  "out":      "(opcional) caminho do PNG de saida",
  "etapas": [
     {"tipo": "Rede Projetada", "descricao": "RCE Bacia 02"},
     {"tipo": "EEE",            "descricao": "EEE Amapora"},
     ...
  ]
}

TIPOS SUPORTADOS (chave canonica + sinonimos aceitos): ver dicionario TIPOS.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import (FancyBboxPatch, FancyArrowPatch, Circle, Polygon,
                                Rectangle)
from matplotlib.offsetbox import OffsetImage, AnnotationBbox
import numpy as np
import argparse
import json
import sys
import os
import unicodedata

try:
    from PIL import Image
except Exception:
    Image = None

# ----------------------------------------------------------------------------
# LOGOS (caminhos com fallback) — logos reais 2S (esq) e Acciona (dir)
# ----------------------------------------------------------------------------
_FLUX_DIR = os.path.dirname(os.path.abspath(__file__))
_FLUX_ASSETS = os.path.join(_FLUX_DIR, "assets")
LOGO_2S_PATHS = [
    os.path.join(_FLUX_ASSETS, "logo-2s.png"),
    r"C:\Users\lcabd\OneDrive - A2Z Projetos\INSTALADORES - PROGRAMAÇÃO\PROJETOS\codepro\assets\logo-2s.png",
    r"C:\Users\lcabd\jarvis\memorial\imagens_modelo\timbrado_header_2s.png",
]
LOGO_ACCIONA_PATHS = [
    os.path.join(_FLUX_ASSETS, "logo-acciona.png"),
    r"C:\Users\lcabd\jarvis\memorial\imagens_modelo\logo_acciona.png",
    r"C:\Users\lcabd\OneDrive - A2Z Projetos\INSTALADORES - PROGRAMAÇÃO\PROJETOS\codepro\assets\logo-acciona.png",
]

def _primeiro_existente(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    return None

def _carregar_logo(paths):
    """Carrega a primeira logo existente como array RGBA (mantem aspecto)."""
    p = _primeiro_existente(paths)
    if p is None or Image is None:
        return None, None
    im = Image.open(p).convert("RGBA")
    return np.asarray(im), p

# ----------------------------------------------------------------------------
# IDENTIDADE VISUAL 2S
# ----------------------------------------------------------------------------
VERMELHO_2S = "#A11312"   # vermelho institucional 2S
GRAFITE     = "#2E2E2E"   # grafite
CINZA       = "#7A7A7A"   # cinza (existente)
CINZA_CLARO = "#BFBFBF"
PROJ        = "#1E8449"   # verde (projetado)
PROJ_CLARO  = "#58D68D"
EXIST       = "#8A5A2B"   # marrom (em operacao / existente)
EXIST_CLARO = "#C8A06A"
AGUA        = "#2471A3"   # azul (corpo receptor)
AGUA_CLARO  = "#7FB3D5"
RECALQUE    = "#A11312"   # vermelho para linha de recalque
LARANJA     = "#CA6F1E"   # coletor (linha tronco)
LARANJA_CLARO = "#EDBB99"
ROXO        = "#6C3483"   # emissario (transporte)
ROXO_CLARO  = "#D2B4DE"
BRANCO      = "#FFFFFF"
FUNDO       = "#FFFFFF"

plt.rcParams["font.family"] = "DejaVu Sans"

# ============================================================================
# ICONES DE SIMBOLOGIA
# Cada funcao desenha o icone do tipo, centrado em (cx, cy), num eixo `ax`.
# A escala dos icones e relativa a uma "celula" de ~18 unid de largura.
# ============================================================================
def _icone_rede(ax, cx, cy, cor, z=8):
    """Malha de rede coletora: PVs (circulos) ligados por linhas (gravitario)."""
    r = 0.85
    pts = [(-3.0, 1.2), (0.0, 1.2), (3.0, 1.2),
           (-3.0, -1.2), (0.0, -1.2), (3.0, -1.2)]
    for yy in (1.2, -1.2):
        ax.plot([cx-3.0, cx+3.0], [cy+yy, cy+yy], color=cor, lw=1.9, zorder=z,
                solid_capstyle="round")
    for xx in (-3.0, 0.0, 3.0):
        ax.plot([cx+xx, cx+xx], [cy+1.2, cy-1.2], color=cor, lw=1.9, zorder=z,
                solid_capstyle="round")
    for (dx, dy) in pts:
        ax.add_patch(Circle((cx+dx, cy+dy), r, facecolor=BRANCO,
                            edgecolor=cor, lw=1.6, zorder=z+1))

def icone_rede_projetada(ax, cx, cy, z=8):
    _icone_rede(ax, cx, cy, PROJ, z)

def icone_rede_existente(ax, cx, cy, z=8):
    _icone_rede(ax, cx, cy, EXIST, z)

def icone_coletor(ax, cx, cy, z=8):
    """Coletor tronco: linha GROSSA com PVs nas pontas (recebe ramais)."""
    ax.plot([cx-4.2, cx+4.2], [cy, cy], color=LARANJA, lw=6.0, zorder=z,
            solid_capstyle="round")
    ax.plot([cx-4.2, cx+4.2], [cy, cy], color=LARANJA_CLARO, lw=2.0, zorder=z+1,
            solid_capstyle="round")
    # ramais chegando (contribuicoes)
    for sx in (-2.5, 0.0, 2.5):
        ax.plot([cx+sx, cx+sx], [cy+2.4, cy], color=LARANJA, lw=1.6, zorder=z,
                solid_capstyle="round")
        ax.add_patch(Circle((cx+sx, cy+2.4), 0.55, facecolor=BRANCO,
                            edgecolor=LARANJA, lw=1.3, zorder=z+2))
    for sx in (-4.2, 4.2):
        ax.add_patch(Circle((cx+sx, cy), 0.85, facecolor=BRANCO,
                            edgecolor=LARANJA, lw=1.6, zorder=z+2))

def icone_emissario(ax, cx, cy, z=8):
    """Emissario: linha de transporte longa (tubo continuo, sem contribuicoes)."""
    ax.plot([cx-4.5, cx+4.5], [cy, cy], color=ROXO, lw=4.2, zorder=z,
            solid_capstyle="round")
    # marcas de tubo (juntas)
    for sx in (-3.0, -1.0, 1.0, 3.0):
        ax.plot([cx+sx, cx+sx], [cy+0.9, cy-0.9], color=BRANCO, lw=1.4,
                zorder=z+1)
    # nos de extremidade
    for sx in (-4.5, 4.5):
        ax.add_patch(Circle((cx+sx, cy), 0.7, facecolor=ROXO_CLARO,
                            edgecolor=ROXO, lw=1.5, zorder=z+2))

def icone_recalque(ax, cx, cy, z=8):
    """Linha de recalque: tubo pressurizado com triangulos de pressao."""
    ax.plot([cx-4.0, cx+4.0], [cy, cy], color=RECALQUE, lw=4.5, zorder=z,
            solid_capstyle="round")
    ax.plot([cx-4.0, cx+4.0], [cy, cy], color="#E8A0A0", lw=1.6, zorder=z+1,
            ls=(0, (3, 2)))
    for xx in (-2.6, 0.0, 2.6):
        tri = Polygon([(cx+xx-0.85, cy+1.0), (cx+xx-0.85, cy-1.0),
                       (cx+xx+0.95, cy)], closed=True, facecolor=VERMELHO_2S,
                      edgecolor=GRAFITE, lw=0.7, zorder=z+2)
        ax.add_patch(tri)

def icone_eee(ax, cx, cy, z=8):
    """Estacao Elevatoria: poco circular + simbolo de bomba (impeller)."""
    ax.add_patch(Rectangle((cx-3.0, cy-2.6), 6.0, 5.2, facecolor="#EAF2F8",
                           edgecolor=AGUA, lw=1.8, zorder=z))
    ax.add_patch(Rectangle((cx-3.0, cy-2.6), 6.0, 2.4, facecolor=AGUA_CLARO,
                           edgecolor="none", zorder=z+1))
    ax.plot([cx-3.0, cx+3.0], [cy-0.2, cy-0.2], color=AGUA, lw=1.0,
            zorder=z+2, ls=(0, (4, 2)))
    bx, by = cx, cy+0.6
    ax.add_patch(Circle((bx, by), 1.5, facecolor=VERMELHO_2S,
                        edgecolor=GRAFITE, lw=1.5, zorder=z+3))
    for ang in range(0, 360, 60):
        a = np.radians(ang)
        ax.plot([bx, bx+1.15*np.cos(a)], [by, by+1.15*np.sin(a)],
                color=BRANCO, lw=1.5, zorder=z+4, solid_capstyle="round")
    ax.add_patch(Circle((bx, by), 0.3, facecolor=BRANCO, edgecolor="none",
                        zorder=z+5))
    ax.plot([bx+1.5, bx+1.5], [by, by+2.3], color=VERMELHO_2S, lw=2.2,
            zorder=z+2, solid_capstyle="round")
    ax.plot([bx+1.5, bx+2.9], [by+2.3, by+2.3], color=VERMELHO_2S, lw=2.2,
            zorder=z+2, solid_capstyle="round")

def icone_ete(ax, cx, cy, z=8):
    """Estacao de Tratamento: conjunto de tanques (reatores + decantador)."""
    base_y = cy - 2.0
    ax.add_patch(Rectangle((cx-6.0, base_y-0.5), 12.0, 0.55, facecolor=GRAFITE,
                           edgecolor="none", zorder=z))
    ax.add_patch(Rectangle((cx-5.4, base_y), 3.2, 3.6, facecolor=PROJ_CLARO,
                           edgecolor=PROJ, lw=1.7, zorder=z+1))
    ax.text(cx-3.8, base_y+1.8, "≈", ha="center", va="center", fontsize=10,
            color=PROJ, zorder=z+2, fontweight="bold")
    ax.add_patch(Rectangle((cx-1.8, base_y), 3.2, 3.6, facecolor=PROJ_CLARO,
                           edgecolor=PROJ, lw=1.7, zorder=z+1))
    ax.text(cx-0.2, base_y+1.8, "≈", ha="center", va="center", fontsize=10,
            color=PROJ, zorder=z+2, fontweight="bold")
    dec = Polygon([(cx+1.9, base_y+3.6), (cx+5.6, base_y+3.6),
                   (cx+4.4, base_y), (cx+3.1, base_y)], closed=True,
                  facecolor=AGUA_CLARO, edgecolor=AGUA, lw=1.7, zorder=z+1)
    ax.add_patch(dec)
    ax.plot([cx+1.9, cx+5.6], [base_y+2.5, base_y+2.5], color=AGUA, lw=1.0,
            ls=(0, (4, 2)), zorder=z+2)

def icone_rio(ax, cx, cy, z=8):
    """Corpo receptor: linhas de agua onduladas."""
    w = 9.0
    xs = np.linspace(cx-w/2, cx+w/2, 200)
    for k, yy in enumerate((1.3, 0.0, -1.3)):
        amp = 0.5 if k != 1 else 0.65
        ys = cy + yy + amp*np.sin((xs-cx)*1.3 + k)
        ax.plot(xs, ys, color=AGUA, lw=2.3 if k == 1 else 1.7, zorder=z+1,
                solid_capstyle="round", alpha=0.9 if k == 1 else 0.7)

# ----- mini-icones para a LEGENDA (compactos, centrados em (x,y)) -----------
def mini_rede(ax, x, y, cor, z=7):
    for i, dx in enumerate((-1.6, 0.0, 1.6)):
        ax.add_patch(Circle((x+dx, y), 0.38, facecolor=BRANCO, edgecolor=cor,
                            lw=1.2, zorder=z+1))
    ax.plot([x-1.6, x+1.6], [y, y], color=cor, lw=1.6, zorder=z)

def mini_coletor(ax, x, y, z=7):
    ax.plot([x-2.0, x+2.0], [y, y], color=LARANJA, lw=4.5, zorder=z,
            solid_capstyle="round")

def mini_emissario(ax, x, y, z=7):
    ax.plot([x-2.0, x+2.0], [y, y], color=ROXO, lw=3.2, zorder=z,
            solid_capstyle="round")
    for sx in (-1.0, 0.0, 1.0):
        ax.plot([x+sx, x+sx], [y+0.55, y-0.55], color=BRANCO, lw=1.0, zorder=z+1)

def mini_recalque(ax, x, y, z=7):
    ax.plot([x-2.0, x+2.0], [y, y], color=RECALQUE, lw=3.4, zorder=z,
            solid_capstyle="round")
    tri = Polygon([(x-0.5, y+0.6), (x-0.5, y-0.6), (x+0.6, y)], closed=True,
                  facecolor=VERMELHO_2S, edgecolor=GRAFITE, lw=0.5, zorder=z+1)
    ax.add_patch(tri)

def mini_eee(ax, x, y, z=7):
    # altura reduzida (raio 0.75) p/ permitir linhas da legenda mais JUNTAS
    ax.add_patch(Circle((x, y), 0.75, facecolor=VERMELHO_2S, edgecolor=GRAFITE,
                        lw=1.2, zorder=z+1))
    for ang in range(0, 360, 90):
        a = np.radians(ang)
        ax.plot([x, x+0.58*np.cos(a)], [y, y+0.58*np.sin(a)], color=BRANCO,
                lw=1.2, zorder=z+2, solid_capstyle="round")

def mini_ete(ax, x, y, z=7):
    # altura reduzida (1.4) p/ permitir linhas da legenda mais JUNTAS
    ax.add_patch(Rectangle((x-1.7, y-0.7), 1.4, 1.4, facecolor=PROJ_CLARO,
                           edgecolor=PROJ, lw=1.2, zorder=z))
    ax.add_patch(Polygon([(x+0.25, y+0.7), (x+1.75, y+0.7),
                          (x+1.3, y-0.7), (x+0.7, y-0.7)], closed=True,
                         facecolor=AGUA_CLARO, edgecolor=AGUA, lw=1.2, zorder=z))

def mini_rio(ax, x, y, z=7):
    xs = np.linspace(x-2.0, x+2.0, 50)
    ax.plot(xs, y+0.32*np.sin((xs-x)*3.0), color=AGUA, lw=2.0, zorder=z)

# ============================================================================
# DICIONARIO DE TIPOS  (extensivel)
#   chave canonica -> dict com:
#     'icone'    : funcao(ax, cx, cy)        desenho grande na celula
#     'mini'     : funcao(ax, x, y)          desenho compacto da legenda
#     'cor'      : cor da borda da caixa / fluxo predominante
#     'fundo'    : cor de fundo da caixa
#     'rotulo'   : rotulo curto (titulo da caixa)
#     'sub'      : subtitulo descritivo do tipo
#     'flux_cor' : cor da seta de SAIDA desta etapa
#     'flux_ls'  : estilo de linha da seta de saida
# ============================================================================
TIPOS = {
    "rede_projetada": {
        "icone": icone_rede_projetada,
        "mini":  lambda ax, x, y: mini_rede(ax, x, y, PROJ),
        "cor": PROJ, "fundo": "#EAFBF0",
        "rotulo": "REDE COLETORA\nPROJETADA", "sub": "Sistema gravitário",
        "flux_cor": GRAFITE, "flux_ls": "-",
    },
    "rede_existente": {
        "icone": icone_rede_existente,
        "mini":  lambda ax, x, y: mini_rede(ax, x, y, EXIST),
        "cor": EXIST, "fundo": "#F6EFE6",
        "rotulo": "REDE COLETORA\nEXISTENTE", "sub": "Em operação",
        "flux_cor": EXIST, "flux_ls": "-",
    },
    "coletor": {
        "icone": icone_coletor,
        "mini":  mini_coletor,
        "cor": LARANJA, "fundo": "#FBF0E6",
        "rotulo": "COLETOR\nTRONCO", "sub": "Linha tronco",
        "flux_cor": LARANJA, "flux_ls": "-",
    },
    "emissario": {
        "icone": icone_emissario,
        "mini":  mini_emissario,
        "cor": ROXO, "fundo": "#F4ECF7",
        "rotulo": "EMISSÁRIO", "sub": "Linha de transporte",
        "flux_cor": ROXO, "flux_ls": "-",
    },
    "linha_recalque": {
        "icone": icone_recalque,
        "mini":  mini_recalque,
        "cor": RECALQUE, "fundo": "#FBEAEA",
        "rotulo": "LINHA DE\nRECALQUE", "sub": "Sob pressão",
        "flux_cor": VERMELHO_2S, "flux_ls": "-",
    },
    "eee": {
        "icone": icone_eee,
        "mini":  mini_eee,
        "cor": VERMELHO_2S, "fundo": "#FBEAEA",
        "rotulo": "EEE", "sub": "Estação Elevatória de Esgoto",
        "flux_cor": VERMELHO_2S, "flux_ls": "-",
    },
    "ete": {
        "icone": icone_ete,
        "mini":  mini_ete,
        "cor": PROJ, "fundo": "#EAFBF0",
        "rotulo": "ETE", "sub": "Estação de Tratamento de Esgoto",
        "flux_cor": PROJ, "flux_ls": "-",
    },
    "corpo_receptor": {
        "icone": icone_rio,
        "mini":  mini_rio,
        "cor": AGUA, "fundo": "#E8F2FA",
        "rotulo": "CORPO\nRECEPTOR", "sub": "Lançamento do efluente",
        "flux_cor": AGUA, "flux_ls": "-",
    },
}

# legenda longa dos tipos (texto na legenda)
LEGENDA_LABEL = {
    "rede_projetada": "Rede coletora PROJETADA (gravitário)",
    "rede_existente": "Rede coletora EXISTENTE (em operação)",
    "coletor":        "Coletor tronco",
    "emissario":      "Emissário (transporte)",
    "linha_recalque": "Linha de recalque (sob pressão)",
    "eee":            "Estação Elevatória de Esgoto (EEE)",
    "ete":            "Estação de Tratamento de Esgoto (ETE)",
    "corpo_receptor": "Corpo receptor / curso d'água",
}

# ----------------------------------------------------------------------------
# NORMALIZACAO DE TIPO (aceita sinonimos / acentos / caixa)
# ----------------------------------------------------------------------------
def _norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return s.strip().lower()

SINONIMOS = {
    "rede projetada": "rede_projetada", "rede coletora projetada": "rede_projetada",
    "rede": "rede_projetada", "projetada": "rede_projetada",
    "rce": "rede_projetada", "rcp": "rede_projetada",
    "rede existente": "rede_existente", "rede coletora existente": "rede_existente",
    "existente": "rede_existente", "em operacao": "rede_existente",
    "coletor": "coletor", "coletor tronco": "coletor", "tronco": "coletor",
    "interceptor": "coletor",
    "emissario": "emissario", "emissario por gravidade": "emissario",
    "linha de recalque": "linha_recalque", "recalque": "linha_recalque",
    "lr": "linha_recalque", "linha recalque": "linha_recalque",
    "eee": "eee", "elevatoria": "eee", "estacao elevatoria": "eee",
    "estacao elevatoria de esgoto": "eee", "ele": "eee", "bomba": "eee",
    "ete": "ete", "tratamento": "ete", "estacao de tratamento": "ete",
    "estacao de tratamento de esgoto": "ete",
    "corpo receptor": "corpo_receptor", "corpo": "corpo_receptor",
    "rio": "corpo_receptor", "lancamento": "corpo_receptor",
    "curso dagua": "corpo_receptor", "curso d agua": "corpo_receptor",
}

def resolver_tipo(tipo_raw):
    n = _norm(tipo_raw)
    if n in TIPOS:
        return n
    if n in SINONIMOS:
        return SINONIMOS[n]
    # ultimo recurso: tenta casar pelo prefixo
    for k in TIPOS:
        if n.replace(" ", "_") == k:
            return k
    raise ValueError(
        f"Tipo nao reconhecido: '{tipo_raw}'. Tipos validos: "
        + ", ".join(sorted(TIPOS.keys()))
    )

# ============================================================================
# LAYOUT EM SERPENTINA
# ============================================================================
def calc_colunas(n):
    """Numero de colunas por linha conforme o total de etapas.
    Mantem as caixas legiveis e cabe em A4 paisagem."""
    if n <= 4:
        return n
    if n <= 6:
        return 3
    if n <= 8:
        return 4
    if n <= 12:
        return 4
    if n <= 18:
        return 5
    return 6

def _colocar_logo(ax, arr, x_center, y_center, max_w, max_h, fig, W, H):
    """Insere a logo (RGBA array) centrada em (x_center,y_center) em coords de
    dados, dimensionada para caber em (max_w x max_h) mantendo a proporcao.
    Retorna (largura_usada, altura_usada) em unidades de dados."""
    if arr is None:
        return 0.0, 0.0
    ih, iw = arr.shape[0], arr.shape[1]
    aspect = iw / ih
    # ajusta para caber na caixa (max_w x max_h) mantendo aspecto
    draw_w = max_w
    draw_h = draw_w / aspect
    if draw_h > max_h:
        draw_h = max_h
        draw_w = draw_h * aspect
    # converte largura desejada (em unid de dados) para zoom de pixels:
    # largura em pontos do eixo = draw_w/W * largura_fig_polegadas * dpi
    fig_w_in = fig.get_size_inches()[0]
    dpi = fig.dpi
    target_px_w = (draw_w / W) * fig_w_in * dpi
    zoom = target_px_w / iw
    # OffsetImage aplica correcao dpi/72 por padrao (dpi_cor=True). Como ja
    # calculamos o tamanho em pixels reais no dpi da figura, desligamos.
    oi = OffsetImage(arr, zoom=zoom, interpolation="hanning", dpi_cor=False)
    ab = AnnotationBbox(oi, (x_center, y_center), frameon=False,
                        box_alignment=(0.5, 0.5), zorder=5,
                        xycoords="data", pad=0.0)
    ax.add_artist(ab)
    return draw_w, draw_h

def gerar(config, out_path):
    municipio = config.get("municipio", "{{MUNICIPIO}}")
    subbacia  = config.get("subbacia",  "{{SUBBACIA}}")
    etapas_in = config.get("etapas", [])
    if not etapas_in:
        raise ValueError("Config sem 'etapas'.")

    # resolve tipos
    etapas = []
    for e in etapas_in:
        tk = resolver_tipo(e.get("tipo", ""))
        etapas.append({
            "tipo": tk,
            "descricao": e.get("descricao", "").strip(),
            "spec": TIPOS[tk],
        })

    n = len(etapas)
    ncols = calc_colunas(n)
    nrows = int(np.ceil(n / ncols))

    # ---- canvas ----
    W, H = 100.0, 70.0
    fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")
    fig.patch.set_facecolor(FUNDO)

    # moldura
    ax.add_patch(Rectangle((1.2, 1.2), 97.6, 67.6, fill=False,
                           edgecolor=GRAFITE, lw=1.6, zorder=1))
    ax.add_patch(Rectangle((1.8, 1.8), 96.4, 66.4, fill=False,
                           edgecolor=GRAFITE, lw=0.7, zorder=1))

    # ---- CABECALHO: logos reais (2S esq / Acciona dir) + titulo centralizado --
    # faixa de cabecalho BRANCA (logos tem cores que conflitam com fundo vermelho)
    head_y0, head_h = 61.6, 6.6
    head_top = head_y0 + head_h
    ax.add_patch(Rectangle((1.8, head_y0), 96.4, head_h, facecolor=BRANCO,
                           edgecolor="none", zorder=2))
    # filete de identidade vermelho 2S logo abaixo do cabecalho
    ax.add_patch(Rectangle((1.8, head_y0 - 0.45), 96.4, 0.45,
                           facecolor=VERMELHO_2S, edgecolor="none", zorder=3))

    cy_head = head_y0 + head_h / 2.0
    margem = 2.6                       # respiro lateral interno
    cell_logo_w = 17.0                 # largura reservada para cada logo
    cell_logo_h = head_h - 1.6         # altura util (respiro topo/base)

    # logo 2S (canto superior esquerdo)
    arr_2s, path_2s = _carregar_logo(LOGO_2S_PATHS)
    cx_2s = 1.8 + margem + cell_logo_w / 2.0
    w2s, h2s = _colocar_logo(ax, arr_2s, cx_2s, cy_head,
                             cell_logo_w, cell_logo_h, fig, W, H)

    # logo Acciona (canto superior direito)
    arr_ac, path_ac = _carregar_logo(LOGO_ACCIONA_PATHS)
    # Acciona costuma ser larga -> da um pouco mais de largura util
    cell_ac_w = 22.0
    cx_ac = 1.8 + 96.4 - margem - cell_ac_w / 2.0
    wac, hac = _colocar_logo(ax, arr_ac, cx_ac, cy_head,
                             cell_ac_w, cell_logo_h, fig, W, H)

    # titulo + subtitulo CENTRALIZADOS entre as duas logos
    titulo = config.get("titulo",
                        "FLUXOGRAMA DO SISTEMA DE ESGOTAMENTO SANITÁRIO")
    # centro do titulo = meio do espaco LIVRE entre as duas logos
    livre_esq = cx_2s + cell_logo_w / 2.0 + 1.0
    livre_dir = cx_ac - cell_ac_w / 2.0 - 1.0
    cx_titulo = (livre_esq + livre_dir) / 2.0
    ax.text(cx_titulo, cy_head + 1.25, titulo, ha="center", va="center",
            color=GRAFITE, fontsize=12.5, fontweight="bold", zorder=4)
    ax.text(cx_titulo, cy_head - 1.45,
            f"Memorial Descritivo  •  Sub-bacia {subbacia}  •  {municipio}",
            ha="center", va="center", color=VERMELHO_2S, fontsize=8.5, zorder=4,
            fontstyle="italic")

    # ---- area util para o grid de etapas ----
    # legenda ocupa a base. Reserva espaco conforme o layout COMPACTO da legenda.
    tipos_usados = []
    for e in etapas:
        if e["tipo"] not in tipos_usados:
            tipos_usados.append(e["tipo"])
    leg_y0 = 3.0
    leg_h = _legenda_altura(tipos_usados)

    grid_top = 60.5
    grid_bot = leg_y0 + leg_h + 2.5
    grid_left = 6.0
    grid_right = 94.0

    cell_w = (grid_right - grid_left) / ncols
    cell_h = (grid_top - grid_bot) / nrows

    # dimensoes da caixa e do icone proporcionais a celula
    box_w = min(cell_w * 0.82, 21.0)
    box_h = min(cell_h * 0.40, 7.2)
    # fator de escala dos icones (icones desenhados ~ +/-5 unid de largura)
    icon_scale = min(box_w / 20.0, cell_h / 16.0)
    icon_scale = max(0.55, min(icon_scale, 1.15))

    # fontes adaptaveis
    fs_tit = np.interp(box_w, [9, 21], [6.0, 9.0])
    fs_sub = fs_tit * 0.74
    fs_desc = np.interp(box_w, [9, 21], [5.6, 8.0])

    # ---- posiciona cada etapa em serpentina ----
    centros = []  # (cx, cy) do centro da CAIXA
    icon_cy = []  # cy do icone
    for i, e in enumerate(etapas):
        row = i // ncols
        col_in_row = i % ncols
        # serpentina: linhas pares L->R, impares R->L
        if row % 2 == 0:
            col = col_in_row
        else:
            col = ncols - 1 - col_in_row
        cx = grid_left + cell_w * (col + 0.5)
        cy_cell = grid_top - cell_h * (row + 0.5)
        cy_icon = cy_cell + cell_h * 0.18
        cy_box  = cy_cell - cell_h * 0.20
        centros.append((cx, cy_box, row, col))
        icon_cy.append(cy_icon)

    # ---- desenha icones + caixas ----
    def _draw_icone(spec, cx, cy):
        # escala via transformacao simples: desenha num eixo de dados ja
        # dimensionado; usamos um wrapper que aplica escala manual aos icones
        spec["icone"](ScaledAx(ax, cx, cy, icon_scale), 0, 0)

    for i, e in enumerate(etapas):
        cx, cy_box, row, col = centros[i]
        spec = e["spec"]
        _draw_icone(spec, cx, icon_cy[i])
        # caixa
        box = FancyBboxPatch((cx - box_w/2, cy_box - box_h/2), box_w, box_h,
                             boxstyle="round,pad=0.12,rounding_size=0.7",
                             linewidth=1.9, edgecolor=spec["cor"],
                             facecolor=spec["fundo"], zorder=5)
        ax.add_patch(box)
        # numero da etapa (badge)
        ax.add_patch(Circle((cx - box_w/2 + 1.4, cy_box + box_h/2 - 1.3), 1.1,
                            facecolor=spec["cor"], edgecolor=BRANCO, lw=1.2,
                            zorder=7))
        ax.text(cx - box_w/2 + 1.4, cy_box + box_h/2 - 1.3, str(i+1),
                ha="center", va="center", color=BRANCO, fontsize=fs_tit*0.78,
                fontweight="bold", zorder=8)
        # rotulo do tipo
        ax.text(cx, cy_box + box_h*0.18, spec["rotulo"], ha="center",
                va="center", fontsize=fs_tit, fontweight="bold",
                color=GRAFITE, zorder=6, linespacing=0.95)
        # descricao (do usuario) — quebra em ate 2 linhas
        desc = e["descricao"] or spec["sub"]
        desc = _wrap(desc, int(np.interp(box_w, [9, 21], [14, 26])))
        ax.text(cx, cy_box - box_h*0.27, desc, ha="center", va="center",
                fontsize=fs_desc, color=spec["cor"], zorder=6,
                fontstyle="italic", linespacing=0.95)

    # ---- setas conectando na sequencia (serpentina) ----
    for i in range(n - 1):
        x0, y0b, r0, c0 = centros[i]
        x1, y1b, r1, c1 = centros[i+1]
        spec0 = etapas[i]["spec"]
        col = spec0["flux_cor"]; ls = spec0["flux_ls"]
        if r0 == r1:
            # mesma linha: horizontal entre as caixas
            if x1 > x0:
                _seta(ax, x0 + box_w/2 + 0.5, y0b, x1 - box_w/2 - 0.5, y1b,
                      color=col, ls=ls)
            else:
                _seta(ax, x0 - box_w/2 - 0.5, y0b, x1 + box_w/2 + 0.5, y1b,
                      color=col, ls=ls)
        else:
            # quebra de linha: desce na mesma coluna (cotovelo)
            ytop = y0b - box_h/2 - 0.5
            ybot = y1b + box_h/2 + 0.5
            ax.plot([x0, x0], [ytop, (ytop+ybot)/2], color=col, lw=2.6, ls=ls,
                    zorder=6, solid_capstyle="round")
            _seta(ax, x0, (ytop+ybot)/2, x1, ybot, color=col, ls=ls)

    # ---- legenda ----
    _legenda(ax, tipos_usados, leg_y0, leg_h)

    # rodape
    ax.text(95.5, 2.3,
            "2S ENGENHARIA  •  Fluxograma paramétrico  •  s/ escala",
            ha="right", va="center", fontsize=5.4, color=CINZA, zorder=6,
            fontstyle="italic")

    fig.savefig(out_path, dpi=300, facecolor=FUNDO, pad_inches=0)
    plt.close(fig)
    return out_path

# ----------------------------------------------------------------------------
# wrapper de escala: traduz chamadas dos icones (que desenham em torno de 0,0)
# para o eixo real, aplicando deslocamento (cx,cy) e escala uniforme.
# ----------------------------------------------------------------------------
class ScaledAx:
    def __init__(self, ax, cx, cy, s):
        self.ax = ax; self.cx = cx; self.cy = cy; self.s = s
    def _tx(self, x): return self.cx + np.asarray(x) * self.s
    def _ty(self, y): return self.cy + np.asarray(y) * self.s
    def plot(self, xs, ys, **kw):
        if "lw" in kw: kw["lw"] = kw["lw"] * (0.6 + 0.4*self.s)
        self.ax.plot(self._tx(xs), self._ty(ys), **kw)
    def text(self, x, y, s, **kw):
        if "fontsize" in kw: kw["fontsize"] = kw["fontsize"] * self.s
        self.ax.text(self.cx + x*self.s, self.cy + y*self.s, s, **kw)
    def add_patch(self, p):
        _scale_patch(p, self.cx, self.cy, self.s)
        self.ax.add_patch(p)

def _scale_patch(p, cx, cy, s):
    """Aplica escala+offset a um patch matplotlib criado em torno de (0,0)."""
    if isinstance(p, Circle):
        x, y = p.center
        p.center = (cx + x*s, cy + y*s)
        p.radius = p.radius * s
    elif isinstance(p, Rectangle):
        x, y = p.get_xy()
        p.set_xy((cx + x*s, cy + y*s))
        p.set_width(p.get_width() * s)
        p.set_height(p.get_height() * s)
    elif isinstance(p, Polygon):
        xy = p.get_xy()
        xy = np.array(xy, dtype=float)
        xy[:, 0] = cx + xy[:, 0]*s
        xy[:, 1] = cy + xy[:, 1]*s
        p.set_xy(xy)
    # linewidth atenua levemente com a escala
    try:
        p.set_linewidth(p.get_linewidth() * (0.6 + 0.4*s))
    except Exception:
        pass

def _seta(ax, x0, y0, x1, y1, color=GRAFITE, lw=2.6, ls="-", mut=18, z=6):
    a = FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>",
                        mutation_scale=mut, lw=lw, color=color, linestyle=ls,
                        zorder=z, shrinkA=1, shrinkB=1, capstyle="round")
    ax.add_patch(a)

def _wrap(text, width):
    """Quebra texto em linhas de ~width chars (max 2 linhas, com reticencias)."""
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= width:
            cur = (cur + " " + w).strip()
        else:
            lines.append(cur); cur = w
        if len(lines) == 1 and len(cur) > width:
            # corta palavra gigante
            pass
    if cur:
        lines.append(cur)
    if len(lines) > 2:
        lines = lines[:2]
        lines[1] = lines[1][:width-1] + "…"
    return "\n".join(lines)

# ----------------------------------------------------------------------------
# LEGENDA — parametros de layout (compacto)
# ----------------------------------------------------------------------------
LEG_TITLE_H  = 2.2    # faixa do titulo "LEGENDA / SIMBOLOGIA"
LEG_ROW_GAP  = 2.55   # passo VERTICAL entre CENTROS dos itens (folga p/ nao encostar)
LEG_PAD_TOP  = 1.85   # respiro entre a faixa do titulo e o CENTRO da 1a linha
LEG_PAD_BOT  = 1.55   # respiro abaixo do CENTRO da ultima linha
LEG_FS       = 8.2    # tamanho da fonte dos rotulos da legenda (maior)
LEG_ICON_S   = 1.3    # fator de ESCALA dos mini-icones da legenda (maiores)
LEG_ICON_GAP = 5.2    # respiro HORIZONTAL: deslocamento do icone dentro da coluna

def _legenda_layout(tipos_usados):
    """Define quantas colunas/linhas a legenda usa. SEMPRE cabem todos os itens
    (fluxo + cada tipo usado). Limita a 3 linhas e distribui em colunas; se
    precisar de mais colunas pra caber, aumenta o numero de colunas.
    Retorna (n_itens, ncol, per_col)."""
    n = len(tipos_usados) + 1          # +1 = item "Sentido do escoamento"
    per_col = min(3, n)                # no maximo 3 linhas (compacto)
    ncol = int(np.ceil(n / per_col))   # colunas necessarias p/ caber TUDO
    return n, ncol, per_col

def _legenda_altura(tipos_usados):
    """Altura da caixa da legenda = titulo + linhas (com gap compacto) + respiros."""
    n, ncol, per_col = _legenda_layout(tipos_usados)
    return LEG_TITLE_H + LEG_PAD_TOP + (per_col - 1) * LEG_ROW_GAP + LEG_PAD_BOT

def _legenda(ax, tipos_usados, ly, lh):
    lx, lw_ = 4.0, 92.0
    ax.add_patch(FancyBboxPatch((lx, ly), lw_, lh,
                 boxstyle="round,pad=0.2,rounding_size=0.6",
                 linewidth=1.4, edgecolor=GRAFITE, facecolor="#FAFAFA", zorder=4))
    ax.add_patch(Rectangle((lx, ly+lh-LEG_TITLE_H), lw_, LEG_TITLE_H,
                           facecolor=GRAFITE, edgecolor="none", zorder=5))
    ax.text(lx+1.5, ly+lh-LEG_TITLE_H/2.0, "LEGENDA / SIMBOLOGIA", ha="left",
            va="center", color=BRANCO, fontsize=8.0, fontweight="bold", zorder=6)

    n, ncol, per_col = _legenda_layout(tipos_usados)
    col_w = lw_ / ncol
    # CENTRO da 1a linha de itens (posicionamento por GAP FIXO a partir do topo;
    # a altura da caixa ja foi calculada p/ esse mesmo passo, entao itens e caixa
    # andam juntos e o espacamento e realmente o LEG_ROW_GAP).
    inner_top = ly + lh - LEG_TITLE_H - LEG_PAD_TOP
    s = LEG_ICON_S                       # escala dos mini-icones (maiores)

    all_items = [("__fluxo__", "Sentido do escoamento")] + \
                [(t, LEGENDA_LABEL[t]) for t in tipos_usados]
    for idx, (t, label) in enumerate(all_items):
        c = idx // per_col      # preenche por COLUNA (de cima p/ baixo)
        r = idx % per_col
        x = lx + col_w * c + LEG_ICON_GAP
        y = inner_top - LEG_ROW_GAP * r
        if t == "__fluxo__":
            _seta(ax, x-2.0*s, y, x+2.0*s, y, color=GRAFITE, lw=2.4, mut=16)
        else:
            # desenha o mini-icone em torno de (0,0) e o ScaledAx aplica
            # escala s + deslocamento (x,y): icones MAIORES sem reescrever cada um
            TIPOS[t]["mini"](ScaledAx(ax, x, y, s), 0, 0)
        ax.text(x + 3.6*s + 1.2, y, label, ha="left", va="center",
                fontsize=LEG_FS, color=GRAFITE, zorder=6)

# ============================================================================
# CONFIG DEFAULT (modo sem --config)
# ============================================================================
def config_default():
    return {
        "municipio": "MODELO",
        "subbacia": "00",
        "etapas": [
            {"tipo": "Rede Projetada",  "descricao": "Rede coletora projetada"},
            {"tipo": "Rede Existente",  "descricao": "Interligação existente"},
            {"tipo": "EEE",             "descricao": "Estação elevatória"},
            {"tipo": "Linha de Recalque","descricao": "Recalque existente"},
            {"tipo": "ETE",             "descricao": "Tratamento"},
            {"tipo": "Corpo Receptor",  "descricao": "Lançamento final"},
        ],
    }

def main():
    ap = argparse.ArgumentParser(description="Gerador parametrico de fluxograma SES (2S)")
    ap.add_argument("--config", help="JSON com municipio/subbacia/etapas")
    ap.add_argument("--out", help="PNG de saida")
    args = ap.parse_args()

    if args.config:
        with open(args.config, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = config_default()

    out = args.out or cfg.get("out") or \
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "Fluxograma_Sistema.png")
    path = gerar(cfg, out)
    print("OK:", path)

if __name__ == "__main__":
    main()
