# Política de Privacidade — Keeple.me

> **RASCUNHO. NÃO É ACONSELHAMENTO JURÍDICO.** Este texto foi escrito a partir do funcionamento do código do aplicativo. Ele não foi revisado por um advogado. **Não o publique** até que o proprietário preencha todos os campos marcados com ⚠️ e que uma revisão jurídica seja feita.

**Última atualização:** ⚠️ [DECISÃO DO PROPRIETÁRIO: data na publicação]

O Keeple.me (antes chamado Understand.io) é um companheiro de leitura. Você importa artigos, PDFs ou textos, lê, destaca, escreve notas e faz perguntas a uma IA sobre trechos. Esta política diz o que o aplicativo guarda, onde guarda, quem mais recebe dados e o que você pode fazer a respeito. O serviço está em versão beta (veja o Aviso de limitações da versão beta).

## 1. Quem opera o serviço

- Operador: Menlo Software AIP. ⚠️ [DECISÃO DO PROPRIETÁRIO: endereço postal e número de registro da Menlo Software AIP, se houver; a forma jurídica não é indicada aqui de propósito]
- Contato para dúvidas e solicitações de privacidade: [jm@useclave.io](mailto:jm@useclave.io)
- Encarregado de proteção de dados ou responsável nomeado pela privacidade: ⚠️ [REVISÃO JURÍDICA: se é exigido e quem é]

## 2. O que é guardado e onde

**No seu navegador (armazenamento local).** A cópia da sua biblioteca (lista de textos, destaques, notas, perguntas e respostas da IA, posições de leitura), as suas configurações de aparência, a chave da Together AI, se você colar uma, e dois pequenos marcadores que lembram que você já viu uma dica de primeira visita e que os textos de exemplo foram colocados na sua estante. Textos que não puderam ser salvos no servidor ficam apenas no navegador.

**No nosso servidor (banco de dados PostgreSQL hospedado pela Neon).** Quando o banco de dados está disponível, o aplicativo salva uma cópia de:

| Dado | O que exatamente |
| --- | --- |
| Registro de leitor anônimo | Um identificador aleatório de leitor e a hora de criação. |
| Documentos que você importa | Título, autor, descrição, ano (se encontrado), endereço e rótulo da fonte, tema, tempo estimado de leitura, o **texto completo**, marcação de favorito, uma impressão digital (SHA-256) do texto normalizado usada para detectar duplicatas, datas e horas. Para um link que não pôde ser lido: o endereço (sem a senha, se alguma foi digitada nele), o título e a descrição que a própria página informa e o motivo. |
| Destaques, sublinhados, notas | Tipo, cor, o texto da nota e o trecho selecionado com a sua posição. |
| Perguntas e respostas da IA | A ação usada, o trecho selecionado, a conversa inteira (suas perguntas e as respostas da IA), resultados estruturados (resumos, traduções e similares), o nome do modelo, a contagem de tokens e uma estimativa de custo. |
| Progresso de leitura | Posição, fração lida, marcação de concluído, hora. |
| Conta (somente se você entrar) | Identificador de assunto (subject) do Google, e-mail, nome, endereço da sua foto de perfil, o identificador do seu leitor, horários do primeiro e do último acesso. |
| Contadores de requisições e registros de limite de IA | Contagens por chave de cliente com hash e por dia ou hora, usadas para os limites de uso (seção 8); um bloqueio de curta duração por chave com hash que permite uma geração de IA por vez; e totais por hora de pedidos de IA, tokens e custo estimado da chave de IA compartilhada, que não estão ligados a nenhuma pessoa. |

Se o banco de dados não puder ser acessado, o aplicativo mantém seus dados no navegador e tenta de novo mais tarde.

<!-- NOTE FOR OWNER: docs/ops/configuration.md and docs/ops/runbook.md (2026-10-18) say no production database was configured at that time. This draft follows the owner's statement that production uses Neon. Confirm that the database is on and which plan and region it uses. -->
<!-- NOTE FOR OWNER: schema.ts defines a `settings` table, but no route writes to it. Appearance settings stay in the browser only. If settings sync is added, update this section. -->

## 3. Cookies

