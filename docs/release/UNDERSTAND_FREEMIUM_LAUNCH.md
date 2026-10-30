# Understand.io: lançamento freemium, preparação para o público

Branch `feature/freemium-launch`, a partir da `main` em `ea498f6`. Escrito em 2026-10-30. **Nada desta branch está em produção**, nenhum segredo, valor financeiro, DNS ou `APP_URL` de produção foi alterado, nenhum serviço foi comprado, nenhum texto legal foi publicado, nenhum banco foi alterado além de bancos descartáveis locais. **O único contato com produção** foram leituras (saúde, variáveis só pelos nomes, configurações do projeto e da equipe), a verificação pós-publicação (que cria e apaga seus próprios dados) e **3 chamadas reais de IA** para medir o custo por pergunta, dentro das cotas anônimas do meu endereço e do orçamento.

## Resumo

| Pergunta | Resposta |
| --- | --- |
| O freemium (3 perguntas por dia anônimo, 20 por conta, uma geração por vez) já funciona no servidor? | **Sim**, desde a release do beta, com contagem no banco, travas atômicas e 429 claros. Esta rodada **verificou** cada requisito (tabela abaixo) e **corrigiu um defeito de custo** descoberto ao medir |
| Defeito encontrado | A resposta de margem (`/api/gloss`) registrava **0 token** em produção: o orçamento de IA **não contava** esse custo. Corrigido nesta branch; **só vale depois do deploy** |
| Beta controlado | **GO**, com condições (itens do dono abaixo; a primeira é fazer o deploy desta branch) |
| Lançamento público | **NO-GO**: textos legais com pendências do dono e revisão jurídica, monitor externo não configurado, Spend Management da Vercel e limite da Together a confirmar, avaliação do Google a confirmar |

## 1. O que foi feito nesta rodada

| # | Mudança | Onde |
| --- | --- | --- |
| 1 | **Custo da resposta de margem corrigido**: pede o uso de tokens ao provedor (`stream_options.include_usage`) e, se o provedor não informar, cobra uma estimativa (caracteres enviados e recebidos) em vez de zero | `src/lib/ai/provider.ts`, `src/lib/ai/budget.ts`, `src/app/api/gloss/route.ts`; 2 testes novos que falham sem a correção |
| 2 | **Alertas de armazenamento do Neon Free**: `/api/health` mede o tamanho do banco contra `GLOSS_DB_STORAGE_LIMIT_MB` (padrão 1024): **70% = aviso** (`warnings`, HTTP 200), **85% = motivo** (`db-storage-85`, 503 com `?strict=1`) | `src/lib/server/healthProbe.ts`, `src/app/api/health/route.ts`, `src/lib/server/aiStore.ts` |
| 3 | **O monitor não mantém o Neon acordado**: leitura saudável do banco reaproveitada por 15 minutos (`GLOSS_HEALTH_DB_CACHE_SECONDS`); falha nunca é reaproveitada; uma repetição antes de dizer `database-down` (computação acordando); `?fresh=1` força leitura real | idem; 6 testes novos em `tests/unit/health.test.ts` |
| 4 | **Backup lógico**: `scripts/db-backup.sh` (somente leitura, não imprime a conexão, valida o arquivo), a única recuperação além das 6 h do Neon Free | `scripts/db-backup.sh`; testado com backup e restauração em bancos descartáveis |
| 5 | **Relatório de gasto**: `scripts/spend-report.mjs` (somente leitura) | já na `main` desde o PR #9 |
| 6 | **Textos legais**: operador **Menlo Software AIP** e contato **jm@useclave.io** preenchidos nos 5 textos (en e pt-BR), seção "Contato e solicitações de privacidade", freemium na seção de preços, Vercel `iad1`, Neon Free com 6 h de histórico; **nada inventado** (sem CNPJ, endereço, forma jurídica, prazos). Lista de pendências agora **gerada** dos marcadores | `docs/legal/*`, `scripts/legal-open-items.mjs` |
| 7 | **Domínio**: endereço canônico e `metadataBase` vêm do `APP_URL` (trocar o domínio não exige código); verificador somente leitura `scripts/domain-check.mjs`; checklist de entrega | `src/app/layout.tsx`, `scripts/domain-check.mjs`, `docs/ops/domain-migration.md` |
| 8 | **Verificação pós-publicação** passa a ler a saúde com `?fresh=1` e a conferir o nível de armazenamento | `scripts/post-deploy-check.mjs` |
| 9 | **Documentos**: operação do Neon Free, revisão da Vercel Pro, relatório inicial de orçamento de IA, monitoramento (dois monitores a criar, tabela de prova de entrega de alertas) | `docs/ops/neon-free-operations.md`, `docs/ops/vercel-pro-review.md`, `docs/release/AI_BUDGET_REPORT.md`, `docs/ops/monitoring-and-alerts.md` |

