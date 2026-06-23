# -*- coding: utf-8 -*-
"""Helpers cartográficos compartilhados — identidade 2S Engenharia.
Versão PRO: tipografia refinada, moldura neatline, rosa-dos-ventos,
escala gráfica de barra dupla, faixa de título hierárquica."""
import json, math, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.patches import (Rectangle, FancyArrow, Polygon as MplPoly,
                                FancyBboxPatch, Circle, PathPatch)
from matplotlib.path import Path as MplPath
from matplotlib.lines import Line2D
from matplotlib import patheffects as pe
import shapefile

# ---- identidade visual 2S ----
RED   = "#A11312"   # vermelho destaque 2S
RED_D = "#7A0E0D"   # vermelho escuro (sombra/realce)
DARK  = "#262626"   # grafite 2S
INK   = "#1A1A1A"   # preto suave p/ texto
GREY  = "#555555"
LGREY = "#9AA0A6"
PAPER = "#FBFAF7"   # marfim do papel (fora do mapa)
PANEL = "#FFFFFF"   # painel branco

# ---- escala tipografica padronizada (hierarquia unica p/ todos os mapas) ----
FS_TITLE   = 16.0   # titulo da prancha (faixa superior)
FS_SUBT    = 8.8    # subtitulo da faixa
FS_LEGTIT  = 10.0   # cabecalho "LEGENDA"
FS_LEG     = 8.2    # itens da legenda
FS_BODY    = 7.4    # textos descritivos / KPIs auxiliares
FS_AXIS    = 7.6    # rotulos de eixo (Coordenada E/N)
FS_TICK    = 7.2    # numeros das coordenadas (ticks)
FS_SCALE   = 7.0    # numeros da barra de escala
FS_SMALL   = 6.6    # creditos / notas de rodape / datum

# ---- tipografia limpa (prioriza Arial/Helvetica, cai p/ DejaVu) ----
_avail = {f.name for f in fm.fontManager.ttflist}
for _f in ("Arial", "Helvetica Neue", "Helvetica", "Segoe UI", "Calibri", "DejaVu Sans"):
    if _f in _avail:
        plt.rcParams["font.family"] = _f
        break
plt.rcParams.update({
    "font.size": 9,
    "axes.linewidth": 0.8,
    "axes.edgecolor": DARK,
    "savefig.facecolor": PAPER,
    "figure.facecolor": PAPER,
    "pdf.fonttype": 42, "ps.fonttype": 42,
})
_STROKE = [pe.withStroke(linewidth=2.2, foreground="white")]
def _halo(lw=2.2, fg="white"):
    return [pe.withStroke(linewidth=lw, foreground=fg)]

BASE = r"C:\Users\lcabd\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA\Área de Trabalho\TESTE NEXUS"
REDE = BASE + r"\REDES ENG BELTRAO\Rede e PVs Eng Beltrao\Rede.shp"
PVS  = BASE + r"\REDES ENG BELTRAO\Rede e PVs Eng Beltrao\PVs.shp"
SOL  = BASE + r"\SOLEIRAS DUPLICADAS\ENG BELTRÃO\SOLEIRAS.shp"
INP  = BASE + r"\MEMORIAL DESCRITIVO\MODELO E-AGUA\01. MH\inp\MH-011-RCE-PB-PHID-01-R1.inp"

# ---- caminhos PARAMETRICOS (env-overridable p/ integracao Nexus/pipeline) ----
# Cada mapa importa cartolib e usa C.GEO (dados do projeto), C.OUT (saida dos
# PNGs) e C.CACHE. O pipeline define estas variaveis de ambiente ANTES de rodar
# os mapas; standalone cai nos defaults de Amapora abaixo.
_DEF_GEO   = r"C:\Users\lcabd\jarvis\memorial\geo_amapora"
_DEF_OUT   = r"C:\Users\lcabd\jarvis\memorial\mapas"
_DEF_CACHE = r"C:\Users\lcabd\jarvis\memorial\cache"
CACHE = os.environ.get("MEMORIAL_CACHE", _DEF_CACHE)
OUT   = os.environ.get("MEMORIAL_MAPAS", _DEF_OUT)
GEO   = os.environ.get("MEMORIAL_GEO", _DEF_GEO)        # dados do projeto (rede/pv/soleiras)
# diretorio de interferencias (shp agua/drenagem) — usado pelo mapa5
INTDIR = os.environ.get("MEMORIAL_INTERF", "")
# codigo IBGE do municipio — usado pelo mapa1 (default Amapora)
IBGE = os.environ.get("MEMORIAL_IBGE", "4100905")
# diretorio com os TXT de topografia — usado p/ (re)gerar o cache topo se faltar
TXT_DIR = os.environ.get("MEMORIAL_TXT_DIR", "")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

