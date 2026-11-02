# Fase 8: distribution, growth and international scale: implementation report

Branch `feature/growth-distribution` (local, on `main` 57d9a76, **not pushed, no PR, nothing deployed**). Written 2026-11-02.

## What was asked, and what exists

| Brief item | State | Where |
| --- | --- | --- |
| 1. First-party, privacy-conscious analytics, taxonomy, attribution | **Built, tested, off by default** | `docs/product/analytics.md` |
| 1. Free-to-paid, subscription cancellation, extension installation | **Reserved in the taxonomy only**: billing and the extension do not exist | `events.ts` |
| 2. Activation and onboarding | **Measured** (activation, D1/D7/D30/D90 in the report); interface changes **planned, not built** | `docs/product/activation-onboarding.md` |
| 3. Canonical, hreflang, unique metadata, Open Graph, structured data, sitemap, robots | **Built, tested** | `docs/product/seo-landing-pages.md` |
| 3. Seven high-intent pages | **One of seven written (draft, 404 in production)**; one blocked on Pocket import; five to write | same |
| 4. Shared collections and referrals | **Design only** (data model, API, consent, revocation, privacy, acceptance criteria); not built, and not to be launched without the owner | `docs/product/sharing-and-referrals.md` |
| 5. Growth dashboard | **Read-only report script** with every measure that has a data source; the money measures answer "not measurable" because billing and spend inputs do not exist | `scripts/growth-report.mjs` |

The brief's acceptance criteria, honestly: every event has a documented schema (yes); analytics never contain document content (yes, unit and E2E); referral links can be revoked and public collections require consent (**not met: designed, not built**); SEO pages have unique metadata and canonical URLs (yes); growth metrics can be measured independently (yes, from the pure functions and the report); all *new features* have unit and E2E coverage (yes for what was built).

## Technical decisions

