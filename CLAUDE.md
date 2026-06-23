# Nexus (codepro)

App Electron de gestao de projetos da A2Z Projetos / 2S Engenharia. Monolito frontend em index.html (~2.4MB) com CSS+JS inline, sem framework (React/Vue). Backend Supabase.

## Stack

- **Runtime:** Electron 29, Node.js
- **Backend/Auth:** Supabase (RLS + Edge Functions + Realtime)
- **Pagamento:** Pagar.me (tokenizacao client-side, webhook server-side)
- **Protecao de codigo:** bytenode (compile-bytecode.js) + javascript-obfuscator (compile-obfuscate.js)
- **DLL Civil 3D:** encriptada AES via embed-civil3d.js, empacotada como civil3d.bin
- **Fontes:** DM Sans / DM Mono (Google Fonts CDN)
- **Icones:** Lucide (UMD via CDN, chamar `lucide.createIcons()` apos inserir HTML)
- **Libs CDN:** Chart.js, Leaflet, jsPDF, html2canvas, QRCode, JSZip, proj4
- **Testes:** vitest (config em vitest.config.js)

## Estrutura

```
src/
  main.js            # processo principal Electron (IPC, auto-updater, tray, Supabase server-side)
  preload.js         # bridge IPC (electronAPI)
  splash.html        # tela de splash com validacao de licenca
  boot.html          # loader intermediario
  app/
    index.html       # TODO o frontend (~2.4MB, NAO ler inteiro - usar offset/limit)
    js/core/utils.js # esc() anti-XSS + helpers
    js/core/audit.js # log de auditoria
  modulos/
    topografia/      # modulo de relatorios topograficos
  store.js           # persistencia local
  license.js         # validacao de licenca DPAPI + hardware binding
  parseOse.js        # parser de planilhas GIS/OSE
  exportOse.js       # exportador XLSX SANEPAR
  dashboardParser.js # parser de dashboard p/ Supabase
scripts/
  embed-civil3d.js   # encripta DLL -> civil3d.bin (OBRIGATORIO antes do build)
  c3d-install-dev.js # instala DLL no bundle local (dev)
  compile-obfuscate.js
  obfuscate-html.js
  restore-source.js  # restaura fontes apos build
assets/              # icone, imagens
build/               # installer.nsh (NSIS customizado)
dist/                # output do electron-builder
tests/               # testes vitest
web/                 # versao web (sync-web.js)
```

## Comandos

| Comando | O que faz |
|---------|-----------|
| `npm start` | Roda em producao |
| `npm run dev` | Roda em modo dev (--dev flag) |
| `npm run embed-civil3d` | Encripta DLL Civil 3D -> civil3d.bin |
| `npm run build` | precompile + electron-builder + restore (gera instalador em dist/) |
| `npm run build:publish` | build + publica release no GitHub (A2ZPROJ/codepro) |
| `npm test` | Roda vitest |

## Deploy da DLL Civil 3D

1. Buildar a DLL no projeto NETLOAD (`D:\PROGRAMACAO\NETLOAD CIVIL 3D`)
2. Rodar `npm run embed-civil3d` — encripta a DLL em `civil3d.bin` dentro do app
3. Para dev local: `node scripts/c3d-install-dev.js` — copia pro bundle ApplicationPlugins
4. Para producao: o Nexus sobrescreve o bundle automaticamente ao iniciar

**NUNCA copiar a DLL manualmente pro bundle.** Usar sempre os scripts acima. Senao o Civil 3D carrega versao desatualizada e o debug vira pesadelo.

## Convencoes de codigo

- **XSS:** Todo HTML dinamico DEVE usar `esc()` (definida em `js/core/utils.js`, exposta como `window.esc`). Nunca usar innerHTML com dados do usuario sem escapar.
- **Temas:** 20+ temas de cor via CSS variables. Toda cor deve usar `var(--nome)`, nunca hardcoded. Testar sempre em modo claro E escuro.
- **Estilos:** CSS inline no index.html via `<style>` tags. Nao criar arquivos .css externos.
- **Icones:** Usar Lucide (`<i data-lucide="nome"></i>`). Chamar `lucide.createIcons()` apos inserir no DOM.
- **Modulos JS:** O index.html usa `<script type="module">` com import de `js/core/utils.js`. Scripts legados acessam via `window.sb`, `window.currentUser`, etc.
- **IPC:** Renderer chama main via `window.electronAPI.metodo()`. Novos handlers no main.js com `ipcMain.handle('nome', ...)`.
- **Supabase client-side:** `window.sb` (criado no index.html). Server-side: instancia separada no main.js.

## Supabase

- Projeto: `xszpzsmdpbgaiodeqcpi`
- Auth via RPC `get_user_by_id` (nao usa Supabase Auth nativo — sistema de licenca proprio)
- RLS ativo com `tenant_id` pra multi-tenant
- Edge Functions: `send-email` (emails transacionais via `window.sendNexusEmail`)
- Tabelas principais: `usuarios`, `projetos`, `codigos`, `dashboard_data`, `dashboard_history`, `estoque_*`, `obras_*`, `rh_*`, `reunioes`
- Migrations SQL na raiz do projeto (`supabase_migration*.sql`, `SUPABASE-*.sql`)

## Armadilhas comuns

1. **index.html e GIGANTE.** Nunca ler inteiro (~60k+ linhas). Usar Read com offset/limit ou Grep pra encontrar a secao relevante.
2. **Nao copiar DLL manualmente.** Sempre usar embed-civil3d.js + c3d-install-dev.js.
3. **Testar tema claro E escuro.** Cor hardcoded quebra em um dos modos.
4. **bytenode:** O OneDrive sync corrompe arquivos .jsc. Por isso o projeto esta em D:\ fora do OneDrive.
5. **pdfmake 0.3.x:** Formato de vfs_fonts mudou. Usar `pdfMake.vfs` (3 formatos aceitos, ver fix v2.55.224).
6. **Auto-updater:** electron-updater publica no GitHub Releases. Se rede flaky, build local + curl --resolve direto na API.
7. **Single instance:** main.js usa `requestSingleInstanceLock()`. Sem isso, crash loop spawna infinitas janelas.

## Publish (release)

1. Verificar rede antes: pingar github.com e api.github.com
2. Incrementar version no package.json
3. `npm run build:publish`
4. Se rede instavel: fazer `npm run build` local, depois upload manual via `curl --resolve` pra REST API do GitHub
5. Validar SHA256 do .exe apos upload
6. O auto-updater dos clientes detecta a nova release automaticamente

## Versao atual

v2.56.3 — verificar package.json pra versao real.
