# Read aloud and underline: what exists, how it behaves, how to extend it

Both were already in the reader when Keeple was renamed; this page records what they do, so nobody rebuilds them, and what a Google voice would need.

## Underline
* Select text, then press the **Underline** button of the selection toolbar, or **Shift+U**. Highlight is **Shift+H** (four colours); underline uses the same colour choice and is a separate mark: the model is one annotation type with `kind: "highlight" | "underline" | "note"` (`src/lib/content/types.ts`, `src/lib/anchors`).
* Highlight and underline can cover the same words (the underline is drawn inside the highlight); each is removed on its own from the toolbar ("Remove underline") and listed under its own name in **Your marks** in the library (`Highlights`, `Underlines`, `Notes`).
* Saved like every annotation: in the browser at once, and in the database for a signed-in or cookie-identified reader (`/api/annotations`), restored after a reload and re-anchored when the text changes.
* Tests: `tests/e2e/annotations.spec.ts` (create, coexist with a highlight, remove, persist), `tests/e2e/ingest-and-marks.spec.ts` (marks review lists underlines and highlights apart), `tests/unit/anchors-*.test.ts`, `tests/unit/marksReview.test.ts`.

## Read aloud
* Open it from the selection toolbar (**Read aloud**), the **L** key, or the reader's toolbar. It reads the selected passage and then continues with the rest of the text, or the whole text from the current place.
* Controls in the bar: **Pause / Resume**, **Stop**, **back and forward one sentence**, **Restart**, **Speed**, **Voice**; the sentence being read is highlighted and followed. Labels in `listen.*` (English and Portuguese).
* Engine today: the browser's Web Speech API (`speechSynthesis`), one utterance per sentence with the workarounds that real browsers need (Chrome keeps `paused` after `cancel()`, long utterances stall, voices load late): `src/lib/speech/controller.ts`, `segments.ts`. The language of the voice follows the text's language (`documentLang`), with the reader's choice remembered. When the browser has no speech engine the bar says so and nothing else breaks (`state: "unsupported"`).
* Tests: `tests/unit/speech-controller.test.ts`, `tests/unit/speech-unsupported.test.ts`, `tests/e2e/search-and-speech.spec.ts` (fake speech engine: play, pause, resume, stop, skip, restart, passage, errors).

## Adding a Google voice later (not done: it needs a decision and a credential)
The seam is small and known: everything the controller asks of the engine is in about twenty lines (`synth.cancel/pause/resume/speak`, `getVoices`, `new SpeechSynthesisUtterance`, the `end` and `error` events). A second provider means:
1. Extract those calls behind an interface (`speak(text, {lang, rate, voice}) → events`, `cancel`, `pause`, `resume`, `voices`) with the browser engine as the default implementation; keep the controller's sentence queue, highlight, counter and skip logic unchanged. The existing controller tests are the safety net for the extraction.
2. Add a server route (for example `POST /api/speech/tts`, rate-limited like `/api/ai`) that calls Google Cloud Text-to-Speech with the **server's** identity and returns audio for one sentence; an `HTMLAudioElement` engine plays it. The key never reaches the browser.
3. Needs from the owner: the Text-to-Speech API enabled on the Google project, a service account (or the federation already prepared for Vertex) allowed to call it, a budget (Neural2 voices are billed per character), and a rule for the privacy notice (the text of the page is sent to Google, as it is already sent to Together AI for answers). Environment names to add: `GLOSS_TTS_PROVIDER` (`browser` default, `google`), `GOOGLE_TTS_VOICE_PT` and `GOOGLE_TTS_VOICE_EN`.
4. Fallback: if the server route fails or is not configured, fall back to the browser engine for the rest of the session and say so in the bar.
This was not extracted today because the controller is the most fragile part of the reader and the browser engine already works; a refactor without a second provider to prove it would only add risk.