1. **Off by default, three modes.** `GLOSS_ANALYTICS=off|daily|full`. Merging changes nothing until the owner sets it. `full` is the only mode that can measure retention and it is personal data (a stable pseudonym), so it is the owner's decision.
2. **Taxonomy as strict schemas.** An event is dropped whole if it carries a property that is not listed; no property of any event is free text. This makes "no document content" a property of the code, not of discipline.
3. **Pseudonyms, not ids.** The actor is an HMAC of the reader id (or a daily hash before there is a reader); the table holds no reader id and no IP.
4. **The server records what a browser cannot be trusted with** (registration; later, payments). Attribution rides through the Google sign-in inside the signed OAuth state.
5. **Honours Do Not Track and Global Privacy Control** in every mode, on the browser and on the server.
6. **Bounded cost.** 5,000 events a day and 120 days of retention by default (about a fifth of Neon Free's storage); when the cap counter cannot be read, nothing is recorded.
7. **Report, not dashboard page.** An unauthenticated route would publish the numbers and no operator login exists.
8. **SEO declares only what is true.** hreflang only for pages that exist in a language; no price or rating in structured data; no invented `lastModified`; drafts are `noindex` even in preview; the library and readers' own texts are never indexable.
9. **Content gating mirrors the legal pages**: a learn page is a 404 in production until the owner publishes it.

## Tests

Run 2026-11-02 on a disposable local PostgreSQL 16 (never the developer database `gloss`, still 538 documents), Node 24.12. Browser tests use the system Chrome (the Playwright browsers are not installed here); **WebKit, Firefox and mobile-safari were not run.**

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | 0 errors, 1 warning (existing, `scripts/post-deploy-check.mjs:50`) |
| Unit suite (`pnpm test`) | 68 files, **1106 tests passed** (the suite had 61 files and 1033 tests on `main`; 7 files, 73 tests are new: events, collector, metrics, database, SEO, routes, learn pages) |
| Integration suite (real PostgreSQL, production build) | 5 files, 51 tests passed |
| `pnpm build` with stand-in secrets and `APP_URL` set, then `scripts/scan-bundle.mjs` | build ok; "Nothing found" in 315 files |
| Browser suite, Chrome, dev server (desktop + mobile) | **217 passed, 0 failed** (14 of them new: `analytics.spec.ts` 7, `seo.spec.ts` 7) |
| `analytics.spec.ts` and `seo.spec.ts` on the production build | 14 passed |
| Production build, by hand | `robots.txt`, `sitemap.xml` (landing and 3 samples only), canonical, hreflang, `og:image`, `noindex` on the library, `/learn/ai-pdf-reader` 404, `/api/events` answers 204 and `off` |
| `GLOSS_ANALYTICS=full` against the database | an event with a forbidden property was stored without it; the pseudonym is in the row, the reader id, the title and the address are not; Do Not Track stored nothing; `growth-report.mjs` read it back |

Two honest notes. A first full browser run had one failure (`annotations.spec.ts` ANNOT-13) while source files were being edited under the dev server; it passed three times alone and in the next two full runs, so it is recorded as interference from hot reload, not a defect, and not as proof it can never flake. `pnpm audit --prod` was not rerun: no dependency was added (`package.json` and the lockfile are unchanged).

Not tested: any of this against production or against Neon (nothing was deployed or connected); analytics in `daily` mode against a database (unit-tested only); the OAuth callback that records a registration (unit-tested through the state and `recordServerEvent`; a real Google sign-in is not possible here).

## Revision after the independent review (2026-11-02)

Three corrections and a full re-validation, all on this branch (no Mission 06 change is in it).

1. **Strict schema.** `ai_question_asked.action` is now a closed list of 19 actions, checked by a test against the actions and summary variants the product defines; `plan` is a closed list (one reserved id until billing exists). Every property of every event is a closed enumeration (a test asserts it for each field). Attribution: the medium must be one of nine known values; `utm_source` and `utm_campaign` are kept only if the operator listed them (`GLOSS_ANALYTICS_SOURCES`, `GLOSS_ANALYTICS_CAMPAIGNS`), otherwise stored as `other`; the referral code is stored only as a keyed hash; the referrer must be a site name (an IP address or a bare word is dropped). New negative tests cover near-miss values (case, spaces, NUL, look-alike letters, SQL, HTML), wrong types, unlisted properties for every event, prototype-named keys, and unlisted attribution. **They found a real defect**: an event named `constructor`, `__proto__` or `toString` made the collector throw (a lookup by name reached the prototype); names are now looked up as own properties only, and a collector-level test fails on the old code.
2. **Privacy classification.** The mode first called `anonymous` is `daily` and is documented as pseudonymisation with its limits (it singles out one browser within a day, it is derived from an IP address, the operator can recompute it with the secret, it relies on the secret and on request logs outside the table). The privacy policy drafts (EN and PT) gained section 3A, the retention drafts section 6, with owner-decision and legal-review markers (the legal gate stays closed); `docs/legal/OPEN_ITEMS.md` is regenerated (25 owner decisions and 19 legal review items, from 22 and 17); `docs/release/UNDERSTAND_FREEMIUM_LAUNCH.md` still quotes the earlier 22 and 17 as a dated snapshot and was not touched to avoid a conflict with Mission 06.
3. **Migration safety.** `drizzle/0007_analytics_events.sql` is one CREATE TABLE and its CREATE INDEXes (a test fails if it ever contains DROP, ALTER, UPDATE, DELETE, INSERT, TRUNCATE, a foreign key or any existing table's name). Rehearsed through the real mechanism (`VERCEL_ENV=production SKIP_NEXT_BUILD=1 node scripts/vercel-build.mjs`) on a disposable database in production's state (migrations through 0006, a row or more in each of the 11 existing tables): counts and content hashes of all 11 tables identical before and after, the new table empty, run twice gives the same result, a preview build skips migrations. With the table missing, with analytics off and with analytics full, documents, reader bootstrap, text import, health, landing and `/api/events` all answered (200 or 204); with analytics off and the table present, 6 event posts wrote 0 rows (also a database test). `package.json`, the lockfile, `vercel.json` and `scripts/vercel-build.mjs` are unchanged against `main`; no environment variable is needed or set. Waits on the database from the collector and from the sign-in callback are bounded (1.5 s), so analytics cannot make signing in wait.

Final validation, on a disposable local PostgreSQL 16 (never the developer database, still 538 documents), Node 24.12:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | 0 errors, 1 existing warning (`scripts/post-deploy-check.mjs:50`) |
| `pnpm test` (unit) | 69 files, **1122 passed** |
| DB-dependent unit files (accountMerge, importErrors, rateLimitShared, aiStoreDatabase, analyticsDatabase) | 5 files, 38 passed |
| `pnpm start --port 3201` then `INTEGRATION_BASE_URL=http://localhost:3201 pnpm test:integration` | 5 files, 51 passed |
| `playwright test --project=desktop --project=mobile` (system Chrome, dev server, fresh start) | **217 passed, 0 failed** |
| `pnpm build` (stand-in secrets, `APP_URL` set) + `node scripts/scan-bundle.mjs` | build exit 0; "Nothing found" in 315 files |
| `seo.spec.ts` + `analytics.spec.ts` on that production build | 14 passed; robots.txt, canonical and `/api/events` `off` re-checked by hand |
| `pnpm audit --prod` | No known vulnerabilities found |

An honest note on the browser run: the first attempt of this round failed from its first test on, because the dev server had fallen into a hot-reload loop (the landing page navigated every few milliseconds: `Compiled in 2ms` over and over) after the production build, the integration server and the migration rehearsal had run beside it. It was environment, not code (a fresh dev server loaded the page with two navigations and the suite then passed 217 of 217). Not run: WebKit, Firefox and mobile-safari on this branch; `GLOSS_ANALYTICS` against Neon or production.

Remaining limitations: the `full` pseudonym links a reader's events across days and is personal data, so its consent wording is the owner's; a script to answer access or deletion requests in `full` mode does not exist; `GLOSS_ANALYTICS_SOURCES` and `_CAMPAIGNS` must be set by the operator before channel names appear (until then every source and campaign is `other`); the referrer host is a site name, which can in rare cases identify a personal site; platform request logs (Vercel) see addresses and are outside this table.

## Commits (branch `feature/growth-distribution`, local)

```
39699d0 Analytics: event taxonomy, attribution, growth metrics (pure, tested)
4e6f75d Analytics: first-party collector (off by default), pseudonymous actors, instrumentation, migration 0007
5a429be SEO layer, first learn page (draft), growth report and product docs
7c53d6c Configuration guide: analytics and learn-preview variables
c52d854 Collector refuses oversized bodies before reading; seo and analytics e2e valid on production builds
```

The branch is cut from `main` 57d9a76. It touches `tests/e2e/seo.spec.ts` with a local copy of `isProductionBuild` that the Mission 06 branch also adds to `tests/e2e/helpers.ts`; merging both is a trivial conflict at worst. The migration `drizzle/0007_analytics_events.sql` is additive and will be applied by the production build when this is merged (the table stays empty while analytics is `off`).

## Privacy implications

- With `off` (the default) the change adds a beacon call per page that the server answers with 204 and stores nothing; the browser then stops sending for that tab.
- With `daily` nothing follows a person from one day to the next and nothing is stored on the device, but **it is pseudonymous, not anonymous**: the identifier is a keyed hash of network address, browser and day, which singles out one browser within a day and which the operator could recompute for a known address and browser (`docs/product/analytics.md`).
- With `full` a reader's actions are linked by a pseudonym and first-touch attribution is kept in `sessionStorage` for the life of the tab. This needs the owner's decision on consent wording, the privacy policy must name it, and it should be added to the legal review list (`docs/legal/OPEN_ITEMS.md`): purpose, retention (120 days), the provider (none: first party), the right to object (Do Not Track and Global Privacy Control are honoured).
- No document text, title, address, note, question, answer or search query is ever recorded, in any mode.

## Remaining owner decisions

1. Analytics mode, consent wording, and the retention and cap defaults (`docs/product/analytics.md`).
2. Whether to approve and publish `/learn/ai-pdf-reader`; the language of the next market; who writes the other pages and checks competitor claims.
3. Whether to build sharing and referrals in this phase; who receives abuse reports; whether a referral reward exists (a financial decision).
4. Billing provider and plans (needed before free-to-paid, churn, LTV/CAC and margin by plan can be measured) and the acquisition spend per channel (needed for CAC).
5. An authenticated admin page for the growth numbers, or keep the script.
6. Connect Search Console after the public domain is chosen.

## What was not done, and why

- Sharing, collections, referral links and their revocation: a design, because they publish reader-chosen content to strangers and a reward is a financial decision.
- Six of the seven landing pages: each needs copy the owner has read, a real screenshot, and for two of them features that do not exist yet (Pocket import, an extension).
- Interface changes for activation (login invitation, sync status): planned; measuring first.
- Nothing was run against production, nothing was deployed, the migration `0007_analytics_events` was applied only to a disposable local database.
