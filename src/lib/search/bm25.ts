import type { Block } from "@/lib/content/types";
import { sentences, tokenize } from "./tokenize";

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
}

/** Build passages: one per sentence window (1–2 sentences) so hits are precise but readable. */
export function buildPassages(blocks: Block[]): Passage[] {
  const out: Passage[] = [];
  for (const b of blocks) {
    if (b.type === "h2" || b.type === "h3") {
      out.push({ blockId: b.id, n: b.n, start: 0, end: b.text.length, text: b.text, tokens: tokenize(b.text) });
      continue;
    }
    const ss = sentences(b.text);
    if (!ss.length) continue;
    for (let i = 0; i < ss.length; i++) {
      const a = ss[i];
      const bnext = ss[i + 1];
      const end = bnext ? bnext.end : a.end;
      const text = b.text.slice(a.start, end);
      out.push({ blockId: b.id, n: b.n, start: a.start, end, text, tokens: tokenize(text) });
    }
  }
  return out;
}

export class Bm25Index {
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(public passages: Passage[]) {
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

  search(query: string, limit = 8): SearchResult {
    const qTokens = [...new Set(tokenize(query))];
    if (!qTokens.length) return { hits: [], confidence: "none", mode: "lexical", queryTokens: [] };
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
      // Phrase bonus: all query tokens present.
      if (matched.length === qTokens.length && qTokens.length > 1) score *= 1.25;
      if (score > 0) scored.push({ p, score, matched });
    }
    scored.sort((x, y) => y.score - x.score);
    // De-duplicate overlapping windows in the same block.
    const seen = new Set<string>();
    const hits: Hit[] = [];
    const best = scored[0]?.score ?? 0;
    for (const s of scored) {
      const key = `${s.p.blockId}:${Math.floor(s.p.start / 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        blockId: s.p.blockId,
        n: s.p.n,
        start: s.p.start,
        end: s.p.end,
        excerpt: s.p.text,
        score: s.score,
        rel: best ? s.score / best : 0,
        matched: s.matched,
      });
      if (hits.length >= limit) break;
    }
    const coverage = hits[0] ? hits[0].matched.length / qTokens.length : 0;
    const confidence: SearchResult["confidence"] = !hits.length
      ? "none"
      : coverage >= 0.6 && (qTokens.length === 1 || hits[0].matched.length >= 2)
        ? "high"
        : "low";
    return { hits, confidence, mode: "lexical", queryTokens: qTokens };
  }
}

/** Strip spoken-command phrasing ("find the part that talks about …") down to the topic. */
export function parseSpokenQuery(raw: string): { topic: string; readAloud: boolean } {
  let q = raw.trim().replace(/[.!?]+$/, "");
  const readAloud = /\b(read (it|that|this|the passage)( aloud| out loud)?|leia( esse| este| o)? trecho|ler (em voz alta|isso))\b/i.test(q);
  q = q.replace(/\b(and|e)\s+(then\s+)?(read|leia|ler)\b.*$/i, "");
  const patterns: RegExp[] = [
    /^(please\s+)?(find|locate|show( me)?|search( for)?|look for|go to|jump to|where('s| is| does| do)?)\s+/i,
    /^(the\s+)?(part|passage|paragraph|section|place|bit|sentence|conclusion|introduction)\s+(that|which|where|about|on)\s+/i,
    /^(the\s+)?(author|text|writer|he|she|they)\s+(explains?|talks? about|discusses?|mentions?|says?|argues?|describes?|compares?)\s+/i,
    /^(that\s+)?(talks? about|is about|discusses?|mentions?|explains?|describes?|deals with|covers?)\s+/i,
    /^(encontre|encontra|localize|localiza|procure|procura|mostre|mostra|busque|busca|ache|acha|onde)\s+/i,
    /^(a|o|as|os)\s+(parte|trecho|parágrafo|paragrafo|seção|secao|passagem|conclusão|conclusao|introdução|introducao)\s+(que|onde|sobre|em que)\s+/i,
    /^(o\s+autor|a\s+autora|o\s+texto|ele|ela)\s+(explica|fala|discute|menciona|diz|argumenta|descreve|compara)\s+(sobre\s+)?/i,
    /^(fala|falam|trata|tratam|discute|explica|menciona)\s+(sobre|de|da|do)\s+/i,
    /^(about|on|sobre|de|da|do|the|a|o)\s+/i,
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
