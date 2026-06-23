# -*- coding: utf-8 -*-
"""Modelo Digital do Terreno em vista ISOMETRICA 3D — Relatorio Topografico 2S.

Self-contained (NAO depende do cartolib do memorial nem de shapefile).
Recebe os MESMOS pontos do TXT que o relatorio topografico ja usa (X,Y,Z),
exportados pelo gerador JS a partir de stats._pontos, e produz um PNG com a
superficie 3D interpolada (griddata cubico + IDW), cmap 'terrain' com
iluminacao (LightSource), EXAGERO VERTICAL 4x, colorbar de cotas, projecao
ortografica (aspecto isometrico) e faixa de titulo/rodape da identidade 2S.

Baseado no mapa6_3d.py validado (memorial), sem a rede/PVs drapeados — o
relatorio topografico nao tem rede coletora.

Uso (chamado por spawn a partir do gerador_relatorio.js):
    python mapa_3d_topo.py <pts_file> <out_png> <municipio> <uf>

<pts_file>: texto, 1 ponto por linha, "X Y Z" (E N Z, separados por espaco).
"""
import os
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401 (registra projection 3d)
from matplotlib.colors import LightSource, Normalize, ListedColormap
from matplotlib.patches import Rectangle
from matplotlib import cm
from scipy.interpolate import griddata
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter

# ---------------- identidade visual 2S ----------------
RED = "#A11312"
DARK = "#262626"
INK = "#1A1A1A"
GREY = "#555555"
PAPER = "#FBFAF7"
FS_TITLE = 16.0
FS_SUBT = 8.8
FS_AXIS = 7.6
FS_TICK = 7.2
FS_LEG = 8.2
FS_SMALL = 6.6

# ---------------- parametros ----------------
VERT_EXAG = 4.0          # exagero vertical (4x) — leitura do relevo
AZIM, ELEV = -62, 26     # vista isometrica (azimute / elevacao da camera)

# tipografia limpa (Arial -> DejaVu)
import matplotlib.font_manager as fm
_avail = {f.name for f in fm.fontManager.ttflist}
for _f in ("Arial", "Segoe UI", "Calibri", "DejaVu Sans"):
    if _f in _avail:
        plt.rcParams["font.family"] = _f
        break


def _load_logo():
    """Carrega a logo 2S do bundle do memorial, se existir."""
    candidatos = [
        os.path.join(os.path.dirname(__file__), "..", "assets", "logo-2s.png"),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..",
                     "scripts", "memorial", "assets", "logo-2s.png"),
    ]
    for c in candidatos:
        if os.path.exists(c):
            try:
                from PIL import Image
                im = np.asarray(Image.open(c).convert("RGBA"))
                ar = im.shape[1] / im.shape[0]
                return im, ar
            except Exception:
                return None, 1.0
    return None, 1.0


def title_block(fig, title, subtitle):
    BAR_Y, BAR_H = 0.945, 0.055
    fig.patches.append(Rectangle((0, BAR_Y), 1.0, BAR_H, transform=fig.transFigure,
                                 facecolor=DARK, edgecolor="none", zorder=2))
    fig.patches.append(Rectangle((0, BAR_Y - 0.0025), 1.0, 0.0028,
                                 transform=fig.transFigure, facecolor=RED,
                                 edgecolor="none", zorder=3))
    logo, ar = _load_logo()
    text_x = 0.018
    if logo is not None:
        fig_ar = fig.get_figwidth() / fig.get_figheight()
        lh = BAR_H * 0.70
        lw = lh * ar / fig_ar
        lx = 0.015
        ly = BAR_Y + (BAR_H - lh) / 2.0
        lax = fig.add_axes([lx, ly, lw, lh], zorder=5)
        lax.imshow(logo)
        lax.axis("off")
        text_x = lx + lw + 0.014
    else:
        fig.patches.append(Rectangle((0.015, BAR_Y + 0.008), 0.030, BAR_H - 0.016,
                                     transform=fig.transFigure, facecolor=RED,
                                     edgecolor="white", lw=1.0, zorder=5))
        fig.text(0.030, BAR_Y + BAR_H / 2, "2S", ha="center", va="center",
                 fontsize=15, fontweight="bold", color="white", zorder=6)
        text_x = 0.052
    fig.text(text_x, BAR_Y + BAR_H * 0.62, title, ha="left", va="center",
             fontsize=FS_TITLE, fontweight="bold", color="white", zorder=6)
    fig.text(text_x, BAR_Y + BAR_H * 0.27, subtitle, ha="left", va="center",
             fontsize=FS_SUBT, color="#E8C9C8", zorder=6)
    fig.text(0.982, BAR_Y + BAR_H * 0.62, "2S ENGENHARIA", ha="right", va="center",
             fontsize=11.5, fontweight="bold", color="white", zorder=6)
    fig.text(0.982, BAR_Y + BAR_H * 0.27, "AGRIMENSURA · GEOTECNOLOGIA", ha="right",
             va="center", fontsize=FS_SMALL - 0.2, color="#C9C9C9", zorder=6,
             fontweight="bold")


