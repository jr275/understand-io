import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Block, GlossDocument, Run } from "./types";
import { ReadError } from "./errors";
import { HTML_LIMITS, measureHtml } from "./limits";
import { finishBlocks } from "./text";
import { readingMinutes, slugFor } from "./slug";

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "FIGURE", "TABLE"]);

function runsFromNode(node: Node, inherit: Partial<Run> = {}): Run[] {
  const out: Run[] = [];
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      const t = (c.textContent ?? "").replace(/\s+/g, " ");
      if (t) out.push({ ...inherit, text: t });
      return;
    }
    if (c.nodeType !== 1) return;
    const el = c as Element;
    const tag = el.tagName;
    if (tag === "BR") {
      out.push({ ...inherit, text: "\n" });
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "IFRAME" || tag === "SVG") return;
    const next = { ...inherit };
    if (tag === "EM" || tag === "I" || tag === "CITE") next.em = true;
    if (tag === "STRONG" || tag === "B") next.strong = true;
    if (tag === "CODE" || tag === "KBD") next.code = true;
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (href && /^https?:/.test(href)) next.href = href;
    }
    const inner = runsFromNode(el, next);
    // Block-level children inside an inline container act as paragraph breaks.
    if (BLOCK_TAGS.has(tag) || tag === "DIV" || tag === "SECTION" || tag === "TR") {
      out.push({ ...inherit, text: "\n\n" });
      out.push(...inner);
      out.push({ ...inherit, text: "\n\n" });
    } else out.push(...inner);
  });
  return mergeRuns(out);
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && prev.em === r.em && prev.strong === r.strong && prev.code === r.code && prev.href === r.href) prev.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** Split runs on blank lines into paragraphs, trimming each. */
function splitRuns(runs: Run[]): Run[][] {
  const paras: Run[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split(/\n\s*\n/);
    parts.forEach((part, i) => {
      if (i > 0) paras.push([]);
      const t = part.replace(/\n/g, " ");
      if (t) paras[paras.length - 1].push({ ...r, text: t });
    });
  }
  return paras.map(trimRuns).filter((p) => p.some((r) => r.text.trim()));
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") }));
  if (!out.length) return out;
  out[0].text = out[0].text.replace(/^\s+/, "");
  out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  return out.filter((r) => r.text.length);
}

function hasBlockDescendant(el: Element) {
  return !!el.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figure,table,div,section,article");
}

/** Walk a Readability article and emit reading blocks. */
export function blocksFromArticleHtml(html: string, baseUrl?: string): Block[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const raw: Omit<Block, "n" | "text" | "id">[] = [];
  const pushRuns = (type: Block["type"], runs: Run[], extra: Partial<Block> = {}) => {
    for (const part of splitRuns(runs)) raw.push({ type, runs: part, ...extra });
  };
  const push = (type: Block["type"], el: Element, extra: Partial<Block> = {}) => pushRuns(type, runsFromNode(el), extra);
  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
      if (tag === "FIGURE" || tag === "IMG" || tag === "PICTURE") {
        const img = tag === "IMG" ? el : el.querySelector("img");
        const src = img?.getAttribute("src") || img?.getAttribute("data-src");
        if (src && !/^data:/.test(src)) {
          const cap = el.querySelector("figcaption");
          const runs = cap ? trimRuns(runsFromNode(cap)) : [];
          raw.push({ type: "figure", runs, src: absolute(src, baseUrl), alt: img?.getAttribute("alt") ?? undefined });
        }
        continue;
      }
      if (tag === "H1" || tag === "H2") push("h2", el);
      else if (/^H[3-6]$/.test(tag)) push("h3", el);
      else if (tag === "UL" || tag === "OL") Array.from(el.children).forEach((li) => (hasBlockDescendant(li) ? walk(li) : push("li", li)));
      else if (tag === "LI") push("li", el);
      else if (tag === "BLOCKQUOTE") {
        const ps = el.querySelectorAll("p");
        if (ps.length) ps.forEach((p) => push("quote", p));
        else push("quote", el);
      } else if (tag === "PRE") raw.push({ type: "pre", runs: [{ text: (el.textContent ?? "").replace(/^\n+|\s+$/g, "") }] });
      else if (tag === "TABLE") {
        const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.querySelectorAll("th,td"))
            .map((c) => c.textContent?.trim() ?? "")
            .join(" · "),
        );
        if (rows.join("").trim()) raw.push({ type: "pre", runs: [{ text: rows.join("\n") }] });
      } else if (tag === "P") push("p", el);
      else if (hasBlockDescendant(el)) walk(el);
      else push("p", el);
    }
  };
  walk(document.body);
  return finishBlocks(raw.filter((b) => b.type === "figure" || (b.runs ?? []).some((r) => r.text.trim())));
}

function absolute(src: string, base?: string) {
  try {
    return base ? new URL(src, base).toString() : src;
  } catch {
    return src;
  }
}

export interface Extracted {
  title: string;
  author: string | null;
  dek: string | null;
  siteName: string | null;
  published: string | null;
  blocks: Block[];
}

/** HTML page → article blocks using Readability. Throws when no readable article is found. */
export function extractArticle(html: string, url: string): Extracted {
  // linkedom and Readability are synchronous: refuse pages built to keep them busy before parsing anything.
  if (html.length > HTML_LIMITS.chars) throw new ReadError("That page is too large to read here (over 4 MB of HTML). Paste its text instead.");
  const m = measureHtml(html);
  if (!m.ok) throw new ReadError(m.reason === "depth" ? "That page is nested too deeply to read here. Paste its text instead." : "That page has too many elements to read here. Paste its text instead.");
  const { document } = parseHTML(html);
  // linkedom lacks a few APIs Readability probes for.
  const doc = document as unknown as Document;
  const reader = new Readability(doc, { keepClasses: false, maxElemsToParse: HTML_LIMITS.elements * 2 });
  const article = reader.parse();
  if (!article || !article.content) throw new ReadError("Could not find a readable article on that page.");
  const blocks = blocksFromArticleHtml(article.content, url);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (!blocks.length || chars < 200) throw new ReadError("The page had no readable paragraphs.");
  return {
    title: (article.title || new URL(url).hostname).trim(),
    author: article.byline?.replace(/^by\s+/i, "").trim() || null,
    dek: article.excerpt?.trim() || null,
    siteName: article.siteName || null,
    published: article.publishedTime || null,
    blocks,
  };
}

export function documentFromExtracted(x: Extracted, url: string): GlossDocument {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const year = x.published ? new Date(x.published).getFullYear() : null;
  return {
    slug: slugFor(x.title),
    kind: "url",
    title: x.title,
    author: x.author,
    dek: x.dek,
    year: year && !Number.isNaN(year) ? year : null,
    sourceUrl: url,
    sourceLabel: x.siteName || host,
    topic: "unsorted",
    minutes: readingMinutes(x.blocks),
    paragraphs: x.blocks.filter((b) => b.n).length,
    blocks: x.blocks,
  };
}
