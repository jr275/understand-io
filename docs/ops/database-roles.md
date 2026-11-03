# Database roles: owner, migration, runtime

Status: **designed and tested on disposable PostgreSQL 16; not applied anywhere else.** Applying it to the production Neon project is an owner action that needs a branch rehearsal first (below). Files: `scripts/sql/db-roles.sql` (setup, idempotent), `scripts/sql/db-roles-verify.sql` (read-only checks), `tests/unit/dbRolesDatabase.test.ts` (14 tests that connect as each role).

## Why

Today one login, `neondb_owner`, owns every table and is what `DATABASE_URL` holds. A flaw in the application, or a leaked environment variable, would therefore be able to drop tables, rewrite the migration history, create roles and read every reader's text. The application needs to read and write rows and nothing else.

## The three roles

| Role | Logs in | Purpose | Used by |
| --- | --- | --- | --- |
| `understand_owner` | **no** | owns every table, sequence and index of the application and the `drizzle` schema | nobody directly; reached only through membership |
| `understand_migrator` | yes | changes the schema: member of the owner role, every session starts as the owner (`ALTER ROLE ... SET role`), `lock_timeout` 10 seconds | `drizzle-kit migrate` (the build, or the operator), on the **direct** endpoint |
| `understand_app` | yes | reads and writes rows | the running application: `DATABASE_URL`, on the **pooled** endpoint |
| `neondb_owner` (existing) | yes | owns the database; becomes a member of the owner role | the human, break-glass only. Its password lives in the password manager, never in Vercel |

**The runtime role is a member of no role**, so it cannot become the owner, the migrator or anything else (`SET ROLE` is refused, and a test proves it).

## What each role may do (every cell is tested)

| | `understand_app` | `understand_migrator` | `understand_owner` | `neondb_owner` |
| --- | --- | --- | --- | --- |
| Connect to the database | yes | yes | no (cannot log in) | yes |
| `SELECT`, `INSERT`, `UPDATE`, `DELETE` on application tables | **yes** | yes (as owner) | owns | yes (member) |
| Insert into the identity column of `analytics_events` | **yes**, without any sequence grant | yes | owns | yes |
| `TRUNCATE`, `REFERENCES`, `TRIGGER` | no | yes | owns | yes |
| `CREATE`/`ALTER`/`DROP` table, index | **no** | yes (as owner) | owns | yes |
| Tables the migrator creates later | usable at once (default privileges) | owns them (as owner) | owns | yes |
| Schema `drizzle` (the migration history) | **no access at all** | yes | owns | yes |
| `CREATE` in schema `public`; `CREATE SCHEMA`; temporary tables | **no** | yes (as owner) | yes | yes |
| `CREATE ROLE`, `ALTER ROLE`, `CREATE EXTENSION`, `COPY ... PROGRAM`, `pg_read_file`, terminating other sessions | **no** | no | no | role management yes, server file access no |
| `SET ROLE` to the owner | **no** | already acts as it | n/a | yes |
| Superuser, createdb, createrole, replication, bypassrls | none | none | none | createdb, createrole |

## The exact SQL

Run as `neondb_owner`, on a **direct** connection, from a clean shell (the connection string is typed at a hidden prompt, never put in history):

```bash
psql "<direct connection string>" -X -v ON_ERROR_STOP=1 -f scripts/sql/db-roles.sql
```

What it runs, with the default names (`\gexec` skips every statement whose effect is already there, so it can be repeated):

```sql
SET lock_timeout = '5s';
CREATE ROLE understand_owner    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE understand_migrator LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
CREATE ROLE understand_app      LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50;
-- refuses to continue if understand_app is a member of any role

GRANT understand_owner TO <the login running the script> WITH INHERIT TRUE, SET TRUE;   -- break-glass
GRANT understand_owner TO understand_migrator WITH INHERIT TRUE, SET TRUE;
ALTER ROLE understand_migrator SET role = 'understand_owner';
ALTER ROLE understand_migrator SET lock_timeout = '10s';

REVOKE ALL ON DATABASE <db> FROM PUBLIC;
GRANT CONNECT ON DATABASE <db> TO understand_app, understand_migrator;
GRANT CREATE ON DATABASE <db> TO understand_owner;      -- drizzle-kit runs CREATE SCHEMA IF NOT EXISTS on every run; PostgreSQL checks this first (measured)
CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION understand_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO understand_owner;
REVOKE ALL ON SCHEMA public FROM understand_app;   GRANT USAGE ON SCHEMA public TO understand_app;
REVOKE ALL ON SCHEMA drizzle FROM understand_app;

ALTER SCHEMA drizzle OWNER TO understand_owner;                 -- first: a table can only move to a role that may create in its schema
ALTER TABLE <each table of public and drizzle> OWNER TO understand_owner;   -- identity sequences follow their table

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM understand_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO understand_app;
ALTER DEFAULT PRIVILEGES FOR ROLE understand_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO understand_app;
```

