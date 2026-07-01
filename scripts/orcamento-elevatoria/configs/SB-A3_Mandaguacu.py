# -*- coding: utf-8 -*-
"""Config de obra — EEE SB-A3 — MANDAGUAÇU/PR (Rua Verdes Vale - TERRA). Contrato 61670/2024.
Bacia Córrego Zorro. Projeto DE-029 (PEST/PARQ/PHID/PELE), RT Rodrigo A. Zanatta, jun/2026.

ESTRUTURA = IDÊNTICA à EEE padrão "08" de Altamira (PEST-029 confere número de quadro EXATO):
concreto fck40 10,88 m³ (9,73+0,81+0,34), magro 0,52, fôrma 62,76 (49,72+12,0+1,04),
aço 816,92+37,26+28,96 kg, caixa EEE 3,40 m, footprint 3,10x2,00. Reaproveita o bloco
estrutural da A3 Altamira sem mexer.

DIFERENÇAS confirmadas vs Altamira (lidas dos projetos DE-029):
1. RUA VERDES VALE = TERRA (PARQ-01/02/04 "via de terra") -> SEM bloco de PAVIMENTAÇÃO
   ASFÁLTICA (EXTRA_BLOCK = None). Em Altamira a rua era asfalto.
2. Calçada/piso = 9,00 m² / 0,45 m³ (PARQ planta baixa 1:25 confirma caixa 3,10x2,00 +
   extensão 1,40) -> IGUAL a Altamira.

PENDENTES (deixados FORA do total — escolha do Lucas "montar tudo menos elétrico"):
- BLOCO ELÉTRICO (linhas 144,145,147,148,162-207) ZERADO via QTY_UPD: a PELE-029 veio
  CONTAMINADA (descreve 2x75CV + subestação aérea 112,5kVA + transformador + disjuntor 300A,
  com carimbo "UBIRATÃ" no rodapé). PEST+PHID+PARQ provam estação PEQUENA (bomba ~10CV, entrada
  por mureta). Aguarda PELE correta do projetista p/ dimensionar QCM/entrada/cabos/disjuntor.
- BOMBA (linha 81) ZERADA (PRICE_UPD 81=0): PHID-029 dá conjunto EM LINHA Q=5,93 L/s · H=70 mca
  (~10CV, ≠ 3CV de Altamira) SEM modelo/fabricante -> cotação nova pendente. Há ainda 1 motobomba
  SUBMERSÍVEL de drenagem 22,9 m³/h (m15) também a cotar.
- PV de chegada = PV-450 h=1,48 (CT 507,443/CF 505,963), NÃO é PV tipo D DN1200 como Altamira;
  o bloco PV (linhas 64/65/125/126) está com base Altamira -> A RECONCILIAR. PARQ pede 2 tampões
  FD CL125 (Altamira tinha 1). Linha de recalque externa indefinida (igual A3-A6).

Base: gabarito A2."""
import os
_BASE = (r"C:\Users\LUCAS_ABDALA\OneDrive - 2S ENGENHARIA DE AGRIMENSURA E GEOTECNOLOGIA"
         r"\Área de Trabalho\ORÇAMENTOS ELEVATÓRIA\Teste NEXUS - Orçamento")

SB       = 'SB-A3'
CIDADE   = 'MANDAGUAÇU/PR'
CONTRATO = '61670/2024'
A2_PATH  = _BASE + r"\MODELO ORÇAMENTO PRONTO\01 - ORC. ELEVATÓRIA_A2.xlsx"
OUT_XLSX = _BASE + r"\NEXUS\ORC_EEE_SB-A3_Mandaguacu.xlsx"

# DADOS DE ENTRADA + quantidades de projeto (estrutura = A3 Altamira, PEST-029 confirmado)
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
 # --- poço de visita (base Altamira; PV-450 desta obra A RECONCILIAR)
 'pv_c':2.0,'pv_l':2.0,'pv_p':2.5,'frm_pv':12.0,'aco_pv':37.26,'c40_pv':0.81,'imp_pv':9.34,
 'pvd1':1.0,'anel1':1.0,'tampao':1.0,
 # --- abrigo / painel
 'frm_ab':1.04,'aco_ab':28.96,'c40_ab':0.34,'imp_ab':2.72,'mur_c':0.5,'mur_h':1.8,'rev':2.592,
 'e_qcm':1.0,'e_ent':1.0,
 # --- elétrico / externo (PELE) — quantidades mantidas p/ doc; ZERADAS no orçamento (QTY_UPD)
 'e_pead':6.0,'e_aco':12.0,'e_lb':7.0,'e_t':1.0,'e_cx':1.0,'e_cxinsp':1.0,'e_eqp':1.0,
 'e_cabonu':20.0,'e_cabo25':30.0,'e_instr':10.0,'e_term':5.0,'e_split':5.0,
 'e_haste':4.0,'e_chv':1.0,
 'e_eletr':528.0,'e_ajud':528.0,'e_ped':176.0,'e_auxped':176.0,'e_comis':80.0,
 'e_instp':1.0,'e_poste':1.0,
}

