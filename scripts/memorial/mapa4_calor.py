# -*- coding: utf-8 -*-
"""MAPA 4 — Mapa de calor de topografia (hipsométrico) de Amaporã/Bacia 02.
Interpola 10.035 pontos GNSS (griddata cubic + IDW de preenchimento) ->
superfície contínua de cotas, hillshade sobreposto (profundidade 3D),
curvas de nível rotuladas, rede coletora por cima, colorbar de cotas."""
import os, math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly, Path as _P
from matplotlib.path import Path as MplPath
from matplotlib.lines import Line2D
from matplotlib.colors import LightSource, BoundaryNorm
from matplotlib import patheffects as pe
from scipy.interpolate import griddata
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter
import cartolib as C

# ---------- dados ----------
TOPO = np.load(C.ensure_topo_cache())   # (N,3) X,Y,Z
X, Y, Z = TOPO[:, 0], TOPO[:, 1], TOPO[:, 2]
rede_in = C.load_rede_amapora()
pvs = C.load_pvs_amapora()

# enquadrar pela nuvem de pontos topográficos (com folga)
pad = 60
xmin, xmax = X.min()-pad, X.max()+pad
ymin, ymax = Y.min()-pad, Y.max()+pad

# ---------- grade de interpolação ----------
NX, NY = 700, 600
gx = np.linspace(xmin, xmax, NX)
gy = np.linspace(ymin, ymax, NY)
GX, GY = np.meshgrid(gx, gy)

print("interpolando", len(TOPO), "pontos em grade", NX, "x", NY, "...")
# 1) interpolação cúbica (suave) dentro do convex hull dos dados
Zc = griddata((X, Y), Z, (GX, GY), method="cubic")
# 2) IDW (k vizinhos) para preencher fora do hull e buracos -> superfície completa
tree = cKDTree(np.c_[X, Y])
flat = np.c_[GX.ravel(), GY.ravel()]
d, idx = tree.query(flat, k=12)
d = np.maximum(d, 1e-6)
w = 1.0 / d**2
Zidw = (np.sum(w * Z[idx], axis=1) / np.sum(w, axis=1)).reshape(GX.shape)
Zg = np.where(np.isnan(Zc), Zidw, Zc)
# clip a faixa real dos dados (griddata cúbico pode "estourar" nas bordas)
zlo_d, zhi_d = float(Z.min()), float(Z.max())
Zg = np.clip(Zg, zlo_d, zhi_d)
# leve suavização para aspecto hipsométrico contínuo
Zg = gaussian_filter(Zg, sigma=1.2)

# máscara: só mostra perto dos dados (evita extrapolação grosseira nas bordas)
dist0 = tree.query(flat, k=1)[0].reshape(GX.shape)
MASK = dist0 > 130.0   # > 130 m de qualquer ponto = sem dado
Zm = np.ma.array(Zg, mask=MASK)

zmin, zmax = zlo_d, zhi_d
print("cotas grade:", round(zmin, 2), "a", round(zmax, 2))

# ---------- figura ----------
fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "MAPA HIPSOMÉTRICO — TOPOGRAFIA DA BACIA 02",
              "Modelo digital do terreno (10.035 pontos GNSS) e rede coletora — Amaporã / PR")

MAP_RECT = C.map_axes_rect()
ax = fig.add_axes(MAP_RECT)
ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax); ax.set_aspect("equal")
ax.set_facecolor("#F4F2EC")

extent = [xmin, xmax, ymin, ymax]
# faixas de cota discretas (visual hipsométrico nítido)
step = 2.0
lo = math.floor(zmin/step)*step
hi = math.ceil(zmax/step)*step
levels = np.arange(lo, hi+step, step)
norm = BoundaryNorm(levels, ncolors=256, clip=True)
cmap = plt.get_cmap("terrain")

# camada hipsométrica (cota -> cor)
im = ax.imshow(Zm, extent=extent, origin="lower", cmap=cmap, norm=norm,
               interpolation="bilinear", zorder=3, alpha=1.0)