CRED = "2S Engenharia e Geotecnologia"

# ---------------- Amaporã data loaders (CSV / GeoJSON, EPSG:31982) ----------
import csv as _csv
def load_rede_amapora():
    """Le rede_trechos.geojson -> lista de trechos [(x,y),...]."""
    gj = json.load(open(os.path.join(GEO, "rede_trechos.geojson"), encoding="utf-8"))
    segs = []
    for f in gj["features"]:
        coords = f["geometry"]["coordinates"]
        if len(coords) >= 2:
            segs.append([(c[0], c[1]) for c in coords])
    return segs

def load_pvs_amapora():
    """Le estruturas_pv_tl.csv -> lista de dicts {name,tipo,x,y,...}."""
    out = []
    with open(os.path.join(GEO, "estruturas_pv_tl.csv"), encoding="utf-8") as fh:
        for row in _csv.DictReader(fh):
            try:
                out.append(dict(name=row["name"], tipo=row["tipo"],
                                x=float(row["X"]), y=float(row["Y"]), ose=row.get("ose")))
            except Exception:
                pass
    return out

def load_soleiras_amapora():
    """Le soleiras.csv -> (positivas, negativas) listas de (x,y,rec)."""
    pos, neg = [], []
    with open(os.path.join(GEO, "soleiras.csv"), encoding="utf-8") as fh:
        for row in _csv.DictReader(fh):
            try:
                x = float(row["X"]); y = float(row["Y"])
            except Exception:
                continue
            st = str(row.get("status", "")).strip().upper()
            if st.startswith("SOLEIRA-POSITIVA"):
                pos.append((x, y, row))
            elif st.startswith("SOLEIRA-NEGATIVA"):
                neg.append((x, y, row))
    return pos, neg

# ---------------- INP parsing -----------------
import re
def parse_inp():
    txt = open(INP, encoding="latin-1").read()
    def sec(name):
        m = re.search(r"\[" + name + r"\](.*?)(?=\n\[|\Z)", txt, re.S)
        return [l for l in (m.group(1).strip().splitlines() if m else [])
                if l.strip() and not l.strip().startswith(";")]
    pts = {}
    for l in sec("COORDINATES"):
        p = l.split()
        if len(p) >= 3:
            try: pts[p[0]] = (float(p[1]), float(p[2]))
            except: pass
    # conduits: id node1 node2 ...
    conds = []
    for l in sec("CONDUITS"):
        p = l.split()
        if len(p) >= 3:
            conds.append((p[0], p[1], p[2]))
    return pts, conds

# ---------------- shapefile helpers -----------------
def read_lines(shp, bbox=None):
    r = shapefile.Reader(shp)
    out = []
    for sh in r.shapes():
        if bbox and not _bbox_hit(sh.bbox, bbox): continue
        pts = sh.points
        parts = list(sh.parts) + [len(pts)]
        for i in range(len(parts)-1):
            seg = pts[parts[i]:parts[i+1]]
            if len(seg) >= 2:
                out.append(seg)
    return out

def read_lines_fixed(shp, vert_shp=None):
    """Le polylines RESPEITANDO a geometria nativa (shape.points por shape.parts,
    sem reordenar nem ligar feicoes diferentes). Caso a geometria de uma feicao
    esteja corrompida (distancia ponta-a-ponta != Shape_Leng), reconstroi os
    extremos a partir do shapefile de VERTICES casando START_Z/END_Z com Z_FUNDO.
    Devolve lista de segmentos [[(x,y),...], ...]."""
    r = shapefile.Reader(shp)
    flds = [f[0] for f in r.fields[1:]]
    fl = {n.upper(): i for i, n in enumerate(flds)}
    # carrega vertices (x,y,zfundo) se houver
    verts = []
    if vert_shp and os.path.exists(vert_shp):
        rv = shapefile.Reader(vert_shp)
        vfl = {n.upper(): i for i, n in enumerate(f[0] for f in rv.fields[1:])}
        zi = vfl.get("Z_FUNDO", vfl.get("Z"))
        for sh, rec in zip(rv.shapes(), rv.records()):
            if sh.points and zi is not None:
                verts.append((sh.points[0][0], sh.points[0][1], float(rec[zi])))

    def nearest_vertex_by_z(zf):
        best, bd = None, 1e18
        for v in verts:
            d = abs(v[2] - zf)
            if d < bd:
                bd, best = d, v
        return best, bd

    out = []
    n_fixed = 0
    si_sl = fl.get("SHAPE_LENG")
    si_sz = fl.get("START_Z"); si_ez = fl.get("END_Z")
    for sh, rec in zip(r.shapes(), r.records()):
        pts = sh.points
        parts = list(sh.parts) + [len(pts)]
        segs = []
        for i in range(len(parts)-1):
            seg = pts[parts[i]:parts[i+1]]
            if len(seg) >= 2:
                segs.append([(p[0], p[1]) for p in seg])
        # deteccao de geometria corrompida (so para feicoes de 1 parte simples)
        if (len(segs) == 1 and verts and si_sl is not None and
                si_sz is not None and si_ez is not None):
            seg = segs[0]
            sl = float(rec[si_sl] or 0)
            geo = math.hypot(seg[-1][0]-seg[0][0], seg[-1][1]-seg[0][1])
            if sl > 0 and abs(geo - sl) > 5.0:
                v1, d1 = nearest_vertex_by_z(float(rec[si_sz]))
                v2, d2 = nearest_vertex_by_z(float(rec[si_ez]))
                if v1 and v2 and d1 < 0.05 and d2 < 0.05:
                    newd = math.hypot(v2[0]-v1[0], v2[1]-v1[1])
                    if abs(newd - sl) < 5.0:
                        segs = [[(v1[0], v1[1]), (v2[0], v2[1])]]
                        n_fixed += 1
        out.extend(segs)
    if n_fixed:
        print(f"  [read_lines_fixed] geometria corrigida em {n_fixed} feicao(oes) de "
              + os.path.basename(shp))
    return out

