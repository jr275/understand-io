import { DOMParser } from "linkedom";
import { ReadError } from "../errors";
import { blocksFromArticleHtml } from "../extract";
import { entryText, readZip } from "../zip";
import type { GlossDocument } from "../types";
import { documentFromParts, titleFromFileName, withoutLocalFigures } from "./common";

const WHAT = "Word document (.docx)";
const NEED = new Set(["word/document.xml", "word/_rels/document.xml.rels", "word/numbering.xml", "word/styles.xml", "docProps/core.xml", "[Content_Types].xml"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const parseXml = (xml: string): Element => new DOMParser().parseFromString(xml, "text/xml").documentElement as unknown as Element;
const kids = (el: Element): Element[] => Array.from(el.children);
const named = (el: Element, name: string) => kids(el).find((c) => c.nodeName === name);
const val = (el: Element | undefined, attr = "w:val") => el?.getAttribute(attr) ?? null;
/** `<w:b/>` is on; `<w:b w:val="0"/>` and `"false"` are off. */
const on = (el: Element | undefined) => !!el && !["0", "false", "off"].includes((val(el) ?? "").toLowerCase());

interface Style {
  name: string;
  outline: number | null;
}

function readStyles(xml: string | null): Map<string, Style> {
  const out = new Map<string, Style>();
  if (!xml) return out;
  for (const s of kids(parseXml(xml))) {
    if (s.nodeName !== "w:style") continue;
    const id = s.getAttribute("w:styleId");
    if (!id) continue;
    const outline = val(named(named(s, "w:pPr") ?? s, "w:outlineLvl"));
    out.set(id, { name: (val(named(s, "w:name")) ?? "").toLowerCase(), outline: outline !== null && /^\d$/.test(outline) ? Number(outline) : null });
  }
  return out;
}

/** numId → per-level "ordered or not", read from numbering.xml; a list the file does not describe counts as bulleted. */
function readNumbering(xml: string | null): Map<string, (level: number) => boolean> {
  const out = new Map<string, (level: number) => boolean>();
  if (!xml) return out;
  const root = parseXml(xml);
  const abstracts = new Map<string, Map<number, boolean>>();
  for (const a of kids(root)) {
    if (a.nodeName !== "w:abstractNum") continue;
    const levels = new Map<number, boolean>();
    for (const l of kids(a)) {
      if (l.nodeName !== "w:lvl") continue;
      levels.set(Number(l.getAttribute("w:ilvl") ?? 0), val(named(l, "w:numFmt")) !== "bullet");
    }
    abstracts.set(a.getAttribute("w:abstractNumId") ?? "", levels);
  }
  for (const n of kids(root)) {
    if (n.nodeName !== "w:num") continue;
    const levels = abstracts.get(val(named(n, "w:abstractNumId")) ?? "");
    out.set(n.getAttribute("w:numId") ?? "", (level) => levels?.get(level) ?? false);
  }
  return out;
}

function readRelationships(xml: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const r of kids(parseXml(xml))) {
    // Only web addresses are kept as links: nothing else in a Word file may become a clickable address.
    if (r.getAttribute("TargetMode") === "External" && /^https?:\/\//i.test(r.getAttribute("Target") ?? "")) out.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "");
  }
  return out;
}

function runHtml(r: Element): string {
  const pr = named(r, "w:rPr");
  let text = "";
  for (const c of kids(r)) {
    if (c.nodeName === "w:t") text += esc(c.textContent ?? "");
    else if (c.nodeName === "w:tab") text += "\t";
    else if (c.nodeName === "w:br" || c.nodeName === "w:cr") text += "<br>";
    else if (c.nodeName === "w:noBreakHyphen") text += "-";
    // w:delText (deleted by a tracked change), field codes and drawings add nothing to the text a reader sees.
  }
  if (!text) return "";
  if (on(named(pr ?? r, "w:i"))) text = `<em>${text}</em>`;
  if (on(named(pr ?? r, "w:b"))) text = `<strong>${text}</strong>`;
  return text;
}

function inlineHtml(parent: Element, links: Map<string, string>): string {
  let out = "";
  for (const c of kids(parent)) {
    switch (c.nodeName) {
      case "w:r":
        out += runHtml(c);
        break;
      case "w:hyperlink": {
        const inner = inlineHtml(c, links);
        const href = links.get(c.getAttribute("r:id") ?? "");
        out += href && inner ? `<a href="${esc(href)}">${inner}</a>` : inner;
        break;
      }
      case "w:ins":
      case "w:smartTag":
      case "w:fldSimple":
        out += inlineHtml(c, links);
        break;
      case "w:sdt": {
        const content = named(c, "w:sdtContent");
        if (content) out += inlineHtml(content, links);
        break;
      }
      // w:del (a tracked deletion) is skipped.
    }
  }
  return out;
}

interface Ctx {
  styles: Map<string, Style>;
  numbering: Map<string, (level: number) => boolean>;
  links: Map<string, string>;
}

function headingLevel(p: Element, styles: Map<string, Style>): number | null {
  const pr = named(p, "w:pPr");
  const style = styles.get(val(named(pr ?? p, "w:pStyle")) ?? "");
  const direct = val(named(pr ?? p, "w:outlineLvl"));
  const name = style?.name ?? "";
  const m = /^heading\s*(\d)/.exec(name);
  if (m) return Math.min(6, Number(m[1]));
  if (name === "title") return 1;
  if (direct !== null && /^\d$/.test(direct) && Number(direct) < 6) return Number(direct) + 1;
  if (style?.outline !== null && style?.outline !== undefined && style.outline < 6) return style.outline + 1;
  return null;
}

function blocksHtml(parent: Element, ctx: Ctx): string {
  let html = "";
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (list) html += `<${list.ordered ? "ol" : "ul"}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.ordered ? "ol" : "ul"}>`;
    list = null;
  };
  for (const el of kids(parent)) {
    if (el.nodeName === "w:sdt") {
      const content = named(el, "w:sdtContent");
      if (content) {
        flush();
        html += blocksHtml(content, ctx);
      }
      continue;
    }
    if (el.nodeName === "w:tbl") {
      flush();
      const rows = kids(el)
        .filter((r) => r.nodeName === "w:tr")
        .map((r) => `<tr>${kids(r).filter((c) => c.nodeName === "w:tc").map((c) => `<td>${blocksHtml(c, ctx)}</td>`).join("")}</tr>`)
        .join("");
      if (rows) html += `<table>${rows}</table>`;
      continue;
    }
    if (el.nodeName !== "w:p") continue;
    const inner = inlineHtml(el, ctx.links);
    if (!inner.replace(/<[^>]*>|\s|&nbsp;/g, "")) continue; // an empty paragraph is spacing, not content
    const pr = named(el, "w:pPr");
    const level = headingLevel(el, ctx.styles);
    if (level) {
      flush();
      html += `<h${level}>${inner.replace(/<\/?(strong|em)>/g, "")}</h${level}>`;
      continue;
    }
    const num = named(pr ?? el, "w:numPr");
    const numId = val(named(num ?? el, "w:numId"));
    const styleName = ctx.styles.get(val(named(pr ?? el, "w:pStyle")) ?? "")?.name ?? "";
    if ((num && numId && numId !== "0") || /^list\s*(bullet|number|paragraph)/.test(styleName)) {
      const ordered = numId ? (ctx.numbering.get(numId)?.(Number(val(named(num ?? el, "w:ilvl")) ?? 0)) ?? false) : /number/.test(styleName);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(inner);
      continue;
    }
    flush();
    html += `<p>${inner}</p>`;
  }
  flush();
  return html;
}

/** A Word (.docx) file → a document. Text, headings, lists, tables, emphasis and web links are kept; images, footnotes, headers and comments are not. */
export function documentFromDocx(bytes: Uint8Array, fileName: string): GlossDocument {
  const files = readZip(bytes, (n) => NEED.has(n), WHAT);
  const documentXml = entryText(files, "word/document.xml");
  if (!documentXml || !/wordprocessingml/.test(entryText(files, "[Content_Types].xml") ?? "")) throw new ReadError("That file is not a Word document (.docx).");
  let root: Element;
  try {
    root = parseXml(documentXml);
  } catch {
    throw new ReadError("That Word document is damaged and could not be read.");
  }
  const body = named(root, "w:body");
  if (!body) throw new ReadError("That Word document has no text.");
  const ctx: Ctx = {
    styles: readStyles(entryText(files, "word/styles.xml")),
    numbering: readNumbering(entryText(files, "word/numbering.xml")),
    links: readRelationships(entryText(files, "word/_rels/document.xml.rels")),
  };
  let blocks = withoutLocalFigures(blocksFromArticleHtml(blocksHtml(body, ctx)));

  const core = entryText(files, "docProps/core.xml");
  let title = "";
  let author: string | null = null;
  let year: number | null = null;
  if (core) {
    const props = parseXml(core);
    const text = (name: string) => named(props, name)?.textContent?.trim() ?? "";
    title = text("dc:title");
    author = text("dc:creator") || null;
    const created = Number(text("dcterms:created").slice(0, 4));
    year = Number.isFinite(created) && created > 1900 ? created : null;
  }
  if (!title && blocks[0]?.type === "h2") {
    title = blocks[0].text;
    blocks = blocks.slice(1);
  }
  return documentFromParts({ title: title || titleFromFileName(fileName), author, year, blocks, sourceLabel: fileName });
}
