import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Annotation routes against the real dev server and the real PostgreSQL (no mocks). Every test uses its own readers
 * (a fresh cookie jar) and ids made unique by a per-run tag; each test deletes the rows it created. Skipped when the
 * server has no database. Outage behaviour is covered in tests/unit/annotation-routes-outage.test.ts.
 */
const TAG = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DOC = "sample:on-a-piece-of-chalk";
let seq = 0;
const newId = () => `${TAG}${(seq++).toString(36)}`.slice(0, 40);

const body = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  documentId: DOC,
  kind: "note",
  color: "yellow",
  note: "first",
  anchor: { start: { b: "p1", o: 4 }, end: { b: "p1", o: 17 }, quote: "chalk is soft", prefix: "The ", suffix: "." },
  createdAt: Date.now() - 5_000,
  updatedAt: Date.now() - 5_000,
  ...over,
});

async function data(r: APIRequestContext) {
  const res = await r.get(`/api/documents/${encodeURIComponent(DOC)}/data`);
  expect(res.status()).toBe(200);
  return (await res.json()) as { persisted: boolean; readerKey?: string; annotations: { id: string; note?: string; updatedAt: number }[] };
}

test.describe("annotation routes (PostgreSQL)", () => {
  test.beforeEach(async ({ request }) => {
    const probeId = newId();
    const probe = await request.post("/api/annotations", { data: body(probeId) });
    const j = await probe.json().catch(() => ({}));
    await request.delete(`/api/annotations/${probeId}`);
    test.skip(j.persisted !== true, "server has no reachable database");
  });

  test("a structured AI result is stored with the gloss and comes back unchanged; a malformed one is refused", async ({ request }) => {
    const id = newId();
    const result = {
      kind: "summary",
      variant: "quick",
      items: [{ text: "Tides follow the moon.", basis: "text", evidence: [{ blockId: "p1", n: 1, quote: "chalk is soft", start: 4, end: 17 }] }],
      caveats: [],
      coverage: { used: 3, total: 3, from: 1, to: 3, complete: true },
    };
    const g = { id, documentId: DOC, action: "summarize", anchor: null, turns: [], result, createdAt: Date.now() - 5_000 };
    const bad = await request.post("/api/glosses", { data: { ...g, id: newId(), result: { ...result, items: [{ ...result.items[0], basis: "certain" }] } } });
    expect(bad.status()).toBe(400);
    const ok = await request.post("/api/glosses", { data: g });
    expect((await ok.json()).persisted).toBe(true);
    const res = await request.get(`/api/documents/${encodeURIComponent(DOC)}/data`);
    const back = ((await res.json()) as { glosses: { id: string; result?: unknown }[] }).glosses.find((x) => x.id === id);
    expect(back?.result).toEqual(result);
    await request.delete(`/api/glosses/${id}`);
  });

  test("POST rejects oversized, malformed and inconsistent annotations with 400, and stores nothing", async ({ request }) => {
    const id = newId();
    const q = "x".repeat(20_001);
    for (const bad of [
      body(id, { anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 20_001 }, quote: q } }),
      body(id, { anchor: { start: { b: "p1", o: 17 }, end: { b: "p1", o: 4 }, quote: "chalk is soft" } }),
      body(id, { anchor: { start: { b: "p1", o: 4 }, end: { b: "p1", o: 999_999 }, quote: "chalk" } }),
      body(id, { anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 2 }, quote: "ab\udc4d" } }),
      body(id, { createdAt: 1e300 }),
      body(id, { updatedAt: 8.64e15 + 1 }),
      body(`bad id/${id}`),
    ]) {
      const res = await request.post("/api/annotations", { data: JSON.stringify(bad), headers: { "content-type": "application/json" } });
      expect(res.status(), JSON.stringify(bad).slice(0, 120)).toBe(400);
    }
    expect((await data(request)).annotations.some((a) => a.id === id)).toBe(false);
  });

  test("PATCH applies last-write-wins on the client's updatedAt: a stale PATCH arriving late is a no-op", async ({ request }) => {
    const id = newId();
    const t = Date.now() - 1000;
    expect((await request.post("/api/annotations", { data: body(id, { createdAt: t, updatedAt: t }) })).ok()).toBeTruthy();
    const v2 = await request.patch(`/api/annotations/${id}`, { data: { note: "v2", updatedAt: t + 20 } });
    expect(await v2.json()).toMatchObject({ persisted: true });
    const v1 = await request.patch(`/api/annotations/${id}`, { data: { note: "v1", updatedAt: t + 10 } }); // arrives last
    expect(v1.status()).toBe(200);
    expect(await v1.json()).toMatchObject({ persisted: true, applied: false });
    const row = (await data(request)).annotations.find((a) => a.id === id)!;
    expect(row.note).toBe("v2");
    expect(row.updatedAt).toBe(t + 20);
    await request.delete(`/api/annotations/${id}`);
  });

  test("PATCH of an id the reader does not have is a 404, so the client can fall back to a full POST", async ({ request }) => {
    const res = await request.patch(`/api/annotations/${newId()}`, { data: { note: "x", updatedAt: Date.now() } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  test("POST upsert is last-write-wins too: an older copy does not overwrite a newer one", async ({ request }) => {
    const id = newId();
    const t = Date.now() - 1000;
    await request.post("/api/annotations", { data: body(id, { note: "new", createdAt: t, updatedAt: t + 20 }) });
    const stale = await request.post("/api/annotations", { data: body(id, { note: "old", createdAt: t, updatedAt: t + 10 }) });
    expect(await stale.json()).toMatchObject({ persisted: true, applied: false });
    expect((await data(request)).annotations.find((a) => a.id === id)!.note).toBe("new");
    await request.delete(`/api/annotations/${id}`);
  });

  test("an id that belongs to another reader is refused with 409 and the owner's row is untouched", async ({ request, playwright, baseURL }) => {
    const id = newId();
    expect((await request.post("/api/annotations", { data: body(id, { note: "mine" }) })).ok()).toBeTruthy();
    const other = await playwright.request.newContext({ baseURL });
    try {
      const res = await other.post("/api/annotations", { data: body(id, { note: "hijack", updatedAt: Date.now() }) });
      expect(res.status()).toBe(409);
      expect((await res.json()).persisted).not.toBe(true);
      // The other reader can neither read, patch nor delete it.
      expect((await data(other)).annotations.some((a) => a.id === id)).toBe(false);
      expect((await other.patch(`/api/annotations/${id}`, { data: { note: "x", updatedAt: Date.now() } })).status()).toBe(404);
      await other.delete(`/api/annotations/${id}`);
    } finally {
      await other.dispose();
    }
    expect((await data(request)).annotations.find((a) => a.id === id)!.note).toBe("mine");
    await request.delete(`/api/annotations/${id}`);
  });

  test("the data answer carries an opaque reader key: stable per reader, different between readers, never the reader id", async ({ request, playwright, baseURL }) => {
    const a1 = await data(request);
    const a2 = await data(request);
    expect(a1.readerKey).toMatch(/^[0-9a-f]{16}$/);
    expect(a2.readerKey).toBe(a1.readerKey);
    const cookie = (await request.storageState()).cookies.find((c) => c.name === "gloss_reader")!.value;
    expect(cookie).not.toContain(a1.readerKey!);
    const other = await playwright.request.newContext({ baseURL });
    try {
      const id = newId();
      await other.post("/api/annotations", { data: body(id) }); // creates the second reader and its cookie
      expect((await data(other)).readerKey).not.toBe(a1.readerKey);
      await other.delete(`/api/annotations/${id}`);
    } finally {
      await other.dispose();
    }
  });
});
