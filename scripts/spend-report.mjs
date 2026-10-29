#!/usr/bin/env node
// What the shared AI key has cost, read from the ledger. Read-only: one SELECT, nothing is written, the connection string is never printed.
//
//   DATABASE_URL=... node scripts/spend-report.mjs [days]        (default 14 days)
//
// Run it with the operator's own credential (for production: the Neon connection string, from the Neon console, not from this repository).
// The amounts are estimates from the price table (or GLOSS_PRICE_IN_PER_M / GLOSS_PRICE_OUT_PER_M); the provider's invoice is the truth.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing was read.");
  process.exit(2);
}
const days = Math.min(Math.max(Math.floor(Number(process.argv[2])) || 14, 1), 90);
const budget = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name]?.trim() !== "" && process.env[name] !== undefined ? n : fallback;
};
const dailyLimit = budget("GLOSS_BUDGET_DAILY_USD", 3);
const monthlyLimit = budget("GLOSS_BUDGET_MONTHLY_USD", 40);
const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(4)}`;

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
try {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await sql`
    SELECT substr(period, 1, 10) AS day,
           sum(spent_micro)::bigint AS spent, sum(requests)::int AS requests, sum(errors)::int AS errors,
           sum(input_tokens)::bigint AS tin, sum(output_tokens)::bigint AS tout
    FROM ai_ledger WHERE substr(period, 1, 10) >= ${since} GROUP BY 1 ORDER BY 1`;
  const month = new Date().toISOString().slice(0, 7);
  const [m] = await sql`
    SELECT coalesce(sum(spent_micro), 0)::bigint AS spent, coalesce(sum(requests), 0)::int AS requests, coalesce(sum(errors), 0)::int AS errors
    FROM ai_ledger WHERE substr(period, 1, 7) = ${month}`;

  console.log(`Shared AI spend, last ${days} days (UTC days; estimates)\n`);
  console.log("day         spent     of daily   requests  errors  tokens in/out");
  for (const r of rows) {
    const pct = dailyLimit > 0 ? `${Math.round((Number(r.spent) / 1e6 / dailyLimit) * 100)}%` : "-";
    console.log(`${r.day}  ${usd(r.spent).padStart(8)}  ${pct.padStart(8)}  ${String(r.requests).padStart(8)}  ${String(r.errors).padStart(6)}  ${r.tin}/${r.tout}`);
  }
  if (rows.length === 0) console.log("(no requests in this period)");
  const mp = monthlyLimit > 0 ? `${Math.round((Number(m.spent) / 1e6 / monthlyLimit) * 100)}%` : "-";
  console.log(`\nThis month (${month}): ${usd(m.spent)} of $${monthlyLimit.toFixed(2)} (${mp}), ${m.requests} requests, ${m.errors} errors`);
  console.log(`Limits in force for this report: $${dailyLimit.toFixed(2)} per day, $${monthlyLimit.toFixed(2)} per month (GLOSS_BUDGET_* if set in this shell, else the defaults).`);
} catch (err) {
  console.error(`Could not read the ledger (${err?.code ?? err?.name ?? "error"}). Nothing was changed.`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