def read_points(shp, bbox=None):
    r = shapefile.Reader(shp)
    out = []
    for sh in r.shapes():
        for p in sh.points:
            if bbox and not (bbox[0]<=p[0]<=bbox[2] and bbox[1]<=p[1]<=bbox[3]): continue
            out.append(p)
    return out

def read_points_rec(shp, bbox=None):
    r = shapefile.Reader(shp)
    flds = [f[0] for f in r.fields[1:]]
    out = []
    for sh, rec in zip(r.shapes(), r.records()):
        for p in sh.points:
            if bbox and not (bbox[0]<=p[0]<=bbox[2] and bbox[1]<=p[1]<=bbox[3]): continue
            out.append((p, dict(zip(flds, rec))))
    return out

def _bbox_hit(b, box):
    return not (b[2]<box[0] or b[0]>box[2] or b[3]<box[1] or b[1]>box[3])

# ---------------- convex hull (Andrew monotone chain) ----------
def convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) <= 2: return pts
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[]
    for p in pts:
        while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0: lo.pop()
        lo.append(p)
    up=[]
    for p in reversed(pts):
        while len(up)>=2 and cross(up[-2],up[-1],p)<=0: up.pop()
        up.append(p)
    return lo[:-1]+up[:-1]

def buffer_hull(hull, d):
    """Expand polygon outward by ~d meters from centroid."""
    cx = sum(p[0] for p in hull)/len(hull)
    cy = sum(p[1] for p in hull)/len(hull)
    out=[]
    for x,y in hull:
        dx,dy=x-cx,y-cy
        L=math.hypot(dx,dy) or 1
        out.append((x+dx/L*d, y+dy/L*d))
    return out

# ---------------- map furniture (PRO) -----------------
def _nice_step(span):
    for s in [25,50,100,200,250,500,1000,2000,2500,5000,10000,25000,50000]:
        if span/s <= 7:
            return s
    return 100000

def utm_grid(ax, xmin, xmax, ymin, ymax, step=None, label_fs=None,
             tick_color=None, grid=True, grid_color="white", grid_alpha=0.30):
    """Malha UTM com ticks internos e rótulos limpos (tipografia padronizada)."""
    if step is None:
        step = _nice_step(max(xmax-xmin, ymax-ymin))
    label_fs = label_fs or FS_TICK
    tick_color = tick_color or DARK
    x0 = math.ceil(xmin/step)*step
    y0 = math.ceil(ymin/step)*step
    xt = np.arange(x0, xmax, step)
    yt = np.arange(y0, ymax, step)
    ax.set_xticks(xt); ax.set_yticks(yt)
    ax.set_xticklabels([f"{int(v):,}".replace(",", ".") for v in xt],
                       fontsize=label_fs, color=DARK)
    ax.set_yticklabels([f"{int(v):,}".replace(",", ".") for v in yt],
                       fontsize=label_fs, color=DARK, rotation=90, va="center")
    if grid:
        ax.grid(True, color=grid_color, alpha=grid_alpha, lw=0.5, zorder=4)
    ax.tick_params(length=4, width=0.8, color=tick_color, direction="in",
                   top=True, right=True, pad=8)
    ax.set_xlabel("Coordenada E (m) — SIRGAS 2000 / UTM 22S",
                  fontsize=FS_AXIS, color=GREY)
    ax.set_ylabel("Coordenada N (m)", fontsize=FS_AXIS, color=GREY)

