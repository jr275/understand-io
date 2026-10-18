import { beforeAll, describe, expect, it } from "vitest";
import { BASE, Reader, annotationFor, uid } from "./client";

/**
 * Data ownership against a real server and a real PostgreSQL. Skipped (reported as skipped, never as passed) unless
 * INTEGRATION_BASE_URL names a server started with a disposable DATABASE_URL: see docs/quality/integration-testing.md.
 */
const TEXT = "The quick brown fox jumps over the lazy dog.\n\nA second paragraph keeps the document honest.\n\nAnd a third one.";

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe.skipIf(!BASE)("ownership across readers (real server, real database)", () => {
  let alice: Reader;
  let bob: Reader;
  let doc: Awaited<ReturnType<Reader["importText"]>>;

  beforeAll(async () => {
    alice = new Reader("alice");
    bob = new Reader("bob");
    doc = await alice.importText(TEXT, `Ownership ${uid("t")}`);
    await bob.importText("Bob's own text.\n\nWith a second paragraph.", `Bob ${uid("t")}`);
  });

  it("each reader lists only their own documents", async () => {
    expect((await alice.get("/api/documents")).json?.persisted).toBe(true);
    expect(ids(await alice.docs())).toContain(doc.id);
    expect(ids(await bob.docs())).not.toContain(doc.id);
  });

  it("a reader with no cookie, or a forged one, sees nothing and cannot borrow another reader's identity", async () => {
    const aliceId = alice.cookie.split("=")[1].split(".")[0];
    const forgedCookie = `gloss_reader=${aliceId}.AAAAAAAAAAAAAAAAAAAAAA`;
    const none = new Reader("none");
    expect(await none.docs()).toEqual([]);
    expect((await none.call("GET", "/api/documents", undefined, { cookie: forgedCookie })).json?.documents).toEqual([]);
    const data = await none.call("GET", `/api/documents/${doc.id}/data`, undefined, { cookie: forgedCookie });
    expect(data.json?.annotations ?? []).toEqual([]);
  });

  it("another reader cannot read a document's marks, questions or position", async () => {
    const note = annotationFor(doc, { note: "alice private" });
    expect((await alice.post("/api/annotations", note)).json?.applied).toBe(true);
    expect(JSON.stringify((await bob.get(`/api/documents/${doc.id}/data`)).json)).not.toContain("alice private");
    expect(ids((await alice.data(doc.id)).annotations)).toContain(note.id);
  });

  it("another reader cannot overwrite, edit or delete a mark by its id", async () => {
    const note = annotationFor(doc, { note: "alice original" });
    await alice.post("/api/annotations", note);

    const clash = await bob.post("/api/annotations", { ...note, note: "bob took it", updatedAt: Date.now() });
    // Refused either as an unknown document (404, which also hides that the id exists) or as an id clash (409): never applied.
    expect([404, 409]).toContain(clash.status);
    const patch = await bob.patch(`/api/annotations/${note.id}`, { note: "bob patched", updatedAt: Date.now() });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    await bob.del(`/api/annotations/${note.id}`);

    const mine = (await alice.data(doc.id)).annotations.find((a) => a.id === note.id);
    expect(mine?.note).toBe("alice original");
  });

  it("an id that belongs to another reader is refused with a conflict even on the writer's own document", async () => {
    const bobDoc = await bob.importText("Bob's document for the clash.\n\nSecond paragraph.", `Clash ${uid("t")}`);
    const note = annotationFor(doc, { note: "alice owns this id" });
    await alice.post("/api/annotations", note);
    const clash = await bob.post("/api/annotations", { ...annotationFor(bobDoc), id: note.id, note: "bob wants it", updatedAt: Date.now() });
    expect(clash.status).toBe(409);
    expect((await alice.data(doc.id)).annotations.find((a) => a.id === note.id)?.note).toBe("alice owns this id");
    expect(ids((await bob.data(bobDoc.id)).annotations)).not.toContain(note.id);
  });

  it("another reader cannot overwrite or delete a saved question by its id", async () => {
    const id = uid("gl");
    const gloss = { id, documentId: doc.id, action: "ask", anchor: null, turns: [{ role: "user", content: "Why a fox?" }], createdAt: Date.now() - 1000 };
    expect((await alice.post("/api/glosses", gloss)).status).toBe(200);
    expect([404, 409]).toContain((await bob.post("/api/glosses", { ...gloss, turns: [{ role: "user", content: "hijacked" }] })).status);
    await bob.del(`/api/glosses/${id}`);
    expect((await alice.data(doc.id)).glosses.find((g) => g.id === id)?.turns[0].content).toBe("Why a fox?");
  });

  it("another reader cannot rename, favourite or delete a document", async () => {
    await bob.patch(`/api/documents/${doc.id}`, { title: "bob renamed it", favourite: true });
    await bob.del(`/api/documents/${doc.id}`);
    const mine = (await alice.docs()).find((d) => d.id === doc.id);
    expect(mine).toBeTruthy();
    expect(mine?.title).not.toBe("bob renamed it");
  });

  it("reading position is per reader: another reader's write does not change it", async () => {
    const ok = await alice.put("/api/progress", { documentId: doc.id, blockId: doc.blocks[1].id, ratio: 0.4, updatedAt: Date.now() - 500 });
    expect(ok.json?.persisted).toBe(true);
    await bob.put("/api/progress", { documentId: doc.id, blockId: doc.blocks[2].id, ratio: 0.9, updatedAt: Date.now() - 400 });
    expect((await alice.data(doc.id)).progress?.ratio).toBe(0.4);
  });

  it("a mark, question or position cannot be attached to a document the reader does not own, or that does not exist", async () => {
    // Bob does not own alice's document, and no one owns "ghost-document".
    for (const documentId of [doc.id, "ghost-document"]) {
      const note = annotationFor({ ...doc, id: documentId }, { note: "orphan" });
      expect((await bob.post("/api/annotations", note)).status).toBe(404);
      const gloss = { id: uid("gl"), documentId, action: "ask", anchor: null, turns: [{ role: "user", content: "orphan?" }], createdAt: Date.now() - 1000 };
      expect((await bob.post("/api/glosses", gloss)).status).toBe(404);
      expect((await bob.put("/api/progress", { documentId, ratio: 0.1, updatedAt: Date.now() - 100 })).status).toBe(404);
    }
    // Alice's own document still accepts alice's marks (the check must not reject legitimate writes).
    expect((await alice.post("/api/annotations", annotationFor(doc))).json?.applied).toBe(true);
  });

  it("built-in sample texts still take marks and positions, and an unknown sample does not", async () => {
    const sample = { id: "sample:on-thinking-for-oneself", blocks: [{ id: "p1", text: "A sentence of the sample text." }] };
    expect((await bob.post("/api/annotations", annotationFor(sample))).json?.applied).toBe(true);
    expect((await bob.put("/api/progress", { documentId: sample.id, ratio: 0.3, updatedAt: Date.now() - 100 })).json?.persisted).toBe(true);
    expect((await bob.post("/api/annotations", annotationFor({ ...sample, id: "sample:no-such-sample" }))).status).toBe(404);
  });

  it("saving the same mark twice is idempotent, and an older copy never overwrites a newer one", async () => {
    const note = annotationFor(doc, { note: "v2", updatedAt: Date.now() - 100 });
    await alice.post("/api/annotations", note);
    await alice.post("/api/annotations", note);
    const stale = await alice.post("/api/annotations", { ...note, note: "v1 stale", updatedAt: Date.now() - 5000 });
    expect(stale.json?.applied).toBe(false);
    const copies = (await alice.data(doc.id)).annotations.filter((a) => a.id === note.id);
    expect(copies).toHaveLength(1);
    expect(copies[0].note).toBe("v2");
  });

  it("two readers importing a text with the same title each keep their own document", async () => {
    const title = `Shared title ${uid("t")}`;
    const a = await alice.importText("Same title, alice's words.\n\nSecond.", title);
    const b = await bob.importText("Same title, bob's words.\n\nSecond.", title);
    expect(a.id).not.toBe(b.id);
    expect(ids(await alice.docs())).not.toContain(b.id);
    expect(ids(await bob.docs())).not.toContain(a.id);
  });

  it("deleting a document removes its marks, questions and position together, and only the owner's", async () => {
    const mine = await alice.importText("To be deleted.\n\nWith a second paragraph.", `Delete ${uid("t")}`);
    await alice.post("/api/annotations", annotationFor(mine));
    await alice.put("/api/progress", { documentId: mine.id, ratio: 0.2, updatedAt: Date.now() - 300 });
    expect((await alice.del(`/api/documents/${mine.id}`)).json?.persisted).toBe(true);
    const after = await alice.data(mine.id);
    expect(after.annotations).toEqual([]);
    expect(after.progress).toBeNull();
    expect(ids(await alice.docs())).not.toContain(mine.id);
  });

  it("responses that depend on the reader are never cacheable by a shared cache", async () => {
    for (const path of ["/api/documents", `/api/documents/${doc.id}/data`]) {
      const cc = (await alice.get(path)).headers.get("cache-control") ?? "";
      expect(cc, path).toMatch(/no-store|private/);
      expect(cc, path).not.toMatch(/public/);
    }
  });

  it("a client that loops on imports is slowed with a 429, and other readers are unaffected", async () => {
    const flooder = new Reader("flooder");
    let first429 = -1;
    for (let i = 0; i < 70 && first429 < 0; i++) {
      const r = await flooder.post("/api/import/text", { text: `Flood ${i} ${uid("f")}.\n\nSecond paragraph.`, title: `Flood ${i}` });
      if (r.status === 429) {
        first429 = i;
        expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
      } else expect(r.status).toBe(200);
    }
    expect(first429).toBe(60); // 60 allowed per ten minutes, the 61st refused
    const calm = await alice.importText("Still welcome.\n\nSecond.", `Calm ${uid("t")}`);
    expect(calm.id).toBeTruthy();
  });
});
