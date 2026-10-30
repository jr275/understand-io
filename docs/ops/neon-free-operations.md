# Neon Free: what it limits, what is watched, when to upgrade

The database is **Neon Free** for the beta (owner's decision, 2026-10-29). This is what that plan allows, what the app now watches, and the point at which to move to a paid plan. Nothing here changes billing; an upgrade is the owner's action in the Neon console.

Limits below are from Neon's plan page ([neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans), read 2026-10-29); Neon changes them, so check the console before relying on a number.

## The Free plan's limits

| Limit | Value | What it means here |
| --- | --- | --- |
| Storage | 1 GB per project | Texts are stored whole (`documents.blocks`), plus marks, AI results and the ledger. When it is full, **inserts, updates and deletes fail** (reading still works); nothing is deleted |
| Compute | 100 CU-hours per month per project (a 0.25 CU compute awake 400 hours) | An always-awake 0.25 CU compute uses about 180 CU-hours in a 30-day month: **more than the plan**. When the allowance is gone **the compute is suspended until the next billing period or an upgrade: the site has no database** |
| Scale to zero | the compute suspends after **5 idle minutes**; cannot be disabled | The first request after an idle spell waits for it to wake (a moment, not instant) |
| Restore history | **6 hours** of instant restore | A mistake noticed the next day cannot be rolled back by Neon: use a backup file |
| Network transfer | 5 GB per month per project, shared with other Neon services | Small for text; watch it if exports and backups grow |
| Autoscaling | up to 2 CU | Not a cost on Free, just the ceiling |

## What follows from it

1. **A monitor must not keep the database awake.** A check every 5 minutes that touches the database would hold the compute awake all month and use the compute allowance in about 16 days. `/api/health` therefore **reuses a healthy reading for 15 minutes** (`GLOSS_HEALTH_DB_CACHE_SECONDS`, default 900): with a monitor every 5 minutes the database is touched at most about every 15 minutes, so it can sleep about two thirds of the time with no other traffic. A failed reading is never reused (recovery is seen at once), and `?fresh=1` forces a real reading (the post-deploy check uses it). Real users keep it awake while they read: the allowance is spent by use, not by the monitor.
2. **A cold start is not an outage.** The health check repeats a failed reading once before saying `database-down`, and waits up to 3 seconds each time.
3. **There is no history to lean on.** Make a backup file weekly and before risky changes: `DATABASE_URL='<your Neon connection string>' scripts/db-backup.sh` (read-only; see `docs/ops/restore-rehearsal.md` to restore it).
4. **The shared AI fails closed, the library does not.** If the database is unreachable the shared AI refuses (no unmetered spending), and a reader's saves wait in the browser, which keeps its own copy.

## What is watched, and how

| Signal | How it is seen | 70% | 85% |
| --- | --- | --- | --- |
| **Storage** (`pg_database_size`, against `GLOSS_DB_STORAGE_LIMIT_MB`, default 1024) | `GET /api/health`: `storage: { usedMb, limitMb, percent, level }` | `warnings: ["db-storage-70"]`, still HTTP 200 (about 717 MB) | `reasons: ["db-storage-85"]`, `status: degraded`, **HTTP 503 with `?strict=1`** (about 870 MB) |
| **Database health** | the same answer: `database: ok` or `down` (503) | n/a | n/a |
| **Compute hours** | **not visible to the app.** the Neon console's usage and billing pages for the project | owner reads it weekly: **70 CU-hours** | **85 CU-hours** |
| **Network transfer** | Neon console, same page | 3.5 GB | 4.25 GB |

The external monitor (`docs/ops/monitoring-and-alerts.md`) turns the storage signals into messages: the 85% level changes the strict answer to 503, and a second keyword monitor on `"warnings":[]` alerts at 70%. The compute and transfer thresholds have no automatic alert: they need the owner's weekly look at the Neon console until the app can read Neon's usage API with a key the owner chooses to provide.

`GLOSS_DB_STORAGE_LIMIT_MB` should be set to the plan's real number if Neon changes it or the project moves plans.

## When to upgrade, before anything is exhausted

Move the project to **Launch** (pay for what is used: compute about US$ 0.106 per CU-hour, storage about US$ 0.35 per GB-month, up to 7 days of restore, per [neon.com/pricing](https://neon.com/pricing)) when **any** of these is true:

* storage reaches **70%** (the warning), so there is room to decide calmly;
* compute use passes **70 CU-hours** before the last week of the month, or on any day the console projects the month above 100;
* a 6-hour restore window is no longer enough for the people using the site (it is the moment the beta stops being an experiment);
* the site shows the first "database unavailable" outage that is not a cold start.

The expected cost on Launch for the beta's size is in `docs/release/UNDERSTAND_FREEMIUM_LAUNCH.md` (cost exposure): a few dollars to a couple of tens a month. Upgrading is done in the Neon console and does not change `DATABASE_URL`.

## If the compute allowance is exhausted or storage is full

| Situation | What the readers see | What to do |
| --- | --- | --- |
| Compute allowance used | reads and saves fail; the app shows its "could not save" and keeps the browser copy; `/api/health` answers 503 `database-down` | upgrade the project (the compute resumes), or wait for the next billing period; nothing is lost |
| Storage full | reading works, saving fails | free space (delete large texts) or upgrade |
| Cold start | one slow first request | nothing |
| A mistake in the last 6 hours | n/a | restore from a Neon branch at an earlier time (`docs/ops/restore-rehearsal.md`) |
| A mistake older than that | n/a | restore from the last backup file made with `scripts/db-backup.sh` |

## Recovery, tested and not tested

* **Tested** on disposable local PostgreSQL: a dump, a deleted text, a full restore into a new database (identical checksums), a targeted recovery of the lost text, the app starting on the restored database (`docs/ops/restore-rehearsal.md`), and `scripts/db-backup.sh` writing a readable file that restores.
* **Not tested:** the restore on Neon itself (no credential here). The steps for the owner are in `docs/ops/restore-rehearsal.md`.
