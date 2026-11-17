#!/usr/bin/env node
// Restores a backup made by scripts/db-backup.mjs into a NEW EMPTY database and proves the restore against the manifest. It never touches the source.
//
//   TARGET_DATABASE_URL='<DIRECT connection string of an empty database>' node scripts/db-restore-verify.mjs <understand-....dump> [--pg-bin <dir>] [--prompt-password]
//   (--prompt-password: give a URL without the password and type it at a hidden prompt, so it never enters the shell history)
//
// It refuses (and changes nothing) when:
//   7  the dump does not match its checksum, or the manifest is unreadable            (nothing is restored)
//   8  the target is the database the backup came from, or is not empty
//   4  the target is a pooled endpoint
//   3  the target server is older than the one the backup came from, or no pg_restore new enough was found
// The restore runs in a single transaction (all or nothing). Then it compares with the manifest: row counts and content digests of every table, indexes,
// constraints, sequences, column definitions and extensions, and exits 7 listing every difference. Exit 0 means the restored copy is identical in all of
// those. The short-lived tables are expected to be empty (their rows are not backed up).
import process from "node:process";
import { BackupError, EXIT, parseConnection, promptHidden, redact, runRestoreVerify } from "./lib/pgBackup.mjs";

const args = process.argv.slice(2);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : "");
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--pg-bin");
if (!file || args.includes("--help")) {
  console.log("usage: TARGET_DATABASE_URL='<direct connection string of an empty database>' node scripts/db-restore-verify.mjs <file.dump> [--pg-bin <dir>]");
  process.exit(file ? 0 : EXIT.USAGE);
}
let url = process.env.TARGET_DATABASE_URL ?? "";
try {
  if (!url) throw new BackupError(EXIT.USAGE, "TARGET_DATABASE_URL is not set (DATABASE_URL is deliberately not used here: a restore must never default to the live database).");
  const c = parseConnection(url);
  if (args.includes("--prompt-password")) {
    const u = new URL(url);
    u.password = await promptHidden(`password for ${c.user} (hidden): `);
    url = u.toString();
  }
  const r = await runRestoreVerify({ file, targetUrl: url, explicitBin: value("--pg-bin") || process.env.PG_BIN || "", log: (m) => console.log(`  ${m}`) });
  for (const k of r.checks) console.log(`  ${k.ok ? "PASS" : "FAIL"}  ${k.what}`);
  console.log(`Restore verified: ${r.tables} tables, ${r.rows} rows, restored in ${r.seconds.toFixed(1)} s on PostgreSQL ${r.targetMajor}. The restored copy is identical to the backup in everything compared.`);
} catch (e) {
  const msg = e instanceof BackupError ? e.message : `unexpected failure: ${redact(e?.message ?? e, [url])}`;
  console.error(`The restore did not pass: ${msg}`);
  process.exit(e instanceof BackupError ? e.code : 1);
}
