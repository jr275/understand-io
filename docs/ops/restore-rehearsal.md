# Restore rehearsal

What was rehearsed, what was not, and the steps the owner runs on Neon. Written 2026-10-29. Related: `docs/ops/rollback-and-recovery.md`. The rehearsal below was done by hand; the repeatable, verifying version is `scripts/db-backup.mjs` and `scripts/db-restore-verify.mjs` (`docs/ops/disaster-recovery.md`).

## What was rehearsed (disposable local PostgreSQL 16, synthetic data)

| Step | Result |
| --- | --- |
| Database built by the repository's migrations, then filled with 2 readers, 3 texts, 2 marks, 1 reading position | counts `2/3/2/1`, checksum of the texts recorded |
| `pg_dump -Fc` of it | 20 KB file |
| "Accident": one text deleted | counts `2/2/2/1`, checksum differs |
| **Full restore** into a new, empty database (`pg_restore --no-owner`) | counts `2/3/2/1`, **checksum identical** to the original |
| **Targeted recovery**: copy only the lost text from the restored copy into the damaged database (`\copy`) | the text is back, checksum identical to the original |
| The app (`next dev`) started on the restored database | `GET /api/health/ready?strict=1` with a health token: 200, `database: ok` |
| `drizzle-kit migrate` run on the restored database | applied cleanly (nothing to change) |

Two findings:

1. **Deleting a text does not delete its marks.** `annotations` has no foreign key to `documents` (only to the reader), so after the accident the marks were still there, and re-inserting them failed on the primary key. Recover **the text only**; if marks are also missing, insert them with `ON CONFLICT (id) DO NOTHING`.
2. The recovery needs the restored copy in a **separate** database, never over the live one. The live database keeps serving while you look.

## What was not rehearsed (needs the owner)

The restore **on Neon itself**: it needs the owner's Neon access, and the plan (which sets how far back you can restore; see the provider's plan page) is not readable from the repository. Nothing in production was touched.

### Steps on Neon (about 15 minutes, changes nothing in production)

1. Neon console → the project → **Settings / Plans**: write down the plan and the restore window.
2. **Branches → Create branch**, "from a past point in time" (a few minutes ago). A branch is a copy; the production branch is untouched.
3. Open the branch's SQL editor and run `SELECT count(*) FROM documents;`, compare with the production branch.
4. To recover a text, copy its rows from the branch to production with the SQL editor (`INSERT ... SELECT` through a connection to both, or export the rows and insert them). Do not repoint `DATABASE_URL` to the branch unless production is lost: that is a production change and needs the owner's decision.
5. Delete the branch when done (it can cost storage).

## Order of recovery, from least to most drastic

1. The reader's own backup file (Backup in the app): additive restore, no operator needed.
2. Targeted recovery of rows from a Neon branch made at a past time (above).
3. Redeploy the previous deployment if the problem is code (`docs/ops/rollback-and-recovery.md`); migrations are additive and are never reversed.
4. Repointing `DATABASE_URL` to a restored branch: only if the production database is lost.