Os cookies só são definidos quando o aplicativo salva algo para você ou quando você entra. Eles são assinados para que não possam ser alterados, mas não são criptografados. Contêm identificadores aleatórios, não o seu nome nem o seu e-mail. Todos são `HttpOnly` e `SameSite=Lax`, e `Secure` em produção.

| Cookie | Finalidade | Duração |
| --- | --- | --- |
| `gloss_reader` | Identifica o seu leitor anônimo para que o servidor encontre a sua biblioteca. | 2 anos |
| `gloss_session` | Mantém você conectado (somente depois do login com o Google). Contém o identificador da sua conta. | 90 dias |
| `gloss_oauth` | Estado temporário de uma tentativa de login. Enviado somente às páginas de login. | 10 minutos |

Por padrão, o aplicativo não inclui serviço de publicidade, de análise (analytics) nem de rastreamento. Se o operador ativar a análise de uso própria do produto, vale a seção 3A. ⚠️ [REVISÃO JURÍDICA: se esses cookies exigem banner de consentimento ou outro aviso nos países que você atende]

## 3A. Análise de uso do produto (somente se o operador ativar)

Por padrão, o aplicativo não mede como é usado. O operador pode ativar uma análise de uso própria: o aplicativo registra contagens de ações por conta própria e não envia nada a serviço de análise nem a qualquer terceiro. ⚠️ [DECISÃO DO PROPRIETÁRIO: se a análise de uso é ativada e em qual dos dois modos abaixo]

Em qualquer dos modos, um registro diz apenas que uma ação aconteceu, nunca o que você leu ou escreveu. Um registro tem o tipo da ação (por exemplo, "um texto foi aberto"), poucas escolhas fixas (por exemplo, que o texto era um PDF, ou que uma pergunta usou a chave compartilhada), o tipo de página, a hora e, se você chegou por um link de campanha, o canal de origem. Nunca tem texto, título, endereço web, nota, pergunta à IA, resposta, nem as palavras que você buscou. Nada é registrado se o seu navegador enviar Do Not Track ou Global Privacy Control.

- **Modo diário.** Um registro é ligado a um código feito com o seu endereço de rede, a descrição do seu navegador e a data, misturados com um segredo guardado no servidor. O endereço e a descrição não são guardados, só o código. Isto é **dado pseudonimizado, não anônimo**: durante um dia o código distingue o seu navegador dos demais, e o operador, que tem o segredo, poderia recriá-lo para um endereço e um navegador conhecidos. O código muda todo dia, então não acompanha você de um dia para o outro. Nada é guardado no seu dispositivo.
- **Modo completo.** Um registro é ligado a um código derivado do seu identificador de leitor (o id aleatório do cookie `gloss_reader`), o mesmo todos os dias, para que o operador veja se as pessoas voltam. O identificador de leitor em si não está no registro. O link de campanha que trouxe você fica no armazenamento de sessão do navegador até você fechar a aba. ⚠️ [REVISÃO JURÍDICA: se o modo completo exige consentimento prévio (banner ou escolha) nos países atendidos, e qual base legal se aplica]

Os registros são apagados automaticamente após ⚠️ [DECISÃO DO PROPRIETÁRIO: quantos dias os registros de análise são guardados; o padrão do aplicativo é 120]. ⚠️ [REVISÃO JURÍDICA: como um pedido de exclusão ou de acesso a registros de análise é atendido no modo completo, em que ficam ligados a um código e não a um nome]

## 4. Login com o Google

O Google é o único método de login. Pedimos ao Google os escopos `openid email profile`. Guardamos o identificador de assunto (subject) do Google, o e-mail, o nome e o endereço da foto. Nunca vemos a sua senha do Google. Usamos o token de acesso do Google uma única vez, para ler o seu perfil, e não o armazenamos. O seu navegador carrega a foto de perfil a partir do endereço que o Google informou.

Quando você entra, a biblioteca que você montou naquele navegador antes de entrar é vinculada à sua conta. Quando você sai, o aplicativo apaga os cookies e limpa a cópia da biblioteca naquele navegador. Ele **não** apaga nada no servidor, nem a sua chave colada, nem as suas configurações. Uma cópia do cookie de sessão feita em outro lugar continuaria válida por até 90 dias, porque o servidor não consegue revogar sessões.

