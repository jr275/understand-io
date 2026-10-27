# Prontidão de lançamento

Release em produção: `b89c6fc` (PR [#7](https://github.com/jr275/understand-io/pull/7)), em `https://understand-io.vercel.app`. Branch desta fase: `feature/legal-pages` (páginas legais, verificação pós-publicação, documentação). **Nada desta fase foi mesclado nem publicado.** Não alterei segredos, configurações financeiras, credenciais, sessões, DNS, `APP_URL`, o projeto `plataforma`, nem excluí projetos ou bancos.

Legenda: **PASS** = provado com evidência; **FAIL** = não atende; **BLOCKED** = só você consegue ler ou decidir (não observável daqui).

## Veredito

| Decisão | Resultado | Condição |
| --- | --- | --- |
| **Beta controlado (convidados, poucos usuários)** | **GO** | Condições B1 e B2 abaixo; B3 (monitor externo) é recomendado, não bloqueia. |
| **Lançamento público** | **NO-GO** | Textos legais finais e publicados (G9), tela de consentimento do Google em produção (G8), alerta em minutos (G7), planos e backups confirmados (G10/G11), preços reais da Together conferidos (G4).

## Gates

| # | Gate | Estado | Evidência | Pendência, dono |
| --- | --- | --- | --- | --- |
| G1 | Produção na release aprovada | **PASS** | `main` = `b89c6fc`; deploy Ready; `/api/health` com `commit` igual, `status: ok`, `database: ok`, `allowancesShared: true`; migração `0006` aplicada | — |
| G2 | Verificação pós-publicação reproduzível | **PASS** | `node scripts/post-deploy-check.mjs [url]` (28 verificações contra produção, todas passaram; não grava nada e gasta no máximo 1 pergunta de IA) | — |
| G3 | Cotas, trava de concorrência e orçamento no código | **PASS** | 1009 testes unitários com PostgreSQL real; integração com 2 a 5 servidores reais no mesmo banco (`allowances.test.ts`); detalhes em `docs/release/BETA_LAUNCH_REPORT.md` | — |
| G4 | Orçamento real e gasto observável | **PASS** (valores) / **BLOCKED** (gasto real) | **Orçamento confirmado pelo dono em 2026-10-27: US$ 3 por dia e US$ 40 por mês, só para IA (Together).** São os valores já em vigor (padrões de `GLOSS_BUDGET_*`; a variável não está definida em produção, então não alterei nada). O gasto fica no `ai_ledger` do Neon; não tenho credencial do banco aqui e os logs de runtime da Vercel guardam cerca de 1 hora, então não consigo informar o gasto real das últimas 24 h. `/api/health` não mostra valores em dinheiro, de propósito | Você: conferir o consumo na conta da Together; opcionalmente informar `GLOSS_PRICE_IN_PER_M`/`GLOSS_PRICE_OUT_PER_M` com os preços da sua fatura (hoje o app usa a tabela interna, US$ 0,15 e US$ 0,60) |
| G5 | Freio final: limite de gasto na Together | **BLOCKED** | Você configura no painel; não verificável daqui. **Quando a Together recusa por limite** (402 ou 429) na chave compartilhada, o app devolve **502 com mensagem fixa** ("The shared AI service could not answer right now. Try again later, or add your own Together key…"), sem 500 e sem texto do provedor, tanto em `/api/ai` quanto na resposta de margem em streaming; a cota do leitor é devolvida. Coberto por teste (`ai-reliability.test.ts`, 402 e 429) | Você, no painel da Together |
| G6 | Logs | **PASS** (com ressalva) | Teste automático: nenhum texto do leitor, chave, segredo, cookie ou senha do banco nos logs de 5 servidores reais. Ressalva: retenção curta na Vercel (~1 h observada) | Você: decidir se quer um drain de logs (custo à parte) |
| G7 | Alertas | **BLOCKED** (parcial) | O monitor `Health` roda **agendado**: execuções agendadas em `main` às 09:37Z e 15:33Z de 2026-10-27, ambas com sucesso. O GitHub não cumpre a cadência de 30 min (intervalo observado de 6 h; agendamentos são adiados em horários de pico), então a detecção real é de horas, não de minutos. Uma falha **provocada de propósito** (execução 40449462055) falhou como esperado; **não consigo confirmar a chegada do e-mail**: o conector do Gmail está desconectado | Você: ver se chegou "Run failed: Health" (~04:25Z) e conferir as notificações do GitHub (Watch, Custom, Actions). Para detecção em minutos é preciso um monitor externo (ex.: UptimeRobot, plano gratuito de 5 min): decisão sua, sem custo de código |
| G8 | Google OAuth | **BLOCKED** | O estado da tela de consentimento não é observável de fora. Login funciona em produção (confirmado por você). Não toquei em credenciais nem sessões | Você: Google Cloud → Auth Platform → Audience: **Publishing status = In production**, e preencher Application home page, **Privacy policy URL** e **Terms URL** (as páginas `/privacy` e `/terms` já existem no código, ver G9). Teste: entrar com uma conta que não está na lista de teste; "Access blocked / has not completed verification" significa Testing. Escopos básicos (openid, e-mail, perfil) normalmente não exigem verificação do app; confirme no console |
| G9 | Termos e Privacidade | **Código PASS, publicação FAIL** | Páginas `/privacy`, `/terms`, `/legal/*` e links "Privacy · Terms" na entrada e na biblioteca, **desligados**: só aparecem com `GLOSS_LEGAL_PUBLISHED=1` **e** sem nenhum marcador ⚠️ nos textos (em/pt-BR). Caso contrário respondem 404 e nenhum link é desenhado. Testes unitários e de integração. A lista completa dos campos está em `docs/legal/OPEN_ITEMS.md` (29 decisões suas, 16 itens de revisão jurídica) | Você: preencher os campos; advogado: revisar; depois remover os marcadores, mesclar e ligar a variável |
| G10 | Planos e custos de infraestrutura | **BLOCKED** (parcial) | Vercel: equipe `menlo6` no Pro em **período de teste** (cobrança futura US$ 20 por assento). Neon: plano, região e janela de restauração não são legíveis daqui. Preços públicos em "Custos" abaixo | Você: confirmar o plano do Neon (o Free guarda só 6 h de histórico; o Launch até 7 dias) e a cobrança da Vercel após o teste |
| G11 | Backups e recuperação | **PASS** (documento) / **BLOCKED** (janela) | `docs/ops/rollback-and-recovery.md`: promover o deploy anterior; migrações só acrescentam, nunca se revertem; restauração do Neon por ponto no tempo. A janela real depende do plano (G10) | Você: confirmar plano; recomendo ensaiar uma restauração em um branch do Neon antes do público |
| G12 | Projetos duplicados da Vercel | **PASS** (auditoria) | `understand-io-z8gn` e `understand-io-6ugt`: sem variáveis, públicos, sem banco, constroem a cada push; nenhuma dependência encontrada em código, workflows e variáveis (o redirect do Google não foi inspecionado no console) | Você decide excluir; **não excluí nada** |
| G13 | Falha local do WebKit sem explicação | **Documentada** | `docs/quality/webkit-unexplained-stop.md`: um servidor local de produção parou de responder durante uma rodada; não se repetiu nas rodadas seguintes (liveness checado a cada etapa); sem sinal em produção | — |
| G14 | Regressão completa da branch (`230282c`) | **PASS** (com 6 diferenças conhecidas) | ver "Regressão" abaixo | — |
| G15 | Produção conecta ao banco com a credencial atual | **PASS** (com ressalva) | Em 2026-10-27 21:54Z, `GET /api/health?strict=1` em produção: HTTP 200, `status: ok`, `database: ok`, `ai.budget: ok`, `allowancesShared: true` (o orçamento lê o `ai_ledger`, então é leitura real de tabela), commit `b89c6fc`. `DATABASE_URL` existe só em Production (valor oculto; nunca exibido). A senha antiga foi revogada na rotação, então uma conexão que funciona não pode estar usando a antiga. Ressalva: a coluna "created" da Vercel mostra 9 dias para a variável, e não consigo comparar o valor com a senha nova sem expô-la | Você (opcional): no Neon, conferir a data do último reset de senha do papel usado |

## Antes de abrir para convidados (beta)

* **B1.** Defina o limite de gasto mensal na conta da Together (você mesmo; sugestão: igual ou pouco acima de US$ 40).
* **B2.** ~~Confirmar orçamento~~ **Feito:** US$ 3/dia e US$ 40/mês, só IA. Nada a alterar em produção.
* **B3 (recomendado).** Monitor externo de 5 minutos (próxima seção) e confirmar que o e-mail "Run failed: Health" chegou. Sem isso, uma queda pode levar horas para ser notada.

## Monitor externo: proposta (não implementada)

O cron do GitHub Actions roda na prática a cada ~6 h. Para alerta, o ideal é um serviço externo que chame `GET https://understand-io.vercel.app/api/health?strict=1` (responde **503** quando algo está degradado, **200** quando ok; não expõe segredo nem valores em dinheiro).

| Opção | Intervalo (plano gratuito) | Custo | Observação |
| --- | --- | --- | --- |
| **UptimeRobot** | 5 min, 50 monitores | US$ 0 | A fonte aponta restrição de uso comercial no plano gratuito; confira os termos |
| **Better Stack** | 3 min, 10 monitores (fontes divergem entre 3 e 5) | US$ 0 | Alertas por e-mail e, no gratuito, telefone/SMS limitados; confira na página de preços |
| Vercel Cron | até 1 min no Pro | já incluso | **Não serve:** roda dentro do mesmo projeto, então não avisa se o projeto cair, e não envia alerta por si só |

Fontes (comparativos de terceiros, confirme no site de cada serviço): [Hyperping](https://hyperping.com/blog/uptimerobot-vs-betterstack), [Host-Tracker](https://www.host-tracker.com/blog/uptimerobot-alternative), [Better Stack](https://betterstack.com/community/comparisons/uptime-robot-alternatives).

**O que você precisa configurar** (cerca de 10 minutos, sem mudar o app): criar a conta; um monitor HTTP em `https://understand-io.vercel.app/api/health?strict=1` com intervalo mínimo e "alertar se status ≠ 200"; um contato de alerta (e-mail e, se quiser, celular); testar pausando/retomando ou apontando temporariamente para uma URL que dê 503. Recomendo manter o `Health` do GitHub como segunda camada. **Recomendação: Better Stack ou UptimeRobot, gratuito, 3 a 5 minutos.**

## Riscos

| Risco | Efeito | Mitigação existente |
| --- | --- | --- |
| Uso de IA acima do previsto | Gasto | Cota por navegador/IP/conta, orçamento diário e mensal que **para a IA compartilhada**, falha fechada. O freio final é o limite na Together (G5) |
| Detecção lenta de queda (G7) | Horas até saber | Monitor agendado; recomendado monitor externo |
| Publicar sem textos legais finais | Risco legal e de verificação do Google | Páginas só aparecem com textos finais; produção não os exibe hoje |
| Tela do Google em "Testing" | Usuários fora da lista não entram | G8 |
| Backup curto se o Neon estiver no Free (G10) | Perda de dados recentes | Confirmar plano |
| Geração é uma requisição só | Aba fechada perde a geração | Aceito no beta |
| Janelas de cota são dias UTC | Até o dobro na virada do dia | Aceito; orçamento global limita |

## Custos estimados de operação (por mês, em dólares)

**O orçamento de US$ 40/mês é só da IA.** O total abaixo soma IA + Neon + Vercel (domínio e GitHub Actions desprezíveis). Resumo do caso típico (40 ações por usuário por mês): **100 usuários ≈ US$ 30; 1.000 ≈ US$ 98; 10.000 ≈ US$ 693.** Em 100 usuários o orçamento de IA sobra; em 1.000 usuários típicos ele **faltaria** (≈ US$ 56 só de IA contra US$ 40): a IA compartilhada pararia no fim do mês, e o leitor com chave própria continuaria.

**São estimativas de modelo, não medições de produção.** Premissas:

* IA: `openai/gpt-oss-120b` na Together a **US$ 0,15 por milhão de tokens de entrada e US$ 0,60 de saída** ([computeprices.com](https://computeprices.com/providers/together-ai/models/gpt-oss-120b), [CloudZero](https://www.cloudzero.com/together-ai-pricing/); agregadores, **confirme na sua fatura**). Pergunta de margem 1.500 entrada + 500 saída = US$ 0,00052; resumo 6.000 + 2.000 = US$ 0,0021; notas de estudo de texto longo 30.000 + 9.000 = US$ 0,0099. Mistura 70 % / 25 % / 5 % = **US$ 0,00139 por ação** (tokens de raciocínio contam como saída). Perfis: leve 10, típico 40, intenso 150 ações por usuário ativo por mês (a cota de 20 por dia limita uma conta a ~US$ 0,83 por mês nessa mistura).
* Neon (Launch, [preços](https://neon.com/pricing): US$ 0,106 por CU-hora, US$ 0,35 por GB-mês, restauração instantânea US$ 0,20 por GB-mês): 40 / 150 / 600 CU-horas e 0,5 / 3 / 25 GB para 100 / 1.000 / 10.000 usuários (suposições minhas).
* Vercel (Pro, [preços](https://vercel.com/pricing): US$ 20 por assento com US$ 20 de crédito; CPU ativa US$ 0,128 por hora, memória US$ 0,0106 por GB-h, invocações US$ 0,60 por milhão): base US$ 20 mais excedente estimado de 0 / 5 / 40 (suposição; o consumo real está em Usage no painel).
* Domínio (US$ 10 a 20 por ano), GitHub Actions (plano gratuito, cabem os minutos do monitor): desprezíveis.

| Usuários ativos | Perfil | IA | Neon | Vercel | **Total** | Por usuário |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | leve | 1,39 | 4,52 | 20 | **≈ 26** | 0,26 |
| 100 | típico | 5,56 | 4,52 | 20 | **≈ 30** | 0,30 |
| 100 | intenso | 20,85 | 4,52 | 20 | **≈ 45** | 0,45 |
| 1.000 | leve | 13,90 | 17,55 | 25 | **≈ 56** | 0,056 |
| 1.000 | típico | 55,60 | 17,55 | 25 | **≈ 98** | 0,098 |
| 1.000 | intenso | 208,50 | 17,55 | 25 | **≈ 251** | 0,25 |
| 10.000 | leve | 139 | 77,35 | 60 | **≈ 276** | 0,028 |
| 10.000 | típico | 556 | 77,35 | 60 | **≈ 693** | 0,069 |
| 10.000 | intenso | 2.085 | 77,35 | 60 | **≈ 2.222** | 0,22 |

Leitura: a IA domina a partir de 1.000 usuários. Os limites atuais (US$ 40/mês de orçamento global) **não sustentam 1.000 usuários típicos** (≈ US$ 56 só de IA): o orçamento teria de ser elevado deliberadamente, o que depende de preço e margem validados por você. Limites e orçamento permanecem provisórios.

## Plano de reversão

1. **Código:** no painel da Vercel, promover o deploy de produção anterior (`c71c046`), ou `vercel rollback` pela CLI. Não reescrever o histórico do `main`.
2. **Banco:** as migrações só acrescentam (`0005`, `0006` criam tabelas e índice); **nunca se revertem**. O código antigo ignora as tabelas novas. Dados perdidos: restauração por ponto no tempo do Neon em um branch, conferir e só então apontar.
3. **IA fora de controle:** `GLOSS_BUDGET_DAILY_USD=0` (pede sua autorização, é configuração financeira) para a IA compartilhada; a chave própria do leitor continua.
4. **Páginas legais:** desligar `GLOSS_LEGAL_PUBLISHED`.
5. Passo a passo e comandos: `docs/ops/rollback-and-recovery.md`, `docs/ops/runbook.md`.

## Regressão da branch `feature/legal-pages` (commit `230282c`, código idêntico ao último commit de código)

Banco descartável `gloss_beta` (o banco de desenvolvimento `gloss` ficou com 538 documentos antes e depois). Servidor verificado vivo após cada etapa.

| Etapa | Resultado |
| --- | --- |
| Migrações do zero; build de produção | ok; ok |
| Integração (servidor de produção + PostgreSQL) | **51 de 51** (5 arquivos, inclui `legal.test.ts`) |
| Firefox, iPhone e Pixel no build de produção | 38 de 38; 4 de 4 |
| Chromium no build de produção | 197 passam, 4 falham: HSTS presente em produção (a suíte espera ausente), contraste durante o fade-in, e **duas** reclamações de pré-carregamentos `_rsc` interrompidos (landing e biblioteca; mesma causa, dependente de tempo; as URLs são da entrada, da biblioteca e dos textos de exemplo, nenhuma é de página legal) |
| WebKit no build de produção | 33 passam, 5 falham (cookie `Secure` em `http://localhost`; no site real passa) |
| Chromium e Pixel no servidor de desenvolvimento | 201 passam, **2 falharam** (arrastar seleção dentro de um destaque; captura por bookmarklet), **nenhuma relacionada às páginas legais**; reexecutadas isoladas **3 vezes cada, 6 de 6 passaram**: instabilidade sob carga numa rodada de 17 min, não defeito reproduzido |
| Firefox, WebKit e iPhone no servidor de desenvolvimento | **78 de 78** |
| Visuais | **46 de 46** (imagens-base inalteradas: as páginas legais ocultas não mudam as telas) |

Os testes unitários desta fase (`tests/unit/legal.test.ts`) rodaram localmente quando foram escritos; **não repeti a suíte unitária inteira nesta rodada final**, e a CI do GitHub **ainda não rodou nesta branch** (ela não foi enviada ao GitHub: aguardo sua autorização para `push` e PR).

## Arquivos desta fase

`docs/legal/OPEN_ITEMS.md`, `docs/legal/README.md`, `docs/quality/webkit-unexplained-stop.md`, `scripts/post-deploy-check.mjs`, `.github/workflows/health.yml` (cadência de 30 min, `workflow_dispatch` com URL), `docs/ops/monitoring-and-alerts.md`, e o código das páginas legais (`src/lib/legal/`, `src/components/legal/`, `src/app/{privacy,terms,legal}`).