Não foi preciso reescrever o freemium: a verificação abaixo mostra que cada requisito já estava coberto e testado.

## 2. Requisitos do freemium, um a um

| Requisito | Estado | Como e prova |
| --- | --- | --- |
| Anônimo: 3 perguntas por dia | **ok** (por navegador, 10 por endereço de rede, 300 no total) | `GLOSS_QUOTA_AI_*`; testes `aiAdmission`, `ai-quota-routes`, `allowances.test.ts` (integração com 2 a 5 servidores reais); em produção, a 4ª pergunta do meu IP recebeu 429 em 2026-10-30 com a mensagem "You have used today's 3 free AI questions. Sign in with Google for 20 a day…" |
| Autenticado: 20 por dia | **ok** (por conta, em qualquer aparelho) | idem; a 21ª recebe 429, outra conta não é afetada |
| Uma geração por vez | **ok** (lease no banco; 2ª requisição recebe 429 `busy-user` e **não gasta** a cota) | `aiAdmission.test.ts`, `allowances.test.ts` |
| Leitura pública, importação por link, texto colado e PDF continuam gratuitos | **ok**, sem cota de IA | rotas `/api/import*` fora da cota de IA (limite próprio de 60 por 10 min); post-deploy-check importa um texto em produção |
| Tudo configurável por ambiente | **ok** | tabela da seção 3 |
| Servidor decide; contadores do cliente não valem | **ok** | cotas no `rate_hits`/`ai_leases`/`ai_ledger` do PostgreSQL |
| Requisições paralelas não furam a cota | **ok** | contagem atômica; 20 simultâneas contam 1 a 20 (`aiStoreDatabase.test.ts`); 12 simultâneas em 2 instâncias: só as que cabem começam (`allowances.test.ts`) |
| Armazenamento persistente e compartilhado em produção | **ok** (`allowancesShared: true` em `/api/health`) | e falha **fechada** se o banco não responde |
| Identidade anônima não se zera trivialmente | **ok, com limite honesto** | limpar cookies dá nova cota de navegador, **não** de endereço (10) nem do total (300); documentado em `AI_BUDGET_REPORT.md` |
| Envio duplicado | **ok** | a trava de uma geração por vez devolve 429 sem gastar; importações duplicadas são reconhecidas pelo conteúdo |
| 429 claros | **ok** | mensagem diz o que acabou, quando renova (UTC) e como seguir (entrar, chave própria) |
| Dados legítimos preservados | **ok** | nenhuma migração nem alteração de dados nesta rodada |

## 3. Configuração exata

