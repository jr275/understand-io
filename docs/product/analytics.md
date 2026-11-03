# Product analytics

First-party, privacy-first, and off until the owner switches it on. Source of truth in code: `src/lib/analytics/events.ts` (the schemas), `src/lib/server/analytics.ts` (the collector), `src/lib/analytics/metrics.ts` (the measures), `scripts/growth-report.mjs` (the report). Tests: `tests/unit/analytics*.test.ts`, `tests/e2e/analytics.spec.ts`.

**Status of every claim below:** implemented and tested locally (unit, a real PostgreSQL, Chromium on a dev server). **Not deployed, not switched on, not tested against production.** `GLOSS_ANALYTICS` defaults to `off`, so merging this changes nothing a reader or the database sees until the owner sets it.

## What it will not do

- It records no text a reader reads or writes: no document title, no address of a saved page, no passage, no note, no question to the model, no answer, no search query. Properties are small enumerations and buckets; an event with a property that is not listed is dropped whole (`parseEvent`), so a call site cannot add text by mistake. `tests/unit/analyticsEvents.test.ts` tries to send each of those and checks they are refused; `tests/e2e/analytics.spec.ts` imports a text with a marker word, searches for it, opens it, and checks that neither the marker nor the title is in anything the browser sent.
- It stores no reader id, no IP address and no User-Agent. The actor is an HMAC of the reader id (a stable pseudonym) or, before there is a reader, a hash of address + browser + UTC day + the server's secret that is different every day. **Both are pseudonyms, not anonymous data** (see "What pseudonymised means here" below).
- It never records a browser that sends Do Not Track or Global Privacy Control, in any mode.
- A browser can only report what a browser can witness. Registration (and, later, subscription events) are recorded by the server; a browser that claims them is ignored.

## Modes (`GLOSS_ANALYTICS`)

