# Relatório de lançamento: beta público controlado

Código a publicar: PR [#7](https://github.com/jr275/understand-io/pull/7), a partir da `main` em produção (`c71c046`). Commit de código testado: `d1b9d62`
(três commits: limites persistentes de IA `d01b6e8`, saúde e guias de operação `feca30d`, rascunhos legais `d1b9d62`). Commits posteriores a ele só
alteram documentação (este relatório). **Nada foi mesclado, publicado ou promovido; o DNS não foi tocado e o `APP_URL` de produção não foi alterado.**

## Veredito

**GO técnico** para publicar o PR #7 e operar o beta controlado, **com três condições suas** antes de abrir para usuários (itens 1 a 3 abaixo).
**NO-GO para divulgação ampla** enquanto a política de privacidade e os termos forem apenas rascunho (item 3).

## O que passou

| Verificação | Resultado |
| --- | --- |
| Tipos, lint | 0 erros |
| Testes unitários, com PostgreSQL real | **1009 passaram** (60 arquivos) |
| Testes de integração, com servidor de produção e PostgreSQL | **44 de 44** (inclui `allowances.test.ts`: 2 a 5 servidores reais, mesmo banco, provedor falso; `accounts.test.ts`; `ownership.test.ts`) |
| CI do GitHub no PR (`checks`, `integration`, `audit`) | verde em `d1b9d62` |
| Migrações: do zero, e `0005` para `0006` sobre um banco com dados (ensaio da subida de produção), e repetidas | ok; 8 para 11 tabelas, dados intactos, repetir não muda nada |
| Build de produção com segredos-sentinela e varredura do que o navegador recebe | 6 valores falsos procurados em 237 arquivos: **nenhum encontrado**; o controle plantado é detectado |
| Histórico do git (85 commits) | nenhuma credencial real; `.env.local` ignorado e nunca versionado |
| `pnpm audit --prod` | sem vulnerabilidades conhecidas |
| Navegadores no servidor de desenvolvimento (para o qual a suíte foi escrita) | Chromium desktop e Pixel: **203**; Firefox, WebKit e iPhone: **78**; visuais: **46** |
| Navegadores no build de produção | Firefox **38 de 38**; Pixel e iPhone **4 de 4**; Chromium 198 passam e 3 falham; WebKit 33 passam e 5 falham (ver "O que falhou") |
| **Site real em HTTPS, Chromium, Pixel, WebKit, iPhone e Firefox** | cookie `Secure`+`HttpOnly`+`SameSite=Lax` aceito; texto salvo e na estante após recarregar; destaque e sublinhado criados, mantidos após recarregar e removidos; sem rede o cartão diz o que houve; sem rolagem horizontal; **axe sem violação séria ou crítica em 5 temas, desktop e celular** |
| Importação por link em produção | artigo HTML (Wikipedia, 93 parágrafos), texto puro (740 mil caracteres), PDF do arXiv (189 parágrafos), página brasileira com acentos (planalto.gov.br), sem caracteres quebrados; sites que bloqueiam servidores viram cartão de link com o motivo; SSRF, localhost, esquema e URL inválida recusados |
| IA real em produção | teste de 8 verificações; notas de estudo do texto de 63 parágrafos em 4 de 4 tentativas; margem curta, normal e longa em cerca de 2 s |
| Isolamento | leitores e contas assinadas: um não lista, lê, edita nem apaga o que é do outro; sessão forjada ou de conta inexistente não é ninguém; sair limpa os dois cookies |
| Logs | nenhum texto enviado pelo leitor, chave, segredo, cookie ou senha do banco nos logs de 5 servidores reais (teste automático) |

### Os limites, provados contra servidores reais

| Regra | Prova |
| --- | --- |
| 3 perguntas por dia por navegador (visitante) | a 4ª recebe 429 em qualquer instância, **inclusive depois de reiniciar uma instância**; o provedor não é chamado |
| 10 por endereço de rede e 300 no total (proteção extra) | 12 navegadores novos no mesmo endereço: só 10 passam |
| 20 por dia por conta, em qualquer aparelho | a 21ª recebe 429; outra conta não é afetada |
| Uma geração por vez por usuário | 2ª requisição em **outra instância** recebe 429 `busy-user`; 6 ao mesmo tempo: 1 roda, 5 são barradas e **não gastam** a cota |
| Orçamento global diário e mensal | de 12 requisições simultâneas em 2 instâncias, **só as 3 que cabem** começam; com orçamento 0 a IA compartilhada para para todos |
| Falha fechada | com o banco fora do ar a chave do operador **não é gasta** (503), `/api/health` diz `down`; a chave própria do leitor continua |
| Falha do provedor ou pedido malformado | devolve a pergunta ao leitor |

## O que falhou, e por quê

* **3 testes do Chromium no build de produção**: a suíte foi escrita para o servidor de desenvolvimento. Um exige que o cabeçalho HSTS não exista (em produção ele deve existir); um conta como erro os pré-carregamentos de link (`?_rsc=`) interrompidos ao navegar; um mede contraste durante o fade-in de um texto (no site real, com a espera certa, o axe não acusa nada). No servidor de desenvolvimento todos passam.
* **5 testes do WebKit no build de produção**: o cookie do leitor é `Secure` e o WebKit não guarda cookie `Secure` de `http://localhost`. No site real, em HTTPS, o WebKit (desktop e iPhone) guarda o cookie e passa em tudo.
* Uma rodada anterior do servidor de produção local parou de responder durante a etapa do WebKit, sem erro no log; **não se repetiu** na rodada corrigida, que verificou o servidor após cada etapa. Fica registrado como não explicado.
* Dois erros do meu próprio script de teste (limite de importação desligado na integração; `pnpm` fora do PATH) foram corrigidos e a regressão repetida.

## O que foi corrigido nesta rodada

Cotas e orçamento persistentes (nada fixo no código, tudo por variável de ambiente), trava de concorrência, falha fechada, registro de custo por hora, `GET /api/health`, monitor agendado, varredura de segredos no CI, guias de operação, rascunhos legais. Nenhuma funcionalidade nova de leitura; o desenho foi preservado.

## O que ainda depende de você

1. **Orçamento**: confirme ou ajuste `GLOSS_BUDGET_DAILY_USD` e `GLOSS_BUDGET_MONTHLY_USD` (padrão provisório **3 e 40** dólares), informe os preços reais do provedor em `GLOSS_PRICE_IN_PER_M` e `GLOSS_PRICE_OUT_PER_M`, e **defina um limite de gasto na conta da Together**, que é o freio final.
2. **Google**: confirme em Google Cloud, Tela de consentimento OAuth, que o status é **"In production"**; em "Testing" só os e-mails de teste entram.
3. **Textos legais** (`docs/legal/`): preencher os campos marcados ⚠️ (identidade, contato, prazos, região, idade mínima) e passar por revisão jurídica. O app ainda não tem páginas nem links para eles.
4. **Planos**: a equipe da Vercel está no Pro em **período de teste** (acompanhe a cobrança); do Neon, confirme plano, região e a janela de restauração.
5. Excluir os dois projetos duplicados da Vercel (`understand-io-z8gn`, `understand-io-6ugt`): sem variáveis, públicos, rodam sem banco e constroem a cada push. Não alterei nada neles.
6. Domínio (`docs/ops/domain-migration.md`) e a senha do projeto `plataforma` no Neon.
7. Notificações do GitHub para os e-mails do monitor "Health" (Watch, Custom, Actions).

## Estado dos serviços

| Serviço | Estado |
| --- | --- |
| Vercel | equipe `menlo6` no plano Pro (teste), Fluid Compute ligado, região `iad1`. Produção `understand-io.vercel.app` em `c71c046`. Variáveis de produção: `APP_URL`, `DATABASE_URL` (atualizada após a rotação), `GLOSS_CHAT_MODEL`, `GLOSS_COOKIE_SECRET`, `GLOSS_REASONING_EFFORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOGETHER_API_KEY`; o Preview só tem o segredo de cookie e **não migra o banco** |
| Neon | senha rotacionada (a antiga foi revogada: o site ficou sem banco até a nova entrar), biblioteca e conta do dono intactas; migrações `0000` a `0005` aplicadas; **`0006` será aplicada pelo build de produção** (só cria 3 tabelas e 1 índice) |
| Together | chave válida; modelo `openai/gpt-oss-120b` com esforço de raciocínio baixo; a conta bloqueia alguns modelos de terceiros; limite de gasto na conta: não verificado (item 1) |
| OAuth | login com Google funciona em produção (confirmado por você); o endereço de retorno usa o host do `APP_URL`; status de publicação da tela de consentimento: não verificado (item 2) |

## Limites do beta, ditos com honestidade

* Notas de estudo de textos muito longos levam de 45 s a 130 s (limite de função: 300 s). **A geração é uma requisição só**: se a aba fechar, ela se perde; não há fila nem estado salvo, e não houve caso que a justifique.
* A chave própria do leitor não conta nas cotas (é dele o gasto), mas respeita uma geração por vez.
* As janelas são dias UTC; a janela fixa permite até o dobro na virada; os custos são estimativas (o freio real é o limite na conta do provedor).
* Backups: só os do Neon. Leitor de tela: não houve passagem humana. O login do Google não pode ser automatizado; foi verificado por você.
* Depois de publicar, **as verificações anônimas vindas de um mesmo IP têm 3 perguntas por dia** (a cota vale para quem testa também); use a sua conta assinada para o resto.

## Como publicar (precisa da sua autorização explícita)

1. Confirme que a `main` ainda está em `c71c046` (`git rev-parse --short origin/main`).
2. Avance a `main` para o commit exato testado e envie, sem criar commit novo (o PR fecha como mesclado):
   `git checkout main && git merge --ff-only <SHA do PR> && git push origin main`
3. A Vercel constrói a produção; o build aplica a `0006` antes do `next build`. Espere ficar **Ready**.
4. `GET https://understand-io.vercel.app/api/health`: `commit` igual ao SHA, `status: ok`, `database: ok`, `allowancesShared: true`.
5. `node scripts/ai-smoke.mjs https://understand-io.vercel.app` (gasta 1 das 3 perguntas anônimas do seu IP) e, no navegador, entre com o Google, importe um texto, faça uma pergunta e rode as notas de estudo.
6. Acompanhe o `/api/health` e o monitor "Health" na primeira hora. Qualquer problema: `docs/ops/rollback-and-recovery.md` (promover o deploy anterior; as migrações só acrescentam, nunca se revertem).
