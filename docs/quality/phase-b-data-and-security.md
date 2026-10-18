# Phase B: data integrity and security

_Run 2026-10-18 after Phase A (`phase-a-baseline.md`). Basis markers: **I** the integration suite against a real server and PostgreSQL (`docs/quality/integration-testing.md`), **U** unit test, **S** source inspection, **D** read-only database query, **T** command run with its exit code. Nothing was written to Vercel, to the shared development database `gloss`, or to any other project's database._

## 1. Method

A database named `gloss_phaseb_it` was created on the local PostgreSQL 16 for this phase only. The four migrations were applied to it from empty, a production build of the app was served against it, and `tests/integration/ownership.test.ts` drove two readers (separate cookies) plus a cookie-less and a forged-cookie client over HTTP. Tests were written first for the suspected gaps and run before any fix, so each failure below is a real, observed failure.

The local development database `gloss` (451 documents) was **not touched**; its migration ledger was read to compare with the journal.

## 2. Findings

| ID | Sev | Finding | Basis | Status |
| --- | --- | --- | --- | --- |
| R14 | P2 | A mark, a saved question or a reading position could be written against a document that does not exist or that belongs to another reader (no foreign key, no ownership check). Observed before the fix: `POST /api/annotations` by one reader against another reader's document answered 200 (the nonexistent-document case sits in the same test and was reached only after the fix). Nothing of another reader was exposed or changed (reads and updates are scoped to the reader), but orphan rows and a broken invariant. | I (red before the fix) | **Fixed.** `canAttachTo` in `src/lib/server/documents.ts` accepts only a known built-in sample (`sample:<slug>`) or a document the reader owns; the three write routes answer 404 otherwise. No foreign key was added: samples have no row, so a key cannot express the rule. |
| R6 | P2 | API responses carried no `Cache-Control`; the platform filled in `public, max-age=0, must-revalidate`. With a database, bodies depend on the reader's cookie. Observed: header empty locally, `public` on production. | I (red), C | **Fixed.** `next.config.ts` sets `Cache-Control: private, no-store` on `/api/:path*`; verified on the served build. Not yet visible on production (not redeployed). |
| R7 | P2 | No import route had a rate limit; each import fetches another site or parses a file. (The Phase A statement that the data routes were limited was wrong: its count matched Drizzle's `.limit(1)`. Only the AI routes meter, and only when the server key pays.) | S, I | **Fixed.** `limitImports` (60 per ten minutes per client address and per reader, `GLOSS_RATE_IMPORT` to change or `off`) on `import`, `import/file`, `import/page`, `import/text`; unit tests and a live 429 test. The counters are per process, so on several serverless instances this is a speed bump, not a quota. |
| R15 | P2 | **A failed import of pasted text threw the text away.** The paste dialog closed the moment Read was pressed, before the import ran; a refused or failed import (rate limit, text too long, network) left the reader with a toast and an empty page. Found by the new end-to-end test for the import limit (its screenshot showed no dialog). Present in all three places the dialog is used (landing, library Add panel, reader quick add). | E2E (red, screenshot) | **Fixed.** The dialog now stays open until the import succeeds, shows the reason inside it (`role="alert"`) and keeps the text. E2E `a refused import … keeps the text they typed`. The same component serves the other two call sites; only the landing page has its own browser test. |
| (note) | INFO | Cross-reader overwrite of marks and questions by guessing an id is blocked (update restricted to the reader's own row; clash answers 409). Since R14, an id clash on a document the writer does not own answers 404, which also stops revealing that the id exists. | I | Verified |
| (note) | INFO | Slug clash between readers: both keep their own document and a different slug. | I | Verified |
| (note) | INFO | Deleting a document removes its marks, questions and position in one transaction, and only the owner's. | I, S | Verified |
| S1 | P3 | Sessions are stateless signed cookies (90 days). Signing out deletes the cookie but a copied cookie stays valid until it expires; there is no server-side revocation. | S | Open; document, and add a session table only if sign-in is turned on in production |
| S2 | INFO | Google `email_verified` is not checked, but accounts are keyed on `(provider, sub)`, never on email, so an unverified address cannot take over an account. | S | No action |
| S3 | INFO | OAuth: `state` is random and single use (cookie deleted on read, 10 minutes, signed), PKCE `S256`, `next` is restricted to local paths (`//` and `/\` refused), a reader that already belongs to an account is never merged into another, and the merge runs in one transaction. | S | Reviewed; the live flow is **not exercised** (no credentials) |
| R5 | P2 | CSP has no `script-src`. | C, S | Open, scheduled for Phase D |
| R8 | P2 | Minimal logging. | S | Open, Phase D |

## 3. Migration safety

| Migration | Content | Risk |
| --- | --- | --- |
| 0000 | creates `readers`, `documents`, `reading_progress`, `annotations`, `glosses`, `settings`; foreign keys to `readers`; indexes, including a **globally unique** `documents.slug` | create only |
| 0001 | creates `accounts`, unique `(provider, subject)` | create only |
| 0002 | replaces an index with a **unique** index on `accounts.reader_id` | would fail on a database that already holds two accounts for one reader; none can exist, because the application never creates that, but check first if a database ever held data written by other code |
| 0003 | adds nullable `glosses.result jsonb` | additive and backward compatible: the previous application version ignores the column |

- All four apply cleanly to an empty database (`drizzle-kit migrate` exit 0, 7 tables, 4 ledger rows) — **D**.
- The local development database's ledger has 4 entries, equal to the journal — **D** (read-only).
- Production has no `DATABASE_URL`, so **no migration has been applied there** and no environment other than this machine is known to hold this schema.
- Rollout when a production database is provisioned (needs your authorisation): set `DATABASE_URL` in Vercel, run `drizzle-kit migrate` once against it, deploy. Rollback: migrations are not reversible in Drizzle; because 0003 is additive, redeploying the previous application version is compatible with the new schema. Take a database snapshot before the first migration.

## 4. Gates for this phase (final source of the phase)

Run on the final source of the phase (after the import limiter was wired in); `next build` ran after the last change to `src/`.

| Command | Exit | Result |
| --- | --- | --- |
| `npx tsc --noEmit -p .` | 0 | no errors |
| `npx eslint src tests playwright.config.ts` | 0 | no findings (an earlier run exited 1 on `any` in the new integration files; fixed with real types, the rule stays on) |
| `npx vitest run` | 0 on rerun | **44 files, 796 passed.** The first full run exited 1: `parserLimits.test.ts` "near the element cap" took 3263 ms against its 3000 ms bound while the machine was busy; alone and idle it passed 13/13 three times and the full suite then passed. The parser was not changed. The test is **load-sensitive** (measured about 0.7 s idle); the bound was left as it is. |
| `npx playwright test` | 0 | **230 passed** in 7.9 min (desktop, phone and visual projects, dev server, `GLOSS_RATE_IMPORT=off` for the browser suites only) |
| `npx next build` | 0 | built with the import limiter and ownership checks |
| `pnpm audit --prod` | 0 | no known vulnerabilities |
| `pnpm test:integration` against the disposable database | 0, twice in a row | **15 passed**; with no server URL: 15 skipped |

## 5. Not covered

- Google sign-in and the account merge against a real database (no credentials; the planner is unit-tested).
- A database outage in the middle of a request; concurrent writers racing on one row.
- The AI routes (no key).
- Behaviour on production, which still runs the earlier commit with no database.
