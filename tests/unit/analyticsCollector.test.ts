import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsMode, handleEvents, identifyActor, recordServerEvent, resetAnalyticsLimits, setAnalyticsSink, type StoredEvent } from "@/lib/server/analytics";
import { createMemoryAiStore, setAiStore } from "@/lib/server/aiStore";
import { readerCookieValue } from "@/lib/server/reader";
import { newOAuthState } from "@/lib/server/auth";

const NOW = Date.UTC(2026, 10, 2, 12);
let kept: StoredEvent[];

beforeEach(() => {
  kept = [];
  setAnalyticsSink({ insert: async (rows) => void kept.push(...rows) });
  setAiStore(createMemoryAiStore());
  resetAnalyticsLimits();
  vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
});
afterEach(() => {
  setAnalyticsSink(undefined);
  setAiStore(undefined);
  vi.unstubAllEnvs();
});

const post = (events: unknown[], init: { headers?: Record<string, string>; attribution?: unknown; raw?: string } = {}) =>
  handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": "203.0.113.9", ...init.headers }, body: init.raw ?? JSON.stringify({ events, attribution: init.attribution }) }), NOW);

const landing = { event: "landing_viewed", props: {}, path: "/" };

describe("modes", () => {
  it("is off unless the operator says otherwise: nothing is stored and the answer says off", async () => {
    expect(analyticsMode()).toBe("off");
    const res = await post([landing]);
    expect(res.status).toBe(204);
    expect(res.headers.get("x-gloss-analytics")).toBe("off");
    expect(kept).toEqual([]);
  });

  it("understands daily and full, and treats anything else (including the old name \"anonymous\", which it was not) as off", () => {
    vi.stubEnv("GLOSS_ANALYTICS", "FULL");
    expect(analyticsMode()).toBe("full");
    vi.stubEnv("GLOSS_ANALYTICS", "daily");
    expect(analyticsMode()).toBe("daily");
    for (const v of ["anonymous", "yes please", "1", "true", "on", ""]) {
      vi.stubEnv("GLOSS_ANALYTICS", v);
      expect(analyticsMode(), v).toBe("off");
    }
  });

  it("records nothing for a browser that sends Do Not Track or Global Privacy Control, in any mode", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    for (const headers of [{ dnt: "1" }, { "sec-gpc": "1" }] as Record<string, string>[]) {
      const res = await post([landing], { headers });
      expect(res.headers.get("x-gloss-analytics")).toBe("off");
    }
    expect(kept).toEqual([]);
  });
});

describe("when the key that makes the identifiers is not usable", () => {
  beforeEach(() => vi.stubEnv("GLOSS_ANALYTICS", "full"));

  it.each([
    ["missing", ""],
    ["the example value", "change-me"],
    ["too short", "short-secret"],
  ])("analytics is off in production and nothing throws or is stored: the cookie secret is %s", async (_label, secret) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GLOSS_COOKIE_SECRET", secret);
    const res = await post([landing, { event: "document_opened", props: { kind: "pdf", via: "library", age: "0d" }, path: "/read/x" }]);
    expect(res.status).toBe(204);
    expect(res.headers.get("x-gloss-analytics")).toBe("off");
    await recordServerEvent("account_registered", { method: "google" }, "r_new", null, NOW);
    expect(kept).toEqual([]);
  });

  it("a usable key (32 characters or more) in production keeps it on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "k".repeat(40));
    expect((await post([landing])).headers.get("x-gloss-analytics")).toBe("full");
    expect(kept).toHaveLength(1);
  });
});

