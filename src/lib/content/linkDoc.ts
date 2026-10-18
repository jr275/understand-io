import type { GlossDocument } from "./types";
import { slugFor } from "./slug";

/**
 * Saving a link whose page cannot be read (a site that blocks servers, an app page with no article, a missing page): the reader still
 * wants it on the shelf. Only what the page says about itself is kept, taken from the start of its HTML with plain pattern matching
 * (no parsing of an untrusted page beyond that), and a plain sentence on why it could not be read.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };

function decode(s: string) {
  return s
    .replace(/&#(\d{1,10});/g, (_, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : ""))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => (parseInt(h, 16) < 0x110000 ? String.fromCodePoint(parseInt(h, 16)) : ""))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(head: string, key: string): string | undefined {
  // <meta property="og:title" content="..."> in either attribute order
  const tag = new RegExp(`<meta\\b[^>]*?(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i").exec(head)?.[0];
  if (!tag) return undefined;
  const m = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const v = m ? decode(m[1] ?? m[2] ?? "") : "";
  return v || undefined;
}

export interface PageMeta {
  title?: string;
  description?: string;
  siteName?: string;
}

/** Title, description and site name from the first 64 KB of a page. Nothing else of the page is kept. */
export function pageMeta(html: string): PageMeta {
  const head = html.slice(0, 65_536);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = metaContent(head, "og:title") ?? metaContent(head, "twitter:title") ?? (titleTag ? decode(titleTag.replace(/<[^>]*>/g, "")) : undefined);
  const description = metaContent(head, "og:description") ?? metaContent(head, "description") ?? metaContent(head, "twitter:description");
  const siteName = metaContent(head, "og:site_name");
  return { title: title?.slice(0, 200) || undefined, description: description?.slice(0, 400), siteName: siteName?.slice(0, 80) };
}

/** A name for a link that tells us nothing about itself: the host, plus the last part of the path when there is one. */
export function nameFromUrl(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim();
  return last && last.length < 60 ? `${host}: ${last}` : host;
}

export function linkDocument(opts: { url: string; reason: string; meta?: PageMeta }): GlossDocument {
  const host = new URL(opts.url).hostname.replace(/^www\./, "");
  const title = opts.meta?.title || nameFromUrl(opts.url);
  return {
    slug: slugFor(title),
    kind: "link",
    title,
    author: null,
    dek: opts.meta?.description ?? null,
    year: null,
    sourceUrl: opts.url,
    sourceLabel: opts.meta?.siteName || host,
    topic: "unsorted",
    minutes: 0,
    paragraphs: 0,
    // The reason lives in the document so it survives a reload and shows on the link's own page.
    blocks: [{ id: "reason", type: "note", text: opts.reason }],
  };
}
