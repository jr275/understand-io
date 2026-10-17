# Understand.io — a from-scratch reconstruction of Gloss

An independent reading app that reproduces the publicly observable [Gloss](https://www.usegloss.io)
experience and adds three features: **read-aloud (text-to-speech)**, **voice semantic passage
search**, and **text annotations** (highlights, underlines, notes).

Paste a link, a PDF or some text → a clean numbered reading view → select any line and ask about
it; the answer lands in the margin, citing paragraphs. Texts live on a shelf grouped by topic.

**Understand.io reads with you:** summaries in five kinds (quick, executive, detailed, key ideas, a single passage), key concepts and questions that test your understanding, translation of a selection or of the text a page at a time (the original stays beside it), search inside the text with a section menu, read-aloud, and questions asked aloud or typed with answers in text and speech. Every AI result says which paragraphs it read, quotes the text where it can and checks those quotes against it, and labels what is the model's own reading. The AI features need a Together AI key (yours, in the key panel); reading, highlighting, notes, search and read-aloud need nothing. What is sent where: [`docs/privacy-and-providers.md`](docs/privacy-and-providers.md).

## Prerequisites

| Need | Version | Notes |
| --- | --- | --- |
| Node.js | 22 or newer (developed on 24.9) | the AI SDK requires 22+ |
| pnpm | 12 (`packageManager` is pinned in `package.json`) | `corepack enable` or `npm i -g pnpm` |
| PostgreSQL | 16 (optional) | without it the app runs local-only; see "Database" |
| A browser | Chrome, Edge or Safari for speech; any modern browser for reading | see "Browser limitations" |

## Run it

```bash
cd gloss
pnpm install --frozen-lockfile
cp .env.example .env.local        # optional: edit DATABASE_URL, GLOSS_COOKIE_SECRET, TOGETHER_API_KEY
pnpm db:migrate                   # only when DATABASE_URL points at a running PostgreSQL
pnpm dev --port 3100              # http://localhost:3100
```

Everything reads and annotates without any configuration: the three public-domain sample texts are built in, and
highlights, notes, glosses and settings are kept in the browser. Never commit `.env.local`.

### Database

```bash
createdb gloss                    # once, with PostgreSQL running (Homebrew: brew services start postgresql@16)
# .env.local:  DATABASE_URL=postgres://localhost:5432/gloss
pnpm db:migrate                   # applies drizzle/0000 .. 0003 in order
```

Migrations are never edited once applied. A schema change is `pnpm db:generate` followed by `pnpm db:migrate`.
Migration `0002` makes `accounts.reader_id` unique and fails if duplicate rows already exist. The end-to-end tests write
into whatever database `DATABASE_URL` names, so point it at a development database, not one you care about.

### Environment variables (names; never put real values in the repository)

| Variable | What it enables |
| --- | --- |
| `DATABASE_URL` | PostgreSQL persistence (documents you import, annotations, glosses, progress), keyed by an anonymous reader cookie. Without it the app runs local-only. |
| `TOGETHER_API_KEY` | Margin glosses and whole-text answers (OpenAI-compatible endpoint, DeepSeek by default), embedding re-ranking for semantic search, and server-side transcription. Readers can also paste their own key in the app; it is sent per request and never stored. |
| `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE`, `GLOSS_RATE_WINDOW_SEC` | Rate limits for calls paid by `TOGETHER_API_KEY` only (a reader's own key is never limited): requests per window for each reader id and each client address. Defaults 30 / 60 / 15 per 3600 s; `off` disables one. The limiter is in memory, so it is **per process**: with several instances or serverless functions each keeps its own counters (the effective limit is multiplied) and a restart resets them; a hard global cap needs a shared store such as Redis. The client address is read from `x-forwarded-for` / `x-real-ip`, which only a trusted proxy in front of the app can set. |
| `GLOSS_COOKIE_SECRET` | Signs the reader, session and OAuth-state cookies. **In production it must be at least 32 characters** (`openssl rand -hex 32`); a shorter or example value stops the server from signing anything. Changing it signs every reader out. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (optional). An account owns one reader id; signing in on another browser swaps that browser's reader cookie to it and merges anything read anonymously there into the account. Needs `DATABASE_URL`. Redirect URI: `<origin>/api/auth/google/callback`. |
| `APP_URL` | Public origin for the OAuth redirect and post-sign-in redirect. **Required in production** (sign-in answers 503 without it); outside production it defaults to the request origin. |

Read-aloud uses the browser's own speech engine and needs no key. Voice search uses the browser's
speech recognition where available (Chrome, Edge, Safari) and falls back to server transcription
when a key is configured.

## When something looks broken

| Symptom | Cause | What to do |
| --- | --- | --- |
| `/library` or an imported text shows an error, or the log says `ECONNREFUSED ... 5432` | PostgreSQL is not running | `brew services start postgresql@16` (Homebrew install), then reload. The app keeps working without it: pages load, imports stay in this browser and sync once the database is back. |
| `EADDRINUSE: address already in use :::3100` | another dev server already owns the port | open http://localhost:3100 instead, or stop the other one first (`lsof -nP -iTCP:3100 -sTCP:LISTEN`) |
| `Another next dev server is already running` | Next allows one dev server per folder | use the URL it prints, or `kill` the PID it names |
| "That site blocks readers like this one" | the publisher refuses server-side fetches (403) | use the "Read in Understand" bookmarklet from the Add panel, or paste the text |

## Scripts

- `pnpm dev --port 3100` / `pnpm build` / `pnpm start`
- `pnpm typecheck` · `pnpm lint`
- `pnpm test` — Vitest unit tests (anchoring, retrieval, parsing, speech controller, voice panel lifecycle, security helpers)
- `pnpm test:e2e` — Playwright (starts `next dev` on port 3100 unless one is running; set `PLAYWRIGHT_PORT`)
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm exec tsx scripts/theme-paint-check.mts [baseUrl]` — measures that the saved theme is applied before first paint, on a fast and a throttled network
- `pnpm exec tsx scripts/eval-retrieval.mts` — retrieval metrics on the labelled queries
- `pnpm exec tsx scripts/a11y-scan.mts [baseUrl]` — axe scan of 30 UI states in two themes
- `pnpm exec tsx scripts/visual-diff.mts [baseUrl]` — pixel comparison against the reference captures
- `pnpm audit --prod` — dependency advisories

## Keyboard

`/` ask about the whole text · `J`/`K` next/previous paragraph · `Enter` ask about the current paragraph ·
`[` `]` previous/next gloss · `B` gloss this text · `N` notebook · `F` focus · `L` listen ·
`Space` pause/resume · `V` ask by voice · `S` find in the text · `I` Understand (summaries, translation) · `⇧H` highlight · `⇧U` underline · `?` all keys

Single-key shortcuts can be switched off in Appearance ("Single-key shortcuts") for people who use speech input or an unsteady keyboard.

## Browser limitations

- Read-aloud uses the browser's own speech engine. Chrome, Edge and Safari have it; if yours does not, the app says so. Voices differ per
  operating system. Chrome pauses long utterances, so the controller speaks in chunks of at most 220 characters.
- Voice search uses the browser's `SpeechRecognition` where it exists (Chrome, Edge, Safari). In Chrome the audio goes to Google's recognition
  service; the panel says where audio goes. It needs a secure context (https or localhost) and the microphone permission. Otherwise it records
  and sends audio to the server for transcription, which needs a Together AI key.
- Only Chrome 155 and Playwright's Chromium were used for testing. Safari, Firefox, iOS and Android are untested.

## Provider limitations

- Margin answers, whole-text answers, summaries, concepts, comprehension questions, translation, meaning re-rank and server transcription need a Together AI key (server `TOGETHER_API_KEY` or a reader's own).
  Without one the app answers "needs a key" and never fakes output. **These paths have not been run against the live provider**: they are tested with a fake model, which proves the checking, storage and display but not the quality of any answer.
- Google sign-in needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and (in production) `APP_URL`. The real round trip has not been run.
- Some publishers (theatlantic.com, medium.com, nytimes.com) refuse server-side fetches. Use the "Read in Understand" bookmarklet from the Add panel
  or paste the text.

## Known defects and limits

The full list is `docs/audit/defect-backlog.md`. The ones you are likely to meet:

- Retrieval by words misses paraphrases; meaning search is only as good as the model and has not been measured.
- AI answers are only as good as the model; quotes are checked against the text, but a summary can still be wrong. Whole-text translation goes a page at a time.
- PDFs with figures and tables still produce some short blocks.
- Annotations on texts that exist only in your browser (`local:` documents) do not sync between devices.
- Existing highlights are not reachable with the keyboard (the Notebook lists them and can delete them).
- The development database fills up with test data whenever the end-to-end suite runs.

## Security considerations

- Reader identity is an anonymous signed cookie. Anyone with the cookie has that library; there is no revocation. Sign-in is optional.
- The server key can be spent by any visitor: set the rate limits, and remember the limiter is **per process** (see the table above).
- In production set `GLOSS_COOKIE_SECRET` (32+ characters) and `APP_URL`; the server refuses to run its auth paths without them.
- Imports fetch only public hosts on ports 80 and 443 (addresses are checked at connect time); pages and PDFs are size, depth and time limited.
- The security headers do not include a `script-src` policy yet. The app has not been deployed or load tested; run it behind TLS and observe the headers
  before exposing it.
- Details and open items: `docs/audit/security-review.md`.

## Quality evidence

`docs/final-qa-report.md` (verdict, matrix, metrics), `docs/implementation-status.md` (91 requirements with exact statuses) and `docs/audit/` (traceability, runtime architecture, per-feature validation, security, integrations, accessibility, test strategy, defect backlog).
Checks that need a person (hearing the audio, speaking into the microphone, a phone, Google sign-in, a Together key) are written as short checklists in the validation documents.

## Docs

- [`docs/product-specification.md`](docs/product-specification.md)
- [`docs/reference-routes.md`](docs/reference-routes.md) and [`docs/interaction-inventory.md`](docs/interaction-inventory.md) — what was observed on the reference
- [`docs/design-system.md`](docs/design-system.md) — tokens, type, spacing, components
- [`docs/architecture.md`](docs/architecture.md) (original plan) and [`docs/audit/runtime-architecture.md`](docs/audit/runtime-architecture.md) (as built)
- [`docs/implementation-status.md`](docs/implementation-status.md) — honest per-feature status and test evidence
- [`docs/evolution-report.md`](docs/evolution-report.md) — the intelligent-reading work by phase: what was built, how it was tested, what is not verified
- [`docs/privacy-and-providers.md`](docs/privacy-and-providers.md) — what is sent where
