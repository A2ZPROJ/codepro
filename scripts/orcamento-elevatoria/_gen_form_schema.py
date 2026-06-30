# -*- coding: utf-8 -*-
"""Gera os literais JS (schema do formulário + defaults SB-A5) p/ a aba do Nexus,
a partir do TEMPLATE do engine.py e do config SB-A5_Altamira.py. Roda 1x; saída
em _form_schema.js. Não é empacotado (filtro só *.py não pega .js)."""
import ast, os, json, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))

# 1) TEMPLATE do engine (parse por AST — não importa win32com)
src = open(os.path.join(HERE, 'engine.py'), encoding='utf-8').read()
tree = ast.parse(src)
TEMPLATE = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == 'TEMPLATE':
                TEMPLATE = ast.literal_eval(node.value)
assert TEMPLATE, 'TEMPLATE nao encontrado'

# schema: linhas {t,key,label,nota,un}. Só os tipos que viram UI/colunas.
schema = []
for row in TEMPLATE:
    t = row[0]
    if t == 'area':
        schema.append({'t': 'area', 'label': row[1]})
    elif t == 'sub':
        schema.append({'t': 'sub', 'label': row[1]})
    elif t == 'in':
        schema.append({'t': 'in', 'key': row[1], 'label': row[2], 'nota': row[3], 'un': row[4]})
    elif t == 'qd':
        schema.append({'t': 'qd', 'key': row[1], 'label': row[2], 'nota': row[3], 'un': row[4]})
    elif t == 'cp':
        schema.append({'t': 'cp', 'key': row[1], 'label': row[2], 'nota': row[3], 'un': row[4]})
    # 'qf' = calculado pelo engine -> sem UI

# 2) defaults SB-A5 (config só importa os)
spec = importlib.util.spec_from_file_location('cfg_a5', os.path.join(HERE, 'configs', 'SB-A5_Altamira.py'))
cfg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cfg)
def_data = dict(cfg.DATA)
def_cp = {k: [v[0], v[1]] for k, v in cfg.CP.items()}

# Saída ÚNICA = assets/form_schema.json (empacotado via assets/**/* ; lido pelo
# main.js no handler orc-elev:schema e servido ao renderer). NÃO EDITAR À MÃO —
# rode este gerador de novo se o TEMPLATE do engine mudar.
payload = {'schema': schema, 'defData': def_data, 'defCp': def_cp}
assets = os.path.join(HERE, 'assets')
os.makedirs(assets, exist_ok=True)
with open(os.path.join(assets, 'form_schema.json'), 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)
n_in = sum(1 for s in schema if s['t'] == 'in')
n_qd = sum(1 for s in schema if s['t'] == 'qd')
n_cp = sum(1 for s in schema if s['t'] == 'cp')
print(json.dumps({'ok': True, 'rows': len(schema), 'in': n_in, 'qd': n_qd, 'cp': n_cp,
                  'def_data_keys': len(def_data), 'def_cp_keys': len(def_cp)}, ensure_ascii=False))
