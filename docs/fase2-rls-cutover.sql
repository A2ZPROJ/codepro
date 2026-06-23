-- =====================================================================
-- NEXUS — FASE 2: CUTOVER RLS (isolamento real por empresa via claim JWT)
-- =====================================================================
-- Gerado/validado em 2026-05-30 (transações com ROLLBACK contra dados reais:
--   projetos: 2S=88 / A2Z=0 / super=88 / anon=0
--   usuarios: 2S=8 / anon=0 / super=todas
--   tenants:  2S=1 / anon=0 / super=2)
--
-- *** PRÉ-REQUISITO OBRIGATÓRIO ***
-- A nova versão do app (com signInWithPassword no init() — "Step B") deve estar
-- PUBLICADA e TODOS os usuários atualizados ANTES de rodar este script.
-- Caso contrário o app antigo (que usa role anon) para de enxergar os dados.
--
-- Mecanismo: cada usuário tem um Supabase Auth user com app_metadata.tenant_id
-- (já criados). O app autentica por código -> JWT carrega tenant_id -> a RLS lê:
--   tenant_id::text = claims.app_metadata.tenant_id   OU   app_metadata.is_super_admin
--
-- Tabelas billing/RPC-only (assinaturas, pagamentos, subscription_intents,
-- user_presence, auditoria_eventos, cupons_uso) ficam SEM policy (já negam acesso
-- direto; o app usa via RPC SECURITY DEFINER). NÃO mexer.
-- =====================================================================

-- ---------- CUTOVER ----------
do $$
declare
  t text;
  pol record;
  expr text := '(tenant_id::text = (current_setting(''request.jwt.claims'',true)::jsonb->''app_metadata''->>''tenant_id'') '
             || 'or coalesce((current_setting(''request.jwt.claims'',true)::jsonb->''app_metadata''->>''is_super_admin'')::boolean,false))';
  tenant_tables text[] := array[
    'bdi_templates','catalogo_subitens','codigos','demandas','empresas_equipe',
    'estoque_em_uso','estoque_empresas','estoque_fornecedores','estoque_fotos',
    'estoque_inventario_linhas','estoque_inventarios','estoque_items','estoque_locais',
    'estoque_movimentos','estoque_pedido_itens','estoque_pedidos','estoque_reservas',
    'estoque_responsaveis','estoque_setores','frotas_veiculos','grds','itens_tabela',
    'lembretes','obras_diarios','obras_medicoes','obras_nao_conformidades','obras_vistorias',
    'orcamento_itens','orcamentos','ose_snapshots','programas_acessos','projeto_atividade',
    'projetos','responsaveis','reunioes','rh_funcionarios','rh_holerites','tabelas_preco'
  ];
  -- tabelas-filhas SEM tenant_id (escopo via JOIN no pai = FASE C2; por ora só negam anon)
  child_tables text[] := array[
    'estoque_alertas_dispensados','frotas_abastecimentos','frotas_uso_historico',
    'frotas_veiculo_fotos','obras_diario_fotos','obras_medicao_itens','obras_nc_fotos',
    'obras_vistoria_comodos','obras_vistoria_fotos','obras_vistoria_itens',
    'reunioes_transcricoes','rh_documentos','rh_eventos','rh_lancamentos','sondagem_data',
    'equipe_apontamento_manual','equipe_status'
  ];
begin
  -- 1) tabelas com tenant_id -> policy por claim (deny anon)
  foreach t in array tenant_tables loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy tenant_claim on public.%I for all to authenticated using (%s) with check (%s)', t, expr, expr);
  end loop;

  -- 2) tabelas-filhas -> só authenticated (bloqueia anon cru). Tenant-scope via pai = FASE C2.
  foreach t in array child_tables loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy authd_only on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 3) usuarios (credenciais) — claim, FOR ALL
drop policy if exists usuarios_select on usuarios;
drop policy if exists usuarios_no_anon_select on usuarios;
drop policy if exists usuarios_insert on usuarios;
drop policy if exists usuarios_update on usuarios;
create policy u_claim on usuarios for all to authenticated using (
  tenant_id::text = (current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'tenant_id')
  or coalesce((current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'is_super_admin')::boolean,false)
) with check (
  tenant_id::text = (current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'tenant_id')
  or coalesce((current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'is_super_admin')::boolean,false)
);

-- 4) tenants — claim, FOR SELECT (escritas via RPC SECURITY DEFINER)
drop policy if exists tenants_anon_read on tenants;
create policy t_claim on tenants for select to authenticated using (
  id::text = (current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'tenant_id')
  or coalesce((current_setting('request.jwt.claims',true)::jsonb->'app_metadata'->>'is_super_admin')::boolean,false)
);

-- =====================================================================
-- ROLLBACK (volta ao estado aberto pré-cutover; rode se algo quebrar)
-- =====================================================================
-- do $$
-- declare t text;
--   all_tables text[] := array[ ... mesmas tenant_tables + child_tables ... ];
-- begin
--   foreach t in array all_tables loop
--     execute format('drop policy if exists tenant_claim on public.%I', t);
--     execute format('drop policy if exists authd_only on public.%I', t);
--     execute format('create policy allow_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
--   end loop;
-- end $$;
-- drop policy if exists u_claim on usuarios;
-- create policy usuarios_select on usuarios for select to public using (true);
-- create policy usuarios_update on usuarios for update to public using (true) with check (true);
-- create policy usuarios_insert on usuarios for insert to public with check (true);
-- drop policy if exists t_claim on tenants;
-- create policy tenants_anon_read on tenants for select to anon, authenticated using (true);
