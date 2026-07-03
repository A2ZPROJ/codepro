# -*- coding: utf-8 -*-
"""Config de obra — EEE SB-A6 — Altamira do Paraná/PR (Rua João André Sobrinho - ASFALTO).
SB-A6 = MESMA EEE padronizada da SB-A3/A4/A5. Verificado nos projetos A6 (18 pranchas):
quadros estruturais IDÊNTICOS -> concreto fck40 agregado 10,88 m³; magro 0,52; fôrma 62,76 m²;
aço 816,92 (caixa) / 37,26 (PV) / 28,96 (base painel) kg. Caixa 3,10x2,00 ext; PV aduela pré-
moldada 4x. Profundidade EEE ~3,40; PV ~2,45 m (laje fundo L5 -2,45 / poço dren. L6 -2,95; 5 cm
a menos que as irmãs, mas quadros idênticos -> custo igual). Elétrico = abrigo + 1 QCM (2 motores
inversor 3CV + drenagem 5CV; entrada REAL COPEL 220/127V cat.36 50A, dem. 19 kVA — os "125A/
transformador isolador/QGBT" que aparecem nas PELE 022/023 são SÓ simbologia/desenho-padrão, não
há componente instanciado). Serviços 528/528/176/176/80 h idênticos. Motobomba em linha 3CV 1+1
(vazão/HMT só no Memorial de Cálculo, ausente) -> item em linha continua None.
ATENÇÃO: existiu orçamento manual ANTIGO v6 (custo direto 305.265,69 / c/BDI 360.395,76, ~15k a
mais) — a diferença era METODOLOGIA/PREÇO (placeholders cheios: QCM, ventosa, motobombas em linha,
comissionamento), NÃO escopo de projeto. Com o motor padrão a A6 sai igual às irmãs (~345.386,34).
calcada=9,0: footprint padronizado (caixa 3,10x2,00 + extensão 1,40 = 4,50x2,00 = 9,00 m²; PARQ-03
não traz quadro de área de calçada, mesma situação da A3). ASFALTO 9,0 m²/0,45 m³ = footprint
repavimentado (rua asfalto). Base: gabarito A2. Recalque externo PENDENTE (PARQ cita "LINHA DE
RECALQUE" mas traçado/extensão não vem no pacote) -> sem rede externa. QCM/motobomba: cotação PEND."""
import os
_BASE = (r"C:\Users\LUCAS_ABDALA\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA"
         r"\Área de Trabalho\LIXO IMPORTANTE\ORÇAMENTOS ELEVATÓRIA\Teste NEXUS - Orçamento")

SB       = 'SB-A6'
CIDADE   = 'ALTAMIRA DO PARANÁ/PR'
CONTRATO = '61670/2024'
A2_PATH  = _BASE + r"\MODELO ORÇAMENTO PRONTO\01 - ORC. ELEVATÓRIA_A2.xlsx"
OUT_XLSX = _BASE + r"\NEXUS\ORC_EEE_SB-A6_Altamira.xlsx"

# DADOS DE ENTRADA + quantidades de projeto (células amarelas e quant. diretas)
DATA = {
 # --- serviços iniciais
 'cant_c':8.5,'cant_l':3.0,'spt':25.0,'trado':5.0,
 'placa':4.0,'asbuilt':1.0,'acesso':5.0,'plc1':2.0,'plc2':2.0,
 # --- poço (caixa EEE)
 'esc_c':4.5,'esc_l':3.0,'esc_p':3.4,
 'c40_poco':9.73,'frm_poco':49.72,'aco_pc':816.92,'cmag':0.52,
 'rec160':6.0,'piso_e':0.05,'calcada':9.0,
 'imp_pa_h':3.65,'imp_pa_l':2.6,'imp_pb_h':2.9,'imp_pb_l':1.5,'imp_tp_c':3.1,'imp_tp_l':2.0,
 'fd150ass':0.25,'escada':1.0,
 # materiais hidráulicos (qty)
 'm01':1.0,'m02':1.0,'m03':1.0,'m04':1.0,'m05':1.0,'m06':1.0,'m07':1.0,'m08':1.0,'m09':1.0,
 'm10':1.0,'m11':1.0,'m12':1.0,'m13':1.0,'m14':1.0,'m15':1.0,'m16':1.0,'m17':1.0,'m18':1.0,
 'm19':1.0,'m20':1.0,'m21':1.0,'m22':1.0,'m23':1.0,'m24':1.0,'m25':4.0,'m26':2.0,'m27':1.0,
 # --- poço de visita
 'pv_c':2.0,'pv_l':2.0,'pv_p':2.45,'frm_pv':12.0,'aco_pv':37.26,'c40_pv':0.81,'imp_pv':9.34,
 'pvd1':1.0,'anel1':1.0,'tampao':1.0,
 # --- abrigo / painel
 'frm_ab':1.04,'aco_ab':28.96,'c40_ab':0.34,'imp_ab':2.72,'mur_c':0.5,'mur_h':1.8,'rev':2.592,
 'e_qcm':1.0,'e_ent':1.0,
 # --- elétrico / externo (PELE)
 'e_pead':6.0,'e_aco':12.0,'e_lb':7.0,'e_t':1.0,'e_cx':1.0,'e_cxinsp':1.0,'e_eqp':1.0,
 'e_cabonu':20.0,'e_cabo25':30.0,'e_instr':10.0,'e_term':5.0,'e_split':5.0,
 'e_haste':4.0,'e_chv':1.0,
 'e_eletr':528.0,'e_ajud':528.0,'e_ped':176.0,'e_auxped':176.0,'e_comis':80.0,
 'e_instp':1.0,'e_poste':1.0,
}

