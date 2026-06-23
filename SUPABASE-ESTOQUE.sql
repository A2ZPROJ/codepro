-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.21.0 — Módulo de Estoque
-- Rode no Supabase SQL Editor pra ativar a aba Estoque.
-- ══════════════════════════════════════════════════════════════════

-- Itens do estoque (SKU = código interno opcional)
CREATE TABLE IF NOT EXISTS public.estoque_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  sku             text,
  descricao       text,
  unidade         text DEFAULT 'un',
  quantidade      numeric NOT NULL DEFAULT 0,
  estoque_minimo  numeric,
  foto_url        text,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estoque_items_nome_idx ON public.estoque_items(nome);
CREATE INDEX IF NOT EXISTS estoque_items_sku_idx  ON public.estoque_items(sku);

-- Movimentações: retirada, reposição ou ajuste manual
CREATE TABLE IF NOT EXISTS public.estoque_movimentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('retirada','reposicao','ajuste')),
  quantidade    numeric NOT NULL,
  saldo_antes   numeric,
  saldo_depois  numeric,
  motivo        text,
  usuario_id    uuid,
  usuario_nome  text,
  criado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estoque_movimentos_item_idx
  ON public.estoque_movimentos(item_id, criado_em DESC);

-- RLS aberto (mesma pegada das outras tabelas do app)
ALTER TABLE public.estoque_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_items_all      ON public.estoque_items;
DROP POLICY IF EXISTS estoque_movimentos_all ON public.estoque_movimentos;

CREATE POLICY estoque_items_all
  ON public.estoque_items      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_movimentos_all
  ON public.estoque_movimentos FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket pra fotos dos itens (público pra simplificar leitura)
INSERT INTO storage.buckets (id, name, public)
VALUES ('estoque-fotos', 'estoque-fotos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "estoque-fotos read"   ON storage.objects;
DROP POLICY IF EXISTS "estoque-fotos write"  ON storage.objects;
DROP POLICY IF EXISTS "estoque-fotos update" ON storage.objects;
DROP POLICY IF EXISTS "estoque-fotos delete" ON storage.objects;

CREATE POLICY "estoque-fotos read"   ON storage.objects FOR SELECT USING (bucket_id = 'estoque-fotos');
CREATE POLICY "estoque-fotos write"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'estoque-fotos');
CREATE POLICY "estoque-fotos update" ON storage.objects FOR UPDATE USING (bucket_id = 'estoque-fotos');
CREATE POLICY "estoque-fotos delete" ON storage.objects FOR DELETE USING (bucket_id = 'estoque-fotos');

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase e a aba Estoque ativa.
-- ══════════════════════════════════════════════════════════════════
