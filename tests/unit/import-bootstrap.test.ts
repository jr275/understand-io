// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importing files must settle the reader cookie first. A new visitor has none, and two uploads sent together (a batch) would each be given a
 * different reader by the server: the browser keeps one cookie, and the document saved under the other reader vanishes from the library.
 */
const doc = (n: string) => ({ slug: `slug-${n}`, kind: "text", title: `Title ${n}`, author: null, topic: "unsorted", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p", n: 1, text: `Words of ${n}.`, runs: [{ text: `Words of ${n}.` }] }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function freshClient() {
  vi.resetModules();
  window.localStorage.clear();
  return import("@/lib/client/import");
}

beforeEach(() => {
  vi.spyOn(Date, "now");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("importing a file", () => {
  it("asks for the reader cookie once, before any upload, even when several uploads start together", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/api/reader") {
          await new Promise((r) => setTimeout(r, 15)); // the cookie is not there until this answers
          return json({ persisted: true, readerKey: "k" });
        }
        return json({ document: doc(String((init?.body as FormData).get("file") instanceof File ? ((init?.body as FormData).get("file") as File).name : "x")), persisted: true });
      }),
    );
    const { sendFile } = await freshClient();
    await Promise.all([sendFile(new File(["a"], "a.txt")), sendFile(new File(["b"], "b.txt")), sendFile(new File(["c"], "c.txt"))]);
    expect(calls[0]).toBe("POST /api/reader");
    expect(calls.filter((c) => c === "POST /api/reader")).toHaveLength(1);
    expect(calls.filter((c) => c === "POST /api/import/file")).toHaveLength(3);
    expect(calls.indexOf("POST /api/import/file")).toBeGreaterThan(0); // no upload went ahead of the bootstrap
  });

  it("does not let a failed bootstrap stop the import, and asks again for the next one", async () => {
    let bootstraps = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/reader") {
          bootstraps += 1;
          if (bootstraps === 1) throw new TypeError("network down");
          return json({ persisted: true });
        }
        return json({ document: doc("ok"), persisted: true });
      }),
    );
    const { sendFile } = await freshClient();
    expect((await sendFile(new File(["x"], "one.txt"))).document.title).toBe("Title ok");
    await sendFile(new File(["y"], "two.txt"));
    expect(bootstraps).toBe(2);
  });
});

describe("duplicates when the server kept the document", () => {
  const text = "Chalk is a soft white porous sedimentary carbonate rock composed of calcite and the shells of sea creatures. ".repeat(3);
  const stored = { slug: "stored", kind: "text" as const, title: "Stored", author: null, topic: "unsorted", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p" as const, n: 1, text, runs: [{ text }] }] };

  it("trusts the server: a saved text is not second-guessed by the browser's own (case-insensitive) check", async () => {
    // The shelf already holds the same words in other capitals; the server compared exactly and saved this one as a new document.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (String(input) === "/api/reader" ? json({ persisted: true }) : json({ document: { ...stored, slug: "new-copy", title: "New copy" }, persisted: true }))));
    const { sendFile } = await freshClient();
    const lib = await import("@/lib/store/library");
    lib.rememberDocument({ ...stored, id: "d1", blocks: [{ ...stored.blocks[0], text: text.toUpperCase(), runs: [{ text: text.toUpperCase() }] }] }, true);
    const r = await sendFile(new File(["x"], "x.txt"));
    expect(r.duplicate).toBeUndefined();
    expect(r.document.slug).toBe("new-copy");
  });

  it("compares with the browser's own shelf only when the server kept nothing (no database)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (String(input) === "/api/reader" ? json({ persisted: false }) : json({ document: { ...stored, slug: "again", title: "Again" }, persisted: false }))));
    const { sendFile } = await freshClient();
    const lib = await import("@/lib/store/library");
    lib.rememberDocument({ ...stored, id: "local:stored" }, false);
    const r = await sendFile(new File(["x"], "x.txt"));
    expect(r.duplicate).toBe(true);
    expect(r.document.slug).toBe("stored");
  });
});
