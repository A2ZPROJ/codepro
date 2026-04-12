// Cliente Supabase com service_role (bypass RLS) + helpers de upsert
'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://xszpzsmdpbgaiodeqcpi.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY não está no ambiente. ' +
      'Configure em GitHub Secrets ou .env local.'
  );
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cria a tabela_preco + insere todos os itens (em chunks).
// É idempotente: se já existe tabela com mesmo (fonte, data_ref, uf), pula.
// Se criar uma nova versão, desativa as anteriores da mesma fonte/uf.
async function upsertTabela(meta, items) {
  const { fonte, nome, data_ref, uf, descricao } = meta;

  // 1) Checa se já existe
  let q = sb
    .from('tabelas_preco')
    .select('id, nome')
    .eq('fonte', fonte)
    .eq('data_ref', data_ref);
  q = uf ? q.eq('uf', uf) : q.is('uf', null);
  const { data: existing, error: e0 } = await q.maybeSingle();
  if (e0 && e0.code !== 'PGRST116') throw e0;
  if (existing) {
    console.log(
      `[${fonte}] Já existe tabela para ${data_ref} (id=${existing.id}, nome="${existing.nome}"). Pulando.`
    );
    return { created: false, id: existing.id, skipped: true };
  }

  // 2) Desativa versões anteriores da mesma fonte/uf
  let upd = sb
    .from('tabelas_preco')
    .update({ ativo: false })
    .eq('fonte', fonte)
    .eq('ativo', true);
  upd = uf ? upd.eq('uf', uf) : upd.is('uf', null);
  await upd;

  // 3) Insere a nova tabela
  const { data: tab, error: e1 } = await sb
    .from('tabelas_preco')
    .insert({ fonte, nome, data_ref, uf, descricao, ativo: true })
    .select('*')
    .single();
  if (e1) throw e1;

  console.log(`[${fonte}] Tabela criada (id=${tab.id}). Inserindo ${items.length} itens...`);

  // 4) Insere itens em chunks
  const chunkSize = 500;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize).map(it => ({
      tabela_id: tab.id,
      codigo: it.codigo,
      descricao: it.descricao,
      unidade: it.unidade,
      valor_unitario: it.valor_unitario,
      nivel: it.nivel,
    }));
    const { error: e2 } = await sb.from('itens_tabela').insert(chunk);
    if (e2) {
      console.error(`[${fonte}] Erro no chunk ${i}:`, e2);
      throw e2;
    }
    const done = Math.min(i + chunkSize, items.length);
    console.log(`[${fonte}] ${done}/${items.length} itens inseridos`);
  }

  return { created: true, id: tab.id, items: items.length };
}

module.exports = { sb, upsertTabela };
