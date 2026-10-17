import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ANNOT-21: while PostgreSQL is unreachable the annotation, gloss, progress and data routes must answer instead of
 * throwing. Real outage, as in db-outage.test.ts: DATABASE_URL names a port nothing listens on, so postgres.js and
 * drizzle raise the genuine ECONNREFUSED. The only mock is the cookie reader (cookies() needs a Next request scope).
 */
vi.mock("@/lib/server/reader", () => ({ getReaderId: async () => "r_outage_test", ensureReaderId: async () => "r_outage_test" }));

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/gloss";
});
afterEach(() => vi.restoreAllMocks());

const now = Date.now();
const anchor = { start: { b: "p1", o: 0 }, end: { b: "p1", o: 5 }, quote: "Hello" };
const json = (method: string, body: unknown) => new Request("http://x.test/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("routes during a database outage", () => {
  it("annotation POST, PATCH and DELETE answer 503 database-unavailable (the client keeps its tombstones)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("@/app/api/annotations/route");
    const { PATCH, DELETE } = await import("@/app/api/annotations/[id]/route");
    const created = await POST(json("POST", { id: "ann_outage001", documentId: "sample:x", kind: "highlight", anchor, createdAt: now, updatedAt: now }));
    expect(created.status).toBe(503);
    expect(await created.json()).toEqual({ error: "database-unavailable" });
    const patched = await PATCH(json("PATCH", { note: "n", updatedAt: now }), ctx("ann_outage001"));
    expect(patched.status).toBe(503);
    const deleted = await DELETE(new Request("http://x.test/api", { method: "DELETE" }), ctx("ann_outage001"));
    expect(deleted.status).toBe(503);
    expect(await deleted.json()).toEqual({ error: "database-unavailable" });
  });

  it("gloss POST/DELETE and progress PUT answer 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("@/app/api/glosses/route");
    const { DELETE } = await import("@/app/api/glosses/[id]/route");
    const { PUT } = await import("@/app/api/progress/route");
    const g = await POST(json("POST", { id: "gloss_outage1", documentId: "sample:x", action: "explain", anchor, turns: [{ role: "assistant", content: "x" }], createdAt: now }));
    expect(g.status).toBe(503);
    expect((await DELETE(new Request("http://x.test/api", { method: "DELETE" }), ctx("gloss_outage1"))).status).toBe(503);
    expect((await PUT(json("PUT", { documentId: "sample:x", ratio: 0.5, updatedAt: now }))).status).toBe(503);
  });

  it("document PATCH and DELETE answer 503 too, not an uncaught error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { PATCH, DELETE } = await import("@/app/api/documents/[id]/route");
    expect((await PATCH(json("PATCH", { topic: "history" }), ctx("doc_outage_1"))).status).toBe(503);
    const del = await DELETE(new Request("http://x.test/api", { method: "DELETE" }), ctx("doc_outage_1"));
    expect(del.status).toBe(503);
    expect(await del.json()).toEqual({ error: "database-unavailable" });
  });

  it("the document data GET answers 200 with persisted:false and empty lists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET } = await import("@/app/api/documents/[id]/data/route");
    const res = await GET(new Request("http://x.test/api"), ctx("sample:x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ annotations: [], glosses: [], progress: null, persisted: false });
    // The log line names the failure but carries neither SQL nor the reader id.
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("ECONNREFUSED");
    expect(String(warn.mock.calls[0][0])).not.toMatch(/select|r_outage_test/i);
  });

  it("invalid input is still a 400, decided before the database is touched", async () => {
    const { POST } = await import("@/app/api/annotations/route");
    const res = await POST(json("POST", { id: "x", documentId: "sample:x", kind: "highlight", anchor, createdAt: now, updatedAt: now }));
    expect(res.status).toBe(400);
  });
});
