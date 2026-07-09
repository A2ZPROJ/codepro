# -*- coding: utf-8 -*-
"""
Porte Python do anti-colisão de rótulos do AJUSTARTEXTOPV (AjustarTextoPVCommand.cs).
Coloca cada balão de PV FORA DA PISTA (dentro do lote, além do muro/alinhamento),
SEM sobrepor outro balão, e SEM cruzar leaders. Índice espacial p/ escalar a milhares.

place_labels(items, seg_mf, seg_muro, seg_rede) -> lista {landing:(x,y), dir:(dx,dy)}
  items: [{x,y,W,Ht}]  (W=largura do texto, Ht=altura — horizontais)
  seg_*: listas de segmentos (x1,y1,x2,y2)
"""
import math
from collections import defaultdict

# ── constantes (iguais ao AjustarTextoPVCommand.cs) ─────────────────
JANELA, MAX_MURO = 45.0, 35.0
GAP_MURO, GAP_CURB = 3.0, 1.5
OFF_MIN, OFF_DEFAULT, ROAD_MIN = 2.5, 5.0, 4.0
FAN_HALF, FAN_STEP = 35.0, 5.0
SIDE_PEN, ANGLE_PEN, CURB_PEN, FALL_PEN = 1.5, 0.06, 2.5, 12.0
TEXT_H = 1.2
BOX_PAD = TEXT_H * 0.5
PUSH_STEP = TEXT_H * 1.6
MAX_PUSH, MAX_SLIDE, MAX_CANDS = 8, 8, 12
NEAR_BIAS = 1.5

def _norm(vx, vy):
    l = math.hypot(vx, vy)
    return (1.0, 0.0) if l < 1e-9 else (vx / l, vy / l)
def _rot(vx, vy, rad):
    c, s = math.cos(rad), math.sin(rad)
    return (vx * c - vy * s, vx * s + vy * c)

def _dist_pt_seg(px, py, s):
    x1, y1, x2, y2 = s
    vx, vy = x2 - x1, y2 - y1
    wx, wy = px - x1, py - y1
    c1 = vx * wx + vy * wy
    if c1 <= 0: return math.hypot(wx, wy)
    c2 = vx * vx + vy * vy
    if c2 <= c1: return math.hypot(px - x2, py - y2)
    b = c1 / c2
    return math.hypot(px - (x1 + b * vx), py - (y1 + b * vy))

def _dist_min(px, py, segs):
    b = 1e18
    for s in segs:
        d = _dist_pt_seg(px, py, s)
        if d < b: b = d
    return 999.0 if b == 1e18 else b

def _ray_nearest(px, py, dx, dy, segs):
    """menor t>0 onde o raio (px,py)+t*(dx,dy) cruza um segmento (u in[0,1])."""
    best = 1e18
    for (x1, y1, x2, y2) in segs:
        ex, ey = x2 - x1, y2 - y1
        den = dx * ey - dy * ex
        if abs(den) < 1e-12: continue
        t = ((x1 - px) * ey - (y1 - py) * ex) / den
        u = ((x1 - px) * dy - (y1 - py) * dx) / den
        if t > 1e-6 and -1e-9 <= u <= 1 + 1e-9 and t < best: best = t
    return -1.0 if best == 1e18 else best

def _dir_at(px, py, segs, win):
    bd, bs = 1e18, None
    for s in segs:
        d = _dist_pt_seg(px, py, s)
        if d < bd: bd, bs = d, s
    if bs is None or bd > win: return None
    v = _norm(bs[2] - bs[0], bs[3] - bs[1])
    return None if v == (1.0, 0.0) and bs[2] == bs[0] and bs[3] == bs[1] else v

