# Prontidão de lançamento

Release em produção: `b89c6fc` (PR [#7](https://github.com/jr275/understand-io/pull/7)), em `https://understand-io.vercel.app`. Branch desta fase: `feature/legal-pages` (páginas legais, verificação pós-publicação, documentação). **Nada desta fase foi mesclado nem publicado.** Não alterei segredos, configurações financeiras, credenciais, sessões, DNS, `APP_URL`, o projeto `plataforma`, nem excluí projetos ou bancos.

Legenda: **PASS** = provado com evidência; **FAIL** = não atende; **BLOCKED** = só você consegue ler ou decidir (não observável daqui).

## Veredito

| Decisão | Resultado | Condição |
| --- | --- | --- |
| **Beta controlado (convidados, poucos usuários)** | **GO** | Itens B1 a B3 abaixo, que levam minutos: limite de gasto na Together, orçamento confirmado, e-mail de alerta recebido. |
| **Lançamento público** | **NO-GO** | Textos legais finais e publicados (G9), tela de consentimento do Google em produção (G8), orçamento calibrado com preços reais (G4/G5), entrega do alerta confirmada (G7), planos e backups confirmados (G10/G11). |

## Gates

| # | Gate | Estado | Evidência | Pendência, dono |
| --- | --- | --- | --- | --- |
| G1 | Produção na release aprovada | **PASS** | `main` = `b89c6fc`; deploy Ready; `/api/health` com `commit` igual, `status: ok`, `database: ok`, `allowancesShared: true`; migração `0006` aplicada | — |
| G2 | Verificação pós-publicação reproduzível | **PASS** | `node scripts/post-deploy-check.mjs [url]` (28 verificações contra produção, todas passaram; não grava nada e gasta no máximo 1 pergunta de IA) | — |
| G3 | Cotas, trava de concorrência e orçamento no código | **PASS** | 1009 testes unitários com PostgreSQL real; integração com 2 a 5 servidores reais no mesmo banco (`allowances.test.ts`); detalhes em `docs/release/BETA_LAUNCH_REPORT.md` | — |
| G4 | Orçamento real e gasto observável | **BLOCKED** | Padrões **provisórios**: US$ 3/dia e US$ 40/mês (`GLOSS_BUDGET_*`). O gasto fica no `ai_ledger` do Neon; não tenho credencial do banco aqui e os logs de runtime da Vercel guardam cerca de 1 hora, então não consigo informar o gasto real das últimas 24 h. `/api/health` não mostra valores em dinheiro, de propósito | Você: conferir o consumo na conta da Together e, se quiser, ler o `ai_ledger`; confirmar ou ajustar `GLOSS_BUDGET_*` e informar `GLOSS_PRICE_IN_PER_M`/`GLOSS_PRICE_OUT_PER_M` (não alterei nada) |
| G5 | Freio final: limite de gasto na Together | **BLOCKED** | Não verificado | Você, no painel da Together |
| G6 | Logs | **PASS** (com ressalva) | Teste automático: nenhum texto do leitor, chave, segredo, cookie ou senha do banco nos logs de 5 servidores reais. Ressalva: retenção curta na Vercel (~1 h observada) | Você: decidir se quer um drain de logs (custo à parte) |
| G7 | Alertas | **BLOCKED** (parcial) | O monitor `Health` roda **agendado**: execuções agendadas em `main` às 09:37Z e 15:33Z de 2026-10-27, ambas com sucesso. O GitHub não cumpre a cadência de 30 min (intervalo observado de 6 h; agendamentos são adiados em horários de pico), então a detecção real é de horas, não de minutos. Uma falha **provocada de propósito** (execução 40449462055) falhou como esperado; **não consigo confirmar a chegada do e-mail**: o conector do Gmail está desconectado | Você: ver se chegou "Run failed: Health" (~04:25Z) e conferir as notificações do GitHub (Watch, Custom, Actions). Para detecção em minutos é preciso um monitor externo (ex.: UptimeRobot, plano gratuito de 5 min): decisão sua, sem custo de código |
| G8 | Google OAuth | **BLOCKED** | O estado da tela de consentimento não é observável de fora. Login funciona em produção (confirmado por você). Não toquei em credenciais nem sessões | Você: Google Cloud → Auth Platform → Audience: **Publishing status = In production**, e preencher Application home page, **Privacy policy URL** e **Terms URL** (as páginas `/privacy` e `/terms` já existem no código, ver G9). Teste: entrar com uma conta que não está na lista de teste; "Access blocked / has not completed verification" significa Testing. Escopos básicos (openid, e-mail, perfil) normalmente não exigem verificação do app; confirme no console |
| G9 | Termos e Privacidade | **Código PASS, publicação FAIL** | Páginas `/privacy`, `/terms`, `/legal/*` e links "Privacy · Terms" na entrada e na biblioteca, **desligados**: só aparecem com `GLOSS_LEGAL_PUBLISHED=1` **e** sem nenhum marcador ⚠️ nos textos (em/pt-BR). Caso contrário respondem 404 e nenhum link é desenhado. Testes unitários e de integração. A lista completa dos campos está em `docs/legal/OPEN_ITEMS.md` (29 decisões suas, 16 itens de revisão jurídica) | Você: preencher os campos; advogado: revisar; depois remover os marcadores, mesclar e ligar a variável |
| G10 | Planos e custos de infraestrutura | **BLOCKED** (parcial) | Vercel: equipe `menlo6` no Pro em **período de teste** (cobrança futura US$ 20 por assento). Neon: plano, região e janela de restauração não são legíveis daqui. Preços públicos em "Custos" abaixo | Você: confirmar o plano do Neon (o Free guarda só 6 h de histórico; o Launch até 7 dias) e a cobrança da Vercel após o teste |
| G11 | Backups e recuperação | **PASS** (documento) / **BLOCKED** (janela) | `docs/ops/rollback-and-recovery.md`: promover o deploy anterior; migrações só acrescentam, nunca se revertem; restauração do Neon por ponto no tempo. A janela real depende do plano (G10) | Você: confirmar plano; recomendo ensaiar uma restauração em um branch do Neon antes do público |
| G12 | Projetos duplicados da Vercel | **PASS** (auditoria) | `understand-io-z8gn` e `understand-io-6ugt`: sem variáveis, públicos, sem banco, constroem a cada push; nenhuma dependência encontrada em código, workflows e variáveis (o redirect do Google não foi inspecionado no console) | Você decide excluir; **não excluí nada** |
| G13 | Falha local do WebKit sem explicação | **Documentada** | `docs/quality/webkit-unexplained-stop.md`: um servidor local de produção parou de responder durante uma rodada; não se repetiu nas rodadas seguintes (liveness checado a cada etapa); sem sinal em produção | — |
| G14 | Regressão completa da branch (`230282c`) | **PASS** (com 6 diferenças conhecidas) | ver "Regressão" abaixo | — |

## Antes de abrir para convidados (beta)

* **B1.** Defina o limite de gasto mensal na conta da Together (valor seu).
* **B2.** Confirme ou ajuste `GLOSS_BUDGET_DAILY_USD` / `GLOSS_BUDGET_MONTHLY_USD`. Com os padrões (US$ 40/mês) e o modelo abaixo, cabem cerca de **700 usuários "típicos"** por mês.
* **B3.** Confirme que o e-mail "Run failed: Health" chegou; se não, ajuste as notificações do GitHub.

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
