# Rehearsing migration 0007 (analytics) before it meets production

Written 2026-11-02. **Nothing here touched production or Neon.** The rehearsal below ran on an isolated local PostgreSQL; the same script is what the owner runs on a Neon branch of production, which is the step still open.

## What migration 0007 is

`drizzle/0007_analytics_events.sql`: `CREATE TABLE "analytics_events"` (bigint identity primary key, nine small columns, no foreign key) and three `CREATE INDEX`es on it. No other table, row, column, index or constraint is touched; `tests/unit/migrations.test.ts` fails if the file ever gains DROP, ALTER, UPDATE, DELETE, INSERT, TRUNCATE, a foreign key or an existing table's name.

**When it would run:** the first production build after PR #12 is merged to `main`. `scripts/vercel-build.mjs` runs `drizzle-kit migrate` before `next build` for production builds that have a `DATABASE_URL`; a failing migration fails the build and the previous deployment keeps serving. Preview builds (including the ones on the PR) skip migrations (confirmed: the previews have no `DATABASE_URL`, and the script prints "Skipping database migrations"). So **merging is also the moment the production database receives 0007**; that is why verdict A (merge) and verdict B (production) are separate (`docs/release/FASE_8_REPORT.md`).

## The staging rehearsal that was run

Isolated staging: a new database on local PostgreSQL 16.15, built **in production's state** by applying the repository's own `0000` to `0006` SQL files through drizzle's migrator (7 migrations recorded, no analytics table), then filled with production-shaped data:

| Table | Rows before and after |
| --- | --- |
| readers | 800 |
| accounts | 120 |
| documents | 2,500 |
| annotations | 6,000 |
| glosses | 1,500 |
| reading_progress | 2,500 |
| settings | 300 |
| rate_hits | 400 |
| ai_ledger | 501 |
| ai_reservations | 2 |
| ai_leases | 2 |

(14 MB; the 11 tables are all the tables production has before 0007.) Then, with `scripts/migration-rehearsal.mjs --confirm-not-production --production-host <host> --rollback-test`, which runs the real production step (`scripts/vercel-build.mjs` with `VERCEL_ENV=production`, `SKIP_NEXT_BUILD=1`) and checks the result:

| Check | Result |
| --- | --- |
| The database is exactly one migration behind (7 of 8 applied, no table) | PASS |
| The production build step succeeds | PASS |
| All 11 existing tables identical: row counts, a hash of every row's content, column definitions, index definitions, constraints | PASS |
| The only table added is `analytics_events`; none removed | PASS |
| `analytics_events` is empty | PASS |
| Indexes: the primary key plus `analytics_events_actor_idx`, `_at_idx`, `_event_idx` | PASS |
| Columns: `id, at, event, actor, actor_kind, route, props, channel, campaign, ref` | PASS |
| No foreign key to or from any other table | PASS |
| Exactly one migration recorded (7 to 8) | PASS |
| Running it again changes nothing (idempotent) | PASS |
| Rollback (below) returns the database to exactly its earlier state | PASS |
| The migration applies again after the rollback | PASS |

12 of 12. The script also refuses to run without both `--confirm-not-production` and the production host, refuses the production host itself (checked with `localhost`), and, run on a database that already has 0007, **fails** its first check instead of reporting a meaningless pass (checked).

**The product with analytics off, on that migrated copy** (production build, `GLOSS_ANALYTICS` unset): landing, library, sample reader, document list, reader bootstrap, text import and health answered 200; `/api/events` answered 204 and `off`; `/learn/ai-pdf-reader`, `/privacy` answered 404 as intended; health `ok`, database `ok`, storage 13.9 of 1024 MB; `scripts/post-deploy-check.mjs`: 24 passed, 2 skipped (legal pages not published, as intended), **3 failed, all for sign-in, because the staging copy has no Google credentials** (expected, not a finding); **0 rows** in `analytics_events` after all of it. With the table missing and with the cookie secret missing the product also kept answering (see `docs/ops/secrets-and-rotation.md`).

## What this does not prove (Neon-specific)

The staging is PostgreSQL 16.15 under Homebrew on a Mac, not Neon. Not covered: Neon's pooled endpoint and autosuspend/cold start (the migration step has a 180 s timeout and the site's own health check tolerates a cold start), Neon's exact server version, the copy-on-write branch itself, and timing at Neon's real data size. Reasons it is expected to behave the same: migration 0006 (three tables and an index) was applied to Neon by this same production-build step (`docs/release/BETA_LAUNCH_REPORT.md`, step 3), and production's health now reads and writes those tables (`allowancesShared: true`, the AI ledger counting requests), and 0007 adds a table and indexes, which take no lock on existing tables. Expected is not verified: the Neon branch run below is what verifies it.

## The Neon branch rehearsal (owner action; runbook ready)

The step-by-step procedure, the exact credentials and permissions it needs, and what to send back are in **`docs/ops/neon-staging-runbook.md`**. In short: create a Neon branch of production in the console, run `bash scripts/neon-rehearsal.sh` (it takes the branch's connection string at a hidden prompt, refuses a host equal to production's, runs the same 12 checks plus a final "left one migration behind" check, so 13 PASS lines), run it once more with the other kind of connection string (pooled or direct), send back the saved text (it holds no secret), and delete the branch. It has **not been run**: it needs the owner's Neon console access.

## Operational rollback, written down

| Situation | Action | Data impact |
| --- | --- | --- |
| The migration fails during the production build | nothing to do: the build stops, the previous deployment keeps serving, nothing was deployed | none |
| 0007 applied, new code misbehaves | Vercel: **Instant Rollback** to the previous production deployment (a deployment change the owner makes in the Vercel dashboard). The `analytics_events` table stays, empty and unused; the old code does not know it | none |
| Analytics misbehaves | leave `GLOSS_ANALYTICS` unset (it is unset): nothing is recorded; no deployment needed | none |
| The table must go (owner decision; destructive for whatever was recorded) | in one transaction on the production database: `DROP TABLE analytics_events;` and `DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);` | only analytics rows; rehearsed on the staging copy: afterwards the 11 tables are identical and 0007 applies again cleanly |

drizzle has no down migrations; the second row is the "down". Do the last row only with a Neon branch or restore point taken first, and only if the code that uses the table is no longer deployed.

## Local, staging and production: what has been verified where

| | Local unit and integration | Staging copy (local PostgreSQL) | Neon branch | Production |
| --- | --- | --- | --- | --- |
| Migration SQL content (test) | yes | yes | not run | not run |
| Apply through the real mechanism, 11 tables identical, idempotent, rollback | yes | **yes (12 of 12; 13 of 13 with the helper's extra check, twice in a row)** | **not yet: owner step above** | not run; must not be run before the branch passes |
| Product with analytics off and migration applied | yes (integration, e2e) | yes | not run | not applicable (code not deployed) |
| Cookie secret present and usable | n/a | n/a | n/a | **yes, read-only probe** |
| `/api/events` | yes | yes | not run | 404 (code not deployed), as expected |
