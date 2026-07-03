# -*- coding: utf-8 -*-
"""WRAPPER do motor de Orçamento de Elevatória para o NEXUS.

O motor (engine.run) espera um CONFIG que é um módulo Python (cfg.SB, cfg.DATA, ...).
O Nexus integra geradores Python pelo padrão `--config <arquivo.json>` + imprime na ÚLTIMA
linha um JSON `{"ok":...}` que o main.js faz parse. Este wrapper faz a ponte:

    python gerar_orcamento_elevatoria.py --config <cfg.json>

Lê o JSON, monta um objeto cfg (SimpleNamespace), chama engine.run(cfg), e imprime o
JSON final com os caminhos gerados. Linhas de progresso (Custo/TOTAL/xlsx/pdf do engine)
saem antes e são repassadas ao renderer como progresso.

JSON de entrada (campos):
  obrigatórios: SB, CIDADE, A2_PATH, OUT_XLSX, DATA, CP
  opcionais:    CONTRATO, PRICE_UPD, QTY_UPD, CODE_UPD, AREA_INSERTS, EXTRA_BLOCK, MEMO_FONTES
"""
import sys, os, json, argparse, types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # mesmo diretório


def _int_keys(d):
    return {int(k): v for k, v in (d or {}).items()}


def build_cfg(d):
    cfg = types.SimpleNamespace()
    # obrigatórios
    cfg.SB       = d['SB']
    cfg.CIDADE   = d['CIDADE']
    cfg.A2_PATH  = d['A2_PATH']
    cfg.OUT_XLSX = d['OUT_XLSX']
    cfg.DATA     = d['DATA']
    # CP: dict chave -> (preco, fonte)  (vem como lista no JSON)
    cfg.CP       = {k: tuple(v) for k, v in (d.get('CP') or {}).items()}
    # opcionais
    cfg.CONTRATO     = d.get('CONTRATO', '')
    cfg.PRICE_UPD    = _int_keys(d.get('PRICE_UPD'))
    cfg.QTY_UPD      = _int_keys(d.get('QTY_UPD'))
    cfg.CODE_UPD     = _int_keys(d.get('CODE_UPD'))
    cfg.AREA_INSERTS = d.get('AREA_INSERTS')   # [[after, header, [[cod,desc,tipo,orig,q,un,val],...]], ...]
    cfg.EXTRA_BLOCK  = d.get('EXTRA_BLOCK')
    cfg.MEMO_FONTES  = d.get('MEMO_FONTES')
    return cfg


# ── BANCO DE COTAÇÕES: catálogo de preços que o Claude preenche lendo os PDFs ──
# precos.json no servidor mapeia key-do-item-do-engine -> preço por SB. O gerador
# injeta esses preços nos itens CP cujo preço está pendente, casando pelo SB da obra.
CATALOGO_PATH = r"\\2s-eng-servidor\maringa\_PROGRAMAS\COTACOES NEXUS\precos.json"


def _norm(s):
    """MAIÚSCULO sem acento (p/ casar cidade: 'Mandaguaçu/PR' -> 'MANDAGUACU/PR')."""
    import unicodedata
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode('ascii')
    return s.upper().strip()


def _preco_item(info, cidade, sb):
    """Escolhe o preço do item pela CIDADE/obra (mais específico), depois pelo SB,
    e por fim o default. O painel/QCM varia por OBRA (Mandaguaçu ≠ Altamira), não
    pelo número do SB — por isso a cidade tem prioridade."""
    # 1) por cidade (match por substring normalizado: chave contida na cidade)
    for chave, val in (info.get('precos_por_cidade', {}) or {}).items():
        if _norm(chave) and _norm(chave) in cidade:
            return val
    # 2) por SB (quando o preço realmente varia por SB dentro da mesma obra)
    v = (info.get('precos_por_sb', {}) or {}).get(sb)
    if v is not None:
        return v
    # 3) default
    return info.get('preco_default')


