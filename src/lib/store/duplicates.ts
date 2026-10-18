import type { GlossDocument } from "@/lib/content/types";

/** Query parameters that only say where a click came from; the page is the same without them. */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|ref|spm)$/i;

/**
 * One form for the addresses of the same page: scheme and host in lower case, no `www.`, no fragment, no tracking parameters,
 * the rest of the query in a fixed order, and no trailing slash. `null` for anything that is not a web address.
 */
export function normalizeSourceUrl(raw: string): string | null {
  const t = raw.trim();
  // Another scheme ("ftp://", "javascript:") is not a page address; a bare "host:port/path" still is.
  if (/^([a-z][a-z0-9+.-]*:\/\/|(javascript|data|mailto|file|blob):)/i.test(t) && !/^https?:\/\//i.test(t)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const path = u.pathname.replace(/\/+$/, "");
  const query = params.length ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
  return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : ""}${path}${query}`;
}

/** The words of a text with case and spacing flattened, so the same text pasted with other line breaks still matches. */
export function flatten(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A short, stable fingerprint of flattened text (FNV-1a, 32 bit) joined with its length: enough to compare a saved text with a pasted one. */
export function fingerprint(text: string): string {
  const flat = flatten(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < flat.length; i++) {
    h ^= flat.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${flat.length}:${(h >>> 0).toString(36)}`;
}

/** Shortest text worth comparing; a one-line note is not "the same text" as another one-line note. */
export const MIN_DUPLICATE_TEXT = 200;

/**
 * The text already on the shelf that a new import would repeat: the same page address, or the same words. A saved link whose page
 * could not be read is never a duplicate of its address (the reader may be trying again), and samples never are.
 */
export function findDuplicate(docs: GlossDocument[], probe: { url?: string; text?: string }): GlossDocument | null {
  const url = probe.url ? normalizeSourceUrl(probe.url) : null;
  const print = probe.text && flatten(probe.text).length >= MIN_DUPLICATE_TEXT ? fingerprint(probe.text) : null;
  if (!url && !print) return null;
  for (const d of docs) {
    if (d.kind === "sample") continue;
    if (url && d.kind !== "link" && d.sourceUrl && normalizeSourceUrl(d.sourceUrl) === url) return d;
    if (print && d.blocks?.length && fingerprint(d.blocks.map((b) => b.text).join(" ")) === print) return d;
  }
  return null;
}
