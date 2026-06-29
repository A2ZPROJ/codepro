# -*- coding: utf-8 -*-
"""MAPA 6 — Vista ISOMÉTRICA 3D do terreno da Bacia 02 (Amaporã/PR).
Superfície 3D interpolada dos 10.035 pontos GNSS (griddata cúbico + IDW),
cmap 'terrain' com iluminação (LightSource), EXAGERO VERTICAL aplicado, e a
REDE COLETORA projetada drapeada por cima da superfície (Z amostrado do MDT).
Vai logo abaixo do mapa hipsométrico (Mapa4) no memorial."""
import os, math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401 (registra projection 3d)
from matplotlib.colors import LightSource, Normalize
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from matplotlib import cm
from scipy.interpolate import griddata, RegularGridInterpolator
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter
import cartolib as C

# ---------------- parametros ----------------
VERT_EXAG = 4.0          # exagero vertical (4x) — escolhido p/ leitura do relevo
AZIM, ELEV = -62, 26     # vista isometrica (azimute / elevacao da camera)

# nome do municipio / sub-bacia (parametrico via env)
NOME_MUN = os.environ.get("MEMORIAL_MUNICIPIO", "Amaporã")
SUB_BACIA = os.environ.get("MEMORIAL_SUBBACIA", "Bacia 02")

# ---------------- dados ----------------
TOPO = np.load(C.ensure_topo_cache())   # (N,3) X,Y,Z
X, Y, Z = TOPO[:, 0], TOPO[:, 1], TOPO[:, 2]
rede_in = C.load_rede_amapora()
pvs = C.load_pvs_amapora()

# Enquadramento pela REDE do projeto (nao pela nuvem inteira de topografia) —
# aproxima do local do projeto e ignora os pontos de levantamento ao redor.
_rx = [v[0] for seg in rede_in for v in seg] + [p["x"] for p in pvs]
_ry = [v[1] for seg in rede_in for v in seg] + [p["y"] for p in pvs]
if _rx and _ry:
    pad = 150            # margem em volta da rede (m)
    xmin, xmax = min(_rx) - pad, max(_rx) + pad
    ymin, ymax = min(_ry) - pad, max(_ry) + pad
    # recorta a nuvem topografica ao enquadramento (interpola so o que importa)
    _m = (X >= xmin) & (X <= xmax) & (Y >= ymin) & (Y <= ymax)
    if _m.sum() >= 50:
        X, Y, Z = X[_m], Y[_m], Z[_m]
        TOPO = np.c_[X, Y, Z]
else:
    pad = 10
    xmin, xmax = X.min()-pad, X.max()+pad
    ymin, ymax = Y.min()-pad, Y.max()+pad

# ---------------- grade de interpolacao ----------------
NX, NY = 420, 360
gx = np.linspace(xmin, xmax, NX)
gy = np.linspace(ymin, ymax, NY)
GX, GY = np.meshgrid(gx, gy)

print(f"interpolando {len(TOPO)} pontos em grade {NX}x{NY} (3D)...")
Zc = griddata((X, Y), Z, (GX, GY), method="cubic")
tree = cKDTree(np.c_[X, Y])
flat = np.c_[GX.ravel(), GY.ravel()]
d, idx = tree.query(flat, k=12)
d = np.maximum(d, 1e-6)
w = 1.0 / d**2
Zidw = (np.sum(w * Z[idx], axis=1) / np.sum(w, axis=1)).reshape(GX.shape)
Zg = np.where(np.isnan(Zc), Zidw, Zc)
zlo_d, zhi_d = float(Z.min()), float(Z.max())
Zg = np.clip(Zg, zlo_d, zhi_d)
Zg = gaussian_filter(Zg, sigma=1.3)

# mascara: esconde area sem dado (extrapolacao grosseira) -> NaN na superficie.
# limite mais justo + leve erosao p/ borda limpa (sem "paredes"/picos artificiais)
dist0 = tree.query(flat, k=1)[0].reshape(GX.shape)
MASK = dist0 > 110.0
Zsurf = np.where(MASK, np.nan, Zg)

