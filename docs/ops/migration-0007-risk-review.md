# Migration 0007 (`analytics_events`): risk review and production behaviour (2026-11-02)

**Verdict: low risk and reversible, provided gates G1 and G2 of `docs/ops/neon-staging-runbook.md` hold before the merge.** The migration itself is not the danger; the danger is that merging applies it automatically to a database nobody can currently back up. Nothing in this document was executed against any database.

## 1. What runs, and when

- `drizzle/0007_analytics_events.sql`: one `CREATE TABLE "analytics_events"` (identity `bigint` key, `jsonb` properties) and three `CREATE INDEX` on it. No `ALTER`, no `UPDATE`, no `DELETE`, no foreign key, no extension. `tests/unit/migrations.test.ts` fails if that ever changes.
- It is applied by `scripts/vercel-build.mjs` at the start of a **production** build (`VERCEL_ENV=production` and a `DATABASE_URL`), before `next build`, by `drizzle-kit migrate` with a 180 s timeout. Preview builds skip it. So **merging PR #12 into `main` is what applies 0007**; nothing else does.
- How `drizzle-orm` 0.45.4 migrates (read from `node_modules/drizzle-orm/pg-core/dialect.js`): it reads the newest `created_at` in `drizzle.__drizzle_migrations`, runs every journal entry whose timestamp is **greater**, inside **one transaction**, and records each. There is **no advisory lock** and no per-file check of what exists. The journal timestamp of 0007 is 1793589095932 (2026-11-02 03:11 UTC), later than 0006's.

## 2. What production does at merge, minute by minute

| Step | State | Effect on readers |
| --- | --- | --- |
| Merge to `main` | Vercel starts a production build; the **old deployment keeps serving** | none |
| Migrate step | one transaction: create table, three indexes, one journal row. `CREATE TABLE` locks only the new relation; the indexes are built on an empty table (instant). No existing table is locked | none |
| Migrate fails (privilege, timeout, endpoint waking from sleep, name already taken) | the transaction rolls back; the script exits 1; the build stops; **the old deployment stays live** | none; production is unchanged and a redeploy retries |
| `next build` fails after a good migration | the table exists and is unused; the old deployment stays live | none |
| Promotion | new code serves. `GLOSS_ANALYTICS` is unset, so mode is `off`: the collector answers 204 without touching the database, the sign-in callback records nothing, the browser stops sending after the first 204 | one extra 204 per tab session |

## 3. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Detection |
| --- | --- | --- | --- | --- | --- |
| R1 | The migration fails on the real Neon (role lacks `CREATE`, sleeping endpoint, timeout) | low: the same role created 11 tables and ran 0006 through this path | none (build stops, old deployment stays) | the Neon-branch rehearsal with the production role (G4); the build's 180 s allows a cold start | Vercel build log: "migration failed ... Nothing was deployed" |
| R2 | Two production builds migrate at once (two merges close together) | low | one build fails ("already exists") and the old deployment stays; a redeploy then succeeds because the journal row now exists | gate G3: one production merge at a time | build log of the second build |
| R3 | `analytics_events` already exists (someone created it by hand, or a restored copy) | very low | the migration fails, as R1 | the G1 query `to_regclass('public.analytics_events')` must be NULL | same |
| R4 | A later migration is **silently skipped** because its journal timestamp is older than 0007's (the Mission 06 draft, named `0007_...draft`, if promoted) | medium if promoted carelessly | the migration never runs and nothing says so | renumber to 0008 **and** make its journal `when` greater than 1793589095932; a rehearsal on a branch must show 9 journal rows | the journal row count after the build |
| R5 | Storage growth | low | the cap is 5,000 events a day and retention 120 days, about 200 MB at most against Neon Free's 1 GB; `/api/health` warns at 70% and reports a reason at 85% | analytics stays off until the owner decides | `storage.level` in health |
| R6 | Pooler behaviour (transaction mode) | very low | DDL works through the pooled endpoint; migrations already ran through it on 2026-10-19 and in every production build | rehearse with the pooled **and** the direct string | rehearsal output |
| R7 | The rollback cannot be done because nobody can reach the database | **real today** | the table is inert, so no outage; but there is no way to remove it or restore data | G1 and G2 before merging | n/a |
| R8 | Restore window: Neon Free keeps 6 hours of history | certain | a mistake noticed after 6 hours cannot be undone by Neon | the logical backup of G2 | n/a |
| R9 | A reader-facing regression from the new code, unrelated to the table | low: 1,126 unit tests, 51 integration, 217 browser tests passed on this code | a bad deployment | Vercel instant rollback to the previous deployment; the table can stay | `post-deploy-check.mjs`, health |
| R10 | Analytics switched on by mistake | none by default | personal-data processing without consent | `GLOSS_ANALYTICS` is not set; any other value means `off`; the legal gate is closed | health, `analytics_events` row count stays 0 |
| R11 | The rehearsal is run against **production** by mistake (the production string pasted at the branch prompt) | low | **medium**: it would apply 0007 through the real build step and run its rollback test on production | the script's fail-closed guard (target identified by endpoint id, five explicit inputs, typed confirmation, look-alikes and unreadable input refused, `--guard-only` dry run, a clean environment for the child process), plus runbook gate G6; **residual:** the guard compares against the production endpoint the owner types, so G1 (knowing the real endpoint) must come first | the guard's `Refused` output; Vercel and Neon activity logs |

## 4. Behaviour of the new code if the table is missing or unreadable

The collector inserts with errors swallowed and never throws; the daily-cap counter that cannot be read means nothing is recorded; the registration hook is fire-and-forget. With analytics off none of it runs. So a missing table cannot take a request down (tests cover it).

## 5. Pre-merge checklist (all measurable)

1. G1 identity: at least 4 of 5 fingerprints, none contradicting.
2. G2 backup: restored locally, every table's row count equal to the source.
3. Neon-branch rehearsal, run only after gate G6 of the runbook: 13 PASS lines with the pooled string and 13 with the direct one (`scripts/neon-rehearsal.sh`).
4. `to_regclass('public.analytics_events')` is NULL and `drizzle.__drizzle_migrations` has 7 rows on production.
5. No other production build in flight; the Vercel previous deployment is known so a rollback is one click.
6. The owner has said, in writing, that merging may deploy production.

## 6. Post-merge verification (read-only)

1. The build log shows "migrations applied successfully" and "Database migrations are up to date".
2. `GET /api/health?fresh=1`: `database ok`, `storage.usedMb` within 0.2 MB of the earlier value.
3. In the database: `drizzle.__drizzle_migrations` has 8 rows; `analytics_events` exists with 0 rows and its 3 indexes plus the key.
4. `node scripts/post-deploy-check.mjs` passes (sign-in checks need the real credentials).
5. After a day: still 0 rows in `analytics_events`.

## 7. Rollback

- **Code:** Vercel "Promote" of the previous deployment. The table stays and is inert.
- **Table (only if the owner decides):** in one transaction, `DROP TABLE analytics_events;` and `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793589095932;`. After this, rebuilding the code that contains 0007 would apply it again.
- **Data:** nothing existing is touched, so there is nothing to restore; the G2 backup covers an unforeseen error.
