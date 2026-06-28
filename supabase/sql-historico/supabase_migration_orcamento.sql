-- =====================================================================
-- Migration: Módulo de Orçamento (Nexus v2.0)
-- Autor: Lucas Abdala / A2Z Projetos
-- Data: 2026-04-11
--
-- Como executar:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Cola este arquivo inteiro e clica em Run
--
-- Cria as tabelas:
--   tabelas_preco    — versões de tabelas de preço (SANEPAR/SINAPI/EMOP/CUSTOM)
--   itens_tabela     — itens de cada tabela de preço
--   bdi_templates    — templates de BDI (fórmula + faixas)
--   orcamentos       — orçamentos por projeto/bacia
--   orcamento_itens  — linhas do orçamento (podem vir de múltiplas fontes)
--
-- IMPORTANTE: se o tipo da PK de 'projetos' for BIGINT em vez de UUID,
--             troque 'UUID' por 'BIGINT' no campo orcamentos.projeto_id.
-- =====================================================================

-- ─── TABELAS DE PREÇO ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tabelas_preco (
  id            BIGSERIAL PRIMARY KEY,
  fonte         TEXT        NOT NULL CHECK (fonte IN ('SANEPAR','SINAPI','EMOP','CUSTOM')),
  nome          TEXT        NOT NULL,        -- ex: "SANEPAR MOS Dezembro/2024"
  data_ref      DATE        NOT NULL,        -- data de referência da tabela
  uf            TEXT,                        -- opcional (SINAPI varia por UF)
  descricao     TEXT,
  ativo         BOOLEAN     DEFAULT TRUE,    -- marca versão vigente da fonte
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  criado_por    UUID        REFERENCES auth.users(id),
  UNIQUE (fonte, data_ref, uf)
);

CREATE INDEX IF NOT EXISTS idx_tabelas_preco_fonte_data
  ON tabelas_preco (fonte, data_ref DESC);

CREATE INDEX IF NOT EXISTS idx_tabelas_preco_ativo
  ON tabelas_preco (fonte, ativo) WHERE ativo = TRUE;

