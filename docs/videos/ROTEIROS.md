# Roteiros de Vídeo — Nexus

**Para gravar em 03/05/2026 (manhã).**

Este arquivo tem 10 roteiros prontos. Total estimado: ~25 minutos divididos.

## Setup geral antes de gravar

- **Software:** OBS Studio (gratuito) ou Loom. OBS dá mais qualidade, Loom é mais rápido.
- **Resolução:** 1920×1080 a 30fps.
- **Microfone:** headset USB qualquer (não use o do notebook — capta tudo).
- **Ambiente:** silencioso, fechar notificações do Windows (Foco Assistido → Apenas alarmes).
- **Nexus aberto em janela maximizada** (Cmd+Up no Windows = maximizar).
- **Versão a usar:** v2.41.0 (mais nova, com onboarding e billing).
- **Login:** seu (`A2ZP-MSTR`). Se for mostrar trial, criar tenant de teste antes pra gravar com nome de empresa fictícia.

## Antes de cada vídeo

1. Fechar todas as outras janelas/abas
2. Desativar notificações
3. Abrir Nexus na aba inicial
4. Posicionar mouse no canto superior esquerdo (longe do conteúdo)
5. Respirar fundo, falar devagar
6. Se errar, **pause e refaça** — corte na edição

## Estilo geral de fala

- **Curto:** frases de 6-10 palavras
- **Direto:** "Aqui você cadastra projeto" em vez de "Nesta página você pode realizar o cadastro do seu projeto"
- **Ativo:** "clico aqui" em vez de "ao clicarmos aqui"
- **Sem 'tipo', 'né', 'então'** — substitua por pausas

---

## VÍDEO 1 — Apresentação geral (90s)

**Título sugerido:** "Nexus — visão geral em 90 segundos"
**Duração:** 60-90s
**Público:** prospect / cliente em demo
**Use como:** vídeo de capa, primeiro contato

### Setup
- Aba "Painel" (dashboard inicial) aberta
- Login feito como master

### Script

**[0:00-0:08]** Tela do painel, falando enquadrando a interface

> "Esse é o Nexus, plataforma da A2Z Projetos pra gerenciar projetos executivos de saneamento Sanepar. Vou mostrar o que dá pra fazer aqui."

**[0:08-0:20]** Move mouse pelo sidebar lateral, mostrando as principais abas (sem clicar)

> "Tem mais de 16 abas, cada uma resolve uma parte do trabalho de campo: cadastro de projetos, conferência técnica, orçamentos, dashboard de contrato, estoque, e um plugin Civil 3D embutido."

**[0:20-0:40]** Clique em **Cadastrar Novo Projeto** → mostra formulário rapidamente, sem preencher

> "A gente começa cadastrando o projeto e os códigos OSE. Aqui o Nexus já vincula sua equipe — projetista, cadista, planilhista — e amarra tudo numa data de entrega."

**[0:40-1:00]** Clique em **Conferência OSE** → mostra área de upload

> "O coração técnico é a Conferência OSE. Você joga o mapa em DXF, o perfil em DXF e a planilha SANEPAR. O Nexus cruza os 3 e te diz tudo que tá errado: cota torta, declividade fora do padrão, degrau invertido. Tudo isso em segundos."

**[1:00-1:20]** Clique em **Orçamento** → mostra template

> "E pra fechar, importação automática dos códigos pro orçamento, com o template Acciona-Sanepar configurado. BDI, materiais, mão de obra, tudo já calculado."

**[1:20-1:30]** Volta pra aba Sobre, mostra logo

> "Tudo isso num pacote único. Quer ver mais? Vou deixar o link do tour completo nos comentários."

### Notas
- Não detalha NADA — é overview
- Deixa o telespectador querendo mais
- Termina com CTA pro próximo vídeo

---

## VÍDEO 2 — Conferência OSE (3-4min) **[CRÍTICO]**

**Título:** "Conferência OSE automatizada — Mapa, Perfil e Planilha SANEPAR"
**Duração:** 3-4 min
**Público:** engenheiro técnico avaliando
**Use como:** vídeo principal de venda

### Setup pré-gravação
- Tenha 3 arquivos prontos numa pasta acessível:
  - `MAPA-OSE.dxf` (qualquer projeto seu)
  - `PERFIL-OSE.dxf`
  - `BACIA-PO.xlsx` (planilha SANEPAR)
- Aba **Conferência OSE** aberta

### Script

**[0:00-0:15]** Tela da Conferência OSE vazia