Variáveis de **produção hoje** (só os nomes; os valores são sensíveis e não foram lidos): `APP_URL`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GLOSS_COOKIE_SECRET`, `TOGETHER_API_KEY`, `GLOSS_CHAT_MODEL`, `GLOSS_REASONING_EFFORT`. **Todas as demais usam os padrões do código**, que são os números confirmados pelo dono:

| Variável | Padrão em vigor | Efeito |
| --- | --- | --- |
| `GLOSS_QUOTA_AI_ANON_PER_DAY` | 3 | perguntas por dia por navegador anônimo |
| `GLOSS_QUOTA_AI_ANON_IP_PER_DAY` | 10 | por endereço de rede, visitantes |
| `GLOSS_QUOTA_AI_ANON_GLOBAL_PER_DAY` | 300 | total de visitantes por dia |
| `GLOSS_QUOTA_AI_USER_PER_DAY` | 20 | por conta |
| `GLOSS_BUDGET_DAILY_USD` / `GLOSS_BUDGET_MONTHLY_USD` | **3 / 40** | orçamento de IA (só IA, Together); no limite, a IA compartilhada pausa para todos |
| `GLOSS_PRICE_IN_PER_M` / `GLOSS_PRICE_OUT_PER_M` | tabela interna: **0,15 / 0,60** US$ por milhão de tokens | só se a fatura da Together diferir |
| `GLOSS_HEALTH_DB_CACHE_SECONDS` (novo) | 900 | reaproveitamento da leitura saudável do banco |
| `GLOSS_DB_STORAGE_LIMIT_MB` (novo) | 1024 | 100% para os alertas de armazenamento (Neon Free: 1 GB) |
| `GLOSS_LEGAL_PUBLISHED` | desligado | páginas legais em 404 até a revisão |
| Modelo | `openai/gpt-oss-120b`, esforço de raciocínio `low` | |

Referência completa: `docs/ops/configuration.md`. **Mudar qualquer uma em produção é decisão do dono** (não alterei nenhuma).

## 4. Evidência de testes

Validação completa em `22eab72` (código idêntico ao da branch; os commits seguintes só mudam este documento), em **banco descartável** `gloss_fl` com `DATABASE_URL` explícito, removido ao fim. O banco de desenvolvimento `gloss` foi só contado: **538 documentos antes e depois**. Resultados lidos do código de saída e do resumo de cada etapa, não do fim do processo.

| Etapa | Resultado |
| --- | --- |
| Migrações do zero | ok |
| Typecheck (`tsc --noEmit`) | 0 erros |
| Lint (`eslint`) | 0 erros |
| Lista de pendências legais atual e idiomas iguais (`legal-open-items --check`) | ok |
| Auditoria de segurança (`pnpm audit --prod`) | sem vulnerabilidades conhecidas |
| **Suíte unitária completa, com PostgreSQL real** | **1033 de 1033** (61 arquivos), inclui cotas, orçamento, custo da IA, isolamento e os 8 testes novos |
| Build de produção com segredos-sentinela e varredura do que o navegador recebe | 6 valores falsos, 5 nomes e 6 formatos procurados em 264 arquivos: **nada encontrado** |
| Build de produção (com `APP_URL` definido) | ok; `<link rel="canonical">` confere: `/` e `/library` apontam para o endereço do `APP_URL` |
| **Integração** (servidor de produção + PostgreSQL, limitador de importação ligado) | **51 de 51** (5 arquivos: cotas e orçamento entre instâncias, contas, isolamento entre usuários, páginas legais) |
| `/api/health` no servidor de produção com banco real | `status: ok`, `database: ok`, `storage` 8,3 MB de 1024 (0,8%, nível `ok`), `warnings: []`, `allowancesShared: true` |
| Firefox, iPhone e Pixel no build de produção | 38 de 38; 4 de 4 |
| **Chromium no build de produção (E2E de pré-visualização de produção)** | 197 passam, **4 falham**: as mesmas 4 já documentadas (HSTS presente em produção, contraste durante o fade-in, dois avisos de pré-carregamento `_rsc` cancelado) |
| **WebKit no build de produção** | 33 passam, **5 falham**: as mesmas 5 já documentadas (cookie `Secure` em `http://localhost`; no site real em HTTPS o WebKit passa) |
| Chromium e Pixel no servidor de desenvolvimento (para o qual a suíte foi escrita) | **203 de 203** |
| Firefox, WebKit e iPhone no servidor de desenvolvimento | **78 de 78** |
| Testes visuais | **46 de 46** |
| Servidor verificado vivo após cada etapa | sim, nenhuma parada |

Cobertura dos itens pedidos: **cotas do freemium** (`aiAdmission`, `ai-quota-routes`, `allowances.test.ts`, `ai-limits.spec.ts`), **isolamento entre usuários** (`accounts.test.ts`, `ownership.test.ts`), **controle de custo da IA** (`aiBudget`, `aiAdmission`, `ai-reliability`: inclui recusas 402 e 429 do provedor e o uso de tokens da resposta de margem), **alertas de armazenamento e reaproveitamento da saúde** (`health.test.ts`, `aiStoreDatabase.test.ts` com o tamanho real do banco).

**Não foi testado** (e por quê): o restauro no Neon e a entrega real de alertas (sem credencial e sem monitor), a conexão do app a um banco Neon (só a produção real, onde a verificação pós-publicação passou em `ea498f6`), o Google em produção e a medição de custo da resposta de margem depois da correção (precisa do deploy).

## 5. O que falta, com o dono

