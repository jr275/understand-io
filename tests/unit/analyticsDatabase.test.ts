// The analytics table against the real local PostgreSQL (DATABASE_URL), like aiStoreDatabase.test.ts. Every actor is unique to a run and is
// removed afterwards; rows are never read by anyone else's test.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { analyticsEvents } from "@/lib/db/schema";
import { handleEvents, pruneAnalytics, resetAnalyticsLimits } from "@/lib/server/analytics";
import { readerCookieValue } from "@/lib/server/reader";

const db = process.env.DATABASE_URL ? getDb() : null;
const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86_400_000;

describe.skipIf(!db)("analytics events (real PostgreSQL)", () => {
  beforeAll(() => {
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(40));
    vi.stubEnv("GLOSS_ANALYTICS_DAILY_CAP", "100000");
    resetAnalyticsLimits();
  });
  afterAll(async () => {
    await db!.delete(analyticsEvents).where(like(analyticsEvents.route, `/read/${run}%`));
    await db!.delete(analyticsEvents).where(eq(analyticsEvents.ref, run.slice(0, 12)));
    vi.unstubAllEnvs();
  });

  it("stores an accepted event in the table and nothing but what the taxonomy allows", async () => {
    const now = Date.now();
    const req = new Request("http://x.test/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `gloss_reader=${readerCookieValue(`r_${run}`)}`, "user-agent": "UA", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify({ events: [{ event: "document_opened", props: { kind: "pdf", via: "library", age: "7-29d" }, path: `/read/${run}-some-title` }] }),
    });
    expect((await handleEvents(req, now)).status).toBe(204);
    const rows = await db!.select().from(analyticsEvents).where(eq(analyticsEvents.route, "/read/:slug"));
    const mine = rows.filter((r) => r.at === now && r.actorKind === "reader");
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const row = mine[mine.length - 1];
    expect(row.props).toEqual({ kind: "pdf", via: "library", age: "7-29d" });
    expect(JSON.stringify(row)).not.toContain(run); // neither the reader id nor the title is in the row
    await db!.delete(analyticsEvents).where(eq(analyticsEvents.id, row.id));
  });

  it("writes no row at all while analytics is off, whatever is posted", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "off");
    const count = async () => (await db!.select({ id: analyticsEvents.id }).from(analyticsEvents)).length;
    const before = await count();
    for (const body of [{ events: [{ event: "landing_viewed", props: {}, path: "/" }] }, { events: [{ event: "document_opened", props: { kind: "pdf", via: "library", age: "0d" } }] }]) {
      const res = await handleEvents(new Request("http://x.test/api/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "UA" }, body: JSON.stringify(body) }), Date.now());
      expect(res.status).toBe(204);
      expect(res.headers.get("x-gloss-analytics")).toBe("off");
    }
    expect(await count()).toBe(before);
    vi.stubEnv("GLOSS_ANALYTICS", "full");
  });

  it("deletes what is past retention and keeps the rest", async () => {
    const tag = run.slice(0, 12);
    const now = Date.now();
    await db!.insert(analyticsEvents).values([
      { at: now - 200 * DAY, event: "landing_viewed", actor: `old${run}`, actorKind: "daily", props: {}, ref: tag },
      { at: now - 10 * DAY, event: "landing_viewed", actor: `new${run}`, actorKind: "daily", props: {}, ref: tag },
    ]);
    expect(await pruneAnalytics(now)).toBeGreaterThanOrEqual(1);
    const left = await db!.select().from(analyticsEvents).where(eq(analyticsEvents.ref, tag));
    expect(left.map((r) => r.actor)).toEqual([`new${run}`]);
  });
});
