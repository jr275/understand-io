import type { AiItem, Basis, Block, Evidence } from "@/lib/content/types";

/**
 * Evidence is the app's own check, not the model's word: a quote the model attributes to a block counts only if it is really in that
 * block's text (case, spacing, typographic quotes and dashes forgiven). The offsets come from the document, never from the model.
 */

const QUOTES = "'‘’‚‛′`´";
const DQUOTES = '"“”„‟″';
const DASHES = "-‐‑‒–—―−";

const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest quote the matcher will take (a runaway quote is not evidence of a claim). */
export const MAX_QUOTE = 600;
/** Shortest quote worth verifying: two characters match almost anywhere. */
export const MIN_QUOTE = 12;

/** The span of `text` that `quote` points to, or null. Matching ignores case, runs of whitespace, quote style and dash style. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.normalize("NFC").trim().replace(/^[….]+|[….]+$/g, "").trim();
  if (q.length < MIN_QUOTE || q.length > MAX_QUOTE) return null;
  let pattern = "";
  for (const ch of q) {
    if (/\s/.test(ch)) pattern += "\\s+";
    else if (QUOTES.includes(ch)) pattern += `[${esc(QUOTES)}]`;
    else if (DQUOTES.includes(ch)) pattern += `[${esc(DQUOTES)}]`;
    else if (DASHES.includes(ch)) pattern += `[${esc(DASHES)}]`;
    else pattern += esc(ch);
  }
  // Collapse the runs of \s+ that adjacent whitespace characters produce.
  pattern = pattern.replace(/(?:\\s\+)+/g, "\\s+");
  try {
    const m = new RegExp(pattern, "iu").exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  } catch {
    return null;
  }
}

export interface ProposedEvidence {
  id: string;
  quote: string;
}

/** Keep only proposed evidence whose quote is really in the named block. `allowed` limits which blocks the model was shown. */
export function verifyEvidence(proposed: ProposedEvidence[] | undefined, blocks: Map<string, Block>, allowed?: Set<string>): Evidence[] {
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const p of proposed ?? []) {
    const b = blocks.get(p.id);
    if (!b || (allowed && !allowed.has(p.id))) continue;
    const hit = findQuote(b.text, p.quote);
    if (!hit) continue;
    const key = `${b.id}:${hit.start}:${hit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ blockId: b.id, n: b.n, quote: b.text.slice(hit.start, hit.end), start: hit.start, end: hit.end });
  }
  return out;
}

export interface ProposedItem {
  label?: string;
  text: string;
  basis?: Basis;
  evidence?: ProposedEvidence[];
  answer?: string;
}

/**
 * An item that says the text supports it must show a verified quote. Otherwise it is kept, but labelled as the model's interpretation
 * and flagged, never as something the text says. "External" items are kept as external and carry no evidence.
 */
export function checkItems(items: ProposedItem[], blocks: Map<string, Block>, allowed?: Set<string>): AiItem[] {
  return items.map((it) => {
    const basis: Basis = it.basis ?? "text";
    const evidence = basis === "external" ? [] : verifyEvidence(it.evidence, blocks, allowed);
    if (basis === "text" && evidence.length === 0) return { label: it.label, text: it.text, basis: "interpretation", evidence: [], unverified: true, answer: it.answer };
    return { label: it.label, text: it.text, basis, evidence, answer: it.answer };
  });
}
