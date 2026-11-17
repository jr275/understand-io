# Aviso de limitações da versão beta — Keeple

> **RASCUNHO. NÃO É ACONSELHAMENTO JURÍDICO.** Este texto foi escrito a partir do funcionamento do aplicativo. Ele não foi revisado por um advogado. **Não o publique** até que o proprietário preencha todos os campos marcados com ⚠️ e que uma revisão jurídica seja feita.

**Última atualização:** ⚠️ [DECISÃO DO PROPRIETÁRIO: data na publicação]

O Keeple está em **beta**. Ele funciona, mas ainda está sendo construído. Leia isto antes de depender dele.

- **Coisas podem mudar ou quebrar.** Recursos, limites e a aparência do aplicativo podem mudar. Partes podem ser pausadas ou removidas. Nenhuma disponibilidade nem suporte é prometida.
- **Faça backup.** A sua biblioteca é salva no seu navegador e, quando o banco de dados do servidor está disponível, no nosso servidor. Ainda assim, dados podem ser perdidos. Use "Download backup" na biblioteca. O backup contém os textos guardados apenas no seu navegador, não os textos guardados apenas no servidor.
- **Limites de uso.** O operador pode alterá-los a qualquer momento:

  <!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
  - visitantes anônimos: 3 perguntas à IA por dia por cliente;
  - usuários conectados: 20 perguntas à IA por dia;
  - uma geração de IA por vez por usuário;
  - limites de tamanho para documentos (o aplicativo avisa quando um arquivo ou texto é grande demais);
  - um orçamento diário global que pode pausar a IA para todos. Quando ele é atingido, os recursos de IA podem ficar indisponíveis por um tempo. A leitura, os destaques e as notas não dependem de IA e não são afetados.
- **A IA pode errar.** Leia o Aviso de uso de IA de terceiros.
- **O login pode estar indisponível.** O login com o Google só funciona quando o operador o ativou. Sem ele, a sua biblioteca fica presa ao seu navegador.
- **A importação de links pode falhar.** Alguns sites recusam requisições do nosso servidor, ou exigem login ou pagamento. Você pode colar o texto ou enviar um arquivo.
- **Navegadores e dispositivos.** O aplicativo foi testado principalmente no Chrome e em tamanhos de celular emulados, não em todos os navegadores, dispositivos ou leitores de tela. Os recursos de voz dependem do seu navegador.
- **Sessões.** Sair da conta remove o cookie no seu navegador, mas uma cópia dele feita em outro lugar continuaria válida por até 90 dias.

Encontrou um problema? Avise-nos: [jm@useclave.io](mailto:jm@useclave.io)