## 5. IA e voz

Quando você aperta um botão de IA, o aplicativo envia texto à Together AI, um terceiro. Pode ser a sua pergunta e o trecho, parágrafos próximos ou grandes partes do documento (para resumos, conceitos-chave, perguntas de teste e tradução). Nada é enviado se você não apertar um botão. Veja o **Aviso de uso de IA de terceiros** para os detalhes.

Voz: o microfone só liga depois que você aperta o botão dele. O reconhecimento de fala do navegador é feito pelo serviço de fala do seu navegador e, dependendo do navegador, o áudio pode ir para o fabricante do navegador. Se o seu navegador não tiver esse recurso, a sua gravação pode ser enviada ao nosso servidor e depois à Together AI para ser transformada em texto. Não armazenamos áudio. A leitura em voz alta usa as vozes do seu navegador. Uma voz online pode enviar o texto lido ao fabricante do navegador.

## 6. Importação de links e arquivos

Quando você importa um link, o nosso servidor busca esse endereço (somente hospedagens públicas da web) e guarda o texto extraído. Quando você envia um arquivo (PDF, texto, Markdown, Word, EPUB ou HTML) ou cola um texto, o servidor lê e guarda o texto. Uma página capturada por um bookmarklet é tratada do mesmo modo. O arquivo ou a página original não são guardados; o texto extraído é. Não importe material que você não tenha direito de usar ou que seja confidencial.

## 7. Quem mais recebe dados

| Provedor | Função | Dados |
| --- | --- | --- |
| Vercel | Hospedagem e logs da plataforma | Todas as requisições ao aplicativo. A Vercel mantém os seus próprios logs de requisições e de funções. |
| Neon | Banco de dados | Tudo o que está na lista do servidor na seção 2. |
| Together AI | Respostas de IA, embeddings, transcrição | Texto e áudio que você escolhe enviar (seção 5). |
| Google | Login | A troca de login (seção 4). |

Não citamos nem usamos outros provedores. As linhas de log do próprio aplicativo contêm códigos de erro e contagens de uso (operação, de quem era a chave, contagem de tokens, estimativa de custo). Elas não contêm texto de documentos, notas, perguntas, áudio nem chaves de API. ⚠️ [REVISÃO JURÍDICA: confirmar o que cada provedor registra e sob quais termos atua em nosso nome]

## 8. Limites de uso e chaves com hash

Para limitar abusos e custos, o aplicativo conta as requisições por endereço de cliente, por identificador de leitor e (quando você está conectado) por identificador de conta, e permite uma geração de IA por vez por usuário. Apenas um hash de cada chave é guardado no banco de dados, com uma contagem e uma data de expiração. O aplicativo também guarda totais por hora do uso da chave de IA compartilhada (número de pedidos, tokens, custo estimado e quantos falharam); esses totais não estão ligados a nenhuma pessoa. O endereço bruto é lido dos cabeçalhos da requisição e mantido apenas na memória do servidor durante a janela de contagem; o aplicativo não o grava no banco de dados.

