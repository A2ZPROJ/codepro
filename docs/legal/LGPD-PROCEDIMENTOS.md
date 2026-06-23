# Procedimentos LGPD Internos — A2Z Projetos / Nexus

**Versão 1.0 · Documento interno · Atualizado em 03/05/2026**

Este documento define os procedimentos internos da A2Z Projetos para cumprimento da LGPD em relação à Plataforma Nexus.

---

## 1. Encarregado de Dados (DPO)

| Item | Detalhe |
|---|---|
| Nome | Lucas Abdala |
| Função | CEO / Desenvolvedor responsável |
| E-mail | lucas.abdala@a2zprojetos.com.br |
| Telefone | (declarar) |

Substituto temporário em férias/afastamento: indicar pessoa.

## 2. Inventário de tratamentos (ROPA — Records of Processing Activities)

### 2.1. Cadastro de usuários
- **Dados:** nome, e-mail, empresa, role, código de acesso (hash)
- **Finalidade:** autenticação e controle de acesso
- **Base legal:** execução de contrato
- **Retenção:** durante vigência + 30 dias

### 2.2. Logs de telemetria
- **Dados:** ações do usuário, IP, localização aproximada, versão do app
- **Finalidade:** auditoria interna, suporte, segurança
- **Base legal:** legítimo interesse
- **Retenção:** 12 meses
- **Compartilhamento:** apenas com o master do tenant correspondente

### 2.3. Dados de saneamento (projetos do cliente)
- **Dados:** endereços, coordenadas, dados pessoais de moradores quando aplicável
- **Finalidade:** processamento técnico solicitado pelo Contratante
- **Base legal:** execução de contrato com o Contratante
- **A2Z atua como:** operadora
- **Retenção:** definida pelo Contratante

### 2.4. Dados financeiros
- **Dados:** razão social, CNPJ, dados de cobrança (não armazena cartão)
- **Finalidade:** cobrança e gestão financeira
- **Base legal:** obrigação legal e contratual
- **Retenção:** 5 anos (fiscal)

## 3. Procedimento — Solicitação de titular (DSR)

### 3.1. Recebimento

Qualquer comunicação no e-mail **lucas.abdala@a2zprojetos.com.br** com assunto contendo "LGPD" deve ser tratada como solicitação prioritária.

### 3.2. Triagem (até 2 dias úteis)

1. Identificar quem é o titular:
   - Funcionário de Tenant? → A2Z é controlador da relação direta
   - Terceiro cadastrado em projeto? → Encaminhar pro Contratante (controlador)
2. Verificar autenticidade da solicitação (e-mail conhecido, prova de identidade se necessário)
3. Classificar tipo do pedido:
   - Acesso / confirmação
   - Correção
   - Eliminação
   - Portabilidade
   - Informação sobre compartilhamentos
   - Revogação de consentimento

### 3.3. Resposta (até 15 dias úteis)

| Tipo | Procedimento |
|---|---|
| **Acesso** | Exportar JSON com todos os dados do titular no banco. Enviar por e-mail criptografado. |
| **Correção** | Atualizar campos solicitados. Confirmar com o titular após. |
| **Eliminação** | Soft-delete (deleted_at = NOW()). Após 30 dias, hard-delete. Logs de auditoria são mantidos por obrigação legal mas anonimizados (user_nome → "***deletado***"). |
| **Portabilidade** | Exportar CSV/XLSX dos projetos e dados estruturados do titular. |
| **Compartilhamentos** | Listar Supabase, GitHub (distribuição), Google (geolocation), gateway de pagamento. |

### 3.4. Registro

Toda DSR deve ser registrada em planilha interna `LGPD-DSR-LOG.xlsx`:
- Data de recebimento
- Titular (nome ou ID)
- Tipo do pedido
- Data de resposta
- Ação tomada
- Anexos (e-mail trocado)

## 4. Procedimento — Incidente de segurança (vazamento)

### 4.1. Detecção

Fontes de detecção:
- Alerta automático do Supabase (login admin não-autorizado, query massiva)
- Reporte de cliente
- Reporte interno

### 4.2. Contenção (primeiras 4h)

1. **Isolar:** revogar credenciais comprometidas, mudar tokens
2. **Investigar:** logs de auditoria do tenant afetado
3. **Documentar:** o que aconteceu, quando, qual extensão dos dados

### 4.3. Notificação (até 72h)

**Se incidente envolveu dados pessoais:**

- ✅ Notificar **ANPD** via formulário oficial: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicacao-de-incidente-de-seguranca
- ✅ Notificar **titulares afetados** por e-mail
- ✅ Notificar **Contratantes (controladores)** afetados

### 4.4. Resolução

- Implementar correção técnica (patch, atualização)
- Atualizar a Política de Privacidade se necessário
- Auditoria pós-incidente em 30 dias
- Lições aprendidas para os procedimentos

## 5. Treinamento

- DPO deve revisar este documento a cada 6 meses
- Toda pessoa nova com acesso ao banco/sistema deve assinar termo de confidencialidade
- Treinamento básico de LGPD para colaboradores anualmente

## 6. Avaliação de impacto (DPIA)

Para novos recursos que processem dados sensíveis ou em larga escala, realizar DPIA antes do lançamento. Template em `docs/legal/templates/DPIA.md` (criar quando necessário).

## 7. Subcontratados (sub-operadores)

| Nome | Serviço | DPA assinado? | País | Última revisão |
|---|---|---|---|---|
| Supabase Inc. | Banco de dados, auth | Sim (DPA padrão) | EUA | declarar |
| GitHub Inc. | Distribuição de software | Sim | EUA | declarar |
| Google LLC | Geolocation API | Sim | EUA | declarar |
| Stripe / Pagar.me | Gateway de pagamento | Sim | EUA / BR | declarar |

A cada renovação contratual com subcontratado, verificar DPA atualizado.

## 8. Auditoria

- A cada 6 meses: revisão dos triggers de auditoria do banco
- A cada 12 meses: revisão de acessos ativos (purgar usuários inativos)
- Quando houver mudança de role (master/admin): revogar acessos e recriar

## 9. Direitos dos Contratantes (controladores)

Os Contratantes podem:
- Solicitar relatório de tratamento (ROPA específico)
- Solicitar exportação completa dos dados do tenant
- Auditar logs de acesso (se incluído no plano)
- Rescindir o contrato e portabilidade conforme Termos de Uso

## 10. Atualizações deste documento

| Data | Versão | Mudanças |
|---|---|---|
| 03/05/2026 | 1.0 | Documento inicial |

---

**Aprovação:**

DPO: Lucas Abdala — _____________________ — Data: ____/____/______
