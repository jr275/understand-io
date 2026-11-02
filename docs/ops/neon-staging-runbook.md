# Neon staging: rehearsing migration 0007 on an isolated branch (runbook)

**Status:** ready to run; **not run**, because it needs the owner's Neon access. Everything that can be done without Neon was done and is in `docs/ops/migration-rehearsal.md` (12 of 12 on an isolated local PostgreSQL in production's state). This runbook is the step that turns "expected to behave the same on Neon" into "verified".

**It never touches production.** A Neon branch is a copy-on-write copy of the parent; creating it does not change the parent, and the script only connects to the branch. The script is fail-closed: before any connection its guard (`scripts/lib/rehearsal-guard.mjs`) identifies the target by its endpoint id (not by the host text), refuses production and anything that looks like it, and refuses anything it cannot read; it then stops, having changed nothing, unless the database is exactly one migration behind. Its limit is that it can only compare against the production endpoint you give it, which is why gate G1 comes first.

## Gates: all must hold before step 1 (added 2026-11-02)

The rehearsal copies production's data and is only meaningful if the branch really comes from the production database. As of 2026-11-02 the Neon account that owns that database is not identified (`docs/ops/database-recovery-report.md`), so **the first two gates are not met and the rehearsal must not start**.

| Gate | Condition | How to check (read-only, owner only) | If it fails |
| --- | --- | --- | --- |
| G1. Identity | The project you are about to branch is the one production uses | **Five fingerprints**, from the project's default branch in the Neon SQL editor, using only the `SELECT`s below, compared with `GET /api/health?fresh=1` read in the same minute. Pass when at least four of five match and none contradicts: (1) the endpoint list of the project contains the endpoint named in the private report; (2) `SELECT pg_size_pretty(pg_database_size(current_database()))` is within 0.5 MB of `storage.usedMb` in the health answer (8.3 MB on 2026-11-02); (3) `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'` lists exactly the 11 tables (`accounts`, `ai_leases`, `ai_ledger`, `ai_reservations`, `annotations`, `documents`, `glosses`, `rate_hits`, `reading_progress`, `readers`, `settings`); (4) `SELECT count(*) FROM drizzle.__drizzle_migrations` is 7; (5) `SELECT count(*) FROM accounts` and `SELECT count(*) FROM documents` match what you see signed in and in the library. Also `SELECT to_regclass('public.analytics_events')` must return NULL (0007 not applied yet) | Stop. Wrong account or project; do not branch it |
| G2. Backup | A logical backup of production exists, restores, and is stored privately | From the owner's machine: `read -rs DB` (hidden; use the **direct**, non-pooled string, because a pooler can break `pg_dump`; use a `pg_dump` whose major version is at least the server's, and restore into a local PostgreSQL of the same or a newer major), `pg_dump "$DB" --format=custom --file understand-<date>.dump`, then `pg_restore --list` on it and a full restore into a **disposable local** PostgreSQL, comparing the row count of every table with the source. Keep the dump encrypted outside any repository; it contains readers' data. Neon Free restores only the last 6 hours, so this is the real safety net | Stop. Do not rehearse or merge without it |
| G3. Quiet | No production build or merge is in flight | The Vercel project shows no building production deployment; PR #12 is the only open change that touches `drizzle/` | Wait |
| G4. Same role | The branch will be opened with the role production uses | Role named in the branch's Connect dialog is the one the production string uses (the role cannot be read from Vercel; take it from the project's role list: the one that owns the 11 tables) | Fix the role before running |
| G5. Allowance | The project can hold one more branch and a few compute hours | Branch count below the plan's limit; compute hours left this month | Delete an old branch or wait |
| G6. Right inputs | The five values name the staging branch and production correctly | (a) the Connect dialog's branch selector shows `staging-0007` (it opens on the default branch, so change it); (b) the endpoint id you type for the branch is the one listed for that branch, not the default branch's; (c) production's endpoint id comes from the default branch's endpoint list (G1), not from the clipboard; (d) run `bash scripts/neon-rehearsal.sh --guard-only` first: it must print `Guard passed`, and the masked endpoint it shows (`ep-***-` and four characters) must be the branch's | Do not run; start again from the Connect dialog |

**Abort rules during the rehearsal.** Stop and report if any line says FAIL; if the guard says `Refused`; if the script says it stopped because the database is not exactly one migration behind (it then changed nothing); or if a connection string appears anywhere except the hidden prompt. A stopped rehearsal changes nothing in production.

**Branch hygiene.** Name `staging-0007`; parent = the default branch; data = current data; if the console offers an expiry, set one day. Use the same role as production. Delete the branch within 24 hours of the last run (it holds a copy of readers' data), then confirm in the branch list that it is gone and that the default branch's size and endpoint are unchanged.

## What is needed from you, exactly

| Need | Detail | What it is **not** |
| --- | --- | --- |
| Neon access to create and delete one branch | a user with access to the project in the Neon console (a member who can create branches: project or organisation owner or admin) | no API key is needed if you use the console |
| The staging branch's connection string | Neon console, **Connect**, branch = the staging branch, role = the same role production uses (usually `neondb_owner`), database = the same one; copy the string. The role must be able to create tables and indexes in `public` and to write the `drizzle` schema, as the production role already does for migration 0006 | not production's string, not the Vercel `DATABASE_URL` |
| The endpoint id of production and of the staging branch | only the ids (`ep-<word>-<word>-<8 characters>`), read from the endpoint lists of the **default** branch and of `staging-0007` in the console. They are not secrets; the script compares them so that it cannot run on production by mistake | any password |
| A terminal with this PR's code | a checkout of `feature/growth-distribution` (or the PR branch), Node 24, `pnpm install` done | no Vercel login, no GitHub token, no production credential |

**If you prefer the CLI:** `neonctl auth` signs in through your browser and grants this machine account-level API access; a project-scoped API key is narrower. The console route needs neither and is the recommended one. Either way, the connection string is typed into a **hidden prompt** that this script provides, so it never appears on screen, in your shell history, or in chat. Please do not paste it to me.

**What the branch contains:** a full copy of production's data, including readers' libraries. The script prints counts, hashes and PASS/FAIL, never a row, a name or the connection string. Delete the branch afterwards. Do not run this from a shared machine or a CI job.

**Cost:** a branch shares the parent's storage (only what changes is added); its compute wakes for a few minutes (Neon Free counts compute hours against the same 100 hours a month, and the endpoint suspends after 5 idle minutes). Negligible.

## Steps

1. **Create the branch.** Neon console, the project, **Branches**, **Create branch**. Name: `staging-0007`. Parent: the production (default) branch. Data: **current data**. Leave the compute settings at the default. (CLI equivalent: `neonctl branches create --project-id <id> --name staging-0007`, which defaults to the default branch as parent.)
2. **Copy the branch's connection string.** **Connect**, select `staging-0007`, the production role and database, copy. Neon offers a *pooled* and a *direct* string. You do not know which one production's build uses (the Vercel value is hidden), so **rehearse both**: the script leaves the branch one migration behind so the second run is possible. If you only run one, run the *pooled* one if production's string contains `-pooler` in its host, otherwise the direct one.
3. **Run the rehearsal.**
   ```bash
   cd <checkout of the PR branch>
   pnpm install
   bash scripts/neon-rehearsal.sh
   ```
   It asks for five values: (1) the branch string, hidden; (2) the branch name; (3) the branch's endpoint id; (4) production's endpoint id; (5) the confirmation `<branch>@<endpoint>`. Run `bash scripts/neon-rehearsal.sh --guard-only` first: it checks the five values, makes no connection and touches nothing. It prints the checks as they run and saves them to `neon-rehearsal-<time>.txt`. Expect **13 lines of PASS**: the 12 checks of the local rehearsal plus a final one that puts the branch back one migration behind.
4. **Second run, other kind of string** (step 2): run the same command again with the other string. It must also pass.
5. **Send me only the saved text file's contents** (or just the output). It contains no secret.
6. **Delete the branch** `staging-0007` in the console (CLI: `neonctl branches delete staging-0007 --project-id <id>`).

If any line says FAIL, stop and send me the output; do nothing else, and nothing in production is affected.

## The checks (the same ones as the local rehearsal)

1. The branch is exactly one migration behind (7 of 8 applied, no analytics table), otherwise nothing can be proved.
2. The production build step, `scripts/vercel-build.mjs` with `VERCEL_ENV=production`, succeeds.
3. All 11 existing tables are identical afterwards: row count, a hash of every row's content, column definitions, index definitions and constraints.
4. The only table added is `analytics_events`; none was removed.
5. `analytics_events` is empty.
6. Its indexes are the primary key and the three created.
7. Its columns are the ones in the schema.
8. It has no foreign key to or from any other table.
9. Exactly one migration was recorded.
10. Running the step again changes nothing (idempotent).
11. After the documented rollback (`DROP TABLE analytics_events` and removing its row from `drizzle.__drizzle_migrations`, in one transaction) the database is exactly as before.
12. The migration applies again after the rollback.
13. (extra) The branch is left one migration behind again, as it was found.

Schema, data, indexes and constraints are compared before and after in checks 3, 4, 6, 7, 8 and 11 (a fingerprint of columns, index definitions and constraints per table, plus row counts and content hashes). The script also tells you whether the string was pooled, and waits and retries up to three times for a sleeping Neon endpoint.

## After it passes

Record the output with the PR (verdict B in `docs/release/FASE_8_REPORT.md` then reads "Neon branch rehearsal: passed"). Production still needs your explicit go: merging deploys, and the production build applies 0007 itself. Nothing in this runbook changes that.
