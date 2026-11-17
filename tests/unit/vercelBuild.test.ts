// scripts/vercel-build.mjs decides which database credential the build migrates with. The migration tool is replaced by a stand-in that reveals only a
// short hash of the URL it was given, so nothing here holds or prints a real credential.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/vercel-build.mjs");
const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 8);
const RUNTIME = "postgres://app_user:runtime-secret-AAA@db.example.test:5432/app";
const MIGRATION = "postgres://migrator_user:migration-secret-BBB@db.example.test:5432/app";

function build(env: Record<string, string>, fakeExit = 0) {
  const dir = mkdtempSync(join(tmpdir(), "vb-"));
  mkdirSync(join(dir, "node_modules/drizzle-kit"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules/drizzle-kit/bin.cjs"),
    `const c=require("node:crypto");const u=process.env.DATABASE_URL||"";console.log("migrate-url-hash:"+c.createHash("sha256").update(u).digest("hex").slice(0,8));console.error("driver says: could not connect to "+u);process.exit(${fakeExit});`,
  );
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: { PATH: process.env.PATH ?? "", SKIP_NEXT_BUILD: "1", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("which credential the production build migrates with", () => {
  it("uses DATABASE_URL when there is no migration URL (unchanged behaviour)", () => {
    const r = build({ VERCEL_ENV: "production", DATABASE_URL: RUNTIME });
    expect(r.status).toBe(0);
    expect(r.out).toContain(`migrate-url-hash:${hash(RUNTIME)}`);
    expect(r.out).toContain("DATABASE_URL)");
  });

  it("uses DATABASE_MIGRATION_URL when it is set, so the runtime role never needs the right to change the schema", () => {
    const r = build({ VERCEL_ENV: "production", DATABASE_URL: RUNTIME, DATABASE_MIGRATION_URL: MIGRATION });
    expect(r.status).toBe(0);
    expect(r.out).toContain(`migrate-url-hash:${hash(MIGRATION)}`);
    expect(r.out).not.toContain(`migrate-url-hash:${hash(RUNTIME)}`);
    expect(r.out).toContain("migration role");
  });

  it("migrates with the migration URL even where the runtime URL is missing, and skips everywhere that is not a production build", () => {
    expect(build({ VERCEL_ENV: "production", DATABASE_MIGRATION_URL: MIGRATION }).out).toContain(`migrate-url-hash:${hash(MIGRATION)}`);
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}] as Record<string, string>[]) {
      const r = build({ ...env, DATABASE_URL: RUNTIME, DATABASE_MIGRATION_URL: MIGRATION });
      expect(r.out, JSON.stringify(env)).toContain("Skipping database migrations");
      expect(r.out).not.toContain("migrate-url-hash");
    }
    expect(build({ VERCEL_ENV: "production" }).out).toContain("Skipping database migrations");
  });

  it("GLOSS_BUILD_MIGRATIONS=off leaves migrations to the operator: the build touches no database and holds no migration credential", () => {
    for (const off of ["off", "0", "false", "OFF"]) {
      const r = build({ VERCEL_ENV: "production", DATABASE_URL: RUNTIME, GLOSS_BUILD_MIGRATIONS: off });
      expect(r.status, off).toBe(0);
      expect(r.out, off).toContain("the operator applies them");
      expect(r.out, off).not.toContain("migrate-url-hash");
    }
    expect(build({ VERCEL_ENV: "production", DATABASE_URL: RUNTIME, GLOSS_BUILD_MIGRATIONS: "on" }).out).toContain("migrate-url-hash");
  });

  it("stops the build when the migration fails, and prints neither URL nor either password, whichever credential was used", () => {
    const r = build({ VERCEL_ENV: "production", DATABASE_URL: RUNTIME, DATABASE_MIGRATION_URL: MIGRATION }, 1);
    expect(r.status).toBe(1);
    expect(r.out).toContain("the current deployment stays live");
    expect(r.out).not.toMatch(/runtime-secret-AAA|migration-secret-BBB|postgres:\/\//);
    expect(r.out).toContain("[hidden]");
  });
});
