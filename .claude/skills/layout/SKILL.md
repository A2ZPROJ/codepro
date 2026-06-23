---
name: layout
description: Guia de referencia para mexer no layout/UI do Nexus. Componentes, temas, sidebar, CSS vars, padroes.
user_invocable: true
---

# /layout — Referencia UI do Nexus

O Nexus e um app Electron monolitico. Toda a UI vive em `src/app/index.html` (~2.4MB): HTML + CSS embutido + JS inline. NAO usa React/Vue/Angular.

## Arquivos principais

| Arquivo | Papel |
|---------|-------|
| `src/app/index.html` | App inteiro (HTML + `<style>` + `<script>`) |
| `src/splash.html` | Tela de login/splash |
| `src/boot.html` | Tela de boot |
| `src/main.js` | Processo Electron (main) |
| `src/app/js/core/utils.js` | `esc()` XSS + utilitarios |

## Estrutura do layout

```
body[data-theme="light|dark"][data-theme-color="a2z|azul|verde|..."]
  .app-shell          (display:contents)
    .sidebar           (232px, colapsavel pra 64px)
      .sidebar-brand   (logo A2Z + titulo)
      .sidebar-nav     (scroll, itens .sb-item)
      .sidebar-footer  (botao colapsar)
    .app-main          (display:contents)
      .topbar          (52px sticky, breadcrumb + avatar)
      .app-body        (max 1240px, conteudo)
        .tab-content   (cada aba/modulo)
```

## CSS Variables (tema)

Todas definidas em `:root` dentro do `<style>` de `index.html`.

### Cores principais
```css
--accent         /* cor primaria do tema */
--accent-hover   /* hover da primaria */
--accent-deep    /* topbar/header background (navy) */
--accent-light   /* fundo leve (badges, tags) */
--accent-soft    /* fundo sutil (hover cards) */
--accent-glow    /* sombra com cor */
--accent-ring    /* focus ring */
```

### Superficies
```css
--bg             /* fundo geral */
--surface        /* cards, modais */
--text           /* texto principal */
--text-secondary /* texto secundario */
--border         /* bordas */
--topbar-bg      /* fundo do topbar */
--sidebar-bg     /* fundo da sidebar */
```

### Sombras
```css
--shadow-sm   /* sutil */
--shadow      /* padrao */
--shadow-md   /* elevacao media */
--shadow-lg   /* modais/popovers */
```

### Espacamento e raio
```css
--radius: 8px       /* padrao */
--radius-lg: 14px   /* cards grandes */
--transition: .18s cubic-bezier(.4,0,.2,1)       /* rapida */
--transition-slow: .3s cubic-bezier(.4,0,.2,1)   /* layout */
```

## Componentes prontos

| Componente | Classes CSS | Notas |
|------------|-------------|-------|
| Card | `.card`, `.card-pad` | Hover shadow, border rounded |
| KPI | `.kpi-card`, `.kpi-value`, `.kpi-delta` | Icone + metrica + variacao |
| Modal | `.modal-overlay`, `.modal-box`, `.modal-hdr/body/ftr` | Backdrop blur |
| Dialog leve | `.nexus-dlg-*` | Alert/confirm/prompt |
| Tabs | `.tab-content.active`, `.tab-btn` | Fade+slide |
| Botao primario | `.copy-btn` | Azul, sombra, shine hover |
| Botao ghost | `.ghost-btn` | Transparente |
| Botao verde | `.green-btn` | Sucesso |
| Tabela | `table` | Zebra hover, tabular-nums |
| Form input | `.form-input-sm` | Border focus accent |
| Badge | `.sb-badge`, `.role-badge` | Inline |
| Empty state | `.empty-state` | Icone + titulo + CTA |
| Skeleton | `.skeleton.card` | Loading placeholder |
| Kanban | `.kanban-board`, `.kanban-col`, `.kanban-card` | Scroll horizontal |
| Command Palette | `.cmd-palette` | Ctrl+K, busca global |
| Context menu | `.ctx-menu`, `.ctx-menu-item` | Clique direito |
| Dropzone | `.dropzone-active` | Drag-drop arquivos |
| Status bar | `.status-bar` | Footer fixo, dot conexao |
| Section colapsavel | `.section`, `.sec-hdr`, `.sec-body` | Tag + seta |

## Icones

Lucide Icons via CDN (`lucide@0.460.0`). Uso:
```html
<i data-lucide="icon-name"></i>
```
Inicializar apos inserir no DOM: `lucide.createIcons()`

## Fontes

- **DM Sans** (300/400/500/600) — corpo, titulos
- **DM Mono** (400/500) — codigos, labels tecnicos
- Google Fonts via `<link>` no `<head>`

## Temas disponiveis (20+)

Aplicados via `data-theme-color` no `<body>`:
`a2z`, `azul`, `verde`, `vermelho`, `rosa`, `grafite`, `roxo`, `laranja`, `ciano`, `dourado`, `oceano`, `esmeralda`, `petroleo`, `bordo`, `carvao`, `platina`, `safira`

**A2Z oficial:** preto/cinza/branco. NAO usa vermelho (vermelho = 2S Engenharia).

Dark/light via `data-theme="dark|light"`.

Presets combinam cor + padrao + modo: "Diretoria", "Engenharia", "A2Z", "Corporativo".

## Sidebar — como adicionar item

1. Buscar `<!-- SIDEBAR -->` ou `.sidebar-nav` em `index.html`
2. Adicionar `<a>` com estrutura:
```html
<a class="sb-item" data-tab="meu-modulo" onclick="switchTab('meu-modulo')">
  <span class="sb-icon"><i data-lucide="icon-name"></i></span>
  <span class="sb-label">Meu Modulo</span>
</a>
```
3. Criar `<div class="tab-content" id="meu-modulo">` no `.app-body`
4. Registrar em `allowed_tabs` se houver controle de acesso

## Como adicionar nova pagina/tab

1. Criar `<div class="tab-content" id="nome-tab">` dentro de `.app-body`
2. Estrutura padrao:
```html
<div class="tab-content" id="nome-tab">
  <div class="page-hero">
    <h1 class="page-title">Titulo</h1>
    <p class="page-subtitle">Descricao</p>
    <div class="page-actions">
      <button class="copy-btn" onclick="...">
        <i data-lucide="plus"></i> Novo
      </button>
    </div>
  </div>
  <!-- conteudo -->
</div>
```
3. Adicionar item na sidebar (ver acima)
4. Chamar `lucide.createIcons()` apos montar o DOM

## Densidade

`body[data-density="compact"]` reduz padding/font em cards, KPIs, tabelas.

## Responsivo

- `@media(max-width:720px)` — esconde sidebar auth
- `@media(max-width:600px)` — forms single-column

## Estado global

Sem framework de estado. Variaveis globais em `window`:
- `window._currentUserData` — usuario logado
- `window._projects` — lista de projetos
- `window.sb` — cliente Supabase
- `window.electronAPI` — bridge IPC
- `switchTab(id)` — navega entre abas

## CUIDADOS

- O `index.html` tem ~2.4MB. Ler em blocos (offset/limit) pra nao estourar contexto.
- Todo HTML dinamico DEVE usar `esc()` pra prevenir XSS.
- Nao adicionar `<link rel="stylesheet">` externo — tudo dentro do `<style>` existente.
- Ao mexer em CSS, usar as variaveis de tema (nao hardcodar cores).
- Testar em dark E light mode.
- Testar com sidebar colapsada.
