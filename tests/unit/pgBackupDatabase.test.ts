// The backup and restore engine against a real PostgreSQL server (DATABASE_URL, an administrator). Version-dependent cases are judged against the
// version of the server that answers, so the same file proves "refuses a client older than the server" on PostgreSQL 16 and on 18. Tests that need a
// working pg_dump of at least the server's version are skipped, and said to be skipped, when the machine has none.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as engine from "../../scripts/lib/pgBackup.mjs";

const { runBackup, runRestoreVerify, discoverTools, EXIT } = engine as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ADMIN = process.env.DATABASE_URL;
const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const DB = { src: `gloss_roles_bk_${run}_src`, dst: `gloss_roles_bk_${run}_dst`, dst2: `gloss_roles_bk_${run}_dst2`, dst3: `gloss_roles_bk_${run}_dst3` };
const ROLE = { ro: `rt_${run}_ro`, none: `rt_${run}_none` };
const PW = { ro: `p@ss/${randomBytes(6).toString("hex")}:x#y z`, none: randomBytes(8).toString("hex") }; // characters that must survive URL encoding

const urlOf = (db: string, user?: keyof typeof ROLE) => {
  const u = new URL(ADMIN!);
  if (user) {
    u.username = ROLE[user];
    u.password = PW[user];
  }
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = ADMIN ? postgres(ADMIN, { max: 1, prepare: false, onnotice: () => {} }) : null;
const tools = ADMIN ? (discoverTools() as { major: number; version: string; dump: string; restore: string; dir: string }[]) : [];
let serverMajor = 0;
let canDump = false;
const out = () => mkdtempSync(join(tmpdir(), "bkdb-"));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    return { code: (e as { code: number }).code, message: (e as Error).message };
  }
};
const emptyTables = async (db: string) => (await postgres(urlOf(db), { max: 1, onnotice: () => {} }).unsafe("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('public', 'drizzle')"))[0].n;

/** A directory of stand-ins for pg_dump and pg_restore: they say what they are told, record how they were called, and otherwise run the real ones. */
function shim(kind: "recording" | "older" | "failing", log = "") {
  const dir = mkdtempSync(join(tmpdir(), "shim-"));
  const real = tools.filter((t) => t.major >= serverMajor).sort((a, b) => a.major - b.major)[0];
  const version = kind === "older" ? `pg_dump (PostgreSQL) ${serverMajor - 1}.9` : null;
  const dump =
    kind === "older"
      ? `#!/bin/sh\necho "${version}"\n`
      : kind === "failing"
        ? `#!/bin/sh\n[ "$1" = "--version" ] && exec "${real?.dump}" --version\nfor a in "$@"; do case "$a" in --file=*) echo junk > "\${a#--file=}";; esac; done\necho "pg_dump: error: simulated failure for postgres://someone:hunter2@host/db" >&2\nexit 1\n`
        : `#!/bin/sh\n[ "$1" = "--version" ] && exec "${real?.dump}" --version\n{ echo "ARGV: $*"; echo "PGPASSWORD=$PGPASSWORD"; echo "PGDATABASE=$PGDATABASE"; echo "URLVARS=\${DATABASE_URL}\${BACKUP_DATABASE_URL}"; } >> "${log}"\nexec "${real?.dump}" "$@"\n`;
  const restore = kind === "older" ? `#!/bin/sh\necho "pg_restore (PostgreSQL) ${serverMajor - 1}.9"\n` : `#!/bin/sh\nexec "${real?.restore}" "$@"\n`;
  writeFileSync(join(dir, "pg_dump"), dump);
  writeFileSync(join(dir, "pg_restore"), restore);
  chmodSync(join(dir, "pg_dump"), 0o755);
  chmodSync(join(dir, "pg_restore"), 0o755);
  return dir;
}

