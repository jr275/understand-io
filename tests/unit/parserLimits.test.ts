// SEC-5: untrusted pages and PDFs must be refused quickly and cleanly instead of blocking (or crashing) the server process.
// Measured before the limits existed (same machine, Node 24): a 25 KB page nested 5,000 deep ran for more than 60 s;
// 10 MB of <p> took 18 s and 10 MB of <a><br> 44 s inside extractArticle; a 30,000-page PDF (10 MB of one-line pages) ran the process out of heap.
import { afterEach, describe, expect, it } from "vitest";
import { extractArticle } from "@/lib/content/extract";
import { ReadError } from "@/lib/content/errors";
import { HTML_LIMITS, PDF_LIMITS, measureHtml } from "@/lib/content/limits";
import { documentFromPdf } from "@/lib/content/pdf";

function timed<T>(fn: () => T): { out: T | Error; ms: number } {
  const t = performance.now();
  let out: T | Error;
  try {
    out = fn();
  } catch (e) {
    out = e as Error;
  }
  return { out, ms: performance.now() - t };
}

const url = "https://example.org/x";

describe("HTML limits", () => {
  const worst: Record<string, string> = {
    "25 KB nested 5,000 deep": `<html><body>${"<div>".repeat(5000)}x${"</div>".repeat(5000)}</body></html>`,
    "10 MB of <p>": `<html><body><article>${"<p>x</p>".repeat(1_250_000)}</article></body></html>`,
    "10 MB of <a><br>": `<html><body><div>${"<a href=x>a</a><br>".repeat(550_000)}</div></body></html>`,
    "100,000 elements in 1 MB": `<html><body>${"<i></i>".repeat(100_000)}</body></html>`,
    "20 MB of nested <div><div><span>": `<html><body>${"<div><div><span>".repeat(650_000)}text${"</span></div></div>".repeat(650_000)}</body></html>`,
  };
  for (const [name, html] of Object.entries(worst)) {
    it(`rejects ${name} in well under a second with a message for the reader`, () => {
      const { out, ms } = timed(() => extractArticle(html, url));
      expect(out).toBeInstanceOf(ReadError);
      expect((out as Error).message).toMatch(/too (large|many)|nested too deeply/);
      expect(ms).toBeLessThan(500);
    });
  }

  it("still reads a normal article, and one near the element cap without a blow-up in time", () => {
    const para = "<p>Chalk is a soft white porous sedimentary carbonate rock composed of calcite and the shells of sea creatures.</p>";
    const normal = `<html><head><title>Chalk</title></head><body><nav><a href=/>home</a></nav><article><h1>Chalk</h1>${para.repeat(40)}</article><script>if (a<b && c>d) { document.write("<div><div><div>"); }</script></body></html>`;
    expect(extractArticle(normal, url).blocks.length).toBeGreaterThanOrEqual(40);
    const big = `<html><body><article>${"<p>Chalk is a soft white rock.</p>".repeat(Math.floor(HTML_LIMITS.elements * 0.95))}</article></body></html>`;
    const { out, ms } = timed(() => extractArticle(big, url));
    expect(out).not.toBeInstanceOf(Error);
    // Measured about 0.7 s on an idle machine and up to 3.6 s while the machine was busy. The bound exists to catch a blow-up
    // (a quadratic pass over 550,000 elements takes minutes), not to time the parser.
    expect(ms).toBeLessThan(10_000);
  });

  it("does not count text inside script/style, comments or quoted attributes as markup", () => {
    const trap = `<!-- ${"<div>".repeat(1000)} --><script>${"<div>".repeat(1000)}</script><style>${"<p>".repeat(1000)}</style><a title="${"<div>".repeat(1000)}" href="/x">x</a>`;
    expect(measureHtml(trap)).toMatchObject({ ok: true, elements: 3, depth: 1 });
  });
  it("does not let optional end tags inflate depth", () => {
    expect(measureHtml(`<ul>${"<li>item".repeat(5000)}</ul>`)).toMatchObject({ ok: true, depth: 1 });
    expect(measureHtml(`<table>${"<tr><td>a<td>b".repeat(3000)}</table>`)).toMatchObject({ ok: true, depth: 1 });
  });
  it("reports which limit tripped", () => {
    expect(measureHtml("<div>".repeat(300), 10_000, 200)).toMatchObject({ ok: false, reason: "depth" });
    expect(measureHtml("<i></i>".repeat(300), 100, 200)).toMatchObject({ ok: false, reason: "elements" });
  });
});

/** A valid minimal PDF with `pages` one-line pages and a correct xref table. */
function makePdf(pages: number): Uint8Array {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pages; i++) {
    const no = 4 + i * 2;
    const stream = `BT /F1 12 Tf 72 720 Td (Chalk is a soft white porous sedimentary carbonate rock. Page ${i + 1}.) Tj ET`;
    objs[no] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${no + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[no + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("PDF limits", () => {
  const saved = { ...PDF_LIMITS };
  afterEach(() => Object.assign(PDF_LIMITS, saved));

  it("reads a normal PDF", async () => {
    const d = await documentFromPdf(makePdf(20), "chalk.pdf");
    expect(d.blocks.length).toBe(20);
  });
  it("refuses a PDF over the page cap before extracting any text (30,000 pages used to exhaust the heap)", async () => {
    const t = performance.now();
    const err = await documentFromPdf(makePdf(30_000), "huge.pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadError);
    expect((err as Error).message).toMatch(/30000 pages; the limit is 500/);
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it("gives up after the time limit and says so", async () => {
    PDF_LIMITS.ms = 1;
    const err = await documentFromPdf(makePdf(400), "slow.pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadError);
    expect((err as Error).message).toMatch(/took too long/);
  });
  it("turns pdf.js internals into a plain message", async () => {
    const err = await documentFromPdf(new TextEncoder().encode("%PDF-1.4 this is not a pdf"), "bad.pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadError);
    expect((err as Error).message).toMatch(/could not be opened/);
  });
});
