import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, Reader, uid } from "./client";

/**
 * Importing files and pages against a real server and PostgreSQL: what is read, what is refused, and what counts as the same document.
 * Skipped unless INTEGRATION_BASE_URL names a server on a disposable database (docs/quality/integration-testing.md).
 */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const docx = (...paragraphs: string[]) =>
  zipSync({
    "[Content_Types].xml": strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${paragraphs.map(para).join("")}</w:body></w:document>`),
  });
const epub = (...chapters: string[]) =>
  zipSync({
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
    "c.opf": strToU8(
      `<package xmlns:dc="x"><metadata><dc:title>Book ${chapters.length}</dc:title></metadata><manifest>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
    ),
    ...Object.fromEntries(chapters.map((c, i) => [`c${i}.xhtml`, strToU8(`<html><body>${c}</body></html>`)])),
  });
const file = (bytes: Uint8Array | string, name: string, type = "") => new File([bytes as BlobPart], name, { type });
const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const long = "Chalk is a soft white porous sedimentary carbonate rock composed of calcite and the shells of sea creatures. ".repeat(3);

describe.skipIf(!BASE)("importing files and pages (real server, real database)", () => {
  let alice: Reader;
  let bob: Reader;
  beforeAll(() => {
    alice = new Reader("alice");
    bob = new Reader("bob");
  });

  it("reads a Word file, saves it and lists it", async () => {
    const tag = uid("w");
    const r = await alice.upload("/api/import/file", file(docx(`Heading ${tag}`, "A second paragraph of the Word file."), "notes.docx", WORD));
    expect(r.status).toBe(200);
    expect(r.json?.persisted).toBe(true);
    expect(r.json?.duplicate).toBeUndefined();
    const doc = r.json?.document as { id: string; title: string; blocks: { text: string }[]; sourceLabel: string };
    expect(doc.sourceLabel).toBe("notes.docx");
    expect(doc.blocks.map((b) => b.text)).toContain("A second paragraph of the Word file.");
    expect((await alice.docs()).map((d) => d.id)).toContain(doc.id);
  });

  it("reads an EPUB in spine order and a saved web page as content", async () => {
    const e = await alice.upload("/api/import/file", file(epub(`<h1>One ${uid("e")}</h1><p>First chapter.</p>`, "<p>Second chapter.</p>"), "book.epub", "application/epub+zip"));
    expect(e.status).toBe(200);
    expect((e.json?.document as { blocks: { text: string }[] }).blocks.map((b) => b.text).slice(-2)).toEqual(["First chapter.", "Second chapter."]);
    const html = `<!doctype html><html><head><title>Saved ${uid("h")}</title></head><body><article><h1>Saved</h1><p>${long}</p><p>${long}</p><script>alert(1)</script></article></body></html>`;
    const h = await alice.upload("/api/import/file", file(html, "saved.html", "text/html"));
    expect(h.status).toBe(200);
    expect(JSON.stringify(h.json?.document)).not.toContain("alert(1)");
  });

  it("answers a repeat of the same file with the saved document, not a second copy", async () => {
    const bytes = docx(`Repeat ${uid("r")}`, `Same words both times. ${long}`);
    const first = await alice.upload("/api/import/file", file(bytes, "once.docx", WORD));
    const again = await alice.upload("/api/import/file", file(bytes, "again.docx", WORD)); // another file name, the same text
    expect(first.json?.duplicate).toBeUndefined();
    expect(again.status).toBe(200);
    expect(again.json?.duplicate).toBe(true);
    expect((again.json?.document as { id: string }).id).toBe((first.json?.document as { id: string }).id);
    const ids = (await alice.docs()).map((d) => d.id);
    expect(ids.filter((id) => id === (first.json?.document as { id: string }).id)).toHaveLength(1);
  });

  it("never merges short texts by their words: two notes that say the same few words stay two notes", async () => {
    const a = await alice.post("/api/import/text", { text: "Hello.\n\nSame few words.", title: `Short one ${uid("s")}` });
    const b = await alice.post("/api/import/text", { text: "Hello.\n\nSame few words.", title: `Short two ${uid("s")}` });
    expect(b.json?.duplicate).toBeUndefined();
    expect((a.json?.document as { id: string }).id).not.toBe((b.json?.document as { id: string }).id);
  });

  it("treats pasted text and an uploaded file with the same words as one document", async () => {
    const words = `Pasted and then uploaded ${uid("p")}. ${long}\n\nThe second paragraph is the same too.`;
    const pasted = await alice.post("/api/import/text", { text: words, title: "Pasted" });
    const uploaded = await alice.upload("/api/import/file", file(words, "same-words.txt", "text/plain"));
    expect(uploaded.json?.duplicate).toBe(true);
    expect((uploaded.json?.document as { id: string }).id).toBe((pasted.json?.document as { id: string }).id);
  });

  it("does not merge texts that only share a title, or that differ by capitals", async () => {
    const tagCase = uid("c");
    const a = await alice.post("/api/import/text", { text: `Alpha text ${uid("t")}.\n\nBody one.`, title: "Same title" });
    const b = await alice.post("/api/import/text", { text: `Another text ${uid("t")}.\n\nBody two.`, title: "Same title" });
    expect(b.json?.duplicate).toBeUndefined();
    expect((a.json?.document as { id: string }).id).not.toBe((b.json?.document as { id: string }).id);
    const lower = await alice.post("/api/import/text", { text: `capitals matter here ${tagCase}, chalk. ${long}\n\nSecond.`, title: "x" });
    const upper = await alice.post("/api/import/text", { text: `Capitals matter here ${tagCase}, chalk. ${long}\n\nSecond.`, title: "x" });
    expect(upper.json?.duplicate).toBeUndefined();
    expect((lower.json?.document as { id: string }).id).not.toBe((upper.json?.document as { id: string }).id);
  });

  it("recognises the same address however it is written, even when the page text differs", async () => {
    const page = (n: string) => `<!doctype html><html><head><title>Page ${n}</title></head><body><article><h1>Page</h1><p>${long} ${n}</p><p>${long}</p></article></body></html>`;
    const path = `/post-${uid("u")}`;
    const first = await alice.post("/api/import/page", { url: `https://Example.com${path}?utm_source=newsletter#top`, html: page("first") });
    const second = await alice.post("/api/import/page", { url: `https://www.example.com${path}/`, html: page("edited since") });
    expect(first.status).toBe(200);
    expect(second.json?.duplicate).toBe(true);
    expect((second.json?.document as { id: string }).id).toBe((first.json?.document as { id: string }).id);
    const other = await alice.post("/api/import/page", { url: `https://example.com${path}-other`, html: page("third") });
    expect(other.json?.duplicate).toBeUndefined();
  });

  it("keeps readers apart: the same file imported by another reader is that reader's own document", async () => {
    const bytes = docx(`Two readers ${uid("x")}`, "Shared words.");
    const a = await alice.upload("/api/import/file", file(bytes, "shared.docx", WORD));
    const b = await bob.upload("/api/import/file", file(bytes, "shared.docx", WORD));
    expect(b.json?.duplicate).toBeUndefined();
    expect((a.json?.document as { id: string }).id).not.toBe((b.json?.document as { id: string }).id);
    expect((await bob.docs()).map((d) => d.id)).not.toContain((a.json?.document as { id: string }).id);
  });

  it("refuses what cannot be read, with a reason, and saves nothing", async () => {
    const before = (await alice.docs()).length;
    const gif = await alice.upload("/api/import/file", file("GIF89a", "pic.gif", "image/gif"));
    expect(gif.status).toBe(415);
    expect(String(gif.json?.error)).toMatch(/Only PDF, text/);
    const fakeDocx = await alice.upload("/api/import/file", file("this is only text", "fake.docx", WORD));
    expect(fakeDocx.status).toBeGreaterThanOrEqual(400);
    expect(String(fakeDocx.json?.error)).toMatch(/not a valid Word document/);
    const notWord = await alice.upload("/api/import/file", file(zipSync({ "hello.txt": strToU8("hi") }), "zip.docx", WORD));
    expect(String(notWord.json?.error)).toMatch(/not a Word document/);
    const empty = await alice.upload("/api/import/file", file(docx(), "empty.docx", WORD));
    expect(String(empty.json?.error)).toMatch(/Nothing readable/);
    expect((await alice.docs()).length).toBe(before);
  });

  it("refuses a decompression bomb without trying to unpack it", async () => {
    const bomb = zipSync({
      "[Content_Types].xml": strToU8("<Types>wordprocessingml</Types>"),
      "word/document.xml": new Uint8Array(60 * 1024 * 1024), // a few KB on the wire, 60 MB if unpacked
    });
    expect(bomb.length).toBeLessThan(200_000);
    const r = await alice.upload("/api/import/file", file(bomb, "bomb.docx", WORD));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(String(r.json?.error)).toMatch(/too large/);
  });
});
