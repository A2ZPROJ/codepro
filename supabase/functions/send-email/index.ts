// supabase/functions/send-email/index.ts
// Envia emails transacionais via Resend.
// Suporta 6 tipos: welcome, payment_received, payment_failed, payment_reminder, trial_ending, lembrete.
//
// Variáveis de ambiente (Supabase → Edge Functions → Manage secrets):
//   - RESEND_API_KEY (re_...)
//   - SUPABASE_URL (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Verify JWT precisa estar DESLIGADO (chamada via service_role do webhook ou
// via caller_code do app).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FROM_DEFAULT = 'Nexus <nexus@send.a2zprojetos.com.br>';
const REPLY_TO = 'lucas.abdala@a2zprojetos.com.br';

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

function fmtBrl(v: number): string {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(typeof d === 'string' ? d.length === 10 ? d + 'T00:00:00' : d : d).toLocaleDateString('pt-BR');
  } catch { return String(d); }
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// — Layout base HTML reutilizado em todos os emails —
function layout(title: string, body: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta = ctaUrl
    ? `<tr><td align="center" style="padding:24px 0">
         <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">${esc(ctaLabel || 'Acessar')}</a>
       </td></tr>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:30px 12px">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <tr><td style="padding:24px 32px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff">
        <div style="font-size:22px;font-weight:800;letter-spacing:-.5px">Ne<span style="color:#93c5fd">x</span>us</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px">A2Z Projetos · Saneamento</div>
      </td></tr>
      <tr><td style="padding:32px;color:#0f172a;font-size:14px;line-height:1.6">
        <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${esc(title)}</h1>
        ${body}
        ${cta}
      </td></tr>
      <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6">
        <div>Email automático · não responda esta mensagem.<br>Em caso de dúvida fale com <a href="mailto:${REPLY_TO}" style="color:#2563eb">${REPLY_TO}</a>.</div>
        <div style="margin-top:8px">© 2026 A2Z Projetos · Nexus · CNPJ 57.729.984/0001-63</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// — Templates por tipo —
function tplWelcome(v: any) {
  const title = 'Bem-vindo ao Nexus, ' + (v.nome?.split(' ')[0] || '') + '!';
  const body = `
    <p>Sua conta foi criada com sucesso. Você já pode começar a usar o Nexus pra gerenciar seus projetos executivos de saneamento.</p>
    <p><strong>Seu código de acesso:</strong></p>
    <div style="background:#f1f5f9;padding:12px 16px;border-radius:6px;font-family:monospace;font-size:18px;font-weight:700;text-align:center;letter-spacing:2px">${esc(v.access_code)}</div>
    <p style="margin-top:18px">Guarde esse código em local seguro — é com ele que você acessa o sistema.</p>
    <h3 style="margin:24px 0 8px;font-size:15px">Próximos passos:</h3>
    <ol style="margin:8px 0;padding-left:20px">
      <li>Baixe o Nexus em: <a href="https://github.com/A2ZPROJ/codepro/releases/latest" style="color:#2563eb">github.com/A2ZPROJ/codepro/releases</a></li>
      <li>Instale e abra o aplicativo</li>
      <li>No primeiro login, digite seu nome completo + código de acesso</li>
    </ol>
  `;
  return { subject: title, html: layout(title, body, 'https://github.com/A2ZPROJ/codepro/releases/latest', 'Baixar Nexus') };
}

function tplPaymentReceived(v: any) {
  const title = 'Pagamento confirmado · ' + fmtBrl(v.valor);
  const body = `
    <p>Recebemos seu pagamento de <strong>${fmtBrl(v.valor)}</strong>. Sua assinatura está ativa.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:18px 0;border-collapse:collapse">
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b">Plano</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">${esc(v.plano || '—')}</td></tr>
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b">Valor</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">${fmtBrl(v.valor)}</td></tr>
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b">Método</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${esc(v.metodo || '—')}</td></tr>
      <tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b">Próximo vencimento</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${fmtDate(v.proximo_venc)}</td></tr>
      ${v.gateway_pgto_id ? `<tr><td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b">ID transação</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-family:monospace;font-size:11px">${esc(v.gateway_pgto_id)}</td></tr>` : ''}
    </table>
    <p>Obrigado pela confiança no Nexus.</p>
  `;
  return { subject: title, html: layout(title, body) };
}

function tplPaymentFailed(v: any) {
  const title = 'Falha no pagamento da assinatura';
  const body = `
    <p>Não conseguimos processar a cobrança da sua assinatura Nexus.</p>
    <p><strong>Plano:</strong> ${esc(v.plano || '—')}<br>
    <strong>Valor:</strong> ${fmtBrl(v.valor || 0)}<br>
    <strong>Motivo provável:</strong> ${esc(v.motivo || 'cartão recusado, saldo insuficiente, ou dados inválidos')}</p>
    <p>Você tem <strong>15 dias</strong> pra regularizar antes que o acesso seja suspenso. Se for cartão, atualize os dados ou troque o método de pagamento.</p>
    <p>Em caso de dúvida, responda este email ou fale com <strong>${REPLY_TO}</strong>.</p>
  `;
  return { subject: title, html: layout(title, body) };
}

function tplPaymentReminder(v: any) {
  const title = 'Sua assinatura Nexus vence em ' + (v.dias || 5) + ' dias';
  const body = `
    <p>Lembrete amigável: sua assinatura Nexus vence em <strong>${esc(v.dias || 5)} dias</strong> (${fmtDate(v.proximo_venc)}).</p>
    <p><strong>Plano:</strong> ${esc(v.plano || '—')}<br>
    <strong>Valor:</strong> ${fmtBrl(v.valor || 0)}</p>
    <p>O pagamento será cobrado automaticamente no método cadastrado. Se você usa boleto/PIX, você receberá o link separadamente.</p>
    <p>Pra mudar plano ou método de pagamento, abra o Nexus e vá em <strong>Sobre → Meu plano</strong>.</p>
  `;
  return { subject: title, html: layout(title, body) };
}

function tplTrialEnding(v: any) {
  const title = 'Seu trial Nexus termina em ' + (v.dias || 3) + ' dias';
  const body = `
    <p>Seu período de teste do Nexus termina em <strong>${esc(v.dias || 3)} dias</strong> (${fmtDate(v.trial_ate)}).</p>
    <p>Pra continuar usando depois disso, escolha um plano:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:14px 0;border-collapse:collapse">
      <tr><td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0"><strong>Solo</strong> · 1-2 usuários · ${fmtBrl(299)}/mês</td></tr>
      <tr><td style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe"><strong>Time</strong> · 3-8 usuários · ${fmtBrl(799)}/mês <span style="color:#16a34a;font-size:11px;font-weight:600;margin-left:6px">⭐ MAIS POPULAR</span></td></tr>
      <tr><td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0"><strong>Empresa</strong> · 9+ usuários · ${fmtBrl(1800)}/mês</td></tr>
    </table>
    <p>Anual com 17% de desconto.</p>
    <p>Pra escolher o plano, abra o Nexus e vá em <strong>Sobre → Escolha seu plano</strong>.</p>
  `;
  return { subject: title, html: layout(title, body) };
}

function tplLembrete(v: any) {
  const title = v.titulo || 'Lembrete';
  const body = `
    <p>Você recebeu um lembrete de <strong>${esc(v.remetente_nome || 'um colega')}</strong> via Nexus:</p>
    <div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin:18px 0">
      <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px">${esc(title)}</div>
      ${v.descricao ? `<div style="font-size:14px;color:#334155;line-height:1.6;white-space:pre-line">${esc(v.descricao)}</div>` : ''}
    </div>
    <p style="font-size:13px;color:#64748b">Este é um lembrete automático. Se não era esperado, desconsidere.</p>
  `;
  return { subject: 'Lembrete: ' + (v.titulo || '—'), html: layout(title, body) };
}

const TEMPLATES: Record<string, (v: any) => { subject: string; html: string }> = {
  welcome: tplWelcome,
  payment_received: tplPaymentReceived,
  payment_failed: tplPaymentFailed,
  payment_reminder: tplPaymentReminder,
  trial_ending: tplTrialEnding,
  lembrete: tplLembrete,
};

interface SendPayload {
  to: string | string[];
  type: keyof typeof TEMPLATES;
  vars?: Record<string, any>;
  reply_to?: string;
  bcc?: string | string[];
  caller_code?: string;       // se vier do app, valida user
  internal_secret?: string;   // se vier de outra Edge Function (webhook), passa SUPABASE_SERVICE_ROLE_KEY
}

async function authorize(payload: SendPayload, req: Request): Promise<boolean> {
  // 1) chamada interna de outra Edge Function (webhook usa service role)
  if (payload.internal_secret && payload.internal_secret === SUPABASE_SERVICE_ROLE_KEY) return true;

  // 2) chamada do app — valida caller_code
  if (payload.caller_code) {
    const { data, error } = await sb
      .from('usuarios')
      .select('id, role, ativo, deleted_at')
      .eq('access_code', payload.caller_code)
      .single();
    if (error || !data || !data.ativo || data.deleted_at) return false;
    return true; // qualquer user autenticado pode disparar (templates seguros)
  }
  return false;
}

async function sendViaResend(to: string | string[], subject: string, html: string, replyTo?: string, bcc?: string | string[]) {
  const body: any = {
    from: FROM_DEFAULT,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    reply_to: replyTo || REPLY_TO,
  };
  if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body: json, raw: text };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return jsonResponse({ ok: false, msg: 'method not allowed' }, 405);

  if (!RESEND_API_KEY) return jsonResponse({ ok: false, msg: 'RESEND_API_KEY não configurado' }, 500);

  try {
    const payload: SendPayload = await req.json();
    if (!payload.to || !payload.type) return jsonResponse({ ok: false, msg: 'campos obrigatórios: to, type' }, 400);

    const ok = await authorize(payload, req);
    if (!ok) return jsonResponse({ ok: false, msg: 'não autorizado' }, 401);

    const tpl = TEMPLATES[payload.type];
    if (!tpl) return jsonResponse({ ok: false, msg: 'template desconhecido: ' + payload.type }, 400);

    const { subject, html } = tpl(payload.vars || {});
    const r = await sendViaResend(payload.to, subject, html, payload.reply_to, payload.bcc);

    if (!r.ok) {
      console.error('[send-email] Resend rejeitou:', r.status, r.raw);
      return jsonResponse({ ok: false, msg: 'Resend ' + r.status, detail: r.body }, 200);
    }

    // Log local de envio
    try {
      await sb.from('auditoria_eventos').insert({
        event_type: 'email_sent',
        payload: { type: payload.type, to: payload.to, resend_id: r.body?.id },
      });
    } catch {}

    return jsonResponse({ ok: true, id: r.body?.id, type: payload.type });
  } catch (e: any) {
    console.error('[send-email] erro', e);
    return jsonResponse({ ok: false, msg: 'fatal: ' + (e?.message || e) }, 200);
  }
});
