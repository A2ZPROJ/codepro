# -*- coding: utf-8 -*-
"""RASCUNHO com ELÉTRICO GRANDE da PELE-029 "como está" — só p/ ter NOÇÃO de custo.
ATENÇÃO: a PELE-029 está provavelmente CONTAMINADA (descreve 2x75CV + subestação aérea
112,5 kVA + transformador + disjuntor 300A; carimbo "UBIRATÃ"; incompatível com a hidráulica
de ~10CV). Este rascunho precifica esse elétrico grande MESMO ASSIM, a pedido do Lucas, pra
estimar a ordem de grandeza. NÃO é orçamento final. Preços: SANEPAR onde há; senão internet/
SINAPI/estimativa (jun/2026), cada material com seu serviço. O PAINEL QCM é o item de MAIOR
incerteza (estimado ~130k — fornecimento do fabricante da elevatória).

Igual ao parcial (SB-A3_Mandaguacu.py): estrutura, sítio sem asfalto, bomba ZERADA (pendente
cotação ~10CV). Diferença: o bloco elétrico SANEPAR pequeno segue ZERADO (QTY_UPD) e o elétrico
grande entra como EXTRA_BLOCK estimado. Total final = recalculado (custo passa de 150k -> BDI
cai p/ 24,49%/12,99%)."""
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
PRICE_UPD = {79:520.00, 81:0.0, 83:6333.04, 89:647.00, 90:338.00}
# bloco elétrico SANEPAR pequeno ZERADO (substituído pelo elétrico grande no EXTRA_BLOCK)
QTY_UPD = {r:0 for r in (
    144,145,147,148,162,163,164,165,167,168,171,172,
    174,176,178,179,181,183,185,187,189,190,192,193,194,195,196,198,199,201,202,203,205,207,
)}

# ELÉTRICO GRANDE PELE-029 — ESTIMATIVA. Código na coluna B: SANEPAR onde existe;
# 19043+ (padrão de cotação do A2) p/ itens que a SANEPAR não tem. Em ordem por grupo SANEPAR.
EXTRA_BLOCK = {
 'titulo': 'INSTALAÇÕES ELÉTRICAS — PELE-029 (SUBESTAÇÃO 112,5 kVA / 2x75 CV) — ESTIMATIVA',
 'itens': [
   # --- Entrada de energia / subestação aérea (equipamentos: sem código SANEPAR -> 19xxx)
   ('19043','Transformador trifásico distribuição 112,5 kVA 13,8kV-220/127V, a óleo','Mat','Internet (Siemetrafo/ML)',1,'un',21000.00),
   ('19044','Conj. subestação aérea: poste concreto 10,5m/600daN, cruzeta, 3 para-raios, isoladores, ferragens, mãos-francesas, caixas medição/disjuntor/TC','Mat','Internet/estimativa',1,'cj',11200.00),
   ('19045','Disjuntor de caixa moldada tripolar 300 A','Mat','Internet (Steck/Metaltex)',1,'un',1500.00),
   ('042016010','Caixa para equipamentos de medição, padrão Copel','Mat','Sanepar',1,'ud',80.43),
   ('040018015','Instalação de poste','MO','Sanepar',1,'un',406.95),
   ('19046','Montagem da subestação aérea + instalação do transformador (eletricista MT)','MO','Estimativa',1,'cj',8500.00),
   # --- Painel de comando (sem código SANEPAR -> 19xxx)
   ('19047','Painel QCM p/ 2x75 CV c/ 2 inversores 55 kW + CLP S7-1200 + IHM (fornec. fabricante)','Mat','COTAÇÃO ESTIMADA — alta incerteza',1,'un',130000.00),
   # --- Cabos (SANEPAR só até 25 mm²; 95/70 mm² -> 19xxx internet)
   ('19048','Cabo de cobre 95 mm² 0,6/1kV EPR (alimentador entrada->QCM)','Mat','Internet (~111/m)',96,'m',111.00),
   ('19049','Cabo de cobre 70 mm² 0,6/1kV EPR (QCM->motores)','Mat','Internet (estimativa)',70,'m',82.00),
   ('042007018','Cabo de cobre nu 50 mm² (aterramento)','Mat','Sanepar',20,'m',55.85),
   ('013005035','Condutor isolado - cabo 25 mm² (aterramento subestação)','Mat','Sanepar',24,'m',31.23),
   ('013005031','Condutor isolado - cabo 4,0 mm² (drenagem)','Mat','Sanepar',30,'m',4.86),
   ('042009034','Cabo de controle blindado p/ instrumentação','Mat','Sanepar/A2',10,'m',9.76),
   # --- Eletrodutos
   ('042024005','Eletroduto de aço galvanizado a fogo, pesado (4" + 1")','Mat','Sanepar',48,'m',232.65),
   ('042026052','Eletroduto Kanalex PEAD corrugado (4" + 2")','Mat','Sanepar',9,'m',8.58),
   ('013007009','Eletroduto rígido (PVC 3"/2"/1"/¾")','Mat','Sanepar',60,'m',28.49),
   # --- Conduletes / caixas
   ('042011035','Condulete alumínio LB 4"','Mat','Sanepar',14,'ud',63.26),
   ('042011036','Condulete alumínio T','Mat','Sanepar',3,'ud',69.58),
   ('042050002','Caixa de passagem concreto pré-fabricada 0,40×0,40×0,40 m','Mat','Sanepar',2,'ud',379.99),
   # --- Aterramento
   ('013005064','Haste de aterramento 5/8" × 3,0 m','Mat','Sanepar',7,'ud',72.12),
   # --- Mão de obra
   ('040018090','Eletricista industrial','MO','Sanepar',528,'h',51.44),
   ('040018091','Ajudante de eletricista','MO','Sanepar',528,'h',38.54),
   ('19050','Comissionamento e startup 2 CMB (1+1) c/ CLP','MO','Estimativa',1,'vb',12000.00),
 ],
}