describe.skipIf(!admin)("backup and restore against a real PostgreSQL server", () => {
  let stop = false;
  beforeAll(async () => {
    serverMajor = Math.floor(Number((await admin!`SELECT current_setting('server_version_num') AS v`)[0].v) / 10000);
    canDump = tools.some((t) => t.major >= serverMajor);
    console.info(`server PostgreSQL ${serverMajor}; clients found: ${tools.map((t) => t.major).join(", ") || "none"}; ${canDump ? "backups can run" : "NO client new enough: the tests that need one are skipped"}`);
    await admin!.unsafe(`CREATE ROLE ${ROLE.ro} LOGIN PASSWORD '${PW.ro.replace(/'/g, "''")}'`);
    await admin!.unsafe(`GRANT pg_read_all_data TO ${ROLE.ro}`);
    await admin!.unsafe(`CREATE ROLE ${ROLE.none} LOGIN PASSWORD '${PW.none}'`);
    for (const d of Object.values(DB)) await admin!.unsafe(`CREATE DATABASE ${d}`);
    const src = postgres(urlOf(DB.src), { max: 1, prepare: false, onnotice: () => {} });
    await migrate(drizzle(src), { migrationsFolder: "drizzle" });
    await src.unsafe(`
      INSERT INTO readers (id) SELECT 'r' || g FROM generate_series(1, 5) g;
      INSERT INTO documents (id, reader_id, slug, kind, title, topic, blocks) SELECT 'd' || g, 'r' || (g % 5 + 1), 's' || g, 'essay', 'Título ' || g, 'unsorted', ('[{"id":"b1","text":"texto ' || g || ' ünïcode ✓"}]')::jsonb FROM generate_series(1, 40) g;
      INSERT INTO annotations (id, document_id, reader_id, kind, note, anchor) SELECT 'a' || g, 'd' || (g % 40 + 1), 'r' || (g % 5 + 1), 'note', 'n' || g, '{"b":1}'::jsonb FROM generate_series(1, 120) g;
      INSERT INTO analytics_events (at, event, actor, actor_kind) SELECT 1793589095932 + g, 'landing_viewed', 'a' || g, 'anon' FROM generate_series(1, 25) g;
      INSERT INTO rate_hits (key, window_start, count, expires_at) VALUES ('k1', 0, 3, 9), ('k2', 0, 9, 9);
      INSERT INTO ai_leases (key, token, expires_at) VALUES ('l1', 't', 9)`);
    await src.end();
  }, 120_000);
  afterAll(async () => {
    stop = true;
    for (const d of Object.values(DB)) await admin!.unsafe(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    for (const r of Object.values(ROLE)) await admin!.unsafe(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
    await admin!.end({ timeout: 2 });
  }, 60_000);

  describe.skipIf(!ADMIN)("a backup and the restore that proves it", () => {
    let dump = "";
    it("writes the dump, its checksum and its manifest (mode 0600), as a login that can only read, with a password full of URL-special characters", async ({ skip }) => {
      if (!canDump) skip();
      const dir = out();
      const r = await runBackup({ url: urlOf(DB.src, "ro"), outDir: dir });
      dump = r.file;
      expect(readdirSync(dir).sort()).toEqual([r.file.split("/").pop(), `${r.file.split("/").pop()}.manifest.json`, `${r.file.split("/").pop()}.sha256`].sort());
      for (const f of [r.file, `${r.file}.manifest.json`, `${r.file}.sha256`]) expect(statSync(f).mode & 0o777, f).toBe(0o600);
      const manifest = JSON.parse(readFileSync(`${r.file}.manifest.json`, "utf8"));
      expect(manifest).toMatchObject({ format: 1, server: { major: serverMajor }, excludedDataTables: ["rate_hits", "ai_leases", "ai_reservations"] });
      expect(manifest.dump.sha256).toBe(readFileSync(`${r.file}.sha256`, "utf8").split(/\s+/)[0]);
      expect(manifest.fingerprint.tables["public.documents"]).toMatchObject({ rows: 40 });
      expect(manifest.fingerprint.tables["public.rate_hits"].rows).toBe(2); // counted at the source, not backed up
      const text = readFileSync(`${r.file}.manifest.json`, "utf8");
      expect(text).not.toContain(PW.ro);
      expect(text).not.toMatch(/postgres:\/\/|127\.0\.0\.1|localhost/);
      expect(r.tablesWithData).toBeGreaterThanOrEqual(8);
    }, 120_000);

    it("restores into a new empty database and proves it: counts, content digests, indexes, constraints, sequences, columns", async ({ skip }) => {
      if (!canDump) skip();
      const r = await runRestoreVerify({ file: dump, targetUrl: urlOf(DB.dst) });
      expect(r.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
      expect(r.checks.map((c: { what: string }) => c.what).join(" | ")).toMatch(/row counts.*content digests.*indexes.*constraints.*sequences.*column definitions.*extensions/);
      const dst = postgres(urlOf(DB.dst), { max: 1, onnotice: () => {} });
      expect((await dst`SELECT count(*)::int AS n FROM documents`)[0].n).toBe(40);
      expect((await dst`SELECT count(*)::int AS n FROM rate_hits`)[0].n).toBe(0); // short-lived: schema yes, rows no
      expect((await dst`SELECT count(*)::int AS n FROM ai_leases`)[0].n).toBe(0);
      expect((await dst`SELECT title FROM documents WHERE id = 'd7'`)[0].title).toBe("Título 7");
      const next = await dst`INSERT INTO analytics_events (at, event, actor, actor_kind) VALUES (1, 'x', 'a', 'anon') RETURNING id`;
      expect(Number(next[0].id)).toBe(26); // the identity sequence continues where it stopped
      await dst.end();
    }, 120_000);

    it("refuses a restore over the live source, and over a database that already has tables", async ({ skip }) => {
      if (!canDump) skip();
      expect(await code(runRestoreVerify({ file: dump, targetUrl: urlOf(DB.src) }))).toMatchObject({ code: EXIT.TARGET, message: expect.stringMatching(/came from/) });
      expect(await code(runRestoreVerify({ file: dump, targetUrl: urlOf(DB.dst) }))).toMatchObject({ code: EXIT.TARGET, message: expect.stringMatching(/already has \d+ application tables/) });
    }, 60_000);

    it("refuses a dump that was changed or cut short, before restoring anything", async ({ skip }) => {
      if (!canDump) skip();
      const dir = out();
      const copy = join(dir, "copy.dump");
      for (const [src, name] of [[dump, copy], [`${dump}.manifest.json`, `${copy}.manifest.json`], [`${dump}.sha256`, `${copy}.sha256`]]) writeFileSync(name, readFileSync(src));
      const bytes = readFileSync(copy);
      bytes[Math.floor(bytes.length / 2)] ^= 0xff;
      writeFileSync(copy, bytes);
      expect(await code(runRestoreVerify({ file: copy, targetUrl: urlOf(DB.dst2) }))).toMatchObject({ code: EXIT.VERIFY, message: expect.stringMatching(/does not match its checksum/) });
      writeFileSync(copy, readFileSync(dump).subarray(0, 2000));
      expect(await code(runRestoreVerify({ file: copy, targetUrl: urlOf(DB.dst2) }))).toMatchObject({ code: EXIT.VERIFY });
      expect(await emptyTables(DB.dst2)).toBe(0);
      expect(await code(runRestoreVerify({ file: join(dir, "missing.dump"), targetUrl: urlOf(DB.dst2) }))).toMatchObject({ code: EXIT.USAGE });
    }, 60_000);

    it("refuses a manifest that was edited to match a changed dump only if the checksum file disagrees (all three must agree)", async ({ skip }) => {
      if (!canDump) skip();
      const dir = out();
      const copy = join(dir, "copy.dump");
      writeFileSync(copy, readFileSync(dump));
      writeFileSync(`${copy}.sha256`, `${"0".repeat(64)}  copy.dump\n`);
      writeFileSync(`${copy}.manifest.json`, readFileSync(`${dump}.manifest.json`));
      expect(await code(runRestoreVerify({ file: copy, targetUrl: urlOf(DB.dst2) }))).toMatchObject({ code: EXIT.VERIFY });
    }, 60_000);

    it("proves a restore against what was changed after it: the same comparison finds an altered row", async ({ skip }) => {
      if (!canDump) skip();
      const dst = postgres(urlOf(DB.dst), { max: 1, onnotice: () => {} });
      await dst`UPDATE documents SET title = 'altered' WHERE id = 'd1'`;
      await dst.end();
      const manifest = JSON.parse(readFileSync(`${dump}.manifest.json`, "utf8"));
      const sql = postgres(urlOf(DB.dst), { max: 1, onnotice: () => {} });
      let actual: unknown;
      await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
        actual = await (engine as Record<string, any>).collectFingerprint(tx, { digest: true }); // eslint-disable-line @typescript-eslint/no-explicit-any
      });
      await sql.end();
      const { bad } = (engine as Record<string, any>).compareFingerprints(manifest.fingerprint, actual); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(bad.join("\n")).toContain("table public.documents: the content differs");
    }, 60_000);
  });

  describe("versions", () => {
    it("refuses a client older than the server, with the version exit code, before writing or connecting any further, and says what to do", async () => {
      const dir = out();
      const r = await code(runBackup({ url: urlOf(DB.src, "ro"), outDir: dir, toolDirs: [shim("older")] }));
      expect(r).toMatchObject({ code: EXIT.VERSION });
      expect((r as { message: string }).message).toMatch(new RegExp(`PostgreSQL ${serverMajor}.*no pg_dump of version ${serverMajor} or newer.*found: pg_dump \\(PostgreSQL\\) ${serverMajor - 1}\\.9`));
      expect(readdirSync(dir)).toEqual([]);
    }, 60_000);

    it("refuses an explicitly named older client too", async () => {
      const older = shim("older");
      expect(await code(runBackup({ url: urlOf(DB.src, "ro"), outDir: out(), explicitBin: older }))).toMatchObject({ code: EXIT.VERSION, message: expect.stringMatching(/older than the server/) });
    }, 60_000);

    it("refuses to restore onto a server older than the one the backup came from", async () => {
      // A manifest that claims a newer source: the target (this server) is then older than it.
      const dir = out();
      const f = join(dir, "x.dump");
      writeFileSync(f, "PGDMP");
      const { createHash } = await import("node:crypto");
      const sha = createHash("sha256").update("PGDMP").digest("hex");
      writeFileSync(`${f}.sha256`, `${sha}  x.dump\n`);
      writeFileSync(`${f}.manifest.json`, JSON.stringify({ format: 1, dump: { sha256: sha, pgDumpMajor: serverMajor + 1 }, server: { major: serverMajor + 1 }, source: { fingerprint: "000000000000" }, fingerprint: { tables: {} } }));
      expect(await code(runRestoreVerify({ file: f, targetUrl: urlOf(DB.dst3) }))).toMatchObject({ code: EXIT.VERSION, message: expect.stringMatching(/older server/) });
    }, 60_000);
  });

  describe("credentials and failures", () => {
    it("hand the password to pg_dump in its environment and never on its command line, and pass no connection string on", async ({ skip }) => {
      if (!canDump) skip();
      const log = join(out(), "calls.log");
      const dir = out();
      await runBackup({ url: urlOf(DB.src, "ro"), outDir: dir, toolDirs: [shim("recording", log)] });
      const calls = readFileSync(log, "utf8");
      expect(calls).toContain(`PGPASSWORD=${PW.ro}`);
      expect(calls).toContain(`PGDATABASE=${DB.src}`);
      const argv = calls.split("\n").find((l) => l.startsWith("ARGV:"))!;
      expect(argv).not.toContain(PW.ro);
      expect(argv).not.toContain(encodeURIComponent(PW.ro));
      expect(argv).not.toMatch(/postgres:\/\/|password/i);
      expect(argv).toMatch(/--format=custom/);
      expect(argv).toMatch(/--no-owner/);
      expect(argv).toMatch(/--snapshot=/);
      expect(argv).toMatch(/--exclude-table-data=rate_hits/);
      expect(calls).toMatch(/URLVARS=\n/); // the connection string variables were removed from the tool's environment
    }, 120_000);

    it("when pg_dump fails: exit 6, no file left behind, and the message holds no password and no URL even if pg_dump printed one", async ({ skip }) => {
      if (!canDump) skip();
      const dir = out();
      const r = await code(runBackup({ url: urlOf(DB.src, "ro"), outDir: dir, toolDirs: [shim("failing")] }));
      expect(r).toMatchObject({ code: EXIT.DUMP, message: expect.stringMatching(/pg_dump failed \(exit 1\)/) });
      const message = (r as { message: string }).message;
      expect(message).not.toMatch(/hunter2|postgres:\/\//);
      expect(message).not.toContain(PW.ro);
      expect(readdirSync(dir)).toEqual([]);
    }, 120_000);

    it("a login that cannot read the data fails cleanly: exit 6, nothing written, no secret in the message", async () => {
      const dir = out();
      const r = await code(runBackup({ url: urlOf(DB.src, "none"), outDir: dir }));
      expect(r).toMatchObject({ code: EXIT.DUMP });
      expect((r as { message: string }).message).toMatch(/permission denied/);
      expect((r as { message: string }).message).not.toContain(PW.none);
      expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    }, 60_000);

    it("the pooled endpoint is refused before a connection is attempted", async () => {
      const u = new URL(urlOf(DB.src, "ro"));
      u.hostname = "ep-cool-123456-pooler.us-east-2.aws.neon.tech";
      expect(await code(runBackup({ url: u.toString(), outDir: out() }))).toMatchObject({ code: EXIT.POOLED });
    }, 30_000);
  });

  describe("a live database", () => {
    it("is backed up consistently while it is being written: the counts and digests come from the same snapshot as the dump", async ({ skip }) => {
      if (!canDump) skip();
      const writer = postgres(urlOf(DB.src), { max: 1, onnotice: () => {} });
      let n = 0;
      const writing = (async () => {
        while (!stop && n < 400) {
          await writer`INSERT INTO readers (id) VALUES (${`live-${run}-${n++}`})`.catch(() => {});
          await writer`UPDATE documents SET minutes = minutes + 1 WHERE id = 'd3'`.catch(() => {});
        }
      })();
      const dir = out();
      const r = await runBackup({ url: urlOf(DB.src, "ro"), outDir: dir });
      await writing;
      await writer.end();
      expect(n).toBeGreaterThan(0);
      const verified = await runRestoreVerify({ file: r.file, targetUrl: urlOf(DB.dst3) });
      expect(verified.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    }, 180_000);

    it("can skip the content digests (counts, schema and checksum only) for a large database, and says so in its checks", async ({ skip }) => {
      if (!canDump) skip();
      const dir = out();
      const r = await runBackup({ url: urlOf(DB.src, "ro"), outDir: dir, digest: false });
      const manifest = JSON.parse(readFileSync(`${r.file}.manifest.json`, "utf8"));
      expect(Object.values(manifest.fingerprint.tables).some((t) => (t as { digest?: string }).digest)).toBe(false);
      await admin!.unsafe(`DROP DATABASE IF EXISTS ${DB.dst3} WITH (FORCE)`);
      await admin!.unsafe(`CREATE DATABASE ${DB.dst3}`);
      const v = await runRestoreVerify({ file: r.file, targetUrl: urlOf(DB.dst3) });
      expect(v.checks.map((c: { what: string }) => c.what).join("|")).toMatch(/content digests \(not collected\)/);
    }, 180_000);
  });
});
