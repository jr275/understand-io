// The day's cap on analytics events: it counts EVENTS STORED (not requests), atomically, per UTC day. Memory store here (the real database is in
// analyticsCapDatabase.test.ts). Every request comes from its own address so the per-visitor limit never interferes with what is being measured.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsDayStart, handleEvents, recordServerEvent, resetAnalyticsLimits, setAnalyticsSink, type StoredEvent } from "@/lib/server/analytics";
import { createMemoryAiStore, setAiStore, type AiStore } from "@/lib/server/aiStore";

// These tests use the in-memory store and an injected sink: whatever DATABASE_URL is in the environment, they must never touch a database.
vi.mock("@/lib/db/client", () => ({ getDb: () => null }));

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2, 12);
const landing = { event: "landing_viewed", props: {}, path: "/" };

let kept: StoredEvent[];
let store: AiStore;
let calls: { reserve: number; release: number };
let nth = 0;

beforeEach(() => {
  kept = [];
  nth = 0;
  calls = { reserve: 0, release: 0 };
  const inner = createMemoryAiStore();
  store = {
    ...inner,
    quotaReserve: async (...a) => (calls.reserve++, inner.quotaReserve(...a)),
    quotaRelease: async (...a) => (calls.release++, inner.quotaRelease(...a)),
  };
  setAiStore(store);
  setAnalyticsSink({ insert: async (rows) => void kept.push(...rows) });
  resetAnalyticsLimits();
  vi.stubEnv("GLOSS_ANALYTICS", "full");
  vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
  vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "10");
});
afterEach(() => {
  setAnalyticsSink(undefined);
  setAiStore(undefined);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const events = (n: number) => Array.from({ length: n }, () => landing);
const post = (n: number, now: number = T0, headers: Record<string, string> = {}) =>
  handleEvents(
    new Request("http://x.test/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": `10.${(nth >> 8) & 255}.${nth++ & 255}.1`, ...headers },
      body: JSON.stringify({ events: events(n) }),
    }),
    now,
  );

describe("the cap counts events, not requests", () => {
  it("three requests of four events against a cap of ten store ten: four, four, two", async () => {
    for (let i = 0; i < 3; i++) expect((await post(4)).status).toBe(204);
    expect(kept).toHaveLength(10);
  });

  it("one request cannot get around it by carrying many events: it is cut to what is left", async () => {
    await post(10);
    expect(kept).toHaveLength(10);
    await post(10);
    expect(kept).toHaveLength(10);
  });

  it("a cap of three and a request of ten events stores exactly three", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "3");
    await post(10);
    expect(kept).toHaveLength(3);
  });

  it("server-recorded events draw on the same budget", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "2");
    await recordServerEvent("account_registered", { method: "google" }, "r_one", null, T0);
    await recordServerEvent("account_registered", { method: "google" }, "r_two", null, T0);
    await post(5);
    expect(kept).toHaveLength(2);
  });
});

describe("when the day's budget is used up", () => {
  it("stops storing, still answers 204, and stops asking the counter for the rest of the day", async () => {
    await post(10);
    const before = calls.reserve;
    await post(1); // the first request after exhaustion finds out (granted 0)...
    const afterFirst = calls.reserve;
    for (let i = 0; i < 25; i++) expect((await post(3)).status).toBe(204);
    expect(kept).toHaveLength(10);
    expect(afterFirst - before).toBeLessThanOrEqual(1);
    expect(calls.reserve).toBe(afterFirst); // ...and the 25 that follow cost the database nothing
  });

  it("starts again with the next UTC day", async () => {
    await post(10, T0);
    await post(5, T0);
    expect(kept).toHaveLength(10);
    await post(4, T0 + DAY);
    expect(kept).toHaveLength(14);
  });
});

