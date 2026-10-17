// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation, Gloss } from "@/lib/content/types";

/**
 * Store tests for the annotation sync (ANNOT-1, -11, -12). The only mock is `fetch`: a small in-memory
 * stand-in for /api/annotations, /api/glosses and /api/documents/:id/data that records every request in
 * order. The real library module, its localStorage persistence and its request queue run unmodified.
 * (The real routes are covered against PostgreSQL in tests/e2e/annotations-api.spec.ts.)
 */
const DOC = "sample:on-a-piece-of-chalk";

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function makeServer() {
  const server = {
    annotations: new Map<string, Annotation>(),
    glosses: new Map<string, Gloss>(),
    calls: [] as Call[],
    readerKey: "reader-a",
    /** Answer for DELETE: the real route says persisted:false when there is no cookie / no database. */
    deletePersisted: true,
    /** When set, every mutating request answers with this status (e.g. 503 database-unavailable). */
    failWith: undefined as number | undefined,
    /** Delay (ms) before the answer to a POST /api/annotations, to provoke reordering. */
    postDelay: 0,
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    server.calls.push({ method, path, body });
    if (method === "GET" && path.includes("/data")) return json({ persisted: true, readerKey: server.readerKey, annotations: [...server.annotations.values()], glosses: [...server.glosses.values()], progress: null });
    if (server.failWith) return json({ error: "database-unavailable" }, server.failWith);
    if (path === "/api/annotations" && method === "POST") {
      if (server.postDelay) await new Promise((r) => setTimeout(r, server.postDelay));
      const a = body as unknown as Annotation;
      const cur = server.annotations.get(a.id);
      if (!cur || cur.updatedAt <= a.updatedAt) server.annotations.set(a.id, { ...a, syncedAt: undefined });
      return json({ persisted: true, readerKey: server.readerKey });
    }
    if (path === "/api/glosses" && method === "POST") {
      const g = body as unknown as Gloss;
      server.glosses.set(g.id, g);
      return json({ persisted: true });
    }
    const m = /^\/api\/annotations\/([^/]+)$/.exec(path);
    if (m && method === "PATCH") {
      const cur = server.annotations.get(m[1]);
      if (!cur) return json({ error: "not-found" }, 404);
      if (cur.updatedAt <= (body!.updatedAt as number)) server.annotations.set(m[1], { ...cur, ...(body as Partial<Annotation>) });
      return json({ persisted: true, readerKey: server.readerKey });
    }
    if (m && method === "DELETE") {
      if (!server.deletePersisted) return json({ persisted: false });
      server.annotations.delete(m[1]);
      return json({ persisted: true });
    }
    const g = /^\/api\/glosses\/([^/]+)$/.exec(path);
    if (g && method === "DELETE") {
      server.glosses.delete(g[1]);
      return json({ persisted: true });
    }
    return json({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return server;
}

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: "ann_000000001",
  documentId: DOC,
  kind: "highlight",
  color: "yellow",
  anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 5 }, quote: "Hello" },
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
});

