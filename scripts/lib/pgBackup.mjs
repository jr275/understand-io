// The engine behind scripts/db-backup.mjs and scripts/db-restore-verify.mjs: a logical backup of the database that refuses to run when it could not be
// restored, and a restore that proves what it restored. Nothing here ever prints, logs or passes on a command line a connection string or a password:
// credentials travel to pg_dump and pg_restore only in their environment (PGPASSWORD and friends), and every message that reaches a person or a log goes
// through `redact`.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import postgres from "postgres";

/** Exit codes of the two commands. Anything else is a bug in the tool, not a verdict about the backup. */
export const EXIT = { USAGE: 2, VERSION: 3, POOLED: 4, CONNECT: 5, DUMP: 6, VERIFY: 7, TARGET: 8 };

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/** Tables whose rows are short-lived counters, leases and reservations: not backed up (their schema is). Restoring them would revive stale locks. */
export const EXCLUDED_DATA = ["rate_hits", "ai_leases", "ai_reservations"];
const SCHEMAS = ["public", "drizzle"];

/* ------------------------------------------------------------------ credentials and endpoints */

export function parseConnection(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new BackupError(EXIT.USAGE, "the connection string is not a valid URL (postgres://user:password@host/database)");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new BackupError(EXIT.USAGE, "the connection string must start with postgres:// or postgresql://");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!host) throw new BackupError(EXIT.USAGE, "the connection string has no host");
  if (!database) throw new BackupError(EXIT.USAGE, "the connection string names no database");
  return {
    host,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    sslmode: u.searchParams.get("sslmode") ?? "",
    channelBinding: u.searchParams.get("channel_binding") ?? "",
  };
}

/** A pooler (PgBouncer in transaction mode) does not support what pg_dump and pg_restore need. Neon's is `ep-...-pooler.<region>...`. */
export const isPooledHost = (host) => /(^|[-.])pooler([-.]|$)/i.test(host.split(".").slice(0, 2).join("."));
export const isLocalHost = (host) => host === "localhost" || host === "::1" || host === "127.0.0.1" || host.endsWith(".localhost") || host.startsWith("/");

/** A short fingerprint of where a database is (host, port, name), so a backup can say what it came from without containing the address. */
export const endpointFingerprint = (c) => createHash("sha256").update(`${c.host.toLowerCase()}|${c.port}|${c.database}`).digest("hex").slice(0, 12);

/** The environment the PostgreSQL client tools read. The password is only ever here. */
export function toolEnv(c, base = process.env) {
  const sslmode = c.sslmode || (isLocalHost(c.host) ? "prefer" : "require");
  const env = { ...base, PGHOST: c.host, PGPORT: c.port, PGUSER: c.user, PGDATABASE: c.database, PGSSLMODE: sslmode, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "understand-backup" };
  if (c.password) env.PGPASSWORD = c.password;
  else delete env.PGPASSWORD;
  if (c.channelBinding) env.PGCHANNELBINDING = c.channelBinding;
  for (const k of ["DATABASE_URL", "BACKUP_DATABASE_URL", "TARGET_DATABASE_URL", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"]) delete env[k];
  return env;
}

/** Replaces every secret and every connection string in a text. `secrets` are the literal values to hide (the password, its decoded form, the URL). */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && String(s).length >= 3) out = out.split(String(s)).join("[hidden]");
  return out.replace(/postgres(ql)?:\/\/[^\s"'<>)]+/gi, "<url>").replace(/(password|PGPASSWORD)\s*[=:]\s*\S+/gi, "$1=[hidden]");
}
export const secretsOf = (url, c) => [url, c?.password, c?.password && encodeURIComponent(c.password), c?.user && `${c.user}:`];

const sslOption = (c) => {
  const m = c.sslmode || (isLocalHost(c.host) ? "prefer" : "require");
  return m === "disable" ? false : m === "prefer" || m === "allow" ? "prefer" : "require";
};

async function open(url, c, secrets) {
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 20, onnotice: () => {}, ssl: sslOption(c) });
  try {
    const [r] = await sql`SELECT current_setting('server_version_num')::int AS num, version() AS version, current_database() AS db, current_user AS usr, current_setting('server_encoding') AS enc`;
    return { sql, serverMajor: Math.floor(r.num / 10000), serverNum: r.num, version: String(r.version).split(" on ")[0], user: r.usr, encoding: r.enc };
  } catch (e) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw new BackupError(EXIT.CONNECT, `cannot connect to the database: ${redact(e?.code ? `${e.code} ${e.message}` : (e?.message ?? e), secrets)}`);
  }
}

/* ------------------------------------------------------------------ client tools */

