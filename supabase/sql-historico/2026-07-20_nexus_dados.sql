-- ─────────────────────────────────────────────────────────────────────────────
-- NEXUS-DADOS no Supabase — espelho dos JSONs da pasta compartilhada do EEE.
-- Motivo: o caminho da pasta muda de máquina p/ máquina (nome da biblioteca do
-- SharePoint + ponto de sincronização), e quem não tem a biblioteca sincronizada
-- (ex.: Gustavo) fica com a lista de projetos/cotações/fornecedores VAZIA.
-- Com isto o Nexus lê do banco e não depende mais de caminho nenhum.
--
-- Rodar no SQL Editor do projeto xszpzsmdpbgaiodeqcpi.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.nexus_dados (
  pasta         text        not null,          -- 'NEXUS-ANALISES' | 'COTACOES NEXUS' | 'FORNECEDORES NEXUS'
  nome          text        not null,          -- nome do arquivo, ex 'Altamira_SB-A6.json'
  conteudo      jsonb       not null,
  sha256        text,                          -- p/ o sync pular o que não mudou
  tamanho       int,
  origem        text,                          -- máquina/usuário que subiu
  atualizado_em timestamptz not null default now(),
  primary key (pasta, nome)
);

comment on table public.nexus_dados is
  'Espelho dos JSONs de _APOIO\NEXUS-DADOS (orçamento EEE). Escrita só via service_role (agente de sync); leitura liberada p/ o app.';

create index if not exists nexus_dados_pasta_idx on public.nexus_dados (pasta);

alter table public.nexus_dados enable row level security;

-- LEITURA: qualquer cliente do app (anon) pode ler. São dados internos de projeto,
-- sem PII; o app já usa a mesma chave anon p/ dashboard_data.
drop policy if exists nexus_dados_leitura on public.nexus_dados;
create policy nexus_dados_leitura on public.nexus_dados
  for select using (true);

-- ESCRITA: nenhuma policy p/ anon → só o service_role (que ignora RLS) grava.
-- É o agente de sincronização que roda na máquina que tem a pasta.

-- ── carimbo de quando o sync rodou pela última vez (p/ o app avisar se estiver velho)
create table if not exists public.nexus_dados_sync (
  id            int primary key default 1,
  rodou_em      timestamptz not null default now(),
  origem        text,
  arquivos      int,
  detalhe       jsonb,
  check (id = 1)
);
alter table public.nexus_dados_sync enable row level security;
drop policy if exists nexus_dados_sync_leitura on public.nexus_dados_sync;
create policy nexus_dados_sync_leitura on public.nexus_dados_sync for select using (true);
