import { DOMParser, parseHTML } from "linkedom";
import { ReadError } from "../errors";
import { blocksFromArticleHtml } from "../extract";
import { HTML_LIMITS, measureHtml } from "../limits";
import { entryText, readZip } from "../zip";
import type { Block, GlossDocument } from "../types";
import { IMPORT_MAX_CHARS, documentFromParts, titleFromFileName, withoutLocalFigures } from "./common";

const WHAT = "EPUB book";
/** Only the package files and the chapter documents are inflated; images, fonts and styles are skipped without being read. */
const wanted = (name: string) => name === "META-INF/container.xml" || /\.(opf|xhtml|html|htm)$/i.test(name);
/** The most chapters read from one book, so a book of thousands of tiny parts cannot hold the server. */
const MAX_CHAPTERS = 1500;

const parseXml = (xml: string): Element => new DOMParser().parseFromString(xml, "text/xml").documentElement as unknown as Element;
const text = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** `base/dir` + a relative `href` with `..` and `%20` resolved; never leaves the archive (a path above the root is dropped). */
function resolvePath(dir: string, href: string): string | null {
  let clean: string;
  try {
    clean = decodeURIComponent(href.split("#")[0]);
  } catch {
    return null;
  }
  const parts = (clean.startsWith("/") ? clean.slice(1) : `${dir}${clean}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join("/");
}

/** An EPUB → a document: the chapters in reading order, headings and paragraphs kept. Images, styles and scripts are dropped. */
export function documentFromEpub(bytes: Uint8Array, fileName: string): GlossDocument {
  const files = readZip(bytes, wanted, WHAT);
  const container = entryText(files, "META-INF/container.xml");
  if (!container) throw new ReadError("That file is not an EPUB book.");
  const rootfile = Array.from(parseXml(container).getElementsByTagName("rootfile"))[0];
  const opfPath = resolvePath("", rootfile?.getAttribute("full-path") ?? "");
  const opfXml = opfPath ? entryText(files, opfPath) : null;
  if (!opfPath || !opfXml) throw new ReadError("That EPUB has no readable package and cannot be opened.");
  const opf = parseXml(opfXml);
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifest = new Map<string, { href: string; nav: boolean }>();
  for (const it of Array.from(opf.getElementsByTagName("item"))) {
    manifest.set(it.getAttribute("id") ?? "", { href: it.getAttribute("href") ?? "", nav: /\bnav\b/.test(it.getAttribute("properties") ?? "") });
  }
  const order: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName("itemref"))) {
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (!item || item.nav || ref.getAttribute("linear") === "no") continue;
    const path = resolvePath(dir, item.href);
    if (path && files.has(path)) order.push(path);
  }
  if (!order.length) throw new ReadError("That EPUB has no readable chapters.");

  let blocks: Block[] = [];
  let chars = 0;
  for (const path of order.slice(0, MAX_CHAPTERS)) {
    const xhtml = entryText(files, path) ?? "";
    if (xhtml.length > HTML_LIMITS.chars || !measureHtml(xhtml).ok) continue; // a chapter built to be pathological is skipped, not the book
    const body = parseHTML(xhtml).document.body;
    if (!body) continue;
    const part = withoutLocalFigures(blocksFromArticleHtml(body.innerHTML));
    chars += part.reduce((n, b) => n + b.text.length, 0);
    if (chars > IMPORT_MAX_CHARS) throw new ReadError("That book holds more text than can be read here (over 3 million characters).");
    blocks = blocks.concat(part);
  }

  const meta = (tag: string) => text(Array.from(opf.getElementsByTagName(tag))[0]);
  const year = Number(meta("dc:date").slice(0, 4));
  return documentFromParts({
    title: meta("dc:title") || titleFromFileName(fileName),
    author: meta("dc:creator") || null,
    year: Number.isFinite(year) ? year : null,
    blocks,
    sourceLabel: fileName,
  });
}
