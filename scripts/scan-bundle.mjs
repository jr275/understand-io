#!/usr/bin/env node
// Looks for credentials in what the build produced for the browser (and in the pages prerendered at build time).
//
//   node scripts/scan-bundle.mjs
//
// Build first with recognisable stand-in values in the secret environment variables (see docs/ops/release-checklist.md). The scan then looks for
// those exact values, for the names of server-only variables (they appear in the client bundle only if server code leaked into it) and for the
// shape of common credentials. It prints which file and which kind of finding, never the value, and exits 1 if there is any.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

// Variables whose values must never reach the browser. Their values are searched for everywhere that is scanned.
const SERVER_ONLY = ["TOGETHER_API_KEY", "GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GLOSS_COOKIE_SECRET", "DATABASE_URL", "GLOSS_HEALTH_TOKEN", "GLOSS_TOGETHER_BASE_URL"];
// Variables whose NAMES must not appear in the client bundle either, because only server code mentions them. The two Google names are left out on
// purpose: the Sign in popover names them (no values) to tell the operator what is missing when sign-in is not configured (tests/e2e/landing.spec.ts).
const NAMES_SERVER_ONLY = SERVER_ONLY.filter((n) => !n.startsWith("GOOGLE_CLIENT"));
const SHAPES = [
  ["a database address with a password", /postgres(?:ql)?:\/\/[^\s"'<>:@/]+:[^\s"'<>@]{3,}@/],
  ["an OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a Together-style key", /\btgp_v1_[A-Za-z0-9_-]{10,}/],
  ["a Google client secret", /\bGOCSPX-[A-Za-z0-9_-]{10,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["a private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

// What the browser is served: the client chunks, and the pages and data prerendered at build time. Server code (.next/server/chunks) is not served.
const ROOTS = [".next/static", ".next/server/app", "public"].filter(existsSync);
const TEXT = /\.(js|mjs|css|html|rsc|json|txt|map|svg|xml|body|meta)$/i;

const values = SERVER_ONLY.map((name) => [name, process.env[name] ?? ""]).filter(([, v]) => v.length >= 8);
// For a database address the secret part is the password; the address as a whole also counts.
for (const [name, v] of [...values]) {
  if (name === "DATABASE_URL") {
    try {
      const pw = decodeURIComponent(new URL(v).password);
      if (pw.length >= 6) values.push(["DATABASE_URL (password)", pw]);
    } catch {
      /* not a URL: the whole value is still searched */
    }
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (TEXT.test(entry) && s.size < 25 * 1024 * 1024) yield p;
  }
}

const findings = [];
let files = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    files += 1;
    const text = readFileSync(file, "utf8");
    for (const [name, v] of values) if (text.includes(v)) findings.push(`${file}: the value of ${name}`);
    if (file.startsWith(".next/static"))
      for (const name of NAMES_SERVER_ONLY) if (text.includes(name)) findings.push(`${file}: the name ${name} (server-only code reached the browser bundle)`);
    for (const [what, re] of SHAPES) if (re.test(text)) findings.push(`${file}: ${what}`);
  }
}

if (!ROOTS.length) {
  console.error("Nothing to scan: build first (next build).");
  process.exit(2);
}
console.log(`Scanned ${files} files under ${ROOTS.join(", ")} for ${values.length} stand-in value${values.length === 1 ? "" : "s"}, ${NAMES_SERVER_ONLY.length} server-only names and ${SHAPES.length} credential shapes.`);
if (!values.length) console.log("Note: no stand-in secret values were set in the environment, so only names and shapes were checked.");
if (findings.length) {
  console.error(`FOUND ${findings.length}:\n  ${[...new Set(findings)].join("\n  ")}`);
  process.exit(1);
}
console.log("Nothing found.");
