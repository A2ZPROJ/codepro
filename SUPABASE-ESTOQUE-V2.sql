-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.22.0 — Estoque V2
-- Adiciona: empresas, locais, fotos múltiplas, estado, sub-itens
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql (que cria estoque_items+movimentos).
-- ══════════════════════════════════════════════════════════════════

-- Empresas (ex: 2S Engenharia, A2Z Projetos)
CREATE TABLE IF NOT EXISTS public.estoque_empresas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  cor         text,
  criado_em   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS estoque_empresas_nome_uniq
  ON public.estoque_empresas(lower(nome));

-- Locais de estoque (cidades, filiais — pertencem a 1 empresa)
CREATE TABLE IF NOT EXISTS public.estoque_locais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.estoque_empresas(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  endereco    text,
  criado_em   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_locais_empresa_idx
  ON public.estoque_locais(empresa_id);

-- Estende estoque_items: empresa + local + estado + sub-itens (parent_id)
ALTER TABLE public.estoque_items
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.estoque_empresas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS local_id   uuid REFERENCES public.estoque_locais(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estado     text,
  ADD COLUMN IF NOT EXISTS parent_id  uuid REFERENCES public.estoque_items(id)    ON DELETE CASCADE;

-- Constraint do estado (drop+add pra ser idempotente)
ALTER TABLE public.estoque_items DROP CONSTRAINT IF EXISTS estoque_items_estado_check;
ALTER TABLE public.estoque_items ADD CONSTRAINT estoque_items_estado_check
  CHECK (estado IS NULL OR estado IN ('novo','otimo','bom','ruim','pessimo'));

CREATE INDEX IF NOT EXISTS estoque_items_empresa_idx ON public.estoque_items(empresa_id);
CREATE INDEX IF NOT EXISTS estoque_items_local_idx   ON public.estoque_items(local_id);
CREATE INDEX IF NOT EXISTS estoque_items_parent_idx  ON public.estoque_items(parent_id);

-- Fotos múltiplas (1:N com items). foto_url do item = capa (URL apontando p/
-- uma das fotos cadastradas, atualizada quando user muda capa).
CREATE TABLE IF NOT EXISTS public.estoque_fotos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  url         text NOT NULL,
  ordem       integer DEFAULT 0,
  criado_em   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_fotos_item_idx
  ON public.estoque_fotos(item_id, ordem);

-- RLS aberto (mesma pegada das demais)
ALTER TABLE public.estoque_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_locais   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_fotos    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_empresas_all ON public.estoque_empresas;
DROP POLICY IF EXISTS estoque_locais_all   ON public.estoque_locais;
DROP POLICY IF EXISTS estoque_fotos_all    ON public.estoque_fotos;

CREATE POLICY estoque_empresas_all
  ON public.estoque_empresas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_locais_all
  ON public.estoque_locais   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_fotos_all
  ON public.estoque_fotos    FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