Then the two passwords, at psql's hidden prompt (the password is hashed in the client and never appears in a command line, the server log or the history). In psql type backslash, `password`, a space and the role name:

```
\password understand_app
\password understand_migrator
```

Then check everything, read-only: `psql "<direct connection string>" -X -v ON_ERROR_STOP=1 -f scripts/sql/db-roles-verify.sql` prints 20 `PASS`/`FAIL` lines and exits 3 on any `FAIL`.

It needs PostgreSQL 16 or later (the script stops with a message on an older server). Neon projects on 16, 17 or 18 qualify.

## Connection strings

| Variable | Role | Endpoint | Where it lives |
| --- | --- | --- | --- |
| `DATABASE_URL` | `understand_app` | pooled (`-pooler` host) | Vercel, Production only, Sensitive |
| `DATABASE_MIGRATION_URL` | `understand_migrator` | **direct** (no `-pooler`) | see the two options below |

`scripts/vercel-build.mjs` migrates with `DATABASE_MIGRATION_URL` when it is set and with `DATABASE_URL` otherwise; the application itself reads only `DATABASE_URL`.

**Option A (convenient): `DATABASE_MIGRATION_URL` in Vercel, Production only, Sensitive.** The merge applies migrations automatically, as today. The limit: Vercel gives the same environment to the build and to the running functions, so a flaw that can read `process.env` at runtime could read the migration credential too. The runtime role itself is still least-privilege, so this is a real improvement over today but not a full separation.

**Option B (strict): `GLOSS_BUILD_MIGRATIONS=off` in Vercel, no migration credential in Vercel.** The operator applies each migration from their own machine before the merge, with `DATABASE_URL='<migrator direct string, typed at a hidden prompt>' pnpm db:migrate`. A merge then never touches the schema, and the migration credential exists only in the password manager. Recommended once the site has real readers; it makes every migration a deliberate, approved step, which is what the release sequence already asks for.

## Rehearse on a Neon branch first (changes nothing in production)

Roles belong to a branch, and a branch is a copy of production.

1. Create a branch of production "from now". Open it with the owner's direct string at a hidden prompt.
2. Run the setup script, set the two passwords, run the verify script (20 `PASS`).
3. `DATABASE_URL='<migrator direct string of the branch>' pnpm db:migrate`: exits 0, nothing to apply.
4. Connect as `understand_app` through the branch's pooled endpoint and run `node scripts/db-integrity-check.mjs` (read-only) and the read and write checks of `tests/unit/dbRolesDatabase.test.ts` (point its DATABASE_URL at the branch's owner login).
5. If a statement is refused on Neon that the local tests accept, that is the finding: stop, do not apply to production, and record the message.
6. Delete the branch.

Not yet done: this rehearsal needs the owner's access to the project (gate 1). The local tests establish the SQL and the privilege model on PostgreSQL 16; they do not establish how Neon's own roles interact (`neon_superuser`, the console's role list).

## Effect on production when applied

* One brief exclusive lock per table for the ownership change (metadata only, milliseconds; `lock_timeout` 5 seconds so it gives up instead of waiting behind traffic). 12 tables, one schema.
* No data is rewritten. The running application keeps using `neondb_owner` until `DATABASE_URL` is changed, so applying the roles changes nothing it does.
* `REVOKE ... FROM PUBLIC` on the database removes connection rights from any other login role that relied on them. Look first: `SELECT rolname FROM pg_roles WHERE rolcanlogin;`. Only roles the owner knows about should be there.

## Rotation of the runtime credential without downtime

Create the next runtime role with the same script (`-v app_role=understand_app_2`), set its password, verify, change `DATABASE_URL` in Vercel and redeploy the same commit, watch the Neon connection list, then `DROP OWNED BY understand_app; DROP ROLE understand_app;`. The old credential keeps working until that last step, and the two roles never share a password.

## Rollback of the roles setup

```sql
-- as neondb_owner, on a direct connection, only if the roles must be removed again
REASSIGN OWNED BY understand_owner TO neondb_owner;      -- tables and the drizzle schema go back
DROP OWNED BY understand_app, understand_migrator;
DROP ROLE understand_app, understand_migrator, understand_owner;
GRANT CONNECT ON DATABASE <db> TO PUBLIC;                -- only if it was granted before: check the earlier state first
```

`REASSIGN OWNED BY understand_owner` moves only what that role owns (it does not own the database), so it is safe to run. Set `DATABASE_URL` back to a working owner-level credential first.

## What this does not do

Per-table least privilege (for example an append-only ledger), column-level grants, row-level security, a network allow-list (a paid Neon feature) or a second database. They are possible later; none is needed to remove the most dangerous capabilities from the running application.