describe("what is stored", () => {
  beforeEach(() => vi.stubEnv("GLOSS_ANALYTICS", "full"));

  it("keeps an event with its enumerated properties, the route as a pattern and a pseudonymous actor, not the reader id", async () => {
    const cookie = `gloss_reader=${readerCookieValue("r_secretReaderId")}`;
    await post([{ event: "document_opened", props: { kind: "pdf", via: "library", age: "7-29d" }, path: "/read/my-private-medical-results?x=1" }], { headers: { cookie } });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ event: "document_opened", actorKind: "reader", route: "/read/:slug", props: { kind: "pdf", via: "library", age: "7-29d" }, at: NOW });
    const stored = JSON.stringify(kept);
    expect(stored).not.toContain("r_secretReaderId");
    expect(stored).not.toContain("medical");
    expect(stored).not.toContain("203.0.113.9");
  });

  it("follows the same reader across days in full mode, and gives a visitor without a cookie a different hash each day", async () => {
    const cookie = `gloss_reader=${readerCookieValue("r_abc")}`;
    const a = identifyActor(new Request("http://x.test", { headers: { cookie } }), "full", NOW);
    const b = identifyActor(new Request("http://x.test", { headers: { cookie } }), "full", NOW + 5 * 86_400_000);
    expect(a).toEqual(b);
    expect(a.actorKind).toBe("reader");
    const anon = (t: number) => identifyActor(new Request("http://x.test", { headers: { "x-forwarded-for": "198.51.100.4", "user-agent": "UA" } }), "full", t);
    expect(anon(NOW).actorKind).toBe("daily");
    expect(anon(NOW).actor).not.toBe(anon(NOW + 86_400_000).actor);
    expect(anon(NOW).actor).toBe(anon(NOW + 3_600_000).actor);
  });

  it("never follows a person in daily mode, even with a reader cookie", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "daily");
    const cookie = `gloss_reader=${readerCookieValue("r_abc")}`;
    await post([landing], { headers: { cookie } });
    expect(kept[0].actorKind).toBe("daily");
  });

  it("ignores a cookie that is not validly signed", async () => {
    await post([landing], { headers: { cookie: "gloss_reader=r_forged.AAAAAAAAAAAAAAAAAAAAAA" } });
    expect(kept[0].actorKind).toBe("daily");
  });

  it("drops an event that carries anything the schema does not list, and keeps the rest of the batch", async () => {
    await post([
      { event: "ai_question_asked", props: { action: "explain", key: "shared", question: "what is wrong with me" } },
      { event: "document_saved", props: { kind: "url", via: "link", url: "https://example.org/secret" } },
      { event: "library_searched", props: { scope: "library", results: "1-3", query: "divorce" } },
      { event: "highlight_created", props: { mark: "note" } },
      { event: "not_an_event", props: {} },
    ]);
    expect(kept.map((k) => k.event)).toEqual(["highlight_created"]);
    expect(JSON.stringify(kept)).not.toMatch(/wrong with me|secret|divorce/);
  });

  it("answers 204 and stores nothing for event names that are built-in property names (a lookup by name must not reach the prototype)", async () => {
    const res = await post([{ event: "constructor", props: {} }, { event: "__proto__", props: {} }, { event: "toString", props: {} }, { event: "hasOwnProperty", props: {} }, { event: 42, props: {} }, null, "landing_viewed"]);
    expect(res.status).toBe(204);
    expect(kept).toEqual([]);
  });

  it("takes from a browser only the events a browser can witness: it cannot claim a registration or a payment", async () => {
    await post([
      { event: "account_registered", props: { method: "google" } },
      { event: "subscription_started", props: { plan: "pro", interval: "month" } },
      { event: "subscription_cancelled", props: { plan: "pro", tenure: "<30d" } },
    ]);
    expect(kept).toEqual([]);
  });

  it("attaches attribution to the landing view only, re-validated: the operator's listed source and campaign, a known medium, the referral code only as a hash", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_SOURCES", "newsletter");
    vi.stubEnv("GLOSS_ANALYTICS_CAMPAIGNS", "launch-1");
    await post([landing, { event: "highlight_created", props: { mark: "highlight" } }], { attribution: { source: "newsletter", medium: "email", campaign: "launch-1", ref: "AbC123xyz", referrerHost: "jane@example.com" } });
    expect(kept[0]).toMatchObject({ event: "landing_viewed", channel: "referral", campaign: "launch-1" });
    expect(kept[0].ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(kept)).not.toContain("AbC123xyz");
    expect(kept[1]).toMatchObject({ event: "highlight_created", channel: null, campaign: null, ref: null });
    kept.length = 0;
    await post([landing], { attribution: { source: "newsletter", medium: "email", campaign: "launch-1" } });
    expect(kept[0]).toMatchObject({ channel: "newsletter/email", campaign: "launch-1", ref: null });

  });

  it("stores a source, medium or campaign it was not told about as \"other\", so a tidy-looking name or number cannot travel in them", async () => {
    await post([landing], { attribution: { source: "joao.mendes", medium: "5511999990000", campaign: "anna-smith-2026" } });
    expect(kept[0]).toMatchObject({ channel: "other/other", campaign: "other" });
    expect(JSON.stringify(kept)).not.toMatch(/joao|5511|anna/);
    kept.length = 0;
    await post([landing], { attribution: { source: "<script>alert(1)</script>", ref: "has spaces" } });
    expect(kept[0]).toMatchObject({ channel: "direct", ref: null });
  });

  it("ignores attribution outside full mode", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "daily");
    await post([landing], { attribution: { source: "newsletter" } });
    expect(kept[0]).toMatchObject({ channel: null, campaign: null });
  });
});

