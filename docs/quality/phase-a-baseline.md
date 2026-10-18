# Phase A: baseline and risk assessment

_Run 2026-10-18 (UTC afternoon). **Corrections made later are marked in place** (R7, R9). Read-only: no source was changed to produce this document. Each fact names its basis: **G** git, **V** Vercel CLI (read-only), **C** curl against the live site, **S** source inspection, **T** a command run now with its exit code. Anything not so marked is not claimed._

## 1. Repository and git safety

| Fact | Value | Basis |
| --- | --- | --- |
| Git root | `/Users/joaormendes/gloss-reconstruction/gloss` (the parent folder is not a repository) | G |
| Initial HEAD | `a60813a270198c6571d05dfb55f79526e638caec` on `main` | G |
| Working tree | clean; no stash; one worktree | G |
| Remote | `origin` = `github.com/jr275/understand-io` (single branch `main`) | G |
| `7d490f3`, `a60813a` | both exist, both on `main`, `a60813a` is a docs-only child of `7d490f3` | G |
| Divergence | **local is 2 ahead and 3 behind `origin/main`** (`a13f28a`) | G, after `git fetch` |
| The 3 remote-only commits | merge of PR #2 (`v0/allow-esbuild-builds`) and its two parents; `git diff HEAD...origin/main` is **empty**, so they add no content the local tree lacks and a merge should be clean | G |
| Parent of both histories | `217cf7e` (esbuild build-script decision) | G |
| CI | none: there is no `.github/workflows` | S |
| Ignored but present | `.env.local`, `.vercel/`, `.next/`, `test-results/`; `.env*` is ignored except `.env.example` | S |

Nothing was reset, cleaned, pushed or merged. Integrating `origin/main` (a normal merge, no history rewrite) is a Phase E step.

## 2. Deployment and configuration