# COTAÇÕES (CP): chave -> (preço unit., fonte). preço None = pendente.
CP = {
 'm01':(135.02,'Modelo A2 = 135,02 (PEAD DE160 1,6m) — conferir cotação'),
 'm02':(520.00,'Hidroluna 39285, item 43 (Colarinho PEAD DE160)'),
 'm03':(712.96,'MultHidro 0045119 (TOCO TOF150x250)'),
 'm04':(None,'PENDENTE cotação — conj. motobomba EM LINHA Q=5,93 L/s · H=70 mca (~10CV), PHID-029 sem modelo'),
 'm05':(666.20,'MultHidro 0045119 (TE TFF100x80)'),
 'm06':(6333.04,'Hidroluna 39285, item 47 (Ventosa tríplice DN100)'),
 'm07':(579.82,'MultHidro 0045119 (TE TFF80x80)'),
 'm08':(1679.95,'MultHidro 0045119 (TUBO-FLS 80x700 AV)'),
 'm09':(110.69,'Hidroluna 39285, item 50 (Colarinho PEAD DE90)'),
 'm10':(1917.00,'A2 — válvula guilhotina DN80 (conferir)'),
 'm11':(997.55,'A2 — tubo FD K9 DN80 (PHID-029: 1,26m DN150 + 0,94m DN80 — conferir)'),
 'm12':(647.00,'Ferpac-Salvati 0739, item 10 (Extremidade FD PF 700mm DN80)'),
 'm13':(338.00,'MultHidro 0045119 (CURVA C22FF 80)'),
 'm14':(733.85,'MultHidro 0045119 (TUBO PTA 80x1000)'),
 'm15':(None,'PENDENTE cotação — conj. motobomba SUBMERSÍVEL drenagem 22,9 m³/h (PHID-029 item 16)'),
 'm16':(112.86,'A2 — PPR DE90'),
 'm17':(645.94,'A2 — PPR DE90'),
 'm18':(731.16,'A2 — PPR DE90'),
 'm19':(503.09,'A2 — PPR DE90'),
 'm20':(372.03,'Hidroluna 39285, item 62 (Flange aço carbono DE160 DN150)'),
 'm21':(182.63,'Hidroluna 39285, item 61 (Flange aço carbono DE90 DN80)'),
 'm22':(103.67,'A2 — kit'),
 'm23':(137.61,'A2 — kit'),
 'm24':(103.67,'A2 — kit'),
 'm25':(103.67,'A2 — kit (PHID-029: kit DN100 x4)'),
 'm26':(135.11,'A2 — kit'),
 'm27':(200.21,'A2 — kit inox DN150'),
 'e_cxinsp':(56.87,'A2 — PENDENTE PELE correta'),
 'e_eqp':(497.65,'A2 — PENDENTE PELE correta'),
 'e_cabo25':(9.00,'A2 — PENDENTE PELE correta'),
 'e_term':(7.06,'A2 — PENDENTE PELE correta'),
 'e_chv':(387.20,'A2 — PENDENTE PELE correta'),
}

# Overrides de preço no ORÇAMENTO (linha A2 -> valor). 81=0 -> bomba PENDENTE (fora do total).
PRICE_UPD = {79:520.00, 81:0.0, 83:6333.04, 89:647.00, 90:338.00}

# Zera o BLOCO ELÉTRICO no orçamento (pendente PELE correta). Linhas conferidas no dump da A3.
QTY_UPD = {r:0 for r in (
    144,145,147,148,           # abrigo metálico, painel QCM, entrada energia, caixa medição
    162,163,164,165,           # eletrodutos/cabos instalação
    167,168,171,172,           # mão de obra predial/eletricista
    174,176,178,179,181,       # eletrodutos PEAD/aço, caixas alumínio, caixa concreto
    183,185,187,189,190,       # cabo nu, haste aterr., split-bolt, cabos cobre
    192,193,194,195,196,       # instrumentação, caixa inspeção, terminal, equipot., chave nível
    198,199,201,202,203,       # valas + assentamento eletroduto/cabo, instal. haste
    205,207,                   # instalação poste, poste concreto
)}

# Rua de TERRA -> SEM pavimentação asfáltica.
EXTRA_BLOCK = None
