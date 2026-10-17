/*
 * Prints the retrieval metrics for the labelled set in tests/fixtures/retrieval-eval.json with the current code.
 * Run:  pnpm exec tsx scripts/eval-retrieval.mts
 * Same path as the voice panel without a key: parseSpokenQuery, then Bm25Index.search(topic, 12). The meaning re-rank is not
 * evaluated (it needs a key) and neither is speech-to-text. The set is small and hand-written: treat the numbers as a regression
 * signal, not as an accuracy claim.
 */
import { readFileSync } from "node:fs";
import type { Block } from "../src/lib/content/types";
import { createIndex, parseSpokenQuery, type Bm25Index } from "../src/lib/search/bm25";

interface Q { id: string; corpus: string; category: string; query: string; expected: string[]; expectNoMatch?: boolean; ambiguous?: boolean }
const ds = JSON.parse(readFileSync("tests/fixtures/retrieval-eval.json", "utf8")) as { corpora: Record<string, { file?: string; blocks?: Block[] }>; queries: Q[] };
const blocksOf = (n: string): Block[] => {
  const c = ds.corpora[n];
  return c.file ? (JSON.parse(readFileSync(c.file, "utf8")) as { blocks: Block[] }).blocks : c.blocks!.map((b) => ({ ...b, runs: [{ text: b.text }] }));
};
const idx: Record<string, Bm25Index> = {};
for (const n of Object.keys(ds.corpora)) idx[n] = createIndex(blocksOf(n));
const run = (q: Q) => idx[q.corpus].search(parseSpokenQuery(q.query).topic, 12);

const answerable = (qs: Q[]) => qs.filter((q) => q.expected.length && !q.ambiguous && !q.expectNoMatch);
const pct = (a: number, b: number) => `${a}/${b} = ${((100 * a) / b).toFixed(1)}%`;
const samples = ds.queries.filter((q) => q.corpus !== "pt-synthetic");
const all = answerable(ds.queries);
const s = answerable(samples);
const top1 = (qs: Q[]) => qs.filter((q) => q.expected.includes(run(q).hits[0]?.blockId ?? "")).length;
const top3 = (qs: Q[]) => qs.filter((q) => run(q).hits.slice(0, 3).some((h) => q.expected.includes(h.blockId))).length;
const absent = ds.queries.filter((q) => q.expectNoMatch);
const amb = ds.queries.filter((q) => q.ambiguous);
const conf = (c: string) => all.filter((q) => run(q).confidence === c);
const high = conf("high");
const overlap = ds.queries.filter((q) => {
  const hs = run(q).hits.slice(0, 3);
  return hs.some((a, i) => hs.slice(i + 1).some((b) => a.blockId === b.blockId && a.start < b.end && b.start < a.end));
}).length;

console.log(`queries: ${ds.queries.length} (answerable ${all.length}, sample documents ${s.length}, absent ${absent.length}, ambiguous ${amb.length})`);
console.log(`top-1, sample documents: ${pct(top1(s), s.length)}`);
console.log(`top-3, sample documents: ${pct(top3(s), s.length)}`);
console.log(`top-1, all answerable:   ${pct(top1(all), all.length)}`);
console.log(`top-3, all answerable:   ${pct(top3(all), all.length)}`);
console.log(`answerable labelled high / low / none: ${high.length} / ${conf("low").length} / ${conf("none").length} of ${all.length}`);
console.log(`precision of "high" (top-1 correct): ${pct(high.filter((q) => q.expected.includes(run(q).hits[0].blockId)).length, high.length)}`);
console.log(`absent concepts that still return hits: ${pct(absent.filter((q) => run(q).hits.length > 0).length, absent.length)}`);
console.log(`absent concepts labelled high: ${absent.filter((q) => run(q).confidence === "high").length}/${absent.length}`);
console.log(`ambiguous queries labelled high: ${amb.filter((q) => run(q).confidence === "high").length}/${amb.length}`);
console.log(`queries with overlapping windows in the top 3: ${overlap}/${ds.queries.length}`);
let bad = 0;
let total = 0;
for (const q of ds.queries) for (const h of run(q).hits) {
  total++;
  const text = blocksOf(q.corpus).find((b) => b.id === h.blockId)?.text ?? "";
  if (text.slice(h.start, h.end) !== h.excerpt) bad++;
}
console.log(`hit offsets that slice back to the excerpt: ${total - bad}/${total}`);
console.log("\nmisses (answerable, top-1 wrong):");
for (const q of all) if (!q.expected.includes(run(q).hits[0]?.blockId ?? "")) console.log(`  ${q.id} [${q.category}] ${run(q).confidence}: ${q.query}`);
