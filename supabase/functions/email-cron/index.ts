// supabase/functions/email-cron/index.ts
// Cron diário: dispara emails de lembrete de pagamento e fim de trial.
//
// Variáveis de ambiente (auto):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Verify JWT pode ficar LIGADO — esta função só é chamada pelo Scheduler do
// Supabase (que envia o anon key automaticamente) ou via cron interno com
// SERVICE_ROLE.
//
// Configuração do cron (no Dashboard → Database → Cron jobs):
//   schedule: '0 13 * * *'  (diário às 13:00 UTC = 10:00 BRT)
//   command : SELECT net.http_post(
//               url := 'https://<ref>.supabase.co/functions/v1/email-cron',
//               headers := jsonb_build_object('Authorization', 'Bearer <ANON_KEY>'),
//               body := '{}'::jsonb
//             );

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function fireEmail(type: string, to: string, vars: any) {
  if (!to) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/functions/v1/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, type, vars,
        internal_secret: SUPABASE_SERVICE_ROLE_KEY,
      }),
    });
    return r.ok;
  } catch (e) {
    console.warn('[email-cron] fireEmail falhou:', e);
    return false;
  }
}

// Pega master ativo do tenant (1º criado, garante que mesmo trocando masters
// existe alguém pra notificar)
async function masterEmailOfTenant(tenantId: string): Promise<{ email: string; nome: string } | null> {
  const { data } = await sb
    .from('usuarios')
    .select('email, nome')
    .eq('tenant_id', tenantId)
    .eq('role', 'master')
    .eq('ativo', true)
    .is('deleted_at', null)
    .not('email', 'is', null)
    .order('criado_em', { ascending: true })
    .limit(1);
  if (!data?.[0]?.email) return null;
  return { email: data[0].email, nome: data[0].nome || '' };
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// ── Job 1: payment_reminder — assinaturas ativas com próximo vencimento em 5 dias ──
async function jobPaymentReminders(): Promise<{ checked: number; sent: number }> {
  const target = new Date();
  target.setDate(target.getDate() + 5);
  const targetIso = target.toISOString().slice(0, 10);

  const { data: assinaturas } = await sb
    .from('assinaturas')
    .select('tenant_id, plano, valor, ciclo, proximo_venc, status')
    .eq('status', 'ativo')
    .eq('proximo_venc', targetIso);

  if (!assinaturas || assinaturas.length === 0) {
    return { checked: 0, sent: 0 };
  }

  let sent = 0;
  for (const a of assinaturas) {
    const m = await masterEmailOfTenant(a.tenant_id);
    if (!m) continue;
    const ok = await fireEmail('payment_reminder', m.email, {
      nome: m.nome,
      plano: a.plano,
      valor: a.valor,
      ciclo: a.ciclo,
      proximo_venc: a.proximo_venc,
      dias_restantes: 5,
    });
    if (ok) sent++;
  }
  return { checked: assinaturas.length, sent };
}

// ── Job 2: trial_ending — tenants em trial com expira_em em 3 dias ──
async function jobTrialEnding(): Promise<{ checked: number; sent: number }> {
  const target = new Date();
  target.setDate(target.getDate() + 3);
  const targetIso = target.toISOString().slice(0, 10);

  const { data: tenants } = await sb
    .from('tenants')
    .select('id, nome, plano, trial_ate, ativo')
    .eq('ativo', true)
    .eq('plano', 'trial')
    .eq('trial_ate', targetIso);

  if (!tenants || tenants.length === 0) {
    return { checked: 0, sent: 0 };
  }

  let sent = 0;
  for (const t of tenants) {
    const m = await masterEmailOfTenant(t.id);
    if (!m) continue;
    const ok = await fireEmail('trial_ending', m.email, {
      nome: m.nome,
      tenant_nome: t.nome,
      trial_ate: t.trial_ate,
      dias_restantes: 3,
    });
    if (ok) sent++;
  }
  return { checked: tenants.length, sent };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const reminders = await jobPaymentReminders();
    const trial = await jobTrialEnding();
    const result = {
      ok: true,
      executed_at: new Date().toISOString(),
      payment_reminders: reminders,
      trial_ending: trial,
    };
    console.log('[email-cron]', JSON.stringify(result));
    return jsonResponse(result);
  } catch (e: any) {
    console.error('[email-cron] erro', e);
    return jsonResponse({ ok: false, msg: e?.message || String(e) }, 200);
  }
});
