-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.23.0 — Estoque V3
-- Adiciona: vencimento (calibração/validade), custo, tags, fornecedor,
-- auditoria por linha (criado_por/atualizado_por).
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + SUPABASE-ESTOQUE-V2.sql.
-- ══════════════════════════════════════════════════════════════════

-- Fornecedores
CREATE TABLE IF NOT EXISTS public.estoque_fornecedores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  cnpj        text,
  contato     text,
  telefone    text,
  email       text,
  observacao  text,
  criado_em   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_fornecedores_nome_idx ON public.estoque_fornecedores(nome);

-- Estende estoque_items
ALTER TABLE public.estoque_items
  ADD COLUMN IF NOT EXISTS vencimento              date,
  ADD COLUMN IF NOT EXISTS vencimento_aviso_dias   integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS custo_unitario          numeric,
  ADD COLUMN IF NOT EXISTS tags                    text[],
  ADD COLUMN IF NOT EXISTS fornecedor_id           uuid REFERENCES public.estoque_fornecedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS criado_por              uuid,
  ADD COLUMN IF NOT EXISTS criado_por_nome         text,
  ADD COLUMN IF NOT EXISTS atualizado_por          uuid,
  ADD COLUMN IF NOT EXISTS atualizado_por_nome     text;

CREATE INDEX IF NOT EXISTS estoque_items_vencimento_idx  ON public.estoque_items(vencimento);
CREATE INDEX IF NOT EXISTS estoque_items_fornecedor_idx  ON public.estoque_items(fornecedor_id);
CREATE INDEX IF NOT EXISTS estoque_items_tags_idx        ON public.estoque_items USING gin(tags);

-- RLS aberto
ALTER TABLE public.estoque_fornecedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS estoque_fornecedores_all ON public.estoque_fornecedores;
CREATE POLICY estoque_fornecedores_all
  ON public.estoque_fornecedores FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
