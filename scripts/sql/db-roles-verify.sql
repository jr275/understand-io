-- Read-only report on the three roles: every line is a check, and the script fails (exit code 3 under ON_ERROR_STOP) if any is false. Changes nothing.
--
--   psql "<direct connection string>" -X -v ON_ERROR_STOP=1 -f scripts/sql/db-roles-verify.sql
\if :{?owner_role} \else \set owner_role understand_owner \endif
\if :{?migrator_role} \else \set migrator_role understand_migrator \endif
\if :{?app_role} \else \set app_role understand_app \endif

CREATE TEMP TABLE _roles_check (n serial, what text, ok boolean);
INSERT INTO _roles_check (what, ok)
SELECT * FROM (VALUES
  ('the three roles exist',
     (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN (:'owner_role', :'migrator_role', :'app_role'))),
  ('owner role cannot log in; migrator and runtime can',
     (SELECT bool_and(CASE WHEN rolname = :'owner_role' THEN NOT rolcanlogin ELSE rolcanlogin END) FROM pg_roles WHERE rolname IN (:'owner_role', :'migrator_role', :'app_role'))),
  ('none of the three is superuser, createdb, createrole, replication or bypassrls',
     (SELECT NOT bool_or(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname IN (:'owner_role', :'migrator_role', :'app_role'))),
  ('the runtime role is a member of NO role',
     NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = :'app_role'))),
  ('the runtime role does not have the owner role through any path',
     NOT pg_has_role(:'app_role', :'owner_role', 'MEMBER')),
  ('nobody can act as the runtime role by membership (the creator keeps ADMIN OPTION only, without INHERIT or SET)',
     NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = :'app_role') AND (inherit_option OR set_option))),
  ('the migrator is a member of the owner role and starts every session as it',
     pg_has_role(:'migrator_role', :'owner_role', 'USAGE') AND pg_has_role(:'migrator_role', :'owner_role', 'SET')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role' AND rolconfig::text[] @> ARRAY[format('role=%s', :'owner_role')])),
  ('the migrator has a lock_timeout',
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role' AND EXISTS (SELECT 1 FROM unnest(rolconfig) c WHERE c LIKE 'lock_timeout=%'))),
  ('every table of public and drizzle belongs to the owner role',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) <> :'owner_role')),
  ('every sequence of public and drizzle belongs to the owner role',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> :'owner_role')),
  ('the drizzle schema belongs to the owner role',
     (SELECT pg_get_userbyid(nspowner) = :'owner_role' FROM pg_namespace WHERE nspname = 'drizzle')),
  ('the runtime role has SELECT, INSERT, UPDATE and DELETE on every table of public',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                  AND NOT (has_table_privilege(:'app_role', c.oid, 'SELECT') AND has_table_privilege(:'app_role', c.oid, 'INSERT') AND has_table_privilege(:'app_role', c.oid, 'UPDATE') AND has_table_privilege(:'app_role', c.oid, 'DELETE')))),
  ('the runtime role has no TRUNCATE, REFERENCES or TRIGGER on any table',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p')
                  AND (has_table_privilege(:'app_role', c.oid, 'TRUNCATE') OR has_table_privilege(:'app_role', c.oid, 'REFERENCES') OR has_table_privilege(:'app_role', c.oid, 'TRIGGER')))),
  ('the runtime role has no privilege at all on the drizzle schema or its tables',
     NOT has_schema_privilege(:'app_role', 'drizzle', 'USAGE') AND NOT has_schema_privilege(:'app_role', 'drizzle', 'CREATE')
       AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'drizzle' AND c.relkind IN ('r', 'p')
                        AND (has_table_privilege(:'app_role', c.oid, 'SELECT') OR has_table_privilege(:'app_role', c.oid, 'INSERT')))),
  ('the runtime role can use public but not create in it',
     has_schema_privilege(:'app_role', 'public', 'USAGE') AND NOT has_schema_privilege(:'app_role', 'public', 'CREATE')),
  ('the runtime role cannot create in the database or use temporary tables',
     NOT has_database_privilege(:'app_role', current_database(), 'CREATE') AND NOT has_database_privilege(:'app_role', current_database(), 'TEMPORARY')),
  ('the owner role (so the migrator) can create in the database, as the migration tool needs',
     has_database_privilege(:'owner_role', current_database(), 'CREATE')),
  ('the runtime and migration roles can connect; PUBLIC cannot',
     has_database_privilege(:'app_role', current_database(), 'CONNECT') AND has_database_privilege(:'migrator_role', current_database(), 'CONNECT')
       AND NOT EXISTS (SELECT 1 FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'CONNECT')),
  ('what the owner role creates later is granted to the runtime role by default (tables)',
     EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
              WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = :'owner_role') AND d.defaclobjtype = 'r'
                AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'app_role')
              GROUP BY d.oid HAVING array_agg(a.privilege_type ORDER BY a.privilege_type) = ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'])),
  ('PUBLIC has nothing on public tables',
     NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a WHERE n.nspname IN ('public', 'drizzle') AND a.grantee = 0))
) v(what, ok);

\echo
SELECT lpad(n::text, 2) || '  ' || CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END || '  ' || what AS "role checks" FROM _roles_check ORDER BY n;
SELECT count(*) FILTER (WHERE NOT coalesce(ok, false)) > 0 AS failed FROM _roles_check \gset
\if :failed
  DO $$ BEGIN RAISE EXCEPTION 'role verification failed (see the FAIL lines above)'; END $$;
\endif
\echo all role checks passed
