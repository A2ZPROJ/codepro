# -*- coding: utf-8 -*-
"""Aplica/remove a ONDULAÇÃO GEOIDAL (N) nas cotas de um TXT de levantamento.

    H (ortométrica) = h (elipsoidal (GNSS)) − N

Lê a grade OFICIAL do IBGE em texto ("lon lat N", lon em 0–360):
  · MAPGEO2015 : "C:\\Program Files (x86)\\MAPGEO2015 v1.0\\Grid\\MAPGEO2015_SIRGAS2000.txt"
  · hgeoHNOR2020: grade do IBGE (sucessor oficial, mais preciso) — mesmo formato
Interpolação BILINEAR (igual ao interpolador do IBGE).

Detecta os 2 layouts de TXT que a 2S usa (ver reference_topografia_simbologia_blocos_acciona):
  CHC       : id, DESCRIÇÃO, NORTE(Y), ESTE(X), COTA(Z), ...   (código na 2ª coluna)
  EMISSÁRIO : id, ESTE(X), NORTE(Y), COTA(Z), DESCRIÇÃO       (5 colunas)
Preserva TODAS as demais colunas e o nº de casas decimais do Z original.

Uso:
  py corrigir_geoide.py <arquivo_ou_pasta> [--grade <txt>] [--somar] [--sufixo _ORTO] [--dry]
    --somar   inverte (H -> h, ou seja soma N). Padrão é SUBTRAIR (h -> H).
    --dry     só mostra o que faria, não grava.
"""
import sys, os, glob, argparse, bisect

MAPGEO = r"C:\Program Files (x86)\MAPGEO2015 v1.0\Grid\MAPGEO2015_SIRGAS2000.txt"

# ---------------- grade ----------------
class Grade:
    """Aceita 2 formatos do IBGE:
    · TXT  (MAPGEO2015_SIRGAS2000.txt): 'lon lat N' por linha, lon em 0–360.
    · GSF  (hgeoHNOR2020 'HNORMAL 2020.gsf'): header de 6 linhas
           [lat_min, lon_min, lat_max, lon_max, n_div_lon, n_div_lat]
           + 1 valor por linha, varrendo lat CRESCENTE e, dentro da linha, lon crescente.
           ⚠ Linhas com 'N' = SEM DADO — têm de manter a posição no vetor, senão
             a grade inteira desalinha (são 32 no arquivo oficial).
    """
    def __init__(self, path):
        self.path = path
        if path.lower().endswith(".gsf"):
            self._load_gsf(path)
        else:
            self._load_txt(path)

    def _load_txt(self, path):
        pts = {}; lons, lats = set(), set()
        with open(path, encoding="latin-1", errors="replace") as f:
            for ln in f:
                p = ln.split()
                if len(p) < 3: continue
                try: lo, la, n = float(p[0]), float(p[1]), float(p[2])
                except ValueError: continue
                if lo > 180: lo -= 360.0        # grade vem em 0–360
                lo = round(lo, 7); la = round(la, 7)
                pts[(lo, la)] = n; lons.add(lo); lats.add(la)
        if not pts: raise SystemExit(f"Grade vazia/ilegível: {path}")
        self.modo = "txt"; self.pts = pts
        self.lons = sorted(lons); self.lats = sorted(lats)

    def _load_gsf(self, path):
        with open(path, encoding="latin-1", errors="replace") as f:
            h = [f.readline().strip() for _ in range(6)]
            self.lat0, self.lon0 = float(h[0]), float(h[1])
            self.lat1, self.lon1 = float(h[2]), float(h[3])
            ndlon, ndlat = int(h[4]), int(h[5])
            self.NC, self.NR = ndlon + 1, ndlat + 1
            self.dlon = (self.lon1 - self.lon0) / ndlon
            self.dlat = (self.lat1 - self.lat0) / ndlat
            v = []
            for ln in f:
                s = ln.strip()
                if s == "": continue
                try: v.append(float(s))
                except ValueError: v.append(None)     # 'N' = sem dado (mantém posição!)
        esperado = self.NC * self.NR
        if len(v) != esperado:
            raise SystemExit(f"GSF inconsistente: {len(v)} valores, esperado {esperado}")
        self.modo = "gsf"; self.v = v
        self.pts = v            # só p/ contagem no log
        self.lons = [self.lon0, self.lon1]; self.lats = [self.lat0, self.lat1]

    def _gsf_val(self, i, j):
        if i < 0 or i >= self.NC or j < 0 or j >= self.NR: return None
        return self.v[j * self.NC + i]

    def N(self, lon, lat):
        """Ondulação por interpolação BILINEAR. None = fora da grade / sem dado."""
        if self.modo == "gsf":
            fi = (lon - self.lon0) / self.dlon
            fj = (lat - self.lat0) / self.dlat
            i, j = int(fi), int(fj)
            q11 = self._gsf_val(i, j);     q21 = self._gsf_val(i+1, j)
            q12 = self._gsf_val(i, j+1);   q22 = self._gsf_val(i+1, j+1)
            if None in (q11, q21, q12, q22): return None
            tx, ty = fi - i, fj - j
            return q11*(1-tx)*(1-ty) + q21*tx*(1-ty) + q12*(1-tx)*ty + q22*tx*ty
        lons, lats, pts = self.lons, self.lats, self.pts
        i = bisect.bisect_left(lons, lon)
        j = bisect.bisect_left(lats, lat)
        if i <= 0 or i >= len(lons) or j <= 0 or j >= len(lats): return None
        x0, x1 = lons[i-1], lons[i]; y0, y1 = lats[j-1], lats[j]
        try:
            q11 = pts[(x0, y0)]; q21 = pts[(x1, y0)]
            q12 = pts[(x0, y1)]; q22 = pts[(x1, y1)]
        except KeyError: return None
        tx = (lon - x0) / (x1 - x0) if x1 != x0 else 0.0
        ty = (lat - y0) / (y1 - y0) if y1 != y0 else 0.0
        return (q11*(1-tx)*(1-ty) + q21*tx*(1-ty) + q12*(1-tx)*ty + q22*tx*ty)

