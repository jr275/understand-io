# Aviso de uso de IA de terceiros — Understand.io

> **RASCUNHO. NÃO É ACONSELHAMENTO JURÍDICO.** Este texto foi escrito a partir do funcionamento do código do aplicativo. Ele não foi revisado por um advogado. **Não o publique** até que o proprietário preencha todos os campos marcados com ⚠️ e que uma revisão jurídica seja feita.

**Última atualização:** ⚠️ [DECISÃO DO PROPRIETÁRIO: data na publicação]

## 1. Onde a IA é usada

O Understand.io não executa nenhum modelo de IA por conta própria. Ele envia texto a um terceiro, a **Together AI**, que executa os modelos. Isso acontece nestes recursos:

- **Respostas na margem:** Explicar, Perguntar, Simplificar, Definir, Checar fatos, Relacionados, Contraponto e perguntas sobre o texto inteiro.
- **Painel Entender:** resumos, conceitos-chave, perguntas de teste e tradução.
- **Busca por significado** no painel de voz (ordenar trechos por significado).
- **Perguntas faladas:** a sua pergunta é respondida como acima. Se o seu navegador não tiver reconhecimento de fala, a sua gravação também é enviada para transcrição.

Por padrão, o aplicativo usa `openai/gpt-oss-120b` para as respostas, `BAAI/bge-base-en-v1.5` para a busca por significado e `openai/whisper-large-v3` para a transcrição. O operador pode trocar esses modelos na configuração.

## 2. O que é enviado e quando

Nada é enviado à Together AI se você não apertar um destes botões. O aplicativo responde "precisa de uma chave" e não envia nada quando não há chave disponível.

| Recurso | O que a Together AI recebe |
| --- | --- |
| Resposta na margem | A sua pergunta, o trecho selecionado e os parágrafos que o aplicativo considera relevantes (cerca de 24.000 caracteres no máximo), além dos turnos anteriores dessa conversa. |
| Resumos, conceitos, perguntas de teste | O texto do documento, desde o início ou a partir de um parágrafo escolhido, até cerca de 110.000 caracteres, lido em seções quando é longo. |
| Tradução | O texto selecionado e o parágrafo ao redor dele. |
| Busca por significado | A sua pergunta e alguns trechos curtos do texto. |
| Transcrição no servidor | Uma gravação curta de áudio da sua pergunta. |

## 3. De quem é a chave que paga

- **A chave do operador**, guardada no nosso servidor. O uso com ela é limitado (seção 6).
- **A sua própria chave da Together AI**, se você colar uma. Ela fica guardada no seu navegador, é enviada ao nosso servidor como cabeçalho de requisição a cada requisição e repassada à Together AI para aquela requisição. O código não a armazena no servidor nem a escreve em logs. Você é responsável pelo custo dela e pelos termos da Together AI.

## 4. O que guardamos e registramos

Respostas e resultados são salvos na sua biblioteca (veja a Política de Privacidade), e você pode excluí-los. O servidor registra uma linha de log por requisição respondida, com a operação, de quem era a chave, a contagem de tokens e uma estimativa de custo. Essas linhas **não** contêm texto, pergunta, áudio nem chave. O aplicativo não armazena áudio.

O que a Together AI guarda, e se ela usa dados para treinar modelos: ⚠️ [REVISÃO JURÍDICA: confirmar os termos atuais da Together AI, as configurações da conta do operador e se eles permitem o que está descrito aqui; incluir o link dos termos]. Tudo o que você envia também é regido pelos próprios termos da Together AI.

## 5. A IA pode errar

As respostas de IA podem estar erradas, incompletas ou desatualizadas. Elas podem interpretar mal um trecho, inventar detalhes ou soar confiantes quando não estão.

**O que o aplicativo verifica.** Quando uma resposta aponta uma citação do seu texto, o aplicativo confere se a citação realmente aparece naquele parágrafo (ignorando maiúsculas e minúsculas, espaçamento e estilos de aspas e de travessões). Somente uma citação encontrada no texto é mostrada como evidência. Um item que diz "o texto sustenta isto", mas não tem citação verificada, é identificado como interpretação do modelo e sinalizado como não verificado.

**O que o aplicativo não verifica.** Ele não verifica a interpretação do modelo, as explicações dele, os fatos de fora do texto, o veredito de uma checagem de fatos nem a qualidade de uma tradução. Os rótulos "Minha leitura", "Fora do texto" e "O texto não diz" são escritos pelo modelo a pedido e podem estar errados.

**Instruções escondidas.** Um documento pode conter frases dirigidas à IA. O aplicativo orienta o modelo a tratar o documento como dado, não como instrução, mas isso não pode ser garantido.

Não use o resultado da IA para decisões jurídicas, médicas, financeiras ou outras decisões importantes sem conferir a fonte. Não envie texto que seja confidencial ou que você não tenha direito de compartilhar.

## 6. Limites da versão beta

<!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
Limites atuais da versão beta: visitantes anônimos, 3 perguntas à IA por dia por cliente; usuários conectados, 20 por dia; uma geração de IA por vez por usuário; limites de tamanho para documentos; e um orçamento diário global que pode pausar a IA para todos. O operador pode alterar esses limites.

<!-- NOTE FOR OWNER: in the code I read, limits apply only when the operator's key pays and are hourly (30 AI, 60 search, 15 transcription per client). A reader's own key is not limited. Say here whether the new limits also apply to a reader's own key. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says a document read is "up to about 24,000 characters" for margin answers and 110,000 for summaries. This matches Reader.tsx and ops.ts today; update if the new size limits change it. -->

## 7. Contato

Para relatar uma resposta errada ou nociva, ou para tirar dúvidas sobre este aviso: ⚠️ [DECISÃO DO PROPRIETÁRIO: e-mail ou formulário de contato]
