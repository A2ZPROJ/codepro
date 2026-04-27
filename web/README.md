# Nexus PWA (versão web/mobile)

Pasta independente da versão desktop. **Não mexe em `src/`** — o Nexus Desktop continua funcionando normal.

## O que é

Versão web/mobile do Nexus, instalável como PWA no Android/iOS ("Adicionar à tela inicial"). Compartilha o mesmo backend Supabase do desktop, então o mesmo código de acesso funciona nas duas versões.

## Estrutura

```
web/
├── index.html              # app (cópia do src/app/index.html adaptada)
├── web-adapter.js          # reimplementa window.electronAPI com Web APIs
├── web-login.js            # tela de login (substitui splash.html)
├── mobile.css              # overrides responsivos pra <768px
├── manifest.webmanifest    # manifest PWA
├── sw.js                   # service worker (offline + cache)
├── vercel.json             # config deploy Vercel
├── netlify.toml            # config deploy Netlify (alternativa)
├── icons/                  # ícones PWA (SVG)
└── lib/                    # módulos JS copiados de src/ (parseOse, oseStatus, etc.)
```

## Rodar local pra testar

Precisa de HTTPS (ou localhost) por causa do service worker. Opções:

**Opção A — Python simples:**
```bash
cd web
python -m http.server 8080
# abre http://localhost:8080
```

**Opção B — Node serve (mais features):**
```bash
npx serve web -l 8080
```

Abrir no Chrome → F12 → Application tab → Manifest/Service Workers pra debugar.

## Deploy

### Vercel (recomendado — mais rápido)

1. Criar conta em [vercel.com](https://vercel.com) (use o login GitHub)
2. Import Project → conecte o repo `A2ZPROJ/codepro`
3. **Root Directory**: `web`
4. Framework preset: "Other" (é estático)
5. Deploy — vai gerar URL tipo `nexus-a2z.vercel.app`

Todo push pro GitHub redeploya automático.

Domínio custom: Settings → Domains → adiciona `nexus.a2zprojetos.com.br` (precisa configurar CNAME no DNS do domínio).

### Netlify (alternativa)

1. [netlify.com](https://netlify.com) → New site from Git
2. Conectar repo, **Base directory: `web`**, Publish directory: `.`
3. Deploy

### GitHub Pages (grátis, mas requer action)

Menos direto porque Pages serve da branch `gh-pages` ou da pasta `/docs`. Tem que configurar uma GitHub Action pra copiar `web/` pra `gh-pages` a cada push. Se quiser, eu faço.

## O que funciona / o que falta

### Funciona
- Login com access_code (mesmo do desktop)
- Cache offline 7 dias (igual desktop)
- Todas as abas renderizam
- Dashboard, Cadastrar Código, Histórico, Projetos, GRD (metadados), Perfil, Admin, Dashboard 2S
- Orçamento (BDI, tabelas, orçamentos — parte DB)
- Mapas Leaflet
- Responsividade mobile (sidebar hamburger, modais full-screen, tabelas com scroll)
- Instalação PWA (Android + iOS)
- Service Worker + offline
- Auto-update silencioso (toast "nova versão")

### Parcial / v2
- **Conferência OSE**: UI carrega, mas o parser DXF/XLSX precisa ser adaptado pra aceitar File objects (hoje usa `fs.readFileSync`). TODO: `web/lib/parseOse.js` precisa shim de fs + Buffer. Mostra placeholder enquanto isso.
- **Renomear**: seleciona pasta via File System Access API (só Chromium), gera ZIP pra download em vez de renomear in-place. Safari iOS não tem API — fallback via input webkitdirectory.
- **Verificar projeto**: idem, depende da File System Access API.
- **Memorial descritivo (.docx)**: a lib `docx` é ESM. Funciona via esm.sh mas precisa teste.
- **GRD PDF com logos locais**: logos agora saem de `web/icons/` em vez de caminhos absolutos.

### Bloqueado no mobile (por decisão)
- **Planilhas GIS**: aba escondida + `switchTab` intercepta. Esse fluxo depende de editor Univer + processamento pesado que não é viável em celular.

## Como conviver com o Nexus Desktop

- `src/` continua sendo a fonte do Electron. Build desktop = `npm run build:publish` (não mudou nada)
- `web/` é a fonte do PWA. Deploy = commit & push (Vercel rebuilda)
- Arquivos em `web/lib/` são **cópias** de `src/*.js`. Quando você fizer um fix relevante no parser (ex: parseOse), precisa replicar manualmente em `web/lib/parseOse.js`
- Quando fizer uma feature nova no desktop `src/app/index.html`, avalia se vale portar pra `web/index.html` (as duas cópias vão divergir naturalmente — isso é esperado)

## Debugging

Mobile remote debug (Android Chrome):
1. `chrome://inspect` no desktop
2. USB debugging no celular
3. Abrir o PWA no Chrome mobile
4. DevTools aparece no desktop — mesmo F12

iOS Safari:
1. Safari → Preferências → Avançado → "Mostrar menu Desenvolvedor"
2. iPhone: Ajustes → Safari → Avançado → "Inspetor da Web: ON"
3. Conectar cabo, abrir PWA no Safari, ir em Desenvolver → iPhone no Mac

## Versão PWA

A versão é carimbada no `sw.js` (`const VERSION = '...'`). Bumpar quando houver mudança no shell que o SW precisa re-cachear.
