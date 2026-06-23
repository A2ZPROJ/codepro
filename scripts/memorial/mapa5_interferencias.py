# -*- coding: utf-8 -*-
"""MAPA 5 — Interferências com a rede coletora projetada (Bacia 02).
Mostra a rede coletora de esgoto projetada (2S) sobreposta às redes de
INTERFERÊNCIA levantadas em campo — abastecimento de ÁGUA (PVC) e
DRENAGEM pluvial (concreto) — sobre imagem de satélite Esri.
Fonte das interferências: ENTREGA - INTERFERENCIAS AMAPORA (shapefiles
SIRGAS 2000 / UTM 22S)."""
import os, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly, Rectangle
from matplotlib.lines import Line2D
import shapefile
import cartolib as C

# ---------------- fonte das interferencias ----------------
# Prioridade: (1) MEMORIAL_INTERF_SHP = pasta com os shapes ja classificados pela
# extracao (nomes canonicos LINHAS_AGUA/LINHAS_DRENAGEM/VERTICES_*); (2) C.INTDIR
# (env MEMORIAL_INTERF) — pode ser uma PASTA QUALQUER com subpastas: buscamos os
# shapes recursivamente pelo nome; (3) default Amapora (modo standalone).
INTDIR_SHP = os.environ.get("MEMORIAL_INTERF_SHP", "")
INTDIR = C.INTDIR or (
    r"C:\Users\lcabd\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA"
    r"\001. SERVIDOR PARANÁ\002. ACCIONA"
    r"\004. CT-027.2025 - PROJETOS\AMAPORÃ\INTERFERÊNCIAS"
    r"\ENTREGA - INTERFERENCIAS AMAPORA\ENTREGA - INTERFERENCIAS AMAPORA")


def _strip(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _walk_shp(root):
    found = []
    if root and os.path.isdir(root):
        for dp, _dn, fns in os.walk(root):
            for fn in fns:
                if fn.lower().endswith(".shp"):
                    found.append(os.path.join(dp, fn))
    return found


def _resolve(name):
    """Acha o .shp 'name' (canonico) buscando: (1) direto em INTDIR_SHP; (2) em
    INTDIR direto; (3) recursivo em INTDIR casando por palavras-chave do nome."""
    if INTDIR_SHP:
        p = os.path.join(INTDIR_SHP, name + ".shp")
        if os.path.exists(p):
            return p
    p = os.path.join(INTDIR, name + ".shp")
    if os.path.exists(p):
        return p
    # busca recursiva por nome (sem acento): casa todos os tokens do nome canonico
    toks = [_strip(t) for t in name.split("_") if t]
    is_vert = "vertices" in toks or "vertice" in toks
    best = None
    for sp in _walk_shp(INTDIR):
        n = _strip(os.path.basename(sp))
        nv = ("vertice" in n)
        if is_vert != nv:
            continue
        key = "agua" if "agua" in toks else ("dren" if any(t.startswith("dren") for t in toks) else None)
        if key and key not in n:
            continue
        best = sp
        break
    return best


def _lines(name, vert=None):
    """Le polylines com a geometria NATIVA do shape (respeita shape.parts e a
    ordem dos vertices; nao reordena nem liga feicoes diferentes). Usa o
    shapefile de VERTICES para reparar feicoes com geometria corrompida
    (drenagem) casando START_Z/END_Z com Z_FUNDO."""
    shp = _resolve(name)
    if not shp:
        print("  [mapa5] aviso: shape '%s' nao encontrado — camada omitida" % name)
        return []
    vshp = _resolve(vert) if vert else None
    return C.read_lines_fixed(shp, vshp)

def _pts(name):
    shp = _resolve(name)
    if not shp:
        return []
    r = shapefile.Reader(shp)
    return [tuple(sh.points[0]) for sh in r.shapes() if sh.points]

def _count(name):
    shp = _resolve(name)
    if not shp:
        return 0
    return len(shapefile.Reader(shp))

# rede projetada (Bacia 02)
rede_in = C.load_rede_amapora()
pvs = C.load_pvs_amapora()
n_pv = sum(1 for p in pvs if p["tipo"] == "PV")
n_tl = sum(1 for p in pvs if p["tipo"] == "TL")

# interferencias
agua_l = _lines("LINHAS_AGUA", vert="VERTICES_AGUA")
dren_l = _lines("LINHAS_DRENAGEM", vert="VERTICES_DRENAGEM")
agua_p = _pts("VERTICES_AGUA")
dren_p = _pts("VERTICES_DRENAGEM")
N_AGUA_L, N_DREN_L = _count("LINHAS_AGUA"), _count("LINHAS_DRENAGEM")
N_AGUA_P, N_DREN_P = _count("VERTICES_AGUA"), _count("VERTICES_DRENAGEM")
N_TOT = N_AGUA_L + N_DREN_L
print("INTERFERENCIAS — linhas agua:", N_AGUA_L, "| linhas drenagem:", N_DREN_L,
      "| vertices agua:", N_AGUA_P, "| vertices drenagem:", N_DREN_P)
print("Total de feicoes lineares de interferencia:", N_TOT)

# OPCAO A (robustez): se NAO houver interferencias (pasta nao apontada, vazia ou
# sem shapes casaveis), o mapa AINDA assim e gerado — apenas com a REDE coletora
# projetada sobre o satelite, SEM as camadas de agua/drenagem. Assim o memorial
# nunca quebra por falta de interferencias. Apenas logamos o motivo.
SEM_INTERF = (N_TOT == 0 and not agua_l and not dren_l)
if SEM_INTERF:
    _origem = INTDIR_SHP or INTDIR or "(nao informado)"
    print("  [mapa5] interferencias nao encontradas -> mapa5 sem camadas "
          "(somente rede sobre satelite). Origem buscada: %s" % _origem)

# ---------------- enquadramento (rede + interferencias) ----------------
all_xy = [(p["x"], p["y"]) for p in pvs] + [v for seg in rede_in for v in seg]
all_xy += [v for seg in agua_l for v in seg] + [v for seg in dren_l for v in seg]
all_xy += agua_p + dren_p
if not all_xy:
    # Sem rede e sem interferencias: nada para desenhar. PULA o mapa5 sem erro
    # (o builder do .docx tolera a figura ausente).
    print("  [mapa5] sem geometria (rede vazia e sem interferencias) -> mapa5 omitido")
    raise SystemExit(0)
xs = [p[0] for p in all_xy]; ys = [p[1] for p in all_xy]
bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
mx = (bx1-bx0)*0.05; my = (by1-by0)*0.05
xmin, xmax = bx0-mx, bx1+mx
ymin, ymax = by0-my, by1+my

# ---------------- figura ----------------
fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "MAPA DE INTERFERÊNCIAS — BACIA 02",
              "Rede coletora projetada x redes existentes (água e drenagem) — Amaporã / PR")