# hillshade (relevo sombreado) sobreposto em multiply para dar 3D
ls = LightSource(azdeg=315, altdeg=45)
hs = ls.hillshade(np.where(MASK, np.nan, Zg), vert_exag=18,
                  dx=(xmax-xmin)/NX, dy=(ymax-ymin)/NY)
hs_m = np.ma.array(hs, mask=MASK)
ax.imshow(hs_m, extent=extent, origin="lower", cmap="gray",
          alpha=0.40, zorder=4, interpolation="bilinear")

# curvas de nível (mestras a cada 5 m, secundárias a cada 1 m)
cl_minor = ax.contour(GX, GY, Zm, levels=np.arange(lo, hi+1, 1.0),
                      colors="#5A4A3A", linewidths=0.25, alpha=0.45, zorder=5)
cl_major = ax.contour(GX, GY, Zm, levels=np.arange(lo, hi+1, 5.0),
                      colors="#3A2E22", linewidths=0.7, alpha=0.8, zorder=6)
lbls = ax.clabel(cl_major, fmt="%d", fontsize=6.0, inline=True, colors="#2A2018")
for t in lbls:
    t.set_path_effects([pe.withStroke(linewidth=1.8, foreground="white")])

# rede coletora por cima (casing + traço escuro fino)
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color="white", lw=1.8, alpha=0.85, zorder=8,
            solid_capstyle="round")
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color=C.RED, lw=0.9, alpha=0.95, zorder=9,
            solid_capstyle="round")
# PVs discretos
px = [p["x"] for p in pvs]; py = [p["y"] for p in pvs]
ax.scatter(px, py, s=5, c="white", edgecolors=C.RED, linewidths=0.4, zorder=10)

C.utm_grid(ax, xmin, xmax, ymin, ymax, grid_color="#FFFFFF", grid_alpha=0.0)
C.frame(ax)
C.north_arrow(ax)                                   # canto superior esquerdo
C.scale_bar(ax, xmin, xmax, ymin, ymax, frac=0.24, loc="lower left")

# ---------- colorbar de cotas (vertical, dentro da area do mapa, à direita) ----
# usa a posicao REAL do mapa (apos set_aspect encolher a caixa) p/ a colorbar
# encostar no canto direito visivel — mesma referencia que o rodape usa.
ax.apply_aspect()
_bb = ax.get_position(original=False)
_mx, _my, _mw, _mh = _bb.x0, _bb.y0, _bb.width, _bb.height
_CB_H = _mh * 0.58
cax = fig.add_axes([_mx + _mw + 0.012, _my + _mh - _CB_H, 0.020, _CB_H])
cb = fig.colorbar(im, cax=cax, ticks=levels[::2])
cb.set_label("Altitude (m) — cota ortométrica", fontsize=C.FS_LEG, color=C.INK)
cb.ax.tick_params(labelsize=C.FS_TICK, color=C.GREY)
cb.outline.set_edgecolor(C.DARK); cb.outline.set_linewidth(0.8)

# ---------- RODAPE HORIZONTAL de legenda ----------
handles = [
    Line2D([0], [0], color=C.RED, lw=2.4, label="Rede coletora"),
    Line2D([0], [0], marker="o", color="none", mfc="white", mec=C.RED, ms=6,
           label="Poços de visita"),
    Line2D([0], [0], color="#3A2E22", lw=1.0, label="Curva mestra (5 m)"),
    Line2D([0], [0], color="#5A4A3A", lw=0.6, alpha=0.6, label="Curva secundária (1 m)"),
]
C.footer_legend(fig, handles, ncol=4, map_ax=ax,
                extra_right=(f"COTAS: {zmin:.1f} – {zmax:.1f} m · Desnível {zmax-zmin:.1f} m\n"
                             f"{len(TOPO):,} pontos GNSS · griddata + IDW · ilum. NW 45°".replace(",", ".")))

C.credits(fig, fonte="Levantamento GNSS 2S — 10.035 pontos")

out = os.path.join(C.OUT, "Mapa4_Calor_Topografia.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER)
print("SAVED", out)