# COTAÇÕES (CP): chave -> (preço unit., fonte). preço None = pendente de cotação individual.
CP = {
 'm01':(135.02,'Modelo A2 = 135,02; alt. Transpol 1810 (110,42/m) — conferir'),
 'm02':(520.00,'Hidroluna 39285, item 43 (Colarinho PEAD DE160)'),
 'm03':(712.96,'MultHidro 0045119 (TOCO TOF150x250)'),
 'm04':(133796.53,'Improv Equipamentos THS26.472 R00 (05/06/26) — SBL-230-SS-2P 10CV, 0,90 l/s / 42 mca (pacote: conj. em linha + painel + válvulas + dren.)'),
 'm05':(666.20,'MultHidro 0045119 (TE TFF100x80)'),
 'm06':(6333.04,'Hidroluna 39285, item 47 (Ventosa tríplice DN100)'),
 'm07':(579.82,'MultHidro 0045119 (TE TFF80x80)'),
 'm08':(1679.95,'MultHidro 0045119 (TUBO-FLS 80x700 AV)'),
 'm09':(110.69,'Hidroluna 39285, item 50 (Colarinho PEAD DE90)'),
 'm10':(1917.00,'A2 — sem cotação DN80 (só DN100)'),
 'm11':(997.55,'A2 — sem essa medida (1,20m DN80) nas cotações'),
 'm12':(647.00,'Ferpac-Salvati 0739, item 10 (Extremidade FD PF 700mm DN80)'),
 'm13':(338.00,'MultHidro 0045119 (CURVA C22FF 80)'),
 'm14':(733.85,'MultHidro 0045119 (TUBO PTA 80x1000)'),
 'm15':(None,  'Incluído no conj. em linha (A2); cotação individual da submersível PENDENTE'),
 'm16':(112.86,'A2 — PPR DE90 não cotado'),
 'm17':(645.94,'A2 — PPR DE90 não cotado'),
 'm18':(731.16,'A2 — PPR DE90 não cotado'),
 'm19':(503.09,'A2 — PPR DE90 não cotado'),
 'm20':(372.03,'Hidroluna 39285, item 62 (Flange aço carbono DE160 DN150)'),
 'm21':(182.63,'Hidroluna 39285, item 61 (Flange aço carbono DE90 DN80)'),
 'm22':(103.67,'A2 — kit (Ferpac 11,00 / MTS 105,85)'),
 'm23':(137.61,'A2 — kit'),
 'm24':(103.67,'A2 — kit'),
 'm25':(103.67,'A2 — kit (Ferpac 0739: 6,50–11,00)'),
 'm26':(135.11,'A2 — kit'),
 'm27':(200.21,'A2 — kit inox DN150'),
 'e_cxinsp':(56.87,'A2 — sem cotação (caixa inspeção DN300)'),
 'e_eqp':(497.65,'A2 — sem cotação (caixa equipotencialização)'),
 'e_cabo25':(9.00,'A2 — sem cotação (cabo 2,5mm² tetrapolar)'),
 'e_term':(7.06,'A2 — sem cotação (terminal estanhado)'),
 'e_chv':(387.20,'A2 — sem cotação de chave de nível'),
}

# Overrides diretos no ORÇAMENTO (linha do A2 -> valor). Preços reconciliados das cotações.
PRICE_UPD = {79:520.00, 81:133796.53, 83:6333.04, 89:647.00, 90:338.00}
QTY_UPD   = {}

# Bloco extra anexado antes do VALOR TOTAL (estação na RUA JOÃO ANDRÉ SOBRINHO = ASFALTO).
# Footprint da estação repavimentado. itens: (cod,desc,tipo,origem,quant,un,valor)
EXTRA_BLOCK = {
 'titulo': 'PAVIMENTAÇÃO ASFÁLTICA',
 'itens': [
   ('PAV-01', 'Pintura de ligação / imprimação asfáltica', 'MO', 'Sanepar', 9.0,  'm²', 12.02),
   ('PAV-02', 'Revestimento com concreto betuminoso usinado a quente (CBUQ)', 'MO', 'Sanepar', 0.45, 'm³', 1471.57),
 ],
}
