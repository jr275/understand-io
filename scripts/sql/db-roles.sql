-- Database roles for Understand.io: an ADMINISTRATIVE OWNER role, a MIGRATION role and a RUNTIME role. Idempotent, additive, no password anywhere in it.
--
--   psql "<direct connection string of the login that owns the tables today>" -X -v ON_ERROR_STOP=1 -f scripts/sql/db-roles.sql
--   then, for each login role, at psql's hidden prompt:   \password understand_app      \password understand_migrator
--   then verify (read-only):                              psql ... -f scripts/sql/db-roles-verify.sql
--
-- Design (docs/ops/database-roles.md):
--   understand_owner     NOLOGIN. Owns every table, sequence and index of the application and the `drizzle` schema. Nobody connects as it.
--   understand_migrator  LOGIN. A member of the owner role, and every session starts as the owner (ALTER ROLE ... SET role), so what a migration creates is
--                        owned by the owner role. Used by `drizzle-kit migrate` only, on the DIRECT endpoint. lock_timeout 10s so a migration never queues behind traffic.
--   understand_app       LOGIN. The runtime role (DATABASE_URL of the application). A member of NO role. SELECT, INSERT, UPDATE, DELETE on the application tables and
--                        nothing else: no DDL, no TRUNCATE, no `drizzle` schema, no CREATE in `public`, no TEMP, no role or database management.
--   the login that runs this script (neondb_owner on Neon) keeps owning the database and becomes a member of the owner role: it is the break-glass login.
--
-- Run it as that login. Names can be changed with -v owner_role=... -v migrator_role=... -v app_role=...
-- ALTER ... OWNER takes a brief exclusive lock on each table: give up after 5 seconds instead of queueing behind traffic (every statement commits on its own, so a rerun continues)
SET lock_timeout = '5s';
\if :{?owner_role} \else \set owner_role understand_owner \endif
\if :{?migrator_role} \else \set migrator_role understand_migrator \endif
\if :{?app_role} \else \set app_role understand_app \endif

SELECT current_setting('server_version_num')::int < 160000 AS too_old \gset
\if :too_old
  \echo 'STOP: this script uses the role-membership options of PostgreSQL 16 and later (INHERIT and SET are per membership).'
  DO $$ BEGIN RAISE EXCEPTION 'PostgreSQL 16 or later is required'; END $$;
\endif

\echo == roles
SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'owner_role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_role') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5', :'migrator_role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50', :'app_role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

-- The runtime role must never be a member of anything, whatever happened before: stop rather than quietly widen or narrow it.
SELECT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = :'app_role')) AS app_has_memberships \gset
\if :app_has_memberships
  \echo 'STOP: the runtime role is a member of another role. Revoke those memberships on purpose (REVOKE <role> FROM <runtime role>), then run this again.'
  DO $$ BEGIN RAISE EXCEPTION 'runtime role has memberships'; END $$;
\endif

\echo == memberships and role settings
-- The login running this script becomes a member of the owner role so it can move ownership and manage grants (the break-glass path).
-- (the creator of a role only holds ADMIN OPTION on it, without INHERIT or SET: both are granted explicitly)
SELECT format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', :'owner_role', current_user)
  WHERE NOT (pg_has_role(current_user, :'owner_role', 'USAGE') AND pg_has_role(current_user, :'owner_role', 'SET')) \gexec
SELECT format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', :'owner_role', :'migrator_role')
  WHERE NOT (pg_has_role(:'migrator_role', :'owner_role', 'USAGE') AND pg_has_role(:'migrator_role', :'owner_role', 'SET')) \gexec
SELECT format('ALTER ROLE %I SET role = %L', :'migrator_role', :'owner_role') \gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'migrator_role', '10s') \gexec

\echo == database and schema privileges
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', current_database(), :'app_role', :'migrator_role') \gexec
-- the migration tool runs CREATE SCHEMA IF NOT EXISTS "drizzle" on every run, and PostgreSQL checks CREATE on the DATABASE before it looks whether the schema exists
-- (measured: "permission denied for database" otherwise), so the owner role, which the migrator acts as, holds it. The runtime role does not.
SELECT format('GRANT CREATE ON DATABASE %I TO %I', current_database(), :'owner_role') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION %I', :'owner_role') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'owner_role') \gexec
SELECT format('REVOKE ALL ON SCHEMA public FROM %I', :'app_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec
SELECT format('REVOKE ALL ON SCHEMA drizzle FROM %I', :'app_role') \gexec

\echo == ownership of what exists today moves to the owner role (tables, views, standalone sequences; identity and serial sequences follow their table)
-- the schema first: a table can only move to a role that may create in the table's schema
SELECT format('ALTER SCHEMA drizzle OWNER TO %I', :'owner_role')
  WHERE (SELECT nspowner FROM pg_namespace WHERE nspname = 'drizzle') <> (SELECT oid FROM pg_roles WHERE rolname = :'owner_role') \gexec
SELECT format('ALTER %s %I.%I OWNER TO %I',
         CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
         n.nspname, c.relname, :'owner_role')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'drizzle')
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
   AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'owner_role')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i') AND d.refclassid = 'pg_class'::regclass)
 ORDER BY (c.relkind = 'S'), n.nspname, c.relname \gexec

\echo == table privileges of the runtime role, now and for what later migrations create
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', :'owner_role', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'owner_role', :'app_role') \gexec

\echo == done. Next: set the two passwords at the hidden prompt of psql (the meta-command is spelled backslash + password), then run scripts/sql/db-roles-verify.sql
