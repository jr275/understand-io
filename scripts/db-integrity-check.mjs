#!/usr/bin/env node
// Read-only integrity check of the application database. One transaction opened READ ONLY, a handful of SELECTs, nothing written.
//
//   DATABASE_URL=... node scripts/db-integrity-check.mjs            human-readable
//   DATABASE_URL=... node scripts/db-integrity-check.mjs --json     machine-readable
//
// Exit code 1 when there are orphaned rows or rows attached to another reader's document; 2 when it could not run. Run it with the operator's own credential
// (for production: the Neon connection string from the Neon console, not from this repository). The connection string is never printed.
import postgres from "postgres";
import { integrityReport, problemCount } from "./lib/integrity.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing was read.");
  process.exit(2);
}
const json = process.argv.includes("--json");
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
try {
  const report = await sql.begin("read only", (tx) => integrityReport(tx));
  const problems = problemCount(report);
  if (json) console.log(JSON.stringify({ ...report, problems }, null, 2));
  else {
    console.log("Integrity check (read-only)\n");
    for (const [table, c] of Object.entries(report.children)) console.log(`${c.label.padEnd(18)} ${String(c.total).padStart(7)} rows   orphaned: ${c.orphans}   on another reader's document: ${c.foreignOwner}   (${table})`);
    console.log(`\nDuplicate documents (same reader, same text): ${report.duplicates.groups} groups, ${report.duplicates.extraRows} extra rows`);
    const r = report.readers;
    console.log(`Readers: ${r.total} (${r.anonymous} without an account; ${r.anonymousWithoutDocuments} of those have no documents; ${r.emptyAnonymousOver30Days} of those are over 30 days old; ${r.anonymousOver90Days} anonymous in total over 90 days old)`);
    console.log("\nSize by table:");
    for (const s of report.sizes) console.log(`  ${s.table.padEnd(18)} ${(s.bytes / 1_048_576).toFixed(2).padStart(9)} MB`);
    console.log(`\n${problems === 0 ? "No orphaned or misattached rows." : `${problems} orphaned or misattached rows: see docs/ops/proposed-migrations/README.md before deleting anything.`}`);
  }
  process.exitCode = problems === 0 ? 0 : 1;
} catch (err) {
  console.error(`Could not run the check (${err?.code ?? err?.name ?? "error"}). Nothing was changed.`);
  process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
