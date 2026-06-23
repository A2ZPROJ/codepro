// supabase/functions/pagarme-checkout/index.ts
// Cria customer + subscription no Pagar.me a partir de uma subscription_intent
// e retorna URL/dados de pagamento (PIX/boleto). Cartão fica pra Fase tokenize.
//
// Variáveis de ambiente (Supabase Dashboard → Edge Functions → Manage secrets):
//   - PAGARME_SECRET_KEY (Sandbox: sk_test_...; Live: sk_live_...)
//   - SUPABASE_URL (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Verify JWT precisa estar DESLIGADO (cliente chama com anon key).
// Auth: a função valida via p_caller_code igual as outras RPCs.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAGARME_SECRET_KEY = Deno.env.get('PAGARME_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PAGARME_BASE = 'https://api.pagar.me/core/v5';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function basicAuth(secretKey: string): string {
  const token = btoa(secretKey + ':');
  return 'Basic ' + token;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function pagarmePost(path: string, body: any) {
  const r = await fetch(`${PAGARME_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': basicAuth(PAGARME_SECRET_KEY),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body: json, raw: text };
}

async function pagarmeGet(path: string) {
  const r = await fetch(`${PAGARME_BASE}${path}`, {
    method: 'GET',
    headers: { 'Authorization': basicAuth(PAGARME_SECRET_KEY) },
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body: json, raw: text };
}

// Cache do primeiro recipient ativo da conta (evita listar a cada request)
let cachedRecipientId: string | null = null;
async function getDefaultRecipientId(): Promise<string | null> {
  if (cachedRecipientId) return cachedRecipientId;
  try {
    const r = await pagarmeGet('/recipients?status=active&size=10');
    const list = r.body?.data || [];
    // Pega o 1º ativo (geralmente é o único da conta)
    const active = list.find((x: any) => x.status === 'active' && x.id?.startsWith('re_'));
    if (active) {
      cachedRecipientId = active.id;
      console.log('[checkout] recipient ativo descoberto:', cachedRecipientId);
      return cachedRecipientId;
    }
  } catch (e) {
    console.warn('[checkout] falha ao listar recipients:', e);
  }
  return null;
}

interface CheckoutPayload {
  caller_code: string;
  intent_id: string;
  customer: {
    name: string;
    email: string;
    document: string;       // CPF (11) ou CNPJ (14)
    document_type?: 'CPF' | 'CNPJ';
    phone_area?: string;    // ex: '44'
    phone_number?: string;  // ex: '999998888'
    address?: {
      line_1: string;
      line_2?: string;
      zip_code: string;
      city: string;
      state: string;
      country?: string;
    };
  };
  payment_method: 'pix' | 'boleto' | 'credit_card';
  card_token?: string;  // tokenizado client-side via Pagar.me /tokens (PCI-DSS)
  card?: {              // fallback legado — só pra debug; produção usa card_token
    number: string;
    holder_name: string;
    exp_month: number;
    exp_year: number;
    cvv: string;
  };
}

async function loadIntent(intentId: string) {
  const { data, error } = await sb
    .from('subscription_intents')
    .select('*, tenants:tenant_id(*)')
    .eq('id', intentId)
    .single();
  if (error) throw new Error('intent não encontrada: ' + error.message);
  return data;
}

async function loadCallerUser(callerCode: string) {
  const { data, error } = await sb
    .from('usuarios')
    .select('id, nome, role, tenant_id, ativo, deleted_at, is_trial_user, is_super_admin')
    .eq('access_code', callerCode)
    .single();
  if (error || !data) throw new Error('caller não autenticado');
  if (!data.ativo || data.deleted_at) throw new Error('caller inativo');
  // Decisão produto 2026-05-04: clientes não são master. Aceita master,
  // super_admin, trial user ou tenant em trial.
  let allowed = data.role === 'master' || data.is_super_admin === true || data.is_trial_user === true;
  if (!allowed && data.tenant_id) {
    const { data: t } = await sb.from('tenants').select('plano').eq('id', data.tenant_id).single();
    if (t?.plano === 'trial') allowed = true;
  }
  if (!allowed) throw new Error('usuário sem permissão pra criar checkout');
  return data;
}

async function createCustomer(customer: CheckoutPayload['customer'], tenantId: string) {
  const docType = customer.document_type ||
    (customer.document.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ');
  const documents = [{
    type: docType,
    number: customer.document.replace(/\D/g, ''),
  }];
  const phones = (customer.phone_area && customer.phone_number) ? {
    mobile_phone: {
      country_code: '55',
      area_code: customer.phone_area,
      number: customer.phone_number.replace(/\D/g, ''),
    },
  } : {};
  const body = {
    name: customer.name,
    email: customer.email,
    code: 'tenant_' + tenantId,
    document: customer.document.replace(/\D/g, ''),
    document_type: docType.toLowerCase(),
    type: docType === 'CNPJ' ? 'company' : 'individual',
    documents,
    phones,
    address: customer.address,
    metadata: { tenant_id: tenantId },
  };
  const r = await pagarmePost('/customers', body);
  if (!r.ok) throw new Error('Pagar.me /customers ' + r.status + ': ' + r.raw);
  return r.body;
}

function planoPriceCents(plano: string, ciclo: string): number {
  // Preços em centavos. IDs novos + aliases legados.
  const base: Record<string, number> = {
    essencial: 19900, profissional: 69900, empresarial: 170000,
    solo: 19900, time: 69900, empresa: 170000,
  };
  const v = base[plano] || 0;
  // Anual = 12 meses × 0.8 (20% off)
  return ciclo === 'anual' ? Math.round(v * 9.6) : v;
}

async function createSubscription(intent: any, customer: any, paymentMethod: 'pix' | 'boleto' | 'credit_card', card?: CheckoutPayload['card'], cardToken?: string) {
  const valorCents = Math.round(intent.valor_final * 100);
  const interval = intent.ciclo === 'anual' ? 'year' : 'month';
  const tenantId = intent.tenant_id;

  // Pagar.me v5 não aceita PIX em subscription — só boleto/credit_card/cash/debit_card.
  // Pra PIX recorrente, teria que ser Order avulsa por mês. Fallback: boleto.
  const subPaymentMethod = paymentMethod === 'pix' ? 'boleto' : paymentMethod;

  const body: any = {
    code: 'sub_' + intent.id.slice(0, 8) + '_' + Date.now(),
    customer_id: customer.id,
    payment_method: subPaymentMethod,
    interval, interval_count: 1,
    billing_type: 'prepaid',
    items: [{
      description: `Nexus ${intent.plano} (${intent.ciclo})`,
      quantity: 1,
      pricing_scheme: { scheme_type: 'Unit', price: valorCents },
    }],
    metadata: { tenant_id: tenantId, intent_id: intent.id, plano: intent.plano },
  };

  if (subPaymentMethod === 'boleto') {
    body.boleto_due_days = 5;
  }

  if (subPaymentMethod === 'credit_card') {
    // Preferimos card_token (tokenizado client-side, PCI-DSS compliant).
    // Fallback pra `card` direto só se não vier token (sandbox/legado).
    const billingAddress = customer.address || (customer as any)?.address;
    if (cardToken) {
      body.card_token = cardToken;
      // Pagar.me v5 exige billing_address mesmo com card_token —
      // o token só carrega number/cvv, billing precisa vir na subscription.
      body.card = { billing_address: billingAddress };
    } else if (card) {
      body.card = {
        number: card.number,
        holder_name: card.holder_name,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        cvv: card.cvv,
        billing_address: billingAddress,
      };
    } else {
      throw new Error('card_token ou dados de cartão obrigatórios');
    }
    body.installments = 1;
  }

  console.log('[checkout] /subscriptions body enviado:', JSON.stringify(body));
  const r = await pagarmePost('/subscriptions', body);
  console.log('[checkout] /subscriptions retorno status', r.status, 'ok=', r.ok);
  console.log('[checkout] /subscriptions raw resp:', r.raw?.slice(0, 2000));
  if (!r.ok) throw new Error('Pagar.me /subscriptions ' + r.status + ': ' + r.raw);

  // Pagar.me v5 cria a charge async — pode não estar pronta na resposta.
  const subscription = r.body;
  subscription._debug = { initial_status: subscription.status, attempts: [] };

  if (subscription?.id) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const attLog: any = { n: attempt };
      try {
        // Tenta 2 endpoints — /subscriptions/{id}/charges e /charges?subscription_id={id}
        let charges: any[] = [];
        const a = await pagarmeGet(`/subscriptions/${subscription.id}/charges`);
        attLog.subCharges_status = a.status;
        attLog.subCharges_count = a.body?.data?.length || 0;
        if (a.body?.data?.length) charges = a.body.data;

        if (!charges.length) {
          const b = await pagarmeGet(`/charges?subscription_id=${subscription.id}`);
          attLog.altCharges_status = b.status;
          attLog.altCharges_count = b.body?.data?.length || 0;
          if (b.body?.data?.length) charges = b.body.data;
        }

        if (charges.length) {
          const chargeId = charges[0]?.id;
          attLog.charge_id = chargeId;
          if (chargeId) {
            const chargeFull = await pagarmeGet(`/charges/${chargeId}`);
            const ch = chargeFull.body || charges[0];
            attLog.charge_status = ch?.status;
            attLog.tx_status = ch?.last_transaction?.status;
            subscription.current_charge = ch;
            if (ch?.last_transaction?.status && ch.last_transaction.status !== 'processing') {
              subscription._debug.attempts.push(attLog);
              console.log('[checkout] charge pronta tentativa', attempt, ch.last_transaction.status);
              break;
            }
          }
        }
      } catch (e: any) {
        attLog.error = e?.message || String(e);
        console.warn('[checkout] tentativa', attempt, 'erro:', e);
      }
      subscription._debug.attempts.push(attLog);
      if (attempt < 6) await new Promise(res => setTimeout(res, 1000));
    }
  }
  return subscription;
}

// Cria Order avulsa com PIX (1ª cobrança) + opcionalmente subscription pra
// recorrência via boleto começando no próximo ciclo.
async function createPixOrderPlusSubscription(intent: any, customer: any) {
  const valorCents = Math.round(intent.valor_final * 100);
  const tenantId = intent.tenant_id;

  // Pagar.me v5 exige split com recipient explícito quando a conta não tem
  // default recipient. Como a conta tem 1 único recipient, usamos ele direto.
  const recipientId = await getDefaultRecipientId();

  const pixPayment: any = {
    payment_method: 'pix',
    pix: { expires_in: 3600 },
  };
  if (recipientId) {
    pixPayment.split = [{
      recipient_id: recipientId,
      amount: valorCents,
      type: 'flat',
      options: {
        charge_processing_fee: true,
        charge_remainder_fee: true,
        liable: true,
      },
    }];
  }

  // 1) Order PIX pra cobrança imediata
  const orderBody = {
    code: 'ord_' + intent.id.slice(0, 8) + '_' + Date.now(),
    customer_id: customer.id,
    items: [{
      description: `Nexus ${intent.plano} (1ª mensalidade via PIX)`,
      quantity: 1,
      amount: valorCents,
    }],
    payments: [pixPayment],
    metadata: { tenant_id: tenantId, intent_id: intent.id, plano: intent.plano, kind: 'first_payment' },
  };
  const orderR = await pagarmePost('/orders', orderBody);
  if (!orderR.ok) throw new Error('Pagar.me /orders ' + orderR.status + ': ' + orderR.raw);
  return orderR.body;
}

function extractCheckoutInfo(subscription: any) {
  const cycle = subscription?.current_cycle;
  // Pagar.me v5 retorna `current_charge` na criação da subscription
  // (current_cycle.charges é populado depois assincronamente)
  const charge = subscription?.current_charge
    || cycle?.charges?.[0]
    || cycle?.charge
    || subscription?.charges?.[0];
  const tx = charge?.last_transaction;
  const boletoUrl =
    tx?.url ||
    tx?.pdf ||
    tx?.boleto?.url ||
    tx?.boleto_url ||
    charge?.boleto?.url ||
    charge?.boleto_url ||
    null;
  const boletoBarcode =
    tx?.line ||
    tx?.barcode ||
    tx?.boleto?.line ||
    tx?.boleto?.barcode ||
    charge?.boleto?.line ||
    charge?.boleto?.barcode ||
    null;
  const boletoDueAt =
    tx?.due_at ||
    tx?.boleto?.due_at ||
    charge?.due_at ||
    charge?.boleto?.due_at ||
    null;
  return {
    subscription_id: subscription?.id,
    subscription_status: subscription?.status,
    charge_id: charge?.id,
    payment_method: charge?.payment_method,
    amount: charge?.amount,
    status: charge?.status || tx?.status,
    pix_qr_code: tx?.qr_code,
    pix_qr_code_url: tx?.qr_code_url,
    pix_expires_at: tx?.expires_at,
    boleto_url: boletoUrl,
    boleto_barcode: boletoBarcode,
    boleto_due_at: boletoDueAt,
    next_billing_at: subscription?.next_billing_at,
    debug_last_transaction: tx,
    debug_charge: charge,
    debug_polling: subscription?._debug,
  };
}

function extractOrderCheckoutInfo(order: any) {
  const charge = order?.charges?.[0];
  const tx = charge?.last_transaction;
  // Pagar.me v5 às vezes coloca o QR direto em last_transaction, outras vezes
  // num sub-objeto (pix, qr, additional_information). Tenta vários paths.
  const qrCode =
    tx?.qr_code ||
    tx?.pix?.qr_code ||
    tx?.qr?.code ||
    charge?.qr_code ||
    null;
  const qrUrl =
    tx?.qr_code_url ||
    tx?.pix?.qr_code_url ||
    tx?.qr?.url ||
    charge?.qr_code_url ||
    null;
  const expiresAt =
    tx?.expires_at ||
    tx?.pix?.expires_at ||
    tx?.expiration_date ||
    null;
  return {
    order_id: order?.id,
    charge_id: charge?.id,
    payment_method: charge?.payment_method,
    amount: charge?.amount,
    status: charge?.status || tx?.status,
    pix_qr_code: qrCode,
    pix_qr_code_url: qrUrl,
    pix_expires_at: expiresAt,
    boleto_url: tx?.url || tx?.pdf,
    boleto_barcode: tx?.line || tx?.barcode,
    boleto_due_at: tx?.due_at,
    // Debug: mantém a transação inteira pra inspecionar se algo faltar
    debug_last_transaction: tx,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, msg: 'Method not allowed' }, 405);
  }

  if (!PAGARME_SECRET_KEY) {
    return jsonResponse({ ok: false, msg: 'PAGARME_SECRET_KEY não configurado' }, 500);
  }

  try {
    const payload: CheckoutPayload = await req.json();
    if (!payload.caller_code || !payload.intent_id || !payload.customer) {
      return jsonResponse({ ok: false, msg: 'payload incompleto' }, 400);
    }

    const caller = await loadCallerUser(payload.caller_code);
    const intent = await loadIntent(payload.intent_id);
    if (intent.tenant_id !== caller.tenant_id) {
      return jsonResponse({ ok: false, msg: 'intent fora do seu tenant' }, 403);
    }
    if (intent.status !== 'pendente') {
      return jsonResponse({ ok: false, msg: 'intent já processada (status=' + intent.status + ')' }, 409);
    }

    const customer = await createCustomer(payload.customer, intent.tenant_id);

    let checkout: any;
    let pagarmeId: string;

    if (payload.payment_method === 'pix') {
      const order = await createPixOrderPlusSubscription(intent, customer);
      checkout = extractOrderCheckoutInfo(order);
      pagarmeId = order.id;
    } else {
      const sub = await createSubscription(intent, customer, payload.payment_method, payload.card, payload.card_token);
      checkout = extractCheckoutInfo(sub);
      pagarmeId = sub.id;
    }

    await sb.from('subscription_intents').update({
      status: 'checkout_criado',
      pagarme_sub_id: pagarmeId,
      checkout_url: checkout.boleto_url || checkout.pix_qr_code_url || null,
      atualizada_em: new Date().toISOString(),
    }).eq('id', intent.id);

    return jsonResponse({ ok: true, ...checkout });
  } catch (e: any) {
    console.error('[checkout] erro', e);
    return jsonResponse({ ok: false, msg: e?.message || String(e) }, 200);
  }
});