zmin, zmax = zlo_d, zhi_d
print("cotas:", round(zmin, 2), "a", round(zmax, 2), "| desnivel", round(zmax-zmin, 1), "m")

# ---------------- amostrador de cota p/ drapear a rede ----------------
interp = RegularGridInterpolator((gy, gx), Zg, bounds_error=False,
                                 fill_value=None, method="linear")
def z_at(px, py):
    return float(interp((py, px)))

# ---------------- cores + iluminacao da superficie ----------------
# cmap 'terrain' recortado (descarta o azul-agua das cotas baixas) p/ cores
# vivas de relevo (verde->ocre->branco)
from matplotlib.colors import ListedColormap
# faixa central do 'terrain' (verde -> ocre/marrom), descartando o azul-agua
# das cotas baixas e o branco-neve das altas -> cores de relevo saturadas
_terr = plt.get_cmap("terrain")
cmap = ListedColormap(_terr(np.linspace(0.30, 0.82, 256)))
norm = Normalize(vmin=zmin, vmax=zmax)
ls = LightSource(azdeg=315, altdeg=55)
# blend 'soft' mantem a cor hipsometrica viva + relevo sombreado discreto
rgba = ls.shade(np.nan_to_num(Zg, nan=zmin), cmap=cmap, norm=norm,
                blend_mode="soft", vert_exag=VERT_EXAG*1.4,
                dx=(xmax-xmin)/NX, dy=(ymax-ymin)/NY)
# shade() ja devolve RGBA (NY,NX,4); aplica transparencia onde nao ha dado
rgba[..., 3] = np.where(MASK, 0.0, 1.0)

# ---------------- figura ----------------
fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "MODELO 3D DO TERRENO — %s" % SUB_BACIA.upper(),
              "Vista isométrica do relevo (%s pontos GNSS) e rede coletora — %s / PR"
              % ("{:,}".format(len(TOPO)).replace(",", "."), NOME_MUN))

# area do mapa 3D: ocupa quase toda a largura/altura acima do RODAPE -> ZOOM
_M = C.map_axes_rect(x0=0.02, w=0.90)
ax = fig.add_axes([_M[0], _M[1], _M[2], _M[3]], projection="3d")
ax.set_facecolor(C.PAPER)
ax.set_proj_type("ortho")     # projecao ortografica = aspecto isometrico real

# superficie 3D (malha cheia p/ maxima nitidez)
Zplot = Zsurf * VERT_EXAG
surf = ax.plot_surface(GX, GY, Zplot, facecolors=rgba, rstride=1, cstride=1,
                       linewidth=0, antialiased=True, shade=False, zorder=2)

# ---- rede coletora drapeada por cima da superficie (+ pequeno offset visual) ----
OFF = (zmax - zmin) * 0.012 * VERT_EXAG   # leve elevacao p/ nao "afundar" na malha
for seg in rede_in:
    xs = [p[0] for p in seg]; ys = [p[1] for p in seg]
    zs = [z_at(x, y)*VERT_EXAG + OFF for x, y in zip(xs, ys)]
    ax.plot(xs, ys, zs, color="white", lw=2.4, zorder=6, solid_capstyle="round")
    ax.plot(xs, ys, zs, color=C.RED, lw=1.2, zorder=7, solid_capstyle="round")

# PVs (pequenos pontos sobre a superficie)
pxs = [p["x"] for p in pvs]; pys = [p["y"] for p in pvs]
pzs = [z_at(x, y)*VERT_EXAG + OFF*1.2 for x, y in zip(pxs, pys)]
ax.scatter(pxs, pys, pzs, s=5, c="white", edgecolors=C.RED, linewidths=0.4,
           depthshade=False, zorder=8)

