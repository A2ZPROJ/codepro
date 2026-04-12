# Nexus Price Scraper

Scraper automático das tabelas de preço usadas pelo Nexus (SANEPAR, SINAPI, EMOP).
Roda como GitHub Action agendado no dia 1 de cada mês — mas dá pra disparar
manualmente via `gh workflow run`.

## Estrutura

```
scripts/scraper/
├── index.js              Orquestrador (CLI)
├── lib/
│   ├── sanepar.js        SANEPAR MOS 5ª Ed. (scrape HTML + unzip)
│   ├── sinapi.js         SINAPI (padrão de URL Caixa por mês)
│   ├── xlsxParser.js     Parser genérico de tabela de preço
│   └── supabase.js       Cliente admin + upsert idempotente
└── package.json
```

## Rodar localmente (dry-run)

```bash
cd scripts/scraper
npm install
node index.js --dry-run               # tudo
node index.js --only=sanepar --dry-run # só uma fonte
```

`--dry-run` não escreve nada no banco — só baixa, parseia e loga os 3 primeiros itens.

## Rodar localmente de verdade (escrevendo no Supabase)

Precisa ter a `SUPABASE_SERVICE_ROLE_KEY` no ambiente:

```bash
export SUPABASE_SERVICE_ROLE_KEY='eyJ...'   # a service_role, NÃO a anon
node index.js --only=sanepar
```

⚠️ **Nunca** commite a chave. Ela só vive em `GitHub Secrets` e (se necessário)
como variável de ambiente temporária no seu terminal.

## Disparar o workflow no GitHub

```bash
# Tudo em dry-run
gh workflow run update_price_tables.yml -R A2ZPROJ/codepro -f dry_run=true

# Só SANEPAR, de verdade
gh workflow run update_price_tables.yml -R A2ZPROJ/codepro -f only=sanepar

# Ver status
gh run list --workflow=update_price_tables.yml -R A2ZPROJ/codepro

# Ver log do último run
gh run view --log -R A2ZPROJ/codepro
```

## Agendamento

Cron: `0 8 1 * *` — dia 1 de cada mês, 08:00 UTC (05:00 BRT).

Para desativar temporariamente, comenta a seção `schedule:` no `.github/workflows/update_price_tables.yml`.

## Comportamento de upsert

- Idempotente: se já existe uma `tabelas_preco` com mesmo `(fonte, data_ref, uf)`, pula.
- Quando cria uma versão nova, **desativa as anteriores** da mesma fonte/UF
  (marca `ativo=false`).
- Os orçamentos já criados **não são afetados** — eles guardam snapshot do item.

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| `ZIP download HTTP 404` | SANEPAR mudou a URL do MOS | Rodar `node index.js --only=sanepar` com `DEBUG=1` e olhar o HTML retornado; ajustar o regex em `lib/sanepar.js` |
| `Cabeçalho não encontrado` | Nova planilha com headers diferentes | Abrir o XLSX, ver os nomes dos headers, adicionar no regex de `xlsxParser.js` |
| `SINAPI Nenhum ZIP encontrado` | Caixa mudou o padrão de nome | Verificar manualmente em https://www.caixa.gov.br/site/Paginas/downloads.aspx e atualizar `lib/sinapi.js:buildUrl` |
| `SUPABASE_SERVICE_ROLE_KEY não está no ambiente` | Secret não configurado | `gh secret set SUPABASE_SERVICE_ROLE_KEY -R A2ZPROJ/codepro` |
