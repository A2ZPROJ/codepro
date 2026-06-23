# -*- coding: utf-8 -*-
"""MAPA 3 — Classificação das soleiras (atendidas x não atendidas)."""
import os, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly, Rectangle
from matplotlib.lines import Line2D
import cartolib as C

rede_in = C.load_rede_amapora()
pvs = C.load_pvs_amapora()
pos_all, neg_all = C.load_soleiras_amapora()

# ---- footprint da BACIA 02 = envoltoria da rede + PVs (NAO das soleiras) ----
rede_xy = [(p["x"], p["y"]) for p in pvs] + [v for seg in rede_in for v in seg]
hull = C.convex_hull(rede_xy)
# distancia maxima de atendimento por gravidade desde um coletor da bacia.
# soleira atendivel fica a poucas dezenas de metros do coletor da sua rua.
SERVE_BUF = 90.0            # m — folga p/ profundidade de lote/quadra
hull_serve = C.buffer_hull(hull, SERVE_BUF)

def _pt_in_poly(px, py, poly):
    inside = False
    n = len(poly); j = n-1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj-xi)*(py-yi)/((yj-yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def _dist_to_rede(px, py):
    """menor distancia do ponto a qualquer trecho da rede (segmentos)."""
    best = 1e18
    for seg in rede_in:
        for k in range(len(seg)-1):
            ax_, ay_ = seg[k]; bx_, by_ = seg[k+1]
            dx, dy = bx_-ax_, by_-ay_
            L2 = dx*dx + dy*dy
            if L2 == 0:
                d = math.hypot(px-ax_, py-ay_)
            else:
                t = max(0.0, min(1.0, ((px-ax_)*dx + (py-ay_)*dy)/L2))
                cx, cy = ax_+t*dx, ay_+t*dy
                d = math.hypot(px-cx, py-cy)
            if d < best:
                best = d
    return best

def _keep(x, y):
    # dentro da envoltoria de atendimento OU a <=SERVE_BUF de um coletor
    return _pt_in_poly(x, y, hull_serve) or _dist_to_rede(x, y) <= SERVE_BUF

pos = [(x, y, r) for (x, y, r) in pos_all if _keep(x, y)]
neg = [(x, y, r) for (x, y, r) in neg_all if _keep(x, y)]

print("soleiras TOTAIS no CSV: positivas", len(pos_all), "negativas", len(neg_all),
      "=", len(pos_all)+len(neg_all))
print("soleiras NA BACIA 02 : positivas", len(pos), "negativas", len(neg),
      "=", len(pos)+len(neg),
      "| descartadas (fora da bacia):", (len(pos_all)+len(neg_all))-(len(pos)+len(neg)))

# enquadramento pelo footprint da rede (nao pela nuvem inteira de soleiras)
hull_buf = C.buffer_hull(hull, 130)
hx = [p[0] for p in hull_buf]; hy = [p[1] for p in hull_buf]
bx0, bx1 = min(hx), max(hx); by0, by1 = min(hy), max(hy)
mx = (bx1-bx0)*0.05; my = (by1-by0)*0.05
xmin, xmax = bx0-mx, bx1+mx; ymin, ymax = by0-my, by1+my

fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "CLASSIFICAÇÃO DAS SOLEIRAS — BACIA 02",
              "Imóveis atendidos x não atendidos por gravidade — Amaporã / PR")

ax = fig.add_axes(C.map_axes_rect())
ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax); ax.set_aspect("equal")

bm = C.add_basemap(ax, "Esri World Imagery", provider="imagery")
if bm is None:
    ax.set_facecolor("#3A4A3A")

# limite da bacia
ax.add_patch(MplPoly(C.buffer_hull(hull, 70), closed=True, facecolor="none",
             edgecolor="white", lw=2.8, alpha=0.5, zorder=4))
ax.add_patch(MplPoly(C.buffer_hull(hull, 70), closed=True, facecolor="none",
             edgecolor=C.RED, lw=1.6, ls=(0, (7, 4)), zorder=5))

# rede de contexto (fina, casing)
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color="white", lw=1.4, alpha=0.55, zorder=6)
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    ax.plot(xs, ys, color="#FFCC00", lw=0.7, alpha=0.95, zorder=7)

# soleiras: positivas (verde, pequeno) e negativas (vermelho, triângulo destacado + halo)
if pos:
    ax.scatter([x for x, y, _ in pos], [y for x, y, _ in pos], s=11,
               c="#28A745", edgecolors="white", linewidths=0.25, zorder=8)
if neg:
    nx = [x for x, y, _ in neg]; ny = [y for x, y, _ in neg]
    ax.scatter(nx, ny, s=130, facecolors="none", edgecolors="#FFE000",
               linewidths=1.4, zorder=9)  # halo de destaque
    ax.scatter(nx, ny, s=55, c=C.RED, marker="v", edgecolors="white",
               linewidths=0.7, zorder=10)

C.utm_grid(ax, xmin, xmax, ymin, ymax, grid_color="white", grid_alpha=0.20)
C.frame(ax)
C.north_arrow(ax)                                   # canto superior esquerdo
C.scale_bar(ax, xmin, xmax, ymin, ymax, frac=0.26, loc="lower left")

# ---- RODAPE HORIZONTAL de legenda ----
ntot = len(pos)+len(neg)
idx = round(100.0*len(pos)/ntot, 1) if ntot else 0
handles = [
    Line2D([0], [0], marker="o", color="none", mfc="#28A745", mec="white",
           ms=8, label=f"Atendida — positiva ({len(pos)})"),
    Line2D([0], [0], marker="v", color="none", mfc=C.RED, mec="white",
           ms=9, label=f"Não atendida — negativa ({len(neg)})"),
    Line2D([0], [0], color="#FFCC00", lw=2.2, label="Rede coletora — Bacia 02"),
    Line2D([0], [0], color=C.RED, lw=2.0, ls=(0, (6, 3)), label="Limite da Bacia 02"),
]
C.footer_legend(fig, handles, ncol=4, map_ax=ax,
                extra_right=(f"ÍNDICE DE ATENDIMENTO: {idx}%\n"
                             f"Soleiras Bacia 02: {ntot} (pos {len(pos)} / neg {len(neg)})"))

src_txt = ("Imagem de fundo: Esri World Imagery" if bm else "Fundo: sem imagem (offline)")
C.credits(fig, fonte=src_txt + "  ·  Levantamento 2S")

out = os.path.join(C.OUT, "Mapa3_Soleiras_SB02.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER)
print("SAVED", out, "| basemap:", bm)
