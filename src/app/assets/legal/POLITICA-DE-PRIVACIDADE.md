# Política de Privacidade — Nexus

**Versão 1.0 · Atualizado em 03/05/2026**

A **A2Z Projetos** ("nós") respeita a privacidade dos usuários do **Nexus** ("Plataforma") e se compromete a tratar dados pessoais conforme a **Lei Geral de Proteção de Dados Pessoais (LGPD - Lei 13.709/2018)**.

Esta Política descreve quais dados são coletados, com qual finalidade, por quanto tempo são retidos e quais são os direitos dos titulares.

---

## 1. Quem somos e nosso papel

- **Controlador:** a empresa-cliente que contratou o Nexus ("Contratante") é controladora dos dados que cadastra na Plataforma — incluindo dados de funcionários, clientes finais, projetos e terceiros.
- **Operador:** a A2Z Projetos é operadora desses dados, processando-os exclusivamente conforme instruções do Contratante.
- **Encarregado de Dados (DPO):** Lucas Abdala — lucas.abdala@a2zprojetos.com.br

## 2. Dados coletados diretamente pela Plataforma

### 2.1. Dados de identificação dos Usuários (funcionários do Contratante)

Coletados no cadastro do usuário:
- Nome completo
- E-mail (opcional)
- Empresa
- Função (role): master, criador, visualizador
- Código de acesso individual (criptografado)
- Tratamento e nome preferido (opcional)

### 2.2. Dados de uso e telemetria

Para fins de **auditoria interna**, **suporte técnico** e **detecção de uso indevido**, são registrados:
- Login e logout (data, horário)
- Aba/funcionalidade acessada
- Versão do software em uso
- Endereço IP público da conexão
- Localização aproximada por IP (cidade, estado, país) — precisão de quilômetros
- Localização precisa por triangulação Wi-Fi via Google Geolocation API (precisão de metros) — quando autorizado pelo sistema operacional
- Identificação do hardware/sistema operacional (User-Agent)
- Ações de criação, edição e exclusão de projetos, orçamentos, usuários e demais entidades do sistema

Esses dados são visíveis apenas ao **master** (administrador) do Tenant correspondente e ao Super Administrador da Contratada.

### 2.3. Dados de pagamento

Quando aplicável (planos pagos), dados de cobrança são processados pelo gateway de pagamento (Stripe ou Pagar.me). A A2Z Projetos **não armazena dados de cartão de crédito**.

## 3. Dados inseridos pelo Contratante na Plataforma

O Contratante pode cadastrar dados pessoais de **terceiros** (clientes finais, fornecedores, responsáveis técnicos), incluindo:
- Nome, CPF/CNPJ
- Endereços (em projetos de saneamento, residências/estabelecimentos atendidos)
- Coordenadas geográficas
- Anotações de campo

**O Contratante é o controlador desses dados** e responde pela base legal e finalidade do tratamento. A Plataforma é apenas o repositório técnico.

## 4. Finalidades e bases legais

| Finalidade | Base legal (LGPD) |
|---|---|
| Autenticação e controle de acesso | Execução de contrato (art. 7º, V) |
| Auditoria interna e detecção de uso indevido | Legítimo interesse (art. 7º, IX) |
| Suporte técnico e resolução de incidentes | Execução de contrato |
| Melhoria do produto (telemetria agregada) | Legítimo interesse |
| Cobrança e gestão financeira | Execução de contrato |
| Cumprimento de obrigações legais e fiscais | Obrigação legal (art. 7º, II) |

## 5. Compartilhamento com terceiros

Os dados são compartilhados apenas com:
- **Supabase Inc.** — provedor de infraestrutura de banco de dados (operador subcontratado, sediado nos EUA, com contrato de DPA conforme LGPD)
- **GitHub Inc.** — distribuição de atualizações do software
- **Google LLC** — apenas a localização aproximada para precisão geográfica via Geolocation API (sem identificação do usuário)
- **Gateway de pagamento** (Stripe ou Pagar.me) — quando aplicável
- **Autoridades públicas** — apenas em cumprimento de ordem judicial ou requisição legal

**Nenhum dado é vendido, compartilhado para fins de marketing ou usado para perfilamento publicitário.**

## 6. Transferência internacional

Dados são armazenados em servidores Supabase localizados nos EUA (regiões padrão). A transferência internacional ocorre com base em **cláusulas-padrão de proteção** e na **decisão do controlador (Contratante)** ao escolher a Plataforma.

## 7. Prazo de retenção

| Tipo de dado | Prazo de retenção |
|---|---|
| Dados de Usuários ativos | Durante a vigência do contrato |
| Logs de auditoria (eventos) | 12 meses (ou conforme exigência legal) |
| Dados após rescisão | 30 dias para portabilidade, depois apagados |
| Dados financeiros (faturas) | 5 anos (obrigação fiscal) |

## 8. Direitos dos titulares

Conforme arts. 17 a 22 da LGPD, qualquer titular pode:

- **Confirmação** da existência de tratamento de seus dados
- **Acesso** aos dados pessoais
- **Correção** de dados incompletos ou desatualizados
- **Anonimização**, bloqueio ou eliminação de dados desnecessários
- **Portabilidade** dos dados (em formato CSV ou XLSX)
- **Eliminação** dos dados tratados com consentimento
- **Informação** sobre compartilhamentos
- **Revogação do consentimento** quando aplicável

**Como exercer:** envie e-mail para **lucas.abdala@a2zprojetos.com.br** com assunto "LGPD — exercício de direito". Resposta em até **15 dias úteis**.

Se o titular for terceiro cadastrado pelo Contratante (não funcionário), a solicitação será encaminhada ao Contratante, que é o controlador.

## 9. Segurança

Medidas técnicas adotadas:
- **Criptografia em trânsito** (HTTPS/TLS) em todas as comunicações
- **Hash de códigos de acesso** com sal individual
- **Row-Level Security (RLS)** no banco — cada Tenant só acessa seus dados
- **Auditoria automática** de operações sensíveis
- **Atualizações de segurança** distribuídas via auto-update
- **Bloqueio de exclusão** em massa (triggers no banco)
- **Backup contínuo** (Supabase Point-in-Time Recovery)

## 10. Cookies e armazenamento local

A Plataforma armazena localmente no computador do Usuário:
- Token de sessão (criptografado em DPAPI no Windows)
- Preferências (tema, layout, recentes)
- Cache de licença para uso offline (até 7 dias)

Não usamos cookies de rastreamento, publicidade ou análise comportamental.

## 11. Crianças e adolescentes

A Plataforma é destinada a uso profissional. Não coletamos conscientemente dados de menores de 18 anos.

## 12. Alterações desta Política

Esta Política pode ser atualizada periodicamente. Mudanças relevantes serão comunicadas com **30 dias de antecedência** por e-mail aos administradores dos Tenants.

## 13. Contato e DPO

Encarregado de Dados:
**Lucas Abdala**
A2Z Projetos
lucas.abdala@a2zprojetos.com.br

Em caso de dúvida, denúncia ou exercício de direitos LGPD, esse é o canal oficial.

Você também pode contatar a Autoridade Nacional de Proteção de Dados (ANPD) — https://www.gov.br/anpd
