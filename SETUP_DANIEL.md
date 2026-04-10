# Setup do ambiente — Daniel Gama

Guia passo-a-passo pra você começar a programar o **Nexus** (codepro) junto com o Lucas, usando Claude Code como assistente de IA. Tempo total: ~30 min.

---

## 1. Instalar pré-requisitos

### 1.1 Node.js (versão LTS)
- Baixa em https://nodejs.org → botão **LTS**
- Instala normal, deixa todas as opções padrão marcadas
- Reinicia o terminal/PowerShell depois pra `node` ficar disponível

Pra confirmar, abre o **PowerShell** e roda:
```
node --version
npm --version
```
Tem que aparecer versão tipo `v22.x` e `10.x`.

### 1.2 Git for Windows
- Baixa em https://git-scm.com/download/win
- Instala normal, opções padrão (mantém "Git Bash" ativado, é útil)

Confirma:
```
git --version
```

### 1.3 VS Code (editor)
- Baixa em https://code.visualstudio.com/
- Instala normal

---

## 2. Conta GitHub e acesso ao repositório

1. Cria uma conta em https://github.com/ (se ainda não tiver) — pode ser email pessoal mesmo
2. Manda teu **username do GitHub** pro Lucas — ele vai te adicionar como collaborator no `A2ZPROJ/codepro`
3. Aceita o convite que vai chegar no seu email

---

## 3. Conta Anthropic + Claude Code

O Claude Code é o assistente de IA da Anthropic que ajuda a programar dentro do terminal. É a mesma ferramenta que o Lucas está usando.

1. Cria conta em https://claude.ai/
2. Assina o plano **Claude Pro** (US$ 20/mês) ou **Max** — necessário pra usar Claude Code com sua conta
3. Instala o Claude Code via npm (PowerShell):
```
npm install -g @anthropic-ai/claude-code
```
4. Confirma:
```
claude --version
```

Documentação oficial: https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview

---

## 4. Clonar o repositório

Cria uma pasta pros teus projetos (ex: `C:\Dev`) e clona o codepro lá dentro:

```
mkdir C:\Dev
cd C:\Dev
git clone https://github.com/A2ZPROJ/codepro.git
cd codepro
npm install
```

O `npm install` baixa as dependências do Electron, vai demorar uns 2-5 min.

---

## 5. Rodar o Nexus em modo desenvolvimento

Pra abrir o Nexus localmente (sem precisar instalar o .exe):
```
npm start
```

Vai abrir uma janela igual ao Nexus instalado, mas rodando direto do código fonte. Qualquer alteração que você fizer nos arquivos `src/` reflete quando você fechar e reabrir.

---

## 6. Iniciar o Claude Code

Dentro da pasta do projeto (`C:\Dev\codepro`), roda:
```
claude
```

Na primeira vez ele vai pedir pra você fazer login na sua conta Claude. Depois disso, ele lê automaticamente os arquivos da pasta atual e você pode pedir pra ele fazer alterações, explicar código, debugar, etc — exatamente como o Lucas tá usando.

---

## 7. Workflow de trabalho com o Lucas

Pra evitar pisar no que o outro tá fazendo, usem **branches** do git:

### Antes de começar uma feature:
```
git checkout main
git pull
git checkout -b daniel/nome-da-feature
```

### Durante o trabalho:
- Mexe nos arquivos normalmente (com ajuda do Claude Code)
- Testa com `npm start`

### Quando terminar:
```
git add .
git commit -m "descrição do que mudou"
git push -u origin daniel/nome-da-feature
```

Depois abre um **Pull Request** no GitHub apontando pra `main`. O Lucas revisa e faz o merge. Quando aprovado, é ele quem roda o comando que gera a nova versão e publica pros outros usuários atualizarem (`npm run build:publish`) — você não precisa se preocupar com isso.

---

## 8. Coisas importantes pra saber

### Estrutura do projeto
- `src/main.js` — processo principal Electron (Node.js, fala com sistema operacional)
- `src/preload.js` — bridge segura main ↔ renderer
- `src/app/index.html` — toda a interface (~5000 linhas, contém UI + CSS + JS de tudo)
- `src/dashboardParser.js` — parser do Excel do Dashboard Diretoria
- `src/parseOse.js` — parser dos DXF/Excel da Verificação OSE
- `src/exportOse.js` — gera o relatório Excel da OSE
- `src/oseStatus.js` — lógica de classificação de OSEs (compartilhada UI/Excel)
- `assets/` — logos, ícones
- `package.json` — versão do app + dependências

### Coisas que NÃO mexer sem alinhar com Lucas
- `package.json` versão (`"version": "1.x.y"`) — só Lucas bumpa quando vai publicar
- `build:publish` — só Lucas roda
- `src/license.js` — sistema de licenças, qualquer mudança quebra o login

### Token GitHub
Se você precisar fazer push e pedir senha, gera um Personal Access Token em https://github.com/settings/tokens (escopo `repo`) e usa ele como senha. O Git vai salvar.

---

## 9. Dúvidas?

Manda no WhatsApp do Lucas. Bom código!

---

**Versão atual do Nexus:** 1.8.8
**Repositório:** https://github.com/A2ZPROJ/codepro
**Documentação Claude Code:** https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview
