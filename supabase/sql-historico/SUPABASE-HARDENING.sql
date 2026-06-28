-- ══════════════════════════════════════════════════════════════════
-- Nexus — Hardening de RLS (OPCIONAL, cuidado!)
--
-- Este SQL endurece as policies atuais que são `USING (true)` (tudo
-- permitido). É o fix do item CRÍTICO do SECURITY-NOTES.md.
--
-- ⚠ IMPORTANTE ⚠
--   - Teste em STAGING antes de rodar em produção
--   - Estratégia: mantém SELECT/INSERT/UPDATE abertos, BLOQUEIA DELETE
--   - O app continua funcionando PORQUE já não depende de DELETE direto
--     pra maioria das operações (mas Admin-remove-user quebrará até
--     refatorarmos pra soft-delete)
--
-- Rode seção por seção, validando cada uma antes de ir pra próxima.
-- ══════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════
-- OPÇÃO A — Quick win (bloqueia DELETE anônimo)
-- Impacto: botões Remover (user/projeto/código/GRD) pararão de funcionar
-- até refatorarmos pra soft-delete.
-- Vale a pena rodar só depois de confirmar que você não depende de DELETE.
-- ══════════════════════════════════════════════════════════════════

-- USUÁRIOS
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuarios_all" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete" ON public.usuarios;
CREATE POLICY "usuarios_select" ON public.usuarios FOR SELECT USING (true);
CREATE POLICY "usuarios_insert" ON public.usuarios FOR INSERT WITH CHECK (true);
CREATE POLICY "usuarios_update" ON public.usuarios FOR UPDATE USING (true) WITH CHECK (true);
-- DELETE sem policy = bloqueado pra anon

-- PROJETOS
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projetos_all" ON public.projetos;
DROP POLICY IF EXISTS "projetos_delete" ON public.projetos;
CREATE POLICY "projetos_select" ON public.projetos FOR SELECT USING (true);
CREATE POLICY "projetos_insert" ON public.projetos FOR INSERT WITH CHECK (true);
CREATE POLICY "projetos_update" ON public.projetos FOR UPDATE USING (true) WITH CHECK (true);

-- CÓDIGOS
ALTER TABLE public.codigos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "codigos_all" ON public.codigos;
DROP POLICY IF EXISTS "codigos_delete" ON public.codigos;
CREATE POLICY "codigos_select" ON public.codigos FOR SELECT USING (true);
CREATE POLICY "codigos_insert" ON public.codigos FOR INSERT WITH CHECK (true);
CREATE POLICY "codigos_update" ON public.codigos FOR UPDATE USING (true) WITH CHECK (true);

-- GRDs
ALTER TABLE public.grds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grds_all" ON public.grds;
DROP POLICY IF EXISTS "grds_delete" ON public.grds;
CREATE POLICY "grds_select" ON public.grds FOR SELECT USING (true);
CREATE POLICY "grds_insert" ON public.grds FOR INSERT WITH CHECK (true);
CREATE POLICY "grds_update" ON public.grds FOR UPDATE USING (true) WITH CHECK (true);

-- EMPRESAS / RESPONSÁVEIS / AUDITORIA
ALTER TABLE public.empresas_equipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "emp_all" ON public.empresas_equipe;
CREATE POLICY "emp_select" ON public.empresas_equipe FOR SELECT USING (true);
CREATE POLICY "emp_insert" ON public.empresas_equipe FOR INSERT WITH CHECK (true);
CREATE POLICY "emp_update" ON public.empresas_equipe FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE public.responsaveis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "resp_all" ON public.responsaveis;
CREATE POLICY "resp_select" ON public.responsaveis FOR SELECT USING (true);
CREATE POLICY "resp_insert" ON public.responsaveis FOR INSERT WITH CHECK (true);
CREATE POLICY "resp_update" ON public.responsaveis FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_all" ON public.auditoria;
CREATE POLICY "audit_select" ON public.auditoria FOR SELECT USING (true);
CREATE POLICY "audit_insert" ON public.auditoria FOR INSERT WITH CHECK (true);
-- NÃO permite update nem delete em audit log

-- ══════════════════════════════════════════════════════════════════
-- PRONTO. Vulnerabilidade de "anon pode apagar tudo" RESOLVIDA.
-- Próximo passo (refactor): migrar pra Supabase Auth oficial + RLS
-- baseado em auth.uid(), fora do escopo deste hotfix.
-- ══════════════════════════════════════════════════════════════════
