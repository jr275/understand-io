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
| R16 | P2 | **A new visitor's first concurrent requests each mint their own anonymous reader.** With no cookie yet, two requests that overlap (a highlight and the reading-position save, for instance) each call `ensureReaderId()`, create a different reader and set a different cookie. The browser keeps the last cookie; what the first request saved is stranded under another reader. The client recovers by re-uploading (it notices the changed reader key), so nothing typed is lost, but the server keeps orphan readers and a deleted highlight can come back. Observed in the dev-server runs of the ANNOT-1 end-to-end test: in the failing runs device A had confirmed its mark under reader `4fc1…` while the cookie it handed to device B named reader `18bb…`. | E2E under parallel load, diagnostic dump | **Mitigated.** `POST /api/reader` (new) settles the cookie, and the client calls it once before its first save (`ensureReader` in `store/library.ts`); idempotent, and without a database it stores nothing and sets no cookie. In the same diagnostic, divergent reader keys went from 9 of 32 runs to 0 of 32. Integration tests fix both halves: two cookie-less writes sent together mint two readers (the cause), and after the bootstrap five concurrent writes land under one reader. **Not eliminated for the import route**, which still mints a cookie itself, and two browser tabs of a brand-new visitor can still race. |
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

## 3a. The ANNOT-1 end-to-end test and what was and was not shown

`annotations.spec.ts` "ANNOT-1 (real server)" (a deleted highlight must not come back from a second device) failed once in a full run and fails in some runs when repeated with four parallel workers against the **dev server**. What the investigation showed, and what it did not:

- It is not caused by the Phase B changes: the code before Phase B fails the same way (3 of 8 runs on the dev server).
- It is not only slowness: raising the wait to 20 s still failed 6 of 16 runs.
- One failure mode is the reader race (R16): in the failing dumps the two devices disagreed about which reader they were. After the bootstrap, that mode did not appear again in 32 diagnostic runs.
- Other failures remained on the dev server after the fix (a confirmation not seen within 8 s; once, two highlights on device A after a removal). These were **not diagnosed**. They occur on the dev server, which compiles routes on demand and slows under four workers.
- **On production builds against a disposable database, 64 of 64 runs passed both with the fix and without it** (the old build was verified to lack `/api/reader`). So the production-build comparison does not by itself prove the fix; the proof of the race is the divergent-keys evidence and the integration tests above.

The test was left unchanged. Treat a single failure of this test in a full dev-server run as a known intermittent; a failure in a production-build run would be new information.

## 3b. The end-to-end suite writes to the developer database

`playwright.config.ts` starts `pnpm dev`, which reads `.env.local`; here that names `postgres://localhost:5432/gloss`, the developer database. Every full end-to-end run therefore adds readers and documents to it (451 → 514 documents and 1,707 readers across this phase's runs). This was true of earlier rounds too; it was not noticed until now. Nothing was deleted from it. Recommendation (Phase D): run the browser suite against a production build and a disposable database, as `PLAYWRIGHT_PORT=3201` with `reuseExistingServer` already allows, and make that the CI default.

## 4. Gates for this phase (final source of the phase)

Run on the final source of the phase (a clean `.next`, then `next build`, then the browser suite).

| Command | Exit | Result |
| --- | --- | --- |
| `npx tsc --noEmit -p .` | 0 | no errors |
| `npx eslint src tests playwright.config.ts` | 0 | no findings (earlier runs exited 1 on `any` in the new integration files; fixed with real types, the rule stays on) |
| `npx vitest run` | 0 | **44 files, 799 passed.** Two earlier full runs exited 1: (1) `parserLimits.test.ts` "near the element cap" took 3263 ms against its 3000 ms bound while the machine was busy (passes idle, 3 of 3; the parser was not changed; load-sensitive, bound left as is); (2) two `library-sync` tests failed after the reader bootstrap was added because the simulated server logged the new request as an extra call; fixed by teaching the simulation about it and adding three tests for the bootstrap's order, uniqueness and retry. |
| `npx next build` | 0 | clean build |
| `npx playwright test` | 0 | **231 passed** in 7.6 min (desktop, phone and visual projects; dev server; `GLOSS_RATE_IMPORT=off` for the browser suites only). An earlier full run of the same source exited 1 on the intermittent ANNOT-1 test described in section 3a. |
| `pnpm audit --prod` | 0 | no known vulnerabilities |
| `pnpm test:integration` against a disposable database | 0, twice in a row | **17 passed**; with no server URL: 17 skipped |

Not re-run after the last edit (a test file only): the build and the browser suite. The unit suite, types and lint were.

## 5. Not covered

- Google sign-in and the account merge against a real database (no credentials; the planner is unit-tested).
- A database outage in the middle of a request; concurrent writers racing on one row.
- The AI routes (no key).
- Behaviour on production, which still runs the earlier commit with no database.