export const parseClientMajor = (versionOutput) => {
  const m = /\(PostgreSQL\)\s+(\d+)/.exec(String(versionOutput)) ?? /\b(\d{1,2})(?:\.\d+|devel|beta|rc)/.exec(String(versionOutput));
  return m ? Number(m[1]) : null;
};

/** Where PostgreSQL client tools are usually found, besides the PATH. */
export function defaultToolDirs(env = process.env) {
  const dirs = [];
  for (const d of (env.PATH ?? "").split(":")) if (d) dirs.push(d);
  for (const base of ["/opt/homebrew/opt", "/usr/local/opt"]) {
    if (existsSync(base)) for (const n of readdirSync(base)) if (/^(postgresql|libpq)(@\d+)?$/.test(n)) dirs.push(join(base, n, "bin"));
  }
  for (const base of ["/usr/lib/postgresql", "/usr/pgsql"]) {
    if (existsSync(base)) for (const n of readdirSync(base)) dirs.push(join(base, n, "bin"));
  }
  if (existsSync("/Applications/Postgres.app/Contents/Versions")) {
    for (const n of readdirSync("/Applications/Postgres.app/Contents/Versions")) dirs.push(join("/Applications/Postgres.app/Contents/Versions", n, "bin"));
  }
  return dirs;
}

/** Every directory that holds a working pg_dump and pg_restore, with the major version of each. */
export function discoverTools({ dirs = defaultToolDirs(), explicit = "" } = {}) {
  const found = new Map();
  const seen = new Set();
  for (const dir of [...(explicit ? [explicit] : []), ...dirs]) {
    const dump = join(dir, "pg_dump");
    const restore = join(dir, "pg_restore");
    if (found.has(dir) || !existsSync(dump) || !existsSync(restore)) continue;
    const real = realpathSync(dump);
    if (seen.has(real) && dir !== explicit) continue; // the same program reached by two paths (a symlinked bin directory)
    seen.add(real);
    const r = spawnSync(dump, ["--version"], { encoding: "utf8", timeout: 10_000 });
    const major = r.status === 0 ? parseClientMajor(r.stdout) : null;
    if (major) found.set(dir, { dir, dump, restore, major, version: r.stdout.trim().split("\n")[0] });
  }
  return [...found.values()];
}

/**
 * Chooses the client to use: never older than `minMajor` (pg_dump refuses a newer server, pg_restore a newer archive), and the closest to it, so a
 * backup of a PostgreSQL 16 server is made by a 16 client and restores on 16 and later. An explicit directory is used or refused, never replaced.
 */
export function chooseTool(candidates, minMajor, { explicit = "", role = "pg_dump", subject = "the server" } = {}) {
  const usable = candidates.filter((t) => t.major >= minMajor);
  const listed = candidates.length ? candidates.map((t) => `${t.version}`).join("; ") : "none found";
  if (explicit) {
    const t = candidates.find((c) => c.dir === explicit);
    if (!t) throw new BackupError(EXIT.VERSION, `no working pg_dump and pg_restore in ${explicit}`);
    if (t.major < minMajor) throw new BackupError(EXIT.VERSION, `${role} ${t.major} in ${explicit} is older than ${subject} (PostgreSQL ${minMajor}): it would refuse. Use ${role} ${minMajor} or newer.`);
    return t;
  }
  if (!usable.length)
    throw new BackupError(
      EXIT.VERSION,
      `${subject} is PostgreSQL ${minMajor}, and no ${role} of version ${minMajor} or newer was found (found: ${listed}). Install it (macOS: brew install postgresql@${minMajor}; Debian: apt install postgresql-client-${minMajor}) or pass --pg-bin <directory>.`,
    );
  return usable.sort((a, b) => a.major - b.major)[0];
}

/* ------------------------------------------------------------------ fingerprints */

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

