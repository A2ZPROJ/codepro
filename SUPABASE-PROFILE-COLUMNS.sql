-- ══════════════════════════════════════════════════════════════════
-- Nexus v2.15.2+ — Colunas de tratamento + nome preferido
-- Rode no Supabase SQL Editor pra ativar a saudação personalizada.
-- Se não rodar, o Nexus usa localStorage/Electron Store como fallback.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS tratamento text,
  ADD COLUMN IF NOT EXISTS nome_preferido text;

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Após rodar:
--   - Aba Perfil salva tratamento (Sr./Sra./Prof./Dr./Eng./...) e
--     "Como gostaria de ser chamado" direto no banco.
--   - Próximo login puxa as preferências e mostra "Bom dia, Sr. Lucas!"
--     no splash de boas-vindas.
-- ══════════════════════════════════════════════════════════════════
