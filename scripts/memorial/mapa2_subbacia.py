# -*- coding: utf-8 -*-
"""MAPA 2 — Rede coletora da Bacia 02 sobre imagem de satélite Esri."""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly, Rectangle
from matplotlib.lines import Line2D
from matplotlib import patheffects as pe
import cartolib as C

rede_in = C.load_rede_amapora()
pvs = C.load_pvs_amapora()
node_xy = [(p["x"], p["y"]) for p in pvs]
all_xy = node_xy + [v for seg in rede_in for v in seg]
hull = C.convex_hull(all_xy)
hull_buf = C.buffer_hull(hull, 70)

hx = [p[0] for p in hull_buf]; hy = [p[1] for p in hull_buf]
bx0, bx1 = min(hx), max(hx); by0, by1 = min(hy), max(hy)
mx = (bx1-bx0)*0.07; my = (by1-by0)*0.07
xmin, xmax = bx0-mx, bx1+mx
ymin, ymax = by0-my, by1+my

n_pv = sum(1 for p in pvs if p["tipo"] == "PV")
n_tl = sum(1 for p in pvs if p["tipo"] == "TL")
print("Bacia 02 — PV/TL:", len(pvs), "(PV", n_pv, "/ TL", n_tl, ") trechos:", len(rede_in))

fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "REDE COLETORA PROJETADA — BACIA 02",
              "Delimitação da bacia de esgotamento e traçado da rede coletora — Amaporã / PR")

ax = fig.add_axes(C.map_axes_rect())
ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax)
ax.set_aspect("equal")

bm = C.add_basemap(ax, "Esri World Imagery", provider="imagery")
if bm is None:
    ax.set_facecolor("#3A4A3A")

# limite da bacia: preenchimento sutil + contorno tracejado
ax.add_patch(MplPoly(hull_buf, closed=True, facecolor=C.RED, edgecolor="none",
                     alpha=0.07, zorder=3))
ax.add_patch(MplPoly(hull_buf, closed=True, facecolor="none", edgecolor="white",
                     lw=3.0, alpha=0.55, zorder=4))
ax.add_patch(MplPoly(hull_buf, closed=True, facecolor="none", edgecolor=C.RED,
                     lw=1.8, ls=(0, (7, 4)), zorder=5))

# rede: casing branco + traço amarelo (legível sobre satélite)
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color="white", lw=2.6, zorder=6, solid_capstyle="round",
            alpha=0.9)
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color="#FFCC00", lw=1.4, zorder=7, solid_capstyle="round")

# PVs / TLs
pv_pts = [(p["x"], p["y"]) for p in pvs if p["tipo"] == "PV"]
tl_pts = [(p["x"], p["y"]) for p in pvs if p["tipo"] == "TL"]
if pv_pts:
    ax.scatter([p[0] for p in pv_pts], [p[1] for p in pv_pts], s=14, c="white",
               edgecolors=C.DARK, linewidths=0.7, zorder=9)
if tl_pts:
    ax.scatter([p[0] for p in tl_pts], [p[1] for p in tl_pts], s=24, c="#FFCC00",
               marker="s", edgecolors=C.DARK, linewidths=0.7, zorder=10)

C.utm_grid(ax, xmin, xmax, ymin, ymax, grid_color="white", grid_alpha=0.22)
C.frame(ax)
C.north_arrow(ax)                                   # canto superior esquerdo
C.scale_bar(ax, xmin, xmax, ymin, ymax, frac=0.26, loc="lower left")

# ---- RODAPE HORIZONTAL de legenda (faixa dedicada na base) ----
handles = [
    Line2D([0], [0], color="#FFCC00", lw=2.8, label="Rede coletora projetada"),
    Line2D([0], [0], marker="o", color="none", mfc="white", mec=C.DARK,
           ms=8, label=f"Poço de Visita — PV ({n_pv})"),
    Line2D([0], [0], marker="s", color="none", mfc="#FFCC00", mec=C.DARK,
           ms=8, label=f"Terminal de Limpeza — TL ({n_tl})"),
    Line2D([0], [0], color=C.RED, lw=2.2, ls=(0, (6, 3)),
           label="Limite da Bacia 02"),
]
C.footer_legend(fig, handles, ncol=4, map_ax=ax,
                extra_right=(f"BACIA 02 · {len(rede_in)} trechos · {n_pv} PV · {n_tl} TL\n"
                             "SIRGAS 2000 · UTM 22 S · Fonte: projeto OSE 2S"))

src_txt = ("Imagem de fundo: Esri World Imagery" if bm else "Fundo: sem imagem (offline)")
C.credits(fig, fonte=src_txt)

out = os.path.join(C.OUT, "Mapa2_SubBacia_SB02_Rede.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER)
print("SAVED", out, "| basemap:", bm)
