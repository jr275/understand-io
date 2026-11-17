# Understand.io / Keeple — Missão 01: triagem de lançamento

Data: 2026-11-16 (verificações de produção às 01:28Z de 17/11). Auditor: sessão Claude (somente leitura; nada foi mesclado, publicado ou alterado em produção). Estado de cada item: **VERIFIED**, **IMPLEMENTED_NOT_VERIFIED**, **BROKEN**, **MOCK**, **NOT_IMPLEMENTED**, **BLOCKED**, **NOT_RUN**.

> Nota: uma primeira passagem em 25/10 foi feita sobre um estado antigo (sem chave de IA, banco local defasado). Ela foi descartada. Tudo abaixo é do `origin/main` de hoje.

## 1. Identidade verificada

| Item | Valor | Evidência |
| --- | --- | --- |
| Repositório do app | `jr275/understand-io` (privado), checkout principal `~/gloss-reconstruction/gloss` | `git remote -v` |
| `~/understand-io-private` | **outro repositório** (`jr275/understand-io-private`): só planos de release/ops, sem código do app | `git remote -v`, `ls` |
| `origin/main` | `dd0a0f8` (PR #15, 2026-11-03). Branch desta auditoria: `audit/mission-01-launch-triage` (worktree `~/gloss-reconstruction/gloss-triage`) | `git log` |
| Checkout principal | está em `feat/keeple-brand-migration` (`697fd3e`), com 6 worktrees de outras sessões; **não foi tocado** | `git worktree list` |
| Vercel | projeto `understand-io`, equipe `menlo6`; produção Ready, aliases `understand-io.vercel.app`, `understand-io-menlo6`, e domínio `www.keeple.me` (200) | `vercel ls`, curl |
| Commit em produção | **`0536acf`**, branch `hotfix/keeple-brand`, deploy `dpl_4obqqegCZePkKPK1nH7skKwyh8HD` (05/11), conferido na API de deployments da Vercel em 16/11. **Não é `origin/main`.** (Correção: a primeira versão deste relatório inferiu `dd0a0f8` e errou.) `/api/health` devolve `commit: ""` | `vercel inspect`, `vercel api` |

## 2. Arquitetura (resumo)

- Next.js 16.4.2 (Turbopack), React 19, pnpm 12.10.1, Node 24 no CI (local: 26.13). `vercel.json` roda `node scripts/vercel-build.mjs`.
- Persistência: PostgreSQL (Neon) via Drizzle; sem `DATABASE_URL` roda em modo local (biblioteca só no navegador). Leitor anônimo por cookie assinado; login Google opcional.
- IA: Together AI (compatível com OpenAI) via AI SDK; modelo em produção `openai/gpt-oss-120b`; chave do servidor + chave própria do leitor (`x-gloss-key`). Cotas por navegador/IP/conta e orçamento no banco (`ai_ledger`): US$ 3/dia e US$ 40/mês.
- Rotas: `/`, `/library`, `/read/[slug]`, `/privacy`, `/terms` (desligadas); API: `import` (url/page/text/file), `documents`, `annotations`, `glosses`, `gloss` (margem, streaming), `ai` (resumo/conceitos/perguntas/tradução), `search`, `progress`, `reader`, `auth/*`, `health`, `speech/transcribe`.
- Extração: Readability + linkedom (HTML), unpdf (PDF; sem OCR), DOCX/EPUB; busca de URL com bloqueio de IP privado e fixação de DNS (`safeFetch.ts`).
- Variáveis de produção (só nomes): `DATABASE_URL`, `TOGETHER_API_KEY`, `GLOSS_CHAT_MODEL`, `GLOSS_REASONING_EFFORT`, `GLOSS_BUILD_MIGRATIONS`, `GLOSS_HEALTH_TOKEN`, `GLOSS_COOKIE_SECRET`, `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Ausente de propósito: `GLOSS_LEGAL_PUBLISHED`.
- CI: `.github/workflows/ci.yml` (checks, integration com PostgreSQL 16, audit) e monitor `Health`.

## 3. Matriz funcional

| Jornada | Estado | Base |
| --- | --- | --- |
| J1 Importar URL | **VERIFIED** (build antigo, local) / **IMPLEMENTED_NOT_VERIFIED** (build de hoje) | Em 25/10, build local: Wikipedia e paulgraham.com abriram com texto limpo; arXiv PDF por URL abriu (189 parágrafos); nytimes devolveu 422 com explicação e bookmarklet; host inexistente, `ftp:` e texto sem link recusados com mensagem. Hoje, em produção, só foram provados os bloqueios (metadata, localhost, esquema inválido: 400) |
| J2 Importar PDF | **VERIFIED** (parcial) | Hoje: PDF só de imagem recusado com motivo (422). Em 25/10: PDF de texto abriu; PDF corrompido recusado. Observação não confirmada: um PDF gerado por `cupsfilter` saiu com "a s" no lugar de "as" (pode ser do gerador) |
| J3 Colar texto | **VERIFIED** | Produção hoje: salvo, na estante, duplicata reconhecida, textos curtos não colapsam, outro visitante não vê nada |
| J4 Seleção e ação contextual | **IMPLEMENTED_NOT_VERIFIED** | Código e suíte E2E existem (`annotations`, `understand`, `mobile`); **a suíte de navegador não foi rodada nesta passagem** |
| J5 IA contextual | **VERIFIED** (resumo) / **IMPLEMENTED_NOT_VERIFIED** (margem em streaming) | `post-deploy-check --ai` em produção: `/api/ai` respondeu 200 com resumo real do modelo. A rota `/api/gloss` (pergunta sobre a seleção) não foi chamada hoje |
| J6 Evidência e citações | **VERIFIED** (resumo) / **IMPLEMENTED_NOT_VERIFIED** (margem) | Hoje: as 2 citações do resumo existem de fato no texto (verificação própria do app em `lib/ai/evidence.ts`). Na margem, os `¶N` vêm do modelo e são só exibidos; o cliente marca como "não verificada" a citação fora do que o modelo recebeu |
| J7 Biblioteca e persistência | **VERIFIED** (biblioteca/texto) / **NOT_RUN** (marcas e notas) | Cookie HttpOnly/Secure/Lax, persistência e isolamento provados hoje; marcas, notas e conversas só por testes unitários/integração do repositório |
| J8 Conteúdo de exemplo | **VERIFIED** (carrega) | `/read/on-a-piece-of-chalk` 200 hoje; os outros 2 exemplos e a experiência completa não foram abertos num navegador |
| J9 Mobile | **NOT_RUN** | Só há testes com tela emulada no repositório; nenhum celular real, nenhum Safari |

## 4. Defeitos e severidade

| ID | Sev. | Defeito | Reprodução | Evidência |
| --- | --- | --- | --- | --- |
| D1 | **P0** | **O build de produção falha hoje.** O advisory GHSA-mfr8-8qww-v76h (Next.js 16.3.0 a 16.4.4, moderado) faz `next build` terminar com `SecurityFatalError`. Produção segue servindo o deploy anterior, mas **qualquer novo deploy, redeploy ou promoção de código sai com erro** | `cd gloss-triage && pnpm install --frozen-lockfile && pnpm build` → exit 1 (compilação e TypeScript ok, falha na etapa final) | `build.log`; `pnpm audit --prod` → 1 moderada, corrigida em `next >=16.4.5` (16.4.6 existe) |
| D2 | **P1** | **Login Google quebrado em `www.keeple.me`.** O redirect volta para `understand-io.vercel.app` (estado/cookie em hosts diferentes). Problema já registrado em 04/11 e ainda ativo | `curl -sD- https://www.keeple.me/api/auth/google` → `redirect_uri=https://understand-io.vercel.app/...` | curl hoje; `APP_URL` em produção ainda é o domínio antigo |
| D3 | **P1** | A produção pública é `0536acf` (hotfix de marca e trava `GLOSS_BUILD_MIGRATIONS`, que **não estão em `main`**: um deploy a partir de `main` perderia os dois); o restante do trabalho Keeple (#12–#22) está **em PRs/branches não mesclados** e o checkout principal está em outra branch. O PR #22 contém o conteúdo do `0536acf` (`scripts/vercel-build.mjs` e `tests/unit/vercelBuild.test.ts` idênticos; marca Keeple no lugar do nome antigo). Qualquer lançamento "Keeple" exige uma sequência de merge que o D1 bloqueia | `git branch -a`, `release/KEEPLE_*` no repo privado | docs de 04/11 |
| D4 | **P1** | Proteção de custo é **parcial**: cotas e orçamento ficam no banco (bom), mas o freio final na Together (limite mensal na conta) é **BLOCKED**: só o dono confirma. Em 1.000 usuários típicos a IA compartilhada esgota o orçamento de US$ 40 no meio do mês (estimativa dos docs, não medição) | `docs/release/LAUNCH_READINESS.md` G4/G5 | — |
| D5 | **P1** | Textos legais **não publicados** (`/privacy`, `/terms` respondem 404 por desenho) e Google OAuth possivelmente em "Testing": impedem lançamento público, não o beta | `post-deploy-check` SKIP; G8/G9 | docs |
| D6 | P2 | `/api/health` devolve `commit: ""`, então não dá para provar qual build está no ar | curl | — |
| D7 | P2 | Alerta detecta em horas (cron do GitHub ~6 h); falta monitor externo | G7 | docs |
| D8 | P2 | Backup/restauração do Neon: janela de recuperação e ensaio no Neon real não confirmados | G10/G11 | docs |

## 5. Evidência dos gates (árvore de `origin/main`, `dd0a0f8`, **não** o código em produção; o bump do Next foi depois validado sobre o PR #22: 1428 testes passaram, build e audit verdes)

| Gate | Comando | Resultado |
| --- | --- | --- |
| Instalação reproduzível | `pnpm install --frozen-lockfile` | exit 0 (6 s) |
| Tipos | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Unitários | `pnpm test` | exit 0: 60 arquivos passaram, 2 ignorados; **1017 passaram, 23 ignorados** (os ignorados exigem PostgreSQL; sem `DATABASE_URL` neste worktree) |
| **Build** | `pnpm build` | **exit 1 (D1)** |
| Auditoria de dependências | `pnpm audit --prod` | **exit 1**: 1 vulnerabilidade moderada (next) |
| Verificação pós-deploy em produção | `node scripts/post-deploy-check.mjs https://understand-io.vercel.app --ai` | **30 passaram, 0 falharam, 2 ignoradas** (`/privacy`, `/terms` desligadas por desenho). Inclui 1 chamada real à IA (custo de fração de centavo); tudo que criou foi apagado (0 restantes) |
| Integração (PostgreSQL) | `pnpm test:integration` | **NOT_RUN** |
| E2E de navegador (desktop/mobile/visual) | `pnpm test:e2e` | **NOT_RUN** nesta passagem. Registro anterior do repositório: 230 de 231 numa rodada de 18/10, com `ANNOT-13` intermitente e conhecido (arrastar a seleção dentro de um destaque às vezes seleciona o destaque inteiro). Não confirmado hoje |
| Saúde | `GET /api/health` (ambos os domínios) | `ok`, banco ok, 9,3 de 1024 MB, `ai.configured: true`, `allowancesShared: true` |

## 6. Dependências de ambiente ausentes ou não verificáveis

- `GLOSS_LEGAL_PUBLISHED` e textos legais finais (decisão e revisão do dono).
- `APP_URL` e cliente Google para `www.keeple.me` (D2); tela de consentimento em produção (não observável).
- Limite de gasto na Together (D5/D4), monitor externo (D7), plano/janela do Neon (D8).
- `DATABASE_URL` para rodar as 23 provas que dependem de banco e a integração: precisa de **PostgreSQL descartável** (nunca o de produção).

## 7. Remediação P0/P1 exata

1. **D1 (P0):** subir `next` e `eslint-config-next` de `16.4.2` para `16.4.6` (mesmo minor), `pnpm install`, rodar `typecheck`, `lint`, `test`, `build` e `pnpm audit --prod`. Uma branch de uma linha de dependência; sem tocar em código.
2. **D3 (P1):** depois de D1, decidir a ordem de merge com o dono (o repositório privado já tem o plano em `release/KEEPLE_PROVEN_RELEASE_PLAN_2026-11-04.md`); só então mesclar. Não mesclar sem pedido do João.
3. **D2 (P1):** com aprovação do dono: `APP_URL=https://www.keeple.me`, adicionar `https://www.keeple.me/api/auth/google/callback` e a origem no cliente Google; redeploy; repetir o `curl` acima e testar um login real.
4. **D4/D5 (P1):** o dono define o limite na Together e decide sobre textos legais/consentimento Google antes de qualquer divulgação pública.
5. Expor o SHA no `/api/health` (D6) para provar o commit no ar (P2, barato).

## 8. Escopo mínimo seguro de release

Corrigir D1; mesclar apenas o necessário na ordem aprovada; **beta controlado por convite** com a chave compartilhada e os limites atuais; Google login só depois de D2; textos legais permanecem desligados e a divulgação pública espera D5.

## 9. Sequência de validação proposta

1. Branch de bump do Next → gates locais completos (inclui PostgreSQL descartável local para os 23 testes e `test:integration`).
2. Prévia na Vercel (preview, sem tocar produção) → `post-deploy-check` na prévia.
3. Rodar `pnpm test:e2e` (desktop + mobile) contra build de produção local; reconferir `ANNOT-13`.
4. Teste manual em celular real (J4, J9) e uma pergunta de margem real em `/api/gloss` (J5/J6).
5. Após aprovação de merge/deploy do João: `post-deploy-check --commit <sha> --ai` em produção e conferir `commit` no health.

## 10. Veredito

- **Lançamento público: NO-GO.** Build quebrado (D1), login quebrado no domínio novo (D2), textos legais e consentimento Google pendentes (D5), freio de gasto na Together não confirmado (D4).
- **Estado atual em produção (`0536acf`): beta controlado: CONDITIONAL GO.** Está saudável: 30 de 30 verificações, IA real respondendo, citações verificadas, banco ok, SSRF bloqueado. Condições: não depender de novo deploy até D1 ser corrigido; limite na Together.
- **Missão 02 pode começar?** **Sim, mas só com o escopo D1 primeiro** (bump de dependência, sem mudança de código nem de infraestrutura). Nada além disso antes de os gates ficarem verdes.

## Não verificado nesta passagem

Suíte de navegador e integração; celular real e Safari; `/api/gloss` (pergunta de margem) em produção; importação de URL e PDF de texto no build atual (provados só no build local de 25/10 e pelos bloqueios de hoje); abertura dos 3 exemplos num navegador; consentimento Google; planos e janela de restauração do Neon.
