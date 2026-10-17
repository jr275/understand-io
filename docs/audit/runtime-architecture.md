# Runtime architecture (as built)

_Derived from the code at HEAD, not from `docs/architecture.md`, which describes the original plan and is partly out of date (see "Drift from the earlier architecture note" at the end)._

## Processes and boundaries

```
Browser (Chrome/Edge/Safari)                    Next.js 16 server (one Node process)                    External
┌──────────────────────────────┐                ┌──────────────────────────────────────┐
│ React 19 client components   │  fetch /api/*  │ src/proxy.ts  (CSRF + header guard)   │
│  Reader, Library, Landing    │ ─────────────► │ route handlers (src/app/api/**)       │
│ localStorage "gloss:v1"      │                │  lib/server/*  lib/content/*          │── PostgreSQL 16 (Drizzle, postgres.js)
│ Web Speech: SpeechSynthesis  │                │  lib/ai/*  (Together via AI SDK)      │── Together AI (chat, embeddings, Whisper)
│ Web Speech: SpeechRecognition│                │  lib/server/safeFetch (undici, pinned)│── Public web pages for URL import
│ MediaRecorder (fallback)     │                └──────────────────────────────────────┘── Google OAuth (only when configured)
└──────────────────────────────┘
```

- Everything that needs a secret runs in a route handler or server module. No `"use client"` file reads `process.env`.
- Speech synthesis and speech recognition are 100 % browser features. The server never produces audio. The only server audio path is `POST /api/speech/transcribe`, used as a fallback when the browser recogniser is unavailable or blocked.
- There is exactly one server process in development and in `next start`. The rate limiter is therefore an in-memory per-process structure. A multi-instance deployment would need a shared store (open item, see defect backlog).

## Pages and routes

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | page | Landing, import bar (link, paste, file), samples |
| `/library` | page | Shelf of the reader's documents, topic grid, add panel |
| `/read/[slug]` | page | Reader: blocks, lens, margin glosses, rail, notebook, listen bar, voice search |
| `POST /api/import` | route | Fetch a public URL (SSRF-pinned), extract with Readability or PDF parser, save document |
| `POST /api/import/page` | route | Same extraction from HTML captured in the reader's own browser (bookmarklet) |
| `POST /api/import/file` | route | Upload: PDF, text, Markdown; images and binaries refused by content sniffing |
| `POST /api/import/text` | route | Pasted text |
| `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/[id]`, `GET /api/documents/[id]/data` | route | Library CRUD and the per-document annotation/gloss/progress snapshot |
| `GET/POST /api/annotations`, `PATCH/DELETE /api/annotations/[id]` | route | Highlights, underlines, notes (last-write-wins on client `updatedAt`) |
| `GET/POST /api/glosses`, `DELETE /api/glosses/[id]` | route | Saved AI answers |
| `POST /api/gloss` | route | Streamed AI answer. Needs a key (reader's or server's) |
| `POST /api/search` | route | Passage search; BM25 plus optional embedding re-rank. Needs a key only for the re-rank |
| `POST /api/speech/transcribe` | route | Whisper fallback. Needs a key |
| `GET/POST /api/progress` | route | Reading progress |
| `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/signout` | route | Google OAuth (PKCE) when `GOOGLE_CLIENT_ID/SECRET` are set; 503 with an explanation otherwise |

## Identity and data ownership

1. A first visit receives an anonymous **reader** id in an httpOnly, SameSite=Lax, HMAC-signed cookie (`gloss_reader`, 2 years). `GLOSS_COOKIE_SECRET` signs it. In production the secret must be at least 32 characters and `APP_URL` must be set, otherwise the server refuses to sign or build redirect URIs.
2. Every table row carries `reader_id`. Every route filters by the cookie's reader. An id owned by another reader answers 409 (write) or is invisible (read).
3. Optional **account** (Google): `accounts(google_sub, reader_id unique)`. `planSignIn` decides how the cookie's reader and the account relate. A reader owned by an account is never merged or adopted by another account.
4. The browser keeps a mirror in `localStorage` (`gloss:v1`): documents, annotations, glosses, progress, settings. Reading and marking work with no database. When the database is reachable, writes are mirrored to it. The server answers `persisted: false` on read and 503 `database-unavailable` on mutations during an outage, and the client keeps its local copy.

## Persistence

