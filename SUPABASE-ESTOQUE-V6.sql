-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.26.0 — Estoque V6
-- Adiciona: SETORES (com prefixo do código) + RESPONSÁVEIS + atualiza
-- trigger de código pra usar prefixo do setor (ex: TOP-000001).
-- Rode DEPOIS do SUPABASE-ESTOQUE.sql + V2 + V3 + V4 + V5.
-- ══════════════════════════════════════════════════════════════════

-- ── Setores ─────────────────────────────────────────────────────────
-- Cada setor tem um prefixo (3-4 letras maiúsculas) usado no código
-- dos itens daquele setor. Cada setor tem sua própria contagem.
CREATE TABLE IF NOT EXISTS public.estoque_setores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  prefixo         text NOT NULL,
  cor             text,
  proximo_numero  integer NOT NULL DEFAULT 1,
  criado_em       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS estoque_setores_nome_uniq
  ON public.estoque_setores(lower(nome));
CREATE UNIQUE INDEX IF NOT EXISTS estoque_setores_prefixo_uniq
  ON public.estoque_setores(upper(prefixo));

-- Constraint do prefixo (2-4 letras maiúsculas)
ALTER TABLE public.estoque_setores DROP CONSTRAINT IF EXISTS estoque_setores_prefixo_check;
ALTER TABLE public.estoque_setores ADD CONSTRAINT estoque_setores_prefixo_check
  CHECK (prefixo ~ '^[A-Z]{2,4}$');

-- Setores iniciais (idempotente; INSERT só os que não existem)
INSERT INTO public.estoque_setores (nome, prefixo, cor)
SELECT v.nome, v.prefixo, v.cor FROM (VALUES
  ('Topografia',            'TOP', '#2563eb'),
  ('Fiscalização',          'FIS', '#16a34a'),
  ('Segurança do Trabalho', 'SEG', '#f59e0b'),
  ('Sondagem',              'SON', '#7c3aed'),
  ('Escritório',            'ESC', '#475569'),
  ('Veículos',              'VEI', '#a11312'),
  ('Informática',           'INF', '#0891b2'),
  ('Ferramentas',           'FER', '#ea580c'),
  ('EPIs',                  'EPI', '#db2777'),
  ('Limpeza',               'LIM', '#84cc16'),
  ('Comunicação',           'COM', '#06b6d4'),
  ('Elétrica',              'ELE', '#eab308'),
  ('Hidráulica',            'HID', '#0ea5e9'),
  ('Laboratório',           'LAB', '#10b981')
) AS v(nome, prefixo, cor)
WHERE NOT EXISTS (
  SELECT 1 FROM public.estoque_setores s
   WHERE lower(s.nome) = lower(v.nome) OR upper(s.prefixo) = upper(v.prefixo)
);

-- ── Responsáveis ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estoque_responsaveis (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  cargo        text,
  telefone     text,
  email        text,
  empresa_id   uuid REFERENCES public.estoque_empresas(id) ON DELETE SET NULL,
  observacao   text,
  criado_em    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estoque_responsaveis_nome_idx
  ON public.estoque_responsaveis(nome);
CREATE INDEX IF NOT EXISTS estoque_responsaveis_empresa_idx
  ON public.estoque_responsaveis(empresa_id);

-- ── Estende estoque_items ──────────────────────────────────────────
ALTER TABLE public.estoque_items
  ADD COLUMN IF NOT EXISTS setor_id       uuid REFERENCES public.estoque_setores(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsavel_id uuid REFERENCES public.estoque_responsaveis(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS estoque_items_setor_idx
  ON public.estoque_items(setor_id);
CREATE INDEX IF NOT EXISTS estoque_items_responsavel_idx
  ON public.estoque_items(responsavel_id);

-- ── Trigger atualizado: usa prefixo do setor + sequência por setor ──
CREATE OR REPLACE FUNCTION public.estoque_items_set_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text := 'EST';
  v_num    integer;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    -- Se tem setor, usa prefixo dele e incrementa o contador do setor
    IF NEW.setor_id IS NOT NULL THEN
      UPDATE public.estoque_setores
         SET proximo_numero = proximo_numero + 1
       WHERE id = NEW.setor_id
       RETURNING prefixo, proximo_numero - 1
            INTO v_prefix, v_num;
    END IF;
    -- Fallback (sem setor): usa a sequência geral antiga
    IF v_num IS NULL THEN
      v_num := nextval('public.estoque_items_codigo_seq');
    END IF;
    NEW.codigo := v_prefix || '-' || LPAD(v_num::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.estoque_setores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_responsaveis  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_setores_all       ON public.estoque_setores;
DROP POLICY IF EXISTS estoque_responsaveis_all  ON public.estoque_responsaveis;

CREATE POLICY estoque_setores_all
  ON public.estoque_setores       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estoque_responsaveis_all
  ON public.estoque_responsaveis  FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Rode no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════
