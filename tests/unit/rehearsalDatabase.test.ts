// The rehearsal script against a REAL but disposable local PostgreSQL (DATABASE_URL, host localhost or 127.0.0.1 only; skipped otherwise). The test
// creates its own database gloss_rh_<time>, runs the script in `--local` mode against it, and drops it afterwards. It never touches Neon and never
// touches the database in DATABASE_URL itself. What it proves: the full rehearsal passes on a copy one migration behind (13 checks), and the script
// STOPS, having changed nothing, on a database that is not exactly one migration behind, in particular one where 0007 is already applied and holds rows.
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const admin = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(u.hostname) ? u : null;
  } catch {
    return null;
  }
})();
const stamp = Date.now();
const dbUrl = (name: string) => `postgresql://${admin?.username || "postgres"}:${decodeURIComponent(admin?.password || "x")}@${admin?.hostname}:${admin?.port || "5432"}/${name}`;
const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const envOf = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv; // the project's ProcessEnv type insists on NODE_ENV
const names = { behind: `gloss_rh_${stamp}`, applied: `gloss_rh_${stamp + 1}`, empty: `gloss_rh_${stamp + 2}` };

function migrate(url: string) {
  const r = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: envOf({ ...base, DATABASE_URL: url }), encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`migrate failed: ${(r.stdout ?? "") + (r.stderr ?? "")}`.replaceAll(url, "[hidden]").slice(0, 400));
}
function rehearse(url: string, extra: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["scripts/migration-rehearsal.mjs", "--confirm-not-production", "--local", ...extra], { env: envOf({ ...base, REHEARSAL_DATABASE_URL: url, ...env }), encoding: "utf8", timeout: 170_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
async function state(url: string) {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const tables = (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`).map((r) => r.tablename as string);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    const rows = tables.includes("analytics_events") ? (await sql`SELECT count(*)::int AS n FROM public.analytics_events`)[0].n : null;
    return { tables, journal: n as number, rows: rows as number | null };
  } finally {
    await sql.end({ timeout: 2 });
  }
}
async function exec(url: string, text: string) {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.unsafe(text);
  } finally {
    await sql.end({ timeout: 2 });
  }
}
const ROLLBACK_0007 = `DROP TABLE public.analytics_events; DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);`;

describe.skipIf(!admin)("migration-rehearsal.mjs on a disposable local PostgreSQL", () => {
  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      for (const n of Object.values(names)) await sql.unsafe(`CREATE DATABASE ${n}`);
    } finally {
      await sql.end({ timeout: 2 });
    }
    for (const n of Object.values(names)) migrate(dbUrl(n)); // every migration of the repository, 0007 included
    await exec(dbUrl(names.behind), ROLLBACK_0007); // production's state before 0007: one migration behind
    await exec(dbUrl(names.applied), `INSERT INTO public.analytics_events (at, event, actor, actor_kind) VALUES (1, 'landing_viewed', 'a', 'daily')`); // 0007 applied and holding a row
    // names.empty: 0007 applied, empty table
  }, 300_000);
  afterAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      for (const n of Object.values(names)) await sql.unsafe(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    } finally {
      await sql.end({ timeout: 2 });
    }
  }, 60_000);

  it("a copy one migration behind: all 13 checks pass, with the rollback test, and it is left one migration behind (ambient database variables are not inherited)", async () => {
    const before = await state(dbUrl(names.behind));
    expect(before.tables).not.toContain("analytics_events");
    const r = rehearse(dbUrl(names.behind), ["--rollback-test", "--end-rolled-back"], { PGHOST: "unreachable.invalid", PGPORT: "1", PGDATABASE: "nowhere", DATABASE_URL: "postgresql://u:p@unreachable.invalid/x", NEON_API_KEY: "x" });
    expect(r.out).toContain("All 13 checks passed");
    expect(r.out.match(/^PASS /gm)?.length).toBe(13);
    expect(r.status).toBe(0);
    expect(r.out).toContain("local database gloss_rh_");
    expect(r.out).not.toContain("postgresql://");
    expect(await state(dbUrl(names.behind))).toEqual(before); // exactly as found
  }, 200_000);

  it("a second run on the same copy passes again (it was left one migration behind)", () => {
    const r = rehearse(dbUrl(names.behind), ["--rollback-test", "--end-rolled-back"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("All 13 checks passed");
  }, 200_000);

  it("STOPS on a database where 0007 is already applied and holds a row: nothing applied, nothing dropped, nothing deleted", async () => {
    const before = await state(dbUrl(names.applied));
    expect(before).toMatchObject({ journal: 8, rows: 1 });
    const r = rehearse(dbUrl(names.applied), ["--rollback-test", "--end-rolled-back"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Stopped before changing anything");
    expect(r.out).not.toContain("PASS  the production build step");
    expect(await state(dbUrl(names.applied))).toEqual(before); // table, row and journal intact
  }, 100_000);

  it("STOPS on a database where 0007 is already applied and the table is empty", async () => {
    const before = await state(dbUrl(names.empty));
    expect(before).toMatchObject({ journal: 8, rows: 0 });
    const r = rehearse(dbUrl(names.empty), ["--rollback-test"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Stopped before changing anything");
    expect(await state(dbUrl(names.empty))).toEqual(before);
  }, 100_000);

  it("never runs on the developer database name, even when it exists on the same server", () => {
    const r = rehearse(dbUrl("gloss"), ["--rollback-test"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("E_LOCAL_DB");
    expect(r.out).toContain("Nothing was touched");
  });
});