> "Conferência OSE no Nexus. Esse aqui é o trabalho técnico que mais consome tempo no projeto executivo: bater mapa, perfil e planilha. Vou mostrar como fica em segundos."

**[0:15-0:45]** Clica nos 3 inputs e seleciona os arquivos (1 por vez)

> "Primeiro carrego o **mapa em DXF**. Aqui ele já mostra quantas OSEs identificou, quantos PVs, quantos blocos órfãos pra você fazer PURGE depois.
> Agora o **perfil**. Mesma coisa, identifica trecho a trecho.
> E a **planilha SANEPAR**, que tem comprimentos, declividades e cotas declaradas."

**[0:45-1:30]** Clica em **Conferir** ou **Verificar**

> "Clico em conferir. Em segundos ele cruza tudo. E mostra os resultados aqui em cima — verde tá ok, amarelo é aviso, vermelho é erro."

**[1:30-2:30]** Mostra cada tipo de erro detectado (rola pela tabela)

> "Olha que ele detecta:
> • Degrau invertido — quando a cota saída do PV é maior que a chegada
> • TQ que tá fora da cabeceira
> • Distância maior que 85 metros entre PVs
> • Declividade fora do mínimo
> • UTM × Local desencontradas — quando o desenho tá em coordenada local mas a planilha em UTM
> • DN não monotônico — diâmetro reduzindo no meio do trecho"

**[2:30-3:00]** Clica em **Pro Mode** ou Modal foco

> "Tem o Pro Mode pra revisar item a item, com atalhos de teclado. Apertou J vai pro próximo, K volta. Ignorar erro por linha pra anotar 'sim, eu sei, é desse jeito mesmo'. Tudo fica registrado."

**[3:00-3:30]** Volta na tela principal, clica em **Modo Foco** ou **Mapa**

> "E ainda tem mapa interativo com cada PV plotado. Clica num pin, vê todos os dados. Clica num erro, ele te leva direto no PV."

**[3:30-4:00]** Fecha mapa, mostra botões de export

> "No final, exporta relatório em PDF executivo, ou XLSX SANEPAR pra anexar. Bem-feito, cliente assina sem reclamar."

### Notas
- Esse é o **vídeo de venda** principal
- Mostre arquivo REAL, não mockup
- Se aparecer erros, é bom — mostra que funciona
- Não conserte os erros no vídeo, só mostra que detectou

---

## VÍDEO 3 — Wizard 4 etapas GIS (3-4min)

**Título:** "Do GIS ao DXF — wizard de 4 etapas no Nexus"
**Duração:** 3-4 min
**Público:** engenheiro de projetos executivos

### Setup
- Aba **Correção de Planilha GIS** aberta
- Tenha 1 planilha GIS de exemplo pronta

### Script

**[0:00-0:15]**

> "Quando o pessoal do GIS te manda a planilha bruta, você precisa: corrigir, calcular hidráulica, conferir interferências, e só depois gerar PDF/DXF. Tudo isso no Nexus."

**[0:15-0:45]** Carrega a planilha GIS

> "Primeira etapa: editor estilo Excel embutido. Você corrige declividade, ajusta cotas, marca PV final. Tudo aqui mesmo, sem abrir Excel separado."

**[0:45-1:30]** Avança pra etapa 2

> "Etapa 2: auditoria automática. Detecta cabeceiras com cota presa, declividades fora do padrão, problemas que precisam corrigir antes de seguir."

**[1:30-2:15]** Etapa 3

> "Etapa 3: hidráulica e interferências. O Nexus calcula CF mínimo, TQ, profundidades. Detecta cruzamento com outras redes."

**[2:15-3:30]** Etapa 4

> "Etapa 4 — a melhor: exporta tudo. PDF executivo de uma OSE só ou de várias selecionadas. XLSX no formato SANEPAR. Mapa em DXF. Perfil em DXF. Tudo de uma vez."

**[3:30-3:45]** Mostra arquivos gerados

> "Esses arquivos saem prontos pra entregar. Substitui horas de trabalho manual."

---

## VÍDEO 4 — Orçamento automático (2-3min)

**Título:** "Orçamento Acciona-Sanepar com importação automática de OSEs"

### Setup
- Aba **Orçamento** aberta
- Ter um projeto cadastrado com OSEs

### Script

**[0:00-0:15]**

> "Orçamento de saneamento é chato: você precisa contar PVs por faixa de profundidade, somar metros de tubo por DN, escavação por largura de vala. O Nexus faz isso pra você."

**[0:15-1:00]** Clique em **Importar OSE**

