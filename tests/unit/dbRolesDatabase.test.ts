// The three database roles (scripts/sql/db-roles.sql) against a real PostgreSQL: the setup script is run exactly as an operator runs it (psql, as the
// non-superuser login that owns the tables today, which stands in for neondb_owner), and every claim of docs/ops/database-roles.md is then tested by
// connecting as each role. Everything lives in two private databases and four private roles that are dropped at the end.
//
// Needs DATABASE_URL (an administrator: CREATEDB and CREATEROLE) and `psql` on the PATH; without either the file is skipped.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { databaseAiStore } from "@/lib/server/aiStore";
import { deleteExpiredBatch, runRetention } from "@/lib/server/analyticsRetention";
import { getDb } from "@/lib/db/client";

const ADMIN = process.env.DATABASE_URL;
const havePsql = spawnSync("psql", ["--version"]).status === 0;
const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const role = { boot: `rt_${run}_boot`, owner: `rt_${run}_owner`, mig: `rt_${run}_mig`, app: `rt_${run}_app` };
const db1 = `gloss_roles_${run}_a`; // the "existing production" path: built by the stand-in owner, then the script
const db2 = `gloss_roles_${run}_b`; // the "fresh database" path: the script first, then the migrator builds everything
const pw = { boot: randomBytes(12).toString("hex"), mig: randomBytes(12).toString("hex"), app: randomBytes(12).toString("hex") };

const urlOf = (user: string, password: string, database: string) => {
  const u = new URL(ADMIN!);
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
};
const connect = (user: keyof typeof pw, database: string) => postgres(urlOf(role[user], pw[user], database), { max: 1, prepare: false, onnotice: () => {} });
const open: ReturnType<typeof postgres>[] = [];
const as = (user: keyof typeof pw, database: string) => {
  const c = connect(user, database);
  open.push(c);
  return c;
};
const sqlstate = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
};

