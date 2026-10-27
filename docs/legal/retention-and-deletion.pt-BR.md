# Política de retenção e exclusão — Understand.io

> **RASCUNHO. NÃO É ACONSELHAMENTO JURÍDICO.** Este texto foi escrito a partir do funcionamento do código do aplicativo. Ele não foi revisado por um advogado. **Não o publique** até que o proprietário preencha todos os campos marcados com ⚠️ e que uma revisão jurídica seja feita.

**Última atualização:** ⚠️ [DECISÃO DO PROPRIETÁRIO: data na publicação]

Esta página diz por quanto tempo os dados ficam e o que você pode excluir. Em resumo: **o aplicativo guarda os seus dados até que você os exclua. Ele não tem expiração automática e ainda não tem exclusão de conta feita pelo próprio usuário.**

## 1. O que fica e o que você mesmo pode excluir

| Dado | Onde | Por quanto tempo | Você mesmo pode excluir? |
| --- | --- | --- | --- |
| Documentos (texto ou link salvo) | Servidor e navegador | Até que você exclua o documento. Sem expiração automática. | Sim. Excluir um documento remove o documento e os seus destaques, notas, perguntas e respostas da IA e a posição de leitura, do servidor e do navegador. |
| Destaques, sublinhados, notas | Servidor e navegador | Até que você os exclua (ou exclua o documento). | Sim, um por um. |
| Perguntas e respostas da IA | Servidor e navegador | Até que você as exclua (ou exclua o documento). | Sim, uma por uma. |
| Posição de leitura | Servidor e navegador | Até que o documento seja excluído. | Somente excluindo o documento. |
| Configurações de aparência | Somente no navegador | Até que você limpe os dados do navegador. | Limpe os dados deste site no seu navegador. |
| A sua chave da Together AI colada | Somente no navegador | Até que você a remova. | Sim, com o botão "Remove" no painel de chave. |
| Registro de leitor anônimo e cookie `gloss_reader` | Servidor, e o cookie no seu navegador | O cookie dura até 2 anos a partir de quando foi definido. O registro no servidor não expira. | Não. Limpar os cookies não exclui o registro no servidor. Peça a nós (seção 4). |
| Conta (identificador do Google, e-mail, nome, endereço da foto) | Servidor | Sem expiração. O cookie de sessão dura 90 dias. | Não. O aplicativo não tem exclusão de conta. Peça a nós (seção 4). |
| Contadores de requisições (chaves com hash) | Servidor | Cada linha recebe uma expiração igual ao dobro da sua janela de contagem. As linhas expiradas são apagadas por uma limpeza que roda em cerca de uma a cada cinquenta requisições contadas; por isso podem durar mais quando o tráfego é baixo. | Não. |
| Logs da plataforma | Vercel | ⚠️ [DECISÃO DO PROPRIETÁRIO: prazo de retenção de logs no plano da Vercel] | Não. |
| Dados enviados à Together AI | Together AI | ⚠️ [REVISÃO JURÍDICA: termos de retenção da Together AI para a conta do operador e para a sua própria chave] | Não. |

<!-- NOTE FOR OWNER: the limits are shipped with these defaults and are set by environment variables (docs/ops/configuration.md). Update this text if the operator changes them. -->

Quando você exclui algo no aplicativo, o servidor remove as linhas (não mantém uma cópia escondida nas tabelas do aplicativo). Se você estiver offline, a exclusão fica guardada no navegador e é enviada na próxima vez que o aplicativo carregar. Um documento que você exclui em um dispositivo some dos seus outros dispositivos na próxima vez que eles sincronizarem.

Sair da conta apaga os cookies e limpa a cópia da biblioteca naquele navegador. **Não** apaga nada no servidor, nem a sua chave colada, nem as suas configurações.

## 2. Backups

- **O aplicativo não faz backups no servidor.** ⚠️ [DECISÃO DO PROPRIETÁRIO: se o provedor do banco de dados mantém backups ou recuperação a um ponto no tempo no seu plano, e por quanto tempo]. Dados excluídos podem permanecer nesses backups até que eles expirem: ⚠️ [DECISÃO DO PROPRIETÁRIO: prazo de retenção dos backups].
- **Arquivo de backup que você baixa:** o aplicativo pode criar um arquivo com os textos guardados apenas neste navegador e com as marcações, perguntas e posições deles. Ele não é criptografado e não contém textos que existem apenas no servidor. Guarde-o em local seguro. Não podemos excluir arquivos que você baixou.
- **Exportação de notas:** um arquivo Markdown com os destaques, notas e perguntas dos textos guardados no seu navegador.
- Ainda não existe uma exportação completa de tudo o que o servidor guarda sobre você.

## 3. Terceiros

Os serviços de fala do navegador (se o seu navegador envia áudio ao fabricante), a Together AI, o Google, a Vercel e a Neon guardam dados sob os seus próprios termos. Excluir algo no aplicativo não exclui o que eles já receberam. Veja a Política de Privacidade e o Aviso de uso de IA de terceiros.

## 4. Como pedir a exclusão ou a exportação de dados

Para excluir a sua conta ou as cópias dos seus dados no servidor, ou para perguntar o que guardamos, escreva para ⚠️ [DECISÃO DO PROPRIETÁRIO: e-mail ou formulário de contato]. Hoje isso é feito manualmente pelo operador. Responderemos em até ⚠️ [DECISÃO DO PROPRIETÁRIO: prazo para responder]. Podemos pedir que você comprove quem é: ⚠️ [REVISÃO JURÍDICA: verificações de identidade e os direitos e prazos exatos que se aplicam].

## 5. Contas inativas

O aplicativo não exclui leitores nem contas inativas. ⚠️ [DECISÃO DO PROPRIETÁRIO: se será definido um prazo após o qual dados inativos são excluídos, e qual]. ⚠️ [REVISÃO JURÍDICA: se um prazo de retenção é exigido]