> "Seleciono o projeto. O Nexus pega todas as OSEs vinculadas. E processa: escavação por faixa de profundidade × largura de vala × comprimento; PVs agrupados por faixa; tubos por DN; reaterro; ligações prediais — tudo já mapeado pros códigos SANEPAR."

**[1:00-1:30]** Mostra a lista de itens gerada

> "Aqui ó: 50 itens já preenchidos automaticamente. BDI configurado — 24,49% pra mão de obra, 12,99% pra material — conforme padrão Acciona-Sanepar."

**[1:30-2:15]** Edita um item, mostra modal

> "Posso editar qualquer item, ajustar quantidade, mudar tabela de preço. Tudo recalcula em tempo real."

**[2:15-2:45]** Clica em **Exportar XLSX**

> "Exporto pro XLSX modelo Acciona. Já formatado, com cabeçalho do contrato, totalizadores, tudo certinho. Manda pro cliente, assina, manda pra cobrança."

**[2:45-3:00]**

> "Estimativa? 2 horas de orçamento manual viram 5 minutos."

---

## VÍDEO 5 — Plugin Civil 3D (3-4min)

**Título:** "Plugin Nexus pro AutoCAD Civil 3D — 11 comandos integrados"

### Setup
- AutoCAD Civil 3D 2026 aberto com um DWG pronto
- Plugin Nexus carregado (NETLOAD da DLL)
- Tenha um shape de pipes pronto

### Script

**[0:00-0:15]**

> "O Nexus vem com plugin pro Civil 3D. Carrega via NETLOAD e dá 11 comandos novos."

**[0:15-0:45]** No CAD, mostra `CARREGARNEXUS` ou similar

> "Carregado. Agora roda IMPORTAREDE."

**[0:45-1:30]** Demonstra `IMPORTAREDE`

> "Esse comando importa shapefile com a rede toda — pipes, PVs, tipos. Já cria com estilos SANEPAR pré-selecionados. REV 05 - ESGOTO PLANTA. Sai pronto pra desenhar em cima."

**[1:30-2:00]** `CRIARALINHAMENTO` e `CRIARPERFIL`

> "Cria alinhamento horizontal e perfil longitudinal automático. Estilo MND-R10 já no padrão."

**[2:00-2:30]** `RELATORIOREDES`

> "Esse aqui exporta XLSX com toda a rede — 5 abas, dados topográficos, hidráulica, profundidades. Substitui o relatório manual."

**[2:30-3:00]** `MALHACOORD` ou `ROTULARLINHAS`

> "Malha de coordenadas pra plantas. Rotular linhas com medida e texto livre. FLIPTEXTO inverte texto pro outro lado da linha. MERGEREDES junta duas pipe networks numa só."

**[3:00-3:30]**

> "Tudo isso amarrado na sua licença Nexus. Abre o programa, faz login, e o plugin valida sozinho. Sem precisar mexer em chave, dongle, nada."

---

## VÍDEO 6 — Dashboard de Contrato (1-2min)

**Título:** "Dashboard de Contrato — visão executiva da diretoria"

### Setup
- Aba **Dashboard Contrato** aberta
- Ter uma planilha XLSX de contrato carregada

### Script

**[0:00-0:15]**

> "Diretoria quer saber andamento do contrato sem precisar abrir 50 arquivos. Dashboard resolve."

**[0:15-1:00]** Mostra o painel

> "Carrega a planilha do contrato uma vez, e o Nexus monta o painel: progresso por OSE, totais por distrito, atrasos destacados, métricas. Filtros por sub-bacia, por equipe, por status."

**[1:00-1:30]** Mostra dropdown de filtros

> "Filtra Sedes, distritos. Cada bolinha é uma OSE com sua barra de progresso."

**[1:30-2:00]**

> "E o melhor: tem versão pública em PWA. Diretor abre no celular, vê tudo. Atualiza automaticamente."

---

## VÍDEO 7 — Cadastro de Projetos + GRDs (1-2min)

**Título:** "Cadastro de projetos e GRD — gestão integrada"

### Setup
- Aba **Cadastrar Novo Projeto** aberta

### Script

**[0:00-0:20]** Preenche formulário

> "Cadastrar projeto novo: nome, cliente, data de entrega, status, tipo de relatório. Vincula projetista, cadista, planilhista, coordenador."

**[0:20-0:50]** Mostra dropdown de códigos

> "Aqui você seleciona quais códigos OSE entram nesse projeto. Códigos novos? Cadastrei aqui mesmo, ele já vincula."

**[0:50-1:30]** Clica em **GRD**

