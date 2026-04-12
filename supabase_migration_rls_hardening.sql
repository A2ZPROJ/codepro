-- =====================================================================
-- Migration: RLS Hardening — Protege DELETE nas tabelas de preço
--
-- Qualquer pessoa pode LER e INSERIR (necessário pro import manual no app),
-- mas DELETE só funciona via service_role (GitHub Action).
-- Isso impede que alguém com a anon key apague a base de preços.
--
-- Execute no Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- Tabelas de preço: leitura + inserção OK, delete bloqueado
DROP POLICY IF EXISTS open_all_tabelas_preco ON tabelas_preco;
DROP POLICY IF EXISTS open_all_itens_tabela ON itens_tabela;
DROP POLICY IF EXISTS open_all_bdi_templates ON bdi_templates;

-- SELECT + INSERT + UPDATE permitidos
CREATE POLICY anon_read_write_tabelas_preco ON tabelas_preco
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY anon_read_write_itens_tabela ON itens_tabela
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY anon_read_write_bdi_templates ON bdi_templates
  FOR ALL USING (true) WITH CHECK (true);

-- DELETE bloqueado pra anon (só service_role bypassa)
-- Nota: Supabase RLS com FOR DELETE não suporta WITH CHECK.
-- A abordagem é: criar trigger que bloqueia DELETE se não for service_role.
CREATE OR REPLACE FUNCTION block_anon_delete() RETURNS TRIGGER AS $$
BEGIN
  -- service_role bypassa RLS, então se chegou aqui é anon ou authenticated
  -- Bloqueia pra proteger a base de preços
  IF current_setting('role') != 'service_role' THEN
    RAISE EXCEPTION 'DELETE não permitido via anon key. Use o dashboard do Supabase ou o GitHub Action.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_delete_tabelas_preco ON tabelas_preco;
CREATE TRIGGER trg_block_delete_tabelas_preco
  BEFORE DELETE ON tabelas_preco FOR EACH ROW EXECUTE FUNCTION block_anon_delete();

DROP TRIGGER IF EXISTS trg_block_delete_itens_tabela ON itens_tabela;
CREATE TRIGGER trg_block_delete_itens_tabela
  BEFORE DELETE ON itens_tabela FOR EACH ROW EXECUTE FUNCTION block_anon_delete();

DROP TRIGGER IF EXISTS trg_block_delete_bdi_templates ON bdi_templates;
CREATE TRIGGER trg_block_delete_bdi_templates
  BEFORE DELETE ON bdi_templates FOR EACH ROW EXECUTE FUNCTION block_anon_delete();

-- Verificação:
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('tabelas_preco','itens_tabela','bdi_templates')
ORDER BY tablename;
