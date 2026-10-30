# Third-party AI notice — Understand.io

> **DRAFT. NOT LEGAL ADVICE.** This text was written from how the app's code works. It has not been reviewed by a lawyer. **Do not publish it** until the owner has filled in every field marked with ⚠️ and a legal review has been done.

**Last updated:** ⚠️ [OWNER DECISION: date at publication]

## 1. Where AI is used

Understand.io does not run an AI model itself. It sends text to a third party, **Together AI**, which runs the models. This happens in these features:

- **Margin answers:** Explain, Ask, Simplify, Define, Fact-check, Related, Counterpoint, and questions about the whole text.
- **Understand panel:** summaries, key concepts, test questions, and translation.
- **Meaning search** in the voice panel (ranking passages by meaning).
- **Spoken questions:** your question is answered as above. If your browser has no speech recognition, your recording is also sent for transcription.

By default the app uses `openai/gpt-oss-120b` for answers, `BAAI/bge-base-en-v1.5` for meaning search and `openai/whisper-large-v3` for transcription. The operator can change these models in the configuration.

## 2. What is sent, and when

Nothing is sent to Together AI unless you press one of these buttons. The app answers "needs a key" and sends nothing when no key is available.

| Feature | What Together AI receives |
| --- | --- |
| Margin answer | Your question, the selected passage, and the paragraphs the app judges relevant (about 24,000 characters at most), plus earlier turns of that conversation. |
| Summaries, concepts, test questions | The text of the document, from the start or from a chosen paragraph, up to about 110,000 characters, read in sections when long. |
| Translation | The selected text and its surrounding paragraph. |
| Meaning search | Your question and a few short excerpts of the text. |
| Server transcription | A short audio recording of your question. |

## 3. Whose key pays

- **The operator's key**, kept on our server. Usage under it is limited (section 6).
- **Your own Together AI key**, if you paste one. It is kept in your browser, sent to our server as a request header with each request, and forwarded to Together AI for that request. The code does not store it on the server or write it to logs. You are responsible for its cost and for Together AI's terms.

## 4. What we keep and log

Answers and results are saved in your library (see the Privacy Policy), and you can delete them. The server logs one line per answered request with the operation, whose key paid, token counts and a cost estimate. Those lines hold **no** text, question, audio or key. The app does not store audio.

What Together AI keeps, and whether it uses data to train models: ⚠️ [LEGAL REVIEW: confirm Together AI's current terms, the settings of the operator's account, and whether they allow what is described here; link the terms]. Anything you send is also governed by Together AI's own terms.

## 5. AI can be wrong

AI answers may be wrong, incomplete or out of date. They can misread a passage, invent details, or sound sure when they are not.

**What the app checks.** When an answer points to a quote in your text, the app checks that the quote really appears in that paragraph (ignoring case, spacing, and quote and dash styles). Only a quote found in the text is shown as evidence. An item that says "the text supports this" but has no verified quote is labelled as the model's interpretation and flagged as unverified.

**What the app does not check.** It does not verify the model's interpretation, its explanations, its facts from outside the text, a fact-check verdict, or the quality of a translation. The labels "My reading", "Outside the text" and "The text does not say" are written by the model on request and can be wrong.

**Hidden instructions.** A document can contain sentences aimed at the AI. The app tells the model to treat the document as data, not instructions, but this cannot be guaranteed.

Do not use AI output for legal, medical, financial or other important decisions without checking the source. Do not send text that is confidential or that you have no right to share.

## 6. Beta limits

<!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
Current beta limits: anonymous visitors, 3 AI questions per day per client; signed-in users, 20 per day; one AI generation at a time per user; size limits on documents; and a global daily budget that can pause AI for everyone. The operator may change these.

<!-- NOTE FOR OWNER: in the code I read, limits apply only when the operator's key pays and are hourly (30 AI, 60 search, 15 transcription per client). A reader's own key is not limited. Say here whether the new limits also apply to a reader's own key. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says a document read is "up to about 24,000 characters" for margin answers and 110,000 for summaries. This matches Reader.tsx and ops.ts today; update if the new size limits change it. -->

## 7. Contact

To report a wrong or harmful answer, or to ask about this notice: [jm@useclave.io](mailto:jm@useclave.io)
