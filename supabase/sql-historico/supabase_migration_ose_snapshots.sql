-- =====================================================================
-- Migration: Snapshots de Conferência OSE (diff entre revisões)
-- Execute no Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

CREATE TABLE IF NOT EXISTS ose_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  hash_arquivos   TEXT NOT NULL,
  nome_projeto    TEXT,
  data_rodada     TIMESTAMPTZ DEFAULT NOW(),
  total_oses      INTEGER,
  total_erros     INTEGER,
  total_avisos    INTEGER,
  resultado       JSONB NOT NULL,
  criado_por      UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ose_snapshots_hash ON ose_snapshots(hash_arquivos);
CREATE INDEX IF NOT EXISTS idx_ose_snapshots_data ON ose_snapshots(data_rodada DESC);

ALTER TABLE ose_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS open_all_ose_snapshots ON ose_snapshots;
CREATE POLICY open_all_ose_snapshots ON ose_snapshots FOR ALL USING (true) WITH CHECK (true);

-- Verificar:
SELECT table_name FROM information_schema.tables WHERE table_name = 'ose_snapshots';
