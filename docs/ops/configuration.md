# Configuration guide

_Every variable the code reads, taken from `process.env` in `src/`, `next.config.ts`, `drizzle.config.ts` and `playwright.config.ts` (2026-10-18). Secrets are set in the Vercel dashboard (Project → Settings → Environment Variables), never in a chat, a commit or a screenshot. The state of the live project is in `docs/quality/phase-a-baseline.md` section 2._

## Runtime variables

| Variable | Secret | Needed for | Where | If missing | How to check safely |
| --- | --- | --- | --- | --- | --- |
| `GLOSS_COOKIE_SECRET` | yes | signing the anonymous reader cookie, the OAuth state cookie and the session cookie | Production and Preview (set today) | **in production the server throws** where it signs or checks a cookie (it refuses a missing, `change-me` or under-32-character value); outside production a fixed development secret is used | `vercel env ls` shows the name and "Sensitive"; never read the value. Generate with `openssl rand -hex 32`. **Changing it invalidates every existing reader cookie**: with a database, each anonymous reader loses access to their library (the rows stay, but nothing points at them). Rotate only deliberately. |
| `DATABASE_URL` | yes (holds credentials) | saving documents, marks, questions and positions on the server; sign-in | Production and Preview, **not set today** | **local-only mode**: everything stays in the reader's browser; `GET /api/documents` answers `{"documents":[],"persisted":false}` | after setting: `curl -s https://<host>/api/documents` should answer `"persisted":true` |
| `TOGETHER_API_KEY` | yes | AI answers, summaries, translation, semantic search and server transcription paid by the operator | Production, **not set today** | every AI feature answers "needs a key"; a reader can still paste their own key in the app (sent per request, not stored on the server) | `GET /api/gloss` answers `{"serverKey":true,...}` once set; it never reveals the key |
| `GLOSS_CHAT_MODEL` | no | chat model id | optional | defaults to `openai/gpt-oss-120b`. It must be callable **serverless** on the Together account: a model that now needs a dedicated endpoint (DeepSeek-V3.1 did) answers 400 `model_not_available`, and a model that sends prompts to a third party answers `third_party_data_sharing_blocked` when the account forbids that | `GET /api/gloss` shows the model in use; `node scripts/ai-smoke.mjs <url>` runs one real request |
| `GLOSS_REASONING_EFFORT` | no | `low`, `medium` or `high`: asks a reasoning model to think less | optional | unset (a model that does not take the parameter would refuse the request); every output cap already leaves 1200 tokens of room for thinking | |
| `GLOSS_EMBED_MODEL` | no | embeddings for semantic search | optional | defaults to `BAAI/bge-base-en-v1.5` | |
| `GLOSS_WHISPER_MODEL` | no | server transcription | optional | defaults to `openai/whisper-large-v3` | |
| `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE` | no | requests per window and per reader or address **when the server key pays** | optional | defaults 30, 60 and 15; `off` or `0` disables one | |
| `GLOSS_RATE_WINDOW_SEC` | no | the window for the three above | optional | 3600 seconds | |
| `GLOSS_RATE_IMPORT` | no | imports per **ten minutes** per reader or address (links, files, pasted text, captured pages) | optional | 60; `off` or `0` disables it | `POST /api/import/text` answers 429 with `retry-after` past the limit |
| `GLOSS_AI_TIMEOUT_MS` | no | the longest a summary, concepts, questions or translation request may wait for the provider (retries included) | optional | 240000 (the route allows 300 s); past it the reader gets 504 "took too long" | |
| `GLOSS_AI_STREAM_TIMEOUT_MS` | no | the same for a streamed margin answer | optional | 50000 (the route allows 60 s); the answer ends with a plain "took too long" message | |
| `GLOSS_AI_MAX_CONCURRENT` | no | provider calls on the **server key** that one instance runs at once; more get 503 "busy" with `retry-after: 5` | optional | 8; a reader's own key is not counted | |
| `GLOSS_QUOTA_AI_ANON_PER_DAY`, `GLOSS_QUOTA_AI_ANON_IP_PER_DAY`, `GLOSS_QUOTA_AI_ANON_GLOBAL_PER_DAY`, `GLOSS_QUOTA_AI_USER_PER_DAY` | no | AI questions (margin answers and every summary, notes, concepts, quiz and translation) on the **shared key**, per UTC day: per browser and per network address and in total for visitors who are not signed in, and per account for signed-in users | optional | 3, 10, 300 and 20. A zero means none. Counted in the database. A question that failed because the provider failed, or was refused as malformed, is given back | a refused request answers 429 `quota` with the time to come back and the ways forward |
| `GLOSS_QUOTA_SEARCH_*`, `GLOSS_QUOTA_TRANSCRIBE_*` | no | the same four numbers for meaning search and voice transcription on the shared key | optional | search 20, 60, 2000, 100; transcription 5, 15, 200, 30 | 429 `quota` |
| `GLOSS_BUDGET_DAILY_USD`, `GLOSS_BUDGET_MONTHLY_USD` | no | the most the shared key may cost per UTC day and per UTC month. Money is set aside when a request starts and settled when it ends, atomically across instances; at the limit the shared AI is paused for everyone (a reader's own key still works) | optional | **3 and 40, provisional: set them to what you accept to pay.** 0 pauses the shared AI. The cost is an estimate from the price table (or the two price variables below); the hard stop is a spending limit on the provider's own account | 503 `budget`; `GET /api/health` shows `ai.budget` as `low` or `exhausted` |
| `GLOSS_PRICE_IN_PER_M`, `GLOSS_PRICE_OUT_PER_M` | no | the provider's real prices in US dollars per million input and output tokens, so the estimate follows the invoice (both must be set) | optional | a built-in table, approximate for the default model | the cost in the `[usage]` log lines and in the ledger |
| `GLOSS_LEGAL_PUBLISHED` | no | `1` shows `/privacy`, `/terms`, `/legal/*` and the "Privacy · Terms" links, but **only** for texts in `docs/legal` that no longer carry a `⚠️` marker in either language; otherwise they stay a 404 and no link is drawn | optional | unset (hidden). Turn it on only after legal review: see `docs/legal/README.md` | 404 on the legal pages |
| `GLOSS_LEGAL_SET` | no | a subfolder of `docs/legal` to read the texts from (previews and tests, e.g. `test-fixtures`); letters, digits and dashes only | local/preview only | unset | |
| `GLOSS_QUOTAS` | no | `off` lifts the daily allowances **outside production only** (local work and tests); it is ignored in production | local only | unset | |
| `GLOSS_TOGETHER_BASE_URL` | no | the AI provider's API address, to go through a gateway or proxy (or a stand-in under test). Only the operator can set it | optional | `https://api.together.xyz/v1` | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the secret is | Google sign-in | optional; needs `DATABASE_URL` and `APP_URL` | the Sign in button explains that sign-in is off; `GET /api/auth/me` answers `{"configured":false,...}` | `GET /api/auth/me` answers `"configured":true` once set. The redirect URI to register in Google Cloud is `<APP_URL>/api/auth/google/callback` |
| `APP_URL` | no | the public origin for the OAuth redirect; also one of the hosts the CSRF check accepts | Production, **not set today** | in production, starting sign-in or its callback answers 503 "APP_URL must be set"; outside production the origin comes from the request | set it to the canonical origin, for example `https://understand-io.vercel.app`, no trailing slash |
| `NODE_ENV` | no | set by Next and Vercel (`production` enables `Secure` cookies, HSTS and the strict secret check) | platform | | |

**One generation at a time.** Every AI request (on the shared key or a reader's own) holds a lease on the user (the account when signed in; otherwise the browser and the network address) until it finishes; a second request meanwhile is answered 429 `busy-user`. A lease that never reports back expires by itself (the request's deadline plus 30 seconds). Leases, daily counts, reservations and the ledger are in the database (`rate_hits`, `ai_leases`, `ai_reservations`, `ai_ledger`; migrations 0005 and 0006), so they are the same for every instance and survive a restart. **If the database cannot be read, a request on the shared key is refused (503 `unavailable`) rather than spent unmetered**; a reader's own key goes on.

**Where the counters live.** With `DATABASE_URL` set, the AI and import limits count in the `rate_hits` table (migration `0005`), one row per hashed client and fixed window, so the cap holds across every instance (a client can use up to twice the limit across a window boundary). The in-process sliding window still runs first. Without a database, or when the database does not answer within 1.5 seconds, only the in-process window applies and the effective cap is the limit times the number of warm instances; the log says `[rate] shared counter unavailable` (at most once a minute). They slow a loop; they are not a spending cap. The concurrency cap below is per instance for the same reason.

## Test and tooling variables (not for production)

| Variable | Used by | Note |
| --- | --- | --- |
| `PLAYWRIGHT_PORT` | `playwright.config.ts` | port of the server the browser suite uses (default 3100). With `reuseExistingServer`, a production server already listening there is reused. |
| `INTEGRATION_BASE_URL` | `tests/integration` | address of a server running against a **disposable** database; the suite is skipped without it. See `docs/quality/integration-testing.md`. |
| `DATABASE_URL` | `drizzle-kit` | `drizzle.config.ts` falls back to `postgres://localhost:5432/gloss` when unset, the developer database: always pass it explicitly. |

The browser suite started by `pnpm test:e2e` runs `pnpm dev`, which reads `.env.local`; if that names a real database the suite writes to it (`docs/quality/phase-b-data-and-security.md` section 3b).

## How the schema reaches production

`vercel.json` runs `node scripts/vercel-build.mjs` as the build command. On a **Production** build that has a `DATABASE_URL`, it first applies pending migrations (`drizzle-kit migrate`), then runs `next build`. Preview builds and builds without a database skip the migration and only build. The migration's output is printed with the database URL and its password replaced.

- **Order is the safe one.** The schema changes before the new code serves, and every migration so far is additive (a new nullable column and an index), so the deployment still serving traffic keeps working against the new schema.
- **A failed migration stops the build.** Nothing is deployed and the current deployment stays live. Read the build log; the output says it was the migration.
- **Do not start two production builds at once.** Each applies the pending migrations inside one transaction, but two at the same moment can collide on the same statement and one will fail (safely, with nothing deployed). Push once, wait for it to finish, then push again.
- **Migrations must stay additive** (or be rehearsed on a copy first). Dropping or rewriting a column would break the deployment still serving; that needs a separate, reviewed plan.
- The migration uses the same `DATABASE_URL` as the app, which is the pooled connection. That worked for the existing migrations; if a future one needs a direct connection, say so in its review.
- Manual alternative: `bash scripts/set-production-database.sh` applies the migrations from a trusted machine.

## Order to bring up persistence in production

1. Provision a PostgreSQL (Vercel Marketplace Postgres or any managed instance). Needs your decision and possibly a cost.
2. Take a snapshot or backup point if the service offers one.
3. Set `DATABASE_URL` in the Vercel dashboard for Production (and Preview if previews should persist).
4. From a trusted machine, run once: `DATABASE_URL=<that url> npx drizzle-kit migrate`. All four migrations apply from empty (verified on a disposable database); the last (`0003`) only adds a nullable column.
5. Redeploy (or wait for the next deploy) and check `GET /api/documents` answers `"persisted":true`.
6. Optional, in this order: `APP_URL`, then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (register the redirect URI first), then `TOGETHER_API_KEY`.

`bash scripts/set-production-database.sh` does steps 3 to 5 in one go (it asks for the URL at a hidden prompt, checks the connection, applies the migrations, stores `DATABASE_URL` in Vercel for Production and redeploys); `--dry-run` stops before Vercel. Its connection check, migration and error paths were run against a local database; the Vercel steps reuse commands that worked for this project.

Do not run step 4 against a database whose contents matter without reading `docs/quality/phase-b-data-and-security.md` section 3.