# ---------------- utm -> latlon ----------------
def make_utm2ll(zone=22, south=True):
    from pyproj import Transformer
    epsg = 31982 if (zone == 22 and south) else None    # SIRGAS 2000 / UTM 22S
    src = f"EPSG:{epsg}" if epsg else f"+proj=utm +zone={zone} +{'south' if south else 'north'} +ellps=GRS80"
    tr = Transformer.from_crs(src, "EPSG:4674", always_xy=True)   # SIRGAS 2000 geográficas
    return lambda e, n: tr.transform(e, n)               # -> (lon, lat)

# ---------------- txt ----------------
def ehnum(s):
    try: float(s); return True
    except Exception: return False

def campos(p):
    """Devolve (idx_E, idx_N, idx_Z) conforme o layout, ou None."""
    if len(p) < 5: return None
    if ehnum(p[1]) and not ehnum(p[4]):
        return (1, 2, 3)          # EMISSARIO: id,E,N,Z,desc
    return (3, 2, 4)              # CHC: id,desc,N,E,Z,...

def casas(s):
    s = s.strip()
    return len(s.split(".")[1]) if "." in s else 0

def processar(arq, grade, u2ll, somar=False, sufixo="_ORTO", dry=False):
    linhas_out = []
    n_ok = n_skip = 0
    Ns = []
    with open(arq, encoding="utf-8", errors="replace") as f:
        for ln in f:
            raw = ln.rstrip("\n").rstrip("\r")
            p = raw.split(",")
            idx = campos(p)
            if idx is None:
                linhas_out.append(raw); continue
            iE, iN, iZ = idx
            try:
                E = float(p[iE]); Nn = float(p[iN]); Z = float(p[iZ])
            except ValueError:
                linhas_out.append(raw); n_skip += 1; continue
            lon, lat = u2ll(E, Nn)
            ond = grade.N(lon, lat)
            if ond is None:
                linhas_out.append(raw); n_skip += 1; continue
            Zc = Z + ond if somar else Z - ond
            p[iZ] = f"%.{casas(p[iZ])}f" % Zc
            linhas_out.append(",".join(p))
            Ns.append(ond); n_ok += 1
    base, ext = os.path.splitext(arq)
    saida = base + sufixo + ext
    if not dry:
        with open(saida, "w", encoding="utf-8", newline="") as f:
            f.write("\n".join(linhas_out) + "\n")
    op = "H + N" if somar else "H = h - N"
    print(f"  {os.path.basename(arq)}: {n_ok} pts corrigidos" + (f" · {n_skip} ignorados" if n_skip else ""))
    if Ns:
        print(f"     N: min={min(Ns):.3f} max={max(Ns):.3f} media={sum(Ns)/len(Ns):.3f} m   ({op})")
    if not dry:
        print(f"     -> {os.path.basename(saida)}")
    return n_ok

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alvo", help="arquivo .txt ou pasta")
    ap.add_argument("--grade", default=MAPGEO)
    ap.add_argument("--somar", action="store_true", help="soma N (H->h) em vez de subtrair")
    ap.add_argument("--sufixo", default="_ORTO")
    ap.add_argument("--zona", type=int, default=22)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    print(f"Grade: {os.path.basename(a.grade)}")
    g = Grade(a.grade)
    print(f"  {len(g.pts)} nós · lon {g.lons[0]:.3f}..{g.lons[-1]:.3f} · lat {g.lats[0]:.3f}..{g.lats[-1]:.3f}")
    u2ll = make_utm2ll(a.zona, True)

    alvos = ([a.alvo] if os.path.isfile(a.alvo)
             else sorted(x for x in glob.glob(os.path.join(a.alvo, "*.txt"))
                         if a.sufixo not in os.path.basename(x)))
    if not alvos:
        raise SystemExit("Nenhum .txt encontrado.")
    print(f"{len(alvos)} arquivo(s):" + ("  [DRY-RUN]" if a.dry else ""))
    tot = 0
    for f in alvos:
        tot += processar(f, g, u2ll, a.somar, a.sufixo, a.dry)
    print(f"TOTAL: {tot} pontos")

if __name__ == "__main__":
    main()
