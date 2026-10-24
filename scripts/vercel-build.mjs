#!/usr/bin/env node
// The build command on Vercel (vercel.json). Two steps:
//   1. Production builds with a DATABASE_URL apply pending migrations first, so the schema is ready before the new code serves.
//      Preview builds and builds without a database skip this and only build.
//   2. next build.
// A failing migration fails the build, and Vercel keeps serving the previous deployment. Migrations are additive (see docs/ops/configuration.md).
// The migration's output is printed with the database URL and its password replaced, because a driver error may echo them.
// SKIP_NEXT_BUILD=1 stops after step 1 (used to test this script).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "";
console.log(`Migration tool available: ${existsSync("node_modules/drizzle-kit/bin.cjs") ? "yes" : "NO"}.`);
const production = process.env.VERCEL_ENV === "production";

function redact(text) {
  let out = text;
  const secrets = [url];
  try {
    const u = new URL(url);
    if (u.password) secrets.push(u.password, decodeURIComponent(u.password));
    if (u.username) secrets.push(`${u.username}:`);
  } catch {
    /* a URL that does not parse has nothing more to hide than itself */
  }
  for (const s of secrets) if (s) out = out.split(s).join("[hidden]");
  return out;
}

if (production && url) {
  console.log("Applying database migrations (production build)...");
  const r = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env, encoding: "utf8", timeout: 180_000 });
  if (r.stdout) process.stdout.write(redact(r.stdout));
  if (r.stderr) process.stderr.write(redact(r.stderr));
  if (r.status !== 0) {
    console.error("\nThe database migration failed, so this build is stopped and the current deployment stays live. Nothing was deployed.");
    process.exit(1);
  }
  console.log("Database migrations are up to date.");
} else {
  console.log(`Skipping database migrations (${production ? "no DATABASE_URL" : `VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, not a production build`}).`);
}

if (process.env.SKIP_NEXT_BUILD === "1") process.exit(0);
const b = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env: process.env, stdio: "inherit" });
process.exit(b.status ?? 1);
