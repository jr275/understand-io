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
| `GLOSS_COOKIE_SECRET` | Signs the reader, session and OAuth-state cookies. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (optional). An account owns one reader id; signing in on another browser swaps that browser's reader cookie to it and merges anything read anonymously there into the account. Needs `DATABASE_URL`. Redirect URI: `<origin>/api/auth/google/callback`. |
| `APP_URL` | Public origin for the OAuth redirect when the app runs behind a proxy (defaults to the request origin). |

Read-aloud uses the browser's own speech engine and needs no key. Voice search uses the browser's
speech recognition where available (Chrome, Edge, Safari) and falls back to server transcription
when a key is configured.

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm typecheck` · `pnpm lint`
- `pnpm test` — Vitest unit tests (anchoring, search, parsing, speech segmentation)
- `pnpm test:e2e` — Playwright (starts `next dev` on port 3100 unless one is running; set `PLAYWRIGHT_PORT`)
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations

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
