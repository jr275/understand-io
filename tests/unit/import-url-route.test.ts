// The URL import route with the network replaced by canned pages: everything after the fetch (type sniffing, decoding, article
// extraction, saving) is the real code. Saving is replaced by an echo so the result does not depend on a database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublic = vi.fn();
vi.mock("@/lib/server/safeFetch", async () => ({ ...(await vi.importActual<object>("@/lib/server/safeFetch")), fetchPublic: (...a: unknown[]) => fetchPublic(...a) }));
vi.mock("@/lib/server/reader", async () => ({ ...(await vi.importActual<object>("@/lib/server/reader")), ensureReaderId: async () => "reader-1" }));
vi.mock("@/lib/server/documents", async () => ({ ...(await vi.importActual<object>("@/lib/server/documents")), saveDocument: async (_r: string, doc: object) => ({ ...doc, persisted: false }) }));

import { POST } from "@/app/api/import/route";
import { setSharedCounter, resetRateLimits } from "@/lib/server/rateLimit";

const enc = new TextEncoder();
const CP1252: Record<string, number> = { "“": 0x93, "”": 0x94, "–": 0x96 };
/** The bytes a windows-1252 / ISO-8859-1 page would hold for this text. */
const latin1 = (s: string) => Uint8Array.from(Array.from(s).map((c) => CP1252[c] ?? c.charCodeAt(0) & 255));
const page = (status: number, type: string, body: Uint8Array | string, finalUrl = "https://news.example/2026/chalk") => ({
  res: { ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": type }) },
  body: typeof body === "string" ? enc.encode(body) : body,
  finalUrl,
});
const post = (url: string, extra: Record<string, unknown> = {}) =>
  POST(new Request("http://x.test/api/import", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" }, body: JSON.stringify({ url, ...extra }) }));

const P1 = "Chalk is a soft white porous sedimentary rock, a form of limestone made of the mineral calcite, laid down over millions of years.";
const P2 = "Under the microscope the rock turns out to be built from the shells of tiny creatures that once drifted in a warm and shallow sea.";
const P3 = "That is why a lecture to working men about a piece of chalk can tell the history of a whole country, and of the earth beneath it.";
const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>On a piece of chalk | The Daily Example</title>
<meta name="author" content="T. H. Huxley"><meta property="og:site_name" content="The Daily Example"></head><body>
<header><nav><a href="/">Home</a> <a href="/subscribe">Subscribe now for unlimited access</a></nav></header>
<main><article><h1>On a piece of chalk</h1><p>${P1}</p><p>${P2}</p><p>${P3}</p></article>
<aside><h3>Related</h3><p>You may also like: ten things about rocks you will not believe.</p></aside></main>
<footer><p>© 2026 The Daily Example. Privacy policy. Terms of use. Cookie settings.</p></footer></body></html>`;

beforeEach(() => {
  fetchPublic.mockReset();
  setSharedCounter(null);
  resetRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("importing a link", () => {
  it("reads the article: its paragraphs in order, its title and author, its source; the menu, sidebar and footer are left out", async () => {
    fetchPublic.mockResolvedValue(page(200, "text/html; charset=utf-8", ARTICLE));
    const res = await post("https://news.example/2026/chalk");
    expect(res.status).toBe(200);
    const { document: doc } = await res.json();
    const texts = doc.blocks.map((b: { text: string }) => b.text);
    expect(texts).toEqual(expect.arrayContaining([P1, P2, P3]));
    expect(texts.indexOf(P1)).toBeLessThan(texts.indexOf(P2));
    expect(texts.indexOf(P2)).toBeLessThan(texts.indexOf(P3));
    const all = texts.join("\n");
    expect(all).not.toMatch(/Subscribe now|Privacy policy|Cookie settings|You may also like|Home/);
    expect(doc.title).toBe("On a piece of chalk");
    expect(doc.author).toBe("T. H. Huxley");
    expect(doc.sourceUrl).toBe("https://news.example/2026/chalk");
    expect(doc.kind).toBe("url");
  });

  it("reads a page in ISO-8859-1 by its declared charset: the accents survive", async () => {
    const html = `<html><head><title>Educação</title></head><body><article><h1>Educação para todos</h1><p>A educação é a base de um país: ação, coração, João e a pequena aldeia de Évora. ${P1}</p><p>${P2}</p></article></body></html>`;
    fetchPublic.mockResolvedValue(page(200, "text/html; charset=iso-8859-1", latin1(html)));
    const { document: doc } = await (await post("https://noticias.example/educacao")).json();
    const all = [doc.title, ...doc.blocks.map((b: { text: string }) => b.text)].join("\n");
    expect(all).toContain("Educação para todos");
    expect(all).toContain("ação, coração, João e a pequena aldeia de Évora");
    expect(all).not.toContain("�");
  });

  it("reads a page that names its own charset (windows-1252) and keeps its curly quotes and dashes", async () => {
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>Aspas</title></head><body><article><h1>Aspas</h1><p>“Aspas curvas” – e travessões – funcionam. ${P1}</p><p>${P2}</p></article></body></html>`;
    fetchPublic.mockResolvedValue(page(200, "text/html", latin1(html)));
    const { document: doc } = await (await post("https://velho.example/aspas")).json();
    const all = doc.blocks.map((b: { text: string }) => b.text).join("\n");
    expect(all).toContain("“Aspas curvas” – e travessões – funcionam.");
    expect(all).not.toContain("�");
  });

  it("reads UTF-8 with no declaration at all, other scripts and emoji included", async () => {
    const html = `<html><body><article><h1>日本語の記事</h1><p>これは日本語の段落です。🌍 ${P1}</p><p>${P2}</p></article></body></html>`;
    fetchPublic.mockResolvedValue(page(200, "text/html", html));
    const { document: doc } = await (await post("https://jp.example/a")).json();
    expect(doc.blocks.map((b: { text: string }) => b.text).join("\n")).toContain("これは日本語の段落です。🌍");
  });

  it("reads a plain-text link in a legacy charset too", async () => {
    fetchPublic.mockResolvedValue(page(200, "text/plain; charset=iso-8859-1", latin1(`Título\n\nPrimeiro parágrafo com ação e coração. ${P1}\n\nSegundo parágrafo. ${P2}`), "https://texts.example/livro.txt"));
    const { document: doc } = await (await post("https://texts.example/livro.txt")).json();
    expect(doc.blocks.map((b: { text: string }) => b.text).join("\n")).toContain("Primeiro parágrafo com ação e coração.");
  });

  it("says plainly why a page could not be read: paywall, blocked, gone, down, not a page", async () => {
    const cases: [number, string, RegExp][] = [
      [402, "text/html", /payment or a subscription/],
      [403, "text/html", /blocks readers like this one/],
      [404, "text/html", /no longer exists/],
      [503, "text/html", /having trouble/],
    ];
    for (const [status, type, message] of cases) {
      fetchPublic.mockResolvedValue(page(status, type, "x"));
      const res = await post("https://site.example/a");
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await res.json()).error).toMatch(message);
    }
    fetchPublic.mockResolvedValue(page(200, "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    const res = await post("https://site.example/pic.png");
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/not a web page, a PDF or plain text/);
  });

  it("says there is no article when a page has none, instead of saving an empty document", async () => {
    fetchPublic.mockResolvedValue(page(200, "text/html; charset=utf-8", "<html><body><div id='app'></div><script>window.x=1</script></body></html>"));
    const res = await post("https://app.example/");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/\S/);
  });
});