async function freshStore(seed?: { annotations?: Annotation[]; glosses?: Gloss[]; deleted?: { kind: "annotation" | "gloss" | "document"; id: string }[]; noReader?: boolean }) {
  vi.resetModules();
  window.localStorage.clear();
  if (seed) window.localStorage.setItem("gloss:v1", JSON.stringify({ docs: {}, progress: {}, annotations: { [DOC]: seed.annotations ?? [] }, glosses: { [DOC]: seed.glosses ?? [] }, hidden: [], deleted: seed.deleted ?? [], syncReader: seed.noReader ? undefined : "reader-a" }));
  return import("@/lib/store/library");
}
const posts = (s: ReturnType<typeof makeServer>) => s.calls.filter((c) => c.method === "POST" && c.path === "/api/annotations");
const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  vi.spyOn(Date, "now");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ANNOT-1: a delete made on another device is not undone by this one", () => {
  it("drops a synced, unedited local annotation that is gone from the server instead of re-POSTing it", async () => {
    const server = makeServer();
    const lib = await freshStore({ annotations: [ann({ syncedAt: 1_000 })] });
    await lib.syncDocumentData(DOC);
    await flush();
    expect(posts(server)).toHaveLength(0);
    expect(lib.getLibrary().annotations[DOC]).toEqual([]);
    expect(server.annotations.size).toBe(0);
  });

  it("still uploads an annotation that was never confirmed by the server (offline create)", async () => {
    const server = makeServer();
    const lib = await freshStore({ annotations: [ann()] });
    await lib.syncDocumentData(DOC);
    await flush();
    expect(posts(server)).toHaveLength(1);
    expect(server.annotations.has("ann_000000001")).toBe(true);
    expect(lib.getLibrary().annotations[DOC]).toHaveLength(1);
    // ...and once confirmed it carries syncedAt, so the next absence means "deleted elsewhere".
    expect(lib.getLibrary().annotations[DOC][0].syncedAt).toBe(1_000);
  });

  it("keeps and re-uploads a synced annotation that was edited after its last sync", async () => {
    const server = makeServer();
    const lib = await freshStore({ annotations: [ann({ syncedAt: 1_000, updatedAt: 2_000, note: "edited offline", kind: "note" })] });
    await lib.syncDocumentData(DOC);
    await flush();
    expect(posts(server)).toHaveLength(1);
    expect(server.annotations.get("ann_000000001")?.note).toBe("edited offline");
  });

  it("marks annotations present in the server answer as synced, and the server copy wins when it is newer", async () => {
    const server = makeServer();
    server.annotations.set("ann_000000001", ann({ updatedAt: 5_000, note: "from server", kind: "note" }));
    const lib = await freshStore({ annotations: [ann({ updatedAt: 3_000 })] });
    await lib.syncDocumentData(DOC);
    await flush();
    const a = lib.getLibrary().annotations[DOC][0];
    expect(a.note).toBe("from server");
    expect(a.syncedAt).toBe(5_000);
    expect(posts(server)).toHaveLength(0);
  });

  it("forgets the synced flags when the server answers for a different reader (sign-in), so nothing is lost", async () => {
    const server = makeServer();
    server.readerKey = "reader-b";
    const lib = await freshStore({ annotations: [ann({ syncedAt: 1_000 })] });
    // The server answers for another reader than the one that confirmed the item: nothing may be dropped.
    await lib.syncDocumentData(DOC);
    await flush();
    expect(lib.getLibrary().annotations[DOC]).toHaveLength(1);
    expect(server.annotations.has("ann_000000001")).toBe(true);
    // Same reader again, the row is deleted on the server: now it is dropped.
    server.annotations.clear();
    await lib.syncDocumentData(DOC);
    await flush();
    expect(lib.getLibrary().annotations[DOC]).toEqual([]);
  });

  it("learns the reader from the server's answers to writes, and forgets the marks when a later answer names another reader", async () => {
    const server = makeServer();
    const lib = await freshStore({ annotations: [], noReader: true });
    lib.addAnnotation(ann({ id: "ann_000000001" }));
    lib.addAnnotation(ann({ id: "ann_000000002", updatedAt: 1_100 }));
    await flush();
    let [x, y] = lib.getLibrary().annotations[DOC];
    expect([x.syncedAt, y.syncedAt]).toEqual([1_000, 1_100]);
    expect(lib.getLibrary().syncReader).toBe("reader-a");
    // The cookie now names another reader (a sign-in): the next confirmation invalidates the old marks.
    server.readerKey = "reader-b";
    lib.updateAnnotation(DOC, "ann_000000001", { kind: "note", note: "n" });
    await flush();
    [x, y] = lib.getLibrary().annotations[DOC];
    expect(lib.getLibrary().syncReader).toBe("reader-b");
    expect(x.syncedAt).toBe(x.updatedAt);
    expect(y.syncedAt).toBeUndefined(); // belongs to the old reader's server copy: must be re-uploaded, not dropped
  });

  it("applies the same rule to glosses", async () => {
    const server = makeServer();
    const g: Gloss = { id: "gl_000000001", documentId: DOC, action: "explain", anchor: null, turns: [{ role: "assistant", content: "x" }], createdAt: 1_000, status: "done", syncedAt: 1_000 };
    const lib = await freshStore({ glosses: [g] });
    await lib.syncDocumentData(DOC);
    await flush();
    expect(server.calls.filter((c) => c.path === "/api/glosses")).toHaveLength(0);
    expect(lib.getLibrary().glosses[DOC]).toEqual([]);
  });
});

