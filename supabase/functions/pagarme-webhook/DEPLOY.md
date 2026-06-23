# Deploy da Edge Function `pagarme-webhook`

## Caminho mais simples — via Dashboard Supabase

1. Abre https://supabase.com/dashboard/project/xszpzsmdpbgaiodeqcpi/functions
2. Clica em **"Deploy a new function"** (ou **"Create a new function"**)
3. Nome: `pagarme-webhook`
4. Cola o conteúdo de `index.ts` (deste mesmo diretório)
5. Clica em **"Deploy function"**

## Configurar variáveis de ambiente (Secrets)

Após o deploy:
1. Ainda em Edge Functions → **Manage secrets**
2. Adiciona:
   - **PAGARME_WEBHOOK_SECRET** = (deixa em branco por enquanto; você vai pegar quando criar o webhook no Pagar.me)
3. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm setados por padrão.

## URL da função

Após deploy, a URL será:

```
https://xszpzsmdpbgaiodeqcpi.supabase.co/functions/v1/pagarme-webhook
```

Use essa URL no Pagar.me Dashboard:
**Configurações → Webhooks → Novo webhook → URL**

## Eventos a marcar no Pagar.me

- `charge.paid` (ou `subscription.charges_paid`)
- `charge.payment_failed` (ou `subscription.charges_unpaid`)
- `subscription.canceled`
- `subscription.created`

## Após criar webhook no Pagar.me

O Pagar.me vai gerar um **Webhook Secret** (formato `whsec_...` ou similar).

1. Copia o secret
2. Volta no Supabase → Edge Functions → Manage secrets
3. Atualiza `PAGARME_WEBHOOK_SECRET` com o valor

## Testar

No Pagar.me Dashboard, na página do webhook que você criou, tem botão **"Enviar teste"**. Clica → manda um evento dummy → verifica logs no Supabase Dashboard → Edge Functions → Logs.

Se aparecer:
- 401 Invalid signature → secret está errado
- 200 OK + `{"ok":true,"msg":"evento ignorado: ..."}` → tudo funcionando

## Alternativa via CLI (mais técnico)

```bash
npm install -g supabase
supabase login
supabase link --project-ref xszpzsmdpbgaiodeqcpi
supabase functions deploy pagarme-webhook
supabase secrets set PAGARME_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```
