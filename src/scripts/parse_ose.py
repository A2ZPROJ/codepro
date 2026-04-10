"""
parse_ose.py — Parser OSE para o Nexus
Lê MAPA DXF, PERFIS DXF e Excel (.xlsm/.xlsx) e retorna JSON de comparação.
"""
import sys, json, re, ezdxf, openpyxl

def normalize_id(s):
    s = re.sub(r'[\s-]+', '', str(s).strip()).upper()
    # Remove zeros à esquerda do sufixo numérico: PV023→PV23, TL022→TL22
    return re.sub(r'([A-Z]+)0*(\d+)$', lambda m: m.group(1) + str(int(m.group(2))), s)

def pf(s):
    """Parse float tolerante a vírgula e ponto."""
    if s is None or s == '' or str(s).startswith('#'):
        return None
    try:
        return float(str(s).strip().replace(',', '.'))
    except:
        return None

# ── MAPA DXF ────────────────────────────────────────────────────────────────
def parse_mapa(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    pvs  = {}   # norm_id → {ct, cf, h}
    oses = {}   # '057'   → {L, i}

    for e in msp:
        if e.dxftype() == 'MULTILEADER':
            try:
                raw = e.context.mtext.default_content
                m_id = re.search(r';((?:PV|TL|PIT)[\s-]+\d+)', raw, re.IGNORECASE)
                m_ct = re.search(r'\\PCT:([\d.]+)', raw)
                m_cf = re.search(r'\\PCF:([\d.]+)', raw)
                m_h  = re.search(r'\\Ph:([\d.]+)',  raw)
                if m_id and m_ct and m_cf:
                    pid = normalize_id(m_id.group(1))
                    pvs[pid] = {
                        'ct': float(m_ct.group(1)),
                        'cf': float(m_cf.group(1)),
                        'h':  float(m_h.group(1)) if m_h else None,
                    }
            except:
                pass

        elif e.dxftype() == 'MTEXT':
            txt = e.plain_text().strip()
            m = re.search(r'OSE[\s-]+(\d+)\s+L=([\d.,]+)m.*?i=([\d.,]+)', txt, re.DOTALL | re.IGNORECASE)
            if m:
                num = m.group(1).zfill(3)
                oses[num] = {'L': pf(m.group(2)), 'i': pf(m.group(3))}

    return {'pvs': pvs, 'oses': oses}

# ── PERFIS DXF ───────────────────────────────────────────────────────────────
def parse_perfis(path):
    doc = ezdxf.readfile(path)
    present = []
    for layout in doc.layouts:
        m = re.search(r'OSE[\s-]+(\d+)', layout.name, re.IGNORECASE)
        if m:
            present.append(m.group(1).zfill(3))
    return sorted(set(present))

# ── EXCEL ────────────────────────────────────────────────────────────────────
def parse_excel(path):
    wb = openpyxl.load_workbook(path, data_only=True, keep_vba=False)
    result = {}

    for sheet_name in wb.sheetnames:
        m = re.search(r'OSE[\s-]+(\d+)', sheet_name, re.IGNORECASE)
        if not m:
            continue
        ose_num = m.group(1).zfill(3)
        ws = wb[sheet_name]

        # Comprimento total: célula C6 (linha 6, col 3)
        comp = None
        try:
            v = ws.cell(6, 3).value
            if isinstance(v, (int, float)):
                comp = round(v, 4)
        except:
            pass

        # Localizar linha de cabeçalho (busca por "Dist. Acumulada" ou "C. Fundo")
        header_row = 10  # default
        for ri in range(8, 15):
            row_vals = [ws.cell(ri, c).value for c in range(1, 20)]
            if any(isinstance(v, str) and 'fundo' in str(v).lower() for v in row_vals):
                header_row = ri
                break

        data_start = header_row + 1
        pvs = []
        empty_streak = 0

        for ri in range(data_start, data_start + 500):
            est_id_raw = ws.cell(ri, 1).value  # Col A
            if est_id_raw is None or str(est_id_raw).strip() == '':
                empty_streak += 1
                if empty_streak >= 3:
                    break
                continue
            empty_streak = 0

            est_id = str(est_id_raw).strip()
            if not re.match(r'^(PV|PIT|TL)', est_id, re.IGNORECASE):
                continue

            ct_val = ws.cell(ri, 4).value   # Col D: C. Terreno
            if not isinstance(ct_val, (int, float)):
                continue  # linha com #N/A ou fórmula não calculada

            dist_acum = pf(ws.cell(ri, 7).value)   # Col G
            cf        = pf(ws.cell(ri, 10).value)  # Col J: C. Fundo
            decl      = pf(ws.cell(ri, 15).value)  # Col O: Declividade
            prof      = pf(ws.cell(ri, 19).value)  # Col S: Prof. Vala

            pvs.append({
                'id':       est_id,
                'id_norm':  normalize_id(est_id),
                'ct':       round(float(ct_val), 4),
                'cf':       round(cf, 4) if cf is not None else None,
                'dist_acum':round(dist_acum, 4) if dist_acum is not None else None,
                'decl':     round(decl, 6) if decl is not None else None,
                'prof':     round(prof, 4) if prof is not None else None,
            })

        result[ose_num] = {'comprimento': comp, 'pvs': pvs}

    return result

# ── COMPARAÇÃO ───────────────────────────────────────────────────────────────
def diff(a, b, digits=4):
    if a is None or b is None:
        return None
    return round(abs(a - b), digits)

def build_comparison(mapa, perfis_present, excel):
    all_nums = sorted(set(
        list(mapa['oses'].keys()) +
        list(excel.keys()) +
        perfis_present
    ))

    rows = []
    for num in all_nums:
        mapa_ose   = mapa['oses'].get(num, {})
        excel_ose  = excel.get(num, {})
        in_perfil  = num in perfis_present
        in_mapa    = num in mapa['oses']
        in_excel   = num in excel

        excel_pvs  = excel_ose.get('pvs', [])
        excel_L    = excel_ose.get('comprimento')

        # Declividade principal = declividade da primeira linha de dados
        excel_i = None
        for ep in excel_pvs:
            if ep.get('decl') is not None:
                excel_i = ep['decl']
                break

        mapa_L = mapa_ose.get('L')
        mapa_i = mapa_ose.get('i')

        # Comparação por PV nomeado (PV-XXX, TL-XXX — não PIT)
        pv_comps = []
        seen = set()
        for ep in excel_pvs:
            pid = ep['id_norm']
            if pid in seen:
                continue
            if re.match(r'^PIT', ep['id'], re.IGNORECASE):
                continue  # pular PITs na comparação de PV
            seen.add(pid)

            mpv = mapa['pvs'].get(pid, {})
            pv_comps.append({
                'id':         ep['id'],
                'excel_ct':   ep['ct'],
                'excel_cf':   ep['cf'],
                'excel_h':    ep['prof'],
                'mapa_ct':    mpv.get('ct'),
                'mapa_cf':    mpv.get('cf'),
                'mapa_h':     mpv.get('h'),
                'diff_ct':    diff(ep['ct'],   mpv.get('ct')),
                'diff_cf':    diff(ep['cf'],   mpv.get('cf')),
                'diff_h':     diff(ep['prof'], mpv.get('h')),
            })

        rows.append({
            'ose':       num,
            'in_mapa':   in_mapa,
            'in_perfil': in_perfil,
            'in_excel':  in_excel,
            'mapa_L':    mapa_L,
            'mapa_i':    mapa_i,
            'excel_L':   excel_L,
            'excel_i':   excel_i,
            'diff_L':    diff(mapa_L, excel_L, 3),
            'diff_i':    diff(mapa_i, excel_i, 6),
            'pvs':       pv_comps,
        })

    return rows

# ── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({'error': 'Uso: parse_ose.py <mapa.dxf> <perfis.dxf> <planilha.xlsx>'}))
        sys.exit(1)

    mapa_path, perfis_path, excel_path = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        mapa   = parse_mapa(mapa_path)
        perfis = parse_perfis(perfis_path)
        excel  = parse_excel(excel_path)
        result = build_comparison(mapa, perfis, excel)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as ex:
        import traceback
        print(json.dumps({'error': str(ex), 'trace': traceback.format_exc()}))
        sys.exit(1)
