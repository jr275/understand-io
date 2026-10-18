# Integration testing against a real database

_The suite in `tests/integration/` exercises the real HTTP routes of a real server backed by a real PostgreSQL. It exists because the unit and browser suites run without a database, so nothing else checks ownership, migrations or transactions. Added 2026-10-18._

## Safety rules

- **Never point it at a shared or production database.** Use a database created for the run and dropped afterwards.
- **Always pass `DATABASE_URL` explicitly.** `drizzle.config.ts` falls back to `postgres://localhost:5432/gloss`, the developer database, when the variable is missing.
- The tests create their own readers and documents with random titles and ids. They never read or alter existing rows, but they do add rows, so they must not run against a database whose contents matter.
- Without `INTEGRATION_BASE_URL` the suite is **skipped and reported as skipped**. A skipped run proves nothing.

## Run it

```bash
# 1. a disposable database on a local PostgreSQL (never the "gloss" development database)
psql -h localhost -d postgres -c "CREATE DATABASE gloss_phaseb_it"
export DATABASE_URL=postgres://localhost:5432/gloss_phaseb_it

# 2. schema from empty: this also proves migrations 0000-0003 apply cleanly
npx drizzle-kit migrate

# 3. a production build, served against that database (any free port)
npx next build
GLOSS_COOKIE_SECRET=$(openssl rand -hex 32) npx next start -p 3201 &   # keep the default import limit: the 429 test needs it

# 4. the suite
INTEGRATION_BASE_URL=http://localhost:3201 pnpm test:integration

# 5. clean up: stop the server, then drop only the database created in step 1
psql -h localhost -d postgres -c "DROP DATABASE gloss_phaseb_it"
```

## What it covers (`ownership.test.ts`, 17 tests)

Two readers, each with their own cookie, plus a reader with no cookie and one with a forged cookie:

- each reader lists only their own documents;
- no cookie, or a forged signature, sees nothing and cannot adopt another reader's id;
- marks, questions and reading position of one reader are invisible to another;
- another reader cannot overwrite, patch or delete a mark or a saved question by its id; an id that belongs to someone else is refused with a conflict even on the writer's own document;
- another reader cannot rename, favourite or delete a document;
- reading position is per reader;
- a mark, question or position cannot be attached to a document the reader does not own or that does not exist, while built-in sample texts still take marks;
- saving the same mark twice is idempotent and an older copy never overwrites a newer one;
- two readers importing a text with the same title each keep their own document;
- deleting a document removes its marks, questions and position together;
- every reader-dependent API response is `private, no-store`;
- a client that loops on imports gets a 429 while other readers are unaffected;
- two cookie-less writes sent together mint two readers, and after the reader bootstrap writes sent together all land under one reader.

## What it does not cover

Google's token exchange (no credentials; the account merge after it is covered by `tests/unit/accountMerge.test.ts` against a real PostgreSQL), a database outage mid-request, concurrent writers racing on the same row, and the AI routes (no key). Each is listed in `docs/quality/phase-b-data-and-security.md`.
