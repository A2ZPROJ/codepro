-- =====================================================================
-- NEXUS — RPC de validacao de licenca da DLL (NETLOAD Civil 3D)
-- =====================================================================
-- Contexto: o cutover RLS (fase2-rls-cutover.sql, 30/05/2026) fechou a
-- leitura anonima da tabela `usuarios`. A DLL do NETLOAD validava o
-- access_code batendo direto em usuarios?access_code=eq.XXX com a anon key,
-- e passou a receber lista vazia -> "Codigo de acesso invalido ou removido".
--
-- Solucao: funcao SECURITY DEFINER que valida o codigo POR DENTRO (bypassa
-- a RLS de forma controlada) e devolve so o necessario, SEM reabrir a
-- tabela usuarios pra anon. A DLL passa a chamar /rest/v1/rpc/validar_licenca_civil3d.
--
-- Seguro: nao expoe a tabela; retorna apenas 1 linha do proprio codigo
-- consultado; nao vaza outros usuarios; nao retorna senha/hash.
--
-- Rodar no Supabase Dashboard (projeto CodePro) -> SQL Editor -> Run.
-- =====================================================================

create or replace function public.validar_licenca_civil3d(p_access_code text)
returns table (
  id              uuid,
  nome            text,
  role            text,
  ativo           boolean,
  license_expires timestamptz,
  programa_ativo  boolean,
  programa_expires timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.nome,
    u.role,
    u.ativo,
    u.license_expires,
    coalesce(pa.ativo, false)                                  as programa_ativo,
    pa.expires_at                                              as programa_expires
  from usuarios u
  left join programas_acessos pa
    on pa.usuario_id = u.id and pa.programa = 'civil3d'
  where u.access_code = p_access_code
  limit 1;
$$;

-- Permite a anon (e authenticated) executar a funcao.
grant execute on function public.validar_licenca_civil3d(text) to anon, authenticated;

-- Verificacao rapida (deve retornar a linha do master):
select * from public.validar_licenca_civil3d('A2ZP-MSTR');