def north_arrow(ax, x=0.012, y=0.838, size=0.125, pad=0.022):
    """Rosa-dos-ventos profissional desenhada num INSET axes QUADRADO (circulo
    sempre redondo), no canto SUPERIOR ESQUERDO da area do mapa, totalmente
    dentro da moldura com AFASTAMENTO (pad) p/ nao encostar na borda.
    Estrela de 8 pontas, ponta N em vermelho 2S, anel graduado e letras
    cardeais N/E/S/W."""
    fig = ax.figure
    # posicao do inset em fig-coords, derivada da caixa do ax (cantos sup-esq)
    bb = ax.get_position()
    w = size * bb.width
    h = w * (fig.get_figwidth() / fig.get_figheight())   # quadrado em polegadas
    # afastamento da borda interna do mapa (em fracao da largura da caixa)
    padx = pad * bb.width
    pady = pad * bb.width   # mesma medida fisica nos dois eixos
    cax = fig.add_axes([bb.x0 + padx, bb.y1 - h - pady, w, h], zorder=30)
    cax.set_xlim(-1, 1); cax.set_ylim(-1, 1); cax.set_aspect("equal")
    cax.axis("off")
    Z = 1
    # disco
    cax.add_patch(Circle((0, 0), 0.96, fc="white", ec=DARK, lw=1.2, alpha=0.96, zorder=Z))
    cax.add_patch(Circle((0, 0), 0.80, fc="none", ec=GREY, lw=0.6, alpha=0.7, zorder=Z+0.1))
    long_, short_ = 0.74, 0.13
    diag_ = 0.40

    def kite(rot, fc, rlong, rwide):
        a = math.radians(rot)
        tip = (rlong*math.sin(a), rlong*math.cos(a))
        bl = (rwide*math.sin(a-math.pi/2), rwide*math.cos(a-math.pi/2))
        br = (rwide*math.sin(a+math.pi/2), rwide*math.cos(a+math.pi/2))
        cax.add_patch(MplPoly([tip, bl, (0, 0), br], closed=True, fc=fc,
                              ec=DARK, lw=0.6, zorder=Z+2))
    for rot in (45, 135, 225, 315):
        kite(rot, LGREY, diag_, short_*0.62)
    kite(90, "white", long_, short_); kite(270, "white", long_, short_)
    kite(180, "white", long_, short_)
    kite(0, RED, long_, short_)
    cax.add_patch(Circle((0, 0), 0.07, fc=DARK, ec="white", lw=0.5, zorder=Z+3))
    rlab = 1.0
    for txt, ang, col, fs in (("N", 0, RED, 11), ("E", 90, DARK, 9),
                              ("S", 180, DARK, 9), ("W", 270, DARK, 9)):
        a = math.radians(ang)
        cax.text(rlab*math.sin(a), rlab*math.cos(a), txt, ha="center", va="center",
                 fontsize=fs, fontweight="bold", color=col, zorder=Z+4,
                 path_effects=_halo(2.2))

def scale_bar(ax, xmin, xmax, ymin, ymax, frac=0.26, loc="lower left", y_frac=None):
    """Escala gráfica de barra dupla (alternada preto/branco) com unidades.
    y_frac: fração do eixo Y p/ a base da barra (override; default 0.075 lower /
    0.12 do topo). Use valor pequeno (ex.: 0.035) p/ colar a barra na base."""
    span = xmax - xmin
    raw = span*frac
    nice = [25,50,100,150,200,250,300,400,500,750,1000,1500,2000,2500,5000]
    L = min(nice, key=lambda v: abs(v-raw))
    n = 4
    seg = L/n
    if "left" in loc:
        x0 = xmin + span*0.045
    else:
        x0 = xmax - span*0.045 - L
    yspan = ymax - ymin
    h = span*0.009          # altura proporcional ao eixo X (consistente)
    if y_frac is not None:
        y0 = ymin + yspan*y_frac
    else:
        y0 = (ymin + yspan*0.075) if "lower" in loc else (ymax - yspan*0.12)
    # caixa branca de fundo
    pad = seg*0.35
    ax.add_patch(Rectangle((x0-pad, y0-h*2.0), L+2*pad, h*6.2, facecolor="white",
                 edgecolor=GREY, lw=0.6, alpha=0.92, zorder=24, clip_on=True))
    for i in range(n):
        c = DARK if i % 2 == 0 else "white"
        ax.add_patch(Rectangle((x0+i*seg, y0), seg, h, facecolor=c,
                     edgecolor=DARK, lw=0.7, zorder=25, clip_on=True))
        # segunda fileira invertida (barra dupla)
        c2 = "white" if i % 2 == 0 else DARK
        ax.add_patch(Rectangle((x0+i*seg, y0+h), seg, h, facecolor=c2,
                     edgecolor=DARK, lw=0.7, zorder=25, clip_on=True))
    for i in range(n+1):
        v = seg*i
        lab = (f"{v/1000:.2f}".rstrip("0").rstrip(".") if L >= 1000 else f"{int(v)}")
        ax.text(x0+i*seg, y0+h*2.2, lab, ha="center", va="bottom", fontsize=FS_SCALE-0.4,
                color=DARK, zorder=26)
    unit = "km" if L >= 1000 else "m"
    ax.text(x0+L+pad*0.4, y0+h, unit, ha="left", va="center", fontsize=FS_SCALE,
            color=DARK, fontweight="bold", zorder=26)
    ax.text(x0+L/2, y0-h*0.5, "ESCALA GRÁFICA", ha="center", va="top",
            fontsize=FS_SMALL-0.3, color=GREY, zorder=26, fontweight="bold")