| # | Ação | Prazo / por quê |
| --- | --- | --- |
| 1 | **Autorizar o deploy desta branch** (mesclar o PR). Antes disso o orçamento **não conta** as respostas de margem | antes de abrir o beta |
| 2 | **Limite de gasto no painel da Together** (você mesmo; sugestão: igual ou pouco acima de US$ 40 por mês) | antes de abrir o beta: é o freio real |
| 3 | **Vercel: o período de teste do Pro termina em 2026-11-01 (cerca de 21:38 UTC)**; confirmar o pagamento e **configurar Spend Management** (valor, notificações 50/75/100% e decidir sobre "Pause Production Deployments", que tira o site do ar para todos quando o valor é atingido). Não consegui ler o estado atual (CLI 59.5.0) | até 2026-11-01 |
| 4 | **Criar o monitor externo de 5 minutos** (UptimeRobot, Better Stack ou outro, planos gratuitos) com os dois monitores de `docs/ops/monitoring-and-alerts.md`, **testar e preencher a tabela de prova**. **O monitoramento NÃO está ativo** | antes do público; recomendado antes do beta |
| 5 | **Neon**: olhar semanalmente horas de computação (70 e 85 de 100 CU-h) e transferência; fazer `scripts/db-backup.sh` toda semana; confirmar a **região** do banco (campo legal) | rotina |
| 6 | **Ensaio de restauração no Neon** (branch de um instante passado, 15 minutos): `docs/ops/restore-rehearsal.md` | antes do público |
| 7 | **Textos legais**: preencher 22 decisões e submeter a revisão jurídica (17 itens); remover marcadores; só então ligar `GLOSS_LEGAL_PUBLISHED=1` | bloqueia o público |
| 8 | **Google**: tela de consentimento em "In production" com as URLs de privacidade e termos | bloqueia o público |
| 9 | **Domínio**: escolher e comprar; depois seguir `docs/ops/domain-migration.md` | quando decidir |
| 10 | Excluir os dois projetos duplicados da Vercel (`understand-io-6ugt`, `understand-io-z8gn`) | opcional, recomendado |
| 11 | Confirmar o e-mail de falha do `Health` (execução de 2026-10-27) e as notificações do GitHub | prova de entrega |
| 12 | Confirmar as configurações de dados da conta Together (uso para treinamento, retenção) e referenciar os termos no aviso de IA | item de revisão jurídica |

## 6. Exposição de custo

Preços e premissas em `docs/release/AI_BUDGET_REPORT.md`. Custo por pergunta **medido em produção** (modelo `openai/gpt-oss-120b`, texto de 10 parágrafos): resumo rápido **US$ 0,00096**, notas de estudo **US$ 0,00124**; margem **não medida** (era o defeito), estimada em US$ 0,0008. Referência usada: **US$ 0,0011 por pergunta**.

| Usuários ativos | Perguntas por usuário por mês | IA | Neon | Vercel | **Total por mês** |
| --- | --- | --- | --- | --- | --- |
| 100 | 40 | US$ 4,4 | **US$ 0** (Free) | US$ 20 | **≈ US$ 24** |
| 1.000 | 10 | US$ 11 | ≈ US$ 18 (Launch) | ≈ US$ 25 | **≈ US$ 54** |
| 1.000 | 40 | US$ 44, **limitado a US$ 40** pelo orçamento | ≈ US$ 18 (Launch) | ≈ US$ 25 | **≈ US$ 83** |
| 10.000 | 10 | US$ 110, **limitado a US$ 40** | ≈ US$ 77 (Launch) | ≈ US$ 60 | **≈ US$ 177** (sem o limite: US$ 247) |

Neon e Vercel acima de 100 usuários são **estimativas minhas**, não medições. **Exposição máxima:**

* **IA (Together):** no máximo **US$ 3 por dia e US$ 40 por mês** no livro-razão (estimativa), e visitantes no máximo **US$ 0,33 por dia** (300 perguntas) — **depois do deploy da correção da margem**. O freio real é o limite na conta da Together (ação 2).
* **Neon Free:** **US$ 0 e sem risco de cobrança**; o risco é o contrário: ao esgotar 100 CU-h o banco é suspenso até o próximo ciclo (site sem dados) ou, com 1 GB cheio, as gravações falham. Alertas em 70 e 85% do armazenamento (automáticos) e das horas (semanal, manual).
* **Vercel Pro:** US$ 20 por assento por mês depois do teste, mais uso excedente; **sem Spend Management configurado não há teto** (ação 3).

## 7. Riscos de infraestrutura

