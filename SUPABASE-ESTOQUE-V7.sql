-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.28.0 — Estoque V7
-- Adiciona: PEDIDOS DE COMPRA — gera lista pro fornecedor (PDF/Excel),
-- rastreia status, recebimento parcial/total, cria reposição automática.
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + V2 + V3 + V4 + V5 + V6.
-- ══════════════════════════════════════════════════════════════════

-- Sequência pra numero do pedido (PED-000001, PED-000002...)
CREATE SEQUENCE IF NOT EXISTS public.estoque_pedidos_numero_seq START 1;

-- Cabeçalho do pedido
CREATE TABLE IF NOT EXISTS public.estoque_pedidos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          text NOT NULL UNIQUE,
  fornecedor_id   uuid REFERENCES public.estoque_fornecedores(id) ON DELETE SET NULL,
  empresa_id      uuid REFERENCES public.estoque_empresas(id)     ON DELETE SET NULL,
  local_id        uuid REFERENCES public.estoque_locais(id)       ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','enviado','recebido_parcial','recebido_total','cancelado')),
  observacao      text,
  total_estimado  numeric,
  enviado_em      timestamptz,
  prazo_entrega   date,
  recebido_em     timestamptz,
  cancelado_em    timestamptz,
  usuario_id      uuid,
  usuario_nome    text,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_pedidos_status_idx
  ON public.estoque_pedidos(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS estoque_pedidos_fornecedor_idx
  ON public.estoque_pedidos(fornecedor_id);

-- Trigger para gerar numero automaticamente
CREATE OR REPLACE FUNCTION public.estoque_pedidos_set_numero()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'PED-' || LPAD(nextval('public.estoque_pedidos_numero_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estoque_pedidos_numero_trg ON public.estoque_pedidos;
CREATE TRIGGER estoque_pedidos_numero_trg
  BEFORE INSERT ON public.estoque_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.estoque_pedidos_set_numero();

-- Linhas do pedido (cada item solicitado)
CREATE TABLE IF NOT EXISTS public.estoque_pedido_itens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id             uuid NOT NULL REFERENCES public.estoque_pedidos(id) ON DELETE CASCADE,
  item_id               uuid REFERENCES public.estoque_items(id) ON DELETE SET NULL,
  -- Snapshot do item no momento do pedido (caso o item seja deletado)
  item_codigo           text,
  item_nome             text NOT NULL,
  item_unidade          text,
  quantidade_pedida     numeric NOT NULL CHECK (quantidade_pedida > 0),
  quantidade_recebida   numeric NOT NULL DEFAULT 0,
  custo_unitario        numeric,
  observacao            text,
  criado_em             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_pedido_itens_pedido_idx
  ON public.estoque_pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS estoque_pedido_itens_item_idx
  ON public.estoque_pedido_itens(item_id);

-- RLS aberto
ALTER TABLE public.estoque_pedidos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_pedido_itens  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_pedidos_all      ON public.estoque_pedidos;
DROP POLICY IF EXISTS estoque_pedido_itens_all ON public.estoque_pedido_itens;

CREATE POLICY estoque_pedidos_all
  ON public.estoque_pedidos      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_pedido_itens_all
  ON public.estoque_pedido_itens FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
