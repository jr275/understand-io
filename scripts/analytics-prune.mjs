#!/usr/bin/env node
// Deletes analytics events past retention, in small bounded batches. For an operator or a scheduler; the same policy and the same SQL as the application
// (src/lib/server/analyticsRetention.ts). Run it with the operator's own credential: the connection string is read from DATABASE_URL and never printed.
//
//   DATABASE_URL=... node scripts/analytics-prune.mjs             dry run: says how many rows are past retention, deletes nothing
//   DATABASE_URL=... node scripts/analytics-prune.mjs --apply     deletes them, at most one run's limits (see below), and says whether any are left
//   --json  machine-readable output     --max-batches N  --max-ms N  override the limits of one run
//
// Policy (environment, as in the application): GLOSS_ANALYTICS_RETENTION_DAYS (120), GLOSS_ANALYTICS_PRUNE_BATCH (1000, 50 to 10000),
// GLOSS_ANALYTICS_PRUNE_MAX_BATCHES (20), GLOSS_ANALYTICS_PRUNE_MAX_MS (4000). A big backlog is worked off by running it again.
// Each batch is its own short transaction with a statement timeout and picks rows with FOR UPDATE SKIP LOCKED, so it is safe next to live traffic and
// next to another run. Exit code 0 when the run finished its work or hit its limits cleanly, 1 when a batch failed, 2 when it could not start.
import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : undefined);
const num = (name, fallback, lo, hi, override) => {
  const n = override ?? Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback;
};
const DAY_MS = 86_400_000;
const days = num("GLOSS_ANALYTICS_RETENTION_DAYS", 120, 1, 3650);
const batch = num("GLOSS_ANALYTICS_PRUNE_BATCH", 1000, 50, 10_000);
const maxBatches = num("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", 20, 1, 200, value("--max-batches"));
const maxMs = num("GLOSS_ANALYTICS_PRUNE_MAX_MS", 4000, 200, 20_000, value("--max-ms"));
const apply = flag("--apply");
const json = flag("--json");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing was read.");
  process.exit(2);
}
const say = (o, text) => console.log(json ? JSON.stringify(o) : text);
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
const cutoff = Date.now() - days * DAY_MS;
const started = Date.now();
try {
  if (!apply) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM analytics_events WHERE at < ${cutoff} LIMIT 100001) t`;
    say({ dryRun: true, retentionDays: days, expiredRows: n, capped: n > 100_000 }, `Dry run: ${n}${n > 100_000 ? "+" : ""} rows are past the ${days}-day retention. Nothing was deleted. Add --apply to delete them.`);
    process.exitCode = 0;
  } else {
    let deleted = 0;
    let batches = 0;
    let done = false;
    while (batches < maxBatches && Date.now() - started < maxMs) {
      const n = await sql.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = 2500`;
        const [{ n }] = await tx`
          WITH d AS (
            DELETE FROM analytics_events
            WHERE id IN (SELECT id FROM analytics_events WHERE at < ${cutoff} ORDER BY at LIMIT ${batch} FOR UPDATE SKIP LOCKED)
            RETURNING 1)
          SELECT count(*)::int AS n FROM d`;
        return n;
      });
      batches += 1;
      deleted += n;
      if (n < batch) {
        done = true;
        break;
      }
    }
    say({ dryRun: false, retentionDays: days, deleted, batches, done, ms: Date.now() - started }, `Deleted ${deleted} rows in ${batches} batch(es), ${Date.now() - started} ms. ${done ? "Nothing past retention is left." : "More may remain: run it again."}`);
    process.exitCode = 0;
  }
} catch (err) {
  const code = err?.code ?? err?.cause?.code;
  console.error(`The run failed (${code === "42P01" ? "the analytics table does not exist" : code === "57014" ? "a statement timed out" : (err?.name ?? "error")}). Nothing further was changed.`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