/** What a database holds, in a form that can be compared before and after a restore. Run inside one read-only, repeatable-read transaction. */
export async function collectFingerprint(tx, { digest = true } = {}) {
  await tx.unsafe("SET LOCAL timezone = 'UTC'; SET LOCAL datestyle = 'ISO, MDY'; SET LOCAL intervalstyle = 'postgres'; SET LOCAL extra_float_digits = 3; SET LOCAL bytea_output = 'hex'");
  const tables = await tx`SELECT schemaname AS s, tablename AS t FROM pg_tables WHERE schemaname = ANY(${SCHEMAS}) ORDER BY 1, 2`;
  const fp = { tables: {}, columnsHash: "", indexes: {}, constraints: {}, sequences: {}, extensions: [] };
  for (const { s, t } of tables) {
    const name = `${s}.${t}`;
    const [{ n }] = await tx.unsafe(`SELECT count(*)::bigint AS n FROM ${q(s)}.${q(t)}`);
    const entry = { rows: Number(n) };
    if (digest && !(s === "public" && EXCLUDED_DATA.includes(t))) {
      const [{ d }] = await tx.unsafe(`SELECT md5(coalesce(string_agg(r, E'\\n' ORDER BY r), '')) AS d FROM (SELECT x::text AS r FROM ${q(s)}.${q(t)} x) y`);
      entry.digest = d;
    }
    fp.tables[name] = entry;
  }
  const [{ h }] = await tx`SELECT md5(coalesce(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') || ':' || coalesce(is_identity, '') || ':' || coalesce(identity_generation, ''), ',' ORDER BY table_schema, table_name, ordinal_position), '')) AS h
    FROM information_schema.columns WHERE table_schema = ANY(${SCHEMAS})`;
  fp.columnsHash = h;
  for (const r of await tx`SELECT schemaname || '.' || indexname AS n, indexdef AS d FROM pg_indexes WHERE schemaname = ANY(${SCHEMAS})`) fp.indexes[r.n] = r.d;
  for (const r of await tx`SELECT n.nspname || '.' || c.relname || '.' || k.conname AS n, k.contype::text || ' ' || pg_get_constraintdef(k.oid) AS d
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY(${SCHEMAS}) AND k.contype <> 'n'`) fp.constraints[r.n] = r.d; // PostgreSQL 18 lists NOT NULL as constraints, 16 and 17 do not: nullability is compared in the column definitions
  for (const r of await tx`SELECT schemaname || '.' || sequencename AS n, last_value::text AS v FROM pg_sequences WHERE schemaname = ANY(${SCHEMAS})`) fp.sequences[r.n] = r.v;
  fp.extensions = (await tx`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`).map((r) => r.extname);
  return fp;
}

/** Differences between what was backed up and what was restored. Empty means identical in everything that was compared. */
export function compareFingerprints(expected, actual) {
  const bad = [];
  const checks = [];
  const names = new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)]);
  let rowOk = true;
  let digestOk = true;
  let digests = 0;
  for (const name of [...names].sort()) {
    const e = expected.tables[name];
    const a = actual.tables[name];
    if (!e) {
      bad.push(`table ${name} exists after the restore but not in the backup`);
      rowOk = false;
    } else if (!a) {
      bad.push(`table ${name} is missing after the restore`);
      rowOk = false;
    } else {
      const excluded = name.startsWith("public.") && EXCLUDED_DATA.includes(name.slice(7));
      const want = excluded ? 0 : e.rows;
      if (a.rows !== want) {
        bad.push(`table ${name}: ${a.rows} rows after the restore, ${want} expected`);
        rowOk = false;
      }
      if (!excluded && e.digest && a.digest) {
        digests++;
        if (e.digest !== a.digest) {
          bad.push(`table ${name}: the content differs (row digest)`);
          digestOk = false;
        }
      }
    }
  }
  checks.push({ what: `row counts of ${names.size} tables`, ok: rowOk });
  checks.push({ what: digests ? `content digests of ${digests} tables` : "content digests (not collected)", ok: digestOk });
  const same = (what, e, a) => {
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    let ok = true;
    for (const k of [...keys].sort()) {
      if (e[k] === a[k]) continue;
      bad.push(`${what} ${k}: ${a[k] === undefined ? "missing after the restore" : e[k] === undefined ? "not in the backup" : "differs"}`);
      ok = false;
    }
    checks.push({ what: `${{ index: "indexes", constraint: "constraints", sequence: "sequences" }[what] ?? what} (${keys.size})`, ok });
  };
  same("index", expected.indexes, actual.indexes);
  same("constraint", expected.constraints, actual.constraints);
  same("sequence", expected.sequences, actual.sequences);
  const cols = expected.columnsHash === actual.columnsHash;
  if (!cols) bad.push("the columns (names, types, nullability, defaults, identity) differ");
  checks.push({ what: "column definitions", ok: cols });
  const ext = JSON.stringify(expected.extensions) === JSON.stringify(actual.extensions);
  if (!ext) bad.push(`extensions differ: backup ${expected.extensions.join(",") || "none"}, restore ${actual.extensions.join(",") || "none"}`);
  checks.push({ what: "extensions", ok: ext });
  return { bad, checks };
}

/* ------------------------------------------------------------------ files */

export const sha256File = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });

