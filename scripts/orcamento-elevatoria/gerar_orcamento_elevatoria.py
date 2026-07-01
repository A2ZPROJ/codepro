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

    try:
        total = engine.run(cfg)              # imprime progresso (Custo/TOTAL/xlsx/pdf)
    except Exception as e:
        print(json.dumps({'ok': False, 'erro': str(e)}, ensure_ascii=False))
        sys.exit(1)

    try: total = float(total)
    except Exception: total = None
    stem = os.path.splitext(cfg.OUT_XLSX)[0]
    print(json.dumps({
        'ok': True,
        'xlsx': cfg.OUT_XLSX,
        'pdfs': [stem + ' - ORÇAMENTO.pdf', stem + ' - MEMORIAL.pdf'],
        'total': total,
        'sb': cfg.SB,
        'cidade': cfg.CIDADE,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
