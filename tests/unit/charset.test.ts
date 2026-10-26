import { describe, expect, it } from "vitest";
import { declaredCharset, decodeBytes, decodeWindows1252, metaCharset } from "@/lib/content/charset";

/** The bytes a windows-1252 file would hold for this text (Latin-1 letters as themselves; the curly quotes, dashes and euro in the 0x80 block). */
const CP1252: Record<string, number> = { "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };
const latin1 = (s: string) => Uint8Array.from(Array.from(s).map((c) => CP1252[c] ?? c.charCodeAt(0) & 255));
const utf8 = (s: string) => new TextEncoder().encode(s);
const TEXT = "Educação é a base: ação, coração, João e a pequena “aldeia” — 100%.";

describe("decodeBytes", () => {
  it("reads UTF-8 with no declaration", () => {
    expect(decodeBytes(utf8(TEXT))).toBe(TEXT);
    expect(decodeBytes(utf8("日本語のテキスト 🌍"))).toBe("日本語のテキスト 🌍");
  });
  it("strips a UTF-8 byte-order mark and reads UTF-16 by its mark", () => {
    expect(decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("olá")]))).toBe("olá");
    const le = Uint8Array.from([0xff, 0xfe, ...Array.from("olá").flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeBytes(le)).toBe("olá");
  });
  it("follows the charset the server declared", () => {
    expect(decodeBytes(latin1("Educação é a base"), { contentType: "text/html; charset=ISO-8859-1" })).toBe("Educação é a base");
    expect(decodeBytes(latin1("Educação"), { contentType: 'text/plain; charset="windows-1252"' })).toBe("Educação");
  });
  it("follows the charset a page declares about itself, in either meta form", () => {
    const a = latin1('<html><head><meta charset="iso-8859-1"><title>Ação</title></head><body>coração “aspas”</body></html>');
    expect(decodeBytes(a, { html: true })).toContain("coração “aspas”");
    const b = latin1('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body>“aspas” – traço</body></html>');
    expect(decodeBytes(b, { html: true })).toContain("“aspas” – traço");
  });
  it("lets the server's declaration win over the page's", () => {
    const page = utf8('<meta charset="iso-8859-1"><p>ação</p>');
    expect(decodeBytes(page, { html: true, contentType: "text/html; charset=utf-8" })).toContain("ação");
  });
  it("without any declaration, bytes that are not valid UTF-8 are read as windows-1252, not turned into replacement characters", () => {
    expect(decodeBytes(latin1("Educação, “texto” e João – 5€"))).toBe("Educação, “texto” e João – 5€");
    expect(decodeBytes(latin1("Educação e João"))).not.toContain("\uFFFD");
  });
  it("ignores a charset name it does not know and still reads the text", () => {
    expect(decodeBytes(utf8(TEXT), { contentType: "text/html; charset=klingon" })).toBe(TEXT);
  });
  it("does not look for a meta tag in text that is not a page", () => {
    expect(decodeBytes(utf8('<meta charset="iso-8859-1"> ação'))).toBe('<meta charset="iso-8859-1"> ação');
  });
});

describe("decodeWindows1252", () => {
  it("maps the 0x80 block to the characters pages of this kind use, not to control characters", () => {
    expect(decodeWindows1252(Uint8Array.from([0x80, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x99, 0xe7, 0xe3]))).toBe("€‘’“”•–—™çã");
    expect(decodeWindows1252(Uint8Array.from([0x41, 0x7f, 0xff]))).toBe("A\u007fÿ");
  });
  it("copes with a large file", () => {
    expect(decodeWindows1252(new Uint8Array(5_000_000).fill(0x93)).length).toBe(5_000_000);
  });
});

describe("declaredCharset and metaCharset", () => {
  it("find the names", () => {
    expect(declaredCharset("text/html; charset=UTF-8")).toBe("UTF-8");
    expect(declaredCharset("text/html")).toBeNull();
    expect(declaredCharset(null)).toBeNull();
    expect(metaCharset(utf8("<META CHARSET=Shift_JIS>"))).toBe("Shift_JIS");
    expect(metaCharset(utf8("<p>no tag</p>"))).toBeNull();
  });
});

describe("uploaded files in a legacy charset", () => {
  it("a Windows text file keeps its accents and curly quotes", async () => {
    const { IMPORTERS } = await import("@/lib/content/importers");
    const body = "Título\n\nPrimeiro parágrafo: ação, coração e “aspas” – com um travessão. ".repeat(3);
    const doc = await IMPORTERS.text.read(latin1(body), "livro.txt");
    const all = doc.blocks.map((b) => b.text).join("\n");
    expect(all).toContain("ação, coração e “aspas” – com um travessão.");
    expect(all).not.toContain("�");
  });
  it("a saved web page that names its charset is read in it", async () => {
    const { documentFromHtmlFile } = await import("@/lib/content/importers/htmlFile");
    const para = "A educação é a base de um país: ação, coração, João e a aldeia de Évora, onde “tudo” começou – dizem. ".repeat(2);
    const html = `<html><head><meta charset="windows-1252"><title>Educação</title></head><body><article><h1>Educação</h1><p>${para}</p><p>${para}</p></article></body></html>`;
    const doc = documentFromHtmlFile(latin1(html), "pagina.html");
    const all = [doc.title, ...doc.blocks.map((b) => b.text)].join("\n");
    expect(all).toContain("ação, coração, João e a aldeia de Évora, onde “tudo” começou – dizem.");
    expect(all).not.toContain("�");
  });
});