def datum_box(ax, x=None, y=None, extra="", title="REFERÊNCIA ESPACIAL",
              corner="lower right"):
    """Caixa de referencia espacial ancorada num canto do mapa.
    Por padrao vai no canto INFERIOR DIREITO — separado da barra de escala
    (inferior esquerdo) p/ nunca sobrepor. Titulo em vermelho dentro da caixa."""
    body = ("Datum horizontal: SIRGAS 2000\nProjeção: UTM — Fuso 22 S\n"
            "Meridiano Central: 51° W")
    if extra:
        body += "\n" + extra
    if x is None or y is None:
        if "right" in corner:
            x, ha = 0.985, "right"
        else:
            x, ha = 0.015, "left"
        y = 0.018 if "lower" in corner else 0.982
        va = "bottom" if "lower" in corner else "top"
    else:
        ha, va = "left", "bottom"
    # caixa branca; 1a linha = titulo (vermelho/negrito), demais = corpo
    fs = FS_SMALL - 0.2
    full = title + "\n" + body
    ax.text(x, y, full, transform=ax.transAxes, fontsize=fs,
            color=INK, va=va, ha=ha, zorder=26, linespacing=1.55,
            bbox=dict(boxstyle="round,pad=0.55", fc="white", ec=GREY,
                      lw=0.8, alpha=0.96))
    # overlay so do titulo, mesmas metricas -> cai exatamente sobre a 1a linha
    nblank = body.count("\n") + 1
    ax.text(x, y, title + "\n"*nblank, transform=ax.transAxes, fontsize=fs,
            color=RED, fontweight="bold", va=va, ha=ha, zorder=27, linespacing=1.55)

LOGO_2S = (r"C:\Users\lcabd\OneDrive - A2Z Projetos\INSTALADORES - PROGRAMAÇÃO"
           r"\PROJETOS\codepro\assets\logo-2s.png")
_LOGO_CACHE = {}

def _load_logo():
    """Carrega a logo 2S (PIL) uma unica vez e devolve (array, w/h)."""
    if "img" in _LOGO_CACHE:
        return _LOGO_CACHE["img"], _LOGO_CACHE["ar"]
    try:
        from PIL import Image
        im = Image.open(LOGO_2S).convert("RGBA")
        arr = np.asarray(im)
        ar = im.width / im.height
        _LOGO_CACHE["img"] = arr; _LOGO_CACHE["ar"] = ar
        return arr, ar
    except Exception as e:
        print("  logo fail:", e)
        _LOGO_CACHE["img"] = None; _LOGO_CACHE["ar"] = 1.0
        return None, 1.0

