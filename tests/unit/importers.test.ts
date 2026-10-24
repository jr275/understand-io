import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { IMPORTERS, readUpload } from "@/lib/content/importers";
import { documentFromDocx } from "@/lib/content/importers/docx";
import { documentFromEpub } from "@/lib/content/importers/epub";
import { documentFromHtmlFile } from "@/lib/content/importers/htmlFile";
import { ReadError } from "@/lib/content/errors";
import { ZIP_LIMITS, readZip } from "@/lib/content/zip";
import type { GlossDocument } from "@/lib/content/types";

const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const bytes = (s: string) => new TextEncoder().encode(s);
const texts = (d: GlossDocument) => d.blocks.map((b) => b.text);

/* ------------------------------------------------------------------ zip */

describe("readZip", () => {
  it("reads the entries asked for and skips the rest without inflating them", () => {
    const z = zip({ "a.txt": "alpha", "b.bin": "beta" });
    const out = readZip(z, (n) => n === "a.txt", "test file");
    expect([...out.keys()]).toEqual(["a.txt"]);
    expect(new TextDecoder().decode(out.get("a.txt"))).toBe("alpha");
  });

  it("refuses bytes that are not a zip, with a message for the reader", () => {
    expect(() => readZip(bytes("not a zip at all"), () => true, "Word document")).toThrow(ReadError);
    expect(() => readZip(bytes("PK\x03\x04garbage that is not an archive"), () => true, "Word document")).toThrow(/not a valid Word document/);
  });

  it("refuses an archive of zeros that would inflate to far more than the ceiling (a decompression bomb) without inflating it", () => {
    const bomb = zip({ "word/document.xml": new Uint8Array(ZIP_LIMITS.entryBytes + 5_000_000) }); // a few KB compressed
    expect(bomb.length).toBeLessThan(100_000);
    expect(() => readZip(bomb, () => true, "Word document")).toThrow(/too large/);
  });

  it("refuses an archive whose parts add up to more than the total ceiling", () => {
    const part = new Uint8Array(ZIP_LIMITS.entryBytes - 1000);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) files[`part${i}.xml`] = part;
    expect(() => readZip(zip(files), () => true, "EPUB book")).toThrow(/too large to read here once unpacked/);
  });

  it("refuses an archive with too many entries", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= ZIP_LIMITS.entries; i++) files[`f${i}`] = "x";
    expect(() => readZip(zip(files), () => false, "EPUB book")).toThrow(/too many parts/);
  });

  it("never returns more than an entry declared, even when its header lies about being small", () => {
    const z = zip({ "word/document.xml": new Uint8Array(3_000_000).fill(65) });
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // Make both the local and the central header claim 1,000 bytes.
    for (let i = 0; i + 30 < z.length; i++) {
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 1000, true);
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1000, true);
    }
    let size = -1;
    try {
      size = readZip(z, () => true, "Word document").get("word/document.xml")?.length ?? 0;
    } catch (err) {
      expect(err).toBeInstanceOf(ReadError); // refusing is as good as truncating
      return;
    }
    expect(size).toBeLessThanOrEqual(1000);
  });
});

