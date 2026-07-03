# -*- coding: utf-8 -*-
"""RASCUNHO com ELÉTRICO da PELE-029, agora ALOCADO POR ÁREA (Lucas 30/06).
Os itens elétricos entram DENTRO dos grupos da área ABRIGO (onde mora todo o elétrico no A2),
não num bloco solto no fim. Estratégia:
- Religa (un-zera) as linhas elétricas do A2 que já existem (código SANEPAR, na área certa) com
  as QUANTIDADES reais da PELE-029 (QTY_UPD).
- QCM grande na linha do "Painel elétrico" (145) via PRICE_UPD.
- Insere os itens NOVOS (transformador, subestação, disjuntor 300A, montagem, cabos 95/70/25,
  eletroduto PVC, comissionamento) DENTRO do grupo certo via AREA_INSERTS (motor estende a
  fórmula do grupo -> subtotal/área/VALOR TOTAL fecham sozinhos).
Continua: estrutura/sítio sem asfalto; BOMBA zerada (pendente cotação ~10CV). PELE provavelmente
de outra obra (Ubiratã) — isto é p/ NOÇÃO. Preços: SANEPAR onde há; senão internet/estimativa."""
import os
_BASE = (r"C:\Users\LUCAS_ABDALA\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA"
         r"\Área de Trabalho\LIXO IMPORTANTE\ORÇAMENTOS ELEVATÓRIA\Teste NEXUS - Orçamento")

SB       = 'SB-A3'
CIDADE   = 'MANDAGUAÇU/PR'
CONTRATO = '61670/2024'
A2_PATH  = _BASE + r"\MODELO ORÇAMENTO PRONTO\01 - ORC. ELEVATÓRIA_A2.xlsx"
OUT_XLSX = _BASE + r"\NEXUS\ORC_EEE_SB-A3_Mandaguacu_COM-ELETRICO-ESTIMADO.xlsx"

DATA = {
 'cant_c':8.5,'cant_l':3.0,'spt':25.0,'trado':5.0,
 'placa':4.0,'asbuilt':1.0,'acesso':5.0,'plc1':2.0,'plc2':2.0,
 'esc_c':4.5,'esc_l':3.0,'esc_p':3.4,
 'c40_poco':9.73,'frm_poco':49.72,'aco_pc':816.92,'cmag':0.52,
 'rec160':6.0,'piso_e':0.05,'calcada':9.0,
 'imp_pa_h':3.65,'imp_pa_l':2.6,'imp_pb_h':2.9,'imp_pb_l':1.5,'imp_tp_c':3.1,'imp_tp_l':2.0,
 'fd150ass':0.25,'escada':1.0,
 'm01':1.0,'m02':1.0,'m03':1.0,'m04':1.0,'m05':1.0,'m06':1.0,'m07':1.0,'m08':1.0,'m09':1.0,
 'm10':1.0,'m11':1.0,'m12':1.0,'m13':1.0,'m14':1.0,'m15':1.0,'m16':1.0,'m17':1.0,'m18':1.0,
 'm19':1.0,'m20':1.0,'m21':1.0,'m22':1.0,'m23':1.0,'m24':1.0,'m25':4.0,'m26':2.0,'m27':1.0,
 'pv_c':2.0,'pv_l':2.0,'pv_p':2.5,'frm_pv':12.0,'aco_pv':37.26,'c40_pv':0.81,'imp_pv':9.34,
 'pvd1':1.0,'anel1':1.0,'tampao':1.0,
 'frm_ab':1.04,'aco_ab':28.96,'c40_ab':0.34,'imp_ab':2.72,'mur_c':0.5,'mur_h':1.8,'rev':2.592,
 'e_qcm':1.0,'e_ent':1.0,
 'e_pead':6.0,'e_aco':12.0,'e_lb':7.0,'e_t':1.0,'e_cx':1.0,'e_cxinsp':1.0,'e_eqp':1.0,
 'e_cabonu':20.0,'e_cabo25':30.0,'e_instr':10.0,'e_term':5.0,'e_split':5.0,
 'e_haste':4.0,'e_chv':1.0,
 'e_eletr':528.0,'e_ajud':528.0,'e_ped':176.0,'e_auxped':176.0,'e_comis':80.0,
 'e_instp':1.0,'e_poste':1.0,
}
CP = {
 'm01':(135.02,'A2'),'m02':(520.00,'Hidroluna 39285'),'m03':(712.96,'MultHidro 0045119'),
 'm04':(None,'PENDENTE — bomba em linha ~10CV (Q5,93/H70)'),'m05':(666.20,'MultHidro'),
 'm06':(6333.04,'Hidroluna 39285'),'m07':(579.82,'MultHidro'),'m08':(1679.95,'MultHidro'),
 'm09':(110.69,'Hidroluna 39285'),'m10':(1917.00,'A2'),'m11':(997.55,'A2'),'m12':(647.00,'Ferpac 0739'),
 'm13':(338.00,'MultHidro'),'m14':(733.85,'MultHidro'),'m15':(None,'PENDENTE — submersível drenagem 22,9 m³/h'),
 'm16':(112.86,'A2'),'m17':(645.94,'A2'),'m18':(731.16,'A2'),'m19':(503.09,'A2'),
 'm20':(372.03,'Hidroluna 39285'),'m21':(182.63,'Hidroluna 39285'),'m22':(103.67,'A2'),
 'm23':(137.61,'A2'),'m24':(103.67,'A2'),'m25':(103.67,'A2'),'m26':(135.11,'A2'),'m27':(200.21,'A2'),
 'e_cxinsp':(56.87,'A2'),'e_eqp':(497.65,'A2'),'e_cabo25':(9.00,'A2'),'e_term':(7.06,'A2'),'e_chv':(387.20,'A2'),
}
# Bomba (81) zerada=pendente; QCM grande na linha 145 (Painel elétrico, que vinha sem preço).
PRICE_UPD = {79:520.00, 81:0.0, 83:6333.04, 89:647.00, 90:338.00, 145:130000.00}