def aplicar_catalogo_cotacoes(cfg):
    """Lê o catálogo de preços do banco de cotações e injeta os preços de cotação
    casando por CIDADE/obra (e SB). Escreve o preço em DOIS lugares:
      • cfg.PRICE_UPD[linha]  -> preço UNIT no ORÇAMENTO (coluna K), via a linha
        do item no engine (MAP_REF). É o que faz o valor APARECER no orçamento.
      • cfg.CP[key]           -> fonte/preço na aba MEMORIAL (rastreio da cotação).
    Só injeta em itens cujo preço está pendente (não sobrescreve valor já dado).
    Devolve a lista de (key, preco) aplicados."""
    try:
        with open(CATALOGO_PATH, 'r', encoding='utf-8') as f:
            cat = json.load(f)
    except Exception:
        return []
    itens = (cat or {}).get('itens', {}) or {}
    cidade = _norm(getattr(cfg, 'CIDADE', ''))
    sb = _norm(getattr(cfg, 'SB', '')).lstrip('SB').lstrip('-').strip()
    if getattr(cfg, 'CP', None) is None:
        cfg.CP = {}
    if getattr(cfg, 'PRICE_UPD', None) is None:
        cfg.PRICE_UPD = {}
    # key -> linhas do orçamento (inverte MAP_REF do engine)
    key2rows = {}
    try:
        for r, k in engine.MAP_REF.items():
            key2rows.setdefault(k, []).append(int(r))
    except Exception:
        pass
    aplicados = []
    for key, info in itens.items():
        info = info or {}
        preco_cat = _preco_item(info, cidade, sb)
        if preco_cat is None:
            continue
        atual = cfg.CP.get(key)
        pendente = atual is None or (isinstance(atual, (list, tuple)) and (not atual or atual[0] is None))
        if pendente:
            cfg.CP[key] = (float(preco_cat), info.get('fonte') or 'cotação (banco)')
        # preço FINAL do item = o do form/import se preenchido (Lucas pode ter editado),
        # senão o do catálogo. SEMPRE reflete no ORÇAMENTO (col K via PRICE_UPD), pros itens
        # do catálogo — sem isso, preço vindo do form ia só p/ o Memorial. Não sobrescreve
        # PRICE_UPD já definido (manual).
        cur = cfg.CP.get(key)
        preco_final = float(cur[0]) if (isinstance(cur, (list, tuple)) and cur and cur[0] is not None) else float(preco_cat)
        rows = key2rows.get(key, [])
        for row in rows:
            if row not in cfg.PRICE_UPD:
                cfg.PRICE_UPD[row] = preco_final
        aplicados.append((key, preco_final, rows))
    return aplicados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True, help='caminho do JSON de configuração da obra')
    args = ap.parse_args()

    try:
        with open(args.config, 'r', encoding='utf-8') as f:
            d = json.load(f)
        cfg = build_cfg(d)
    except Exception as e:
        print(json.dumps({'ok': False, 'erro': 'config inválido: %s' % e}, ensure_ascii=False))
        sys.exit(1)

    # aplica preços do banco de cotações (itens CP pendentes) ANTES de gerar
    try:
        for k, p, rows in aplicar_catalogo_cotacoes(cfg):
            linhas = (' (linha %s)' % ','.join(map(str, rows))) if rows else ' (SEM linha no orçamento — só memorial)'
            print('cotação aplicada (banco): %s = R$ %.2f%s' % (k, p, linhas))
    except Exception as e:
        print('[aviso] catálogo de cotações não aplicado: %s' % e)

    try:
        total = engine.run(cfg)              # imprime progresso (Custo/TOTAL/xlsx/pdf)
    except Exception as e:
        print(json.dumps({'ok': False, 'erro': str(e)}, ensure_ascii=False))
        sys.exit(1)

    try: total = float(total)
    except Exception: total = None
    stem = os.path.splitext(cfg.OUT_XLSX)[0]

    # ── converte o orçamento p/ o FORMATO-RCE (visual 2S/André) — é a saída final ──
    out_xlsx = cfg.OUT_XLSX
    pdfs = [stem + ' - ORÇAMENTO.pdf', stem + ' - MEMORIAL.pdf']
    try:
        rce_xlsx, rce_pdf = to_rce(cfg.OUT_XLSX)
        out_xlsx = rce_xlsx
        pdfs = [rce_pdf, stem + ' - MEMORIAL.pdf']
        print('formato-RCE :', rce_xlsx)
    except Exception as e:
        print('[aviso] conversão formato-RCE falhou (mantendo o A2): %s' % e)

    print(json.dumps({
        'ok': True,
        'xlsx': out_xlsx,
        'pdfs': pdfs,
        'total': total,
        'sb': cfg.SB,
        'cidade': cfg.CIDADE,
    }, ensure_ascii=False))


def to_rce(a2_path):
    """Gera a versão FORMATO-RCE do orçamento (conv_rce.py) + o PDF do orçamento com a
    coluna C (ORIGEM) oculta. Retorna (rce_xlsx, rce_pdf)."""
    import subprocess
    import win32com.client as w32
    here = os.path.dirname(os.path.abspath(__file__))
    conv = os.path.join(here, 'formato_rce', 'conv_rce.py')
    stem = os.path.splitext(a2_path)[0]
    rce = stem + '_RCE.xlsx'
    pdf = stem + '_RCE - ORCAMENTO.pdf'
    subprocess.run([sys.executable, conv, a2_path, rce], check=True)
    xl = w32.DispatchEx('Excel.Application'); xl.Visible = False; xl.DisplayAlerts = False
    try:
        wb = xl.Workbooks.Open(rce); xl.CalculateFull()
        wo = wb.Worksheets('Orçamento')
        ps = wo.PageSetup; ps.Orientation = 2; ps.Zoom = False; ps.FitToPagesWide = 1; ps.FitToPagesTall = False; ps.CenterHorizontally = True
        wo.Columns('C:C').Hidden = True            # oculta ORIGEM só no PDF
        # PDF do orçamento = RESUMO (pág 1) + ORÇAMENTO juntos (abas agrupadas)
        try:
            wr = wb.Worksheets('Resumo')
            psr = wr.PageSetup; psr.Orientation = 1; psr.Zoom = False
            psr.FitToPagesWide = 1; psr.FitToPagesTall = 1; psr.CenterHorizontally = True
            wr.Select(True)      # seleciona só o Resumo
            wo.Select(False)     # agrupa o Orçamento à seleção
            wb.ActiveSheet.ExportAsFixedFormat(0, pdf)   # grupo -> 1 PDF (Resumo, depois Orçamento)
            wr.Select(True)      # desagrupa
        except Exception as e:
            print('[aviso] Resumo não incluído no PDF (%s) — gerando só o orçamento' % e)
            wo.ExportAsFixedFormat(0, pdf)
        wo.Columns('C:C').Hidden = False
        wb.Save(); wb.Close(True)
    finally:
        xl.Quit()
    return rce, pdf


if __name__ == '__main__':
    main()
