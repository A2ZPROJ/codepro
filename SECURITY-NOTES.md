# Nexus — Notas de segurança

Diagnóstico feito em 2026-04-18 durante o checkup. Aplicado em v2.13.4 e seguintes.

## Fixes já aplicados no código

- [x] **CSP via `<meta>`** em `index.html` — limita `connect-src` à whitelist de domínios confiáveis (Supabase, CDNs, APIs). Reduz exfiltração em caso de XSS.
- [x] **Função `esc()` global + aplicação em innerHTML críticos** — escapa valores vindos do Supabase (projetos, GRDs, usuários, equipes, códigos, histórico, auditoria).
- [x] **`_safeCor` / `_safeUrl`** — valida cores (hex/rgb/var) e URLs (só https/file/data:image) antes de interpolar em atributos style/src.
- [x] **`autoInstallOnAppQuit: false`** — auto-update não instala silenciosamente ao fechar o app.
- [x] **Rotação do log** (`~/codepro-update.log`) — trunca à metade quando passa de 1MB.
- [x] **Limit em `getDashboardHistory`** — 365 snapshots (1 ano).
- [x] **Timeout 5s no `is.gd`** — evita pendurar renderer se API cair.
- [x] **Dashboard: removido polling redundante** — watcher único + interval de 5min só pra re-conectar se cair.

## PENDENTE — precisa ação no Supabase dashboard (fora do código)

### RLS permissivo `USING (true)`

A anon key do Supabase está hardcoded no código (`main.js:11` e `index.html:58`). Qualquer pessoa com acesso ao repo ou ao `.exe` consegue extrair e fazer queries direto no Supabase. As policies atuais são `USING (true)` (qualquer um pode tudo).

**O que um atacante pode fazer hoje:**
- Ler toda a tabela `usuarios` (nomes, emails, access_codes, licenças)
- INSERT/UPDATE/DELETE em qualquer tabela
- Injetar XSS via projetos/responsáveis/códigos (ataque dormindo) — **agora mitigado pelo `esc()` no renderer**

### Plano de hardening do Supabase

**Opção A — Quick win (rápido, protege do pior caso):**
Manter SELECT/INSERT/UPDATE abertos mas bloquear DELETE anônimo. DELETE só via service_role (usado pelo GitHub Action do scraper).

```sql
-- Para cada tabela, execute no SQL editor do Supabase:
-- (repita para: usuarios, codigos, projetos, grds, empresas_equipe, responsaveis,
--  auditoria, tabelas_preco, itens_tabela, bdi_templates, orcamentos, orcamento_itens,
--  dashboard_data, dashboard_history)

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuarios_all"    ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_delete" ON public.usuarios;
CREATE POLICY "usuarios_select" ON public.usuarios FOR SELECT USING (true);
CREATE POLICY "usuarios_insert" ON public.usuarios FOR INSERT WITH CHECK (true);
CREATE POLICY "usuarios_update" ON public.usuarios FOR UPDATE USING (true) WITH CHECK (true);
-- Sem policy pra DELETE = bloqueado pra anon
```

**⚠ Impacto no app:** botões "Remover" (projetos, usuários, responsáveis, códigos) vão quebrar. Precisa mudar o app pra fazer "soft delete" (marcar `deleted_at=now()` com UPDATE) em vez de DELETE real.

**Opção B — Hardening real (correto, mais trabalho):**
Migrar autenticação do app pra `Supabase Auth` oficial. Substituir access_code por login email/senha gerido pelo Supabase. Policies passam a usar `auth.uid()` em condições. DELETE só permitido pro dono do registro ou user master.

Escopo: refatorar `splash.html`, `license.js`, e toda a lógica de `currentUser` no renderer. ~1 semana de trabalho.

**Opção C — Middleware (intermediário):**
Criar Supabase Edge Function `delete-with-auth` que valida access_code antes de deletar. App chama essa function em vez de DELETE direto. RLS bloqueia DELETE anônimo.

Escopo: 1 edge function + ajustar ~5 pontos no renderer. ~1-2 dias.

## PENDENTE — refactor grande

### Electron `nodeIntegration: true` + `contextIsolation: false`

Anti-pattern clássico. Eleva qualquer XSS a RCE (atacante pode `require('child_process').exec()` no PC do user).

**Fix:** 
- Ligar `contextIsolation: true`
- Ligar `nodeIntegration: false`
- Expor apenas APIs específicas via `preload.js` usando `contextBridge.exposeInMainWorld`
- Refatorar todo `index.html` que faz `require()` direto (ex.: `const fs=require('fs')` pra ler config.json da Gemini key em linha 1487)

Escopo: ~1 semana. Alto risco de regressão. Precisa de plano de migração gradual.

## Rotação de HMAC secret da licença

`license.js` tem o HMAC secret ofuscado (XOR+base64), mas bytenode não esconde em runtime. Um atacante com inspetor de memória extrai e consegue gerar licenças piratas.

**Mitigação:** rotacionar o secret periodicamente (ex.: a cada release major). Pra mudar:
1. Gera novo `SECRET` de 16 bytes
2. Gera novos `_s` (base64 XOR do SECRET com `_k`)
3. Atualiza `license.js` e republica
4. Gera licenças novas pra todos os users ativos

Licenças antigas deixam de funcionar — processo disruptivo, então só em release programada.

---

**Em caso de dúvida:** consulte o Lucas antes de rodar qualquer SQL no Supabase — pode quebrar o app pra todos os usuários simultaneamente.
