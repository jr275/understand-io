# Neon staging: rehearsing migration 0007 on an isolated branch (runbook)

**Status:** ready to run; **not run**, because it needs the owner's Neon access, which this environment does not have (`neonctl` 8.13.2 is installed here but has never been signed in: no credential, no `NEON_API_KEY`, no config). Everything that can be done without Neon was done and is in `docs/ops/migration-rehearsal.md` (12 of 12 on an isolated local PostgreSQL in production's state). This runbook is the step that turns "expected to behave the same on Neon" into "verified".

**It never touches production.** A Neon branch is a copy-on-write copy of the parent; creating it does not change the parent, and the script only connects to the branch. It refuses to run if the branch host equals the production host you give it.

## What is needed from you, exactly

| Need | Detail | What it is **not** |
| --- | --- | --- |
| Neon access to create and delete one branch | a user with access to the project in the Neon console (a member who can create branches: project or organisation owner or admin) | no API key is needed if you use the console |
| The staging branch's connection string | Neon console, **Connect**, branch = the staging branch, role = the same role production uses (usually `neondb_owner`), database = the same one; copy the string. The role must be able to create tables and indexes in `public` and to write the `drizzle` schema, as the production role already does for migration 0006 | not production's string, not the Vercel `DATABASE_URL` |
| The host of production's connection string | only the host (for example `ep-cool-name-123456.eu-central-1.aws.neon.tech`), read from the **main** branch's Connect dialog. It is not a secret, and it is what stops the script from running on production by mistake | not its password |
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
   It asks for (1) the branch string, hidden, and (2) production's host. It prints the checks as they run and saves them to `neon-rehearsal-<time>.txt`. Expect **13 lines of PASS**: the 12 checks of the local rehearsal plus a final one that puts the branch back one migration behind.
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
