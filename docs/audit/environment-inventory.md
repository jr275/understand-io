# Environment inventory — Phase A

_Recorded 2026-10-16/17 (local time, America/Los_Angeles) from the actual checkout. Nothing here is carried over from earlier reports._

## Repository

| Item | Value |
| --- | --- |
| Working directory / git root | `/Users/joaormendes/gloss-reconstruction/gloss` |
| Branch | `main` (no remote configured; `git remote -v` is empty) |
| HEAD at audit start | `e6fd1d7eb55dd619ee3e71b975d2460f535f788b` (2026-10-16 17:58 -0700) — "Blocked-link imports via browser capture, more ways in, Google sign-in (env-gated), read-aloud counter fix" |
| Working tree at audit start | clean (`git status --short --branch` → `## main`, no entries) |
| History | `180dbb6` scaffold → `a693206` foundation → `613d8e3` reader/speech/tests → `9189caa` final audit + rename → `e6fd1d7` |
| Package name | `gloss` (product is branded Understand.io) |
| CI | none (`.github/` absent) |
| Ignored | `.env*` (except `.env.example`), `.next/`, `node_modules`, `playwright-report/`, `test-results/`, `*.tsbuildinfo` |

## Runtime and toolchain

| Tool | Version | How verified |
| --- | --- | --- |
| Node.js | v24.9.0 | `node --version` |
| pnpm | 12.10.1 | `pnpm --version`; `pnpm-lock.yaml` present; `pnpm-workspace.yaml` only sets `allowBuilds` (sharp, unrs-resolver: false) |
| Next.js | 16.4.2 (App Router, Turbopack, `serverExternalPackages: postgres, unpdf`) | `pnpm ls`, `next.config.ts` |
| React / React DOM | 19.3.0 | `pnpm ls` |
| TypeScript | 5.9.3, `strict: true`, `moduleResolution: bundler`, path alias `@/* → src/*` | `tsc --version`, `tsconfig.json` |
| Tailwind CSS | v4 via `@tailwindcss/turbopack` loader rule | `next.config.ts`, `src/app/globals.css` |
| ESLint | 9.39.5 with `eslint-config-next` 16.4.2 (core-web-vitals + typescript); flat config `eslint.config.mjs` | `pnpm lint` |
| Prettier | 3.9.10 + `prettier-plugin-tailwindcss`; script `format` (write only, no check script) | `package.json` |
| Vitest | 5.0.5; `tests/unit/**/*.test.ts`, node environment (jsdom per-file where needed) | `vitest.config.ts` |
| Playwright | 1.64.1; desktop (1440×900 Chrome) + mobile (Pixel 7) projects; `webServer: pnpm dev --port ${PLAYWRIGHT_PORT ?? 3100}` with `reuseExistingServer` | `playwright.config.ts` |
| Drizzle ORM / Kit | 0.45.4 / 0.31.11; schema `src/lib/db/schema.ts`, migrations in `drizzle/` (`0000_bouncy_king_bedlam`, `0001_heavy_the_order`) | `drizzle.config.ts` |
| PostgreSQL client | `postgres` 3.4.9 (postgres.js) | `src/lib/db/client.ts` |
| AI SDK | `ai` 7.0.142 + `@ai-sdk/openai-compatible` 3.0.70 → Together AI (`https://api.together.xyz/v1`) | `src/lib/ai/provider.ts` |
| Parsing | `@mozilla/readability` 0.6.0 + `linkedom` 0.18.13 (HTML), `unpdf` 1.9.0 (PDF), `zod` 4.6.7 (validation) | `pnpm ls` |
| Speech | Browser Web Speech API only (SpeechSynthesis, SpeechRecognition) + MediaRecorder → server Whisper fallback (Together) | `src/lib/speech/*` |
| Browser used for manual verification | Google Chrome 155 (macOS, the user's own browser, driven through the Claude in Chrome extension); Playwright's bundled Chromium for automated runs | `navigator.userAgent` |
| Database engine | PostgreSQL 16.15 (Homebrew), accepting connections on 5432 | `pg_isready`, `select version()` |

### Dependency health

- `pnpm audit --prod`: **no known vulnerabilities**.
- `pnpm outdated`: react/react-dom 19.3.0 → 19.3.1 (patch), @types/node 20 → 26, eslint 9 → 10, typescript 5.9 → 7.0. No upgrade performed: nothing in scope requires it and the brief forbids upgrades without a specific reason.
- Build warning: `Failed to find font override values for font 'Atkinson Hyperlegible Next'` (next/font cannot compute size-adjust fallback metrics for this family; only affects fallback layout shift while the font loads). Tracked as BUILD-1.

## Environment variables (presence only — no values were printed or read into the report)

| Variable | In `.env.local` | Used by | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | present, set | `src/lib/db/client.ts`, `drizzle.config.ts` | Shape `postgres://<host>/gloss`; points at the local Homebrew PostgreSQL (localhost). Verified by connecting. |
| `GLOSS_COOKIE_SECRET` | present, set (64 chars, not the `change-me` default) | `src/lib/server/reader.ts` | Signs reader, session and OAuth-state cookies; `secret()` throws in production if unset/default. |
| `TOGETHER_API_KEY` | present, **empty** | `src/lib/ai/provider.ts` (`resolveKey`) | All model features return 402 `needs-key` unless the reader supplies a key via the `x-gloss-key` header (key panel). |
| `GLOSS_CHAT_MODEL` / `GLOSS_EMBED_MODEL` / `GLOSS_WHISPER_MODEL` | present, set | `provider.ts` | Model ids; defaults exist in code. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **absent** | `src/lib/server/auth.ts` | Sign-in is disabled; the UI explains this. |
| `APP_URL` | absent | `auth.ts` (`appOrigin`) | Falls back to the request origin for the OAuth redirect URI. |
| `NODE_ENV` | runtime | cookie `secure` flag, secret enforcement | — |
| `PLAYWRIGHT_PORT` | runtime | `playwright.config.ts` | Defaults to 3100. |

`.env.example` documents every variable above (values empty or placeholders).

## Database state at audit start

| Table | Rows |
| --- | --- |
| documents | 49 |
| annotations | 25 |
| glosses | 0 |
| readers | 86 |
| reading_progress | 28 |
| accounts | 0 |
| settings | 0 |

Migration ledger `drizzle.__drizzle_migrations`: 2 entries (0000 at 1792188047631, 0001 at 1792198247874) matching `drizzle/meta/_journal.json`. This is a **development database on the developer's machine**; it is also the database the e2e suite writes to (every run adds documents/annotations under throw-away reader cookies). There is no separate disposable test database, so destructive scenarios (table resets, migration rollbacks) were not exercised.

## Development server

| Check | Result |
| --- | --- |
| Start command | `pnpm dev --port 3100` (also `.claude/launch.json` → `gloss-dev`) |
| Already running at audit start | yes — `next-server (v16.4.2)` pid 63496, listening on `*:3100`, **cwd = this folder** (checked with `lsof`); up for 1 h 10 min |
| Serves the app | `GET /` → 200 in 1.5 s (dev, cold route), `<title>Understand.io</title>` |
| Fresh start possible | yes — `pnpm install --frozen-lockfile && pnpm dev --port 3100`; the Playwright `webServer` block starts it the same way when nothing listens on the port |
| Starts without a database | yes by design (`getDb()` returns null → `persisted:false`, local-only mode). Not re-verified in this pass because the database was present; see `IMPLEMENTED, NOT VERIFIED` in the status file. |
| Other processes on the machine | left untouched (another Next server on port 3010 belongs to an unrelated project) |

## Docs and evidence present before this pass

`docs/product-specification.md`, `docs/reference-routes.md`, `docs/interaction-inventory.md`, `docs/design-system.md`, `docs/architecture.md`, `docs/implementation-status.md`, `docs/final-qa-report.md`, `docs/qa/*.png` (implementation vs `ref-*` reference screenshots at 1440×900 and 375×812), `scripts/qa-shots.ts` and `scripts/ref-shots.ts` (screenshot capture).

## Addendum: state at the end of the audit (2026-10-17)

| Item | Value |
| --- | --- |
| HEAD before the closing documentation commits | `acc0df6` on `main`; the audit added about 20 commits after `e6fd1d7` (`git log --oneline e6fd1d7..HEAD`) |
| Migrations | 0000 to 0003 applied; the ledger has 4 entries. `0002_rich_vargas` makes `accounts.reader_id` unique; `0003_confused_colleen_wing` adds the nullable `glosses.result` column. No earlier migration was edited |
| Dependencies added | runtime: `undici` (connect-time address pinning). Dev: `@axe-core/playwright`, `pixelmatch`, `pngjs` and its types (audit tooling) |
| Dependency health | `pnpm audit --prod`: no known vulnerabilities (re-run at the end) |
| Database rows now | 266 documents, 73 annotations, 0 glosses, 529 readers, 104 progress rows, 0 accounts. The growth since the start (49, 25, 0, 86, 28, 0) is test residue from the end-to-end runs; nothing was deleted |
| Tests | 39 unit files, 752 tests; 169 end-to-end runs (167 desktop, 2 mobile) and 46 visual comparisons; all passing (after the visual pass) |
| Environment variables | unchanged: `TOGETHER_API_KEY` still empty, Google variables and `APP_URL` still absent |
| Dev server | `next dev` on port 3100, working directory this folder. Another Next server on port 3010 belongs to an unrelated project and was never touched |
| Real browser | Chrome 155 (macOS) through the Claude in Chrome extension, used for the capture bookmarklet and the read-aloud checks; the in-app browser pane blocks the microphone and was used only for pages |