Tables (Drizzle schema in `src/lib/db/schema.ts`): `readers`, `documents` (blocks as jsonb), `reading_progress`, `annotations` (anchor jsonb), `glosses`, `settings`, `accounts`. Migrations `0000_bouncy_king_bedlam`, `0001_heavy_the_order`, `0002_rich_vargas` (unique `accounts.reader_id`) are applied in order. No migration that could already have been applied was edited.

## Import pipeline

```
URL ─► safeFetch (validated address pinned at connect time, ports 80/443, redirects re-checked, size/time caps)
        └► extractArticle (limits: 4 MB, 50 000 elements, depth 200) ─► Readability ─► blocks
File ─► content sniffing (uploadKind) ─► PDF: unpdf, pages one at a time, gap-aware paragraphs (500 pages, 3 M chars, 25 s)
                                      ─► text/markdown ─► blocks
Text ─► blocks
blocks ─► documentFromExtracted ─► saveDocument (DB, or local result with persisted:false)
```
Error hygiene: only `ReadError` and `UnsafeUrlError` messages reach the reader. Anything else becomes a fixed message and is logged by exception name only.

## Read aloud

`SpeechController` (`src/lib/speech/controller.ts`) is one object per reader view. It owns a single list of segments (the passage plus its continuation) and plays them as chunked utterances (at most 220 characters per utterance, highlight stays at sentence level). Every supersede path (stop, skip, restart, new start, error) increments a token and invalidates the old utterance callbacks before calling `cancel()`, then clears a stuck `paused` flag. The React layer subscribes with `useSyncExternalStore`. A watchdog reports a stalled engine. Voice choice follows the text language when the chosen voice does not match. Footnote markers are not spoken, code blocks are skipped.

## Voice search

`VoiceSearch` creates a capture **session** for each listening attempt. A session binds the browser recogniser (or the MediaRecorder fallback) to a token; once the session ends, is replaced or the panel closes, every callback of it is ignored and the microphone is released. Transcript text goes to a pure retrieval pipeline: sentence windows → BM25 (with a Porter stemmer for English and a light Portuguese stemmer) → idf-weighted coverage gives `high | low | none` → optional embedding re-rank that can reorder but never raise confidence. Nothing leaves the browser unless the browser's own recogniser sends audio to its vendor (disclosed in the panel) or the server fallback is used.

## Annotations

An anchor is `{ start:{block,offset}, end:{block,offset}, quote, prefix, suffix, prevBlock?, nextBlock? }`. Resolution is done once per anchor per document version: stored offsets are verified against context; otherwise the quote is searched with NFC and typographic folding and scored by context; a weak or ambiguous result yields an **orphan** that is listed as "Couldn't find this passage" rather than painted. Sync keeps `syncedAt` marks so a deletion elsewhere is not resurrected; tombstones survive until the server confirms; requests per id are chained.

## Security layers

`src/proxy.ts` (Origin / Fetch-Metadata guard for mutating `/api` calls) → route-level body caps and zod validation → per-reader and per-address rate limits on calls that spend the server key → SSRF pinning for outbound fetches → fixed error messages → security headers from `next.config.ts` (nosniff, Referrer-Policy, Permissions-Policy with `microphone=(self)`, `frame-ancestors`/`base-uri`/`form-action` CSP, X-Frame-Options, HSTS in production). See `security-review.md`.

## Configuration surface

| Variable | Effect when absent |
| --- | --- |
| `DATABASE_URL` | local-only mode (`persisted:false`) |
| `GLOSS_COOKIE_SECRET` | dev fallback in development; refuses to run in production |
| `TOGETHER_API_KEY` | model features answer 402 `needs-key` unless the reader supplies a key |
| `GLOSS_CHAT_MODEL`, `GLOSS_EMBED_MODEL`, `GLOSS_WHISPER_MODEL` | built-in defaults |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | sign-in disabled, UI explains it |
| `APP_URL` | request origin in development; required in production |
| `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE`, `GLOSS_RATE_WINDOW_SEC` | built-in limits |

## Drift from the earlier architecture note

`docs/architecture.md` still shows an early `SpeechController` interface (`playFrom/playRange/onSentence`), says search takes `{docId, q}`, lists a `SelectionLens`/`AnnotationLayer` that are now `Lens`/`Block`, and does not mention accounts, the proxy, rate limiting, capture import, or the `/api/documents/[id]/data` snapshot. That file now carries a pointer to this one rather than being rewritten line by line.
