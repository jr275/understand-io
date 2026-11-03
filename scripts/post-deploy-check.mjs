#!/usr/bin/env node
// What to run after every publication: the checks that tell a working release from a broken one, in one command, safe to repeat.
//
//   node scripts/post-deploy-check.mjs https://understand-io.vercel.app --commit b89c6fc
//   node scripts/post-deploy-check.mjs https://understand-io.vercel.app --ai      # also asks the AI one small question (costs a fraction of a cent)
//
// It uses a reader of its own (a fresh cookie), deletes whatever it creates, and prints PASS / FAIL / SKIP for each check. Exit code 1 if any
// check fails. SKIP is never a failure: it means the check could not run for a stated reason (for example, the day's free AI questions of
// this network are already used). Run it from the repository root (it reads tests/fixtures/scanned-image-only.pdf).
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/$/, "");
const commit = args.includes("--commit") ? args[args.indexOf("--commit") + 1] : "";
const withAi = args.includes("--ai");
if (!base) {
  console.error("Usage: node scripts/post-deploy-check.mjs <base url> [--commit <sha>] [--ai]");
  process.exit(2);
}
const https = base.startsWith("https://");

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function call(method, path, { body, form, headers = {}, cookie = true, redirect = "manual" } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie && jar.size ? { cookie: cookieHeader() } : {}), ...headers },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) jar.delete(pair.slice(0, i));
    else jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

let pass = 0, fail = 0, skip = 0;
const ok = (name, good, detail = "") => {
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
};
const skipped = (name, why) => {
  skip++;
  console.log(`SKIP  ${name} (${why})`);
};

// 1. health, and the commit that is live
const h = await call("GET", "/api/health?fresh=1", { cookie: false }); // fresh: a real reading, not the one reused for 15 minutes
ok("health answers 200 and says ok", h.status === 200 && h.json?.status === "ok", `status ${h.status}, ${h.json?.status}${h.json?.reasons?.length ? ` ${h.json.reasons}` : ""}`);
ok("the database answers", h.json?.database === "ok", h.json?.database);
if (commit) ok(`the live commit is ${commit}`, !!h.json?.commit && commit.startsWith(h.json.commit), `live: ${h.json?.commit}`);
if (h.json?.storage) ok(`the database is below 85% of its storage limit (${h.json.storage.usedMb} of ${h.json.storage.limitMb} MB, ${h.json.storage.percent}%)`, h.json.storage.level !== "high", h.json.warnings?.length ? `warning: ${h.json.warnings}` : "");
else skipped("database storage level", "the answer carries no size (no database, or an older deployment)");
ok("AI allowances are kept in the database (shared by every instance)", h.json?.database !== "ok" || h.json?.ai?.allowancesShared === true);
ok("the health answer holds no secret and no money", !/(sk-|tgp_|postgres:|password|spent|usd)/i.test(h.text));

// 2. pages and headers
for (const p of ["/", "/library", "/read/on-a-piece-of-chalk"]) {
  const r = await call("GET", p, { cookie: false });
  ok(`${p} loads`, r.status === 200, `HTTP ${r.status}`);
}
const home = await call("GET", "/", { cookie: false });
const hd = home.headers;
ok("security headers are on", hd.get("x-frame-options") === "DENY" && hd.get("x-content-type-options") === "nosniff" && /frame-ancestors 'none'/.test(hd.get("content-security-policy") ?? ""));
if (https) ok("HSTS is on over HTTPS", /max-age=\d{7,}/.test(hd.get("strict-transport-security") ?? ""));
const cors = await call("GET", "/api/documents", { cookie: false, headers: { origin: "https://evil.example" } });
ok("the API sends no CORS headers", !cors.headers.get("access-control-allow-origin"));

// 3. a reader of its own, and its cookie
const boot = await call("POST", "/api/reader");
ok("the server keeps this visitor's library (cookie accepted)", boot.json?.persisted === true && jar.has("gloss_reader"), JSON.stringify(boot.json));
const setCookie = boot.headers.getSetCookie?.().find((c) => c.startsWith("gloss_reader=")) ?? "";
ok("the reader cookie is HttpOnly, SameSite=Lax" + (https ? " and Secure" : ""), /httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie) && (!https || /;\s*secure/i.test(setCookie)));

// 4. import, list, duplicate, delete
const stamp = Date.now().toString(36);
const text = `Post-deploy check ${stamp}. ` + "A paragraph of enough length to be kept as a document of its own, with words only this check has. ".repeat(4) + "\n\nSecond paragraph.";
const made = [];
const first = await call("POST", "/api/import/text", { body: { text, title: `Post-deploy ${stamp}` } });
if (first.json?.document?.id) made.push(first.json.document.id);
ok("a pasted text is saved", first.status === 200 && first.json?.persisted === true && !!first.json?.document?.id, `HTTP ${first.status}`);
const listed = await call("GET", "/api/documents");
ok("and it is on the shelf", (listed.json?.documents ?? []).some((d) => d.id === first.json?.document?.id));
const again = await call("POST", "/api/import/text", { body: { text, title: "again" } });
ok("the same text again is recognised as a duplicate", again.json?.duplicate === true);
for (const n of [1, 2]) {
  const s = await call("POST", "/api/import/text", { body: { text: `Short note ${n}.`, title: `Short ${stamp} ${n}` } });
  if (s.json?.document?.id) made.push(s.json.document.id);
}
ok("two short notes stay two documents", (await call("GET", "/api/documents")).json.documents.filter((d) => d.title.startsWith(`Short ${stamp}`)).length === 2);
const stranger = await call("GET", `/api/documents/${first.json?.document?.id}/data`, { cookie: false });
ok("another visitor sees none of it", !(stranger.json?.annotations?.length) && !JSON.stringify(stranger.json).includes(stamp));

