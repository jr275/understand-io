#!/usr/bin/env node
// The growth report: the funnel, active users, retention and channels, computed from the product's own events. Read-only (one SELECT), the
// connection string is never printed, and nothing in the events can hold what anyone read or wrote (docs/product/analytics.md).
//
//   DATABASE_URL=... node scripts/growth-report.mjs [days]           (default 30; text)
//   DATABASE_URL=... node scripts/growth-report.mjs 30 --json        (the same numbers as JSON)
//
// Run it with the operator's own credential. The measures are `src/lib/analytics/metrics.ts`, which the unit tests run on synthetic events.
// Money measures (free-to-paid, churn, CAC, LTV/CAC, margin by plan) need billing and spend inputs that do not exist yet, so they are listed
// as "not measurable" rather than printed as zero. Node 24 runs the TypeScript module directly (type stripping).
import postgres from "postgres";
// Node says the TypeScript module has no "type" (true, and harmless); that one notice is silenced so the report is only the report.
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes("Module type of file") ? undefined : emit.call(process, w, ...a));
const { DAY, activation, byChannel, funnel, perActiveUser, retention, wauMau, weeklyRetrievalRate } = await import("../src/lib/analytics/metrics.ts");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing was read.");
  process.exit(2);
}
const json = process.argv.includes("--json");
const days = Math.min(Math.max(Math.floor(Number(process.argv.find((a) => /^\d+$/.test(a)))) || 30, 1), 365);
const pct = (v) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v === null || v === undefined ? "n/a" : Number.isInteger(v) ? String(v) : v.toFixed(2));

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
try {
  const to = Date.now();
  const from = to - days * DAY;
  // Retention needs the cohorts' own history, so the read starts 91 days before the window (and never past what retention keeps).
  const rows = (
    await sql`SELECT event, actor, actor_kind AS "actorKind", at::float8 AS at, props, channel FROM analytics_events WHERE at >= ${from - 91 * DAY} ORDER BY at`
  ).map((r) => ({ ...r, at: Number(r.at) }));

  const report = {
    window: { days, from: new Date(from).toISOString(), to: new Date(to).toISOString(), events: rows.length },
    funnel: funnel(rows, from, to),
    activeUsers: { ...wauMau(rows, to), ...perActiveUser(rows, from, to) },
    weeklyKnowledgeRetrieval: weeklyRetrievalRate(rows, to - 7 * DAY),
    activation: activation(rows, to),
    retention: retention(rows, to),
    channels: byChannel(rows, from, to),
    notMeasurable: ["free-to-paid conversion", "monthly paid churn", "CAC by channel", "LTV/CAC", "gross margin by plan"].map((m) => `${m}: needs billing events and acquisition spend (not built)`),
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const f = report.funnel;
    const a = report.activeUsers;
    console.log(`Growth report, last ${days} days (UTC), ${report.window.events} events read\n`);
    console.log("Funnel");
    console.log(`  visits (visitor-days)        ${f.visits}`);
    console.log(`  registrations                ${f.registrations}   visit -> registration ${pct(f.visitToRegistration)}`);
    console.log(`  first saves                  ${f.firstSaves}   registration -> first save ${pct(f.registrationToFirstSave)}`);
    console.log(`  first retrievals             ${f.firstRetrievals}   first save -> first retrieval ${pct(f.firstSaveToFirstRetrieval)}`);
    console.log("\nActive readers");
    console.log(`  WAU ${a.wau}   MAU ${a.mau}   stickiness ${pct(a.stickiness)}`);
    console.log(`  active in window ${a.activeUsers}   saves per active user ${num(a.savesPerActiveUser)}   AI questions per active user ${num(a.aiQuestionsPerActiveUser)}`);
    const w = report.weeklyKnowledgeRetrieval;
    console.log(`  weekly knowledge retrieval rate (last 7 days) ${pct(w.rate)}  (${w.retrievers} of ${w.active} active)`);
    console.log(`  activation (active within a day of first seen) ${pct(report.activation.rate)}  (${report.activation.activated} of ${report.activation.eligible})`);
    console.log("\nRetention (active exactly N days after first seen; young cohorts left out)");
    for (const r of report.retention) console.log(`  D${String(r.day).padEnd(3)} ${pct(r.rate).padStart(7)}  (${r.retained} of ${r.eligible})`);
    console.log("\nChannels");
    if (!report.channels.length) console.log("  (no visits in this window)");
    for (const c of report.channels) console.log(`  ${c.channel.padEnd(28)} visits ${String(c.visits).padStart(5)}  registrations ${String(c.registrations).padStart(4)}  ${pct(c.visitToRegistration)}`);
    console.log("\nNot measurable yet");
    for (const m of report.notMeasurable) console.log(`  ${m}`);
    console.log("\nCounts of days older than the retention window are not in the table; cohorts are only as old as the events kept.");
  }
} catch (err) {
  console.error(`Could not read the events (${err?.code ?? err?.name ?? "error"}). Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
