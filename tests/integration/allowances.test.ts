import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The AI allowances against what production is made of: the production build started as several separate server processes (as separate
 * serverless instances would be), one PostgreSQL they share, and a stand-in for the AI provider on a local port. It is what shows that a daily
 * allowance, the one-generation-at-a-time rule and the global budget hold across instances and across a restart, that a database outage
 * stops the operator's key from being spent, and that neither the text a reader sends nor any credential reaches the server logs.
 *
 * Runs where there is a build (`.next`) and a disposable database (`DATABASE_URL`): in CI after the build, and locally after `next build`.
 * It starts and stops its own servers on ports 3311 to 3315; it does not use INTEGRATION_BASE_URL.
 */
const DB = process.env.DATABASE_URL ?? "";
const READY = !!DB && existsSync(".next/BUILD_ID");

const SECRET = randomBytes(32).toString("hex");
const KEY = `test-key-${randomBytes(6).toString("hex")}`;
const HEALTH_TOKEN = randomBytes(24).toString("hex"); // the readiness check exists only with a token of 32+ characters
const MARKER = `PRIVATE-MARKER-${randomBytes(6).toString("hex")}`;
const hmac = (s: string) => createHmac("sha256", SECRET).update(s).digest("base64url").slice(0, 22);
const readerCookie = (id: string) => `gloss_reader=${id}.${hmac(id)}`;
const sessionCookie = (id: string) => `gloss_session=${id}.${hmac(`session:${id}`)}`;
const rnd = () => Math.floor(Math.random() * 254) + 1;
const randomIp = () => `10.${rnd()}.${rnd()}.${rnd()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = randomBytes(4).toString("hex");

/* ------------------------------------------------------------------ a stand-in for the AI provider */

let provider: Server;
let providerPort = 0;
const providerCalls = { n: 0 };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
}

async function startProvider() {
  provider = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const raw = await readBody(req);
    providerCalls.n += 1;
    const body = JSON.parse(raw) as { stream?: boolean };
    const slow = raw.includes("SLOWPLEASE");
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    setTimeout(
      () => {
        if (body.stream) {
          const chunk = (delta: object, finish: string | null = null, extra: object = {}) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end([chunk({ role: "assistant" }), chunk({ content: "==Fine.== ¶1" }), chunk({}, "stop", { usage }), "data: [DONE]\n\n"].join(""));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ items: [{ text: "A note.", basis: "interpretation" }] }) }, finish_reason: "stop" }], usage }));
        }
      },
      slow ? 1500 : 0,
    );
  });
  await new Promise<void>((ok) => provider.listen(0, "127.0.0.1", ok));
  providerPort = (provider.address() as { port: number }).port;
}

/* ------------------------------------------------------------------ separate server processes */

interface Instance {
  port: number;
  proc: ChildProcess;
  log: string[];
}
const instances: Instance[] = [];
/** Everything every server process ever printed, including those stopped and restarted during the run. */
const allLogs: string[] = [];

async function start(port: number, env: Record<string, string> = {}): Promise<Instance> {
  const log: string[] = [];
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: {
      ...process.env,
      DATABASE_URL: DB,
      GLOSS_COOKIE_SECRET: SECRET,
      TOGETHER_API_KEY: KEY,
      GLOSS_TOGETHER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      GLOSS_CHAT_MODEL: "test/model",
      GLOSS_RATE_GLOSS: "off",
      GLOSS_RATE_IMPORT: "off",
      GLOSS_HEALTH_TOKEN: HEALTH_TOKEN,
      GLOSS_AI_MAX_CONCURRENT: "50",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (d: Buffer) => {
    log.push(String(d));
    allLogs.push(String(d));
  };
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  const inst = { port, proc, log };
  instances.push(inst);
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.status === 200 || r.status === 503) return inst;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`the server on port ${port} did not start:\n${log.join("").slice(-800)}`);
}

async function stop(inst: Instance) {
  await new Promise<void>((ok) => {
    inst.proc.once("exit", () => ok());
    inst.proc.kill("SIGTERM");
    setTimeout(ok, 5000);
  });
  instances.splice(instances.indexOf(inst), 1);
}

/* ------------------------------------------------------------------ one reader's request */

interface Who {
  reader?: string;
  account?: string;
  ip?: string;
  /** Put in the text title: "SLOWPLEASE" makes the stand-in provider take a second and a half. */
  slow?: boolean;
  key?: string;
}
interface Reply {
  status: number;
  error?: string;
  message?: string;
  retryAfter: string | null;
}

async function ask(inst: Instance, kind: "ai" | "gloss", who: Who): Promise<Reply> {
  const cookies = [who.reader && readerCookie(who.reader), who.account && sessionCookie(who.account)].filter(Boolean).join("; ");
  const title = `${who.slow ? "SLOWPLEASE " : ""}Tides ${MARKER}`;
  const block = { id: "p1", n: 1, type: "p", text: `${MARKER} The tide rises when the moon passes overhead.` };
  const body =
    kind === "ai"
      ? { op: "summarize", variant: "quick", title, blocks: [block], totalParagraphs: 1 }
      : { title, action: "explain", length: "short", anchor: null, context: [{ id: "p1", n: 1, text: block.text }] };
  const res = await fetch(`http://127.0.0.1:${inst.port}/api/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": who.ip ?? randomIp(), ...(cookies ? { cookie: cookies } : {}), ...(who.key ? { "x-gloss-key": who.key } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text(); // a margin answer is read to its end, which is when its lease is given back
  let j: { error?: string; message?: string } = {};
  if (res.headers.get("content-type")?.includes("application/json")) j = JSON.parse(text);
  return { status: res.status, error: j.error, message: j.message, retryAfter: res.headers.get("retry-after") };
}