ax = fig.add_axes(C.map_axes_rect())
ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax); ax.set_aspect("equal")

bm = C.add_basemap(ax, "Esri World Imagery", provider="imagery")
if bm is None:
    ax.set_facecolor("#3A4A3A")

# ---- rede coletora projetada (casing branco + traço amarelo) ----
for seg in rede_in:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color="white",
            lw=2.4, zorder=6, solid_capstyle="round", alpha=0.9)
for seg in rede_in:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color="#FFCC00",
            lw=1.3, zorder=7, solid_capstyle="round")

# ---- DRENAGEM (concreto DN800) — linha ciano grossa tracejada ----
DREN_C = "#00C2E0"
for seg in dren_l:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color="black",
            lw=3.0, zorder=8, solid_capstyle="round", alpha=0.55)
for seg in dren_l:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color=DREN_C,
            lw=1.8, zorder=9, solid_capstyle="round")

# ---- ÁGUA (PVC) — linha azul ----
AGUA_C = "#2E6BFF"
for seg in agua_l:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color="white",
            lw=2.0, zorder=10, solid_capstyle="round", alpha=0.7)
for seg in agua_l:
    ax.plot([p[0] for p in seg], [p[1] for p in seg], color=AGUA_C,
            lw=1.1, zorder=11, solid_capstyle="round")

# ---- vertices das interferencias (nós) ----
if dren_p:
    ax.scatter([p[0] for p in dren_p], [p[1] for p in dren_p], s=18,
               c=DREN_C, marker="s", edgecolors="black", linewidths=0.5, zorder=12)
if agua_p:
    ax.scatter([p[0] for p in agua_p], [p[1] for p in agua_p], s=9,
               c=AGUA_C, marker="o", edgecolors="white", linewidths=0.25, zorder=12)

# ---- PVs / TLs da rede projetada ----
pv_pts = [(p["x"], p["y"]) for p in pvs if p["tipo"] == "PV"]
tl_pts = [(p["x"], p["y"]) for p in pvs if p["tipo"] == "TL"]
if pv_pts:
    ax.scatter([p[0] for p in pv_pts], [p[1] for p in pv_pts], s=12, c="white",
               edgecolors=C.DARK, linewidths=0.6, zorder=13)
if tl_pts:
    ax.scatter([p[0] for p in tl_pts], [p[1] for p in tl_pts], s=20, c="#FFCC00",
               marker="s", edgecolors=C.DARK, linewidths=0.6, zorder=13)

C.utm_grid(ax, xmin, xmax, ymin, ymax, grid_color="white", grid_alpha=0.22)
C.frame(ax)
C.north_arrow(ax)                                   # canto superior esquerdo
C.scale_bar(ax, xmin, xmax, ymin, ymax, frac=0.26, loc="lower left")

# ---------------- RODAPE HORIZONTAL de legenda (7 itens em 2 linhas) ----------
handles = [
    Line2D([0], [0], color="#FFCC00", lw=2.8, label="Rede coletora (esgoto)"),
    Line2D([0], [0], color=AGUA_C, lw=2.4, label=f"Rede de água — PVC ({N_AGUA_L})"),
    Line2D([0], [0], color=DREN_C, lw=2.8, label=f"Drenagem — concreto ({N_DREN_L})"),
    Line2D([0], [0], marker="o", color="none", mfc="white", mec=C.DARK,
           ms=8, label=f"PV de esgoto ({n_pv})"),
    Line2D([0], [0], marker="s", color="none", mfc="#FFCC00", mec=C.DARK,
           ms=8, label=f"Terminal de Limpeza ({n_tl})"),
    Line2D([0], [0], marker="o", color="none", mfc=AGUA_C, mec="white",
           ms=8, label=f"Vértice de água ({N_AGUA_P})"),
    Line2D([0], [0], marker="s", color="none", mfc=DREN_C, mec="black",
           ms=8, label=f"Vértice de drenagem ({N_DREN_P})"),
]
C.footer_legend(fig, handles, ncol=4, leg_fs=C.FS_LEG-0.6, map_ax=ax,
                extra_right=(f"INTERFERÊNCIAS: {N_TOT} trechos\n"
                             f"água {N_AGUA_L} · drenagem {N_DREN_L} · "
                             f"{N_AGUA_P + N_DREN_P} nós · Fonte: campo 2S"))

src_txt = ("Imagem de fundo: Esri World Imagery" if bm else "Fundo: sem imagem (offline)")
C.credits(fig, fonte=src_txt + "  ·  Interferências: levantamento 2S")

out = os.path.join(C.OUT, "Mapa5_Interferencias.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER)
print("SAVED", out, "| basemap:", bm)