function psql(user: keyof typeof pw, database: string, script: string) {
  const u = new URL(ADMIN!);
  const r = spawnSync(
    "psql",
    ["-X", "-q", "-h", u.hostname, "-p", u.port || "5432", "-U", role[user], "-d", database, "-v", "ON_ERROR_STOP=1", "-v", `owner_role=${role.owner}`, "-v", `migrator_role=${role.mig}`, "-v", `app_role=${role.app}`, "-f", script],
    { env: { ...process.env, PGPASSWORD: pw[user] }, encoding: "utf8" },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const admin = ADMIN && havePsql ? postgres(ADMIN, { max: 1, prepare: false, onnotice: () => {} }) : null;

describe.skipIf(!admin)("the owner, migration and runtime roles against real PostgreSQL", () => {
  beforeAll(async () => {
    await admin!.unsafe(`CREATE ROLE ${role.boot} LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '${pw.boot}'`);
    await admin!.unsafe(`CREATE DATABASE ${db1} OWNER ${role.boot}`);
    await admin!.unsafe(`CREATE DATABASE ${db2} OWNER ${role.boot}`);
    // db1: the state of production today. Every table is built and owned by the one login.
    const boot1 = as("boot", db1);
    await migrate(drizzle(boot1), { migrationsFolder: "drizzle" });
    expect((await boot1`SELECT count(DISTINCT relowner)::int AS n FROM pg_class WHERE relnamespace IN ('public'::regnamespace, 'drizzle'::regnamespace) AND relkind IN ('r', 'S')`)[0].n).toBe(1);
    for (const d of [db1, db2]) {
      const r = psql("boot", d, "scripts/sql/db-roles.sql");
      expect(r.out, r.out).not.toMatch(/ERROR|STOP/);
      expect(r.status).toBe(0);
    }
    await admin!.unsafe(`ALTER ROLE ${role.mig} PASSWORD '${pw.mig}'`);
    await admin!.unsafe(`ALTER ROLE ${role.app} PASSWORD '${pw.app}'`);
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    globalThis.__glossDb = undefined;
    await Promise.allSettled(open.map((c) => c.end({ timeout: 2 })));
    for (const d of [db1, db2]) await admin!.unsafe(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    // the login that ran the script granted the memberships, so it can only be dropped after the roles it granted
    for (const r of [role.app, role.mig, role.owner, role.boot]) await admin!.unsafe(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
    await admin!.end({ timeout: 2 });
  }, 60_000);

  describe("the setup script", () => {
    it("is verified by the read-only verification script on the existing database (all checks pass)", () => {
      for (const d of [db1, db2]) {
        const r = psql("boot", d, "scripts/sql/db-roles-verify.sql");
        expect(r.out, r.out).toContain("all role checks passed");
        expect(r.out).not.toMatch(/FAIL/);
        expect(r.status).toBe(0);
        expect((r.out.match(/PASS/g) ?? []).length).toBeGreaterThanOrEqual(20);
      }
    });

    it("is idempotent: a second run changes nothing and still verifies", () => {
      expect(psql("boot", db1, "scripts/sql/db-roles.sql").status).toBe(0);
      expect(psql("boot", db1, "scripts/sql/db-roles-verify.sql").status).toBe(0);
    });

    it("the verification script fails (exit 3) when a role has been widened", async () => {
      const c = as("boot", db1);
      const owner = (await c`SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE relname = 'readers'`)[0].o;
      expect(owner).toBe(role.owner);
      await c.unsafe(`GRANT TRUNCATE ON readers TO ${role.app}`);
      const r = psql("boot", db1, "scripts/sql/db-roles-verify.sql");
      expect(r.status).toBe(3);
      expect(r.out).toMatch(/FAIL\s+the runtime role has no TRUNCATE/);
      await c.unsafe(`REVOKE TRUNCATE ON readers FROM ${role.app}`);
      expect(psql("boot", db1, "scripts/sql/db-roles-verify.sql").status).toBe(0);
    });

    it("refuses to run when the runtime role is a member of another role", async () => {
      const c = as("boot", db1);
      await admin!.unsafe(`GRANT ${role.owner} TO ${role.app}`);
      const r = psql("boot", db1, "scripts/sql/db-roles.sql");
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/runtime role is a member of another role/);
      await admin!.unsafe(`REVOKE ${role.owner} FROM ${role.app}`);
      expect(psql("boot", db1, "scripts/sql/db-roles.sql").status).toBe(0);
      expect((await c`SELECT count(*)::int AS n FROM pg_auth_members WHERE member = ${role.app}::regrole`)[0].n).toBe(0);
    });
  });

  describe("the runtime role (what DATABASE_URL holds)", () => {
    it("is a member of nothing, holds no role attribute, and cannot become the owner or the migrator", async () => {
      const app = as("app", db1);
      expect((await app`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`)[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false });
      expect((await app`SELECT count(*)::int AS n FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`)[0].n).toBe(0);
      expect(await sqlstate(app.unsafe(`SET ROLE ${role.owner}`))).toBe("42501");
      expect(await sqlstate(app.unsafe(`SET ROLE ${role.mig}`))).toBe("42501");
      expect(await sqlstate(app.unsafe(`SET SESSION AUTHORIZATION ${role.boot}`))).toBe("42501");
    });

    it("can read every application table and write the ones the application writes, including an identity column without a sequence grant", async () => {
      const app = as("app", db1);
      const tables = (await app`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.tablename as string);
      expect(tables.length).toBeGreaterThanOrEqual(12);
      for (const t of tables) expect(await sqlstate(app.unsafe(`SELECT 1 FROM public.${t} LIMIT 1`)), t).toBe("ok");
      await app`INSERT INTO readers (id) VALUES ('rt-reader')`;
      await app`INSERT INTO documents (id, reader_id, slug, kind, title, blocks) VALUES ('rt-doc', 'rt-reader', 'rt', 'essay', 'T', '[]'::jsonb)`;
      await app`UPDATE documents SET title = 'T2' WHERE id = 'rt-doc'`;
      const ev = await app`INSERT INTO analytics_events (at, event, actor, actor_kind) VALUES (1, 'landing_viewed', 'a', 'daily') RETURNING id`;
      expect(Number(ev[0].id)).toBeGreaterThan(0);
      await app`DELETE FROM documents WHERE id = 'rt-doc'`;
      await app`DELETE FROM readers WHERE id = 'rt-reader'`;
      await app`DELETE FROM analytics_events WHERE actor = 'a'`;
    });

    it("is refused, with insufficient_privilege, everything that is not data: DDL, TRUNCATE, the migration history, other roles, the server", async () => {
      const app = as("app", db1);
      const bootPid = (await as("boot", db1)`SELECT pg_backend_pid() AS pid`)[0].pid;
      const denied = [
        "CREATE TABLE public.t_evil (i int)",
        "CREATE INDEX t_idx ON readers (id)",
        "DROP TABLE readers",
        "ALTER TABLE readers ADD COLUMN evil int",
        "ALTER TABLE readers OWNER TO CURRENT_USER",
        "TRUNCATE readers",
        "TRUNCATE analytics_events",
        "SELECT * FROM drizzle.__drizzle_migrations",
        "DELETE FROM drizzle.__drizzle_migrations",
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 1)",
        "CREATE SCHEMA evil",
        "CREATE TEMP TABLE tt (i int)",
        "CREATE ROLE evil",
        `ALTER ROLE ${role.mig} PASSWORD 'x'`,
        `ALTER ROLE ${role.app} SUPERUSER`,
        "CREATE EXTENSION pgcrypto",
        "COMMENT ON TABLE readers IS 'x'",
        "COPY readers TO PROGRAM 'true'",
        "SELECT pg_read_file('/etc/hosts')",
        `SELECT pg_terminate_backend(${bootPid})`, // another login's session
        `REASSIGN OWNED BY ${role.owner} TO ${role.app}`,
        `DROP OWNED BY ${role.owner}`,
      ];
      for (const s of denied) expect(await sqlstate(app.unsafe(s)), s).toBe("42501");
      expect((await app`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('t_evil')`)[0].n).toBe(0);
      // A GRANT by a role without grant option is not an error in PostgreSQL (a warning, "no privileges were granted"): what matters is that it has no effect.
      await app.unsafe("GRANT SELECT ON readers TO PUBLIC");
      await app.unsafe(`GRANT TRUNCATE ON readers TO ${role.app}`); // not even to itself
      expect((await app`SELECT has_table_privilege(current_user, 'readers', 'TRUNCATE') AS t`)[0].t).toBe(false);
      expect((await app`SELECT count(*)::int AS n FROM pg_class c, aclexplode(c.relacl) a WHERE c.relname = 'readers' AND a.grantee = 0`)[0].n).toBe(0);
    });

    it("runs the application's own database code: allowances, leases, ledger, size, and the analytics retention", async () => {
      vi.stubEnv("DATABASE_URL", urlOf(role.app, pw.app, db1));
      globalThis.__glossDb = undefined; // the application's client is built from DATABASE_URL on first use
      const now = Date.UTC(2100, 5, 1, 12);
      const key = `rt-${run}`;
      await databaseAiStore.ping();
      expect(await databaseAiStore.quotaHit(key, 3_600_000, now)).toBe(1);
      await databaseAiStore.quotaRefund(key, 3_600_000, now);
      expect(await databaseAiStore.quotaReserve(`${key}-r`, 3_600_000, now, 5, 3)).toBe(3);
      await databaseAiStore.quotaRelease(`${key}-r`, 3_600_000, now, 2);
      expect(await databaseAiStore.acquireLease(key, "tok", 1000, now)).toBe(true);
      await databaseAiStore.releaseLease(key, "tok");
      expect((await databaseAiStore.reserve(`${key}-b`, 1000, { dailyMicro: 1e9, monthlyMicro: 1e9 }, 1000, now)).ok).toBe(true);
      await databaseAiStore.settle(`${key}-b`, { micro: 900, inputTokens: 1, outputTokens: 1, errors: 0 }, now);
      expect((await databaseAiStore.usage(now)).day.requests).toBeGreaterThanOrEqual(1);
      expect(await databaseAiStore.storageBytes!()).toBeGreaterThan(0);
      const app = as("app", db1);
      await app`INSERT INTO analytics_events (at, event, actor, actor_kind) SELECT 1 + g, 'landing_viewed', 'old-' || g, 'daily' FROM generate_series(1, 30) g`;
      expect(await deleteExpiredBatch(getDb() as never, 1_000, 10)).toBe(10);
      const r = await runRetention(Date.UTC(2026, 10, 3));
      expect(r.ok).toBe(true);
      expect(r.done).toBe(true);
      expect((await app`SELECT count(*)::int AS n FROM analytics_events WHERE actor LIKE 'old-%'`)[0].n).toBe(0);
      await app`DELETE FROM rate_hits WHERE key LIKE ${key + "%"}`;
      await app`DELETE FROM ai_ledger WHERE period = ${new Date(now).toISOString().slice(0, 13)}`;
      vi.unstubAllEnvs();
      globalThis.__glossDb = undefined;
    });
  });

  describe("the owner role", () => {
    it("cannot log in, and owns everything that exists, in the database that was migrated by the old login and in the one the migrator built", async () => {
      // refused either way: "not permitted to log in" (28000) on a server that trusts the connection, "invalid password" (28P01) when it asks for one first (scram, as in CI)
      expect(["28000", "28P01"]).toContain(await sqlstate(postgres(urlOf(role.owner, "x", db1), { max: 1, onnotice: () => {} }).unsafe("SELECT 1")));
      expect((await as("boot", db1)`SELECT rolcanlogin FROM pg_roles WHERE rolname = ${role.owner}`)[0].rolcanlogin).toBe(false);
      for (const d of [db1, db2]) {
        const c = as("boot", d);
        const others = await c`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'S') AND pg_get_userbyid(c.relowner) <> ${role.owner}`;
        expect(others, d).toEqual([]);
      }
    });

    it("stays reachable by the login that set it up (break glass): that login can act as the owner", async () => {
      const boot = as("boot", db1);
      await boot.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role.owner}`);
        await tx.unsafe("ALTER TABLE readers ADD COLUMN _break_glass int");
        await tx.unsafe("ALTER TABLE readers DROP COLUMN _break_glass");
      });
    });
  });

  describe("the migration role (what the build uses, on the direct endpoint)", () => {
    it("runs the migration tool's own migrator on the database the old login built: nothing to apply, nothing broken", async () => {
      const mig = as("mig", db1);
      const before = (await mig`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0].n;
      await migrate(drizzle(mig), { migrationsFolder: "drizzle" });
      expect((await mig`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0].n).toBe(before);
    });

    it("builds a whole database from nothing: every object it creates belongs to the owner role, and the runtime role can use it at once", async () => {
      const mig = as("mig", db2);
      expect((await mig`SELECT current_user, session_user`)[0]).toEqual({ current_user: role.owner, session_user: role.mig });
      await migrate(drizzle(mig), { migrationsFolder: "drizzle" });
      const c = as("boot", db2);
      expect((await c`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)[0].n).toBeGreaterThanOrEqual(12);
      expect(await c`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'S') AND pg_get_userbyid(c.relowner) <> ${role.owner}`).toEqual([]);
      const app = as("app", db2);
      await app`INSERT INTO readers (id) VALUES ('fresh')`; // default privileges: no grant was needed after the migration
      await app`DELETE FROM readers WHERE id = 'fresh'`;
      expect(psql("boot", db2, "scripts/sql/db-roles-verify.sql").status).toBe(0);
    });

    it("can alter and add tables like any later migration (and the runtime role gets them without a grant), but is not a superuser and cannot manage roles or the server", async () => {
      const mig = as("mig", db2);
      await mig.unsafe("CREATE TABLE later_migration (id int PRIMARY KEY, note text)");
      await mig.unsafe("ALTER TABLE readers ADD COLUMN later int");
      const app = as("app", db2);
      await app`INSERT INTO later_migration (id, note) VALUES (1, 'x')`;
      expect(await sqlstate(app.unsafe("ALTER TABLE later_migration ADD COLUMN evil int"))).toBe("42501");
      expect(await sqlstate(mig.unsafe("CREATE ROLE evil"))).toBe("42501");
      expect(await sqlstate(mig.unsafe("COPY readers TO PROGRAM 'true'"))).toBe("42501");
      expect(await sqlstate(mig.unsafe("SET ROLE " + role.boot))).toBe("42501");
      await mig.unsafe("ALTER TABLE readers DROP COLUMN later");
      await mig.unsafe("DROP TABLE later_migration");
    });

    it("is bounded: a migration that would wait behind a lock gives up after the lock timeout instead of queueing behind traffic", async () => {
      const mig = as("mig", db2);
      expect((await mig`SHOW lock_timeout`)[0].lock_timeout).toBe("10s");
    });
  });
});
