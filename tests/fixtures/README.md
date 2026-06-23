# Fixtures

**Convenção:** cada bug histórico vira uma fixture nomeada `<categoria>_<bug-id>.dxf` ou `.xlsx`.

## A criar (priorizadas)

| Arquivo | Origem do bug | Tamanho-alvo | Descrição |
|---|---|---|---|
| `mapa_ose005_simples.dxf` | sintético | <5KB | 1 OSE, 3 PVs, layers SES-TXT |
| `mapa_letra_590a.dxf` | v2.19.6 | <10KB | OSE-590 + OSE-590A no mesmo DXF |
| `mapa_orphan_blocks.dxf` | v2.15.x | <20KB | DXF com blocos A$C... e *D... sem INSERT |
| `mapa_dxf_binario.dxf` | v2.13.0 | <5KB | header binário AutoCAD |
| `perfil_decl_multilinha.dxf` | v2.10.13 | <30KB | MTEXT "0.0224\n2.24%" |
| `perfil_degrau_pa04.dxf` | v2.36.9 | ~50KB | PV-024 PA-04 OSE-023 (anonimizar) |
| `xlsx_ose077_pa1.xlsx` | v2.10.10 | ~20KB | 5 falsos-positivos resolvidos |
| `xlsx_tq_implicito.xlsx` | v2.20.0 | ~10KB | PV com cf_ch != cf_pv |
| `xlsx_letra_a.xlsx` | v2.19.6 | ~15KB | abas OSE-590 e OSE-590A |

## Como anonimizar
- DXFs: abrir no AutoCAD/Civil → renomear blocos identificáveis → save as
- XLSX: abrir → trocar nome cliente/cidade por TESTE-XX → save as
- Sempre verificar que o arquivo continua reproduzindo o bug antes de commitar

## Como reduzir tamanho
- DXF: rodar `_PURGE` (lixo de revisão), depois `WBLOCK *` selecionando só as entidades necessárias
- XLSX: deletar abas não usadas, deletar linhas vazias, salvar como .xlsx (não .xlsm)
