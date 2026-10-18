# Privacy and providers

What leaves the browser, where it goes, and what this app keeps. Written from the code, not from intentions.

## Summary

| Feature | What is sent | To whom | When | Kept by this app |
| --- | --- | --- | --- | --- |
| Reading, highlights, notes, progress, settings | nothing | nobody (browser storage) | always local | in the browser, and in your library on this server when a database is configured |
| Library on the server | documents you import, annotations, glosses and results, progress | this app's PostgreSQL | when a database is configured; the browser keeps its own copy anyway | until you delete them. A document's text is stored with it |
| Open or save a link | the link | the website you named, from this server (public hosts, ports 80 and 443 only) | when you press Read | the extracted text as a document, or for a page that cannot be read only its address, the title and description it gives itself and the reason (a link card) |
| Upload a PDF or text, paste text | the file or text | this server | when you press Read | as a document |
| Explain, Ask, Simplify, Define, Fact-check, Related, Counterpoint, Gloss this text | your question, the selected passage, and the paragraphs judged relevant (up to about 24,000 characters) | Together AI (the model provider) | when you press the button | the answer, the paragraph ids the model was given, and token counts |
| Summaries, key concepts, Test me | the text of the document, from the start or from the chosen paragraph, up to about 110,000 characters, read in sections when long | Together AI | only when you press one of the buttons in the Understand panel | the result with its coverage statement and checked quotes |
| Translate (selection or a part of the text) | the selected text, plus its surrounding paragraph for meaning | Together AI | when you press Translate | the translation next to your original text |
| Meaning search (voice panel, "Find a passage") | your question and a few short excerpts of the text | Together AI | only when a key exists | nothing |
| Read aloud | nothing leaves the browser by this app; the browser's own engine speaks | the browser vendor's voice service if you pick an online voice (for example Google voices in Chrome) | when you press L or the speaker buttons | nothing |
| Ask by voice or typed (voice panel) | your question and the relevant paragraphs, as above | Together AI for the answer | when you ask | the answer as a margin note |
| Microphone | audio | the browser's speech service (Chrome and Edge send it to their vendor; Safari uses Apple) or, if the browser has none and a key exists, this server and then Together AI for transcription | only after you press the microphone button | this app keeps no audio. Server transcription holds the recording in memory for the request |
| Google sign-in (when configured) | the OAuth exchange | Google | when you press Sign in | your account id and email as Google returns them |

## Providers

- **Together AI** (model provider). Chat, embeddings and Whisper transcription. Used with the server's key (`TOGETHER_API_KEY`) or with a key the reader pastes in the browser. A reader's own key is sent as a request header to this app's routes, forwarded for that one request, never stored on the server and never written to logs. The app answers "needs a key" and sends nothing when there is no key.
- **Browser speech engines.** Part of the browser. Which voices exist and whether they are local or online depends on the operating system and browser.
- **Google** (optional sign-in). Only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- **PostgreSQL.** Your own database; this app does not send data anywhere else.

No analytics, advertising or tracking service is included.

## What the app does not do

- It does not send a document to a model unless you press a button that says it will (the Understand panel states it before you press anything; the voice panel states it next to the microphone).
- It does not store audio. Recordings are not written to disk or to the database.
- It does not put document text, notes or questions in server logs. Provider and database errors are logged by status or code only (a test checks that a note's text and SQL do not appear).
- It does not show one reader's data to another: every row is scoped to the reader's cookie.
- It does not replace the original text with a translation or a summary. AI output is stored beside the text and labelled as AI-generated, with the model's name.

## What to know before you rely on it

- Anything sent to Together AI is governed by Together AI's own terms. If a text is confidential, do not press the AI buttons, and use read-aloud and search, which stay in the browser.
- Online browser voices send the text being read to the browser vendor. Pick a local voice for private texts.
- The shared server key can be used by any visitor. The limiter is per process (see `docs/audit/security-review.md`).
- Anonymous readers are identified by a signed cookie, not an account; clearing cookies loses access to the server copy of a library.