/* ------------------------------------------------------------------ docx */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const para = (text: string, pPr = "", rPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const heading = (text: string, n: number) => para(text, `<w:pStyle w:val="Heading${n}"/>`);
const docx = (body: string, extra: Record<string, string> = {}) =>
  zip({
    "[Content_Types].xml": '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
    ...extra,
  });

describe("documentFromDocx", () => {
  it("keeps headings, paragraphs, emphasis and the order of the text", () => {
    const d = documentFromDocx(
      docx(heading("On chalk", 1) + heading("Origins", 2) + para("Chalk is a soft rock.") + para("It is bold", "", "<w:b/>") + para("and slanted", "", "<w:i/>")),
      "chalk.docx",
    );
    expect(d.kind).toBe("text");
    expect(d.sourceLabel).toBe("chalk.docx");
    expect(d.title).toBe("On chalk"); // the first heading names the text and is not repeated in the body
    expect(d.blocks.map((b) => [b.type, b.text])).toEqual([
      ["h2", "Origins"],
      ["p", "Chalk is a soft rock."],
      ["p", "It is bold"],
      ["p", "and slanted"],
    ]);
    expect(d.blocks[2].runs?.[0].strong).toBe(true);
    expect(d.blocks[3].runs?.[0].em).toBe(true);
    expect(d.paragraphs).toBe(3);
  });

  it("uses the document's own title and author when it has them", () => {
    const core = '<cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z"><dc:title>The Real Title</dc:title><dc:creator>A. Writer</dc:creator><dcterms:created>2019-05-01T00:00:00Z</dcterms:created></cp:coreProperties>';
    const d = documentFromDocx(docx(heading("First heading", 1) + para("Body text of the file.")), "x.docx");
    expect(d.title).toBe("First heading");
    const withCore = documentFromDocx(docx(para("Body text of the file."), { "docProps/core.xml": core }), "x.docx");
    expect(withCore.title).toBe("The Real Title");
    expect(withCore.author).toBe("A. Writer");
    expect(withCore.year).toBe(2019);
  });

  it("falls back to the file name for a title, and says so only through the name", () => {
    const d = documentFromDocx(docx(para("Just a paragraph.")), "my_field_notes.docx");
    expect(d.title).toBe("my field notes");
  });

  it("turns numbered and bulleted paragraphs into list items, skipping tracked deletions and empty paragraphs", () => {
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const item = (t: string, id: number) => para(t, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`);
    const deleted = '<w:p><w:r><w:t>kept </w:t></w:r><w:del><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>';
    const d = documentFromDocx(docx(item("first", 1) + item("second", 1) + para("") + item("one", 2) + deleted, { "word/numbering.xml": numbering }), "l.docx");
    expect(d.blocks.filter((b) => b.type === "li").map((b) => b.text)).toEqual(["first", "second", "one"]);
    expect(texts(d)).toContain("kept");
    expect(texts(d).join(" ")).not.toContain("removed");
  });

  it("keeps web links and drops every other kind of address", () => {
    const rels = '<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://example.com/a"/><Relationship Id="rId2" TargetMode="External" Target="javascript:alert(1)"/><Relationship Id="rId3" TargetMode="External" Target="file:///etc/passwd"/></Relationships>';
    const link = (id: string, t: string) => `<w:hyperlink r:id="${id}"><w:r><w:t>${t}</w:t></w:r></w:hyperlink>`;
    const d = documentFromDocx(docx(`<w:p>${link("rId1", "good")} ${link("rId2", "script")} ${link("rId3", "local")}</w:p>`, { "word/_rels/document.xml.rels": rels }), "k.docx");
    const hrefs = (d.blocks[0].runs ?? []).filter((r) => r.href).map((r) => [r.text, r.href]);
    expect(hrefs).toEqual([["good", "https://example.com/a"]]);
    expect(d.blocks[0].text).toContain("script");
    expect(d.blocks[0].text).toContain("local");
  });

  it("reads tables as content", () => {
    const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`;
    const d = documentFromDocx(docx(`<w:tbl><w:tr>${cell("Name")}${cell("Value")}</w:tr><w:tr>${cell("pH")}${cell("7")}</w:tr></w:tbl>`), "t.docx");
    // The Reader shows a table as preformatted rows, cells separated by a dot.
    expect(d.blocks.find((b) => b.type === "pre")?.text).toBe("Name · Value\npH · 7");
  });

  it("escapes markup in the text instead of reading it as markup", () => {
    const d = documentFromDocx(docx(para("a &lt;script&gt;alert(1)&lt;/script&gt; b")), "e.docx");
    expect(d.blocks[0].text).toBe("a <script>alert(1)</script> b");
    expect(d.blocks[0].runs?.every((r) => !r.href)).toBe(true);
  });

  it("refuses an empty document, a zip that is not Word, a damaged file and a renamed text file", () => {
    expect(() => documentFromDocx(docx(para("")), "empty.docx")).toThrow(/Nothing readable/);
    expect(() => documentFromDocx(zip({ "hello.txt": "hi" }), "x.docx")).toThrow(/not a Word document/);
    expect(() => documentFromDocx(bytes("plain text renamed to .docx"), "x.docx")).toThrow(/not a valid Word document/);
    expect(() => documentFromDocx(docx("<w:p><w:r"), "broken.docx")).toThrow(ReadError);
  });
});

/* ------------------------------------------------------------------ epub */

const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title><script>alert(1)</script></head><body>${body}</body></html>`;
const epub = (opts: { spine: string[]; chapters: Record<string, string>; manifestExtra?: string; meta?: string }) =>
  zip({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OEBPS/content.opf": `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>${opts.meta ?? "<dc:title>The Book</dc:title><dc:creator>B. Author</dc:creator><dc:date>2001-02-03</dc:date>"}</metadata><manifest>${Object.keys(opts.chapters)
      .map((k) => `<item id="${k}" href="${k}.xhtml" media-type="application/xhtml+xml"/>`)
      .join("")}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${opts.manifestExtra ?? ""}</manifest><spine>${opts.spine.map((i) => `<itemref idref="${i}"/>`).join("")}</spine></package>`,
    "OEBPS/nav.xhtml": xhtml("<nav><p>Table of contents entry that must not be read</p></nav>"),
    ...Object.fromEntries(Object.entries(opts.chapters).map(([k, v]) => [`OEBPS/${k}.xhtml`, xhtml(v)])),
  });

describe("documentFromEpub", () => {
  it("reads the chapters in spine order with the package's title and author, skipping the navigation document", () => {
    const d = documentFromEpub(epub({ spine: ["c2", "c1"], chapters: { c1: "<h1>One</h1><p>First chapter text.</p>", c2: "<h1>Two</h1><p>Second chapter text.</p>" } }), "book.epub");
    expect(d.title).toBe("The Book");
    expect(d.author).toBe("B. Author");
    expect(d.year).toBe(2001);
    expect(d.sourceLabel).toBe("book.epub");
    expect(texts(d)).toEqual(["Two", "Second chapter text.", "One", "First chapter text."]);
    expect(texts(d).join(" ")).not.toContain("Table of contents");
    expect(d.blocks.map((b) => b.id)).toEqual(["h1", "p1", "h3", "p2"]); // one clean numbering over the whole book
  });

  it("does not run scripts, and drops pictures that live inside the book", () => {
    const d = documentFromEpub(epub({ spine: ["c1"], chapters: { c1: '<p>Text.</p><figure><img src="images/a.png" alt="x"/></figure><p>More.</p>' } }), "b.epub");
    expect(texts(d)).toEqual(["Text.", "More."]);
    expect(JSON.stringify(d)).not.toContain("alert(1)");
    expect(d.blocks.some((b) => b.type === "figure")).toBe(false);
  });

  it("ignores a manifest entry that points outside the archive", () => {
    const z = epub({ spine: ["evil", "c1"], chapters: { c1: "<p>Real chapter.</p>" }, manifestExtra: '<item id="evil" href="../../etc/passwd" media-type="application/xhtml+xml"/>' });
    expect(texts(documentFromEpub(z, "b.epub"))).toEqual(["Real chapter."]);
  });

  it("names the book after the file when the package has no title", () => {
    const d = documentFromEpub(epub({ spine: ["c1"], chapters: { c1: "<p>Text.</p>" }, meta: "" }), "my_book.epub");
    expect(d.title).toBe("my book");
  });

  it("refuses a book with no chapters, a zip that is not an EPUB, and a text file renamed to .epub", () => {
    expect(() => documentFromEpub(epub({ spine: [], chapters: { c1: "<p>x</p>" } }), "b.epub")).toThrow(/no readable chapters/);
    expect(() => documentFromEpub(zip({ "a.txt": "x" }), "b.epub")).toThrow(/not an EPUB/);
    expect(() => documentFromEpub(bytes("just text"), "b.epub")).toThrow(/not a valid EPUB/);
  });
});

/* ------------------------------------------------------------------ html file */

describe("documentFromHtmlFile", () => {
  const article = (inner: string, head = "<title>Saved article</title>") =>
    `<!doctype html><html><head>${head}</head><body><nav><a href="/">home</a></nav><article><h1>Saved article</h1>${inner}</article><footer>footer noise</footer></body></html>`;
  const long = "Chalk is a soft white porous sedimentary carbonate rock composed of calcite and the shells of sea creatures. ".repeat(4);

  it("reads the article as content, titled by the page", () => {
    const d = documentFromHtmlFile(bytes(article(`<p>${long}</p><p>${long}</p>`)), "saved.html");
    expect(d.title).toBe("Saved article");
    expect(d.kind).toBe("text");
    expect(d.sourceUrl).toBeNull();
    expect(d.sourceLabel).toBe("saved.html");
    expect(d.blocks.filter((b) => b.type === "p")).toHaveLength(2);
    expect(JSON.stringify(d)).not.toContain("footer noise");
  });

  it("never keeps a script or an address that is not a web address, and drops links relative to the original site", () => {
    const html = article(`<p>${long} <a href="javascript:alert(1)">bad</a> <a href="https://example.com/ok">good</a> <a href="/relative/page">rel</a></p><script>alert(1)</script><p>${long}</p>`);
    const d = documentFromHtmlFile(bytes(html), "saved.html");
    const hrefs = d.blocks.flatMap((b) => b.runs ?? []).map((r) => r.href).filter(Boolean);
    expect(hrefs).toEqual(["https://example.com/ok"]);
    expect(JSON.stringify(d)).not.toContain("alert(1)");
    expect(JSON.stringify(d)).not.toContain("local-file.invalid");
  });

  it("uses the file name when the page has no title", () => {
    const html = `<!doctype html><html><body><article><p>${long}</p><p>${long}</p></article></body></html>`;
    expect(documentFromHtmlFile(bytes(html), "field_notes.html").title).toBe("field notes");
  });

  it("refuses a page with no readable article, and one built to be pathological", () => {
    expect(() => documentFromHtmlFile(bytes("<html><body><p>hi</p></body></html>"), "x.html")).toThrow(ReadError);
    expect(() => documentFromHtmlFile(bytes(`<html><body>${"<div>".repeat(1000)}text</body></html>`), "x.html")).toThrow(/nested too deeply/);
  });
});

/* ------------------------------------------------------------------ the pipeline */

describe("readUpload", () => {
  it("routes each kind to its importer and refuses what no importer reads", async () => {
    const ok = await readUpload("notes.md", "text/markdown", bytes("# Title\n\nA paragraph."));
    expect(ok.ok && ok.doc.title).toBe("Title");
    const word = await readUpload("a.docx", "", docx(para("Hello from Word.")));
    expect(word.ok && word.doc.blocks[0].text).toBe("Hello from Word.");
    expect(await readUpload("x.gif", "image/gif", bytes("GIF89a"))).toEqual({ ok: false, kind: "unsupported" });
    expect(await readUpload("x.doc", "application/msword", bytes("\xd0\xcf\x11\xe0"))).toEqual({ ok: false, kind: "unsupported" }); // the old binary Word format is not read
    expect(await readUpload("x.txt", "text/plain", new Uint8Array([1, 0, 2]))).toEqual({ ok: false, kind: "binary" });
  });

  it("has an importer for every readable kind", () => {
    expect(Object.keys(IMPORTERS).sort()).toEqual(["docx", "epub", "html", "pdf", "text"]);
  });
});

/* ------------------------------------------------------------------ identity */

describe("content identity", () => {
  it("compares texts by their words with spacing normalised, and keeps case", async () => {
    const { contentHash, longEnoughToCompare, MIN_DEDUP_CHARS, normalizedText } = await import("@/lib/content/hash");
    const b = (text: string) => ({ text });
    expect(await contentHash([b("A  chalk\n  cliff."), b("Second.")])).toBe(await contentHash([b("A chalk cliff."), b("Second.")]));
    expect(await contentHash([b("A chalk cliff.")])).not.toBe(await contentHash([b("a chalk cliff.")]));
    expect(await contentHash([b("A chalk cliff.")])).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizedText([b("é"), b("é")])).toBe("é\né"); // composed and combining forms are one text
    expect(longEnoughToCompare([b("x".repeat(MIN_DEDUP_CHARS - 1))])).toBe(false);
    expect(longEnoughToCompare([b("x".repeat(MIN_DEDUP_CHARS))])).toBe(true);
  });
});
