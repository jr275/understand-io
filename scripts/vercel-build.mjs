#!/usr/bin/env node
// The build command on Vercel (vercel.json). Two steps:
//   1. Production builds with a database apply pending migrations first, so the schema is ready before the new code serves.
//      The migration uses DATABASE_MIGRATION_URL when it is set (the migration role, direct endpoint: docs/ops/database-roles.md) and otherwise DATABASE_URL.
//      GLOSS_BUILD_MIGRATIONS=off skips it altogether: the operator then applies migrations themselves, from their own machine, with the migration role
//      (the only way the migration credential never has to exist in Vercel's environment).
//      The application itself only ever reads DATABASE_URL (the runtime role, which cannot change the schema).
//      Preview builds and builds without a database skip this and only build.
//   2. next build.
// A failing migration fails the build, and Vercel keeps serving the previous deployment. Migrations are additive (see docs/ops/configuration.md).
// The migration's output is printed with the database URL and its password replaced, because a driver error may echo them.
// SKIP_NEXT_BUILD=1 stops after step 1 (used to test this script).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const runtimeUrl = process.env.DATABASE_URL ?? "";
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? "";
const url = migrationUrl || runtimeUrl; // what the migration connects with
console.log(`Migration tool available: ${existsSync("node_modules/drizzle-kit/bin.cjs") ? "yes" : "NO"}.`);
const production = process.env.VERCEL_ENV === "production";
const buildMigrations = !/^(off|0|false|no)$/i.test((process.env.GLOSS_BUILD_MIGRATIONS ?? "").trim());

function redact(text) {
  let out = text;
  const secrets = [runtimeUrl, migrationUrl];
  for (const candidate of [runtimeUrl, migrationUrl]) {
    try {
      const u = new URL(candidate);
      if (u.password) secrets.push(u.password, decodeURIComponent(u.password));
      if (u.username) secrets.push(`${u.username}:`);
    } catch {
      /* a URL that does not parse has nothing more to hide than itself */
    }
  }
  for (const s of secrets) if (s) out = out.split(s).join("[hidden]");
  return out;
}

if (production && url && buildMigrations) {
  console.log(`Applying database migrations (production build, ${migrationUrl ? "migration role" : "DATABASE_URL"})...`);
  const r = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 180_000 });
  if (r.stdout) process.stdout.write(redact(r.stdout));
  if (r.stderr) process.stderr.write(redact(r.stderr));
  if (r.status !== 0) {
    console.error("\nThe database migration failed, so this build is stopped and the current deployment stays live. Nothing was deployed.");
    process.exit(1);
  }
  console.log("Database migrations are up to date.");
} else {
  console.log(`Skipping database migrations (${production ? (buildMigrations ? "no DATABASE_URL or DATABASE_MIGRATION_URL" : "GLOSS_BUILD_MIGRATIONS=off: the operator applies them") : `VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, not a production build`}).`);
}

if (process.env.SKIP_NEXT_BUILD === "1") process.exit(0);
const b = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env: process.env, stdio: "inherit" });
process.exit(b.status ?? 1);
