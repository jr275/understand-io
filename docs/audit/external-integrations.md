# External integrations: what is real, what is simulated, what is unproven

A mock passing is not proof that an integration works. Each row says which of the two the evidence is.

| Integration | Used for | Evidence this pass | Status |
| --- | --- | --- | --- |
| PostgreSQL 16 (local Homebrew, database `gloss`) | documents, annotations, glosses, progress, accounts | **Real.** Migrations 0000 to 0002 match the journal; routes read and write real rows in e2e; an outage was reproduced by pointing `DATABASE_URL` at a dead port and running the real app and real driver (library, reader, import, annotation routes all degrade as designed; logs hold the error code and no SQL) | VERIFIED WORKING |
| Browser speech synthesis (Chrome 155, 199 voices) | read aloud | **Real engine, events only.** Start, end, error, pause flag and voices observed; audibility not observed | VERIFIED WORKING for behaviour; sound is BLOCKED (human) |
| Browser speech recognition (`SpeechRecognition`) | voice search | **Not exercised.** No microphone was opened by an agent; the lifecycle is tested with a fake recogniser | IMPLEMENTED, NOT VERIFIED |
| `getUserMedia` and `MediaRecorder` | server transcription fallback | **Fake only** in unit tests | IMPLEMENTED, NOT VERIFIED |
| Together AI chat (glosses, whole-text questions, overview) | the margin answers | **Not exercised.** `TOGETHER_API_KEY` is empty and no user key was supplied. Verified: the 402 `needs-key` answer and card, request validation and limits, fixed error text, client abort propagation | BLOCKED |
| Together AI embeddings | meaning re-rank in voice search | **Not exercised.** Verified: graceful degradation to "words only", contract (reorder only, confidence unchanged) | BLOCKED |
| Together AI Whisper | server transcription | **Not exercised.** Verified: size, type and time limits, no-key 402 | BLOCKED |
| Google OAuth 2.0 (PKCE) | accounts | **Not exercised.** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are absent. Verified: the disabled state and its honest message (e2e), state and PKCE helpers, the account and reader merge planner, production guards | BLOCKED |
| Public web pages | URL import | **Real, live.** At the earlier pass: paulgraham.com, Wikipedia, BBC, Substack, New Yorker answered 200 and imported; theatlantic.com, medium.com, nytimes.com answer 403 to any server-side fetch and are handled by the capture bookmarklet, which was run for real on a live Atlantic article in Chrome | VERIFIED WORKING |
| PDF parsing (`unpdf`, pdf.js) | PDF import | **Real files.** arXiv 1706.03762 imported through the route (258 blocks after the paragraph-gap change; 62 before, with headings fused into paragraphs); a PDF made with the system print filter; a corrupted file answers 422 "Invalid PDF structure." | VERIFIED WORKING; quality on figure- and table-heavy pages is limited (see backlog) |

## Together AI: how to verify, and what it may cost

Names only; never paste the key in chat or commit it.

1. In `.env.local` set `TOGETHER_API_KEY` (server key) or paste a key in the app's key panel (browser only).
2. Restart `pnpm dev --port 3100`.
3. In the reader: select a sentence and choose Explain. Expect a streamed answer with paragraph citations. Then ask a whole-text question and press `B`.
4. Press `V`, say or type a paraphrase. Expect "words + meaning" instead of "words only".
5. Record a 5-second voice query with the browser recogniser blocked (or in a browser without it) to exercise Whisper.

Cost: Together AI bills per token and per audio minute. One Explain call is a few thousand input tokens. The server key is protected by per-reader and per-address limits (defaults in `src/lib/server/rateLimit.ts`, tunable with `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE`, `GLOSS_RATE_WINDOW_SEC`); the limits are per process. No key was created and no paid call was made in this audit.

## Google sign-in: how to verify

1. Google Cloud Console, Credentials, create an OAuth client of type Web application.
2. Authorised redirect URI: `http://localhost:3100/api/auth/google/callback`.
3. Put the client id and secret in `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Optionally set `APP_URL=http://localhost:3100`. Restart.
4. Click Sign in. Expect the Google consent screen, then a return to the app with your account shown.
5. Highlight something first as an anonymous reader, then sign in: the highlight must still be there (merge).
6. Sign in from a second browser profile: your library and highlights must follow.
7. Sign out and sign in again: nothing is duplicated.

Do not claim sign-in works until step 4 to 7 have happened with real credentials.

## The development database is shared with the test suite

The Playwright suite writes documents, annotations and readers into the same local `gloss` database the app uses (every test run adds rows under throw-away reader cookies). There is no disposable test database, so destructive scenarios such as table resets and migration rollbacks were not run. Counts at the start of this audit were 49 documents, 25 annotations, 86 readers; they only grow. A separate `DATABASE_URL` for tests is recommended before any CI is added.
