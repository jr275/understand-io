import { expect, test, type APIRequestContext } from "@playwright/test";

/** A separate cookie jar per reader, against the real routes and the real local PostgreSQL. Each test removes the rows it creates. */
test.describe("import validation (real routes)", () => {
  test("files: PDFs, text and markdown are read; images, other types and binary data are refused", async ({ request }) => {
    const text = await request.post("/api/import/file", { multipart: { file: { name: "plain-notes.txt", mimeType: "text/plain", buffer: Buffer.from("First paragraph.\n\nSecond paragraph.") } } });
    expect(text.status()).toBe(200);
    const doc = (await text.json()).document;
    expect(doc.title).toBe("plain-notes");
    expect(doc.blocks).toHaveLength(2);

    const gif = await request.post("/api/import/file", { multipart: { file: { name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") } } });
    expect(gif.status()).toBe(415);
    expect((await gif.json()).error).toMatch(/Only PDF, text/);

    const binary = await request.post("/api/import/file", { multipart: { file: { name: "blob.txt", mimeType: "text/plain", buffer: Buffer.from([1, 2, 0, 3, 255]) } } });
    expect(binary.status()).toBe(415);
    expect((await binary.json()).error).toMatch(/does not look like text/);

    const pdf = await request.post("/api/import/file", { multipart: { file: { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") } } });
    expect(pdf.status()).toBe(422);
    expect((await pdf.json()).error).toMatch(/could not be opened/);

    expect((await request.post("/api/import/file", { multipart: { x: "1" } })).status()).toBe(400);
    for (const id of [doc.id]) await request.delete(`/api/documents/${id}`);
  });

  test("text: says what is wrong instead of 'Nothing to read' for everything", async ({ request }) => {
    const post = (data: unknown, raw = false) => request.post("/api/import/text", raw ? { headers: { "content-type": "application/json" }, data: data as string } : { data: data as object });
    const malformed = await post("{bad", true);
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).error).toMatch(/could not be read/);
    const tooLong = await post({ text: "x".repeat(2_000_001) });
    expect(tooLong.status()).toBe(413);
    expect((await tooLong.json()).error).toMatch(/longer than 2 million/);
    const nul = await post({ text: "hello\u0000world" });
    expect(nul.status()).toBe(400);
    expect((await nul.json()).error).toMatch(/cannot be stored/);
    const blank = await post({ text: "  \n\n " });
    expect(blank.status()).toBe(422);
    expect((await blank.json()).error).toBe("Nothing to read.");
    expect((await post({ text: 42 })).status()).toBe(400);
  });
});

test.describe("one reader cannot see or change another reader's data", () => {
  const secret = "Marmalade-zebra-quartz is the private sentence of reader A.";
  let a: APIRequestContext;
  let b: APIRequestContext;
  const cleanup: (() => Promise<unknown>)[] = [];

  test.beforeEach(async ({ playwright, baseURL }) => {
    a = await playwright.request.newContext({ baseURL });
    b = await playwright.request.newContext({ baseURL });
  });
  test.afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn().catch(() => {});
    await a.dispose();
    await b.dispose();
  });

  test("documents, annotations and progress stay with their reader", async () => {
    // Reader A: a document, a highlight on it, reading progress.
    const created = await a.post("/api/import/text", { data: { text: `# Isolation test document\n\n${secret}\n\nSecond paragraph of A.` } });
    expect(created.ok()).toBeTruthy();
    const docA = (await created.json()).document as { id: string; slug: string };
    cleanup.push(() => a.delete(`/api/documents/${docA.id}`));
    const now = Date.now();
    const annId = `isoA${now}`;
    const highlight = await a.post("/api/annotations", { data: { id: annId, documentId: docA.id, kind: "highlight", color: "yellow", anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 9 }, quote: "Marmalade" }, createdAt: now, updatedAt: now } });
    expect(highlight.ok()).toBeTruthy();
    expect((await highlight.json()).persisted).toBe(true);
    await a.put("/api/progress", { data: { documentId: docA.id, blockId: "p1", ratio: 0.5, updatedAt: now } });

    // Reader B: has an identity of their own (a document), and tries everything against A's ids.
    const own = await b.post("/api/import/text", { data: { text: "# B's own document\n\nB writes something else entirely." } });
    const docB = (await own.json()).document as { id: string };
    cleanup.push(() => b.delete(`/api/documents/${docB.id}`));

    const listB = (await (await b.get("/api/documents")).json()).documents as { id: string }[];
    expect(listB.map((d) => d.id)).toContain(docB.id);
    expect(listB.map((d) => d.id)).not.toContain(docA.id);

    const dataB = await (await b.get(`/api/documents/${docA.id}/data`)).json();
    expect(dataB.annotations).toEqual([]);
    expect(dataB.progress).toBeNull();

    const page = await b.get(`/read/${docA.slug}`);
    expect(await page.text()).not.toContain("Marmalade-zebra-quartz"); // A's text is not in the page B receives

    await b.patch(`/api/annotations/${annId}`, { data: { note: "defaced by B", color: "pink", updatedAt: Date.now() + 1000 } });
    await b.delete(`/api/annotations/${annId}`);
    await b.patch(`/api/documents/${docA.id}`, { data: { title: "Hijacked", favourite: true } });
    await b.delete(`/api/documents/${docA.id}`);
    const stolen = await b.post("/api/annotations", { data: { id: annId, documentId: docB.id, kind: "underline", anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 4 }, quote: "B wr" }, createdAt: now, updatedAt: now + 5000 } });
    expect(stolen.status()).toBe(409); // an id that belongs to someone else is refused, never overwritten

    // Everything of A's is exactly as A left it.
    const listA = (await (await a.get("/api/documents")).json()).documents as { id: string; title: string }[];
    expect(listA.find((d) => d.id === docA.id)?.title).toBe("Isolation test document");
    const dataA = await (await a.get(`/api/documents/${docA.id}/data`)).json();
    expect(dataA.annotations).toHaveLength(1);
    expect(dataA.annotations[0]).toMatchObject({ id: annId, kind: "highlight", color: "yellow" });
    expect(dataA.annotations[0].note).toBeUndefined();
    expect(dataA.progress).toMatchObject({ blockId: "p1", ratio: 0.5 });
    expect(await (await a.get(`/read/${docA.slug}`)).text()).toContain("Marmalade-zebra-quartz");
  });
});
