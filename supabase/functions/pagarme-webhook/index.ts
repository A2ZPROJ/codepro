// supabase/functions/pagarme-webhook/index.ts
// Recebe webhooks do Pagar.me e chama RPCs no banco pra atualizar
// assinaturas e registrar pagamentos.
//
// Variáveis de ambiente (set no Supabase Dashboard → Edge Functions → Manage secrets):
//   - PAGARME_WEBHOOK_SECRET (opcional): se setado, valida HMAC do body
//   - SUPABASE_URL (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Endpoint público — Pagar.me chama POST sem auth header customizado.
// Verify JWT deve estar DESLIGADO na configuração da function.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAGARME_WEBHOOK_SECRET = Deno.env.get('PAGARME_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isUuid(s: any): boolean {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function verifyHmac(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!PAGARME_WEBHOOK_SECRET) return true; // sem secret configurado: aceita
  if (!signatureHeader) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(PAGARME_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const hex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const provided = signatureHeader.replace(/^sha256=/, '').trim().toLowerCase();
    return provided === hex;
  } catch (e) {
    console.error('[webhook] verifyHmac error', e);
    return false;
  }
}

async function tenantFromEvent(event: any): Promise<string | null> {
  // 1) metadata.tenant_id (preferido)
  const md =
    event?.data?.metadata ||
    event?.data?.subscription?.metadata ||
    event?.data?.charge?.metadata;
  if (md?.tenant_id && isUuid(md.tenant_id)) return md.tenant_id;

  // 2) lookup por gateway_sub_id
  const subId = event?.data?.subscription?.id || event?.data?.id;
  if (subId) {
    try {
      const { data } = await sb
        .from('assinaturas')
        .select('tenant_id')
        .eq('gateway_sub_id', subId)
        .limit(1);
      if (data && data.length && isUuid(data[0].tenant_id)) return data[0].tenant_id;
    } catch (e) { console.warn('[webhook] lookup tenant', e); }
  }
  return null;
}

// Dispara email transacional via send-email (fire-and-forget)
async function fireEmail(type: string, to: string | null | undefined, vars: any) {
  if (!to) return;
  try {
    const url = SUPABASE_URL + '/functions/v1/send-email';
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, type, vars,
        internal_secret: SUPABASE_SERVICE_ROLE_KEY,
      }),
    });
  } catch (e) { console.warn('[webhook] fireEmail falhou:', e); }
}

// Acha o email do master do tenant pra notificar
async function masterEmailOfTenant(tenantId: string): Promise<string | null> {
  const { data } = await sb
    .from('usuarios')
    .select('email, nome')
    .eq('tenant_id', tenantId)
    .eq('role', 'master')
    .eq('ativo', true)
    .is('deleted_at', null)
    .order('criado_em', { ascending: true })
    .limit(1);
  return data?.[0]?.email || null;
}

