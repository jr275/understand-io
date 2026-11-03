// Retention of analytics events: bounded, idempotent, isolated from failure, observable. The deletion itself is injected here (the real SQL runs in
// analyticsCapDatabase.test.ts); what is proved is the policy and the control flow around it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFailure, lastRetentionResult, maybeRunRetention, resetRetentionState, retentionPolicy, retentionStatus, runRetention } from "@/lib/server/analyticsRetention";
import { handleEvents, resetAnalyticsLimits, setAnalyticsSink } from "@/lib/server/analytics";
import { createMemoryAiStore, setAiStore } from "@/lib/server/aiStore";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 2, 12);
let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: unknown) => void logs.push(String(m)));
  setAiStore(createMemoryAiStore());
  resetRetentionState();
  resetAnalyticsLimits();
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiStore(undefined);
  setAnalyticsSink(undefined);
  vi.unstubAllEnvs();
});

/** `n` expired rows that hand out at most `batch` per call, like the real deletion. */
const fake = (n: number) => {
  let left = n;
  const seen: { cutoff: number; batch: number }[] = [];
  return {
    seen,
    left: () => left,
    deleteBatch: async (cutoff: number, batch: number) => {
      seen.push({ cutoff, batch });
      const took = Math.min(batch, left);
      left -= took;
      return took;
    },
  };
};

describe("the policy is explicit and clamped", () => {
  it("defaults: 120 days, batches of 1000, at most 20 batches or 4 seconds a run", () => {
    expect(retentionPolicy()).toEqual({ days: 120, batch: 1000, maxBatches: 20, maxMs: 4000 });
  });
  it("takes the operator's numbers, clamps absurd ones, and ignores garbage", () => {
    vi.stubEnv("GLOSS_ANALYTICS_RETENTION_DAYS", "30");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "5");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", "100000");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_MS", "abc");
    expect(retentionPolicy()).toEqual({ days: 30, batch: 50, maxBatches: 200, maxMs: 4000 });
    vi.stubEnv("GLOSS_ANALYTICS_RETENTION_DAYS", "-3");
    expect(retentionPolicy().days).toBe(120);
    vi.stubEnv("GLOSS_ANALYTICS_RETENTION_DAYS", "999999");
    expect(retentionPolicy().days).toBe(3650);
  });
  it("deletes what is older than the policy says, measured from `now`", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_RETENTION_DAYS", "45");
    const t = fake(10);
    const r = await runRetention(NOW, { deleteBatch: t.deleteBatch });
    expect(t.seen[0].cutoff).toBe(NOW - 45 * DAY);
    expect(r.cutoff).toBe(NOW - 45 * DAY);
  });
});

describe("a run is bounded", () => {
  it("works a big backlog off in batches of the policy's size and says it is not finished when it stops at its limit", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "100");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_BATCHES", "3");
    const t = fake(1000);
    const r = await runRetention(NOW, { deleteBatch: t.deleteBatch });
    expect(t.seen.every((s) => s.batch === 100)).toBe(true);
    expect(r).toMatchObject({ ok: true, batches: 3, deleted: 300, done: false });
    expect(t.left()).toBe(700);
  });
  it("stops at its time budget, whatever is left", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "50");
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_MAX_MS", "2500");
    let clock = 0;
    const t = fake(100_000);
    const r = await runRetention(NOW, { deleteBatch: async (c, b) => ((clock += 1000), t.deleteBatch(c, b)), clock: () => clock });
    expect(r.batches).toBe(3); // 0, 1000, 2000 are under 2500; 3000 is not
    expect(r.done).toBe(false);
    expect(r.ms).toBe(3000);
  });
  it("finishes, and says so, when a batch comes back short", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "100");
    const t = fake(250);
    const r = await runRetention(NOW, { deleteBatch: t.deleteBatch });
    expect(r).toMatchObject({ ok: true, batches: 3, deleted: 250, done: true });
  });
  it("is idempotent: the same run again deletes nothing and is still done", async () => {
    vi.stubEnv("GLOSS_ANALYTICS_PRUNE_BATCH", "100");
    const t = fake(250);
    await runRetention(NOW, { deleteBatch: t.deleteBatch });
    const again = await runRetention(NOW, { deleteBatch: t.deleteBatch });
    expect(again).toMatchObject({ ok: true, deleted: 0, batches: 1, done: true });
  });
  it("has nothing to do, and no way to fail, when there is no database at all", async () => {
    expect(await runRetention(NOW)).toMatchObject({ ok: true, deleted: 0, batches: 0, done: true });
  });
});

