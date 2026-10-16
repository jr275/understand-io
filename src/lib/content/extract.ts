import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Block, GlossDocument, Run } from "./types";
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
      out.push({ ...inherit, text: " " });
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "SUP" && /^\[?\d+\]?$/.test(el.textContent?.trim() ?? "x") === false && false) return;
    const next = { ...inherit };
    if (tag === "EM" || tag === "I" || tag === "CITE") next.em = true;
    if (tag === "STRONG" || tag === "B") next.strong = true;
    if (tag === "CODE" || tag === "KBD") next.code = true;
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (href && /^https?:/.test(href)) next.href = href;
    }
    out.push(...runsFromNode(el, next));
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
  return out.map((r) => ({ ...r, text: r.text }));
}

function trimRuns(runs: Run[]): Run[] {
  if (!runs.length) return runs;
  runs[0].text = runs[0].text.replace(/^\s+/, "");
  runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  return runs.filter((r) => r.text.length);
}

/** Walk a Readability article and emit reading blocks. */
export function blocksFromArticleHtml(html: string, baseUrl?: string): Block[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const raw: Omit<Block, "n" | "text" | "id">[] = [];
  const push = (type: Block["type"], el: Element, extra: Partial<Block> = {}) => {
    const runs = trimRuns(runsFromNode(el));
    const text = runs.map((r) => r.text).join("").trim();
    if (!text && type !== "figure") return;
    raw.push({ type, runs, ...extra });
  };
  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName;
      if (tag === "FIGURE" || tag === "IMG") {
        const img = tag === "IMG" ? el : el.querySelector("img");
        const src = img?.getAttribute("src");
        if (src) {
          const cap = el.querySelector("figcaption");
          const runs = cap ? trimRuns(runsFromNode(cap)) : [];
          raw.push({ type: "figure", runs, src: absolute(src, baseUrl), alt: img?.getAttribute("alt") ?? undefined });
        }
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        if (tag === "H1" || tag === "H2") push("h2", el);
        else if (/^H[3-6]$/.test(tag)) push("h3", el);
        else if (tag === "LI") push("li", el);
        else if (tag === "BLOCKQUOTE") {
          // A quote may contain several paragraphs.
          const ps = el.querySelectorAll("p");
          if (ps.length) ps.forEach((p) => push("quote", p));
          else push("quote", el);
        } else if (tag === "PRE") push("pre", el);
        else if (tag === "TABLE") {
          const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
            Array.from(tr.querySelectorAll("th,td"))
              .map((c) => c.textContent?.trim() ?? "")
              .join(" · "),
          );
          raw.push({ type: "pre", runs: [{ text: rows.join("\n") }] });
        } else push("p", el);
        continue;
      }
      if (el.children.length && !["A", "SPAN", "EM", "STRONG", "B", "I", "CODE"].includes(tag)) walk(el);
      else if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") push("p", el);
      else if ((el.textContent ?? "").trim().length > 40) push("p", el);
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
  const { document } = parseHTML(html);
  // linkedom lacks a few APIs Readability probes for.
  const doc = document as unknown as Document;
  const reader = new Readability(doc, { keepClasses: false });
  const article = reader.parse();
  if (!article || !article.content) throw new Error("Could not find a readable article on that page.");
  const blocks = blocksFromArticleHtml(article.content, url);
  if (!blocks.length) throw new Error("The page had no readable paragraphs.");
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
