# Test Suite — parseOse.js

Suite de testes pra prevenir regressões nos parsers de DXF/XLSX. Histórico mostra que esses arquivos viraram fonte de hotfixes (v2.10.10, v2.10.13, v2.13.0, v2.36.9 etc) — todos preveníveis com testes.

## Setup (no repo)

```bash
cd D:\PROGRAMAÇÃO\NEXUS
npm install --save-dev vitest
```

Adicionar no `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Copiar pasta `02-tests/` pra raiz do repo como `tests/`:
```
tests/
├── fixtures/         # DXFs e XLSXs reais (anonimizados se sensíveis)
├── parseOse.test.js
├── oseStatus.test.js
└── helpers.js
```

Adicionar `vitest.config.js` na raiz (criado abaixo).

## Estratégia de fixtures

**Princípio:** cada bug que já aconteceu vira um teste com fixture mínima.

| Bug histórico | Versão fix | Fixture sugerida | Asserção |
|---|---|---|---|
| 5 falsos-positivos OSE | v2.10.10 | DXF + XLSX OSE-077 PA1 (PUBLICADO) | parser não acusa erro |
| MTEXT multi-linha "0.0224\n2.24%" | v2.10.13 | DXF perfil PA1-OSE-X com declaração quebrada | declividade extraída = 0.0224 |
| Degrau invertido (PV-024 PA-04) | v2.36.9 | DXF perfil + XLSX | degrau = 0.03 (não 0.17) |
| OSE letra (590A, 573B) | v2.19.6 | XLSX com 2 abas OSE-590 e OSE-590A | parser distingue ambas |
| DXF binário ao invés de ASCII | v2.13.0 | header binário primeiros bytes | retorna erro claro, não crash |
| Blocos órfãos A$C/*D | v2.15.x | DXF com bloco sem INSERT | parser ignora bloco |
| TQ implícito (cf_ch > cf_pv) | v2.20.0 | XLSX 2 linhas mesmo PV | tq detectado |

## Como criar uma fixture nova

1. Reproduzir o bug com arquivo do cliente
2. **Reduzir o arquivo** ao mínimo que ainda reproduz:
   - DXF: deletar layers/blocos/entidades não-essenciais até ficar <100KB
   - XLSX: 1 aba, 1 OSE, 5 PVs no máximo
3. **Anonimizar:** remover nomes de cidade/cliente, trocar por TESTE-XX
4. Salvar em `fixtures/<categoria>/<bug-id>.dxf`
5. Escrever teste em `tests/parseOse.test.js` que carrega a fixture e afirma o comportamento correto

## Cobertura mínima desejada

- `normalizeId` — 100%, é puro
- `cleanMtext` / `extractGiTubo` — testes de regex; vários inputs históricos
- `parseMapaDxf` — fixture simples (1 OSE, 3 PVs)
- `parsePerfisDxf` — fixture simples + fixture de cada bug histórico de declividade
- `parseExcel` — fixture com 1 aba OSE-NNN + edge cases (OSE-NNNA, sufixos)
- `buildComparison` — testes integrados com fixtures combinadas

## Rodar

```bash
npm test            # roda tudo
npm test -- parseOse  # só parseOse
npm run test:watch    # watch mode durante dev
```