def title_block(fig, title, subtitle, project="REDE COLETORA DE ESGOTO · AMAPORÃ — PR"):
    """Faixa de título no topo: tarja grafite + filete vermelho + LOGO 2S real
    (à esquerda) + textos (alinhados à direita da logo)."""
    BAR_Y, BAR_H = 0.945, 0.055
    # barra grafite superior
    fig.patches.append(Rectangle((0, BAR_Y), 1.0, BAR_H, transform=fig.transFigure,
                       facecolor=DARK, edgecolor="none", zorder=2))
    # filete vermelho fino sob a barra
    fig.patches.append(Rectangle((0, BAR_Y-0.0025), 1.0, 0.0028, transform=fig.transFigure,
                       facecolor=RED, edgecolor="none", zorder=3))

    # ---- LOGO 2S real à esquerda (mantem aspect ratio) ----
    logo, ar = _load_logo()
    text_x = 0.018
    if logo is not None:
        fig_ar = fig.get_figwidth() / fig.get_figheight()
        lh = BAR_H * 0.70                       # altura da logo (fig-coords Y)
        lw = lh * ar / fig_ar                   # largura corrigida pelo aspecto da figura
        lx = 0.015
        ly = BAR_Y + (BAR_H - lh) / 2.0
        lax = fig.add_axes([lx, ly, lw, lh], zorder=5)
        lax.imshow(logo); lax.axis("off")
        # filete branco fino emoldurando a logo (acabamento)
        text_x = lx + lw + 0.014
    else:
        # fallback: caixa vermelha com "2S" desenhado
        fig.patches.append(Rectangle((0.015, BAR_Y+0.008), 0.030, BAR_H-0.016,
                           transform=fig.transFigure, facecolor=RED,
                           edgecolor="white", lw=1.0, zorder=5))
        fig.text(0.030, BAR_Y+BAR_H/2, "2S", ha="center", va="center",
                 fontsize=15, fontweight="bold", color="white", zorder=6)
        text_x = 0.052

    # ---- textos do título (à direita da logo) ----
    fig.text(text_x, BAR_Y+BAR_H*0.62, title, ha="left", va="center",
             fontsize=FS_TITLE, fontweight="bold", color="white", zorder=6)
    fig.text(text_x, BAR_Y+BAR_H*0.27, subtitle, ha="left", va="center",
             fontsize=FS_SUBT, color="#E8C9C8", zorder=6)
    # ---- assinatura à direita ----
    fig.text(0.982, BAR_Y+BAR_H*0.62, "2S ENGENHARIA", ha="right", va="center",
             fontsize=11.5, fontweight="bold", color="white", zorder=6)
    fig.text(0.982, BAR_Y+BAR_H*0.27, "AGRIMENSURA · GEOTECNOLOGIA", ha="right",
             va="center", fontsize=FS_SMALL-0.2, color="#C9C9C9", zorder=6,
             fontweight="bold")

def credits(fig, fonte=""):
    # rodapé: filete + créditos
    fig.patches.append(Rectangle((0,0.0), 1.0, 0.030, transform=fig.transFigure,
                       facecolor="#F0EEE8", edgecolor="none", zorder=2))
    fig.patches.append(Rectangle((0,0.030), 1.0, 0.0022, transform=fig.transFigure,
                       facecolor=RED, edgecolor="none", zorder=3))
    fig.text(0.018, 0.011, "2S Engenharia e Geotecnologia",
             ha="left", va="bottom", fontsize=FS_SMALL+0.4, color=RED,
             fontweight="bold", style="italic", zorder=4)
    mid = "SIRGAS 2000 / UTM 22S" + (("  ·  "+fonte) if fonte else "")
    fig.text(0.5, 0.011, mid, ha="center", va="bottom", fontsize=FS_SMALL,
             color=GREY, zorder=4)
    fig.text(0.982, 0.011, "Memorial Descritivo — Rede Coletora de Esgoto",
             ha="right", va="bottom", fontsize=FS_SMALL, color=GREY, zorder=4)

def frame(ax, double=True):
    """Neatline: moldura interna fina + externa grossa (estilo prancha)."""
    for s in ax.spines.values():
        s.set_edgecolor(DARK); s.set_linewidth(1.6); s.set_zorder(28)
    if double:
        # moldura externa adicional via retângulo em coords de axes
        ax.add_patch(Rectangle((-0.012,-0.012), 1.024, 1.024, transform=ax.transAxes,
                     fill=False, edgecolor=DARK, lw=0.7, zorder=28, clip_on=False))

def panel(ax_or_fig, rect=None, fc=PANEL, ec=GREY, lw=1.0, rad=0.012, z=10, alpha=0.96):
    """Caixa arredondada para legendas/painéis. rect em fig-coords se fig dado."""
    fig = ax_or_fig if hasattr(ax_or_fig, "add_axes") else None
    target = ax_or_fig
    p = FancyBboxPatch((rect[0], rect[1]), rect[2], rect[3],
                       boxstyle=f"round,pad=0.002,rounding_size={rad}",
                       transform=(fig.transFigure if fig else target.transAxes),
                       fc=fc, ec=ec, lw=lw, zorder=z, alpha=alpha,
                       mutation_aspect=0.5)
    (fig.patches if fig else target.patches).append(p)
    return p

