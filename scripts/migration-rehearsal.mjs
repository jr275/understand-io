#!/usr/bin/env node
// Rehearse the pending migration on a COPY of the database, with the real production mechanism, and prove what it did. For the owner to run
// against a Neon BRANCH of production (a branch is a copy; production is not touched). It changes the database it is given, so it refuses to
// run unless the guard (scripts/lib/rehearsal-guard.mjs) says yes. The guard is fail-closed and runs before anything else: no connection is
// opened and no file is read until it has passed.
//
//   REHEARSAL_DATABASE_URL=<connection string of the STAGING BRANCH> \
//     node scripts/migration-rehearsal.mjs --confirm-not-production \
//       --staging-branch staging-0007 --staging-endpoint <endpoint id of the branch> \
//       --production-endpoint <production endpoint id or host> [--production-endpoint ...] \
//       --confirm staging-0007@<endpoint id of the branch> [--rollback-test] [--end-rolled-back]
//   --guard-only   check the inputs and stop: no connection, nothing touched (also accepts the .invalid test domain)
//   --local        a disposable database on this machine instead (host localhost, database gloss_<tag>_<number> or rehearsal_<name>)
//
// It: (1) snapshots every table that exists (row count and a hash of the content, plus column, index and constraint definitions), (2) runs
// `scripts/vercel-build.mjs` with VERCEL_ENV=production and SKIP_NEXT_BUILD=1, which is exactly the step a production build runs before
// `next build`, (3) snapshots again and compares, (4) checks what was added, (5) runs the mechanism a second time (idempotence), and with
// --rollback-test (6) performs the documented rollback, checks the old tables are still identical, and re-applies. With --end-rolled-back it then rolls back once
// more and leaves the copy one migration behind, so the same branch can be rehearsed again through another kind of connection string (pooled or direct).
// It STOPS, having changed nothing, if the database is not exactly one migration behind (a database that already has the table is never touched).
// The rollback drops only public.analytics_events, only if it is empty, and removes exactly one migration record, in one transaction.
// Exit 1 on any failed check, 2 when the guard refuses. A Neon endpoint that is asleep wakes on the first connection: the script waits and retries.
// The connection string is never printed. Needs Node 24 and the repository's node_modules.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { DRY_RUN_SUFFIXES, GuardError, NEON_SUFFIXES, assertDriverMatches, checkLocalTarget, checkRehearsalTarget, cleanChildEnv, maskEndpoint } from "./lib/rehearsal-guard.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1] ?? ""] : []));
const value = (n) => values(n)[0];
function bail(msg) {
  console.error(msg);
  process.exit(2);
}

