import type { Block } from "@/lib/content/types";
import { guessLang } from "@/lib/content/lang";
import { queryTokens, sentences, tokenize } from "./tokenize";

export interface Passage {
  blockId: string;
  n?: number;
  start: number;
  end: number;
  text: string;
  tokens: string[];
}

export interface Hit {
  blockId: string;
  n?: number;
  start: number;
  end: number;
  excerpt: string;
  score: number;
  /** Normalised 0..1 relative to the best hit. */
  rel: number;
  matched: string[];
}

export interface SearchResult {
  hits: Hit[];
  confidence: "high" | "low" | "none";
  mode: "lexical" | "hybrid";
  queryTokens: string[];
  /** Language used to stem the query, so highlighting can stem the same way. */
  lang: string;
  /** Share (0..1) of the query's idf weight covered by the best passage; what the confidence label is based on. */
  coverage: number;
}

/** Build passages: one per sentence window (1–2 sentences) so hits are precise but readable. */
export function buildPassages(blocks: Block[], lang: string = guessLang(blocks)): Passage[] {
  const out: Passage[] = [];
  for (const b of blocks) {
    if (b.type === "h2" || b.type === "h3") {
      out.push({ blockId: b.id, n: b.n, start: 0, end: b.text.length, text: b.text, tokens: tokenize(b.text, false, lang) });
      continue;
    }
    const ss = sentences(b.text);
    if (!ss.length) continue;
    for (let i = 0; i < ss.length; i++) {
      const a = ss[i];
      const bnext = ss[i + 1];
      const end = bnext ? bnext.end : a.end;
      const text = b.text.slice(a.start, end);
      out.push({ blockId: b.id, n: b.n, start: a.start, end, text, tokens: tokenize(text, false, lang) });
    }
  }
  return out;
}

/** Passages and index for a document, with the stemming language detected from its text. */
export function createIndex(blocks: Block[]): Bm25Index {
  const lang = guessLang(blocks);
  return new Bm25Index(buildPassages(blocks, lang), lang);
}

/** Best-passage coverage below this share of the query's weight means "no match". */
const NONE_BELOW = 0.4;

export class Bm25Index {
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(
    public passages: Passage[],
    public lang: string = "en",
  ) {
    let total = 0;
    for (const p of passages) {
      total += p.tokens.length;
      for (const t of new Set(p.tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = total / Math.max(1, passages.length);
  }

  idf(t: string) {
    const n = this.passages.length;
    const df = this.df.get(t) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * Rank passages for a query.
   *
   * Confidence is judged on how much of the query's *informative* weight the best passage covers (idf-weighted, so a
   * word that appears nowhere in the text counts heavily against it and common words barely count):
   *   none  — under 40% covered: nothing is returned, so a coincidental shared word never produces a "match";
   *   high  — at least 75% covered, with two or more matched words when the query has several, and, for a one-word
   *           query, a word that is rare in the text (in more than 5% of the passages it is too ambiguous to be sure);
   *   low   — anything in between.
   */
  search(query: string, limit = 8): SearchResult {
    const qTokens = [...new Set(queryTokens(query, this.lang))];
    const none: SearchResult = { hits: [], confidence: "none", mode: "lexical", queryTokens: qTokens, lang: this.lang, coverage: 0 };
    if (!qTokens.length) return none;
    const k1 = 1.4;
    const b = 0.75;
    const scored: { p: Passage; score: number; matched: string[] }[] = [];
    for (const p of this.passages) {
      let score = 0;
      const matched: string[] = [];
      for (const t of qTokens) {
        const tf = p.tokens.filter((x) => x === t).length;
        if (!tf) continue;
        matched.push(t);
        const idf = this.idf(t);
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.tokens.length) / this.avgLen)));
      }
      // Bonus when every query word is present.
      if (matched.length === qTokens.length && qTokens.length > 1) score *= 1.25;
      if (score > 0) scored.push({ p, score, matched });
    }
    scored.sort((x, y) => y.score - x.score);
    if (!scored.length) return none;

    const weight = (ts: string[]) => ts.reduce((sum, t) => sum + this.idf(t), 0);
    const coverage = weight(scored[0].matched) / weight(qTokens);
    if (coverage < NONE_BELOW) return { ...none, coverage };