# Código SANEPAR real (col B) dos 2 tampões — vindos do quadro QUANTITATIVO da PARQ folha 03.
CODE_UPD = {127:'167770', 128:'270369'}

# Religa (un-zera) o elétrico do A2 com as quantidades reais da PELE-029; 0 = não se aplica.
QTY_UPD = {
 127:1, 128:1,                      # 2 tampões FD CL125 (PARQ folha 03: 850/910mm acesso EEE + PV chegada)
 144:1, 145:1, 147:0, 148:1,        # abrigo metálico, painel QCM, (entrada 100A->subestação=0), caixa medição
 162:3, 163:0, 164:0, 165:0,        # eletroduto PEAD 2"; FG 2"/cabo 2,5/cabo 10 não se aplicam
 167:176, 168:176, 171:528, 172:528,# pedreiro/auxiliar, eletricista/ajudante
 174:9, 176:48,                     # Kanalex PEAD 4"+2"; eletroduto aço 4"+1"
 178:14, 179:3, 181:2,              # condulete LB 4", condulete T, caixa pré-fab
 183:20, 185:7, 187:5,              # cabo nu 50mm², haste, split-bolt
 189:0, 190:30,                     # cabo 10mm² não se aplica; cabo EPR (PP 4mm²)
 192:10, 193:1, 194:5, 195:1, 196:1,# instrumentação, caixa inspeção, terminal, equipot, chave nível
 198:6, 199:6, 201:20, 202:20, 203:7,# valas/assentamento eletroduto + aterramento + instal. haste
 205:1, 207:1,                      # instalação de poste, poste
}

# Itens NOVOS inseridos DENTRO do grupo certo da área ABRIGO. (after_line, header_line, [itens])
# Em 'orig' (FONTE): preço de internet vem com LINK (vira hyperlink clicável no Memorial).
AREA_INSERTS = [
 (148, 146, [   # grupo 014 ENTRADA DE ENERGIA (área ABRIGO)
   ('19043','Transformador trifásico distribuição 112,5 kVA 13,8kV-220/127V, a óleo','Mat','Internet — Siemetrafo (R$ 21.600 à vista): https://siemetrafo.com.br/produto/transformador-a-oleo-trifasico-112-5kva/',1,'un',21000.00),
   ('19044','Conj. subestação aérea: poste concreto 10,5m/600daN, cruzeta, 3 para-raios, isoladores, ferragens, mãos-francesas','Mat','Estimativa (composição poste+ferragens+para-raios+caixas) — sem cotação fechada',1,'cj',11200.00),
   ('19045','Disjuntor de caixa moldada tripolar 300 A','Mat','Internet — Steck (R$ ~1.921): https://judycabos.com.br/produto/disjuntor-caixa-moldada-tripolar-300a-steck/',1,'un',1500.00),
   ('19046','Montagem da subestação aérea + instalação do transformador (eletricista MT)','MO','Estimativa de mão de obra (sem item SANEPAR/SINAPI direto)',1,'cj',8500.00),
 ]),
 (176, 175, [   # grupo 042.024 ELETRODUTOS (área ABRIGO)
   ('013007009','Eletroduto rígido PVC (3"/2"/1"/¾") - rede da subestação','Mat','Sanepar (REF_TAB 013007009)',60,'m',28.49),
 ]),
 (190, 188, [   # grupo 042.007 CABOS FORÇA E DISTRIBUIÇÃO (área ABRIGO)
   ('19048','Cabo de cobre 95 mm² 0,6/1kV EPR (alimentador entrada->QCM)','Mat','Internet — Broketto (R$ 111,49/m): https://broketto.com.br/cabo-eletrico-fio-flexivel-95mm-0-6-1-kv-por-metro',96,'m',111.00),
   ('19049','Cabo de cobre 70 mm² 0,6/1kV EPR (QCM->motores)','Mat','Estimativa (≈0,74× do 95mm²) — confirmar cotação',70,'m',82.00),
   ('013005035','Condutor isolado - cabo 25 mm² (aterramento subestação)','Mat','Sanepar (REF_TAB 013005035)',24,'m',31.23),
 ]),
 (168, 166, [   # grupo 16017 MÃO DE OBRA (área ABRIGO)
   ('19050','Comissionamento e startup 2 CMB (1+1) c/ CLP','MO','Estimativa (80h × R$150) — fechar com fornecedor',1,'vb',12000.00),
 ]),
]

# Fontes de preço setadas via PRICE_UPD (não estão no AREA_INSERTS) p/ documentar no Memorial.
MEMO_FONTES = [
 ('Painel QCM p/ 2x75CV c/ 2 inversores 55kW + CLP S7-1200 + IHM', 1, 'un', 130000.00,
  'COTAÇÃO ESTIMADA (fornec. fabricante da elevatória) — alta incerteza; inversores 55kW ref. WEG CFW/Schneider ATV. PEDIR cotação real.'),
]

EXTRA_BLOCK = None