-- ─── ITENS DA TABELA ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS itens_tabela (
  id             BIGSERIAL PRIMARY KEY,
  tabela_id      BIGINT NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  codigo         TEXT   NOT NULL,              -- ex: '001001001' (SANEPAR), '73892/1' (SINAPI)
  descricao      TEXT   NOT NULL,
  unidade        TEXT,                          -- m, m², m³, ud, etc.
  valor_unitario NUMERIC(14,4),                 -- null para linhas de grupo/subgrupo
  nivel          INTEGER DEFAULT 3,             -- 1=grupo, 2=subgrupo, 3=item folha
  grupo_codigo   TEXT,                          -- código do pai (para agrupamento)
  busca          TSVECTOR,                      -- full-text search
  UNIQUE (tabela_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_itens_tabela_codigo
  ON itens_tabela (tabela_id, codigo);

CREATE INDEX IF NOT EXISTS idx_itens_tabela_busca
  ON itens_tabela USING GIN (busca);

-- Trigger: mantém o tsvector de busca atualizado
CREATE OR REPLACE FUNCTION update_itens_tabela_busca() RETURNS TRIGGER AS $$
BEGIN
  NEW.busca := to_tsvector('portuguese',
    coalesce(NEW.codigo, '') || ' ' || coalesce(NEW.descricao, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_itens_tabela_busca ON itens_tabela;
CREATE TRIGGER trg_itens_tabela_busca
  BEFORE INSERT OR UPDATE OF codigo, descricao ON itens_tabela
  FOR EACH ROW EXECUTE FUNCTION update_itens_tabela_busca();

-- ─── BDI TEMPLATES ───────────────────────────────────────────────────
-- A JSONB 'faixas' guarda array de regras no formato:
--   [
--     {
--       "ate":      150000,
--       "AC": 0.055, "SG": 0.007, "R": 0.015, "DF": 0.008, "L": 0.085,
--       "COFINS": 0.03, "PIS": 0.0065, "ISS": 0.03, "CPRB": 0
--     },
--     { "ate": 1500000, ... },
--     { "ate": null,    ... }   -- null = sem limite superior
--   ]
CREATE TABLE IF NOT EXISTS bdi_templates (
  id            BIGSERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('OBRAS','MATERIAIS','CUSTOM')),
  base_calculo  TEXT DEFAULT 'Acórdão 2622/2013 - TCU',
  faixas        JSONB NOT NULL,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  criado_por    UUID REFERENCES auth.users(id)
);

-- ─── ORÇAMENTOS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orcamentos (
  id                BIGSERIAL PRIMARY KEY,
  projeto_id        UUID        REFERENCES projetos(id) ON DELETE SET NULL,
  codigo_documento  TEXT,                               -- ex: '003-SES-0240-0005-PEXE-OR-0005RCE240STAFE-R3'
  titulo            TEXT        NOT NULL,
  cidade            TEXT,
  uf                TEXT,
  sistema           TEXT,                               -- ex: "ÁGUA DO BRÁS"
  microbacia        TEXT,                               -- ex: "SB-01"
  revisao           TEXT,                               -- ex: "R03"
  data_orcamento    DATE,
  elaborador        TEXT,
  eng_responsavel   TEXT,
  eng_crea          TEXT,
  bdi_obras_id      BIGINT      REFERENCES bdi_templates(id),
  bdi_materiais_id  BIGINT      REFERENCES bdi_templates(id),
  status            TEXT        DEFAULT 'rascunho'
                                 CHECK (status IN ('rascunho','finalizado','aprovado')),
  observacoes       TEXT,
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  criado_por        UUID        REFERENCES auth.users(id),
  atualizado_em     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_projeto ON orcamentos (projeto_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status  ON orcamentos (status);

-- ─── LINHAS DO ORÇAMENTO ─────────────────────────────────────────────
-- Cada linha guarda SNAPSHOT do item (fonte, código, descrição, valor)
-- — assim o orçamento fica imutável ao updater da tabela de preço futura.
CREATE TABLE IF NOT EXISTS orcamento_itens (
  id                       BIGSERIAL PRIMARY KEY,
  orcamento_id             BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  ordem                    INTEGER NOT NULL DEFAULT 0,
  item_tabela_id           BIGINT REFERENCES itens_tabela(id) ON DELETE SET NULL,
  -- SNAPSHOTS (imutáveis)
  fonte_snapshot           TEXT,
  codigo_snapshot          TEXT,
  descricao_snapshot       TEXT,
  unidade_snapshot         TEXT,
  valor_unitario_snapshot  NUMERIC(14,4),
  data_ref_snapshot        DATE,
  -- Quantidade e BDI
  quantidade               NUMERIC(14,4) NOT NULL DEFAULT 0,
  tipo_bdi                 TEXT DEFAULT 'OBRAS'
                             CHECK (tipo_bdi IN ('OBRAS','MATERIAIS','NENHUM')),
  observacao               TEXT
);

CREATE INDEX IF NOT EXISTS idx_orcamento_itens_orcamento
  ON orcamento_itens (orcamento_id, ordem);

-- Atualiza 'atualizado_em' no orçamento quando inserir/atualizar/remover item
CREATE OR REPLACE FUNCTION touch_orcamento() RETURNS TRIGGER AS $$
BEGIN
  UPDATE orcamentos SET atualizado_em = NOW() WHERE id = COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orcamento_itens_touch ON orcamento_itens;
CREATE TRIGGER trg_orcamento_itens_touch
  AFTER INSERT OR UPDATE OR DELETE ON orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION touch_orcamento();

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────
ALTER TABLE tabelas_preco   ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_tabela    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bdi_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamentos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_itens ENABLE ROW LEVEL SECURITY;

-- Policies: autenticados leem e escrevem tudo (mesmo padrão das outras tabelas)
DROP POLICY IF EXISTS auth_all_tabelas_preco   ON tabelas_preco;
DROP POLICY IF EXISTS auth_all_itens_tabela    ON itens_tabela;
DROP POLICY IF EXISTS auth_all_bdi_templates   ON bdi_templates;
DROP POLICY IF EXISTS auth_all_orcamentos      ON orcamentos;
DROP POLICY IF EXISTS auth_all_orcamento_itens ON orcamento_itens;

CREATE POLICY auth_all_tabelas_preco   ON tabelas_preco   FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY auth_all_itens_tabela    ON itens_tabela    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY auth_all_bdi_templates   ON bdi_templates   FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY auth_all_orcamentos      ON orcamentos      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY auth_all_orcamento_itens ON orcamento_itens FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ─── SEED: BDI SANEPAR padrão (Acórdão 2622/2013 TCU) ────────────────
-- Fórmula: BDI = (((1+AC+SG+R)*(1+L)*(1+I)) / (1 - COFINS - PIS - ISS - CPRB)) - 1
--
-- BDI 1 — Obras e Serviços (construção de redes de esgoto)
INSERT INTO bdi_templates (nome, tipo, base_calculo, faixas) VALUES
(
  'BDI 1 — Obras e Serviços (SANEPAR padrão)',
  'OBRAS',
  'Acórdão 2622/2013 - TCU Plenário',
  '[
    { "ate": 150000,  "AC": 0.055, "SG": 0.007, "R": 0.015, "DF": 0.008,  "L": 0.085, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0.03, "CPRB": 0 },
    { "ate": 1500000, "AC": 0.050, "SG": 0.005, "R": 0.013, "DF": 0.0075, "L": 0.080, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0.03, "CPRB": 0 },
    { "ate": null,    "AC": 0.035, "SG": 0.004, "R": 0.011, "DF": 0.007,  "L": 0.065, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0.03, "CPRB": 0 }
  ]'::jsonb
),
(
  'BDI 2 — Fornecimento de Materiais (SANEPAR padrão)',
  'MATERIAIS',
  'Acórdão 2622/2013 - TCU Plenário',
  '[
    { "ate": 150000,  "AC": 0.035, "SG": 0.008, "R": 0.009, "DF": 0.011,   "L": 0.050, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0, "CPRB": 0 },
    { "ate": 1500000, "AC": 0.025, "SG": 0.005, "R": 0.008, "DF": 0.0085,  "L": 0.040, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0, "CPRB": 0 },
    { "ate": null,    "AC": 0.015, "SG": 0.004, "R": 0.007, "DF": 0.007,   "L": 0.030, "COFINS": 0.03, "PIS": 0.0065, "ISS": 0, "CPRB": 0 }
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── FIM ─────────────────────────────────────────────────────────────
-- Verificar que tudo foi criado:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public'
--   AND table_name IN ('tabelas_preco','itens_tabela','bdi_templates','orcamentos','orcamento_itens');
