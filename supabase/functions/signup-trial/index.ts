// supabase/functions/signup-trial/index.ts
// Cadastro self-service de tenant trial. Endpoint público (sem auth).
//
// Variáveis de ambiente (auto):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Verify JWT precisa estar DESLIGADO (chamada pública sem auth).
//
// Rate-limit básico por IP via memória in-process (10 cadastros / hora / IP).
// Pra produção, considerar Upstash ou Supabase rate-limit nativo.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// Rate-limit em memória — 10 cadastros / hora / IP
const ipBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (bucket.count >= 10) return false;
  bucket.count++;
  return true;
}

interface SignupPayload {
  nome_empresa: string;
  email: string;
  cnpj?: string;
  nome_master: string;
  // honeypot anti-bot — campo escondido no form, sempre vazio se humano
  website?: string;
}

async function fireWelcomeEmail(to: string, vars: any) {
  try {
    await fetch(SUPABASE_URL + '/functions/v1/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, type: 'welcome', vars,
        internal_secret: SUPABASE_SERVICE_ROLE_KEY,
      }),
    });
  } catch (e) { console.warn('[signup] welcome falhou:', e); }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, msg: 'Method not allowed' }, 405);
  }

  // Rate-limit por IP (cf-connecting-ip ou x-forwarded-for)
  const ip = req.headers.get('cf-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ ok: false, msg: 'Muitas tentativas. Espera 1 hora.' }, 429);
  }

  try {
    const payload: SignupPayload = await req.json();

    // Honeypot — bot preenche o campo "website" porque é invisível pra humano.
    if (payload.website && payload.website.length > 0) {
      console.log('[signup] honeypot triggered IP=', ip);
      // Resposta de sucesso falsa pra não dar feedback ao bot
      return jsonResponse({ ok: true, msg: 'cadastro recebido' }, 200);
    }

    // Validações básicas no Edge antes de bater no DB
    if (!payload.nome_empresa || payload.nome_empresa.trim().length < 2) {
      return jsonResponse({ ok: false, msg: 'Nome da empresa inválido' }, 400);
    }
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return jsonResponse({ ok: false, msg: 'E-mail inválido' }, 400);
    }
    if (!payload.nome_master || payload.nome_master.trim().length < 2) {
      return jsonResponse({ ok: false, msg: 'Nome do responsável inválido' }, 400);
    }

    const { data, error } = await sb.rpc('signup_trial_tenant', { p_data: payload });
    if (error) {
      return jsonResponse({ ok: false, msg: error.message }, 400);
    }

    // Welcome email (fire-and-forget)
    fireWelcomeEmail(data.email, {
      nome: data.nome_master,
      access_code: data.access_code,
      empresa: data.nome_empresa,
      role: 'master',
      license_expires: data.trial_ate,
      trial: true,
    });

    return jsonResponse({
      ok: true,
      tenant_id: data.tenant_id,
      access_code: data.access_code,
      email: data.email,
      trial_ate: data.trial_ate,
    });
  } catch (e: any) {
    console.error('[signup] erro:', e);
    return jsonResponse({ ok: false, msg: e?.message || String(e) }, 200);
  }
});
