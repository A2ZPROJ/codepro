-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.25.0 — Estoque V4
-- Adiciona: reservas (alocação de itens a OSE/projeto), inventários
-- (contagem física vs sistema), alertas (snoozes/dismissals).
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + V2 + V3.
-- ══════════════════════════════════════════════════════════════════

-- Reservas: vincula uma quantidade do item a uma OSE/projeto.
-- Não debita a qty do estoque até virar "consumido".
CREATE TABLE IF NOT EXISTS public.estoque_reservas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  ose_numero    text,
  projeto_nome  text,
  quantidade    numeric NOT NULL CHECK (quantidade > 0),
  status        text NOT NULL DEFAULT 'reservado'
                CHECK (status IN ('reservado','consumido','cancelado')),
  motivo        text,
  usuario_id    uuid,
  usuario_nome  text,
  criado_em     timestamptz DEFAULT now(),
  consumido_em  timestamptz,
  cancelado_em  timestamptz
);
CREATE INDEX IF NOT EXISTS estoque_reservas_item_idx
  ON public.estoque_reservas(item_id, status);
CREATE INDEX IF NOT EXISTS estoque_reservas_ose_idx
  ON public.estoque_reservas(ose_numero);
CREATE INDEX IF NOT EXISTS estoque_reservas_status_idx
  ON public.estoque_reservas(status, criado_em DESC);

-- Inventários: snapshot de contagem física pra um conjunto de itens
CREATE TABLE IF NOT EXISTS public.estoque_inventarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  empresa_id    uuid REFERENCES public.estoque_empresas(id) ON DELETE SET NULL,
  local_id      uuid REFERENCES public.estoque_locais(id)   ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'aberto'
                CHECK (status IN ('aberto','fechado','cancelado')),
  observacao    text,
  usuario_id    uuid,
  usuario_nome  text,
  criado_em     timestamptz DEFAULT now(),
  fechado_em    timestamptz
);
CREATE INDEX IF NOT EXISTS estoque_inventarios_status_idx
  ON public.estoque_inventarios(status, criado_em DESC);

-- Linhas do inventário: 1 linha por item contado
CREATE TABLE IF NOT EXISTS public.estoque_inventario_linhas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.estoque_inventarios(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  qty_sistema   numeric NOT NULL,
  qty_fisica    numeric,
  diferenca     numeric GENERATED ALWAYS AS (COALESCE(qty_fisica,0) - qty_sistema) STORED,
  observacao    text,
  contado_em    timestamptz
);
CREATE INDEX IF NOT EXISTS estoque_inventario_linhas_inv_idx
  ON public.estoque_inventario_linhas(inventario_id);
CREATE INDEX IF NOT EXISTS estoque_inventario_linhas_item_idx
  ON public.estoque_inventario_linhas(item_id);

-- Alertas dispensados (pra não ficar martelando o user)
CREATE TABLE IF NOT EXISTS public.estoque_alertas_dispensados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.estoque_items(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('baixo','vencimento')),
  usuario_id    uuid,
  dispensado_ate timestamptz,
  criado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_alertas_dispensados_item_idx
  ON public.estoque_alertas_dispensados(item_id, tipo);

-- RLS aberto (mesma pegada das demais)
ALTER TABLE public.estoque_reservas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_inventarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_inventario_linhas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_alertas_dispensados   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_reservas_all              ON public.estoque_reservas;
DROP POLICY IF EXISTS estoque_inventarios_all           ON public.estoque_inventarios;
DROP POLICY IF EXISTS estoque_inventario_linhas_all     ON public.estoque_inventario_linhas;
DROP POLICY IF EXISTS estoque_alertas_dispensados_all   ON public.estoque_alertas_dispensados;

CREATE POLICY estoque_reservas_all
  ON public.estoque_reservas              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_inventarios_all
  ON public.estoque_inventarios           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_inventario_linhas_all
  ON public.estoque_inventario_linhas     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_alertas_dispensados_all
  ON public.estoque_alertas_dispensados   FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
