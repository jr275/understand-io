# Disaster recovery: backup, independent restore, integrity, objectives and scenarios

> **Status, 2026-11-03.** The tooling is verified on disposable PostgreSQL 16 and 18 (below). **No backup of the production database exists, and no restore on Neon has ever been done.** Nothing in this document claims that a real production restore has been validated. What is measured is stated as measured; everything else is an assumption, labelled.

Related: `docs/ops/rollback-and-recovery.md` (code rollback, Neon branch restore steps), `docs/ops/restore-rehearsal.md` (the earlier rehearsal), `docs/ops/database-roles.md` (roles), `docs/ops/neon-free-operations.md` (plan limits).

## 1. What there is to recover, and from what

| Asset | Where it lives | Backed up how | Recoverable from |
| --- | --- | --- | --- |
| Readers' texts, marks, notes, settings, accounts, AI ledger | the Neon database (about 8 MB at the last reading) | Neon history (**Free: 6 hours**, from the repository's own notes; the project's real plan and window are **unconfirmed**) and, once made, a logical backup file | the file, or a Neon branch from a past time |
| The code | GitHub (`main`, PRs) | every clone; the private repository holds bundles of unpublished branches | any clone |
| The deployments | Vercel (3 projects; one serves production) | each deployment is kept; Instant Rollback | the previous deployment |
| Environment variables | Vercel (Sensitive values cannot be read back) | **the owner's password manager must hold every value** (names are in the private inventory) | the vault |
| The Neon login and organisation | Neon | none | Neon support, with proof of identity (see S6) |

The short-lived tables (`rate_hits`, `ai_leases`, `ai_reservations`) are not backed up by design: their schema is, their rows are counters and locks that must not be revived.

## 2. Who does what

Today **one person holds every role**. That is the first disaster scenario (S6), not an assignment.

| Duty | Owner now | Needed |
| --- | --- | --- |
| Takes and stores backups | the owner | a named backup operator (can be the same person) and a second person who knows where they are |
| Runs the independent restore drill | the owner | someone other than the person who took the backup, once a quarter |
| Approves anything that touches production data (restore over, repoint `DATABASE_URL`, rotate, migrate) | the owner | stays with the owner; recorded in writing |
| Neon organisation owner | one login, no MFA requirement | a second owner and 2FA or a passkey |
| Vercel and GitHub owner | one login | a second owner on each |

## 3. Objectives (assumptions, not promises)

**RPO, what can be lost.**

| Situation | RPO | Basis |
| --- | --- | --- |
| A mistake noticed within the Neon history window | the moment before the mistake | Neon branch from a past time. **Window assumed 6 hours on Free; to be read from the console** |
| A mistake older than that, or loss of the Neon project | **the age of the newest good backup file**: up to 7 days if weekly, up to 24 hours if daily, 0 for a change made right after a backup | file backups. **Today there is no file: RPO is unbounded for anything older than the window** |
| Loss of the Neon account | as above, only if the files are outside Neon (they must be) | |

Recommended until the beta ends: **a backup before every migration or risky change, and daily** (the database is small). A reader's own backup file (the app's Backup) is a further, per-reader copy, not a substitute.

**RTO, how long to be serving again.**

| Step | Time | Status |
| --- | --- | --- |
| Restore a backup into an empty local database and prove it | **measured: 1.4 s restore, 4 s with the full verification, for a 71 MB database of 162,000 rows** on a local disk, PostgreSQL 18. A 1 GB database is about 14 times that if it scales linearly: **extrapolated, not measured** | VERIFIED (local), NOT TESTED (Neon) |
| The same against a Neon branch | network bound; **assumption: minutes for the sizes expected in the beta** | NOT TESTED |
| Create a Neon branch from a past time | **assumption: under a few minutes** | NOT TESTED |
| Repoint `DATABASE_URL` and redeploy the same commit | **assumption: 5 to 10 minutes** (a Vercel build) | NOT TESTED in this form |
| **Getting access**: finding the Neon login, or Neon support re-verifying an owner | **days, and not under the project's control** | BLOCKED today (gate 1) |

So for a data-loss incident with access, the **RTO assumption is under one hour** (restore, verify, targeted copy or repoint). Without access it is not bounded. Access, not tooling, is the binding constraint.

## 4. Taking a backup (production)

Preconditions: the owner can open the Neon project (gate 1); `df -h` shows 4 GiB free or more; PostgreSQL client tools of **the server's version or newer** are installed (the tool refuses an older `pg_dump` and says what to install: macOS `brew install postgresql@18`).

