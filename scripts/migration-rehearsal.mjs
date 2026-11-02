#!/usr/bin/env node
// Rehearse the pending migration on a COPY of the database, with the real production mechanism, and prove what it did. For the owner to run
// against a Neon BRANCH of production (a branch is a copy; production is not touched). It changes the database it is given, so it refuses to
// run unless told, in two ways, that this is not production.
//
//   REHEARSAL_DATABASE_URL=<connection string of the BRANCH> \
//     node scripts/migration-rehearsal.mjs --confirm-not-production --production-host <host of the production endpoint> [--rollback-test]
//
// It: (1) snapshots every table that exists (row count and a hash of the content, plus column, index and constraint definitions), (2) runs
// `scripts/vercel-build.mjs` with VERCEL_ENV=production and SKIP_NEXT_BUILD=1, which is exactly the step a production build runs before
// `next build`, (3) snapshots again and compares, (4) checks what was added, (5) runs the mechanism a second time (idempotence), and with
// --rollback-test (6) performs the documented rollback, checks the old tables are still identical, and re-applies. Exit 1 on any failed check.
// The connection string is never printed. Needs Node 24 and the repository's node_modules.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const url = process.env.REHEARSAL_DATABASE_URL;
const productionHost = value("--production-host");
if (!url) bail("REHEARSAL_DATABASE_URL is not set. Nothing was touched.");
if (!flag("--confirm-not-production") || !productionHost) bail("Refusing to run without --confirm-not-production and --production-host <host of the production endpoint>. Nothing was touched.");
let host;
try {
  host = new URL(url).hostname.toLowerCase();
} catch {
  bail("REHEARSAL_DATABASE_URL is not a connection string. Nothing was touched.");
}
if (host === productionHost.toLowerCase()) bail("This is the production host. Nothing was touched.");
function bail(msg) {
  console.error(msg);
  process.exit(2);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries;
const last = journal[journal.length - 1].tag;
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function tables() {
  return (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`).map((r) => r.tablename);
}
async function snapshot(names) {
  const out = {};
  for (const t of names) {
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') AS h FROM "${t}" x`);
    const [d] = await sql`SELECT md5(string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY ordinal_position)) AS h FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t}`;
    const [i] = await sql`SELECT coalesce(md5(string_agg(indexdef, '|' ORDER BY indexname)), '-') AS h FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${t}`;
    const [c] = await sql`SELECT coalesce(md5(string_agg(conname || ':' || pg_get_constraintdef(oid), '|' ORDER BY conname)), '-') AS h FROM pg_constraint WHERE conrelid = ('public.' || quote_ident(${t}))::regclass`;
    out[t] = { rows: r.n, content: r.h, columns: d.h, indexes: i.h, constraints: c.h };
  }
  return out;
}
const journalRows = async () => (await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0].n;
function mechanism() {
  const r = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], { env: { ...process.env, DATABASE_URL: url, VERCEL_ENV: "production", SKIP_NEXT_BUILD: "1" }, encoding: "utf8", timeout: 240_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const same = (a, b) => Object.keys(a).every((t) => JSON.stringify(a[t]) === JSON.stringify(b[t]));

try {
  const [{ version }] = await sql`SELECT version()`;
  const [{ db }] = await sql`SELECT current_database() AS db`;
  console.log(`Rehearsal target: database "${db}", ${version.split(" on ")[0]}. Migration under test: ${last}.\n`);
  const before = await tables();
  const hadIt = before.includes("analytics_events");
  const j0 = await journalRows();
  console.log(`Before: ${before.length} tables, ${j0} migrations applied (the repository has ${journal.length}).`);
  check("the database is one migration behind (otherwise this rehearsal proves nothing)", !hadIt && j0 === journal.length - 1, `applied ${j0} of ${journal.length}, table ${hadIt ? "present" : "absent"}`);
  const snapBefore = await snapshot(before);

  const run1 = mechanism();
  check("the production build step (scripts/vercel-build.mjs, VERCEL_ENV=production) succeeds", run1.ok);
  if (!run1.ok) console.log(run1.out.split(url).join("[hidden]").slice(-600));
  const after = await tables();
  const snapAfter = await snapshot(before);
  check(`all ${before.length} existing tables are identical (rows, content hash, columns, indexes, constraints)`, same(snapBefore, snapAfter));
  const added = after.filter((t) => !before.includes(t));
  check("the only table added is analytics_events, and none was removed", added.length === 1 && added[0] === "analytics_events" && before.every((t) => after.includes(t)), added.join(","));
  const [{ n: rows }] = await sql`SELECT count(*)::int AS n FROM analytics_events`;
  check("analytics_events is empty", rows === 0);
  const idx = (await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'analytics_events' ORDER BY 1`).map((r) => r.indexname);
  check("its indexes are the primary key and the three created", JSON.stringify(idx) === JSON.stringify(["analytics_events_actor_idx", "analytics_events_at_idx", "analytics_events_event_idx", "analytics_events_pkey"]), idx.join(","));
  const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analytics_events' ORDER BY ordinal_position`).map((r) => r.column_name);
  check("its columns are the ones in the schema", JSON.stringify(cols) === JSON.stringify(["id", "at", "event", "actor", "actor_kind", "route", "props", "channel", "campaign", "ref"]), cols.join(","));
  const fks = await sql`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND (conrelid = 'public.analytics_events'::regclass OR confrelid = 'public.analytics_events'::regclass)`;
  check("it has no foreign key to or from any other table", fks[0].n === 0);
  check("exactly one migration was recorded", (await journalRows()) === j0 + 1, `${j0} -> ${await journalRows()}`);

  const run2 = mechanism();
  const snapAgain = await snapshot(before);
  check("running it again is a no-op (idempotent): same tables, same content, same migration count", run2.ok && same(snapAfter, snapAgain) && (await journalRows()) === j0 + 1 && (await tables()).length === after.length);

  if (flag("--rollback-test")) {
    console.log("\nRollback test (the documented operational rollback, on this copy):");
    await sql.begin(async (tx) => {
      await tx`DROP TABLE analytics_events`;
      await tx`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`;
    });
    check("after the rollback the database is as it was before: same tables, same content", JSON.stringify(await tables()) === JSON.stringify(before) && same(snapBefore, await snapshot(before)) && (await journalRows()) === j0);
    const run3 = mechanism();
    check("the migration applies again after a rollback", run3.ok && (await tables()).includes("analytics_events") && (await journalRows()) === j0 + 1);
  }
} catch (err) {
  console.error(`The rehearsal could not finish (${err?.code ?? err?.name ?? "error"}). Check the connection and that the database is a copy one migration behind.`);
  results.push(false);
} finally {
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `${failed} check(s) FAILED` : `All ${results.length} checks passed`}.`);
process.exit(failed ? 1 : 0);
