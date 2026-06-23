-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.14+ — Tabelas adicionais para features novas
-- Rode este SQL no Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════

-- Atividade de projetos: comentários, menções, logs de alteração
CREATE TABLE IF NOT EXISTS public.projeto_atividade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid REFERENCES public.projetos(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autor_nome text,
  tipo text NOT NULL CHECK (tipo IN ('comment','log','mention','status_change')),
  texto text,
  meta jsonb DEFAULT '{}'::jsonb,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proj_ativ_proj ON public.projeto_atividade(projeto_id, criado_em DESC);

-- RLS permissiva (segue padrão atual do app)
ALTER TABLE public.projeto_atividade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atividade_all" ON public.projeto_atividade;
CREATE POLICY "atividade_all" ON public.projeto_atividade FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Features que passam a funcionar:
--   - Comentários em projetos (detalhe do projeto → seção Atividade)
--   - Log automático de mudanças de status
--   - @mentions (futuro)
-- ══════════════════════════════════════════════════════════════════