1. In the Neon console copy the **direct** connection string (Pooled connection **off**, no `-pooler` in the host) of a login that can read every table: the migration role, the owner, or a member of `pg_read_all_data`. **Not the runtime role** (it has no access to the `drizzle` schema by design). Do not paste it anywhere.
2. From a clean shell, with the password kept out of the history (give the URL without the password and let the tool ask):

   ```bash
   BACKUP_DATABASE_URL='postgres://<login>@<direct host>/<database>?sslmode=require' node scripts/db-backup.mjs --out ~/backups/understand --prompt-password
   ```

   It prints the file, its size and SHA-256. It never prints the connection string or the password. It writes three files at mode 0600: `understand-<UTC time>.dump`, `.sha256`, `.manifest.json` (keep the three together).
3. It has already checked, and stopped with its own exit code if not: no connection string (2), client older than the server (3), pooled endpoint (4), unreachable (5), `pg_dump` failed or the file lacks a table's data (6). Nothing partial is left behind.
4. The manifest holds counts and content digests of every table, indexes, constraints, sequences and column definitions, taken **in the same snapshot as the dump** (a database being written to during the backup is still consistent: tested).
5. **Prove it at once** (section 5). A backup that has not been restored is a hope, not a backup.
6. Store the three files **outside Neon and outside this machine**: the password manager's attachment vault, or an encrypted volume, plus one offline copy. The file is **not encrypted** and holds every reader's text. Suggested retention: 7 daily, 4 weekly, 3 monthly; delete the rest, and honour a deletion request by writing down when the last backup that held the data expires.
7. Never commit a backup. `.gitignore` covers dumps; do not rely on it.

## 5. Independent restore and integrity verification

*Independent* means the restore needs only the three files: no production credential, not the machine that took the backup if possible, and an **empty, new** database on a server of at least the source's major version.

```bash
# a disposable local server, never the production host (macOS example)
/opt/homebrew/opt/postgresql@18/bin/initdb -D /tmp/restore-drill -U drill -A trust
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/restore-drill -o "-p 55500 -c listen_addresses=127.0.0.1" -l /tmp/restore-drill.log -w start
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55500 -U drill restored
TARGET_DATABASE_URL='postgres://drill@127.0.0.1:55500/restored' node scripts/db-restore-verify.mjs ~/backups/understand/understand-<time>.dump
```

What it does, in order, and the exit code if it stops: checksum of the dump against both the `.sha256` and the manifest (7); the target is not the database the backup came from (8), is not a pooled endpoint (4), is empty (8) and is not older than the source (3); then a **single-transaction** restore (all or nothing); then the comparison with the manifest: row counts and content digests of every table, indexes, constraints, sequences, column definitions and extensions (7, listing up to 20 differences). Exit 0 prints each check as `PASS` and says the copy is identical in everything compared.

What it does **not** prove: that the application works on the restored copy (run `node scripts/db-integrity-check.mjs` against it, and start the app on it), roles and grants (the dump has none by design: re-apply `scripts/sql/db-roles.sql` to a restored database before using it), table contents beyond the text digest, and anything about Neon itself.

When the restore passes, **stop the local server and delete the restored copy**: it holds readers' texts.

## 6. Recovery scenarios

Each row is a decision, not a script to run blind. Anything marked **(owner approval)** changes production and needs the owner's written yes at the time.

