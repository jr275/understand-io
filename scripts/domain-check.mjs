#!/usr/bin/env node
// What to look at once a domain has been attached in Vercel and before / after APP_URL is switched. Read-only: DNS lookups, one TLS handshake and a few GETs.
//
//   node scripts/domain-check.mjs <domain> [old-address]       e.g. node scripts/domain-check.mjs understand.example.com
//
// It does not change anything. After it passes, run the full check on the new address: node scripts/post-deploy-check.mjs https://<domain>
// (that one covers the health answer, cookies, headers and the Google redirect address, which only uses the new domain once APP_URL has been switched).
import dns from "node:dns/promises";
import tls from "node:tls";

const domain = (process.argv[2] ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
const old = (process.argv[3] ?? "https://understand-io.vercel.app").replace(/\/$/, "");
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  console.error("Usage: node scripts/domain-check.mjs <domain> [old-address]");
  process.exit(2);
}

let failed = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
};
const info = (name, detail) => console.log(`INFO  ${name}: ${detail}`);

// 1. DNS
const [a, aaaa, cname] = await Promise.all([dns.resolve4(domain).catch(() => []), dns.resolve6(domain).catch(() => []), dns.resolveCname(domain).catch(() => [])]);
ok("the name resolves", a.length + aaaa.length + cname.length > 0, [...cname.map((c) => `CNAME ${c}`), ...a, ...aaaa].join(", ") || "no record");
const vercelLike = cname.some((c) => /vercel-dns\.com\.?$|vercel\.app\.?$/.test(c)) || a.includes("76.76.21.21");
info("points at Vercel", vercelLike ? "yes (CNAME to Vercel, or the A record 76.76.21.21)" : "not recognised: Vercel shows the exact records to add under Settings → Domains; the value can differ per project");

// 2. HTTPS certificate
const cert = await new Promise((resolve) => {
  const s = tls.connect({ host: domain, port: 443, servername: domain, timeout: 10000 }, () => {
    const c = s.getPeerCertificate();
    resolve({ valid: s.authorized, error: s.authorizationError, c });
    s.end();
  });
  s.on("error", (e) => resolve({ valid: false, error: e.code ?? e.message }));
  s.on("timeout", () => {
    resolve({ valid: false, error: "timeout" });
    s.destroy();
  });
});
const days = cert.c?.valid_to ? Math.floor((new Date(cert.c.valid_to).getTime() - Date.now()) / 86_400_000) : null;
ok("HTTPS: the certificate is trusted for this name", !!cert.valid, cert.valid ? `${days} days left, issuer ${cert.c?.issuer?.O ?? "?"}` : String(cert.error));

// 3. HTTP redirects to HTTPS, and the pages answer
const get = async (url, opts = {}) => {
  try {
    return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), ...opts });
  } catch (e) {
    return { status: 0, headers: new Headers(), error: e.cause?.code ?? e.message };
  }
};
const http = await get(`http://${domain}/`);
ok("http:// redirects to https://", [301, 302, 307, 308].includes(http.status) && (http.headers.get("location") ?? "").startsWith("https://"), `HTTP ${http.status}${http.error ? ` ${http.error}` : ""}`);
const home = await get(`https://${domain}/`);
ok("the home page answers 200", home.status === 200, `HTTP ${home.status}${home.error ? ` ${home.error}` : ""}`);
const hsts = home.headers.get("strict-transport-security");
ok("HSTS is sent", !!hsts, hsts ?? "missing");
const health = await get(`https://${domain}/api/health?fresh=1`);
let j = null;
try {
  j = await health.json();
} catch {}
ok("the health answer says ok", health.status === 200 && j?.status === "ok", `HTTP ${health.status}${j?.status ? `, ${j.status}` : ""}`);
if (j) info("commit live on the new address", j.commit ?? "unknown");

// 4. canonical address and the old address
const html = home.status === 200 ? await (await get(`https://${domain}/`, { redirect: "follow" })).text().catch(() => "") : "";
const canon = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i.exec(html)?.[1];
info("canonical link", canon ? canon : "none on the home page (it appears when APP_URL is set at build time)");
if (canon) ok("the canonical address is this domain", new URL(canon).host === domain, canon);
const oldRes = await get(`${old}/`);
info("old address", `${old} answers HTTP ${oldRes.status}${[301, 302, 307, 308].includes(oldRes.status) ? ` → ${oldRes.headers.get("location")}` : ""} (redirect or keep it live: docs/ops/domain-migration.md)`);

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed. Next: node scripts/post-deploy-check.mjs https://" + domain);
process.exit(failed ? 1 : 0);