async function handleEvent(event: any): Promise<{ ok: boolean; msg: string; details?: any }> {
  const type: string = event?.type || event?.event || '';
  console.log('[webhook] recebido:', type);

  const tenantId = await tenantFromEvent(event);

  // Sem tenant_id: não conseguimos atrelar — retorna sucesso com aviso
  // (pra não fazer Pagar.me reentregar — o evento não é nosso)
  if (!tenantId) {
    return { ok: true, msg: 'evento sem tenant_id atrelado (ignorado)', details: { type } };
  }

  try {
    if (type === 'charge.paid' || type === 'subscription.charges_paid') {
      const charge = event.data?.charge || event.data;
      const valor = (charge?.amount || charge?.paid_amount || 0) / 100;
      const metodo = charge?.payment_method || 'pagarme';
      const gatewayPgtoId = charge?.id || event.data?.id;
      const dataPgto = (charge?.paid_at || charge?.created_at || new Date().toISOString()).slice(0, 10);
      const nextBilling = charge?.subscription?.next_billing_at?.slice(0, 10) || null;

      const { error } = await sb.rpc('super_record_pagamento', {
        p_caller_code: '__system__',
        p_tenant_id: tenantId,
        p_valor: valor,
        p_metodo: metodo,
        p_data_pgto: dataPgto,
        p_proximo_venc: nextBilling,
        p_gateway: 'pagarme',
        p_gateway_pgto_id: gatewayPgtoId,
        p_obs: 'Webhook automático Pagar.me',
      });
      if (error) return { ok: false, msg: 'super_record_pagamento: ' + error.message };

      // Email de confirmação ao master do tenant
      const masterEmail = event?.data?.customer?.email || await masterEmailOfTenant(tenantId);
      const planoTxt = event?.data?.subscription?.metadata?.plano || event?.data?.metadata?.plano || 'Nexus';
      fireEmail('payment_received', masterEmail, {
        valor, plano: planoTxt, metodo, proximo_venc: nextBilling, gateway_pgto_id: gatewayPgtoId,
      });

      return { ok: true, msg: 'pagamento registrado' };
    }

    if (type === 'charge.payment_failed' || type === 'subscription.charges_unpaid') {
      const { error } = await sb
        .from('assinaturas')
        .update({ status: 'em_atraso', atualizada_em: new Date().toISOString() })
        .eq('tenant_id', tenantId);
      if (error) return { ok: false, msg: 'update assinatura: ' + error.message };

      // Email de aviso ao master
      const masterEmail = event?.data?.customer?.email || await masterEmailOfTenant(tenantId);
      const charge = event.data?.charge || event.data;
      const valor = (charge?.amount || 0) / 100;
      const motivo = charge?.last_transaction?.gateway_response?.errors?.[0]?.message
        || charge?.status_reason
        || 'cobrança não foi processada';
      fireEmail('payment_failed', masterEmail, {
        valor, plano: 'Nexus', motivo,
      });

      return { ok: true, msg: 'status em_atraso' };
    }

    if (type === 'subscription.canceled') {
      const { error } = await sb
        .from('assinaturas')
        .update({
          status: 'cancelado',
          cancelada_em: new Date().toISOString(),
          cancelada_motivo: event.data?.cancel_reason || 'webhook',
          atualizada_em: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);
      if (error) return { ok: false, msg: 'update assinatura: ' + error.message };
      return { ok: true, msg: 'assinatura cancelada' };
    }

    if (type === 'subscription.created') {
      const sub = event.data?.subscription || event.data;
      const valor = (sub?.amount || 0) / 100;
      const proximoVenc = sub?.next_billing_at?.slice(0, 10) || null;
      const plano = sub?.metadata?.plano || sub?.plan?.name || 'desconhecido';
      const subId = sub?.id;

      const { error } = await sb.rpc('super_upsert_assinatura', {
        p_caller_code: '__system__',
        p_tenant_id: tenantId,
        p_plano: plano,
        p_status: 'ativo',
        p_valor: valor,
        p_ciclo: sub?.interval === 'year' ? 'anual' : 'mensal',
        p_proximo_venc: proximoVenc,
        p_obs: 'Criada via webhook · sub_id=' + subId,
      });
      if (error) return { ok: false, msg: 'super_upsert_assinatura: ' + error.message };
      if (subId) {
        await sb.from('assinaturas')
          .update({ gateway: 'pagarme', gateway_sub_id: subId })
          .eq('tenant_id', tenantId);
      }
      return { ok: true, msg: 'assinatura criada' };
    }

    return { ok: true, msg: 'evento ignorado: ' + type };
  } catch (e: any) {
    console.error('[webhook] handleEvent throw', e);
    return { ok: false, msg: 'exception: ' + (e?.message || e) };
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Content-Type': 'text/plain' } });
  }

  // Wrap geral pra nunca retornar 500 sem JSON body
  try {
    const rawBody = await req.text();
    const sigHeader =
      req.headers.get('pagarme-signature') ||
      req.headers.get('x-pagarme-signature') ||
      req.headers.get('x-hub-signature-256') ||
      req.headers.get('x-hub-signature');

    const valid = await verifyHmac(rawBody, sigHeader);
    if (!valid) {
      console.warn('[webhook] HMAC inválido — rejeitando');
      return new Response(JSON.stringify({ ok: false, msg: 'invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch {
      return new Response(JSON.stringify({ ok: false, msg: 'invalid json' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await handleEvent(event);
    console.log('[webhook] resultado:', result);
    // Sempre devolve 200 quando tem resposta — Pagar.me não retenta.
    // Erros de processamento ficam logados mas não geram retry infinito.
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[webhook] outer catch', e);
    return new Response(JSON.stringify({ ok: false, msg: 'fatal: ' + (e?.message || e) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
});