| # | Scenario | First move | Steps | RPO / RTO (assumed) | Verify |
| --- | --- | --- | --- | --- | --- |
| S1 | Rows deleted or corrupted, noticed within the Neon window | stop the cause (rollback the deployment if code); do not write more | Neon branch from the moment before; compare counts; copy the rows back with `INSERT ... ON CONFLICT DO NOTHING` **(owner approval)**; delete the branch. `annotations` has no foreign key to `documents`: recover texts first, then marks | RPO: moment before the error. RTO: under an hour | counts and a sample of texts equal the branch |
| S2 | The same, older than the window | stop the cause | newest good backup into a new empty database (section 5); copy the missing rows across **(owner approval)** | RPO: backup age. RTO: under an hour | counts, digests of the restored copy; spot-check texts with their reader |
| S3 | A bad migration | do not reverse it; migrations are additive | roll the code back (Vercel Instant Rollback); a new table (for example `analytics_events`) can stay unused; drop only by an owner-approved SQL after a backup | RPO: none. RTO: minutes | `/api/health`, then readiness |
| S4 | Database credential exposed or suspected | rotate | `docs/ops/database-roles.md` (next runtime role, switch, drop the old) **(owner approval)**; check the Neon connection list; take a backup first | RPO: none. RTO: under an hour | readiness `database ok`; old role cannot connect |
| S5 | The Neon project is deleted | stop and contact Neon the same day | the CLI and API can recover a deleted project for a limited time (the earlier recovery report says 7 days: **unconfirmed**); otherwise restore the newest file into a new project and repoint **(owner approval)** | RPO: until the delete, or backup age. RTO: hours | as S2, then readiness |
| S6 | **Nobody can sign in to the Neon account (the situation today)** | stop changing anything that depends on the console | find the login (every address used on 2026-10-18/19 and 2026-10-27); contact Neon support with proof of ownership; **meanwhile the application keeps running on its existing credential** | RPO: whatever the files hold: none exist. RTO: unbounded | access regained; then take the first backup before anything else |
| S7 | Neon (or the region) is down | wait for the status page; do not restore on a guess | if the outage outlasts the tolerance, restore the newest file into another PostgreSQL (another Neon region or provider, version at least the source's), re-apply the roles, repoint `DATABASE_URL` and redeploy **(owner approval)** | RPO: backup age. RTO: assumed 1 to 2 hours | readiness, post-deploy check |
| S8 | Compute allowance used up, or storage full | not a recovery: upgrade or free space | `docs/ops/neon-free-operations.md` | RPO: none | readiness |
| S9 | A bad deployment | Instant Rollback to the last good deployment | `docs/ops/rollback-and-recovery.md`; then fix on a branch | RTO: minutes | `/api/health` commit |
| S10 | The Vercel project is lost or its variables are wiped | restore from the vault | recreate the project from the repository, set every variable from the vault (Sensitive values cannot be read back, so the vault is the only source), redeploy | RTO: about an hour | post-deploy check |
| S11 | The repository is lost | any clone | push the newest clone; the private repository's bundles hold unpublished branches | RTO: minutes | `git log` |
| S12 | The backup file will not restore | the verification found it | use the previous generation; take a new backup now; find why (version, truncated copy, wrong tool) | RPO: one more generation | section 5 on the new file |
| S13 | Someone with owner access destroys data on purpose | revoke their access first | backups outside the Neon account are the only protection: restore as S2 | RPO: backup age | as S2 |

## 7. Rollback and recovery ownership

| Decision | Who decides | Who executes | Recorded where |
| --- | --- | --- | --- |
| Roll a deployment back | the owner (any maintainer in a P1) | whoever has Vercel access | the PR or the incident note |
| Restore from a Neon branch or a file into a **new** database | the owner | the backup operator | the incident note |
| Copy rows into production, restore over production, repoint `DATABASE_URL` | **the owner, in writing, each time** | the backup operator | the incident note, with the verification output |
| Rotate a credential | the owner | the owner | `security/` in the private repository (no secret) |
| Declare the incident over | the owner | | the incident note: what happened, what was done, which commit fixed it (`docs/audit/defect-backlog.md`) |

## 8. Drills

* **Every backup**: restore it locally (section 5) and keep the output of the passing run with the files.
* **Monthly**: restore the newest backup on a machine other than the one that made it.
* **Quarterly, once access exists**: create a Neon branch from a past time, count, copy one row back into a *test* table, delete the branch; time each step and replace the assumptions above with measurements.
* **After any change to the engine or the PostgreSQL version**: `pnpm test tests/unit/pgBackup.test.ts tests/unit/pgBackupDatabase.test.ts` against a server of the new version (CI runs 16 on every change and 18 in a separate job).

## 9. Verified, and not

| Item | Status |
| --- | --- |
| Backup and restore of a PostgreSQL 16 and a PostgreSQL 18 server on disposable local servers, including 16 to 18; counts, digests, indexes, constraints, sequences, columns and extensions compared | VERIFIED (local) |
| An older `pg_dump` for a newer server, a pooled endpoint, a changed or truncated dump, a restore over the source, a restore into a non-empty database or onto an older server: refused with a distinct exit code and no partial file | VERIFIED (local, automated: `tests/unit/pgBackup*.test.ts`) |
| No password or connection string on any command line, in any message, in the manifest, or passed on to the tools other than through their environment | VERIFIED (local, automated) |
| The same engine through Neon's network, TLS and direct endpoint | NOT TESTED |
| A Neon branch from a past time, and its restore window | NOT TESTED; plan and window unconfirmed |
| A backup of the production database | **does not exist** (blocked: gate 1) |
| A restore of production data anywhere | **never done** |
| The measured times above on Neon, and the RPO/RTO as promises | NOT TESTED; they are assumptions |
