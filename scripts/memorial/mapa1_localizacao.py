# -*- coding: utf-8 -*-
"""MAPA 1 — Localização profissional de Amaporã/PR.
Painel principal: Amaporã + municípios limítrofes nomeados, sede urbana,
área de estudo (Bacia 02). Insets: Brasil(PR) e PR(Amaporã)."""
import json, os, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly, Rectangle, Circle
from matplotlib import patheffects as pe
import cartolib as C

IBGE_AMAPORA = C.IBGE   # parametrico (env MEMORIAL_IBGE); default Amapora 4100905
_neigh_path = os.path.join(C.CACHE, "nomes_vizinhos.json")
NEIGH = (json.load(open(_neigh_path, encoding="utf-8"))
         if os.path.exists(_neigh_path) else {})
# nome do municipio (parametrico via env) p/ titulos/legenda/rotulos
NOME_MUN = os.environ.get("MEMORIAL_MUNICIPIO", "Amaporã")
SUB_BACIA = os.environ.get("MEMORIAL_SUBBACIA", "Bacia 02")

def load_geom(fn):
    d = json.load(open(os.path.join(C.CACHE, fn)))
    feats = {}
    for f in d["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        code = f.get("properties", {}).get("codarea")
        feats[code] = feats.get(code, []) + polys
    return feats

def rings_of(polys):
    return [poly[0] for poly in polys]

def draw(ax, polys, fc, ec, lw, alpha=1.0, z=1, ls="solid"):
    for poly in polys:
        ax.add_patch(MplPoly(poly[0], closed=True, facecolor=fc, edgecolor=ec,
                             lw=lw, alpha=alpha, zorder=z, ls=ls))

def centroid(polys):
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    return sum(xs)/len(xs), sum(ys)/len(ys)

def bbox(polys):
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)

def utm_to_ll(e, n):
    try:
        from pyproj import Transformer
        t = Transformer.from_crs("EPSG:31982", "EPSG:4674", always_xy=True)
        return t.transform(e, n)
    except Exception:
        return (-52.79, -23.10)

# centroide da rede (sede urbana / área de estudo) em lon/lat
pvs = C.load_pvs_amapora()
SB_E = sum(p["x"] for p in pvs)/len(pvs)
SB_N = sum(p["y"] for p in pvs)/len(pvs)
lon, lat = utm_to_ll(SB_E, SB_N)

munis = load_geom("munis_pr_inter.geojson")
muni_am = munis[IBGE_AMAPORA]

# ----- figura A4 paisagem -----
fig = plt.figure(figsize=(11.69, 8.27), dpi=300)
fig.patch.set_facecolor(C.PAPER)
C.title_block(fig, "MAPA DE LOCALIZAÇÃO",
              "Município de %s e municípios limítrofes — Estado do Paraná" % NOME_MUN)

# ---- painel principal (coordenadas geograficas SIRGAS 2000 — lon/lat) ----
import numpy as np
from matplotlib.lines import Line2D
ax = fig.add_axes(C.map_axes_rect(x0=0.045, w=0.585))
ax.set_facecolor("#DCE6EC")
mb = bbox(muni_am)
pad = max(mb[2]-mb[0], mb[3]-mb[1]) * 0.40
ax.set_xlim(mb[0]-pad, mb[2]+pad); ax.set_ylim(mb[1]-pad, mb[3]+pad)
xlim = ax.get_xlim(); ylim = ax.get_ylim()
amc = centroid(muni_am)

# basemap de relevo sombreado (contexto fisico) — Esri World Shaded Relief
try:
    import contextily as cx
    cx.add_basemap(ax, crs="EPSG:4674", attribution=False,
                   source=cx.providers.Esri.WorldShadedRelief)
    BM1 = "Esri World Shaded Relief"
except Exception as e:
    print("  basemap1 fail:", e); BM1 = None

# vizinhos: preenchimento translucido p/ relevo aparecer + contorno definido
for code, polys in munis.items():
    if code == IBGE_AMAPORA:
        continue
    bx = bbox(polys)
    if bx[2] < xlim[0] or bx[0] > xlim[1] or bx[3] < ylim[0] or bx[1] > ylim[1]:
        continue
    fc = (1, 1, 1, 0.18) if code in NEIGH else (1, 1, 1, 0.30)
    draw(ax, polys, fc, "#6E6A60", 0.8, z=3)

