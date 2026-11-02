# Fase 8: distribution, growth and international scale: technical report

Branch `feature/growth-distribution`, draft PR #12, cut from `main` 57d9a76 (still `main`'s head on 2026-11-02). Reconciled on 2026-11-02 against the code of commit `b49a8ea` plus the docs and script of `0c58fb5`; the commit that adds this text follows them (`git log` has the exact head). **Nothing was merged, pushed to `main`, deployed or changed in production, in Neon or in Vercel configuration.**

## Verdicts (three independent approvals)

| | Verdict | Why, in one line |
| --- | --- | --- |
| **A. Ready for merge** | **YES, as code and tests** (CI result in the PR body) | everything built is tested and reviewed; analytics is off by default; migration 0007 is additive and rehearsed. **Merging to `main` also deploys production and applies 0007 to Neon** (the production build runs the migration), so merge and production are one act unless the owner holds the merge |
| **B. Ready for production** | **NOT YET** | the migration has been rehearsed on an isolated local PostgreSQL (12 of 12 checks) but **not on a Neon branch**, which is the owner's 15-minute step (`docs/ops/migration-rehearsal.md`); and a production deploy needs the owner's explicit go. Everything else for B is verified: cookie secret present and usable in production (read-only probe), analytics off by default and safe without the secret, no production configuration needed |
| **C. Ready for analytics activation** | **NO** | blockers: no consent decision and no published privacy policy (the legal pages are still a 404 and carry 25 owner decisions and 19 legal-review items); no access/deletion capability for `full` mode (design only); the merge-time re-keying that makes pre-login history findable does not exist; pseudonyms depend on the cookie secret (a rotation would break them and strand anonymous readers' libraries); sources and campaigns are not listed; retention and cap not approved |

What turns each to YES: **A**: green CI and the owner's decision that merge may deploy. **B**: the Neon-branch rehearsal passes 12 of 12 and the owner authorises the deploy. **C**: `docs/product/analytics-data-subject-requests.md` built and tested (merge re-key first), legal items resolved and the policy published, graceful rotation or a separate analytics key, the owner's mode, lists, retention and cap.

## What exists

| Brief item | State | Where |
| --- | --- | --- |
| 1. First-party analytics, taxonomy, attribution | **Built, tested, off by default** | `docs/product/analytics.md` |
| 1. Free-to-paid, cancellation, extension install | reserved in the taxonomy only (no billing, no extension) | `src/lib/analytics/events.ts` |
| 2. Activation and onboarding | measured (activation, D1/D7/D30/D90 in the report); interface changes **planned, not built** | `docs/product/activation-onboarding.md` |
| 3. Canonical, hreflang, per-route metadata, Open Graph, JSON-LD, sitemap, robots | **Built, tested** | `docs/product/seo-landing-pages.md` |
| 3. Seven high-intent pages | **1 of 7 written, as a draft (404 in production)**; one blocked on Pocket import | same |
| 4. Shared collections and referrals | **design only** | `docs/product/sharing-and-referrals.md` |
| 5. Growth dashboard | read-only report script, every measure that has data; money measures answer "not measurable" (no billing) | `scripts/growth-report.mjs` |
| Access and deletion of analytics records (LGPD) | **design only** | `docs/product/analytics-data-subject-requests.md` |
| Cookie secret and rotation | verified, documented | `docs/ops/secrets-and-rotation.md` |
| Migration rehearsal | script written; run on staging; Neon branch run is the owner's | `docs/ops/migration-rehearsal.md`, `scripts/migration-rehearsal.mjs` |

Brief's acceptance criteria: schemas documented (yes); no sensitive content in analytics (yes, unit and E2E); SEO pages unique with canonical (yes); metrics measurable independently (yes); new features covered by unit and E2E (yes for what is built). **Not met by design:** referral links revocable and public collections requiring consent (specified, not built).

## Test results (one table, the latest run of each)

All on a disposable local PostgreSQL 16 (the developer database stayed at 538 documents), Node 24.12, system Chrome for browser tests.

| Command | Result | Where it ran |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | local |
| `pnpm lint` | 0 errors, 1 warning that exists on `main` (`scripts/post-deploy-check.mjs:50`) | local |
| `pnpm test` (unit) | 69 files, **1126 passed** (`main`: 61 files, 1033; this branch adds 8 files and 93 tests) | local, disposable DB |
| DB-dependent unit files (accountMerge, importErrors, rateLimitShared, aiStoreDatabase, analyticsDatabase) | 5 files, 38 passed (already inside the 1126) | local, disposable DB |
| `pnpm start --port 3201` then `INTEGRATION_BASE_URL=http://localhost:3201 pnpm test:integration` | 5 files, 51 passed | local production build, disposable DB |
| `playwright test --project=desktop --project=mobile` (system Chrome) | **217 passed, 0 failed** (`main`'s suite is 203; 14 are new: 7 in `analytics.spec.ts`, 7 in `seo.spec.ts`) | local dev server, disposable DB |
| `pnpm build` (stand-in secrets, `APP_URL` set) + `node scripts/scan-bundle.mjs` | build exit 0; "Nothing found" in 315 files | local |
| `analytics.spec.ts` + `seo.spec.ts` on the production build | 14 passed | local production build |
| `pnpm audit --prod` | **exit 0, "No known vulnerabilities found"** (run twice this round; `package.json` and the lockfile are unchanged against `main`) | network call to the npm registry |
| `scripts/migration-rehearsal.mjs --rollback-test` | 12 of 12 checks | **staging copy** (isolated local PostgreSQL 16.15 in production's state: 7 migrations, 11 tables with 14 MB of data) |
| Product with analytics off after the migration (landing, library, reader, documents, bootstrap, import, health, `/api/events` 204 `off`, 0 rows) and `scripts/post-deploy-check.mjs` | all answered; post-deploy check 24 passed, 2 skipped, 3 failed for sign-in only (the staging copy has no Google credentials) | **staging copy** |
| Production start without the cookie secret, `GLOSS_ANALYTICS=full` | landing 200, health 200, `/api/events` 204 `off`, 0 rows, no secret in the log; cookie routes 500 by design | staging copy |
| Read-only probes of `https://understand-io.vercel.app` | `/api/documents` with an invalid cookie answered 200 twelve times (the signing key is usable); `/api/events` is 404 (the code is not deployed); no write was made | **production, read-only** |

In the previous round a first attempt of the browser suite failed from its first test because the dev server had fallen into a hot-reload loop, was diagnosed (a fresh server loaded the page normally) and rerun; one earlier full run had one failure (`annotations.spec.ts` ANNOT-13) while source files were being edited under the dev server and passed three times alone and in later full runs.

**Differences between environments, stated plainly.** *Local*: unit, integration and browser tests, a production build. *Staging*: an isolated local PostgreSQL, **not Neon**; proves the migration mechanism, integrity, idempotence, rollback and the product with analytics off, but not Neon's pooler, cold start, server version or timing. *Production*: only read-only probes and Vercel configuration listings (names, never values); no deploy, no migration, no write. Not run anywhere on this branch: WebKit, Firefox, mobile-safari (the Mission 06 branch ran them on its own code), a Neon branch, `GLOSS_ANALYTICS` on any real database other than the disposable ones.

## What changed in the two review rounds

Round 1 (schema, privacy classification, migration): `ai_question_asked.action` and `plan` are closed lists, every property of every event is a closed enumeration; attribution cannot carry names (known mediums only, operator-listed sources and campaigns, referral code hashed, referrer must be a site name); the mode once called `anonymous` is `daily` and is documented as pseudonymisation with its limits; privacy and retention drafts have new sections with markers and `OPEN_ITEMS.md` was regenerated; 0007 is held to "one table and its indexes" by a test; waits on the database are bounded. The negative tests found a real defect (an event named `constructor` or `__proto__` made the collector throw), fixed with a test that fails on the old code.

Round 2 (operations): analytics turns itself **off, without throwing,** when the cookie secret is missing, short or the example value (`effectiveMode`); the rotation impact is documented from the code, including a serious one (a rotation strands anonymous readers' server libraries: see `docs/ops/secrets-and-rotation.md`); the access and deletion design; the Neon-branch rehearsal script, run on the staging copy.

## Dependencies on Mission 06

The Mission 06 branch (`mission-06/production-closure`, not merged, no PR) has six commits: `302569d` (five browser tests valid on a production build), `a3292a0` (AI ledger charges what a failed request used), `6e09ed5` (read-only integrity check and a proposed, unapplied migration), `f69b985` (documentation reconciliation), `81d48be` (Mission 06 report, next-phase architecture, backlog), `370b277` (Firefox/WebKit results).

- **No functional dependency.** PR #12 does not need any of it, and none of it needs PR #12. A read-only merge simulation of the two branches reports **no conflict**; the only file both change is `docs/ops/configuration.md` (a table each edits; it merges cleanly).
- **Production-build browser runs only:** the five tests of `302569d` are not on this branch; on a production build they would still fail here (they assume the dev server). All 217 pass on the dev server.
- **Docs that point across:** `docs/product/seo-landing-pages.md` names feature C of `docs/product/NEXT_PHASE_ARCHITECTURE.md` (Pocket and Instapaper import), which exists only on the Mission 06 branch.
- **A numbering collision to avoid:** Mission 06's proposed guard migration is `docs/ops/proposed-migrations/0007_document_children_guard.sql.draft`. **0007 is now analytics.** If that draft is ever promoted it must be renumbered 0008 (drizzle assigns the number when generated; the draft's name is only a label).
- The two branches duplicate one small E2E helper (`isProductionBuild`); harmless.

## Owner decisions still open

1. **Merge and deploy:** whether merging PR #12 may deploy production (it applies 0007 to Neon), and whether to run the Neon-branch rehearsal first (recommended).
2. **Analytics:** mode (`daily` or `full`), consent wording, who may enable it, retention (120 days) and cap (5,000 a day), the `GLOSS_ANALYTICS_SOURCES` and `_CAMPAIGNS` lists; the 25 owner decisions and 19 legal items in `docs/legal/OPEN_ITEMS.md` (three owner decisions and two legal items of them are new from analytics: 22 and 17 before).
3. **Access and deletion:** confirm the audit retention (5 years proposed), self-service page or operator script at launch, the suppression-list approach, and shipping the merge re-key before `full` is ever enabled.
4. **Cookie secret:** build graceful rotation (`GLOSS_COOKIE_SECRET_PREVIOUS`) and a separate analytics key with key ids, or accept that a rotation strands anonymous readers; keep a copy of the secret in a password manager; decide what the Preview value should be.
5. **Content and growth:** approve and publish `/learn/ai-pdf-reader`; next market and language; who checks competitor claims; whether to build sharing and referrals, who receives abuse reports, whether a reward exists.
6. **Money and tools:** billing provider, plans and acquisition spend (before any money measure exists); an authenticated admin page or keep the script; Search Console after the domain is chosen.

## What was not done, and why

Sharing, collections and referral links (they publish reader-chosen content to strangers; a reward is a financial decision); six of the seven landing pages (each needs copy the owner has read and a real screenshot; two need features that do not exist); activation interface changes (measure first); the access and deletion build (the brief said not to enable `full`, and the design must be approved first); graceful secret rotation (it changes sign-in); a Neon branch (no Neon access from here; the script is ready); anything in production.

## Commits (branch `feature/growth-distribution`, oldest first)

```
39699d0 Analytics: event taxonomy, attribution, growth metrics (pure, tested)
4e6f75d Analytics: first-party collector (off by default), pseudonymous actors, instrumentation, migration 0007
5a429be SEO layer, first learn page (draft), growth report and product docs
7c53d6c Configuration guide: analytics and learn-preview variables
c52d854 Collector refuses oversized bodies before reading; seo and analytics e2e valid on production builds
2efce2d Fase 8 report: test results, commits, notes
a93e11c Analytics: closed enumerations, attribution that cannot carry names, a fix found by the negative tests
70bb01e Analytics: pseudonymisation stated plainly, legal drafts and open items consistent, migration audited
8957d89 Fase 8 report: revision after the independent review
b49a8ea Analytics is off, and nothing throws, when the cookie secret is missing, short or the example value
0c58fb5 Ops and design docs: cookie secret and rotation, data-subject requests (design), migration rehearsal; rehearsal script
```

## Files changed against `main` (at `0c58fb5`)

**63 files: 38 added, 25 modified**: 34 under `src` (analytics, SEO, collector, beacons, routes, small edits to the landing, read, library and legal pages, the Reader, the library search, import, AI call sites, sign-in), 10 tests (8 unit, 2 end-to-end), 14 docs, 3 under `drizzle` (the migration, its snapshot and the journal), 2 scripts (`growth-report.mjs`, `migration-rehearsal.mjs`). `package.json`, `pnpm-lock.yaml`, `vercel.json` and `scripts/vercel-build.mjs` are not among them.
