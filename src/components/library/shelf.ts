import type { GlossDocument } from "@/lib/content/types";
import { TOPICS, topicInfo } from "@/lib/content/types";

export type Sort = "topic" | "recent" | "colour" | "length";
export type SpineStyle = "label" | "sans" | "foil" | "bands";

export interface SpineSpec {
  slug: string;
  width: number;
  height: number;
  bg: string;
  fg: string;
  light: boolean;
  style: SpineStyle;
  wide: boolean;
  fontSize: number;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function mix(hex: string, amount: number, light: boolean) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = light ? 255 : 0;
  const f = (c: number) => Math.round(c + (t - c) * amount);
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

/** Deterministic spine look per document: colour from topic, size from length, style from the slug. */
export function spineFor(doc: Omit<GlossDocument, "blocks">): SpineSpec {
  const t = topicInfo(doc.topic);
  const h = hash(doc.slug);
  const h2 = hash(doc.slug + "x");
  const styles: SpineStyle[] = ["label", "sans", "foil", "bands"];
  const style = styles[Math.floor(h * styles.length)];
  const light = h2 > 0.72;
  const bg = light ? mix(t.color, 0.42, true) : h2 < 0.3 ? mix(t.color, 0.22, false) : t.color;
  const fg = light ? "#2a2520" : "#f6efe2";
  const minutes = doc.minutes ?? 1;
  const width = Math.round(Math.min(56, 30 + Math.log2(1 + minutes) * 5));
  const height = Math.round(206 + hash(doc.slug + "h") * 50);
  const wide = width >= 50 && doc.title.length <= 24;
  const titleLen = doc.title.length + (doc.author?.length ?? 0) / 2;
  const fontSize = wide ? 13.3 : Math.max(9, Math.min(12.5, (height - 80) / Math.max(10, titleLen) * 1.3));
  return { slug: doc.slug, width, height, bg, fg, light, style, wide, fontSize };
}

export function shortAuthor(doc: Omit<GlossDocument, "blocks">) {
  const a = doc.author?.trim();
  if (a) {
    const parts = a.split(/\s+/);
    return parts.length > 1 && !a.includes(".") && a.length > 14 ? parts[parts.length - 1] : a;
  }
  if (doc.sourceLabel) return doc.sourceLabel.replace(/^www\./, "").split(".")[0];
  return "";
}

export interface Placed {
  spec: SpineSpec;
  doc: Omit<GlossDocument, "blocks">;
  x: number;
  i: number;
}

export interface Layout {
  width: number;
  height: number;
  shelfY: number;
  books: Placed[];
  labels: { topic: string; x: number; count: number }[];
  bookendX: number;
}

const GAP = 3;
const GROUP_GAP = 30;
const LEFT = 28;
const TOP_PAD = 36;

/** Place spines left to right, grouped by topic when sorting by topic. */
export function layoutShelf(docs: Omit<GlossDocument, "blocks">[], sort: Sort, progress: Record<string, { ratio: number; updatedAt: number; finished?: boolean }>): Layout {
  const sorted = [...docs];
  const byUpdated = (d: Omit<GlossDocument, "blocks">) => {
    const p = d.id ? progress[d.id] : undefined;
    return Math.max(p?.updatedAt ?? 0, d.updatedAt ? Date.parse(d.updatedAt) : 0, d.createdAt ? Date.parse(d.createdAt) : 0);
  };
  const topicOrder = new Map(TOPICS.map((t, i) => [t.id, i]));
  if (sort === "topic") sorted.sort((a, b) => (topicOrder.get(a.topic) ?? 99) - (topicOrder.get(b.topic) ?? 99) || byUpdated(b) - byUpdated(a));
  if (sort === "recent") sorted.sort((a, b) => byUpdated(b) - byUpdated(a));
  if (sort === "colour") sorted.sort((a, b) => topicInfo(a.topic).color.localeCompare(topicInfo(b.topic).color));
  if (sort === "length") sorted.sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));

  const books: Placed[] = [];
  const labels: Layout["labels"] = [];
  let x = LEFT;
  let maxH = 0;
  let group: string | null = null;
  let groupStart = x;
  let groupCount = 0;
  const closeGroup = () => {
    if (group !== null && sort === "topic") labels.push({ topic: group, x: groupStart, count: groupCount });
  };
  sorted.forEach((doc, i) => {
    const spec = spineFor(doc);
    if (sort === "topic" && doc.topic !== group) {
      closeGroup();
      if (group !== null) x += GROUP_GAP;
      group = doc.topic;
      groupStart = x;
      groupCount = 0;
    }
    books.push({ spec, doc, x, i });
    x += spec.width + GAP;
    maxH = Math.max(maxH, spec.height);
    groupCount++;
  });
  closeGroup();
  const bookendX = x + 2;
  const shelfY = TOP_PAD + maxH;
  return { width: Math.max(bookendX + 40, 900), height: shelfY + 48, shelfY, books, labels, bookendX };
}