# nomes dos limítrofes (clamp p/ dentro da janela, halo branco)
for code in NEIGH:
    if code == IBGE_AMAPORA:
        continue
    polys = munis.get(code)
    if not polys:
        continue
    cx_, cy_ = centroid(polys)
    cx_ = min(max(cx_, xlim[0]+pad*0.18), xlim[1]-pad*0.18)
    cy_ = min(max(cy_, ylim[0]+pad*0.18), ylim[1]-pad*0.18)
    ax.text(cx_, cy_, NEIGH[code].upper(), ha="center", va="center",
            fontsize=C.FS_BODY, color=C.DARK, fontweight="bold", zorder=7,
            path_effects=[pe.withStroke(linewidth=2.8, foreground="white")])

# Amaporã destacado (preenchimento vermelho translucido + contorno forte)
draw(ax, muni_am, (0.63, 0.075, 0.071, 0.30), C.RED, 2.8, z=5)
draw(ax, muni_am, "none", C.RED_D, 1.0, z=6)
ax.text(amc[0], mb[3]+(mb[3]-mb[1])*0.05, NOME_MUN.upper(), ha="center", va="bottom",
        fontsize=13, fontweight="bold", color=C.RED, zorder=8,
        path_effects=[pe.withStroke(linewidth=3.2, foreground="white")])

# sede urbana / área de estudo (estrela)
sx, sy = lon, lat
ax.plot(sx, sy, marker="*", color="#FFD400", ms=22, mec=C.DARK, mew=1.0, zorder=11)
ax.annotate("Sede urbana\nÁrea de estudo — %s" % SUB_BACIA, (sx, sy),
            xytext=(30, 26), textcoords="offset points", fontsize=C.FS_BODY,
            fontweight="bold", color=C.INK, zorder=12,
            bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C.RED, lw=1.3, alpha=0.97),
            arrowprops=dict(arrowstyle="-|>", color=C.RED, lw=1.8,
                            connectionstyle="arc3,rad=0.15"))

# graticula geografica (lon/lat) limpa — substitui a "UTM" no locator
def _geo_grid(ax, xlim, ylim):
    def nice(span):
        for s in (0.05, 0.1, 0.2, 0.25, 0.5, 1.0):
            if span/s <= 6:
                return s
        return 2.0
    sx_ = nice(xlim[1]-xlim[0]); sy_ = nice(ylim[1]-ylim[0])
    xt = np.arange(np.ceil(xlim[0]/sx_)*sx_, xlim[1], sx_)
    yt = np.arange(np.ceil(ylim[0]/sy_)*sy_, ylim[1], sy_)
    ax.set_xticks(xt); ax.set_yticks(yt)
    ax.set_xticklabels([f"{abs(v):.2f}°{'W' if v<0 else 'E'}" for v in xt],
                       fontsize=C.FS_TICK, color=C.DARK)
    ax.set_yticklabels([f"{abs(v):.2f}°{'S' if v<0 else 'N'}" for v in yt],
                       fontsize=C.FS_TICK, color=C.DARK, rotation=90, va="center")
    ax.grid(True, color="white", alpha=0.45, lw=0.5, zorder=4)
    ax.tick_params(length=4, width=0.8, color=C.DARK, direction="in",
                   top=True, right=True, pad=3)
    ax.set_xlabel("Longitude — SIRGAS 2000", fontsize=C.FS_AXIS, color=C.GREY)
    ax.set_ylabel("Latitude — SIRGAS 2000", fontsize=C.FS_AXIS, color=C.GREY)
_geo_grid(ax, xlim, ylim)
ax.set_aspect(1.0/np.cos(np.radians(amc[1])))   # aspecto geografico correto
C.frame(ax)
C.north_arrow(ax)                                   # canto superior esquerdo

# legenda -> vai pro RODAPE horizontal (definido mais abaixo, apos os insets)
leg_h = [
    Line2D([0], [0], marker="s", color="none", mfc=(0.63,0.075,0.071,0.55),
           mec=C.RED, ms=10, label="Município de %s" % NOME_MUN),
    Line2D([0], [0], marker="s", color="none", mfc=(1,1,1,0.5),
           mec="#6E6A60", ms=10, label="Municípios limítrofes"),
    Line2D([0], [0], marker="*", color="none", mfc="#FFD400", mec=C.DARK,
           ms=13, label="Sede / Área de estudo (%s)" % SUB_BACIA),
]

