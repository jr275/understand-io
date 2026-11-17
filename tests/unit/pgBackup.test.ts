// The backup engine's decisions that need no database: what a connection string means, which endpoints and client versions are refused, how comparisons
// of a backup and a restore are made, that no secret is ever printed, and the exit code of every refusal. The same engine against real servers is in
// pgBackupDatabase.test.ts.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as engine from "../../scripts/lib/pgBackup.mjs";

const { BackupError, EXIT, chooseTool, compareFingerprints, discoverTools, isPooledHost, parseClientMajor, parseConnection, redact, secretsOf, sha256File, toolEnv, endpointFingerprint } = engine as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PW = "p@ss/w0rd:with#odd chars";
const url = `postgres://app_user:${encodeURIComponent(PW)}@ep-cool-123456.us-east-2.aws.neon.tech:5432/neondb?sslmode=require&channel_binding=require`;

const fakeTools = (versions: number[]) => {
  const root = mkdtempSync(join(tmpdir(), "pgtools-"));
  return versions.map((v) => {
    const dir = join(root, `pg${v}`);
    mkdirSync(dir);
    for (const n of ["pg_dump", "pg_restore"]) {
      writeFileSync(join(dir, n), `#!/bin/sh\n[ "$1" = "--version" ] && echo "${n} (PostgreSQL) ${v}.4 (Test)" && exit 0\nexit 1\n`);
      chmodSync(join(dir, n), 0o755);
    }
    return dir;
  });
};

