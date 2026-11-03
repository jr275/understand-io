#!/usr/bin/env node
// A logical backup of the database into one file, with a checksum and a manifest that lets a restore be proved. Read-only (pg_dump only reads).
//
//   BACKUP_DATABASE_URL='<DIRECT connection string>' node scripts/db-backup.mjs [--out ./backups] [--pg-bin <dir>] [--no-digest]
//   (DATABASE_URL is used when BACKUP_DATABASE_URL is not set; a URL without a password asks for it at a hidden prompt)
//
// Before it writes anything it checks, and stops with a clear message and its own exit code when:
//   2  usage: no connection string, not a URL
//   3  the pg_dump found is older than the server (it would refuse, or write a dump that cannot be trusted): it says which versions it found
//   4  the endpoint is the pooled one (host name contains -pooler): pg_dump needs the direct endpoint
//   5  the database cannot be reached (the message never holds the connection string)
//   6  pg_dump failed, or the file it wrote is unreadable or lacks the data of a table that had rows
// It writes understand-<UTC time>.dump (custom format, no owners, no grants), .sha256 and .manifest.json next to it (mode 0600), counted in the same
// snapshot as the dump: row counts and content digests of every table, the indexes, constraints, sequences and column definitions. The files are NOT encrypted
// and hold every reader's text: keep them in the password manager's vault or an encrypted volume, and delete them on a schedule.
// The short-lived tables (rate counters, leases, reservations) are in the schema but their rows are not backed up.
// Restore, and prove it, into a NEW empty database: node scripts/db-restore-verify.mjs (docs/ops/disaster-recovery.md).
import process from "node:process";
import { BackupError, EXIT, parseConnection, promptHidden, redact, runBackup } from "./lib/pgBackup.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : "");
if (flag("--help") || flag("-h")) {
  console.log("usage: BACKUP_DATABASE_URL='<direct connection string>' node scripts/db-backup.mjs [--out <dir>] [--pg-bin <dir>] [--no-digest]");
  process.exit(0);
}
const positional = args.find((a, i) => !a.startsWith("--") && !["--out", "--pg-bin"].includes(args[i - 1]));
const outDir = value("--out") || positional || "./backups";
const explicitBin = value("--pg-bin") || process.env.PG_BIN || "";

let url = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL || "";
try {
  if (!url) throw new BackupError(EXIT.USAGE, "BACKUP_DATABASE_URL (or DATABASE_URL) is not set. Nothing was read.");
  const c = parseConnection(url);
  if (!c.password && !process.env.PGPASSWORD) {
    const u = new URL(url);
    u.password = await promptHidden(`password for ${c.user}: `);
    url = u.toString();
  }
  const r = await runBackup({ url, outDir, explicitBin, digest: !flag("--no-digest"), log: (m) => console.log(`  ${m}`) });
  console.log(`Backup written: ${r.file}`);
  console.log(`  ${r.bytes} bytes, sha256 ${r.sha256}`);
  console.log(`  ${r.tables} tables counted, ${r.tablesWithData} with data in the file; server PostgreSQL ${r.serverMajor}; made with ${r.client}`);
  console.log("  next: restore it into a NEW empty database and prove it: node scripts/db-restore-verify.mjs <file>");
} catch (e) {
  const msg = e instanceof BackupError ? e.message : `unexpected failure: ${redact(e?.message ?? e, [url])}`;
  console.error(`The backup did not run: ${msg}`);
  process.exit(e instanceof BackupError ? e.code : 1);
}