    // Keep only windows that do not overlap a better one in the same block (neighbouring windows share a sentence).
    const hits: Hit[] = [];
    const best = scored[0].score;
    for (const s of scored) {
      if (hits.some((h) => h.blockId === s.p.blockId && s.p.start < h.end && s.p.end > h.start)) continue;
      hits.push({ blockId: s.p.blockId, n: s.p.n, start: s.p.start, end: s.p.end, excerpt: s.p.text, score: s.score, rel: s.score / best, matched: s.matched });
      if (hits.length >= limit) break;
    }
    // A one-word query is only "high" when the word is rare in the text: in at most 5% of passages, and in any case a couple of passages in a very short text.
    const rare = qTokens.length > 1 || (this.df.get(qTokens[0]) ?? 0) <= Math.max(2, 0.05 * this.passages.length);
    const confidence: SearchResult["confidence"] = coverage >= 0.75 && (qTokens.length === 1 || hits[0].matched.length >= 2) && rare ? "high" : "low";
    return { hits, confidence, mode: "lexical", queryTokens: qTokens, lang: this.lang, coverage };
  }
}

/**
 * Strip spoken-command phrasing ("can you find the part that talks about …", "read the conclusion aloud") down to the topic,
 * and notice a request to read the passage aloud.
 */
export function parseSpokenQuery(raw: string): { topic: string; readAloud: boolean } {
  let q = raw.trim().replace(/[.!?]+$/, "");
  let readAloud = /\b(read (it|that|this|the (passage|part|section|paragraph))( aloud| out loud)?|leia( esse| este| o)? trecho|ler (em voz alta|isso))\b/i.test(q);
  if (/^(please\s+|por favor\s+)?(read|leia|ler)\b/i.test(q)) readAloud = true; // "Read the conclusion", "Leia a conclusão"
  q = q.replace(/\b(and|e)\s+(then\s+)?(read|leia|ler)\b.*$/i, "").replace(/\b(out loud|aloud|em voz alta)\b/gi, "");
  const patterns: RegExp[] = [
    /^(um+|uh+|hmm+|okay|ok|so|well|hey|ei|então|entao|bom)[,\s]+/i,
    /^(can|could|would|will)\s+you(\s+please)?\s+/i,
    /^(pode|poderia|consegue)(\s+voc[êe])?(\s+por favor)?\s+/i,
    /^(please|por favor)[,\s]+/i,
    /^(read|leia|ler)\s+(me\s+)?/i,
    /^(tell|take|bring|give)\s+me(\s+(to|where|about))?\s+/i,
    /^go back to\s+/i,
    /^(what|who|why|how|when)\s+(does|did|do|is|are|was|were)\s+/i,
    /^(please\s+)?(find|locate|show( me)?|search( for)?|look for|go to|jump to|where('s| is| does| do)?)\s+/i,
    /^(the\s+)?(part|passage|paragraph|section|place|bit|sentence|conclusion|introduction)\s+(that|which|where|about|on)\s+/i,
    /^(the\s+)?(author|text|writer|he|she|they)\s+(explains?|talks? about|discusses?|mentions?|says?|argues?|describes?|compares?)\s+/i,
    /^(that\s+)?(talks? about|is about|discusses?|mentions?|explains?|describes?|deals with|covers?)\s+/i,
    /^(encontre|encontra|encontrar|localize|localiza|localizar|procure|procura|procurar|mostre|mostra|mostrar|busque|busca|buscar|ache|acha|achar|onde)\s+/i,
    /^(a|o|as|os)\s+(parte|trecho|parágrafo|paragrafo|seção|secao|passagem|conclusão|conclusao|introdução|introducao)\s+(que|onde|sobre|em que)\s+/i,
    /^(o\s+autor|a\s+autora|o\s+texto|ele|ela)\s+(explica|fala|discute|menciona|diz|argumenta|descreve|compara)\s+(sobre\s+)?/i,
    /^(fala|falam|trata|tratam|discute|explica|menciona)\s+(sobre|de|da|do)\s+/i,
    /^(about|on|sobre|de|da|do|das|dos|the|a|o|as|os)\s+/i,
  ];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (const p of patterns) {
      const next = q.replace(p, "");
      if (next !== q) {
        q = next.trim();
        changed = true;
      }
    }
  }
  return { topic: q.trim() || raw.trim(), readAloud };
}
