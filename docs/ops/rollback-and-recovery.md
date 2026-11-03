# Rollback and recovery

## Which commit is live

`GET https://<site>/api/health` returns `commit` (7 characters). Or: Vercel → project → Deployments → the one marked **Production** shows the commit message and hash.

## Roll back a bad deploy

Code and the database schema are independent: every migration so far only **adds** tables or columns, so the previous code runs fine on the newer schema (the new tables are simply unused). Never reverse a migration to roll back.

1. Vercel → project `understand-io` → **Deployments**.
2. Find the last good Production deployment (check its commit message).
3. Open its menu (⋯) → **Promote to Production** (an instant rollback: it only re-points the domain, nothing is rebuilt).
   CLI equivalent: `vercel rollback <deployment-url> --scope menlo6`.
4. Check `GET /api/health`: `commit` is the old one and `status` is `ok` (liveness; `/api/health/ready` with the token for the database); run `node scripts/ai-smoke.mjs https://<site>`.
5. Fix the problem on a branch. **After an instant rollback Vercel may stop assigning new Production builds to the domains automatically**; once the fix is merged, promote it from the Deployments page (or check Settings → Domains) and confirm with `/api/health` that the new commit is live.

A bad **environment variable** is rolled back by setting the old value (Vercel keeps no history for sensitive values, so keep the previous value in your password manager before changing one) and redeploying: Deployments → ⋯ → **Redeploy**.

## What to do when

| Situation | Action |
| --- | --- |
| The site is up but AI answers fail | `/api/health/ready`: `ai-failing`. Check the key and the model (`docs/ops/runbook.md`); no rollback needed |
| The AI is costing more than expected | set `GLOSS_BUDGET_DAILY_USD` lower (or `0` to pause the shared AI) and redeploy; readers' own keys are unaffected |
| A deploy broke reading or import | roll back as above |
| The database is down | `/api/health/ready`: `database-down`. The app keeps working in the reader's browser; the shared AI is paused (fail closed). Check Neon's status and dashboard |
| Data was deleted or corrupted | restore into a **new** Neon branch (below); do not restore over production |

## Database backup and restore

The app makes no backups of its own. Neon keeps history for point-in-time restore; **the window depends on the plan**, so read it in the Neon console (project → Settings → Storage / Restore window) and write it here: ⚠️ [OWNER DECISION: restore window of the current Neon plan, and whether it is enough].

**Restore (never run against production without the owner's approval):**

1. Neon console → the project → **Branches** → **Create branch** → choose "From a past point in time" and the moment before the damage. This creates an independent copy; production is untouched.
2. Connect to the new branch (Connect → copy the connection string) and check the data you need, for example `SELECT count(*) FROM documents;`.
3. To recover a few rows, copy them from the restored branch into production with `INSERT ... SELECT` over a second connection, after review.
4. To switch production to the restored branch (a last resort): set `DATABASE_URL` in Vercel to the new branch's connection string, redeploy, and check `/api/health`. The old branch is kept until you delete it.

**Manual copy (a file you hold), not run automatically:** use `node scripts/db-backup.mjs` and prove it with `node scripts/db-restore-verify.mjs` (`docs/ops/disaster-recovery.md`). It needs the direct host (without `-pooler`) and a `pg_dump` at least as new as the server, refuses otherwise, and writes a checksum and a manifest. Store the files somewhere private: they contain readers' texts and are not encrypted.

## After any incident

Write down what happened, what was done and the commit that fixed it in `docs/audit/defect-backlog.md`.

A rehearsal of a dump, a restore and a targeted recovery of a deleted text, and the steps to repeat it on a Neon branch, are in `docs/ops/restore-rehearsal.md`.
