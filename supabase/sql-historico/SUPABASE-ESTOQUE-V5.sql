-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.25.2 — Estoque V5
-- Adiciona: código único auto-gerado para cada item (formato EST-NNNNNN).
-- Aparece no card e na etiqueta. Sequência garante que nunca repete.
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + V2 + V3 + V4.
-- ══════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS public.estoque_items_codigo_seq START 1;

ALTER TABLE public.estoque_items
  ADD COLUMN IF NOT EXISTS codigo text;

CREATE OR REPLACE FUNCTION public.estoque_items_set_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := 'EST-' || LPAD(nextval('public.estoque_items_codigo_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estoque_items_codigo_trg ON public.estoque_items;
CREATE TRIGGER estoque_items_codigo_trg
  BEFORE INSERT ON public.estoque_items
  FOR EACH ROW EXECUTE FUNCTION public.estoque_items_set_codigo();

-- Backfill: gera código pra itens já cadastrados sem código
UPDATE public.estoque_items
SET codigo = 'EST-' || LPAD(nextval('public.estoque_items_codigo_seq')::text, 6, '0')
WHERE codigo IS NULL OR codigo = '';

-- Avança a sequência além de qualquer EST-NNNNNN existente (caso tenha sido
-- preenchido manualmente em algum momento)
SELECT setval(
  'public.estoque_items_codigo_seq',
  GREATEST(
    COALESCE(
      (SELECT MAX((SUBSTRING(codigo FROM '^EST-([0-9]+)$'))::int)
         FROM public.estoque_items
        WHERE codigo ~ '^EST-[0-9]+$'),
      0
    ),
    1
  )
);

-- Constraint de unicidade (depois do backfill pra não falhar)
CREATE UNIQUE INDEX IF NOT EXISTS estoque_items_codigo_uniq
  ON public.estoque_items(codigo);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