describe("ANNOT-12: tombstones and request order", () => {
  it("keeps the tombstone when the DELETE is answered with persisted:false", async () => {
    const server = makeServer();
    server.deletePersisted = false;
    const lib = await freshStore({ annotations: [ann()] });
    lib.removeAnnotation(DOC, "ann_000000001");
    await flush();
    expect(lib.getLibrary().deleted).toEqual([{ kind: "annotation", id: "ann_000000001" }]);
  });

  it("clears the tombstone only when the server confirms with persisted:true", async () => {
    makeServer();
    const lib = await freshStore({ annotations: [ann()] });
    lib.removeAnnotation(DOC, "ann_000000001");
    await flush();
    expect(lib.getLibrary().deleted).toEqual([]);
  });

  it("keeps the tombstone when the database is down (503) and replays it on the next sync", async () => {
    const server = makeServer();
    server.failWith = 503;
    const lib = await freshStore({ annotations: [ann()] });
    lib.removeAnnotation(DOC, "ann_000000001");
    await flush();
    expect(lib.getLibrary().deleted).toHaveLength(1);
    server.failWith = undefined;
    server.annotations.set("ann_000000001", ann());
    await lib.syncDocumentData(DOC);
    await flush();
    expect(lib.getLibrary().deleted).toEqual([]);
    expect(server.annotations.size).toBe(0);
    expect(lib.getLibrary().annotations[DOC]).toEqual([]);
  });

  it("sends DELETE only after the POST of the same annotation has been answered", async () => {
    const server = makeServer();
    server.postDelay = 40;
    const lib = await freshStore({ annotations: [] });
    lib.addAnnotation(ann());
    lib.removeAnnotation(DOC, "ann_000000001");
    await new Promise((r) => setTimeout(r, 150));
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/annotations", "DELETE /api/annotations/ann_000000001"]);
    expect(server.annotations.size).toBe(0);
    expect(lib.getLibrary().deleted).toEqual([]);
  });
});

describe("ANNOT-11: ordered updates with a client timestamp", () => {
  it("sends updatedAt in each PATCH and keeps the PATCHes in call order", async () => {
    const server = makeServer();
    server.postDelay = 30;
    const lib = await freshStore({ annotations: [] });
    let t = 10_000;
    vi.mocked(Date.now).mockImplementation(() => (t += 10));
    lib.addAnnotation(ann({ kind: "note", note: "v0", updatedAt: 10_000 }));
    lib.updateAnnotation(DOC, "ann_000000001", { note: "v1" });
    lib.updateAnnotation(DOC, "ann_000000001", { note: "v2" });
    await new Promise((r) => setTimeout(r, 200));
    const patches = server.calls.filter((c) => c.method === "PATCH");
    expect(patches.map((p) => p.body!.note)).toEqual(["v1", "v2"]);
    expect(patches[0].body!.updatedAt).toBeLessThan(patches[1].body!.updatedAt as number);
    expect(server.calls[0].method).toBe("POST");
    expect(server.annotations.get("ann_000000001")?.note).toBe("v2");
  });

  it("falls back to a full POST when the PATCH finds no row (the create never reached the server)", async () => {
    const server = makeServer();
    const lib = await freshStore({ annotations: [ann({ kind: "note", note: "old" })] });
    lib.updateAnnotation(DOC, "ann_000000001", { note: "new" });
    await flush();
    expect(server.calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(server.annotations.get("ann_000000001")?.note).toBe("new");
    expect(lib.getLibrary().annotations[DOC][0].syncedAt).toBe(lib.getLibrary().annotations[DOC][0].updatedAt);
  });
});