class SegIndex:
    """grade uniforme p/ consultar segmentos perto de um ponto."""
    def __init__(self, segs, cell=JANELA):
        self.cell = cell; self.segs = segs; self.g = defaultdict(list)
        for i, (x1, y1, x2, y2) in enumerate(segs):
            for cx in range(int(min(x1, x2) // cell), int(max(x1, x2) // cell) + 1):
                for cy in range(int(min(y1, y2) // cell), int(max(y1, y2) // cell) + 1):
                    self.g[(cx, cy)].append(i)
    def near(self, px, py, win):
        c = self.cell; r = int(win // c) + 1; cx0 = int(px // c); cy0 = int(py // c)
        idx = set()
        for cx in range(cx0 - r, cx0 + r + 1):
            for cy in range(cy0 - r, cy0 + r + 1):
                idx.update(self.g.get((cx, cy), ()))
        return [self.segs[i] for i in idx]

class BoxGrid:
    def __init__(self, cell=16.0): self.cell = cell; self.g = defaultdict(list)
    def _cells(self, b):
        c = self.cell
        for cx in range(int(b[0] // c), int(b[2] // c) + 1):
            for cy in range(int(b[1] // c), int(b[3] // c) + 1):
                yield (cx, cy)
    def add(self, b):
        for k in self._cells(b): self.g[k].append(b)
    def overlaps(self, b, pad=BOX_PAD):
        bb = (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)
        for k in self._cells(bb):
            for o in self.g.get(k, ()):
                if bb[2] < o[0] or bb[0] > o[2] or bb[3] < o[1] or bb[1] > o[3]: continue
                return True
        return False

def _box_at(lx, ly, dirx, w, ht):
    sign = 1.0 if dirx >= 0 else -1.0
    cx = lx + sign * w / 2.0
    return (cx - w / 2.0, ly - ht / 2.0, cx + w / 2.0, ly + ht / 2.0)

def _boxes_overlap(a, b, pad=BOX_PAD):
    if a[2] + pad < b[0] or a[0] - pad > b[2]: return False
    if a[3] + pad < b[1] or a[1] - pad > b[3]: return False
    return True

def _seg_cross(p1, p2, p3, p4):
    def cr(a, b, c): return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = cr(p3, p4, p1), cr(p3, p4, p2)
    d3, d4 = cr(p1, p2, p3), cr(p1, p2, p4)
    return ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4))

def _candidatos(px, py, mf, muro, rede):
    eixo = _dir_at(px, py, rede, JANELA)
    tem = eixo is not None
    if not tem:
        eixo = _dir_at(px, py, mf, JANELA); tem = eixo is not None
    if not tem: eixo = (1.0, 0.0)
    ex, ey = eixo
    if ex < -1e-9 or (abs(ex) < 1e-9 and ey < 0): ex, ey = -ex, -ey
    lados = [((-ey, ex), 0), ((ey, -ex), 1)]
    cands = []
    def fan(alvo, gap, tier):
        if not alvo: return
        for (bas, rank) in lados:
            a = -FAN_HALF
            while a <= FAN_HALF + 1e-9:
                d = _rot(bas[0], bas[1], math.radians(a))
                t = _ray_nearest(px, py, d[0], d[1], alvo)
                if 0 < t < MAX_MURO:
                    off = max(t + gap, OFF_MIN)
                    nx, ny = _norm(d[0], d[1])
                    cands.append((nx, ny, off, off + rank * SIDE_PEN + abs(a) * ANGLE_PEN + tier))
                a += FAN_STEP
    fan(muro, GAP_MURO, 0.0)
    if not muro: fan(mf, GAP_CURB, CURB_PEN)
    if tem:
        for (bas, rank) in lados:
            for a in (-40, -20, 0, 20, 40):
                d = _rot(bas[0], bas[1], math.radians(a)); nx, ny = _norm(d[0], d[1])
                cands.append((nx, ny, OFF_DEFAULT, OFF_DEFAULT + rank * SIDE_PEN + abs(a) * ANGLE_PEN + FALL_PEN))
    else:
        for k in range(12):
            th = 2 * math.pi * k / 12
            cands.append((math.cos(th), math.sin(th), OFF_DEFAULT, OFF_DEFAULT + FALL_PEN))
    cands.sort(key=lambda c: c[3])
    return cands

def place_labels(items, seg_mf, seg_muro, seg_rede, log=lambda *a: None):
    idx_mf = SegIndex(seg_mf) if seg_mf else None
    idx_mu = SegIndex(seg_muro) if seg_muro else None
    idx_re = SegIndex(seg_rede) if seg_rede else None
    order = sorted(range(len(items)), key=lambda i: (-items[i]['y'], items[i]['x']))
    res = [None] * len(items)
    grid = BoxGrid()
    for oi, i in enumerate(order):
        it = items[i]; px, py, W, Ht = it['x'], it['y'], it['W'], it['Ht']
        mf = idx_mf.near(px, py, JANELA) if idx_mf else []
        mu = idx_mu.near(px, py, JANELA) if idx_mu else []
        re = idx_re.near(px, py, JANELA) if idx_re else []
        cands = _candidatos(px, py, mf, mu, re)
        def lado_lote(lx, ly):
            if not mu: return True
            return _dist_min(lx, ly, mu) <= _dist_min(lx, ly, mf) + 0.5
        best_score = 1e18; best = None
        for ci in range(min(len(cands), MAX_CANDS)):
            dx, dy, off0, _ = cands[ci]
            ax, ay = _norm(-dy, dx)
            slide = abs(ax) * W + abs(ay) * Ht + BOX_PAD
            combos = []
            for p in range(MAX_PUSH + 1):
                off = off0 + p * PUSH_STEP
                combos.append((off, off, 0.0))
                for k in range(1, MAX_SLIDE + 1):
                    sl = k * slide; d = math.hypot(off, sl)
                    combos.append((d, off, sl)); combos.append((d, off, -sl))
            combos.sort(key=lambda c: c[0])
            bias = ci * NEAR_BIAS
            for d, off, sl in combos:
                if d + bias >= best_score: break
                lx = px + dx * off + ax * sl; ly = py + dy * off + ay * sl
                if mf and _dist_min(lx, ly, mf) < ROAD_MIN: continue
                if not lado_lote(lx, ly): continue
                box = _box_at(lx, ly, dx, W, Ht)
                if not grid.overlaps(box):
                    best_score = d + bias; best = (dx, dy, lx, ly, box); break
            if best is not None and best_score - bias <= off0 + 0.01: break
        if best is None:
            # fallback: prioriza lote/fora da pista, aceita encostar
            for dx, dy, off0, _ in cands:
                placed = False
                for p in range(MAX_PUSH + 1):
                    off = off0 + p * PUSH_STEP
                    lx = px + dx * off; ly = py + dy * off
                    if mf and _dist_min(lx, ly, mf) < ROAD_MIN: continue
                    if not lado_lote(lx, ly): continue
                    best = (dx, dy, lx, ly, _box_at(lx, ly, dx, W, Ht)); placed = True; break
                if placed: break
            if best is None:
                dx, dy, off0 = (cands[0][0], cands[0][1], cands[0][2]) if cands else (1.0, 0.0, OFF_DEFAULT)
                lx = px + dx * off0; ly = py + dy * off0
                best = (dx, dy, lx, ly, _box_at(lx, ly, dx, W, Ht))
        dx, dy, lx, ly, box = best
        grid.add(box)
        res[i] = {'dir': (dx, dy), 'landing': (lx, ly), 'box': box}
        if oi % 200 == 0: log(f"  colocados {oi+1}/{len(items)}")
    _separar(items, res)
    _descruzar(items, res)
    return res

def _pairs_near(res, cell=18.0):
    g = defaultdict(list)
    for i, r in enumerate(res):
        cx = (r['box'][0] + r['box'][2]) / 2; cy = (r['box'][1] + r['box'][3]) / 2
        g[(int(cx // cell), int(cy // cell))].append(i)
    pairs = set()
    for (cx, cy), mem in g.items():
        cand = []
        for nx in (cx - 1, cx, cx + 1):
            for ny in (cy - 1, cy, cy + 1):
                cand += g.get((nx, ny), [])
        for i in mem:
            for j in cand:
                if j > i: pairs.add((i, j))
    return pairs

def _separar(items, res):
    for _ in range(40):
        pairs = _pairs_near(res)
        moved = False
        for i, j in pairs:
            if not _boxes_overlap(res[i]['box'], res[j]['box']): continue
            def dpv(k):
                r = res[k]; it = items[k]
                return math.hypot(r['landing'][0] - it['x'], r['landing'][1] - it['y'])
            k = i if dpv(i) <= dpv(j) else j
            r = res[k]; it = items[k]; dx, dy = r['dir']
            lx = r['landing'][0] + dx * PUSH_STEP; ly = r['landing'][1] + dy * PUSH_STEP
            r['landing'] = (lx, ly); r['box'] = _box_at(lx, ly, dx, it['W'], it['Ht'])
            moved = True
        if not moved: break

def _descruzar(items, res):
    for _ in range(60):
        pairs = _pairs_near(res, cell=40.0)
        swapped = False
        for i, j in pairs:
            a, b = res[i], res[j]; ia, ib = items[i], items[j]
            pa = (ia['x'], ia['y']); pb = (ib['x'], ib['y'])
            if not _seg_cross(pa, a['landing'], pb, b['landing']): continue
            if _seg_cross(pa, b['landing'], pb, a['landing']): continue
            a['landing'], b['landing'] = b['landing'], a['landing']
            a['dir'] = _norm(a['landing'][0] - pa[0], a['landing'][1] - pa[1])
            b['dir'] = _norm(b['landing'][0] - pb[0], b['landing'][1] - pb[1])
            a['box'] = _box_at(a['landing'][0], a['landing'][1], a['dir'][0], ia['W'], ia['Ht'])
            b['box'] = _box_at(b['landing'][0], b['landing'][1], b['dir'][0], ib['W'], ib['Ht'])
            swapped = True
        if not swapped: break