| Fact | Value | Basis |
| --- | --- | --- |
| Canonical project | `menlo6/understand-io`, id `prj_SgJkxEHGwUD9bjXABjUo8UIuxniC`, team `menlo6` ("Menlo"), region iad1, Node 24.x | V |
| Which URL is canonical | `understand-io.vercel.app`, `understand-io-menlo6.vercel.app` and `understand-io-git-main-menlo6.vercel.app` are **aliases of one production deployment** | V |
| Current production | `understand-13ucxhsjk-menlo6.vercel.app`, Ready, built from commit **`a13f28a`** (`main`, merge of PR #2) | V (deployment `meta`) |
| What that means | production contains **neither** `7d490f3` nor `a60813a`: library search, backup and restore and duplicate prevention are **not deployed** | G + V |
| Recent history | 7 deployments in ~20 h: 3 failed production builds (before the build-script fix), then Ready | V |
| Access | the Vercel MCP connector is refused for team `menlo6` (403); the Vercel CLI, logged in as `jm-2384`, can read it, so read-only CLI commands were used. Nothing was written to Vercel. | V |
| Environment variables set | **only `GLOSS_COOKIE_SECRET`** (Production and Preview; sensitive, value not read) | V |
| Not set | `DATABASE_URL`, `TOGETHER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` | V |
| Live behaviour that follows | `GET /api/documents` returns `{"documents":[],"persisted":false}`: the live site runs in **local-only mode**; every AI feature answers "needs a key"; Google sign-in is off | C |
| Live status | `/` 200 (1.0 s), `/library` 200 (0.35 s), `/api/documents` 200 | C |
| Response headers | HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer policy, microphone limited to self; **CSP is only** `frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (no `script-src`/`default-src`) | C, S (`next.config.ts:12`) |
| Missing | `/robots.txt` 404 | C |

Variable inventory from `.env.example` (names only): `DATABASE_URL`, `TOGETHER_API_KEY`, `GLOSS_RATE_GLOSS`, `GLOSS_RATE_SEARCH`, `GLOSS_RATE_TRANSCRIBE`, `GLOSS_RATE_WINDOW_SEC`, `GLOSS_CHAT_MODEL`, `GLOSS_EMBED_MODEL`, `GLOSS_WHISPER_MODEL`, `GLOSS_COOKIE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`. The full configuration guide (purpose, secrecy, environments, expected behaviour when missing) is a Phase G deliverable.

## 3. Architecture as built

- **Stack:** Next.js 16 App Router, React 19, strict TypeScript, Tailwind v4, Drizzle on PostgreSQL, AI SDK to Together AI, Vitest, Playwright. About 13,750 lines under `src/`, 63 test files. (S)
- **Routes:** `/`, `/library`, `/read/[slug]`; 20 API route handlers: `ai`, `annotations`, `annotations/[id]`, `auth/google` (+`callback`), `auth/me`, `auth/signout`, `documents`, `documents/[id]`, `documents/[id]/data`, `gloss`, `glosses`, `glosses/[id]`, `import`, `import/file`, `import/page`, `import/text`, `progress`, `search`, `speech/transcribe`. (S)
- **Library modules** (`src/lib/`): `ai`, `anchors`, `client`, `content`, `db`, `search`, `server`, `speech`, `store`. Client state mirrors to `localStorage`; the server is the source of truth only when `DATABASE_URL` is set. (S, `docs/architecture.md`)
- **Tables** (`src/lib/db/schema.ts`): `readers`, `documents`, `reading_progress`, `annotations`, `glosses`, `settings`, `accounts`. Migrations `0000`–`0003` with a Drizzle journal. (S)
- **Identity:** an anonymous reader id in an `httpOnly`, `SameSite=Lax`, production-`Secure` cookie signed with HMAC-SHA256 (compared with `timingSafeEqual`); the server refuses a cookie secret shorter than 32 characters in production. Optional Google sign-in maps an account to a reader. (S)

### Persistence model (what survives what)

| Event | With the **current production** config (no database) | With a database configured |
| --- | --- | --- |
| Refresh, browser restart | kept (browser storage) | kept |
| Browser data cleared | **lost, unless the reader made a backup file** (backup is not deployed) | restored from the server, same cookie only |
| New device or browser | **not available** | only if signed in with Google |
| Logout | local data stays on the device | the account's library follows the account |
| Database outage | n/a | not tested here (see risk R9) |

Backup is a safety copy, not synchronization.

### Ownership boundary (S, route by route)

Every route that reads or mutates private data (`annotations`, `annotations/[id]`, `documents`, `documents/[id]`, `documents/[id]/data`, `glosses`, `glosses/[id]`, `progress`, `import*`) takes the reader from the signed cookie, never from the request body. Reads filter on `readerId`.

- **Cross-reader overwrite is blocked.** Annotation and gloss writes are upserts by a client-supplied primary key, but the update is restricted to rows whose `readerId` matches (`setWhere`) and a clash with another reader's id answers 409 without writing (`annotations/route.ts:19–29`, `glosses/route.ts:19–25`). The 409 does reveal that an id exists; ids are random, so this is negligible.
- **Slug clash:** `documents_slug_idx` is unique across all readers; `saveDocument` picks a new slug on a clash (`documents.ts:96–103`). Untested against a real database.
- **Gap (R14):** `annotations.document_id`, `glosses.document_id` and `reading_progress.document_id` have **no foreign key**, and the write routes **do not check that the document belongs to the reader**. A reader can therefore create rows pointing at a nonexistent document or at another reader's document id. Those rows are owned by, and visible only to, the writer, so nothing of another reader's is exposed or changed; the harm is orphan rows and a broken invariant ("an annotation belongs to a valid document and owner"). Deleting a document does clean up its rows in one transaction (`documents/[id]/route.ts:34–36`).

## 4. Baseline gates (run now, on HEAD `a60813a`)

| Command | Exit | Result |
| --- | --- | --- |
| `npx tsc --noEmit -p .` | 0 | no errors |
| `npx eslint src tests` | 0 | no findings |
| `npx vitest run` | 0 | 43 files, **792 passed** |
| `pnpm audit --prod` | 0 | no known vulnerabilities |
| `npx playwright test` | not re-run in Phase A | **230 passed (exit 0)** an hour earlier on the same source; only documentation and one unit test changed since. It will be re-run in the release candidate. |
| `npx next build` | not re-run in Phase A | exit 0 an hour earlier on the same source; re-run at release |

Not established by these: any behaviour against a real database, a live model, Google, a microphone, a screen reader, or a phone.

## 5. Risk register

Severity is judgement; "basis" says what it rests on. P0 = data loss or a security breach in normal use; P1 = a core journey not working as advertised or a serious abuse path; P2 = wrong or weak in realistic use; P3 = polish.

| ID | P | Risk | Basis | Planned response |
| --- | --- | --- | --- | --- |
| R1 | P1 | **The deployed product lacks the work in `main`**; local and remote histories diverged (2 ahead, 3 behind). | G, V | Integrate by plain merge, re-run gates, deploy only after release gates (Phases E–F). |
| R2 | P0 | **Production has no database**: the library lives only in each browser; clearing site data deletes it, and the backup that would protect it is not deployed. | V, C | Ship backup (R1); a database is a configuration step for you (section 7); document the persistence contract in the interface. |
| R3 | P1 | **Every AI feature is unproven**: no key exists in production or here; mocks do not count. | V | Keep honest "needs a key" states (already tested); live validation when a key is configured. |
| R4 | P1 | **No CI.** Gates depend on a developer running them. | S | Add a GitHub Actions workflow running typecheck, lint, unit, build and audit (no secrets needed). Needs no approval; pushing it does. |
| R5 | P2 | **CSP has no `script-src`/`default-src`**, so it gives no defence against injected script. Mitigant: the only raw-HTML sink is one static constant (`ThemeBoot.tsx:27`); imported content is rendered through React, not as HTML. | C, S | Design a nonce- or hash-based policy (the theme-boot script is inline), test it in the browser, add as report-only first. |
| R6 | P2 | **JSON API responses carry no `Cache-Control: private, no-store`** (`/api/documents` answered `public, max-age=0, must-revalidate`). With a database the body varies by cookie; an intermediary that ignores `max-age=0` could store it. | C, S | Set `private, no-store` on every cookie-dependent route; unit test. |
| R7 | P2 | **No data or import route has a rate limit** (only the AI, search and transcribe routes meter, and only when the server key pays; an earlier version of this row said otherwise because a count matched Drizzle's `.limit(1)`; corrected in Phase B). Imports fetch external pages and parse PDFs, so repeated calls consume server time. SSRF is well covered: DNS-pinned connections, per-hop redirect re-validation, 10 MB and 20 s bounds. | S | Add a bounded limiter to `import*`; reuse `rateLimit.ts`. Note it is per process, so it is a speed bump on Vercel, not a quota. |
| R8 | P2 | **Observability is minimal**: 10 `console` calls, no structured errors, no release-health signal. | S | Add a small structured error logger with redaction and categories; no paid service. |
| R9 | P1 | **Most database behaviour had no test.** (Corrected in Phase B: an earlier version of this row said none existed and that no database was available. Two unit files, `accountMerge.test.ts` and `importErrors.test.ts`, do run against a real PostgreSQL when `DATABASE_URL` is set, and the machine has a local PostgreSQL; they are skipped otherwise, which is why a clean CI run skips 6 tests.) What had no test: ownership across readers, slug clash, cascade delete, migrations from empty. | S, CI log | Phase B on a disposable local PostgreSQL; never the shared one. |
| R10 | P2 | `local:` documents never sync when an account appears (ANNOT-17). | defect backlog | Re-key on sign-in (Phase C), tested with a database. |
| R11 | P3 | Library search timing at scale unmeasured (RETR-10); duplicate normalisation drops `ref`/`spm`. | known-limitations | Measure; make normalisation more conservative. |
| R12 | P2 | No screen-reader pass; audible speech and real microphone capture not human-verified. | docs | Stays "unverified"; a person is needed. |
| R15 | P2 | A failed import of pasted text discarded the text (the paste dialog closed before the import ran). Found in Phase B; fixed there. | E2E | Fixed (Phase B) |
| R13 | P3 | `/robots.txt` missing; the three Vercel aliases all serve the app. | C, V | Decide canonical domain; add a `robots` route. |
| R14 | P2 | Annotations, glosses and progress can reference a document the reader does not own or that does not exist (no foreign key, no ownership check on write). No cross-reader exposure, but orphan rows and a broken invariant. | S | Phase B: verify the document belongs to the reader before writing, in one transaction; add a composite foreign key only through a tested forward migration; integration test. |

## 6. Prioritised plan

1. **Phase B (data and security).** Stand up a disposable PostgreSQL; run migrations 0000–0003 from empty; write integration tests for ownership (a second reader cannot read, change or delete the first reader's document, annotation, gloss or progress), slug clash, cascade deletes and idempotent saves; review OAuth `state` and callback; fix R6 and R7.
2. **Phase C (core stabilisation).** Re-key `local:` documents (R10); conservative URL identity; annotation-anchor failure states; backup round trip across a fresh browser profile; AI-unavailable states.
3. **Phase D (refinement).** Responsive and accessibility fixes found by the checks; measure library search; CSP in report-only mode (R5); structured logging (R8); add CI (R4).
4. **Phase E.** Merge `origin/main`, re-run every gate including the full end-to-end suite and a fresh build, prepare release notes and a rollback plan.
5. **Phase F.** Push and deploy only after the gates pass, then verify the deployed commit and smoke-test it.
6. **One differentiated capability** only after P0 and P1 are clear. The best-founded candidate is carried over from the roadmap: pinning a checked AI result into the notebook, which needs a live model to be worth building (R3), so it is likely to stay on the roadmap this cycle.

## 7. Approval boundaries reached or approaching

| Action | Status |
| --- | --- |
| Write to any Vercel project setting, environment variable or deployment | not done; needed for R2/R3 and requires you |
| Connect to a shared or production database, run production migrations | not done; not needed for Phase B (disposable local database) |
| `git push` of `main` (adds 2 commits and, after the merge, a merge commit) | not done; ordinary push, to be done at Phase F after the gates, unless you say otherwise |
| New paid infrastructure (database host, observability service) | none requested |

**Needs from you, when you are ready (not blocking Phase B):** a production PostgreSQL (for example the Vercel Marketplace Postgres integration) and its `DATABASE_URL`; a `TOGETHER_API_KEY`; `APP_URL`; and, only if you want sign-in, a Google OAuth client. Set them in the Vercel dashboard, never in this conversation.
