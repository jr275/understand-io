# Configuration guide

_Every variable the code reads, taken from `process.env` in `src/`, `next.config.ts`, `drizzle.config.ts` and `playwright.config.ts` (2026-10-18). Secrets are set in the Vercel dashboard (Project → Settings → Environment Variables), never in a chat, a commit or a screenshot. The state of the live project is in `docs/quality/phase-a-baseline.md` section 2._

## Runtime variables

| Variable | Secret | Needed for | Where | If missing | How to check safely |
| --- | --- | --- | --- | --- | --- |
| `GLOSS_COOKIE_SECRET` | yes | signing the anonymous reader cookie, the OAuth state cookie and the session cookie | Production and Preview (set today) | **in production the server throws** where it signs or checks a cookie (it refuses a missing, `change-me` or under-32-character value); outside production a fixed development secret is used | `vercel env ls` shows the name and "Sensitive"; never read the value. Generate with `openssl rand -hex 32`. **Changing it invalidates every existing reader cookie**: with a database, each anonymous reader loses access to their library (the rows stay, but nothing points at them). Rotate only deliberately. |
| `DATABASE_URL` | yes (holds credentials) | saving documents, marks, questions and positions on the server; sign-in | Production and Preview, **not set today** | **local-only mode**: everything stays in the reader's browser; `GET /api/documents` answers `{"documents":[],"persisted":false}` | after setting: `curl -s https://<host>/api/documents` should answer `"persisted":true` |
| `TOGETHER_API_KEY` | yes | AI answers, summaries, translation, semantic search and server transcription paid by the operator | Production, **not set today** | every AI feature answers "needs a key"; a reader can still paste their own key in the app (sent per request, not stored on the server) | `GET /api/gloss` answers `{"serverKey":true,...}` once set; it never reveals the key |
| `GLOSS_CHAT_MODEL` | no | chat model id | optional | defaults to `deepseek-ai/DeepSeek-V3.1` | `GET /api/gloss` shows the model in use |
| `GLOSS_EMBED_MODEL` | no | embeddings for semantic search | optional | defaults to `BAAI/bge-base-en-v1.5` | |
| `GLOSS_WHISPER_MODEL` | no | server transcription | optional | defaults to `openai/whisper-large-v3` | |
| `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE` | no | requests per window and per reader or address **when the server key pays** | optional | defaults 30, 60 and 15; `off` or `0` disables one | |
| `GLOSS_RATE_WINDOW_SEC` | no | the window for the three above | optional | 3600 seconds | |
| `GLOSS_RATE_IMPORT` | no | imports per **ten minutes** per reader or address (links, files, pasted text, captured pages) | optional | 60; `off` or `0` disables it | `POST /api/import/text` answers 429 with `retry-after` past the limit |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the secret is | Google sign-in | optional; needs `DATABASE_URL` and `APP_URL` | the Sign in button explains that sign-in is off; `GET /api/auth/me` answers `{"configured":false,...}` | `GET /api/auth/me` answers `"configured":true` once set. The redirect URI to register in Google Cloud is `<APP_URL>/api/auth/google/callback` |
| `APP_URL` | no | the public origin for the OAuth redirect; also one of the hosts the CSRF check accepts | Production, **not set today** | in production, starting sign-in or its callback answers 503 "APP_URL must be set"; outside production the origin comes from the request | set it to the canonical origin, for example `https://understand-io.vercel.app`, no trailing slash |
| `NODE_ENV` | no | set by Next and Vercel (`production` enables `Secure` cookies, HSTS and the strict secret check) | platform | | |

**Counters are per process.** The three AI limits and the import limit live in one server process's memory. On Vercel each function instance counts separately, so the effective cap is the limit times the number of warm instances. They slow a loop; they are not a spending cap. A hard cap needs a shared store, which does not exist yet.

## Test and tooling variables (not for production)

| Variable | Used by | Note |
| --- | --- | --- |
| `PLAYWRIGHT_PORT` | `playwright.config.ts` | port of the server the browser suite uses (default 3100). With `reuseExistingServer`, a production server already listening there is reused. |
| `INTEGRATION_BASE_URL` | `tests/integration` | address of a server running against a **disposable** database; the suite is skipped without it. See `docs/quality/integration-testing.md`. |
| `DATABASE_URL` | `drizzle-kit` | `drizzle.config.ts` falls back to `postgres://localhost:5432/gloss` when unset, the developer database: always pass it explicitly. |

The browser suite started by `pnpm test:e2e` runs `pnpm dev`, which reads `.env.local`; if that names a real database the suite writes to it (`docs/quality/phase-b-data-and-security.md` section 3b).

## Order to bring up persistence in production

1. Provision a PostgreSQL (Vercel Marketplace Postgres or any managed instance). Needs your decision and possibly a cost.
2. Take a snapshot or backup point if the service offers one.
3. Set `DATABASE_URL` in the Vercel dashboard for Production (and Preview if previews should persist).
4. From a trusted machine, run once: `DATABASE_URL=<that url> npx drizzle-kit migrate`. All four migrations apply from empty (verified on a disposable database); the last (`0003`) only adds a nullable column.
5. Redeploy (or wait for the next deploy) and check `GET /api/documents` answers `"persisted":true`.
6. Optional, in this order: `APP_URL`, then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (register the redirect URI first), then `TOGETHER_API_KEY`.

`bash scripts/set-production-database.sh` does steps 3 to 5 in one go (it asks for the URL at a hidden prompt, checks the connection, applies the migrations, stores `DATABASE_URL` in Vercel for Production and redeploys); `--dry-run` stops before Vercel. Its connection check, migration and error paths were run against a local database; the Vercel steps reuse commands that worked for this project.

Do not run step 4 against a database whose contents matter without reading `docs/quality/phase-b-data-and-security.md` section 3.