// Fail closed, before anything else. A refusal here has touched nothing.
if (flag("--production-host")) bail("--production-host is no longer accepted: a host string cannot identify production (the pooled and the direct form of one endpoint differ). Use --production-endpoint, --staging-branch, --staging-endpoint and --confirm (docs/ops/neon-staging-runbook.md). Nothing was touched.");
if (!flag("--confirm-not-production")) bail("Refusing to run without --confirm-not-production. Nothing was touched.");
const url = process.env.REHEARSAL_DATABASE_URL;
let target;
try {
  target = flag("--local")
    ? checkLocalTarget({ connectionString: url })
    : checkRehearsalTarget(
        { connectionString: url, branch: value("--staging-branch"), endpoint: value("--staging-endpoint"), productionEndpoints: values("--production-endpoint"), confirmation: value("--confirm") },
        { suffixes: flag("--guard-only") ? DRY_RUN_SUFFIXES : NEON_SUFFIXES },
      );
} catch (err) {
  bail(err instanceof GuardError ? `Refused (${err.code}): ${err.message} Nothing was touched.` : "Refused: the guard could not decide. Nothing was touched.");
}
const targetLabel = target.mode === "neon" ? `branch ${target.branch}, endpoint ${maskEndpoint(target.endpointId)}, ${target.pooled ? "pooled" : "direct"}` : `local database ${target.database}`;
if (flag("--guard-only")) {
  console.log(`Guard passed: ${targetLabel}. No connection was made and nothing was touched.`);
  process.exit(0);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries;
const lastEntry = journal[journal.length - 1];
const last = lastEntry.tag;
// The rollback below is written for this one migration. Any other last migration means this script is out of date: stop.
if (last !== "0007_analytics_events") bail(`The last migration is ${last}, but this rehearsal's rollback is written only for 0007_analytics_events. Nothing was touched.`);
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30, idle_timeout: 5 });
try {
  assertDriverMatches(sql.options, target);
} catch (err) {
  await sql.end({ timeout: 1 });
  bail(`Refused (${err.code}): ${err.message}`);
}
const pooled = target.mode === "neon" && target.pooled;
class Halt extends Error {}
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
  const r = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], { env: cleanChildEnv(process.env, { DATABASE_URL: url, VERCEL_ENV: "production", SKIP_NEXT_BUILD: "1" }), encoding: "utf8", timeout: 240_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const same = (a, b) => Object.keys(a).every((t) => JSON.stringify(a[t]) === JSON.stringify(b[t]));

/**
 * The documented operational rollback, on the copy. Written so it cannot do more than that: one named table in one named schema (no search path),
 * only if it is empty, no CASCADE, and exactly one migration record (the one for this migration, by its journal timestamp) removed, all in one
 * transaction that is abandoned if either condition fails. It is reachable only after the guard has passed and the database was found one migration behind.
 */
async function rollbackOnCopy() {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.analytics_events`;
    if (n !== 0) throw new Halt("Refusing to drop public.analytics_events: it holds rows. Nothing was dropped.");
    await tx`DROP TABLE public.analytics_events`;
    const gone = await tx`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${String(lastEntry.when)}::bigint RETURNING id`;
    if (gone.length !== 1) throw new Halt(`Expected to remove exactly one migration record and found ${gone.length}; the transaction was rolled back.`);
  });
}

async function connect() {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`Waiting for the database to wake up (attempt ${attempt} of 3)...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

try {
  await connect();
  const [{ version }] = await sql`SELECT version()`;
  const [{ db }] = await sql`SELECT current_database() AS db`;
  console.log(`Rehearsal target: ${targetLabel}, database "${db}", ${version.split(" on ")[0]}. Migration under test: ${last}.\n`);
  if (pooled) console.log("Note: this is a pooled connection string. Production's build migrates with the DATABASE_URL stored in Vercel; rehearse with the same kind of string (run the rehearsal once with each kind if unsure).\n");
  const before = await tables();
  const hadIt = before.includes("analytics_events");
  const j0 = await journalRows();
  console.log(`Before: ${before.length} tables, ${j0} migrations applied (the repository has ${journal.length}).`);
  const oneBehind = !hadIt && j0 === journal.length - 1;
  check("the database is one migration behind (otherwise this rehearsal proves nothing)", oneBehind, `applied ${j0} of ${journal.length}, table ${hadIt ? "present" : "absent"}`);
  if (!oneBehind) throw new Halt("Stopped before changing anything: this database is not exactly one migration behind, so it is not a copy this rehearsal may touch. Nothing was applied, dropped or deleted.");
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
    await rollbackOnCopy();
    check("after the rollback the database is as it was before: same tables, same content", JSON.stringify(await tables()) === JSON.stringify(before) && same(snapBefore, await snapshot(before)) && (await journalRows()) === j0);
    const run3 = mechanism();
    check("the migration applies again after a rollback", run3.ok && (await tables()).includes("analytics_events") && (await journalRows()) === j0 + 1);
    if (flag("--end-rolled-back")) {
      await rollbackOnCopy();
      check("left one migration behind again, as it was found (so the branch can be rehearsed again)", JSON.stringify(await tables()) === JSON.stringify(before) && same(snapBefore, await snapshot(before)) && (await journalRows()) === j0);
    }
  }
} catch (err) {
  if (err instanceof Halt) console.error(err.message);
  else console.error(`The rehearsal could not finish (${err?.code ?? err?.name ?? "error"}). Check the connection and that the database is a copy one migration behind.`);
  results.push(false);
} finally {
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `${failed} check(s) FAILED` : `All ${results.length} checks passed`}.`);
process.exit(failed ? 1 : 0);