def credits(fig, fonte=""):
    fig.patches.append(Rectangle((0, 0.0), 1.0, 0.030, transform=fig.transFigure,
                                 facecolor="#F0EEE8", edgecolor="none", zorder=2))
    fig.patches.append(Rectangle((0, 0.030), 1.0, 0.0022, transform=fig.transFigure,
                                 facecolor=RED, edgecolor="none", zorder=3))
    fig.text(0.018, 0.011, "2S Engenharia e Geotecnologia", ha="left", va="bottom",
             fontsize=FS_SMALL + 0.4, color=RED, fontweight="bold", style="italic",
             zorder=4)
    mid = "SIRGAS 2000 / UTM 22S" + (("  ·  " + fonte) if fonte else "")
    fig.text(0.5, 0.011, mid, ha="center", va="bottom", fontsize=FS_SMALL,
             color=GREY, zorder=4)
    fig.text(0.982, 0.011, "Relatório Topográfico — Levantamento Planialtimétrico",
             ha="right", va="bottom", fontsize=FS_SMALL, color=GREY, zorder=4)


def carregar_pontos(path):
    """Le arquivo texto 'X Y Z' por linha -> array (N,3)."""
    pts = []
    with open(path, "r", encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln:
                continue
            parts = ln.replace(",", " ").split()
            if len(parts) < 3:
                continue
            try:
                x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
            except ValueError:
                continue
            pts.append((x, y, z))
    return np.asarray(pts, dtype=float)


def gerar(pts_file, out_png, municipio="", uf=""):
    TOPO = carregar_pontos(pts_file)
    if TOPO.shape[0] < 4:
        raise SystemExit("ERRO: pontos insuficientes para o MDT 3D (%d)" % TOPO.shape[0])
    X, Y, Z = TOPO[:, 0], TOPO[:, 1], TOPO[:, 2]

    pad = 10
    xmin, xmax = X.min() - pad, X.max() + pad
    ymin, ymax = Y.min() - pad, Y.max() + pad

    NX, NY = 420, 360
    gx = np.linspace(xmin, xmax, NX)
    gy = np.linspace(ymin, ymax, NY)
    GX, GY = np.meshgrid(gx, gy)

    print("interpolando %d pontos em grade %dx%d (3D)..." % (len(TOPO), NX, NY))
    Zc = griddata((X, Y), Z, (GX, GY), method="cubic")
    tree = cKDTree(np.c_[X, Y])
    flat = np.c_[GX.ravel(), GY.ravel()]
    d, idx = tree.query(flat, k=12)
    d = np.maximum(d, 1e-6)
    w = 1.0 / d ** 2
    Zidw = (np.sum(w * Z[idx], axis=1) / np.sum(w, axis=1)).reshape(GX.shape)
    Zg = np.where(np.isnan(Zc), Zidw, Zc)
    zlo_d, zhi_d = float(Z.min()), float(Z.max())
    Zg = np.clip(Zg, zlo_d, zhi_d)
    Zg = gaussian_filter(Zg, sigma=1.3)

    # mascara: esconde area sem dado (extrapolacao grosseira)
    dist0 = tree.query(flat, k=1)[0].reshape(GX.shape)
    # limite adaptativo ao espacamento medio entre pontos do levantamento
    span = max(xmax - xmin, ymax - ymin)
    lim = max(60.0, min(150.0, span / 25.0))
    MASK = dist0 > lim
    Zsurf = np.where(MASK, np.nan, Zg)

    zmin, zmax = zlo_d, zhi_d
    print("cotas:", round(zmin, 2), "a", round(zmax, 2),
          "| desnivel", round(zmax - zmin, 1), "m")

    # ---------------- cores + iluminacao ----------------
    _terr = plt.get_cmap("terrain")
    cmap = ListedColormap(_terr(np.linspace(0.30, 0.82, 256)))
    norm = Normalize(vmin=zmin, vmax=zmax)
    ls = LightSource(azdeg=315, altdeg=55)
    rgba = ls.shade(np.nan_to_num(Zg, nan=zmin), cmap=cmap, norm=norm,
                    blend_mode="soft", vert_exag=VERT_EXAG * 1.4,
                    dx=(xmax - xmin) / NX, dy=(ymax - ymin) / NY)
    rgba[..., 3] = np.where(MASK, 0.0, 1.0)

    # ---------------- figura ----------------
    fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
    fig.patch.set_facecolor(PAPER)
    loc = ("%s / %s" % (municipio, uf)).strip(" /")
    title_block(fig, "MODELO DIGITAL DO TERRENO — VISTA ISOMÉTRICA",
                ("Superfície 3D do levantamento planialtimétrico"
                 + (" — " + loc if loc else "")))

    _M = (0.02, 0.055, 0.90, 0.86)  # x0, y0, w, h (entre faixa e rodape)
    ax = fig.add_axes([_M[0], _M[1], _M[2], _M[3]], projection="3d")
    ax.set_facecolor(PAPER)
    ax.set_proj_type("ortho")

    Zplot = Zsurf * VERT_EXAG
    ax.plot_surface(GX, GY, Zplot, facecolors=rgba, rstride=1, cstride=1,
                    linewidth=0, antialiased=True, shade=False, zorder=2)

    ax.view_init(elev=ELEV, azim=AZIM)
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)
    OFF = (zmax - zmin) * 0.012 * VERT_EXAG
    ax.set_zlim(zmin * VERT_EXAG - OFF * 1.2, zmax * VERT_EXAG + OFF * 2.0)
    xr = xmax - xmin
    yr = ymax - ymin
    zr = (zmax - zmin) * VERT_EXAG
    ax.set_box_aspect((xr, yr, zr * 1.25), zoom=1.92)
    try:
        ax.margins(x=0, y=0, z=0)
    except Exception:
        pass

    zt = np.linspace(zmin, zmax, 5)
    ax.set_zticks(zt * VERT_EXAG)
    ax.set_zticklabels(["%.0f" % v for v in zt], fontsize=FS_TICK - 0.6, color=DARK)
    ax.set_zlabel("Cota (m)", fontsize=FS_AXIS - 0.4, color=GREY, labelpad=-2)
    ax.set_xticks(np.linspace(xmin, xmax, 4))
    ax.set_yticks(np.linspace(ymin, ymax, 4))
    ax.set_xticklabels(["{:,}".format(int(v)).replace(",", ".")
                        for v in np.linspace(xmin, xmax, 4)],
                       fontsize=FS_TICK - 1.2, color=GREY)
    ax.set_yticklabels(["{:,}".format(int(v)).replace(",", ".")
                        for v in np.linspace(ymin, ymax, 4)],
                       fontsize=FS_TICK - 1.2, color=GREY)
    ax.tick_params(axis="x", pad=-3)
    ax.tick_params(axis="y", pad=-3)
    ax.set_xlabel("E (m)", fontsize=FS_AXIS - 0.6, color=GREY, labelpad=-4)
    ax.set_ylabel("N (m)", fontsize=FS_AXIS - 0.6, color=GREY, labelpad=-4)

    ax.xaxis.pane.set_facecolor((1, 1, 1, 0.0))
    ax.yaxis.pane.set_facecolor((1, 1, 1, 0.0))
    ax.zaxis.pane.set_facecolor((0.96, 0.95, 0.92, 0.55))
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis._axinfo["grid"].update(color=(0.6, 0.6, 0.6, 0.25), linewidth=0.4)
        axis.line.set_color((0.4, 0.4, 0.4, 0.6))

    # ---------------- colorbar de cotas ----------------
    sm = cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    _CB_H = _M[3] * 0.55
    cax = fig.add_axes([_M[0] + _M[2] + 0.008, _M[1] + _M[3] * 0.30, 0.018, _CB_H])
    cb = fig.colorbar(sm, cax=cax)
    cb.set_label("Altitude (m) — cota ortométrica", fontsize=FS_LEG - 0.4, color=INK)
    cb.ax.tick_params(labelsize=FS_TICK - 0.6, color=GREY)
    cb.outline.set_edgecolor(DARK)
    cb.outline.set_linewidth(0.8)

    # ---------------- nota do exagero vertical (rodape) ----------------
    nota = ("EXAGERO VERTICAL %.0f× · Vista isométrica · Cotas %.1f–%.1f m · "
            "Desnível %.1f m · %s pts"
            % (VERT_EXAG, zmin, zmax, zmax - zmin,
               "{:,}".format(len(TOPO)).replace(",", ".")))
    fig.text(0.982, 0.038, nota, ha="right", va="bottom",
             fontsize=FS_LEG - 0.6, color=GREY, zorder=5)

    credits(fig, fonte="Levantamento GNSS RTK — %s pts"
            % "{:,}".format(len(TOPO)).replace(",", "."))

    fig.savefig(out_png, dpi=300, facecolor=PAPER)
    print("SAVED", out_png)
    return out_png


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("uso: python mapa_3d_topo.py <pts_file> <out_png> [municipio] [uf]")
        sys.exit(2)
    pts_file = sys.argv[1]
    out_png = sys.argv[2]
    municipio = sys.argv[3] if len(sys.argv) > 3 else ""
    uf = sys.argv[4] if len(sys.argv) > 4 else ""
    gerar(pts_file, out_png, municipio, uf)
