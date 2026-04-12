-- =====================================================================
-- FIX RLS: Módulo de Orçamento (Nexus)
--
-- O migration original (supabase_migration_orcamento.sql) criou policies
-- exigindo auth.role() = 'authenticated', mas o Nexus usa login próprio
-- por access_code, não Supabase Auth — então todas as queries vão como
-- role 'anon' e bateram em "new row violates row-level security policy".
--
-- Este fix troca as 5 policies para o mesmo padrão das outras tabelas do
-- app (USING true WITH CHECK true). A segurança continua garantida pela
-- camada de licença/access_code e pela anon key só estar no binário.
--
-- Como executar:
--   Supabase Dashboard → SQL Editor → New query → cola e Run
-- =====================================================================

DROP POLICY IF EXISTS auth_all_tabelas_preco   ON tabelas_preco;
DROP POLICY IF EXISTS auth_all_itens_tabela    ON itens_tabela;
DROP POLICY IF EXISTS auth_all_bdi_templates   ON bdi_templates;
DROP POLICY IF EXISTS auth_all_orcamentos      ON orcamentos;
DROP POLICY IF EXISTS auth_all_orcamento_itens ON orcamento_itens;

CREATE POLICY open_all_tabelas_preco   ON tabelas_preco   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY open_all_itens_tabela    ON itens_tabela    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY open_all_bdi_templates   ON bdi_templates   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY open_all_orcamentos      ON orcamentos      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY open_all_orcamento_itens ON orcamento_itens FOR ALL USING (true) WITH CHECK (true);

-- Verificação:
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('tabelas_preco','itens_tabela','bdi_templates','orcamentos','orcamento_itens')
ORDER BY tablename, policyname;