<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says the limiter is per process only. The code also counts in the `rate_hits` table (rateStore.ts), keyed by a SHA-256 hash, so this draft describes the hashed database counters. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says Google sign-in keeps "your account id and email". The code (schema.ts, auth.ts) also stores the name and the picture address. This draft follows the code. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md calls PostgreSQL "your own database". This draft names Neon, as stated by the owner. -->
<!-- NOTE FOR OWNER: the daily and global limits below are not in the code I read (the limits there are hourly per client: 30 AI, 60 search, 15 transcription, and 60 imports per ten minutes, and they apply only when the operator's key pays). Today a reader's own key is not limited. Decide whether the new limits also apply to a reader's own key, and say so here. -->
<!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
Limites atuais da versão beta: visitantes anônimos, 3 perguntas à IA por dia por cliente; usuários conectados, 20 por dia; uma geração de IA por vez por usuário; limites de tamanho para documentos; e um orçamento diário global que pode pausar a IA para todos. O operador pode alterar esses limites.

## 9. Transferências internacionais

Vercel, Neon, Together AI e Google são empresas que podem tratar dados em países diferentes do seu. Região do servidor: as funções do aplicativo rodam na Vercel na região `iad1` (Washington, D.C., Estados Unidos). Região do banco de dados: ⚠️ [DECISÃO DO PROPRIETÁRIO: a região do banco de dados na Neon; o repositório não informa]. ⚠️ [REVISÃO JURÍDICA: mecanismo de transferência e avisos exigidos]

## 10. Guarda e exclusão de dados

Dentro do aplicativo você pode excluir um documento (isso também remove as suas marcações, perguntas e posição de leitura), um destaque ou nota individual, ou uma resposta de IA. Não há expiração automática. Ainda não existe exclusão de conta feita pelo próprio usuário. Veja a **Política de retenção e exclusão**.

## 11. Suas escolhas e direitos

No aplicativo você pode excluir conteúdo, baixar um backup e uma exportação em Markdown das suas notas, remover a chave que colou e limpar os dados do navegador. Para qualquer outra coisa, como excluir a sua conta ou cópias dos seus dados no servidor, escreva para [jm@useclave.io](mailto:jm@useclave.io) (veja a seção 16). Prazo e procedimento de resposta: ⚠️ [DECISÃO DO PROPRIETÁRIO: prazo para responder às solicitações]. ⚠️ [REVISÃO JURÍDICA: redação dos direitos dos titulares de dados, como verificar a identidade e qual autoridade de supervisão citar]

## 12. Bases legais

⚠️ [REVISÃO JURÍDICA: um advogado deve escolher e indicar a base legal de cada finalidade (prestação do serviço, segurança e limites, tratamento por IA, login) conforme as leis aplicáveis]

## 13. Crianças e adolescentes

⚠️ [DECISÃO DO PROPRIETÁRIO: idade mínima para usar o Keeple.me]. ⚠️ [REVISÃO JURÍDICA: regras sobre dados de crianças e adolescentes nos países que você atende]

## 14. Segurança

Cada requisição aos seus dados é verificada com o seu identificador de leitor. Em produção, o acesso usa HTTPS. O aplicativo em si não criptografa, no banco de dados, o texto dos seus documentos, notas ou perguntas; a proteção em repouso depende do provedor do banco de dados. Um arquivo de backup que você baixa não é criptografado. Nenhum sistema é perfeitamente seguro.

## 15. Alterações

⚠️ [DECISÃO DO PROPRIETÁRIO: como os usuários serão avisados das alterações, por exemplo um aviso no aplicativo ou um e-mail]

## 16. Contato e solicitações de privacidade

A Menlo Software AIP, operadora do serviço, responde a dúvidas e solicitações de privacidade em **[jm@useclave.io](mailto:jm@useclave.io)**.

- **O que você pode pedir:** uma cópia dos dados que mantemos sobre você, correção, exclusão da sua biblioteca ou da sua conta, explicação de como seus dados são usados e a retirada de qualquer concordância que você tenha dado. Excluir dentro do aplicativo (seção 10) não exige solicitação.
- **O que enviar:** qual é a solicitação. Se você entrou com o Google, o e-mail da conta usada. Se nunca entrou, sua biblioteca é conhecida pelo servidor apenas por um identificador aleatório de leitor, guardado no cookie `gloss_reader` do seu navegador: só conseguimos encontrar essa biblioteca se você nos enviar esse identificador, e sem ele não temos como distinguir você de outra pessoa.
- **O que acontece depois:** podemos pedir que você confirme que a biblioteca ou a conta é sua antes de agirmos. ⚠️ [REVISÃO JURÍDICA: verificação de identidade, prazos e os direitos exatos que se aplicam]. ⚠️ [DECISÃO DO PROPRIETÁRIO: o prazo para responder às solicitações]
- **Solicitações sobre o provedor de IA, a hospedagem ou o login:** essas empresas atuam como descrito na seção 7; um pedido de exclusão cobre também as cópias que mantemos, mas não as cópias que um provedor guarda sob seus próprios termos (veja o Aviso de IA e o texto de Retenção e exclusão).