def legend_panel(fig, rect, handles, title="LEGENDA", body=None,
                 leg_fs=None, body_fs=None, labelspacing=1.0):
    """Painel branco de legenda (canto/lado direito). Tipografia padronizada.
    rect = [x,y,w,h] em fig-coords. Retorna o axes p/ extras (KPI etc.)."""
    leg_fs = leg_fs or FS_LEG
    body_fs = body_fs or FS_BODY
    panel(fig, rect=rect, fc="white", ec=GREY, lw=1.0, z=11)
    lax = fig.add_axes(rect); lax.axis("off"); lax.set_zorder(12)
    lax.text(0.07, 0.965, title, transform=lax.transAxes, fontsize=FS_LEGTIT,
             fontweight="bold", color=DARK, va="top")
    lax.plot([0.07, 0.93], [0.918, 0.918], transform=lax.transAxes,
             color=RED, lw=1.5)
    lax.legend(handles=handles, loc="upper left", fontsize=leg_fs, frameon=False,
               bbox_to_anchor=(0.05, 0.885), handlelength=2.0,
               labelspacing=labelspacing, borderaxespad=0.0)
    return lax

def source_note(fig, text, x=0.058, y=0.050, ok=True):
    """Nota de fonte/imagem, abaixo da area do mapa (tipografia padronizada)."""
    fig.text(x, y, text, fontsize=FS_SMALL-0.2, color=(GREY if ok else RED),
             ha="left", style="italic", zorder=4)

# ============================================================================
#  RODAPE HORIZONTAL DE LEGENDA (padrao unico p/ TODOS os mapas)
# ----------------------------------------------------------------------------
#  Reserva uma FAIXA inferior dedicada do figure (acima dos creditos) onde a
#  legenda fica em layout HORIZONTAL, itens lado a lado em 1 ou 2 linhas.
#  Assim a legenda NUNCA ocupa espaco sobre o mapa nem colide com a escala.
#  Use map_axes_rect() p/ a area do mapa (que para acima do rodape) e
#  footer_legend() p/ desenhar o rodape.
# ============================================================================

# ---- geometria padronizada da prancha (fig-coords) ----
TITLE_BOT   = 0.945     # base da faixa de titulo (title_block)
CRED_TOP    = 0.032     # topo da faixa de creditos (credits)
FOOTER_H    = 0.150     # ALTURA da faixa do rodape de legenda (15% do figure)
# respiro VERTICAL entre a base do mapa (incl. rotulos da malha UTM embaixo) e
# o topo da faixa de legenda — evita que a malha de coordenadas toque a legenda.
FOOTER_GAP  = 0.064
FOOTER_Y0   = CRED_TOP + 0.004           # base do rodape (logo acima dos creditos)
FOOTER_Y1   = FOOTER_Y0 + FOOTER_H       # topo do rodape
MAP_BOT     = FOOTER_Y1 + FOOTER_GAP     # base da area do mapa
MAP_TOP     = TITLE_BOT - 0.015          # topo da area do mapa (abaixo do titulo)

def map_axes_rect(x0=0.052, w=0.896, top=None, bottom=None):
    """Retangulo [x,y,w,h] (fig-coords) p/ a area do MAPA, ja descontando a
    faixa do rodape de legenda embaixo e a faixa de titulo em cima.
    A area do mapa passa a ocupar so a parte de cima, acima do rodape."""
    top = MAP_TOP if top is None else top
    bottom = MAP_BOT if bottom is None else bottom
    return [x0, bottom, w, top - bottom]