describe("limits", () => {
  beforeEach(() => vi.stubEnv("GLOSS_ANALYTICS", "full"));

  it("refuses bodies that are too large or not JSON, and takes at most ten events from a batch", async () => {
    expect((await post([], { raw: "x".repeat(9000) })).status).toBe(400);
    expect((await post([], { raw: "{not json" })).status).toBe(400);
    expect((await post([], { raw: "" })).status).toBe(400);
    await post(Array.from({ length: 30 }, () => ({ event: "highlight_created", props: { mark: "note" } })));
    expect(kept).toHaveLength(10);
  });

  it("slows one visitor to 120 events a minute", async () => {
    for (let i = 0; i < 20; i++) await post(Array.from({ length: 10 }, () => ({ event: "highlight_created", props: { mark: "note" } })));
    expect(kept).toHaveLength(120);
  });

  it("stops at the day's cap so analytics cannot fill the database", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "3");
    for (let i = 0; i < 6; i++) await post([{ event: "highlight_created", props: { mark: "note" } }], { headers: { "x-forwarded-for": `203.0.113.${i + 1}` } });
    expect(kept).toHaveLength(3);
  });

  it("records nothing when the counter that enforces the cap cannot be read", async () => {
    setAiStore({ ...createMemoryAiStore(), quotaHit: async () => Promise.reject(new Error("db down")) });
    await post([landing]);
    expect(kept).toEqual([]);
  });

  it("answers 204 even when storing fails", async () => {
    setAnalyticsSink({ insert: async () => Promise.reject(new Error("db down")) });
    expect((await post([landing])).status).toBe(204);
  });
});

describe("events the server records itself", () => {
  it("records a registration against the pseudonym of the reader, with the channel, in full mode only", async () => {
    await recordServerEvent("account_registered", { method: "google" }, "r_new", { source: "newsletter", medium: "email", campaign: "launch-1", ref: null, referrerHost: null }, NOW);
    expect(kept).toEqual([]); // off
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    await recordServerEvent("account_registered", { method: "google" }, "r_new", { source: "newsletter", medium: "email", campaign: "launch-1", ref: null, referrerHost: null }, NOW);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ event: "account_registered", actorKind: "reader", channel: "newsletter/email", campaign: "launch-1" });
    expect(JSON.stringify(kept)).not.toContain("r_new");
    // the same pseudonym the browser's own events get, so a registration and what follows belong to one reader
    const fromBrowser = identifyActor(new Request("http://x.test", { headers: { cookie: `gloss_reader=${readerCookieValue("r_new")}` } }), "full", NOW);
    expect(kept[0].actor).toBe(fromBrowser.actor);
  });

  it("refuses an event that does not fit the schema", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    await recordServerEvent("account_registered", { method: "google", email: "a@b.c" }, "r_new", null, NOW);
    expect(kept).toEqual([]);
  });
});

describe("attribution through sign-in", () => {
  it("keeps tidy attribution in the sign-in state and drops junk", () => {
    vi.stubEnv("GLOSS_ANALYTICS_SOURCES", "newsletter");
    expect(newOAuthState("/library", { source: "newsletter", ref: "AbC123xyz" }).attr).toMatchObject({ source: "newsletter", ref: "AbC123xyz" });
    expect(newOAuthState("/library", { source: "joao.mendes" }).attr).toMatchObject({ source: "other" });
    expect(newOAuthState("/library", { source: "jane@example.com" }).attr).toBeUndefined();
    expect(newOAuthState("/library").attr).toBeUndefined();
  });
});
