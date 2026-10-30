import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { createMemoryAiStore, setAiStore, type AiStore, type MemoryAiStore } from "@/lib/server/aiStore";
import { toMicro } from "@/lib/ai/budget";
import { forgetHealthCache } from "@/lib/server/healthProbe";

let store: MemoryAiStore;
beforeEach(() => {
  forgetHealthCache();
  store = createMemoryAiStore();
  setAiStore(store);
  vi.stubEnv("DATABASE_URL", "postgres://placeholder/never-connected"); // only decides that a database is configured; the store above is what answers
});
afterEach(() => {
  setAiStore(undefined);
  vi.unstubAllEnvs();
});

const get = (qs = "") => GET(new Request(`http://x.test/api/health${qs}`));
const settle = (n: number, errors: 0 | 1, micro = 100) => Promise.all(Array.from({ length: n }, (_, i) => store.settle(`h${i}${errors}${Math.random()}`, { micro, inputTokens: 10, outputTokens: 10, errors }, Date.now())));

describe("GET /api/health", () => {
  it("says ok, which commit is live and what the AI is set up with, and calls nobody", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOGETHER_API_KEY", "sk-must-never-appear-in-a-health-check");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const res = await get();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ status: "ok", reasons: [], commit: "0123456", environment: "production", database: "ok" });
    expect(j.ai).toMatchObject({ configured: true, budget: "ok", errorsLastHour: 0 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(upstream).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("holds no secret and no amount of money", async () => {
    vi.stubEnv("TOGETHER_API_KEY", "sk-must-never-appear-in-a-health-check");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "cookie-secret-must-never-appear-in-a-health-check-1234");
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@host/db");
    await settle(3, 0, 777_777);
    const text = JSON.stringify(await (await get()).json());
    expect(text).not.toMatch(/must-never-appear|hunter2|postgres:|777777|spent|usd|\$/i);
  });

  it("is 503 and 'down' when the database does not answer", async () => {
    const down = async () => {
      throw new Error("connection refused 10.0.0.1");
    };
    setAiStore({ ...(store as AiStore), ping: down });
    const res = await get();
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j).toMatchObject({ status: "down", database: "down" });
    expect(j.reasons).toContain("database-down");
    expect(JSON.stringify(j)).not.toMatch(/10\.0\.0\.1|refused/);
  });

  it("is 503 when the database hangs instead of answering", async () => {
    vi.useFakeTimers();
    setAiStore({ ...(store as AiStore), ping: () => new Promise(() => {}) });
    const pending = get();
    await vi.advanceTimersByTimeAsync(6300); // one reading, then one more before it is called down
    expect((await pending).status).toBe(503);
    vi.useRealTimers();
  });

  it("flags the AI as failing when most of the last hour's requests failed, but answers 200 unless asked to be strict", async () => {
    await settle(6, 1);
    await settle(2, 0);
    const lenient = await get();
    expect(lenient.status).toBe(200);
    const j = await lenient.json();
    expect(j.status).toBe("degraded");
    expect(j.reasons).toContain("ai-failing");
    expect(j.ai).toMatchObject({ errorsLastHour: 6, requestsLastHour: 8 });
    expect((await get("?strict=1")).status).toBe(503);
  });

  it("does not cry wolf for a few errors among many successes", async () => {
    await settle(30, 0);
    await settle(5, 1);
    expect((await (await get()).json()).status).toBe("ok");
  });

  it("flags a spent budget as 'low' and then 'exhausted' (the AI is paused, which the owner should hear about)", async () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "1");
    await settle(1, 0, toMicro(0.85));
    expect((await (await get()).json()).ai.budget).toBe("low");
    await settle(1, 0, toMicro(0.2));
    const j = await (await get("?strict=1&fresh=1")).json(); // a healthy reading is otherwise reused for 15 minutes
    expect(j.ai.budget).toBe("exhausted");
    expect(j.reasons).toContain("ai-budget-exhausted");
  });

  it("without a database (a preview, local work) it says so and is still ok", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const j = await (await get()).json();
    expect(j).toMatchObject({ status: "ok", database: "not-configured" });
    expect(j.ai.budget).toBe("unknown");
  });
});

describe("GET /api/health, the compute allowance and the storage alerts (Neon Free)", () => {
  const withSize = (bytes: number | null) => setAiStore({ ...(store as AiStore), storageBytes: async () => bytes });
  const MB = 1_048_576;

  it("reuses a healthy reading, so a monitor polling every five minutes does not keep the database awake", async () => {
    const ping = vi.fn(async () => {});
    setAiStore({ ...(store as AiStore), ping });
    expect((await (await get()).json()).checked.cached).toBe(false);
    expect((await (await get()).json()).checked.cached).toBe(true);
    expect((await (await get("?strict=1")).json()).checked.cached).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("?fresh=1 reads the database again, and the reuse ends after the configured time", async () => {
    const ping = vi.fn(async () => {});
    setAiStore({ ...(store as AiStore), ping });
    await get();
    await get("?fresh=1");
    expect(ping).toHaveBeenCalledTimes(2);
    vi.stubEnv("GLOSS_HEALTH_DB_CACHE_SECONDS", "0");
    await get();
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("never reuses a failure: when the database comes back the next call sees it", async () => {
    let up = false;
    setAiStore({ ...(store as AiStore), ping: async () => { if (!up) throw new Error("down"); } });
    expect((await get()).status).toBe(503);
    up = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).database).toBe("ok");
  });

  it("repeats one failed reading before calling the database down (a sleeping compute may be waking)", async () => {
    let calls = 0;
    setAiStore({ ...(store as AiStore), ping: async () => { if (calls++ === 0) throw new Error("waking up"); } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("is quiet below 70% of the storage limit, warns at 70% (still 200, even when strict) and becomes a reason at 85% (503 when strict)", async () => {
    vi.stubEnv("GLOSS_DB_STORAGE_LIMIT_MB", "1000");
    withSize(500 * MB);
    let j = await (await get("?fresh=1")).json();
    expect(j.storage).toMatchObject({ level: "ok", limitMb: 1000 });
    expect(j.warnings).toEqual([]);

    withSize(720 * MB);
    let res = await get("?strict=1&fresh=1");
    j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ status: "ok", warnings: ["db-storage-70"], reasons: [] });
    expect(j.storage).toMatchObject({ level: "watch", percent: 72 });

    withSize(860 * MB);
    res = await get("?strict=1&fresh=1");
    j = await res.json();
    expect(res.status).toBe(503);
    expect(j).toMatchObject({ status: "degraded", reasons: ["db-storage-85"] });
    expect(j.storage.level).toBe("high");
    expect((await get("?fresh=1")).status).toBe(200); // not strict: still answers 200
  });

  it("defaults to the 1 GB of Neon Free, ignores an unreadable limit, and says nothing about size when the store cannot tell", async () => {
    withSize(800 * MB);
    expect((await (await get("?fresh=1")).json()).storage).toMatchObject({ limitMb: 1024, level: "watch" });
    vi.stubEnv("GLOSS_DB_STORAGE_LIMIT_MB", "lots");
    expect((await (await get("?fresh=1")).json()).storage.limitMb).toBe(1024);
    withSize(null);
    expect((await (await get("?fresh=1")).json()).storage).toBeNull();
  });
});