def footer_legend(fig, items, title="LEGENDA", x0=0.052, x1=0.948,
                  y0=None, y1=None, ncol=None, extra_right=None,
                  datum=True, leg_fs=None, map_ax=None):
    """Desenha o RODAPE HORIZONTAL de legenda numa faixa dedicada na base do
    figure (igual ao fluxograma). A legenda fica em uma faixa branca, itens
    lado a lado (horizontal), NUNCA sobre o mapa nem sobre a escala.

    items: lista de handles (Line2D/Patch) OU dicts {handle:..} — basta passar
           os mesmos handles que ja eram usados na legenda lateral.
    title: cabecalho a esquerda da faixa (default "LEGENDA").
    ncol:  numero de colunas da legenda (auto se None: 1 ou 2 linhas).
    extra_right: texto opcional (str) ancorado a DIREITA do rodape (ex.: datum
           ou nota). Se datum=True e extra_right=None, escreve a ref. espacial.
    map_ax: axes do MAPA. Se fornecido, a faixa do rodape e ENQUADRADA na
            LARGURA EXATA da area visivel do mapa (mesmos x0/x1 em fig-coords),
            lendo a posicao real do axes APOS aplicar set_aspect('equal').
    Retorna o axes do rodape (p/ extras)."""
    leg_fs = leg_fs or FS_LEG
    y0 = FOOTER_Y0 if y0 is None else y0
    y1 = FOOTER_Y1 if y1 is None else y1
    # ---- ENQUADRA o rodape na largura REAL da area do mapa ----
    # set_aspect('equal') encolhe a caixa do axes p/ manter o aspecto; a posicao
    # real so fica disponivel apos apply_aspect(). Lemos x0/x1 reais do mapa e
    # usamos os MESMOS limites aqui, p/ as bordas esq/dir baterem exatamente.
    if map_ax is not None:
        try:
            map_ax.apply_aspect()
            bb = map_ax.get_position(original=False)
            x0, x1 = bb.x0, bb.x1
        except Exception as e:
            print("  footer_legend: get_position falhou:", e)
    w = x1 - x0
    h = y1 - y0
    # ---- faixa branca do rodape (com filete vermelho no topo, igual ao fluxograma)
    fig.patches.append(Rectangle((x0, y0), w, h, transform=fig.transFigure,
                       facecolor="white", edgecolor=GREY, lw=0.9, zorder=20))
    fig.patches.append(Rectangle((x0, y1-0.006), w, 0.006, transform=fig.transFigure,
                       facecolor=RED, edgecolor="none", zorder=21))
    fax = fig.add_axes([x0, y0, w, h]); fax.axis("off"); fax.set_zorder(22)
    fax.set_xlim(0, 1); fax.set_ylim(0, 1)
    # ---- cabecalho "LEGENDA" no topo-esquerda; filete vermelho COLADO ao texto ----
    fax.text(0.012, 0.86, title, transform=fax.transAxes, fontsize=FS_LEGTIT,
             fontweight="bold", color=DARK, va="center", ha="left")
    fax.plot([0.012, 0.085], [0.78, 0.78], transform=fax.transAxes,
             color=RED, lw=1.6)
    # ---- itens em ATE 2 COLUNAS (empilhados), ocupando toda a largura ----
    # (sem bloco lateral direito nem separador — info redundante/datum sai nos
    #  creditos do rodape; ver credits()).
    n = len(items)
    if ncol is None:
        ncol = 1 if n <= 2 else 2
    ncol = max(1, min(ncol, 2))   # no maximo 2 colunas (itens empilhados)
    left_frac = 0.105
    leg = fax.legend(handles=items, loc="center left", ncol=ncol,
                     fontsize=leg_fs, frameon=False,
                     bbox_to_anchor=(left_frac, 0.5),
                     bbox_transform=fax.transAxes,
                     handlelength=2.1, handletextpad=0.6,
                     columnspacing=2.4, labelspacing=0.9,
                     borderaxespad=0.0)
    leg.set_zorder(23)
    return fax

def ensure_topo_cache(npy_name="topo_amapora.npy"):
    """Garante o cache .npy (N x 3: X,Y,Z) da nuvem topografica em C.CACHE.
    Se nao existir e C.TXT_DIR estiver definido, constroi a partir dos TXT GNSS
    (PONTO,DESC,N(Y),E(X),Z,...). Retorna o caminho do .npy.
    Usado por mapa4 (calor) e mapa6 (3D)."""
    import numpy as np
    path = os.path.join(CACHE, npy_name)
    if os.path.exists(path):
        return path
    if not TXT_DIR or not os.path.isdir(TXT_DIR):
        raise FileNotFoundError(
            "Cache topografico ausente (%s) e MEMORIAL_TXT_DIR nao definido." % path)
    import glob as _glob
    pts = []
    for fp in sorted(_glob.glob(os.path.join(TXT_DIR, "*.txt"))):
        with open(fp, encoding="latin-1") as fh:
            for line in fh:
                p = line.split(",")
                if len(p) < 5:
                    continue
                try:
                    y = float(p[2]); x = float(p[3]); z = float(p[4])
                except ValueError:
                    continue
                pts.append((x, y, z))
    arr = np.array(pts, dtype=float)
    np.save(path, arr)
    print("  [cartolib] cache topografico gerado:", path, "->", len(arr), "pts")
    return path


def add_basemap(ax, src_label="Esri World Imagery", zoom="auto", provider="imagery"):
    """Basemap via contextily. provider: 'imagery'|'hillshade'|'terrain'."""
    try:
        import contextily as cx
        E = cx.providers.Esri
        prov = cx.providers.Esri.WorldImagery
        if provider == "hillshade" and hasattr(E, "WorldHillshade"):
            prov = E.WorldHillshade
        elif provider == "terrain" and hasattr(E, "WorldShadedRelief"):
            prov = E.WorldShadedRelief
        kw = dict(crs="EPSG:31982", source=prov, attribution=False)
        if zoom != "auto":
            kw["zoom"] = zoom
        cx.add_basemap(ax, **kw)
        return src_label
    except Exception as e:
        print("  basemap fail:", e)
        return None
