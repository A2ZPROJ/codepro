// supabase/functions/parse-holerite/index.ts
// Le um espelho de holerite (imagem ou PDF) com Claude (visao) e devolve os
// lancamentos estruturados (proventos + descontos + totais + competencia) em JSON,
// prontos pra aba Financeiro do Nexus lancar no cofre local.
//
// Variaveis de ambiente (Supabase -> Edge Functions -> Manage secrets):
//   - ANTHROPIC_API_KEY (sk-ant-api03-...)   [obrigatoria]
//   - HOLERITE_MODEL (opcional, default claude-sonnet-4-6)
//
// Verify JWT deve estar DESLIGADO (chamada via apikey anon do app, igual send-email).
//
// Request  (POST, JSON): { image_base64, media_type, caller_code? }
//   media_type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
// Response (JSON): { ok, competencia, lancamentos:[{tipo,descricao,valor,categoria}], totais, raw }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = Deno.env.get('HOLERITE_MODEL') || 'claude-sonnet-4-6';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// Categorias validas no Financeiro do Nexus (devem casar com financeiro.js).
const CAT_ENTRADA = ['Salário', 'Pró-labore', 'Freelance / Extra', 'Rendimentos', 'Dividendos', 'Outras receitas'];
const CAT_SAIDA = ['Moradia', 'Contas/Utilidades', 'Educação', 'Saúde', 'Impostos', 'Funcionários', 'Seguros', 'Alimentação', 'Diversos'];

// Schema de saida estruturada (output_config.format) — a API obriga o modelo a devolver isso.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    competencia: { type: 'string', description: 'Mes/ano de competencia no formato MM/AAAA. Se nao houver, string vazia.' },
    data: { type: 'string', description: 'Data de pagamento/referencia no formato AAAA-MM-DD se identificavel, senao string vazia.' },
    funcionario: { type: 'string', description: 'Nome do funcionario, se visivel.' },
    cargo: { type: 'string', description: 'Cargo, se visivel.' },
    lancamentos: {
      type: 'array',
      description: 'Uma linha por provento (entrada) e por desconto (saida) do holerite.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tipo: { type: 'string', enum: ['entrada', 'saida'] },
          descricao: { type: 'string', description: 'Descricao da verba (ex: Salario base, INSS, IRRF, Vale alimentacao).' },
          valor: { type: 'number', description: 'Valor em reais, numero positivo com ponto decimal (ex: 4500.00).' },
          categoria: { type: 'string', description: 'Categoria do Nexus. Entradas use Salário. Descontos: INSS/IRRF=Impostos, vale alimentacao=Alimentação, adiantamento=Diversos, demais=Diversos.' },
        },
        required: ['tipo', 'descricao', 'valor', 'categoria'],
      },
    },
    totais: {
      type: 'object',
      additionalProperties: false,
      properties: {
        proventos: { type: 'number' },
        descontos: { type: 'number' },
        liquido: { type: 'number' },
      },
      required: ['proventos', 'descontos', 'liquido'],
    },
  },
  required: ['competencia', 'data', 'funcionario', 'cargo', 'lancamentos', 'totais'],
};

const SYSTEM = [
  'Voce extrai dados de espelhos de holerite/contracheque brasileiros (folha de pagamento CLT).',
  'Regras:',
  '- PROVENTOS / vencimentos (marcados P, coluna de proventos) viram lancamentos tipo "entrada".',
  '- DESCONTOS (marcados D, coluna de descontos: INSS, IRRF/IR, vale, adiantamento salarial, etc) viram tipo "saida".',
  '- Ignore linhas APENAS informativas (ex: Base INSS, Base FGTS, Valor FGTS, Base IRRF) — nao sao lancamentos.',
  '- valor sempre positivo, ponto como separador decimal, sem simbolo de moeda.',
  '- Confira: soma proventos - soma descontos = liquido. Se as parcelas nao baterem com o total de descontos impresso, ajuste a leitura dos digitos (ex: 683,59 vs 683,50) para fechar a conta.',
  '- categoria: entradas = "Salário". Descontos: INSS e IRRF/IR = "Impostos"; vale alimentacao/refeicao = "Alimentação"; adiantamento salarial = "Diversos"; demais = "Diversos".',
  '- Devolva SOMENTE o JSON do schema.',
].join('\n');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return jsonResponse({ ok: false, error: 'ANTHROPIC_API_KEY ausente nos secrets' }, 500);

  let payload: { image_base64?: string; media_type?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'json_invalido' }, 400);
  }
  const { image_base64, media_type } = payload;
  if (!image_base64 || !media_type) return jsonResponse({ ok: false, error: 'faltou image_base64/media_type' }, 400);

  // PDF entra como bloco "document"; imagem como bloco "image".
  const isPdf = media_type === 'application/pdf';
  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image_base64 } }
    : { type: 'image', source: { type: 'base64', media_type, data: image_base64 } };

  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          sourceBlock,
          { type: 'text', text: 'Extraia os lancamentos deste holerite seguindo o schema.' },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  };

  let aiResp: Response;
  try {
    aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: 'falha_rede_anthropic', detalhe: String(e) }, 502);
  }

  if (!aiResp.ok) {
    const t = await aiResp.text();
    return jsonResponse({ ok: false, error: 'anthropic_erro', status: aiResp.status, detalhe: t.slice(0, 800) }, 502);
  }

  const data = await aiResp.json();
  if (data.stop_reason === 'refusal') {
    return jsonResponse({ ok: false, error: 'recusado', detalhe: data.stop_details || null }, 422);
  }

  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text');
  if (!textBlock?.text) return jsonResponse({ ok: false, error: 'sem_saida', raw: data }, 502);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return jsonResponse({ ok: false, error: 'json_modelo_invalido', raw: textBlock.text }, 502);
  }

  // Saneamento leve: garante categorias validas e numeros positivos.
  const lancs = Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [];
  const limpos = lancs.map((l: Record<string, unknown>) => {
    const tipo = l.tipo === 'saida' ? 'saida' : 'entrada';
    const validas = tipo === 'entrada' ? CAT_ENTRADA : CAT_SAIDA;
    let categoria = String(l.categoria || '');
    if (!validas.includes(categoria)) categoria = tipo === 'entrada' ? 'Salário' : 'Diversos';
    return {
      tipo,
      descricao: String(l.descricao || '').slice(0, 120),
      valor: Math.abs(Number(l.valor) || 0),
      categoria,
    };
  }).filter((l) => l.valor > 0);

  const ent = limpos.filter((l) => l.tipo === 'entrada').reduce((a, l) => a + l.valor, 0);
  const sai = limpos.filter((l) => l.tipo === 'saida').reduce((a, l) => a + l.valor, 0);

  return jsonResponse({
    ok: true,
    competencia: String(parsed.competencia || ''),
    data: String(parsed.data || ''),
    funcionario: String(parsed.funcionario || ''),
    cargo: String(parsed.cargo || ''),
    lancamentos: limpos,
    totais: {
      proventos: Number((parsed.totais as Record<string, unknown>)?.proventos) || ent,
      descontos: Number((parsed.totais as Record<string, unknown>)?.descontos) || sai,
      liquido: Number((parsed.totais as Record<string, unknown>)?.liquido) || (ent - sai),
    },
    calc: { proventos: ent, descontos: sai, liquido: ent - sai },
  });
});