describe("a failure is isolated, classified and content-free", () => {
  const fail = (err: unknown) => runRetention(NOW, { deleteBatch: async () => Promise.reject(err) });
  it("never throws, whatever goes wrong", async () => {
    await expect(fail(new Error("anything"))).resolves.toMatchObject({ ok: false, deleted: 0, done: false });
    await expect(fail("a string")).resolves.toMatchObject({ ok: false });
    await expect(fail(undefined)).resolves.toMatchObject({ ok: false });
  });
  it("tells a missing table, a timeout and anything else apart (directly or through a wrapped driver error)", async () => {
    expect((await fail(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).failure).toBe("missing-table");
    expect((await fail(Object.assign(new Error("wrapped"), { cause: { code: "42P01" } }))).failure).toBe("missing-table");
    expect((await fail(Object.assign(new Error("canceling statement"), { code: "57014" }))).failure).toBe("timeout");
    expect((await fail(Object.assign(new Error("slow"), { name: "TimeoutError" }))).failure).toBe("timeout");
    expect((await fail(new Error("boom"))).failure).toBe("error");
    expect(classifyFailure(null)).toBe("error");
  });
  it("keeps the progress made before the failure", async () => {
    let n = 0;
    const r = await runRetention(NOW, { deleteBatch: async (_c, b) => (++n === 1 ? b : Promise.reject(new Error("down"))) });
    expect(r).toMatchObject({ ok: false, batches: 1, deleted: 1000, done: false, failure: "error" });
  });
  it("logs counts and a failure class and nothing else: no message, no row", async () => {
    await fail(Object.assign(new Error('relation "analytics_events" does not exist: SECRET-ROW-TEXT'), { code: "42P01" }));
    const line = logs.map((l) => JSON.parse(l)).find((l) => l.event === "analytics.retention");
    expect(line).toEqual({ event: "analytics.retention", ok: false, deleted: 0, batches: 0, done: false, ms: expect.any(Number), failure: "missing-table" });
    expect(logs.join("\n")).not.toContain("SECRET-ROW-TEXT");
  });
  it("remembers the last result, for the operator's status", async () => {
    await runRetention(NOW, { deleteBatch: fake(5).deleteBatch });
    expect(lastRetentionResult()).toMatchObject({ ok: true, deleted: 5, at: NOW });
    const status = await retentionStatus(NOW);
    expect(status).toMatchObject({ policy: { days: 120 }, cutoff: NOW - 120 * DAY, lastRun: { deleted: 5 }, expiredRows: 0, expiredRowsCapped: false });
  });
});

describe("it is deterministic: once an hour, across every instance", () => {
  const runs = () => logs.filter((l) => l.includes('"analytics.retention"')).length;
  it("the first caller of the hour runs it; everyone else, on any instance, is told no at once", async () => {
    const deps = { deleteBatch: fake(0).deleteBatch };
    expect(await maybeRunRetention(NOW, deps)).not.toBeNull();
    expect(await maybeRunRetention(NOW + 60_000, deps)).toBeNull(); // this instance already knows
    resetRetentionState(); // another instance: it has to ask the shared counter, which says the hour is taken
    expect(await maybeRunRetention(NOW + 120_000, deps)).toBeNull();
    expect(runs()).toBe(1);
  });
  it("runs again in the next hour, and in the next day", async () => {
    const deps = { deleteBatch: fake(0).deleteBatch };
    await maybeRunRetention(NOW, deps);
    expect(await maybeRunRetention(NOW + HOUR, deps)).not.toBeNull();
    expect(await maybeRunRetention(NOW + DAY, deps)).not.toBeNull();
    expect(runs()).toBe(3);
  });
  it("does not delete anything when the claim cannot be made (the database is struggling)", async () => {
    setAiStore({ ...createMemoryAiStore(), quotaReserve: async () => Promise.reject(new Error("down")) });
    expect(await maybeRunRetention(NOW, { deleteBatch: fake(5).deleteBatch })).toBeNull();
    expect(runs()).toBe(0);
  });
  it("is triggered by recorded events, once an hour however many arrive, and never delays the answer with a failure", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
    setAnalyticsSink({ insert: async () => {} });
    let nth = 0;
    const send = (now: number) => handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA", "x-forwarded-for": `10.0.0.${nth++ % 250}` }, body: JSON.stringify({ events: [{ event: "landing_viewed", props: {}, path: "/" }] }) }), now);
    for (let i = 0; i < 20; i++) expect((await send(NOW)).status).toBe(204);
    await vi.waitFor(() => expect(runs()).toBe(1));
    expect((await send(NOW + HOUR)).status).toBe(204);
    await vi.waitFor(() => expect(runs()).toBe(2));
  });
  it("is not triggered while analytics is off: the collector stays inert", async () => {
    setAnalyticsSink({ insert: async () => {} });
    for (let i = 0; i < 5; i++) await handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ event: "landing_viewed", props: {}, path: "/" }] }) }), NOW);
    await new Promise((r) => setTimeout(r, 20));
    expect(runs()).toBe(0);
  });
});