| Risco | Efeito | Mitigação existente | Falta |
| --- | --- | --- | --- |
| Horas de computação do Neon Free acabam (100 CU-h) | banco suspenso, site sem dados | `/api/health` reaproveita a leitura por 15 min para o monitor não manter o banco acordado; falha fechada da IA | acompanhar no console; subir para Launch ao passar de 70 CU-h |
| Armazenamento chega a 1 GB | gravações falham | alertas em 70 e 85% no `/api/health` | monitor externo ativo |
| Só 6 h de histórico no Neon Free | erro de ontem não se desfaz pelo Neon | `scripts/db-backup.sh`, backup manual no app | rotina semanal do dono |
| Partida a frio do Neon | primeira requisição lenta | uma repetição antes de declarar queda | nenhuma |
| Fim do teste da Vercel (2026-11-01) | cobrança | | confirmar pagamento e Spend Management |
| Sem teto de gasto na Vercel | conta inesperada | uso baixo do app | Spend Management |
| Pausa do Spend Management | site fora do ar para todos | | decisão do dono |
| Monitor do GitHub dispara só a cada ~6 h | queda demora a ser notada | | monitor externo |
| Logs da Vercel guardam ~1 h | erros antigos sem detalhe | o `ai_ledger` guarda custo e erros por hora | decisão sobre drain (recomendo adiar) |
| Dependência do provedor de IA | IA indisponível | falha com mensagem clara (502, sem texto do provedor), chave própria do leitor continua | monitoramento |
| Um único dono na Vercel e no GitHub | ponto único de falha | | convidar uma segunda pessoa com o menor papel necessário |
| Orçamento não contava a margem (corrigido) | gasto acima do previsto até o deploy | correção + estimativa de reserva | **fazer o deploy** |
| Estado do Google e do Neon (região, plano) não observáveis daqui | | | dono confirma |

## 8. Bloqueios legais

Fatos confirmados e já nos textos: operador Menlo Software AIP (**somente o nome**), contato jm@useclave.io, modelo gratuito com uso limitado, hospedagem Vercel (região `iad1`), banco Neon Free (histórico de 6 h), IA Together AI, login Google. **Nada foi inventado** (CNPJ, endereço, forma jurídica, prazos de retenção, garantias).

Pendências, geradas dos marcadores (`docs/legal/OPEN_ITEMS.md`): **22 decisões do dono** (data de publicação em cada texto; endereço e registro; idade mínima; prazo de resposta a solicitações; como avisar mudanças e o fim do serviço; se haverá planos pagos; região do banco; prazo de retenção de logs e de arquivos de backup; entre outras) e **17 itens de revisão jurídica** (bases legais, transferência internacional, direitos dos titulares e autoridade, crianças, banner de cookies, limites de responsabilidade, lei aplicável e foro, licença dos textos de exemplo, termos da Together, encarregado de dados). **Nenhum texto é exibido**: as páginas respondem 404 e não há links até `GLOSS_LEGAL_PUBLISHED=1` **e** nenhum marcador restante nos dois idiomas (verificado por testes).

## 9. Migração de domínio

Preparado, **não executado** (`APP_URL` de produção intacto; o endereço antigo da Vercel continua como alias de transição). O código já deriva o endereço canônico do `APP_URL`. Passo a passo e checklist de nove itens em `docs/ops/domain-migration.md`; verificadores somente leitura: `node scripts/domain-check.mjs <domínio>` (DNS, certificado, http para https, HSTS, saúde, canônico, endereço antigo) e `node scripts/post-deploy-check.mjs https://<domínio>` (cookies, cabeçalhos, retorno do Google). Cobre: Vercel (domínio), DNS, HTTPS, Google OAuth (URI de retorno novo antes de trocar o `APP_URL`), URLs canônicas, cookies (não migram entre endereços: quem não entrou perde de vista a biblioteca), redirecionamentos (antigo para novo, depois da troca), variáveis de ambiente.

## 10. Prontidão para o lançamento público

| Portão | Estado |
| --- | --- |
| Freemium, cotas e orçamento no servidor | **PASS** (depois do deploy da correção da margem) |
| Proteções de custo | **PASS** no código; **PENDENTE** limite da Together (dono) |
| Neon Free: alertas de armazenamento | **PASS** (no código, ativo ao ser publicado); horas de computação: **manual** |
| Recuperação | **PASS** local (dump, restauração, recuperação pontual); **PENDENTE** ensaio no Neon (dono) |
| Vercel: equipe e variáveis corretas | **PASS**; Spend Management **PENDENTE** (dono, antes de 2026-11-01) |
| Monitoramento externo | **NÃO ATIVO**: pendente (dono) |
| Textos legais | **BLOQUEADO**: decisões do dono e revisão jurídica |
| Google (tela de consentimento) | **NÃO VERIFICADO** (dono) |
| Domínio | preparado; aguarda escolha |

* **Beta controlado: GO**, com as condições 1 e 2 da seção 5 (deploy desta branch e limite da Together) e, recomendado, a 4 (monitor).
* **Lançamento público: NO-GO** até as ações 3, 4, 6, 7 e 8.