describe("the day boundary", () => {
  const MIDNIGHT = Date.UTC(2026, 10, 3, 0, 0, 0, 0);

  it("one millisecond before midnight belongs to the old day, midnight itself to the new one", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "2");
    await post(5, MIDNIGHT - 1);
    expect(kept).toHaveLength(2); // the old day is full
    await post(5, MIDNIGHT);
    expect(kept).toHaveLength(4); // the new day has its own two
    await post(5, MIDNIGHT + 1);
    expect(kept).toHaveLength(4); // and is now full too
  });

  it("an event stamped just before midnight arriving late does not eat the new day's budget", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "2");
    await post(2, MIDNIGHT); // new day, full
    await post(2, MIDNIGHT - 1); // belongs to the old day, which is empty
    expect(kept).toHaveLength(4);
  });

  it("the day starts at UTC midnight in every time zone, including ones that change their clocks", () => {
    const instants = [Date.UTC(2026, 0, 1, 0, 0, 0, 0), Date.UTC(2026, 2, 8, 6, 59, 59, 999), Date.UTC(2026, 2, 8, 7, 0, 0, 0), Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 10, 1, 23, 59, 59, 999), Date.UTC(2026, 11, 31, 23, 59, 59, 999), 0];
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Australia/Lord_Howe", "America/New_York"]) {
        process.env.TZ = tz;
        for (const t of instants) {
          const d = new Date(t);
          expect(analyticsDayStart(t), `${tz} ${d.toISOString()}`).toBe(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          expect(analyticsDayStart(t) % DAY).toBe(0);
        }
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("concurrency and duplicates", () => {
  it("sixty requests of five events race for a cap of one hundred: exactly one hundred are stored", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "100");
    const answers = await Promise.all(Array.from({ length: 60 }, () => post(5)));
    expect(answers.every((r) => r.status === 204)).toBe(true);
    expect(kept).toHaveLength(100);
  });

  it("an identical request sent twice is two events: there is no deduplication, and both count against the cap", async () => {
    const same = () => handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": "203.0.113.50" }, body: JSON.stringify({ events: [landing] }) }), T0);
    await same();
    await same();
    expect(kept).toHaveLength(2);
    expect(await store.quotaReserve("analytics:events", DAY, T0, 100, 10)).toBe(8); // 2 of the 10 are gone
  });
});

describe("what must not count", () => {
  it("nothing is reserved or stored while analytics is off (the default)", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "");
    const res = await post(5);
    expect(res.headers.get("x-gloss-analytics")).toBe("off");
    expect(calls.reserve).toBe(0);
    expect(kept).toEqual([]);
  });

  it("an unusable secret forces analytics off in production: no reservation, nothing stored", async () => {
    vi.stubEnv("NODE_ENV", "production"); // outside production the server tolerates a weak development secret; in production it refuses to key anything with one
    for (const secret of ["short", "", "change-me"]) {
      vi.stubEnv("GLOSS_COOKIE_SECRET", secret);
      const res = await post(5);
      expect(res.status, secret).toBe(204);
      expect(res.headers.get("x-gloss-analytics"), secret).toBe("off");
    }
    expect(calls.reserve).toBe(0);
    expect(kept).toEqual([]);
  });

  it("events that fail the schema are never reserved", async () => {
    await handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": "203.0.113.60" }, body: JSON.stringify({ events: [{ event: "document_saved", props: { text: "x" } }, { event: "nope" }] }) }), T0);
    expect(calls.reserve).toBe(0);
    expect(kept).toEqual([]);
  });
});

describe("writes that fail or stall", () => {
  it("a failed write gives its reservation back, so the budget is not lost to an outage", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "3");
    setAnalyticsSink({ insert: async () => Promise.reject(new Error("table analytics_events does not exist")) });
    expect((await post(3)).status).toBe(204);
    expect(calls.release).toBe(1);
    setAnalyticsSink({ insert: async (rows) => void kept.push(...rows) });
    await post(3);
    expect(kept).toHaveLength(3); // the whole cap is still there
  });

  it("a write that is merely slow keeps its reservation (it may still land), and the answer does not wait for it", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "3");
    setAnalyticsSink({ insert: () => new Promise<void>(() => {}) }); // never finishes
    const slow = post(3);
    await vi.advanceTimersByTimeAsync(1600);
    expect((await slow).status).toBe(204);
    expect(calls.release).toBe(0);
    setAnalyticsSink({ insert: async (rows) => void kept.push(...rows) });
    await post(3);
    expect(kept).toEqual([]); // the cap is treated as spent: it can never be exceeded by a late write
  });

  it("an unreadable counter records nothing and says nothing", async () => {
    setAiStore({ ...store, quotaReserve: async () => Promise.reject(new Error("down")) });
    expect((await post(3)).status).toBe(204);
    expect(kept).toEqual([]);
  });
});

describe("an operator who lowers the cap in the middle of the day", () => {
  it("is obeyed at once, and what was already counted is not erased", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "10");
    await post(5);
    expect(kept).toHaveLength(5);
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "3");
    resetAnalyticsLimits();
    await post(4);
    expect(kept).toHaveLength(5); // past the lowered cap: nothing more
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "10");
    resetAnalyticsLimits();
    await post(10);
    expect(kept).toHaveLength(10); // the five already counted were still counted
  });
});