| Mode | Stored | What can be measured | Device storage |
| --- | --- | --- | --- |
| `off` (default; also any value that is not `daily` or `full`) | nothing; the endpoint answers 204 and `x-gloss-analytics: off`, and the browser stops sending for that tab | nothing | none |
| `daily` | events against a pseudonym that changes every UTC day | visits and counts per day; **no** retention, WAU/MAU or funnel by person (a day's pseudonym cannot be followed into the next day) | none |
| `full` | events against a stable pseudonym of the reader | everything below | the tab's first-touch attribution in `sessionStorage` (gone when the tab closes) |

(The mode first drafted as `anonymous` is now `daily`: it was never anonymous, and an operator who set the old name now gets `off`.)

### What pseudonymised means here (and what it does not)

Both stable and daily identifiers are **pseudonymisation, not anonymisation**, and the privacy policy says so (section 3A of `docs/legal/privacy-policy.*.md`).

- **Daily.** The identifier is `HMAC(secret, hash(network address | User-Agent | UTC day))`. The address and the User-Agent exist on the request in memory, as for any web request, and are not stored. Limits: (1) within one day it singles out one browser from the others, so a day's events of one visitor are linkable; (2) it is derived from an IP address, which GDPR treats as personal data, so the *processing* is personal-data processing even though the stored value is a keyed hash; (3) whoever holds the server secret (`GLOSS_COOKIE_SECRET`, shared with the cookie signatures) can recompute it for a known address and browser, so it is re-identifiable by the operator and must not be described as "anonymous"; (4) it changes at 00:00 UTC, which is what stops it following a person from one day to the next, and it relies on the secret staying secret and on the browser's address and agent not being stored elsewhere (platform request logs are the operator's, outside this table); (5) browsers behind one network address with the same agent string collapse into one identifier, so counts are slightly low.
- **Full.** The identifier is `HMAC(secret, reader id)`. It is stable for as long as the reader's cookie or account lives (the account keeps its reader id), it links all of one reader's events across days, and it is personal data. Limits: the reader id is not in the table, but the operator can recompute the identifier from a reader id (to answer an access or deletion request, which needs a script that does not exist yet: an owner item); merging an anonymous library into an account changes the reader id, so the history before sign-in is not joined to the account's.
- **Neither** is "opt-out safe" by itself: Do Not Track and Global Privacy Control are honoured, and the owner's consent decision for `full` (below) is separate.

## The taxonomy (12 events)

| Event | Recorded by | Properties (the only ones allowed) | Answers |
| --- | --- | --- | --- |
| `landing_viewed` | browser | none; attribution travels beside it | landing page visits |
| `account_registered` | **server** (sign-in callback) | `method: google` | registration |
| `document_saved` | browser | `kind`, `via` (link, paste, file, page, bookmarklet, extension) | first document saved |
| `document_opened` | browser | `kind`, `via` (landing, library, search, direct), `age` bucket (0d, 1-6d, 7-29d, 30d+) | first document opened; retrieval |
| `highlight_created` | browser | `mark` (highlight, underline, note) | first highlight |
| `ai_question_asked` | browser | `action` (one of 19 listed actions: the nine margin actions, `summarize` with or without one of its six variants, `concepts`, `questions`, `translate`), `key` (shared or own) | first AI question |
| `library_searched` | browser | `scope`, `results` bucket (0, 1-3, 4-10, 11+) | library search |
| `import_completed` | browser | `source`, `outcome` (ok, duplicate, link_only, failed) | import completion |
| `extension_installed` | browser | `browser` | extension installation (reserved; the extension is not built) |
| `subscription_started` | server (reserved) | `plan` (one reserved id, `paid`, until billing defines plans), `interval` | free-to-paid (billing is not built) |
| `subscription_cancelled` | server (reserved) | `plan` (as above), `tenure` bucket | paid churn (billing is not built) |

"First X" is not a flag on an event: it is the earliest such event of a reader (`metrics.ts`), so the taxonomy stays facts only. The route is recorded as a pattern (`/read/:slug`, never the slug).

**Every property is a closed enumeration** (no pattern, no free string): `tests/unit/analyticsEvents.test.ts` checks that for every field of every event and tries values near the list (case, spaces, look-alike letters, NUL, SQL, HTML), wrong types, prototype-named keys and events, and unlisted properties, all refused.

**Acquisition attribution.** `utm_source`, `utm_medium`, `utm_campaign`, a `ref` referral code and the referrer's **host** are parsed in the browser and **re-validated on the server** (`attribution.ts`), because anyone can write anything in a link and a tidy-looking tag can still be a name or a phone number. So: the medium is kept only if it is one of nine known values, the source and the campaign only if the operator listed them (`GLOSS_ANALYTICS_SOURCES`, `GLOSS_ANALYTICS_CAMPAIGNS`, comma separated; with nothing listed every source and campaign is stored as `other`), the referral code (6-24 letters and digits) only as a keyed hash (the code is never stored; the operator joins it to issued codes by hashing them with the same function), and the referrer only if it is a site name (an IP address, a port or a bare word is dropped; the path, query and credentials are always dropped). Anything not tidy at all is discarded. The result rides on `landing_viewed`, and through the Google sign-in (in the signed OAuth state) onto `account_registered`, so a registration is credited to a channel (`channelOf`: `referral`, `source/medium`, `organic-search`, `site:<host>`, `direct`).

## Storage and retention

Table `analytics_events` (migration `drizzle/0007_analytics_events.sql`, additive, three indexes). At about 300 bytes a row with indexes, the default cap of **5,000 events per UTC day** is about 1.5 MB a day, and the default retention of **120 days** (`GLOSS_ANALYTICS_RETENTION_DAYS`) is under 200 MB: a fifth of Neon Free's 1 GB, which is the reason for both defaults. Past the daily cap events are dropped (not queued); when the counter that enforces the cap cannot be read, nothing is recorded, so analytics can never add load to a struggling database. Rows past retention are deleted by the collector now and then (`pruneAnalytics`, tested against PostgreSQL). If the owner needs D90 retention at launch volume, the cap and the plan must be revisited together.

## The measures (`metrics.ts`, run by `scripts/growth-report.mjs`)

| Measure | Definition |
| --- | --- |
| Visitor to registration | registrations / visitor-days (a daily hash cannot be followed, so this is a ratio of counts) |
| Registration to first save | of readers who registered in the period, the share that have saved a text by its end |
| First save to first retrieval | of readers whose first save fell in the period, the share with a retrieval after it |
| WAU / MAU | distinct readers with an *active* event (save, open, mark, AI question, library search) in the last 7 / 30 days; stickiness = WAU/MAU |
| Weekly Knowledge Retrieval Rate | of readers active in a week, the share who came back for something kept: opened a text saved at least a day before (not from the landing page), or ran a library search that found something |
| Saves / AI questions per active user | counts in the period / active readers in it |
| D1 / D7 / D30 / D90 retention | of readers first seen at least N days ago, the share active exactly N days later; cohorts too young for N are left out, never counted as lost |
| Activation | share of readers whose first active event came within 24 hours of first being seen |
| Visits and registrations by channel | per `channelOf` |

Every ratio answers **unknown (n/a), not zero,** when its denominator is zero.

**Not measurable until billing exists** (`paidMetrics` is implemented and unit-tested on synthetic subscriptions, but has no data source): free-to-paid conversion, monthly paid churn, CAC by channel (also needs the owner's acquisition spend per channel), LTV/CAC, gross margin by plan (revenue per plan from billing, AI cost per plan from the ledger, payment fees). The report lists them as "not measurable" rather than printing zeros.

```bash
DATABASE_URL=<neon url> node scripts/growth-report.mjs 30          # text
DATABASE_URL=<neon url> node scripts/growth-report.mjs 30 --json   # JSON
```

The report is a read-only script like `spend-report.mjs`, not a web page: a dashboard route would need an operator login that does not exist yet, and an unauthenticated one would publish the numbers.

## Migration safety (audited)

`drizzle/0007_analytics_events.sql` is three statements: `CREATE TABLE "analytics_events"` and two `CREATE INDEX`es on it. It does not drop, alter, update, delete or insert anything, and no existing table is touched; `tests/unit/migrations.test.ts` fails if it ever does. It is applied by `scripts/vercel-build.mjs` (production builds only, with a database, before `next build`; a failing migration stops the build and the current deployment stays live). The rehearsal and the evidence are in `docs/release/FASE_8_REPORT.md`. **Rollback:** nothing needs rolling back while analytics is off (the table stays empty and unused); if the code is reverted the table is inert, and removing it is `DROP TABLE analytics_events;` plus deleting its row from `drizzle.__drizzle_migrations`, which is an owner decision because it is destructive for whatever has been recorded.

## Owner decisions

1. Which mode, and the consent wording if `full` (above); the sources and campaigns to list in `GLOSS_ANALYTICS_SOURCES` / `GLOSS_ANALYTICS_CAMPAIGNS`; a script to answer access and deletion requests for `full` mode.
2. Whether the daily cap and the retention defaults suit the plan (above).
3. Whether to build an authenticated admin page (needs an operator allow-list, e.g. `GLOSS_ADMIN_EMAILS`) or keep the script.
4. Plans, prices and the billing provider, before any of the money measures exist.