# escala grafica em km (lon->m via cos(lat)) — canto inferior, separada da legenda
def _geo_scalebar(ax, xlim, ylim, lat0):
    m_per_deg = 111320.0 * np.cos(np.radians(lat0))
    span_m = (xlim[1]-xlim[0]) * m_per_deg
    raw = span_m * 0.28
    nice = [1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000]
    Lm = min(nice, key=lambda v: abs(v-raw))
    Ldeg = Lm / m_per_deg
    n = 4; seg = Ldeg/n
    # ancorar no centro-baixo (entre legenda esq e datum dir)
    x0 = (xlim[0]+xlim[1])/2 - Ldeg/2
    h = (ylim[1]-ylim[0])*0.012
    y0 = ylim[0] + (ylim[1]-ylim[0])*0.055
    pad = seg*0.3
    from matplotlib.patches import Rectangle as _R
    ax.add_patch(_R((x0-pad, y0-h*1.6), Ldeg+2*pad, h*5.4, fc="white",
                    ec=C.GREY, lw=0.6, alpha=0.93, zorder=24))
    for i in range(n):
        c = C.DARK if i % 2 == 0 else "white"
        ax.add_patch(_R((x0+i*seg, y0), seg, h, fc=c, ec=C.DARK, lw=0.7, zorder=25))
    for i in range(n+1):
        ax.text(x0+i*seg, y0+h*1.6, f"{int(seg*i*m_per_deg/1000*100)/100:g}",
                ha="center", va="bottom", fontsize=C.FS_SCALE-0.6, color=C.DARK, zorder=26)
    ax.text(x0+Ldeg+pad*0.5, y0+h*0.5, "km", ha="left", va="center",
            fontsize=C.FS_SCALE, color=C.DARK, fontweight="bold", zorder=26)
    ax.text(x0+Ldeg/2, y0-h*0.9, "ESCALA GRÁFICA", ha="center", va="top",
            fontsize=C.FS_SMALL-0.3, color=C.GREY, fontweight="bold", zorder=26)
_geo_scalebar(ax, xlim, ylim, amc[1])

C.datum_box(ax, title="REFERÊNCIA", corner="lower right",
            extra="Fonte: Malha Municipal\nIBGE 2023 — cód. " + IBGE_AMAPORA)

# ---- inset 1: Brasil c/ PR ----
axb = fig.add_axes([0.665, 0.565, 0.31, 0.365])
axb.set_facecolor("#EAF1F4")
br = load_geom("br_paises.geojson")
pr = load_geom("pr_41.geojson")
for polys in br.values():
    draw(axb, polys, "#ECEAE3", "#A9A399", 0.5, z=1)
for polys in pr.values():
    draw(axb, polys, C.RED, C.RED_D, 0.8, z=3)
axb.set_xlim(-74.2, -33.8); axb.set_ylim(-34, 6)
axb.set_aspect("equal")
for s in axb.spines.values():
    s.set_edgecolor(C.DARK); s.set_linewidth(1.0)
axb.set_xticks([]); axb.set_yticks([])
axb.set_title("BRASIL  ·  destaque Paraná", fontsize=8.5, color=C.DARK,
              fontweight="bold", pad=5)

# ---- inset 2: PR c/ Amaporã ----
axp = fig.add_axes([0.665, 0.198, 0.31, 0.345])
axp.set_facecolor("#EAF1F4")
allpr = load_geom("munis_pr_inter.geojson")
for code, polys in allpr.items():
    draw(axp, polys, "#F1F0EB", "#CFCABF", 0.25, z=1)
for polys in pr.values():
    draw(axp, polys, "none", C.DARK, 1.1, z=3)
draw(axp, muni_am, C.RED, C.RED_D, 0.9, z=4)
# limites do PR (lon/lat aproximados do estado)
axp.set_xlim(-54.7, -48.0); axp.set_ylim(-26.8, -22.4)
# seta apontando Amaporã
amc_ll = utm_to_ll(*amc)
axp.annotate(NOME_MUN.upper(), amc_ll, xytext=(amc_ll[0]+1.6, amc_ll[1]+1.4),
             fontsize=8, fontweight="bold", color=C.RED, zorder=6,
             path_effects=[pe.withStroke(linewidth=2.5, foreground="white")],
             arrowprops=dict(arrowstyle="-|>", color=C.RED, lw=1.6))
axp.set_aspect("equal")
for s in axp.spines.values():
    s.set_edgecolor(C.DARK); s.set_linewidth(1.0)
axp.set_xticks([]); axp.set_yticks([])
axp.set_title("PARANÁ  ·  localização do município", fontsize=8.5,
              color=C.DARK, fontweight="bold", pad=5)

# ---- RODAPE HORIZONTAL de legenda ----
C.footer_legend(fig, leg_h, ncol=3,
                extra_right=("REFERÊNCIA ESPACIAL\n"
                             "SIRGAS 2000 · Geográficas · IBGE 2023"))

C.credits(fig, fonte="Base: IBGE — Malhas Territoriais 2023")
out = os.path.join(C.OUT, "Mapa1_Localizacao.png")
fig.savefig(out, dpi=300, facecolor=C.PAPER, bbox_inches=None)
print("SAVED", out)
