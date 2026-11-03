# Proposed migrations (not applied)

Nothing in this folder runs: it is outside `drizzle/` and `scripts/vercel-build.mjs` only reads that folder. Each file is a proposal with its own rollback. Applying one to production needs the owner's decision, a fresh backup (`scripts/db-backup.sh`), and a rehearsal on a Neon branch or a disposable PostgreSQL first.

## 0007 — children of a document (Mission 06, finding P3-DB-1)

**Question asked:** deleting a document does not delete its marks. Is that a defect?

**Answer, from the code (read 2026-11-02):**

- `annotations`, `glosses` and `reading_progress` have no foreign key to `documents` **by design**: `document_id` may be `sample:<slug>` (a built-in text with no row), so a key cannot express the rule. `canAttachTo` (`src/lib/server/documents.ts`) is the guarantee on the way in.
- The application's own delete (`DELETE /api/documents/[id]`, `src/app/api/documents/[id]/route.ts`) removes the children and the document **in one transaction**. So deleting through the product does not leave marks behind. The "finding" in `restore-rehearsal.md` came from a manual SQL `DELETE FROM documents`, which is outside the product.
- What can still leave a child behind: (a) a mark saved while the document is being deleted (`canAttachTo` passes, then the delete commits, then the insert lands: a few milliseconds' window, and it takes two requests from the same reader at once); (b) manual SQL; (c) a restore of only some tables.
- Impact: small. An orphan is invisible (no document lists it), holds a few KB, and is deleted with its reader. It is **a missing database-level safeguard, not a data-loss or exposure defect** (children are always filtered by `reader_id`).

**Detection (implemented):** `node scripts/db-integrity-check.mjs` (read-only; exit 1 when orphans exist). Tested in `tests/unit/dbIntegrity.test.ts`.

**Proposal:** `0007_document_children_guard.sql.draft`, part 1, a trigger that deletes the children of a deleted document. Part 2 (a partial unique index so identical concurrent imports cannot duplicate) needs an application change first (see the file).

**Order of use:**

1. Run the check against the live database (the owner has the Neon URL). If it reports orphans, preview them with the SELECTs inside `scripts/lib/integrity.mjs`; deleting orphans is a separate, backed-up step.
2. Rehearse the draft on a Neon branch: delete a document that has a mark, a gloss and a position; the three children must be gone; then run the rollback lines and repeat: they must stay.
3. Only then, with the owner's yes, turn it into a drizzle migration (`pnpm db:generate` writes the file; copy the SQL in) and release it the usual way.

**Cost of the trigger:** one indexed delete per child table per deleted document (`annotations_doc_idx`, `glosses_doc_idx`; `reading_progress` is keyed by document and reader). Negligible at this scale.