/* ------------------------------------------------------------------ the tests */

describe.skipIf(!READY)("the AI allowances across separate server instances (production build, shared PostgreSQL)", () => {
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    await startProvider();
    [a, b] = await Promise.all([start(3311), start(3312)]);
  }, 180_000);

  afterAll(async () => {
    for (const i of [...instances]) await stop(i);
    await new Promise<void>((ok) => provider?.close(() => ok()));
  }, 60_000);

  it("a visitor's three questions a day are one allowance for every instance, and survive a restart", async () => {
    const who = { reader: `r_${run}_visitor`, ip: randomIp() };
    const before = providerCalls.n;
    expect((await ask(a, "ai", who)).status).toBe(200);
    expect((await ask(b, "gloss", who)).status).toBe(200);
    expect((await ask(a, "ai", who)).status).toBe(200);
    const fourth = await ask(b, "ai", who);
    expect(fourth).toMatchObject({ status: 429, error: "quota" });
    expect(fourth.message).toMatch(/3 free AI questions/);
    expect(Number(fourth.retryAfter)).toBeGreaterThan(0);
    expect(providerCalls.n - before).toBe(3); // the fourth never reached the provider
    expect((await ask(a, "gloss", who)).status).toBe(429);

    await stop(a);
    a = await start(3311); // a fresh process: nothing in memory remembers anything
    expect((await ask(a, "ai", who)).status).toBe(429);
    expect((await ask(b, "ai", who)).status).toBe(429);
  }, 180_000);

  it("clearing cookies does not get a visitor more: the address has its own allowance", async () => {
    const ip = randomIp();
    const ok: number[] = [];
    for (let i = 0; i < 12; i++) ok.push((await ask(i % 2 ? a : b, "ai", { reader: `r_${run}_clean${i}`, ip })).status);
    // Each fresh browser has three of its own, but the address allows ten a day in all.
    expect(ok.filter((s) => s === 200)).toHaveLength(10);
    expect(ok.slice(10)).toEqual([429, 429]);
  }, 180_000);

  it("a signed-in user has twenty a day in total, on any device and any instance", async () => {
    const who = { account: `acc_${run}_twenty` };
    for (let i = 0; i < 20; i++) expect((await ask(i % 2 ? a : b, "ai", { ...who, reader: `r_${run}_dev${i % 3}`, ip: randomIp() })).status).toBe(200);
    expect(await ask(a, "ai", who)).toMatchObject({ status: 429, error: "quota" });
    expect((await ask(b, "ai", who)).status).toBe(429);
    expect((await ask(a, "ai", { account: `acc_${run}_someone_else` })).status).toBe(200);
  }, 180_000);

  it("only one generation runs at a time per user, even when the second request lands on another instance", async () => {
    const who = { account: `acc_${run}_serial` };
    const first = ask(a, "ai", { ...who, slow: true });
    await sleep(500);
    const second = await ask(b, "gloss", { ...who, ip: randomIp() });
    expect(second).toMatchObject({ status: 429, error: "busy-user" });
    expect((await first).status).toBe(200);
    expect((await ask(b, "gloss", who)).status).toBe(200); // finished: the next one is allowed
  }, 180_000);

  it("six requests fired at once by one user: one runs, five are turned away, and only the one that ran is counted", async () => {
    const who = { account: `acc_${run}_burst` };
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => ask(i % 2 ? a : b, "ai", { ...who, slow: true, ip: randomIp() })));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.error === "busy-user")).toHaveLength(5);
    for (let i = 0; i < 19; i++) expect((await ask(i % 2 ? a : b, "ai", who)).status).toBe(200); // 1 + 19 = 20: the five turned away were given back
    expect((await ask(a, "ai", who)).status).toBe(429);
  }, 240_000);

  it("a reader's own key is not counted against the daily allowance", async () => {
    const who = { reader: `r_${run}_ownkey`, ip: randomIp(), key: "their-own-key" };
    for (let i = 0; i < 6; i++) expect((await ask(i % 2 ? a : b, "ai", who)).status).toBe(200);
  }, 180_000);

  it("the global budget is spent once, not once per instance: of twelve simultaneous requests only as many start as the budget holds", async () => {
    // Prices are stated so that every request sets aside the same, large, known amount: a short margin answer sends about 650 tokens and may
    // write 1420, so it sets aside about $2.07, and a day's budget of $7.50 holds three of them (6.22) and not four (8.30).
    const priced = { GLOSS_PRICE_IN_PER_M: "1000", GLOSS_PRICE_OUT_PER_M: "1000", GLOSS_BUDGET_DAILY_USD: "7.5", GLOSS_BUDGET_MONTHLY_USD: "1000" };
    const [c, d] = await Promise.all([start(3313, priced), start(3314, priced)]);
    const before = providerCalls.n;
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => ask(i % 2 ? c : d, "gloss", { account: `acc_${run}_budget${i}`, slow: true })));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(3);
    const refused = replies.filter((r) => r.status !== 200);
    expect(refused).toHaveLength(9);
    expect(refused.every((r) => r.status === 503 && r.error === "budget")).toBe(true);
    expect(refused[0].message).toMatch(/budget for today is used up/);
    expect(providerCalls.n - before).toBe(3);
    // Once they have finished, what they really used is a few cents: the same budget has room again.
    expect((await ask(c, "gloss", { account: `acc_${run}_budget_after` })).status).toBe(200);
  }, 240_000);

  it("a budget of zero pauses the shared AI for everyone, and a reader's own key keeps working", async () => {
    const paused = await start(3313 + 10, { GLOSS_BUDGET_DAILY_USD: "0" });
    const before = providerCalls.n;
    expect(await ask(paused, "ai", { account: `acc_${run}_paused` })).toMatchObject({ status: 503, error: "budget" });
    expect(providerCalls.n).toBe(before);
    expect((await ask(paused, "ai", { account: `acc_${run}_paused`, key: "their-own-key" })).status).toBe(200);
  }, 180_000);

  it("with the database unreachable the operator's key is not spent, the health check says so, and a reader's own key still works", async () => {
    const dead = await start(3315, { DATABASE_URL: "postgres://127.0.0.1:1/none" });
    const before = providerCalls.n;
    const refused = await ask(dead, "ai", { account: `acc_${run}_dead` });
    expect(refused).toMatchObject({ status: 503, error: "unavailable" });
    expect(refused.message).not.toMatch(/postgres|127\.0\.0\.1|ECONN/i);
    expect(providerCalls.n).toBe(before);
    expect((await ask(dead, "ai", { account: `acc_${run}_dead`, key: "their-own-key" })).status).toBe(200);
    const live = await fetch(`http://127.0.0.1:${dead.port}/api/health`); // liveness does not look at the database at all
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "ok", check: "liveness" });
    expect((await fetch(`http://127.0.0.1:${dead.port}/api/health/ready`)).status).toBe(401); // the public cannot ask for a reading
    const health = await fetch(`http://127.0.0.1:${dead.port}/api/health/ready`, { headers: { authorization: `Bearer ${HEALTH_TOKEN}` } });
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ status: "down", database: "down" });
  }, 180_000);

  it("the health check of a working instance says ok and holds no secret", async () => {
    const res = await fetch(`http://127.0.0.1:${a.port}/api/health/ready?fresh=1`, { headers: { authorization: `Bearer ${HEALTH_TOKEN}` } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: "ok", database: "ok", ai: { configured: true, allowancesShared: true } });
    expect(text).not.toContain(HEALTH_TOKEN);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(new URL(DB).password || "no-password-in-url");
  });

  it("nothing a reader sent and no credential reached any server log", () => {
    const logs = allLogs.join("");
    expect(logs.length).toBeGreaterThan(0); // the servers did log (their start-up, the usage lines), so this is a real search
    expect(logs).toContain("[usage]");
    expect(logs).not.toContain(MARKER); // the text and titles the readers sent
    expect(logs).not.toContain(KEY);
    expect(logs).not.toContain("their-own-key");
    expect(logs).not.toContain(SECRET);
    const dbPassword = new URL(DB).password;
    if (dbPassword) expect(logs).not.toContain(dbPassword);
    expect(logs).not.toMatch(/gloss_reader=|gloss_session=/);
  });
});