function run(cmd, args, env, limit = 8192) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    let out = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-limit)));
    p.stdout.on("data", (d) => (out = (out + d).slice(-65536)));
    p.on("error", (e) => resolve({ status: 127, err: String(e.message), out }));
    p.on("close", (status) => resolve({ status, err, out }));
  });
}

const firstLine = (t, secrets) => redact(String(t).trim().split("\n").find((l) => l.trim()) ?? "no message", secrets);

/* ------------------------------------------------------------------ the backup */

/**
 * Backs up one database. `url` must be the DIRECT endpoint of a login that can read every table (the owner, the migration role, or any member of
 * pg_read_all_data). Writes `<out>/understand-<UTC time>.dump`, `.sha256` and `.manifest.json` (mode 0600). Throws BackupError with an exit code.
 */
export async function runBackup({ url, outDir, explicitBin = "", toolDirs, digest = true, log = () => {}, now = () => new Date() }) {
  const c = parseConnection(url);
  const secrets = secretsOf(url, c);
  if (isPooledHost(c.host))
    throw new BackupError(EXIT.POOLED, "this is the pooled endpoint (its host name contains -pooler). pg_dump needs the direct endpoint: copy the connection string without the pooler (Neon console, Connection details, switch Pooled connection off).");
  const conn = await open(url, c, secrets);
  const partial = [];
  try {
    log(`server: ${conn.version} (major ${conn.serverMajor}), connected as ${conn.user}`);
    const tools = discoverTools({ dirs: toolDirs, explicit: explicitBin });
    const tool = chooseTool(tools, conn.serverMajor, { explicit: explicitBin, role: "pg_dump", subject: "the server" });
    log(`client: ${tool.version} (${tool.dir})`);
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
    const file = join(outDir, `understand-${stamp}.dump`);
    const tmp = `${file}.partial`;
    partial.push(tmp, `${file}.manifest.json.partial`, `${file}.sha256.partial`);
    let fingerprint;
    await conn.sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      const [{ snap }] = await tx`SELECT pg_export_snapshot() AS snap`;
      fingerprint = await collectFingerprint(tx, { digest });
      log(`counted ${Object.keys(fingerprint.tables).length} tables in the snapshot${digest ? " (with content digests)" : ""}`);
      const args = ["--format=custom", "--no-owner", "--no-acl", "--lock-wait-timeout=30000", `--snapshot=${snap}`, `--file=${tmp}`, ...EXCLUDED_DATA.map((t) => `--exclude-table-data=${t}`)];
      const r = await run(tool.dump, args, toolEnv(c));
      if (r.status !== 0) throw new BackupError(EXIT.DUMP, `pg_dump failed (exit ${r.status}): ${firstLine(r.err, secrets)}`);
    });
    const listing = await run(tool.restore, ["--list", tmp], toolEnv(c));
    if (listing.status !== 0) throw new BackupError(EXIT.DUMP, `the file written is not a readable archive: ${firstLine(listing.err, secrets)}`);
    const withData = new Set([...listing.out.matchAll(/TABLE DATA (\S+) (\S+)/g)].map((m) => `${m[1]}.${m[2]}`));
    for (const [name, t] of Object.entries(fingerprint.tables)) {
      const excluded = name.startsWith("public.") && EXCLUDED_DATA.includes(name.slice(7));
      if (t.rows > 0 && !excluded && !withData.has(name)) throw new BackupError(EXIT.DUMP, `the file lacks the data of table ${name} (${t.rows} rows in the snapshot): do not rely on it`);
    }
    chmodSync(tmp, 0o600);
    const sha = await sha256File(tmp);
    const bytes = statSync(tmp).size;
    const manifest = {
      format: 1,
      createdAt: now().toISOString(),
      dump: { file: basename(file), bytes, sha256: sha, pgDump: tool.version, pgDumpMajor: tool.major, tablesWithData: withData.size },
      server: { version: conn.version, major: conn.serverMajor, encoding: conn.encoding },
      source: { fingerprint: endpointFingerprint(c) },
      excludedDataTables: EXCLUDED_DATA,
      fingerprint,
    };
    writeFileSync(`${file}.manifest.json.partial`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(`${file}.sha256.partial`, `${sha}  ${basename(file)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    renameSync(`${file}.manifest.json.partial`, `${file}.manifest.json`);
    renameSync(`${file}.sha256.partial`, `${file}.sha256`);
    return { file, bytes, sha256: sha, serverMajor: conn.serverMajor, client: tool.version, tables: Object.keys(fingerprint.tables).length, tablesWithData: withData.size };
  } catch (e) {
    for (const p of partial) rmSync(p, { force: true });
    if (e instanceof BackupError) throw new BackupError(e.code, redact(e.message, secrets));
    throw new BackupError(EXIT.DUMP, `the backup failed: ${redact(e?.message ?? e, secrets)}`);
  } finally {
    await conn.sql.end({ timeout: 2 }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ the restore and its proof */

/**
 * Restores a backup into an EMPTY database and proves it. `targetUrl` is the direct endpoint of a database that is not the one the backup came from.
 * Order: checksum, then target safety (not the source, not pooled, empty, not older than the source), then a single-transaction restore (all or
 * nothing), then every comparison against the manifest.
 */
export async function runRestoreVerify({ file, targetUrl, explicitBin = "", toolDirs, log = () => {} }) {
  const c = parseConnection(targetUrl);
  const secrets = secretsOf(targetUrl, c);
  for (const p of [file, `${file}.manifest.json`, `${file}.sha256`]) if (!existsSync(p)) throw new BackupError(EXIT.USAGE, `${basename(p)} is missing: the dump, its .manifest.json and its .sha256 must stay together`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(`${file}.manifest.json`, "utf8"));
  } catch {
    throw new BackupError(EXIT.VERIFY, "the manifest is not readable JSON");
  }
  if (manifest.format !== 1) throw new BackupError(EXIT.VERIFY, `the manifest has format ${manifest.format}; this tool reads format 1`);
  const actualSha = await sha256File(file);
  const recorded = readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (actualSha !== manifest.dump.sha256 || actualSha !== recorded) throw new BackupError(EXIT.VERIFY, "the dump does not match its checksum (changed, truncated or corrupted since it was made): not restored");
  log(`checksum ok (${actualSha.slice(0, 12)}...)`);
  if (isPooledHost(c.host)) throw new BackupError(EXIT.POOLED, "the target is a pooled endpoint: pg_restore needs the direct endpoint");
  if (endpointFingerprint(c) === manifest.source.fingerprint) throw new BackupError(EXIT.TARGET, "the target is the database this backup came from: refusing to restore over it. Restore into a new, empty database.");
  const conn = await open(targetUrl, c, secrets);
  try {
    if (conn.serverMajor < manifest.server.major) throw new BackupError(EXIT.VERSION, `the target server is PostgreSQL ${conn.serverMajor} and the backup comes from ${manifest.server.major}: a dump does not restore on an older server. Use a target of version ${manifest.server.major} or newer.`);
    const [{ n }] = await conn.sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = ANY(${SCHEMAS})`;
    if (n > 0) throw new BackupError(EXIT.TARGET, `the target already has ${n} application tables: restore only into an empty database`);
    const tool = chooseTool(discoverTools({ dirs: toolDirs, explicit: explicitBin }), manifest.dump.pgDumpMajor, { explicit: explicitBin, role: "pg_restore", subject: "the dump" });
    log(`target: ${conn.version}; restoring with ${tool.version}`);
    const t0 = Date.now();
    const r = await run(tool.restore, ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", `--dbname=${c.database}`, file], toolEnv(c));
    if (r.status !== 0) throw new BackupError(EXIT.VERIFY, `pg_restore failed (exit ${r.status}), nothing was kept (single transaction): ${firstLine(r.err, secrets)}`);
    const seconds = (Date.now() - t0) / 1000;
    let actual;
    await conn.sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      actual = await collectFingerprint(tx, { digest: Object.values(manifest.fingerprint.tables).some((t) => t.digest) });
    });
    const { bad, checks } = compareFingerprints(manifest.fingerprint, actual);
    if (bad.length) throw new BackupError(EXIT.VERIFY, `the restored database differs from the backup:\n  ${bad.slice(0, 20).join("\n  ")}${bad.length > 20 ? `\n  ... and ${bad.length - 20} more` : ""}`);
    return { checks, seconds, tables: Object.keys(actual.tables).length, rows: Object.values(actual.tables).reduce((a, t) => a + t.rows, 0), targetMajor: conn.serverMajor };
  } catch (e) {
    if (e instanceof BackupError) throw new BackupError(e.code, redact(e.message, secrets));
    throw new BackupError(EXIT.VERIFY, `the restore failed: ${redact(e?.message ?? e, secrets)}`);
  } finally {
    await conn.sql.end({ timeout: 2 }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ a hidden prompt for a password that is not in the URL */

export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new BackupError(EXIT.USAGE, "the connection string has no password and there is no terminal to ask on"));
    process.stderr.write(question);
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const done = (fn) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stderr.write("\n");
      fn();
    };
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") return done(() => resolve(buf));
        if (c === "\u0003") return done(() => reject(new BackupError(EXIT.USAGE, "cancelled")));
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}