// 5. refusals
if (existsSync("tests/fixtures/scanned-image-only.pdf")) {
  const fd = new FormData();
  fd.append("file", new File([readFileSync("tests/fixtures/scanned-image-only.pdf")], "scan.pdf", { type: "application/pdf" }));
  const scan = await call("POST", "/api/import/file", { form: fd });
  ok("a scanned PDF is refused with the reason (no OCR)", scan.status === 422 && /no OCR/.test(scan.json?.error ?? ""), `HTTP ${scan.status}`);
} else skipped("a scanned PDF is refused", "tests/fixtures/scanned-image-only.pdf not found: run from the repository root");
for (const [url, name] of [["http://169.254.169.254/latest/meta-data/", "the metadata address"], ["http://localhost:3000/", "localhost"], ["ftp://example.com/a", "a non-web link"], ["not a url", "text that is not a link"]]) {
  const r = await call("POST", "/api/import", { body: { url } });
  ok(`a link to ${name} is refused`, r.status === 400 || r.status === 422, `HTTP ${r.status}`);
}
const cross = await call("POST", "/api/reader", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
ok("a cross-site write is refused", cross.status === 403);

// 6. sign-in is wired to this address
const me = await call("GET", "/api/auth/me", { cookie: false });
ok("sign-in is configured", me.json?.configured === true && me.json?.account === null);
const g = await call("GET", "/api/auth/google", { cookie: false });
const loc = g.headers.get("location") ?? "";
let u = null;
try {
  u = new URL(loc);
} catch {
  /* not a URL */
}
ok("the Google sign-in redirect uses this address for the return", g.status === 302 && u?.hostname === "accounts.google.com" && u.searchParams.get("redirect_uri") === `${base}/api/auth/google/callback`, u ? `return to ${u.searchParams.get("redirect_uri")}` : `HTTP ${g.status}`);
ok("and asks only for openid email profile, with PKCE", u?.searchParams.get("scope") === "openid email profile" && u?.searchParams.get("code_challenge_method") === "S256" && !!u?.searchParams.get("state"));

// 7. the legal texts: either not published (404) or final; never a draft
for (const p of ["/privacy", "/terms"]) {
  const r = await call("GET", p, { cookie: false });
  if (r.status === 404) skipped(`${p}`, "not published (the switch is off, or the text is still a draft): as intended until the legal review is done");
  else ok(`${p} is published and holds no draft marker`, r.status === 200 && !/⚠️|DRAFT|RASCUNHO/.test(r.text), `HTTP ${r.status}`);
}

// 8. the AI, once
if (withAi) {
  const body = {
    op: "summarize",
    variant: "quick",
    title: "Chalk",
    blocks: [
      { id: "p1", n: 1, type: "p", text: "Chalk is a soft white porous sedimentary rock, a form of limestone made of the mineral calcite, formed from the shells of tiny sea creatures." },
      { id: "p2", n: 2, type: "p", text: "Huxley argued that the chalk of Britain shows the land was once covered by a deep sea." },
    ],
    totalParagraphs: 2,
  };
  const r = await call("POST", "/api/ai", { body });
  if (r.status === 429 && ["quota", "busy-user"].includes(r.json?.error)) skipped("the AI answers", `${r.json.error}: ${r.json.message.slice(0, 70)}`);
  else if (r.status === 503 && ["budget", "unavailable"].includes(r.json?.error)) skipped("the AI answers", `${r.json.error}: the shared AI is paused or its allowances are unreadable`);
  else {
    const items = r.json?.result?.items ?? [];
    const quotes = items.flatMap((i) => i.evidence ?? []);
    const byId = new Map(body.blocks.map((b) => [b.id, b.text]));
    ok("the AI answers with a summary", r.status === 200 && items.length > 0, `HTTP ${r.status}${r.json?.error ? ` ${r.json.error}` : ""}`);
    ok("and every quote it shows is really in the text", quotes.every((q) => byId.has(q.blockId) && byId.get(q.blockId).slice(q.start, q.end).replace(/\s+/g, " ").toLowerCase() === q.quote.replace(/\s+/g, " ").toLowerCase()), `${quotes.length} quote(s)`);
  }
}

// clean up
for (const id of made) await call("DELETE", `/api/documents/${id}`);
const left = ((await call("GET", "/api/documents")).json?.documents ?? []).length;
ok("everything this check created is deleted", left === 0, `${left} left`);

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped.`);
process.exit(fail ? 1 : 0);