describe("the connection string", () => {
  it("is read into parts, with the password decoded and nothing printed", () => {
    const c = parseConnection(url);
    expect(c).toMatchObject({ host: "ep-cool-123456.us-east-2.aws.neon.tech", port: "5432", user: "app_user", password: PW, database: "neondb", sslmode: "require", channelBinding: "require" });
    expect(parseConnection("postgresql://u@[::1]:6543/d").host).toBe("::1");
  });

  it("refuses what is not a PostgreSQL URL, a host or a database, with the usage exit code and no echo of the input", () => {
    for (const bad of ["", "not a url", "mysql://u:p@h/d", "postgres://u:p@/d", "postgres://u:p@h/", "postgres://u:supersecret@"]) {
      try {
        parseConnection(bad);
        throw new Error(`accepted: ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(BackupError);
        expect((e as { code: number }).code).toBe(EXIT.USAGE);
        expect((e as Error).message).not.toContain("supersecret");
      }
    }
  });

  it("gives the client tools the password in their environment only, and strips every variable that could point them at another database", () => {
    const env = toolEnv(parseConnection(url), { PATH: "/bin", DATABASE_URL: "x", BACKUP_DATABASE_URL: "x", TARGET_DATABASE_URL: "x", PGSERVICE: "x", PGPASSFILE: "x" });
    expect(env).toMatchObject({ PGHOST: "ep-cool-123456.us-east-2.aws.neon.tech", PGPORT: "5432", PGUSER: "app_user", PGDATABASE: "neondb", PGSSLMODE: "require", PGPASSWORD: PW, PGCHANNELBINDING: "require" });
    for (const k of ["DATABASE_URL", "BACKUP_DATABASE_URL", "TARGET_DATABASE_URL", "PGSERVICE", "PGPASSFILE"]) expect(env[k]).toBeUndefined();
    expect(toolEnv(parseConnection("postgres://u:p@127.0.0.1/d")).PGSSLMODE).toBe("prefer"); // local servers need not have TLS
    expect(toolEnv(parseConnection("postgres://u:p@db.example.com/d")).PGSSLMODE).toBe("require"); // everything else must
  });

  it("is hidden from every message: the password, its encoded form, and any URL", () => {
    const c = parseConnection(url);
    const text = redact(`failed for ${url}: password authentication failed for user "app_user" with ${PW} / ${encodeURIComponent(PW)} PGPASSWORD=${PW}`, secretsOf(url, c));
    expect(text).not.toContain(PW);
    expect(text).not.toContain(encodeURIComponent(PW));
    expect(text).not.toMatch(/postgres:\/\//);
    expect(redact("postgresql://a:b@c/d and postgres://e@f/g")).toBe("<url> and <url>");
  });

  it("is summarised by a fingerprint that names a database without containing its address", () => {
    const f = endpointFingerprint(parseConnection(url));
    expect(f).toMatch(/^[0-9a-f]{12}$/);
    expect(f).not.toContain("neon");
    expect(f).not.toBe(endpointFingerprint(parseConnection(url.replace("neondb", "other"))));
    expect(f).toBe(endpointFingerprint(parseConnection(url.replace("app_user", "someone_else")))); // the login does not change where the data is
  });
});

describe("the endpoint", () => {
  it.each([
    ["ep-cool-123456-pooler.us-east-2.aws.neon.tech", true],
    ["ep-cool-123456-pooler.c-3.us-east-1.aws.neon.tech", true],
    ["aws-0-eu-west-1.pooler.supabase.com", true],
    ["ep-cool-123456.us-east-2.aws.neon.tech", false],
    ["localhost", false],
    ["127.0.0.1", false],
    ["mypoolerdb.internal.example", false],
    ["db-pooler-prod.example.com", true],
  ])("%s is pooled: %s", (host, pooled) => {
    expect(isPooledHost(host)).toBe(pooled);
  });
});

describe("the PostgreSQL client tools", () => {
  it.each([
    ["pg_dump (PostgreSQL) 16.15 (Homebrew)", 16],
    ["pg_dump (PostgreSQL) 18.6", 18],
    ["pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)", 17],
    ["pg_restore (PostgreSQL) 18devel", 18],
    ["pg_dump (PostgreSQL) 9.6.24", 9],
    ["something else", null],
  ])("%s is major %s", (out, major) => {
    expect(parseClientMajor(out)).toBe(major);
  });

  it("are found by running them, not by their directory name", () => {
    const dirs = fakeTools([16, 17, 18]);
    const found = discoverTools({ dirs, explicit: "" });
    expect(found.map((t: { major: number }) => t.major).sort()).toEqual([16, 17, 18]);
    expect(discoverTools({ dirs: [join(tmpdir(), "no-such-dir")] })).toEqual([]);
  });

  it("choose the closest client that is not older than the server, so a dump matches the server it came from", () => {
    const found = discoverTools({ dirs: fakeTools([16, 17, 18]) });
    expect(chooseTool(found, 16).major).toBe(16);
    expect(chooseTool(found, 17).major).toBe(17);
    expect(chooseTool(found, 18).major).toBe(18);
  });

  it("refuse, with the version exit code and a message that says what was found and what to install, when every client is older than the server", () => {
    const found = discoverTools({ dirs: fakeTools([16]) });
    try {
      chooseTool(found, 18);
      throw new Error("accepted a pg_dump 16 for a PostgreSQL 18 server");
    } catch (e) {
      expect((e as { code: number }).code).toBe(EXIT.VERSION);
      expect((e as Error).message).toMatch(/PostgreSQL 18.*no pg_dump of version 18 or newer.*found: pg_dump \(PostgreSQL\) 16\.4/);
      expect((e as Error).message).toMatch(/brew install postgresql@18/);
    }
    expect(() => chooseTool([], 18)).toThrow(/none found/);
  });

  it("use an explicitly named directory or refuse it, never quietly replace it", () => {
    const [d16, d18] = fakeTools([16, 18]);
    const found = discoverTools({ dirs: [d16, d18] });
    expect(chooseTool(found, 16, { explicit: d18 }).major).toBe(18);
    expect(() => chooseTool(found, 18, { explicit: d16 })).toThrow(/older than the server/);
    expect(() => chooseTool(found, 16, { explicit: "/no/such" })).toThrow(/no working pg_dump/);
  });
});

describe("comparing a restore with its backup", () => {
  const base = () => ({
    tables: { "public.documents": { rows: 40, digest: "aaa" }, "public.rate_hits": { rows: 2 }, "drizzle.__drizzle_migrations": { rows: 8, digest: "bbb" } },
    columnsHash: "cols",
    indexes: { "public.documents_pkey": "CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id)" } as Record<string, string>,
    constraints: { "public.documents.documents_pkey": "p PRIMARY KEY (id)" },
    sequences: { "public.analytics_events_id_seq": "25" },
    extensions: [] as string[],
  });
  const restored = () => {
    const r = base();
    r.tables["public.rate_hits"] = { rows: 0 }; // the short-lived tables come back empty, by design
    return r;
  };

  it("is clean for a faithful restore, with the short-lived tables expected empty", () => {
    const { bad, checks } = compareFingerprints(base(), restored());
    expect(bad).toEqual([]);
    expect(checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("names every kind of difference", () => {
    const r = restored();
    r.tables["public.documents"] = { rows: 39, digest: "zzz" };
    delete (r.tables as Record<string, unknown>)["drizzle.__drizzle_migrations"];
    r.indexes = {};
    r.constraints["public.documents.documents_pkey"] = "p PRIMARY KEY (id, x)";
    r.sequences["public.analytics_events_id_seq"] = "3";
    r.columnsHash = "other";
    r.extensions = ["pgcrypto"];
    const { bad } = compareFingerprints(base(), r);
    const text = bad.join("\n");
    for (const needle of ["documents: 39 rows", "content differs", "__drizzle_migrations is missing", "index public.documents_pkey: missing", "constraint public.documents.documents_pkey: differs", "sequence public.analytics_events_id_seq: differs", "columns", "extensions differ"]) expect(text, needle).toContain(needle);
  });

  it("notices a short-lived table that came back with rows, and a table that was not in the backup", () => {
    const r = restored();
    r.tables["public.rate_hits"] = { rows: 2 };
    (r.tables as Record<string, unknown>)["public.extra"] = { rows: 1 };
    const text = compareFingerprints(base(), r).bad.join("\n");
    expect(text).toContain("rate_hits: 2 rows after the restore, 0 expected");
    expect(text).toContain("public.extra exists after the restore but not in the backup");
  });
});

describe("files", () => {
  it("are summed with SHA-256, and a changed byte changes the sum", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sha-"));
    writeFileSync(join(dir, "a"), "abc");
    writeFileSync(join(dir, "b"), "abd");
    expect(await sha256File(join(dir, "a"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256File(join(dir, "b"))).not.toBe(await sha256File(join(dir, "a")));
  });
});

describe("the commands, before they touch anything", () => {
  const run = (script: string, env: Record<string, string>, args: string[] = []) => {
    const r = spawnSync(process.execPath, [resolve("scripts", script), ...args], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const out = join(mkdtempSync(join(tmpdir(), "bk-")), "out");

  it("backup: no connection string is exit 2 and nothing is created", () => {
    const r = run("db-backup.mjs", {}, ["--out", out]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.out).toMatch(/BACKUP_DATABASE_URL.*not set/);
  });

  it("backup: the pooled endpoint is exit 4 before any connection is made, and the password is not in the message", () => {
    const r = run("db-backup.mjs", { BACKUP_DATABASE_URL: `postgres://u:${encodeURIComponent(PW)}@ep-cool-123456-pooler.us-east-2.aws.neon.tech/neondb` }, ["--out", out]);
    expect(r.code).toBe(EXIT.POOLED);
    expect(r.out).toMatch(/direct endpoint/);
    expect(r.out).not.toContain(PW);
    expect(r.out).not.toMatch(/postgres:\/\//);
  });

  it("backup: an unreachable database is exit 5, with the cause and without the connection string", () => {
    const r = run("db-backup.mjs", { BACKUP_DATABASE_URL: `postgres://u:${encodeURIComponent(PW)}@127.0.0.1:1/x` }, ["--out", out]);
    expect(r.code).toBe(EXIT.CONNECT);
    expect(r.out).toMatch(/cannot connect/);
    expect(r.out).not.toContain(PW);
    expect(r.out).not.toMatch(/postgres:\/\//);
  });

  it("backup: DATABASE_URL is the fallback for the source, restore never falls back to it", () => {
    expect(run("db-backup.mjs", { DATABASE_URL: "postgres://u:p@ep-x-pooler.r.aws.neon.tech/d" }, ["--out", out]).code).toBe(EXIT.POOLED);
    const r = run("db-restore-verify.mjs", { DATABASE_URL: "postgres://u:p@127.0.0.1:1/d" }, [join(out, "x.dump")]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.out).toMatch(/TARGET_DATABASE_URL is not set/);
  });

  it("--prompt-password without a terminal is exit 2 (it never reads a password from a pipe or a file), and a URL without a password is otherwise used as it is", () => {
    const r = run("db-backup.mjs", { BACKUP_DATABASE_URL: "postgres://u@127.0.0.1:1/x" }, ["--out", out, "--prompt-password"]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.out).toMatch(/no terminal to ask on/);
    expect(run("db-backup.mjs", { BACKUP_DATABASE_URL: "postgres://u@127.0.0.1:1/x" }, ["--out", out]).code).toBe(EXIT.CONNECT);
  });

  it("restore: a missing dump, manifest or checksum is exit 2, naming the file that is missing", () => {
    const r = run("db-restore-verify.mjs", { TARGET_DATABASE_URL: "postgres://u:p@127.0.0.1:1/d" }, [join(out, "nothing.dump")]);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.out).toMatch(/nothing\.dump is missing/);
  });
});