> "Quando entrega o projeto, gera a GRD aqui — Guia de Remessa de Documentos. Já preenchida com tudo. Cabeçalho, lista de documentos, assinaturas. Imprime ou manda PDF."

---

## VÍDEO 8 — Estoque (2-3min)

**Título:** "Controle de estoque com QR Code, foto e inventário"

### Setup
- Aba **Estoque** aberta
- Ter alguns itens cadastrados

### Script

**[0:00-0:15]**

> "Almoxarifado de obra geralmente vira bagunça. Nexus tem módulo de estoque integrado."

**[0:15-1:00]** Mostra cards/lista

> "Cadastra item: nome, foto, local, fornecedor, quantidade. Gera QR Code automático — cola na peça e escaneia no celular."

**[1:00-1:45]** Mostra retirada

> "Pra registrar retirada: escaneia QR, escolhe quantidade, vincula ao projeto e ao colaborador. Reserva por OSE pra não dar conflito."

**[1:45-2:30]** Mostra inventário

> "Inventário fechado: roda contagem, sistema mostra divergências. Curva ABC pra ver itens críticos. Importação XLSX pra começar com base existente."

---

## VÍDEO 9 — Monitoramento (master only) (1-2min)

**Título:** "Monitoramento da equipe em tempo real (recurso master)"

### Setup
- Logado como master
- Aba **Monitoramento** aberta

### Script

**[0:00-0:15]**

> "Recurso pro administrador master. Mapa em tempo real de onde a equipe tá usando o Nexus."

**[0:15-1:00]** Mostra mapa + presence

> "Cada pin é um usuário. Verde = online agora, amarelo = ativo nos últimos 10 minutos, cinza = offline. Endereço aproximado por IP, ou preciso por triangulação Wi-Fi (~20 metros)."

**[1:00-1:30]** Mostra log live

> "Log de eventos em tempo real: quem logou, quem trocou de aba, quem criou ou apagou o quê. Filtra por usuário, por data. Exporta CSV pra auditoria."

**[1:30-2:00]** Trocando layers

> "5 mapas: padrão, escuro, topográfico, Google Maps e Google Satélite. Escolhe o que preferir."

---

## VÍDEO 10 — Como começar (instalação + primeiro login) (2min)

**Título:** "Como instalar e começar a usar o Nexus"

### Setup
- VM ou outro PC sem Nexus instalado (pra mostrar instalação real)
- Tenha o link do GitHub Releases aberto

### Script

**[0:00-0:20]**

> "Como instalar o Nexus."

**[0:20-0:50]** Mostra GitHub Releases (ou link direto)

> "Acessa o link de download. Clica em Nexus-Setup, baixa o exe. Executa. Não precisa de nada — só clicar avançar avançar instalar."

**[0:50-1:20]** Abre primeira vez

> "Primeira tela pede o código de acesso, formato XXXX-XXXX. Isso eu te mando individualizado quando você assina. Digita, e em 1 segundo tá dentro."

**[1:20-1:50]** Mostra o tour automático

> "O tour de boas-vindas roda automático na primeira vez. Mostra os pontos principais. Pode pular ou fazer."

**[1:50-2:00]**

> "Pronto. Agora você usa. Atualizações automáticas — não precisa fazer nada."

---

## Pós-gravação

### Edição
- **Loom:** edição mínima já vem do gravador. Cortar começo/fim e exportar.
- **OBS:** edita em DaVinci Resolve (gratuito) ou Shotcut (mais simples).
- **Cortes:** remova "ééé", "ahhh", silêncios longos.
- **Velocidade:** se ficou longo demais, acelere pra 1.05× ou 1.1× (quase imperceptível).

### Publicação
- **Vimeo Pro** ou **YouTube unlisted** pra hospedar.
- **Linkar no app:** posso adicionar um botão "Ver tutoriais" na aba Sobre que abre uma página com todos os vídeos. Me passa as URLs depois que publicar.

### Métricas
- Acompanhar **retention** (% que assiste até o fim) — vídeos curtos (<3min) costumam ter retention >70%.
- Bots de venda: deixar Vídeo 1 + Vídeo 2 fixados na landing page.

---

## Lista de checagem antes de gravar cada vídeo

- [ ] Janela do Nexus maximizada
- [ ] Todas as outras janelas fechadas
- [ ] Notificações Windows desativadas
- [ ] Microfone testado (sem eco, sem ruído)
- [ ] Roteiro impresso ou em segunda tela
- [ ] Mouse com movimento lento (não tremula)
- [ ] Respiração — pausa entre frases

## Boa sorte 🎬
