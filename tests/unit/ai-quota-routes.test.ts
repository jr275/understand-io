// The daily allowances, the one-at-a-time rule and the global budget as a reader meets them: through the real routes, the real AI SDK and
// real signed cookies. Only the network (global fetch) and the allowance store (in memory) are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realFetch = globalThis.fetch;
let ipCounter = 0;
const ip = () => `192.0.2.${(ipCounter = (ipCounter + 1) % 250)}`;

const BLOCKS = [
  { id: "p1", n: 1, type: "p", text: "The tide rises when the moon passes overhead and falls afterwards." },
  { id: "p2", n: 2, type: "p", text: "Spring tides are higher because the sun and the moon pull together." },
];
const aiBody = () => ({ op: "summarize", variant: "quick", title: "Tides", blocks: BLOCKS, totalParagraphs: 2 });
const glossBody = () => ({ title: "T", action: "explain", length: "normal", anchor: null, context: [{ id: "p1", n: 1, text: BLOCKS[0].text }] });

const completion = (content: string) =>
  new Response(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const GOOD = JSON.stringify({ items: [{ text: "Tides follow the moon.", basis: "text", evidence: [{ id: "p1", quote: "tide rises when the moon passes overhead" }] }] });
const sse = (pieces: string[]) => {
  const chunk = (delta: object, finish: string | null = null, extra: object = {}) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const body = [chunk({ role: "assistant" }), ...pieces.map((p) => chunk({ content: p })), chunk({}, "stop", { usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 } }), "data: [DONE]\n\n"].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

interface Setup {
  ai: (r: Request) => Promise<Response>;
  gloss: (r: Request) => Promise<Response>;
  store: import("@/lib/server/aiStore").MemoryAiStore;
  cookies: { reader: (id: string) => string; account: (id: string) => string };
  aiCalls: () => number;
}

async function setup(env: Record<string, string> = {}): Promise<Setup> {
  vi.resetModules();
  vi.stubEnv("TOGETHER_API_KEY", "test-server-key");
  vi.stubEnv("GLOSS_RATE_GLOSS", "off"); // the hourly layer has its own tests
  vi.stubEnv("GLOSS_COOKIE_SECRET", "a-test-secret-that-is-at-least-thirty-two-characters-long");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const limits = await import("@/lib/server/rateLimit");
  limits.setSharedCounter(null);
  limits.resetRateLimits();
  const allowances = await import("@/lib/server/aiStore");
  const store = allowances.createMemoryAiStore();
  allowances.setAiStore(store);
  const reader = await import("@/lib/server/reader");
  const auth = await import("@/lib/server/auth");
  const ai = (await import("@/app/api/ai/route")).POST;
  const gloss = (await import("@/app/api/gloss/route")).POST;
  return {
    ai,
    gloss,
    store,
    cookies: {
      reader: (id) => `${reader.READER_COOKIE}=${reader.readerCookieValue(id)}`,
      account: (id) => `${auth.SESSION_COOKIE}=${reader.signToken("session", id)}`,
    },
    aiCalls: () => 0,
  };
}

const post = (path: string, body: unknown, cookie = "", extra: Record<string, string> = {}) =>
  new Request(`http://x.test${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a visitor who is not signed in", () => {
  it("gets three AI questions a day across the margin answers and the summaries, and the fourth never reaches the provider", async () => {
    const t = await setup();
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => (String((init?.body as string) ?? "").includes("stream") ? sse(["==Short.== ¶1"]) : completion(GOOD)));
    vi.stubGlobal("fetch", upstream);
    const cookie = t.cookies.reader("r_visitor");
    expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(200);
    expect((await (await t.gloss(post("/api/gloss", glossBody(), cookie))).text()).length).toBeGreaterThan(0);
    expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(200);
    const calls = upstream.mock.calls.length;
    const fourth = await t.ai(post("/api/ai", aiBody(), cookie));
    expect(fourth.status).toBe(429);
    const j = await fourth.json();
    expect(j.error).toBe("quota");
    expect(j.message).toMatch(/3 free AI questions.*Sign in with Google for 20 a day/);
    expect(upstream.mock.calls.length).toBe(calls); // nothing was sent to the provider, so nothing was spent
    const streamed = await t.gloss(post("/api/gloss", glossBody(), cookie));
    expect(streamed.status).toBe(429); // refused before streaming starts, as a plain JSON answer
    expect(((await streamed.json()) as { message: string }).message).toMatch(/Sign in with Google/);
  });

  it("is a visitor still when the cookie is forged or missing, counted by address", async () => {
    const t = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    const addr = "203.0.113.200";
    for (let i = 0; i < 3; i++) expect((await t.ai(post("/api/ai", aiBody(), "gloss_session=acc_x.FORGED", { "x-forwarded-for": addr }))).status).toBe(200);
    expect((await t.ai(post("/api/ai", aiBody(), "gloss_session=acc_x.FORGED", { "x-forwarded-for": addr }))).status).toBe(429);
  });

  it("a malformed request does not use up a question", async () => {
    const t = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    const cookie = t.cookies.reader("r_visitor");
    for (let i = 0; i < 6; i++) expect((await t.ai(post("/api/ai", { op: "delete-everything" }, cookie))).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(200);
  });

  it("a failed provider call gives the question back", async () => {
    const t = await setup();
    const cookie = t.cookies.reader("r_visitor");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    for (let i = 0; i < 5; i++) expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(502); // five failures: none counted
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    for (let i = 0; i < 3; i++) expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(200);
    expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(429);
  });
});

describe("a signed-in user", () => {
  it("gets twenty a day, whatever device they use", async () => {
    const t = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    for (let i = 0; i < 20; i++) expect((await t.ai(post("/api/ai", aiBody(), `${t.cookies.account("acc_1")}; ${t.cookies.reader(`r_dev${i % 4}`)}`))).status).toBe(200);
    const next = await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_1")));
    expect(next.status).toBe(429);
    expect(((await next.json()) as { message: string }).message).toMatch(/today's 20 AI questions/);
    expect((await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_2")))).status).toBe(200); // someone else is unaffected
  });
  it("the numbers follow the environment, with no release", async () => {
    const t = await setup({ GLOSS_QUOTA_AI_USER_PER_DAY: "2", GLOSS_QUOTA_AI_ANON_PER_DAY: "1" });
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    expect((await t.ai(post("/api/ai", aiBody(), t.cookies.reader("r_v")))).status).toBe(200);
    expect((await t.ai(post("/api/ai", aiBody(), t.cookies.reader("r_v")))).status).toBe(429);
    for (let i = 0; i < 2; i++) expect((await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_1")))).status).toBe(200);
    expect((await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_1")))).status).toBe(429);
  });
});

describe("one generation at a time", () => {
  it("while an answer is being written, another request from the same user is turned away, and goes through once the first is done", async () => {
    const t = await setup();
    let finish: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((ok) => (finish = () => ok(completion(GOOD))))),
    );
    const cookie = t.cookies.account("acc_1");
    const first = t.ai(post("/api/ai", aiBody(), cookie));
    await vi.waitFor(() => expect(finish).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 20));
    const second = await t.ai(post("/api/ai", aiBody(), `${cookie}; ${t.cookies.reader("r_other_device")}`));
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toBe("busy-user");
    finish();
    expect((await first).status).toBe(200);
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    expect((await t.ai(post("/api/ai", aiBody(), cookie))).status).toBe(200);
  });

  it("a margin answer holds the lease until its stream has ended", async () => {
    const t = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => sse(["==A key sentence.== ", "It says so ¶1."])));
    const cookie = t.cookies.account("acc_1");
    const res = await t.gloss(post("/api/gloss", glossBody(), cookie));
    expect(res.status).toBe(200);
    const text = await res.text(); // the stream is read to its end
    expect(text).toContain("It says so ¶1.");
    expect((await t.gloss(post("/api/gloss", glossBody(), cookie))).status).toBe(200); // the lease is free again
  });
});

describe("a reader's own key", () => {
  it("is not limited by the daily allowance and not charged to the operator's budget", async () => {
    const t = await setup({ GLOSS_BUDGET_DAILY_USD: "0" });
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    for (let i = 0; i < 8; i++) expect((await t.ai(post("/api/ai", aiBody(), t.cookies.reader("r_v"), { "x-gloss-key": "their-own-key" }))).status).toBe(200);
    expect((await t.store.usage(Date.now())).day.requests).toBe(0);
  });
});

describe("the global budget", () => {
  it("pauses the shared AI for everyone once it is used up, without calling the provider", async () => {
    const t = await setup({ GLOSS_BUDGET_DAILY_USD: "0" });
    const upstream = vi.fn(async () => completion(GOOD));
    vi.stubGlobal("fetch", upstream);
    const r = await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_1")));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect(((await r.json()) as { error: string; message: string }).message).toMatch(/budget for today is used up.*your own Together key/);
    expect(upstream).not.toHaveBeenCalled();
    const g = await t.gloss(post("/api/gloss", glossBody(), t.cookies.account("acc_1")));
    expect(g.status).toBe(503);
  });

  it("records what each answer cost, with the tokens the provider reported", async () => {
    const t = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => completion(GOOD)));
    await t.ai(post("/api/ai", aiBody(), t.cookies.account("acc_1")));
    await (await t.gloss(post("/api/gloss", glossBody(), t.cookies.account("acc_1")))).text();
    const u = await t.store.usage(Date.now());
    expect(u.day.requests).toBe(2);
    expect(u.day.spentMicro).toBeGreaterThan(0);
    expect(u.day.inputTokens).toBeGreaterThanOrEqual(100);
    expect(u.reservedMicro).toBe(0); // nothing left set aside
  });
});

describe("when the database that holds the allowances cannot be reached", () => {
  it("the operator's key is not spent; a reader's own key still works", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://127.0.0.1:1/none"); // nothing listens there
    vi.stubEnv("TOGETHER_API_KEY", "test-server-key");
    vi.stubEnv("GLOSS_RATE_GLOSS", "off");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "a-test-secret-that-is-at-least-thirty-two-characters-long");
    const limits = await import("@/lib/server/rateLimit");
    limits.setSharedCounter(null);
    const allowances = await import("@/lib/server/aiStore");
    allowances.setAiStore(undefined); // the real, database-backed store
    const ai = (await import("@/app/api/ai/route")).POST;
    const upstream = vi.fn(async () => completion(GOOD));
    vi.stubGlobal("fetch", upstream);
    const refused = await ai(post("/api/ai", aiBody(), ""));
    expect(refused.status).toBe(503);
    const j = (await refused.json()) as { error: string; message: string };
    expect(j.error).toBe("unavailable");
    expect(j.message).not.toMatch(/postgres|127\.0\.0\.1|ECONN/i);
    expect(upstream).not.toHaveBeenCalled();
    const own = await ai(post("/api/ai", aiBody(), "", { "x-gloss-key": "their-own-key" }));
    expect(own.status).toBe(200);
    delete (globalThis as { __glossDb?: unknown }).__glossDb;
  });
});
