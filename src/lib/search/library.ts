import type { Annotation, Block, GlossDocument } from "@/lib/content/types";
import { createIndex, type Bm25Index, type Hit } from "./bm25";
import { queryTokens, tokenize } from "./tokenize";

/** Shortest query the library search answers (a single letter would match everything). */
export const MIN_LIBRARY_QUERY = 2;

export interface LibraryPassage {
  slug: string;
  title: string;
  author?: string | null;
  hit: Hit;
  /** `high`: the passage covers the question; `low`: it covers part of it. Never shown as a certain answer. */
  confidence: "high" | "low";
  lang: string;
}

export interface LibraryMark {
  slug: string;
  title: string;
  annotation: Annotation;
  /** Where the words were found: the reader's own note, or the highlighted quote. */
  in: "note" | "quote";
  lang: string;
}

export interface LibrarySearch {
  passages: LibraryPassage[];
  marks: LibraryMark[];
  /** Texts whose words were searched. */
  searched: number;
  /** Texts kept on the account whose words are not in this browser, so only their title was searched. */
  unsearched: number;
  queryTokens: string[];
}

export const EMPTY_SEARCH: LibrarySearch = { passages: [], marks: [], searched: 0, unsearched: 0, queryTokens: [] };

// One index per text, kept for as long as the text's blocks array is the same object, so typing only re-ranks.
const indexes = new WeakMap<Block[], { index: Bm25Index; lang: string }>();
function indexFor(blocks: Block[]) {
  let hit = indexes.get(blocks);
  if (!hit) {
    const index = createIndex(blocks);
    hit = { index, lang: index.lang };
    indexes.set(blocks, hit);
  }
  return hit;
}

export interface SearchOptions {
  /** Passages kept per text, so one long text cannot fill the list. */
  perDocument?: number;
  /** Passages and marks kept in all. */
  limit?: number;
}

/**
 * "Where did I read about this?": the best passages across every saved text whose words are in this browser, and the
 * reader's own highlights and notes that mention the same words. Each text is searched on its own (BM25 weights are
 * not comparable between texts), and a text with no sufficiently covered passage contributes nothing, so an
 * unrelated question finds nothing rather than something unrelated. Texts are ranked by how much of the question their
 * best passage covers, then by score. Nothing leaves the browser.
 */
export function searchLibrary(docs: GlossDocument[], annotationsOf: (doc: GlossDocument) => Annotation[], query: string, opts: SearchOptions = {}): LibrarySearch {
  const q = query.trim();
  if (q.length < MIN_LIBRARY_QUERY) return EMPTY_SEARCH;
  const perDocument = opts.perDocument ?? 3;
  const limit = opts.limit ?? 12;

  const found: { p: LibraryPassage; coverage: number }[] = [];
  const marks: LibraryMark[] = [];
  let searched = 0;
  let unsearched = 0;
  let tokens: string[] = [];

  for (const doc of docs) {
    // A saved link whose page could not be read has only a reason and a description, never body text to search.
    if (!doc.blocks.length) {
      unsearched++;
      continue;
    }
    searched++;
    const { index, lang } = indexFor(doc.blocks);
    const r = index.search(q, perDocument);
    if (!tokens.length) tokens = r.queryTokens;
    if (r.confidence !== "none") {
      for (const hit of r.hits) found.push({ p: { slug: doc.slug, title: doc.title, author: doc.author, hit, confidence: r.confidence, lang }, coverage: r.coverage });
    }

    const want = [...new Set(queryTokens(q, lang))];
    if (!want.length) continue;
    for (const a of annotationsOf(doc)) {
      const inNote = a.note ? new Set(tokenize(a.note, false, lang)) : null;
      const inQuote = new Set(tokenize(a.anchor.quote, false, lang));
      if (inNote && want.every((t) => inNote.has(t))) marks.push({ slug: doc.slug, title: doc.title, annotation: a, in: "note", lang });
      else if (want.every((t) => inQuote.has(t))) marks.push({ slug: doc.slug, title: doc.title, annotation: a, in: "quote", lang });
    }
  }

  found.sort((x, y) => y.coverage - x.coverage || y.p.hit.score - x.p.hit.score);
  marks.sort((x, y) => (x.in === y.in ? 0 : x.in === "note" ? -1 : 1) || y.annotation.updatedAt - x.annotation.updatedAt);
  return { passages: found.slice(0, limit).map((f) => f.p), marks: marks.slice(0, limit), searched, unsearched, queryTokens: tokens };
}

/** The deep link that opens a text at a passage and marks it (the reader reads `at`, `s` and `e`). */
export function passageHref(slug: string, hit: Pick<Hit, "blockId" | "start" | "end">) {
  return `/read/${encodeURIComponent(slug)}?at=${encodeURIComponent(hit.blockId)}&s=${hit.start}&e=${hit.end}`;
}

/** The deep link that opens a text at one of the reader's own marks. */
export function markHref(slug: string, annotationId: string) {
  return `/read/${encodeURIComponent(slug)}?hl=${encodeURIComponent(annotationId)}`;
}

/** Splits an excerpt into runs, marking the words that matched (compared after the same folding and stemming the search uses). */
export function highlightTerms(text: string, matched: string[], lang: string): { text: string; hit: boolean }[] {
  const want = new Set(matched);
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const hit = tokenize(m[0], true, lang).some((t) => want.has(t));
    if (!hit) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}
