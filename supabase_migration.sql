-- Migração: novo sistema de licenças CodePro
-- Execute no SQL Editor do Supabase (https://supabase.com → SQL Editor)

-- 1. Adicionar coluna access_code (código de acesso gerado pelo admin)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS access_code TEXT UNIQUE;

-- 2. Adicionar coluna ativo (para desativar usuários sem excluir)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;

-- 3. Índice para busca rápida por access_code (login)
CREATE INDEX IF NOT EXISTS idx_usuarios_access_code ON usuarios (access_code);

-- Verificar estrutura atual da tabela após a migração:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuarios';
