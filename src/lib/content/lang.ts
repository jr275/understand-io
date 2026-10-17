import type { Block } from "./types";

/**
 * Best guess of a text's language (BCP 47) from common function words in its first paragraphs.
 * Only English, Portuguese and Spanish are distinguished; anything else falls back to English.
 */
export function guessLang(blocks: Pick<Block, "type" | "text">[]): string {
  const sample = blocks.filter((b) => b.type === "p").slice(0, 20).map((b) => b.text).join(" ").toLowerCase();
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const en = count(/\b(the|and|of|to|that|with|is|are|was|for)\b/g);
  const pt = count(/\b(que|não|uma|para|com|dos|das|como|mais|são)\b/g);
  if (pt > en) return "pt-BR";
  const es = count(/\b(el|los|las|una|por|como|pero|más|está)\b/g);
  if (es > en) return "es-ES";
  return "en-US";
}
