# Release candidate: library, backup and server hardening

_Branch `release/phase-b`, 2026-10-18. Release notes, gate results, risks, rollback and what is still needed from the owner. Every number is from a command run on this tree (merge commit `ec6d28c`, whose tree is identical to `main` at `c701253`); anything not run is said so._

## 1. What changes for readers

| Change | Where |
| --- | --- |
| Search every saved text and your own notes and highlights from one box; each result opens the text on that passage | `/library` |
| Back up the texts that live only in this browser, with marks, questions and reading positions, to one file; restore it later without ever overwriting what is on the shelf; export all notes as one Markdown file | `/library` Backup panel |
| Importing an address or text that is already saved opens the saved one instead of keeping a second copy; addresses that differ only by tracking parameters count as the same | import everywhere |
| A failed import of pasted text no longer discards the text: the dialog stays open and says why | landing, library, reader quick add |

## 2. What changes under the hood

| Change | Why |
| --- | --- |
| A mark, saved question or reading position can only be stored against a built-in sample or a document the reader owns (404 otherwise) | stops orphan rows and a broken invariant (R14) |
| Every `/api` answer is `Cache-Control: private, no-store` | reader-dependent responses must not sit in a shared cache (R6) |
| Imports are limited to 60 per ten minutes per reader and per address (`GLOSS_RATE_IMPORT`) | each import fetches another site or parses a file (R7) |
| `POST /api/reader`, called once before a visitor's first save | overlapping first requests used to mint several anonymous readers (R16) |
| Address identity no longer treats `ref` and `spm` as tracking | conservative deduplication |
| `tests/integration` (17 tests against a real server and PostgreSQL), `.github/workflows/ci.yml`, `docs/ops/*`, `docs/product/*`, `docs/quality/*` | evidence and operations |

## 3. Gate results (this tree)

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Types | `npx tsc --noEmit -p .` | 0 | no errors |
| Lint | `npx eslint src tests playwright.config.ts` | 0 | no findings |
| Unit | `npx vitest run` | 0 | 44 files, **800 passed** |
| Build | `npx next build` (clean `.next`) | 0 | |
| Integration | `vitest --config vitest.integration.config.ts` against a production build and a disposable PostgreSQL, default limits | 0 | **17 passed** |
| Browser | `npx playwright test` (desktop, phone, visual) on the dev server and a disposable database | **1** | **230 passed, 1 failed:** `ANNOT-13` (dragging a selection inside a highlight). See section 4. |
| Audit | `pnpm audit --prod` | 0 | no known vulnerabilities |
| Developer database | document count before and after the run | | 538 and 538: untouched |

## 4. Known intermittent tests (both reproduced on the code before this work)

| Test | Evidence | Meaning |
| --- | --- | --- |
| `ANNOT-13` "dragging a selection inside an existing highlight keeps that selection" | alone and serial: fails 2 of 10 on this tree and 3 of 10 on the code before Phase B. Failure: the pending selection is the whole highlight instead of the dragged part | a real, user-visible, timing-dependent behaviour: occasionally a drag inside a highlight selects the whole highlight. **Not fixed and not diagnosed.** Passed in four earlier full runs, which is consistent with a failure rate near a quarter |
| `ANNOT-1 (real server)` | failed once in one full dev-server run; fails in some runs under four parallel workers on the dev server, before and after this work; 64 of 64 on a production build both ways | partly a real race (R16, mitigated), partly dev-server load; see `phase-b-data-and-security.md` section 3a |

The browser gate is therefore **not clean**. It is recorded as "230 of 231, one known intermittent failure that predates the release", not as passed.

## 5. Not verified

- The deployed site with a database, a model key or sign-in: none is configured, so none can be observed.
- Google OAuth against a real client; the account merge against a database.
- A screen reader, audible speech, a real microphone, Safari, Firefox, a phone.
- The CI workflow on GitHub (it parses; it has never run).
- Library search speed on a large shelf.
- The browser suite on a production build (181 of 185; `phase-b-data-and-security.md` section 3c).

## 6. Risk of this release

Low for existing readers: no schema change, no data migration, no new required variable. The server-side checks matter only once a database exists; on the live site (local-only mode) they cannot be reached because the routes return before them. Client-side changes are additive (search, backup panel) plus the paste dialog change and one extra `POST /api/reader` before a first save, which answers `{"persisted":false}` without a database and sets no cookie.

Possible regressions to watch after deploy: a reader on a shared office address hitting the import limit (60 per ten minutes); anything that relied on `ref` or `spm` being ignored when comparing addresses.

## 7. Deployment plan

1. Push `release/phase-b` (a normal push, no force). Vercel builds a **preview**.
2. Smoke-test the preview with `vercel curl` (`docs/ops/runbook.md`).
3. If it passes, fast-forward `main` to the release branch and push; Vercel builds production.
4. Verify the production deployment's commit and repeat the smoke test.
5. Record the deployment URL here (section 9).

## 8. Rollback

`vercel rollback understand-13ucxhsjk-menlo6.vercel.app --scope menlo6` returns production to the build of `a13f28a`, the last deployment before this release (not exercised). In git, `git revert -m 1 <merge commit>` and push. There is no database change to undo.

## 9. Deployment record

Filled in during Phase F.

## 10. Needs from the owner (not blocking this release)

| What | Why it matters | What to do | Result |
| --- | --- | --- | --- |
| A production PostgreSQL | without one every reader's library exists only in their own browser (the largest remaining risk, R2) | provision one (for example Vercel Marketplace Postgres), set `DATABASE_URL` in the Vercel dashboard, then run the steps in `docs/ops/configuration.md` | saved libraries survive clearing browser data on the same device |
| `TOGETHER_API_KEY` | every AI feature answers "needs a key"; none has ever run live | set it in the Vercel dashboard (or paste your own key in the app while testing) | the first live validation of summaries, questions and translation |
| `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | only if you want sign-in so a library follows the reader across browsers | register `<APP_URL>/api/auth/google/callback` in Google Cloud, then set the three variables | sign-in becomes available |
| Someone with a screen reader | accessibility is claimed only as far as automated checks go | VoiceOver or NVDA pass over the reader and library | findings in `docs/audit/visual-accessibility-review.md` |
| A decision on the Vercel connector | the Vercel MCP connector is refused for team `menlo6`; read-only work used the CLI | re-authorise the connector to that team if you want it used | |
