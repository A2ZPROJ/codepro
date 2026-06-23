-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.29.0 — Estoque V8
-- Adiciona: rastreamento de "em campo" (quem tá com cada unidade
-- retirada do estoque) + motivo obrigatório nas retiradas.
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + V2 + V3 + V4 + V5 + V6 + V7.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.estoque_em_uso (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  qty                 numeric NOT NULL CHECK (qty > 0),
  -- Destinatário: quem está com o item agora
  destinatario_id     uuid REFERENCES public.estoque_responsaveis(id) ON DELETE SET NULL,
  destinatario_nome   text NOT NULL,
  -- Operador: quem fez a retirada (geralmente o usuário logado)
  retirado_por_id     uuid,
  retirado_por_nome   text,
  motivo              text NOT NULL,
  observacao          text,
  retirado_em         timestamptz NOT NULL DEFAULT now(),
  devolvido_em        timestamptz,
  -- Liga ao movimento de retirada que originou a linha
  movimento_retirada_id  uuid,
  movimento_devolucao_id uuid
);
CREATE INDEX IF NOT EXISTS estoque_em_uso_item_idx
  ON public.estoque_em_uso(item_id);
CREATE INDEX IF NOT EXISTS estoque_em_uso_destinatario_idx
  ON public.estoque_em_uso(destinatario_id);
CREATE INDEX IF NOT EXISTS estoque_em_uso_ativos_idx
  ON public.estoque_em_uso(item_id) WHERE devolvido_em IS NULL;
CREATE INDEX IF NOT EXISTS estoque_em_uso_retirado_idx
  ON public.estoque_em_uso(retirado_em DESC);

-- Adiciona destinatário na tabela de movimentos (rastreabilidade do histórico)
ALTER TABLE public.estoque_movimentos
  ADD COLUMN IF NOT EXISTS destinatario_id    uuid REFERENCES public.estoque_responsaveis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destinatario_nome  text;

-- RLS aberto
ALTER TABLE public.estoque_em_uso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS estoque_em_uso_all ON public.estoque_em_uso;
CREATE POLICY estoque_em_uso_all
  ON public.estoque_em_uso FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