# ---- camera / aparencia isometrica ----
ax.view_init(elev=ELEV, azim=AZIM)
ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax)
# Z bem justo ao relevo (pouca folga) -> menos caixa vazia, terreno maior
ax.set_zlim(zmin*VERT_EXAG - OFF*1.2, zmax*VERT_EXAG + OFF*2.0)
# aspecto: X,Y reais; Z ja exagerado por VERT_EXAG -> caixa proporcional, com
# realce moderado no eixo Z p/ leitura do relevo sem caixa "vazia".
# zoom>1 APROXIMA a camera -> superficie preenche o quadro (mais ZOOM).
xr = xmax-xmin; yr = ymax-ymin; zr = (zmax-zmin)*VERT_EXAG
ax.set_box_aspect((xr, yr, zr*1.25), zoom=1.92)
# elimina folga interna do mpl3d em volta dos dados
try:
    ax.margins(x=0, y=0, z=0)
except Exception:
    pass

# eixo Z = cotas reais (rotulado com valor original, nao exagerado)
zt = np.linspace(zmin, zmax, 5)
ax.set_zticks(zt*VERT_EXAG)
ax.set_zticklabels([f"{v:.0f}" for v in zt], fontsize=C.FS_TICK-0.6, color=C.DARK)
ax.set_zlabel("Cota (m)", fontsize=C.FS_AXIS-0.4, color=C.GREY, labelpad=-2)
# ticks X/Y discretos e enxutos
ax.set_xticks(np.linspace(xmin, xmax, 4))
ax.set_yticks(np.linspace(ymin, ymax, 4))
ax.set_xticklabels([f"{int(v):,}".replace(",", ".") for v in np.linspace(xmin, xmax, 4)],
                   fontsize=C.FS_TICK-1.2, color=C.GREY)
ax.set_yticklabels([f"{int(v):,}".replace(",", ".") for v in np.linspace(ymin, ymax, 4)],
                   fontsize=C.FS_TICK-1.2, color=C.GREY)
ax.tick_params(axis="x", pad=-3); ax.tick_params(axis="y", pad=-3)
ax.set_xlabel("E (m)", fontsize=C.FS_AXIS-0.6, color=C.GREY, labelpad=-4)
ax.set_ylabel("N (m)", fontsize=C.FS_AXIS-0.6, color=C.GREY, labelpad=-4)

# paineis e grade 3D discretos
ax.xaxis.pane.set_facecolor((1, 1, 1, 0.0))
ax.yaxis.pane.set_facecolor((1, 1, 1, 0.0))
ax.zaxis.pane.set_facecolor((0.96, 0.95, 0.92, 0.55))
for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
    axis._axinfo["grid"].update(color=(0.6, 0.6, 0.6, 0.25), linewidth=0.4)
    axis.line.set_color((0.4, 0.4, 0.4, 0.6))

# ---------------- colorbar de cotas (à direita, dentro da zona do mapa) ------
sm = cm.ScalarMappable(cmap=cmap, norm=norm); sm.set_array([])
_CB_H = _M[3] * 0.55
cax = fig.add_axes([_M[0] + _M[2] + 0.008, _M[1] + _M[3]*0.30, 0.018, _CB_H])
cb = fig.colorbar(sm, cax=cax)
cb.set_label("Altitude (m) — cota ortométrica", fontsize=C.FS_LEG-0.4, color=C.INK)
cb.ax.tick_params(labelsize=C.FS_TICK-0.6, color=C.GREY)
cb.outline.set_edgecolor(C.DARK); cb.outline.set_linewidth(0.8)

# ---------------- RODAPE HORIZONTAL de legenda ----------------
handles = [
    Line2D([0], [0], color=C.RED, lw=2.4, label="Rede coletora (drapeada)"),
    Line2D([0], [0], marker="o", color="none", mfc="white", mec=C.RED, ms=6,
           label="Poços de visita"),
]
C.footer_legend(fig, handles, ncol=2,
                extra_right=(f"EXAGERO VERTICAL {VERT_EXAG:.0f}× · Vista isométrica\n"
                             f"Cotas {zmin:.1f}–{zmax:.1f} m · Desnível {zmax-zmin:.1f} m · "
                             f"{len(TOPO):,} pts GNSS".replace(",", ".")))

C.credits(fig, fonte="Levantamento GNSS 2S — %s pontos"
          % ("{:,}".format(len(TOPO)).replace(",", ".")))

out = os.path.join(C.OUT, "Mapa6_3D_Topografia.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER)
print("SAVED", out)
