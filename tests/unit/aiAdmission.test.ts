// The gate in front of the operator's AI key, run against the in-memory allowance store (the database version has its own test).
// Requests carry real signed cookies, so who is asking is decided by the same code as in production.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admitAi, identifyClient, limitDaily, type Admission, type AdmitInput } from "@/lib/server/aiAdmission";
import { createMemoryAiStore, type AiStore, type MemoryAiStore } from "@/lib/server/aiStore";
import { READER_COOKIE, readerCookieValue, signToken } from "@/lib/server/reader";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { costMicro, toMicro } from "@/lib/ai/budget";
import { estimateCost } from "@/lib/ai/provider";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 27, 15, 0, 0); // a fixed moment in the middle of a UTC day

let store: MemoryAiStore;
beforeEach(() => {
  store = createMemoryAiStore();
  // settle() stamps the ledger with the clock (the request's end), while admit() is given T0: without a fixed clock these tests only pass on T0's own day.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface Who {
  reader?: string;
  account?: string;
  ip?: string;
}
const request = (who: Who = {}) => {
  const cookies: string[] = [];
  if (who.reader) cookies.push(`${READER_COOKIE}=${readerCookieValue(who.reader)}`);
  if (who.account) cookies.push(`${SESSION_COOKIE}=${signToken("session", who.account)}`);
  return new Request("http://x.test/api/ai", { method: "POST", headers: { "x-forwarded-for": who.ip ?? "198.51.100.1", ...(cookies.length ? { cookie: cookies.join("; ") } : {}) } });
};
const SMALL = { inputTokens: 2000, outputTokens: 1000 };
const admit = (who: Who = {}, over: Partial<AdmitInput> = {}) => admitAi({ req: request(who), source: "server", estimate: SMALL, leaseTtlMs: 60_000, store, now: T0, model: "openai/gpt-oss-120b", ...over });
const granted = (a: Admission) => {
  if (!a.ok) throw new Error(`refused: ${a.response.status}`);
  return a;
};
const refusal = async (a: Admission) => {
  if (a.ok) throw new Error("expected a refusal");
  return { status: a.response.status, retryAfter: a.response.headers.get("retry-after"), ...((await a.response.json()) as { error: string; message: string }) };
};
/** One finished, successful generation. */
async function ask(who: Who, over: Partial<AdmitInput> = {}) {
  const a = await admit(who, over);
  if (a.ok) await a.settle({ kind: "ok", inputTokens: 500, outputTokens: 300 });
  return a;
}

describe("who is asking", () => {
  it("a signed session names the account, a signed reader cookie names the browser, nothing else is taken on trust", () => {
    expect(identifyClient(request({ account: "acc_1", reader: "r_1" }))).toMatchObject({ accountId: "acc_1", clientKey: "r_1" });
    expect(identifyClient(request({ reader: "r_1" }))).toMatchObject({ accountId: null, clientKey: "r_1" });
    expect(identifyClient(request({ ip: "203.0.113.9" }))).toMatchObject({ accountId: null, clientKey: "ip:203.0.113.9" });
  });
  it("a forged session or reader cookie counts as nobody", () => {
    const forged = new Request("http://x.test/", { headers: { "x-forwarded-for": "203.0.113.5", cookie: `${SESSION_COOKIE}=acc_1.AAAA; ${READER_COOKIE}=r_1.BBBB` } });
    expect(identifyClient(forged)).toMatchObject({ accountId: null, clientKey: "ip:203.0.113.5" });
  });
});

describe("a visitor who is not signed in: 3 questions a day", () => {
  it("allows three, refuses the fourth with the reason, a way forward and the time to come back", async () => {
    for (let i = 0; i < 3; i++) granted(await ask({ reader: "r_a" }));
    const r = await refusal(await admit({ reader: "r_a" }));
    expect(r.status).toBe(429);
    expect(r.error).toBe("quota");
    expect(r.message).toMatch(/3 free AI questions/);
    expect(r.message).toMatch(/Sign in with Google for 20 a day/);
    expect(r.message).toMatch(/your own Together key/);
    expect(Number(r.retryAfter)).toBe(9 * 3600); // 15:00 UTC to midnight
  });
  it("counts the browser, not the tab: another reader is a fresh allowance", async () => {
    for (let i = 0; i < 3; i++) await ask({ reader: "r_a", ip: "198.51.100.1" });
    granted(await ask({ reader: "r_b", ip: "198.51.100.2" }));
  });
  it("starts again at midnight UTC", async () => {
    for (let i = 0; i < 3; i++) await ask({ reader: "r_a" });
    expect((await admit({ reader: "r_a" })).ok).toBe(false);
    granted(await ask({ reader: "r_a" }, { now: T0 + 10 * 3600_000 })); // 01:00 the next day
  });
  it("clearing cookies does not reset it: the same network address has its own, larger, allowance", async () => {
    // Ten different browsers on one address use up the address's 10 a day, three questions each (the last one gets one).
    for (let i = 0; i < 10; i++) granted(await ask({ reader: `r_${i}`, ip: "203.0.113.50" }));
    const r = await refusal(await admit({ reader: "r_fresh", ip: "203.0.113.50" }));
    expect(r.error).toBe("quota");
    expect(r.message).toMatch(/This network has used/);
    granted(await ask({ reader: "r_elsewhere", ip: "203.0.113.51" })); // another address is unaffected
  });
  it("all visitors together have a daily ceiling", async () => {
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_GLOBAL_PER_DAY", "4");
    for (let i = 0; i < 4; i++) granted(await ask({ reader: `r_${i}`, ip: `203.0.113.${i + 1}` }));
    const r = await refusal(await admit({ reader: "r_x", ip: "203.0.113.99" }));
    expect(r.message).toMatch(/visitors who are not signed in are used up for today/);
  });
  it("a request with no cookie at all is counted by its address", async () => {
    for (let i = 0; i < 3; i++) granted(await ask({ ip: "203.0.113.70" }));
    expect((await admit({ ip: "203.0.113.70" })).ok).toBe(false);
  });
});

describe("a signed-in user: 20 questions a day, across all devices", () => {
  it("allows twenty from different browsers and addresses, refuses the twenty-first", async () => {
    for (let i = 0; i < 20; i++) granted(await ask({ account: "acc_1", reader: `r_dev${i % 3}`, ip: `203.0.113.${(i % 5) + 1}` }));
    const r = await refusal(await admit({ account: "acc_1", reader: "r_dev0" }));
    expect(r.status).toBe(429);
    expect(r.message).toMatch(/today's 20 AI questions/);
  });
  it("is separate from the visitor allowances and from other users", async () => {
    for (let i = 0; i < 3; i++) await ask({ reader: "r_a" });
    expect((await admit({ reader: "r_a" })).ok).toBe(false); // the visitor is out
    granted(await ask({ account: "acc_1", reader: "r_a" })); // signed in with the same browser: the user's own allowance
    granted(await ask({ account: "acc_2" }));
  });
  it("the numbers are configurable", async () => {
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_PER_DAY", "1");
    vi.stubEnv("GLOSS_QUOTA_AI_USER_PER_DAY", "2");
    granted(await ask({ reader: "r_a" }));
    expect((await admit({ reader: "r_a" })).ok).toBe(false);
    granted(await ask({ account: "acc_1" }));
    granted(await ask({ account: "acc_1" }));
    expect((await admit({ account: "acc_1" })).ok).toBe(false);
  });
});

describe("one generation at a time", () => {
  it("a second request while one is running is refused as busy, and does not cost a question", async () => {
    const first = granted(await admit({ account: "acc_1" }));
    const r = await refusal(await admit({ account: "acc_1", ip: "203.0.113.2" })); // another device, same user
    expect(r).toMatchObject({ status: 429, error: "busy-user" });
    expect(r.message).toMatch(/already have an AI answer being written/);
    await first.settle({ kind: "ok", inputTokens: 10, outputTokens: 10 });
    for (let i = 0; i < 19; i++) granted(await ask({ account: "acc_1" })); // 1 + 19 = 20: the refused attempt was given back
    expect((await admit({ account: "acc_1" })).ok).toBe(false);
  });
  it("once it finishes, the next one is allowed; a failed or abandoned request frees the user too", async () => {
    const a = granted(await admit({ account: "acc_1" }));
    await a.settle({ kind: "timeout" });
    const b = granted(await admit({ account: "acc_1" }));
    await b.settle({ kind: "client-gone" });
    granted(await admit({ account: "acc_1" }));
  });
  it("a visitor cannot run two at once by clearing cookies: the address is held as well", async () => {
    granted(await admit({ reader: "r_a", ip: "203.0.113.60" }));
    const r = await refusal(await admit({ reader: "r_b", ip: "203.0.113.60" }));
    expect(r.error).toBe("busy-user");
    granted(await admit({ reader: "r_c", ip: "203.0.113.61" })); // elsewhere: no conflict
  });
  it("different users do not wait for each other", async () => {
    granted(await admit({ account: "acc_1" }));
    granted(await admit({ account: "acc_2" }));
    granted(await admit({ account: "acc_3" }));
  });
  it("a lease whose request never reported back runs out by itself", async () => {
    granted(await admit({ account: "acc_1" }, { leaseTtlMs: 60_000 }));
    expect((await admit({ account: "acc_1" }, { now: T0 + 30_000 })).ok).toBe(false);
    granted(await admit({ account: "acc_1" }, { now: T0 + 61_000 }));
  });
  it("applies to a reader's own key too, but their own key is never counted against the daily allowance", async () => {
    for (let i = 0; i < 10; i++) granted(await ask({ reader: "r_a" }, { source: "user" })); // far more than 3
    const held = granted(await admit({ reader: "r_a" }, { source: "user" }));
    expect(await refusal(await admit({ reader: "r_a" }, { source: "user" }))).toMatchObject({ error: "busy-user" });
    await held.settle({ kind: "ok", inputTokens: 1, outputTokens: 1 });
    expect((await store.usage(T0)).day.requests).toBe(0); // the operator's ledger holds none of it
  });
});

describe("the global budget", () => {
  const cost = (e = SMALL) => costMicro(e, "openai/gpt-oss-120b");

  it("sets money aside when a request starts, and charges what it really used when it ends", async () => {
    const a = granted(await admit({ account: "acc_1" }));
    expect((await store.usage(T0)).reservedMicro).toBe(cost());
    await a.settle({ kind: "ok", inputTokens: 1000, outputTokens: 400 });
    const u = await store.usage(T0);
    expect(u.reservedMicro).toBe(0);
    expect(u.day).toMatchObject({ requests: 1, errors: 0, inputTokens: 1000, outputTokens: 400 });
    expect(u.day.spentMicro).toBe(costMicro({ inputTokens: 1000, outputTokens: 400 }, "openai/gpt-oss-120b"));
    expect(u.month.spentMicro).toBe(u.day.spentMicro);
  });
  it("pauses the shared AI for everyone when the day's budget is used up, and gives the question back", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", String((cost() * 1.5) / 1_000_000)); // room for one request, not two
    const a = granted(await admit({ account: "acc_1" }));
    const r = await refusal(await admit({ account: "acc_2" }));
    expect(r).toMatchObject({ status: 503, error: "budget" });
    expect(r.message).toMatch(/budget for today is used up/);
    expect(r.message).toMatch(/your own Together key/);
    await a.settle({ kind: "ok", inputTokens: 100, outputTokens: 100 });
    granted(await admit({ account: "acc_2" })); // what the first one really used was far less than it set aside
    // acc_2's refused attempt did not use up its allowance (20 a day): it can still ask nineteen more times after this one.
    const u = await store.usage(T0);
    expect(u.reservedMicro).toBe(cost());
  });
  it("two requests at the same moment cannot spend the same remaining budget: only as many start as fit", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", String((cost() * 3.5) / 1_000_000)); // room for three
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => admit({ account: `acc_${i}`, ip: `203.0.113.${i + 1}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const u = await store.usage(T0);
    expect(u.reservedMicro).toBe(cost() * 3);
    expect(u.reservedMicro).toBeLessThanOrEqual(toMicro((cost() * 3.5) / 1_000_000));
  });
  it("a budget of zero pauses the shared AI", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "0");
    expect(await refusal(await admit({ account: "acc_1" }))).toMatchObject({ status: 503, error: "budget" });
  });
  it("has a monthly ceiling as well, and says it is the month", async () => {
    vi.stubEnv("GLOSS_BUDGET_MONTHLY_USD", String((cost() * 1.5) / 1_000_000));
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "100");
    const a = granted(await admit({ account: "acc_1" }));
    await a.settle({ kind: "timeout" }); // charged at what was set aside
    const r = await refusal(await admit({ account: "acc_2" }, { now: T0 + DAY })); // the next day, same month
    expect(r.message).toMatch(/budget for this month is used up/);
  });
  it("a new day has a new daily budget", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", String((cost() * 1.2) / 1_000_000));
    const a = granted(await admit({ account: "acc_1" }));
    await a.settle({ kind: "timeout" });
    expect((await admit({ account: "acc_2" })).ok).toBe(false);
    granted(await admit({ account: "acc_2" }, { now: T0 + DAY }));
  });
  it("a request that never reports back stops holding money when its reservation expires", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", String((cost() * 1.5) / 1_000_000));
    granted(await admit({ account: "acc_1" }, { leaseTtlMs: 60_000 }));
    expect((await admit({ account: "acc_2" }, { now: T0 + 30_000 })).ok).toBe(false);
    granted(await admit({ account: "acc_2" }, { now: T0 + 61_000, leaseTtlMs: 60_000 }));
  });
  it("what a failed request costs: a plain provider failure nothing (and the question is returned), a timeout or unusable answer what was set aside", async () => {
    const failed = granted(await admit({ account: "acc_1" }));
    await failed.settle({ kind: "provider-error" });
    expect((await store.usage(T0)).day).toMatchObject({ spentMicro: 0, requests: 1, errors: 1 });
    const unusable = granted(await admit({ account: "acc_1" }));
    await unusable.settle({ kind: "bad-output" });
    const slow = granted(await admit({ account: "acc_1" }));
    await slow.settle({ kind: "timeout" });
    expect((await store.usage(T0)).day).toMatchObject({ spentMicro: cost() * 2, requests: 3, errors: 2 });
    const rejected = granted(await admit({ account: "acc_1" }));
    await rejected.settle({ kind: "rejected" });
    expect((await store.usage(T0)).day.requests).toBe(4);
    // Twenty a day; four attempts so far, two of them given back, so two are used: eighteen more fit.
    for (let i = 0; i < 18; i++) granted(await ask({ account: "acc_1" }));
    expect((await admit({ account: "acc_1" })).ok).toBe(false);
  });
  it("settling twice charges once", async () => {
    const a = granted(await admit({ account: "acc_1" }));
    await a.settle({ kind: "ok", inputTokens: 1000, outputTokens: 1000 });
    await a.settle({ kind: "ok", inputTokens: 1000, outputTokens: 1000 });
    expect((await store.usage(T0)).day.requests).toBe(1);
  });
  it("the operator can state the real prices and the ledger follows them", async () => {
    vi.stubEnv("GLOSS_PRICE_IN_PER_M", "1");
    vi.stubEnv("GLOSS_PRICE_OUT_PER_M", "2");
    const a = granted(await admit({ account: "acc_1" }));
    await a.settle({ kind: "ok", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect((await store.usage(T0)).day.spentMicro).toBe(toMicro(3));
    expect(estimateCost("any", 1_000_000, 1_000_000)).toBe(3);
  });
});

describe("when the allowances cannot be read", () => {
  const broken = (): AiStore => {
    const down = async () => {
      throw new Error("connection refused");
    };
    return { quotaHit: down, quotaRefund: down, acquireLease: down, releaseLease: down, reserve: down, settle: down, usage: down, ping: down };
  };
  it("the operator's key is not spent: the request is refused with a plain message", async () => {
    const r = await refusal(await admit({ account: "acc_1" }, { store: broken() }));
    expect(r).toMatchObject({ status: 503, error: "unavailable" });
    expect(JSON.stringify(r)).not.toMatch(/refused|connection/);
  });
  it("the reader's own key goes on (nothing of the operator's is at stake)", async () => {
    expect((await admit({ account: "acc_1" }, { store: broken(), source: "user" })).ok).toBe(true);
  });
  it("a partly failing store leaves nothing held: the lease taken before the failure is given back", async () => {
    const real = createMemoryAiStore();
    const partial: AiStore = { ...real, reserve: async () => { throw new Error("down"); } };
    expect((await admit({ account: "acc_1" }, { store: partial })).ok).toBe(false);
    expect((await admit({ account: "acc_1" }, { store: real })).ok).toBe(true); // not "busy": the lease was released
  });
});

describe("the cheaper server-key calls have a daily allowance too", () => {
  it("meaning search: 20 a day for a visitor, 100 for a user", async () => {
    for (let i = 0; i < 20; i++) expect(await limitDaily(request({ reader: "r_a" }), "search", store, T0)).toBeNull();
    const r = await limitDaily(request({ reader: "r_a" }), "search", store, T0);
    expect(r?.status).toBe(429);
    expect(((await r!.json()) as { message: string }).message).toMatch(/20 free searches by meaning/);
    for (let i = 0; i < 100; i++) expect(await limitDaily(request({ account: "acc_1" }), "search", store, T0)).toBeNull();
    expect((await limitDaily(request({ account: "acc_1" }), "search", store, T0))?.status).toBe(429);
  });
  it("voice transcription: 5 a day for a visitor", async () => {
    for (let i = 0; i < 5; i++) expect(await limitDaily(request({ reader: "r_a" }), "transcribe", store, T0)).toBeNull();
    expect((await limitDaily(request({ reader: "r_a" }), "transcribe", store, T0))?.status).toBe(429);
  });
  it("fails closed when the allowance cannot be read", async () => {
    const down = async () => {
      throw new Error("down");
    };
    const r = await limitDaily(request(), "search", { ...store, quotaHit: down }, T0);
    expect(r?.status).toBe(503);
  });
});

describe("the switch for development", () => {
  it("lifts the daily allowances outside production, never in production", async () => {
    vi.stubEnv("GLOSS_QUOTAS", "off");
    for (let i = 0; i < 6; i++) granted(await ask({ reader: "r_a" })); // beyond 3
    vi.stubEnv("GLOSS_COOKIE_SECRET", "a-test-secret-that-is-at-least-thirty-two-characters-long");
    vi.stubEnv("NODE_ENV", "production");
    store.clear();
    for (let i = 0; i < 3; i++) granted(await ask({ reader: "r_a" }));
    expect((await admit({ reader: "r_a" })).ok).toBe(false);
  });
});
