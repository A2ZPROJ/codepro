# Clone MD-048 → Memorial PO-01 (estilo Acciona/E-Água) — one-off 29/06/2026

Gera o Memorial Descritivo do **SB-PO1 / PO-01 (Ubiratã)** clonando o timbrado/layout/fontes/estrutura
do `MD-048-GER-PB-PBEN-02-R0.docx` (que é do SB-PA1). NÃO é o gerador padrão do Nexus —
é uma adaptação direta por `python-docx` em cima do .docx do MD-048.

## Arquivos
- `clone_md048_po01.py` — script principal. Copia o MD-048, troca identidade PA1→PO1, mantém
  coeficientes/parâmetros (project-wide), substitui quantitativos pelos do PO-01, marca [A PREENCHER]
  em amarelo o que é PA1-específico, troca as figuras (Mapa1 localização, Mapa6 3D) e preenche
  T8 (PV 685/TL 64/TQ 35/Ligações 1.754/TOTAL 749) e T9 (faixas de profundidade das OSE, total 35.215,99).
- `faixas_prof_ose.py` — calcula extensão por faixa de profundidade das 6 OSE (prof média por segmento, col 19).
- `dump_md048_full.py` — despeja o corpo do MD-048 (parágrafos + tabelas) p/ inspeção.

## Fontes (caminhos hardcoded no script)
- MD-048: `\\2s-eng-servidor\maringa\PLANILHAS FINAIS\UBIRATÃ\PO-01\SBB-01\MD-048-GER-PB-PBEN-02-R0.docx`
- OSE (6 soltas): `\\2s-eng-servidor\maringa\PLANILHAS FINAIS\UBIRATÃ\PO-01\*.xlsx`
- Mapas: `Área de Trabalho\_extracao\mapas\Mapa1_Localizacao.png` e `Mapa6_3D_Topografia.png`
- Saída: `Área de Trabalho\Memorial_Descritivo_Ubirata_PO-01_modelo-Acciona-R0.docx`

## Dados preenchidos (PO-01)
- Rede por DN: DN150 PVC 34.916,39 + DN200 PVC 299,60 = 35.215,99 m
- PV 685 / TL 64 / TQ 35 / Ligações 1.754 / TOTAL dispositivos 749 (contagem manual por bacia + OSE)
- Profundidade: 1,25→5.014,31 · 2,00→23.872,43 · 3,00→4.862,75 · 4,00→1.242,76 · 5,00→223,74 (reconciliado a 35.215,99)

## Falta preencher manual (marcado [A PREENCHER])
Estudo de população/vazão do SB-PO1 (T3.1), soleiras (T3.2), rede existente (T3.4), travessia,
índice de atendimento, vazão pontual, datas/aprovador da revisão, código do doc.

Ver memória `nexus-memorial-descritivo-gerador` e `reference-travessia-der-pr`.
