# Understand.io — a from-scratch reconstruction of Gloss

An independent reading app that reproduces the publicly observable [Gloss](https://www.usegloss.io)
experience and adds three features: **read-aloud (text-to-speech)**, **voice semantic passage
search**, and **text annotations** (highlights, underlines, notes).

Paste a link, a PDF or some text → a clean numbered reading view → select any line and ask about
it; the answer lands in the margin, citing paragraphs. Texts live on a shelf grouped by topic.

## Run it

```bash
pnpm install
cp .env.example .env.local        # optional: DATABASE_URL, TOGETHER_API_KEY
pnpm db:migrate                   # only when DATABASE_URL is set (PostgreSQL)
pnpm dev                          # http://localhost:3000
```

Everything reads and annotates without any configuration: the three public-domain sample texts
are built in, and highlights, notes, glosses and settings are kept in the browser.

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

- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm typecheck` · `pnpm lint`
- `pnpm test` — Vitest unit tests (anchoring, search, parsing, speech segmentation)
- `pnpm test:e2e` — Playwright (starts `next dev` on port 3100 unless one is running; set `PLAYWRIGHT_PORT`)
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm exec tsx scripts/theme-paint-check.mts [baseUrl]` — measures that the saved theme is applied before first paint, on a fast and a throttled network

## Keyboard

`/` ask about the whole text · `J`/`K` next/previous paragraph · `Enter` ask about the current paragraph ·
`[` `]` previous/next gloss · `B` gloss this text · `N` notebook · `F` focus · `L` listen ·
`Space` pause/resume · `V` ask by voice · `H` highlight · `U` underline · `?` all keys

## Docs

- [`docs/product-specification.md`](docs/product-specification.md)
- [`docs/reference-routes.md`](docs/reference-routes.md) and [`docs/interaction-inventory.md`](docs/interaction-inventory.md) — what was observed on the reference
- [`docs/design-system.md`](docs/design-system.md) — tokens, type, spacing, components
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/implementation-status.md`](docs/implementation-status.md) — honest per-feature status and test evidence
