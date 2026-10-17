import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/content/types";
import { createIndex, parseSpokenQuery, type Bm25Index } from "@/lib/search/bm25";
import { porterStem } from "@/lib/search/porter";
import { queryTokens, tokenize } from "@/lib/search/tokenize";

describe("Porter stemmer: reference vocabulary from the algorithm's paper", () => {
  const cases: [string, string][] = [
    ["caresses", "caress"], ["ponies", "poni"], ["ties", "ti"], ["caress", "caress"], ["cats", "cat"], ["feed", "feed"], ["agreed", "agre"],
    ["plastered", "plaster"], ["bled", "bled"], ["motoring", "motor"], ["sing", "sing"], ["conflated", "conflat"], ["troubled", "troubl"],
    ["sized", "size"], ["hopping", "hop"], ["tanned", "tan"], ["falling", "fall"], ["hissing", "hiss"], ["fizzed", "fizz"], ["failing", "fail"],
    ["filing", "file"], ["happy", "happi"], ["sky", "sky"], ["relational", "relat"], ["conditional", "condit"], ["rational", "ration"],
    ["digitizer", "digit"], ["operator", "oper"], ["feudalism", "feudal"], ["decisiveness", "decis"], ["hopefulness", "hope"],
    ["callousness", "callous"], ["formaliti", "formal"], ["sensitiviti", "sensit"], ["sensibiliti", "sensibl"], ["triplicate", "triplic"],
    ["formative", "form"], ["formalize", "formal"], ["electriciti", "electr"], ["electrical", "electr"], ["hopeful", "hope"], ["goodness", "good"],
    ["revival", "reviv"], ["allowance", "allow"], ["inference", "infer"], ["airliner", "airlin"], ["adjustable", "adjust"], ["defensible", "defens"],
    ["irritant", "irrit"], ["replacement", "replac"], ["adjustment", "adjust"], ["dependent", "depend"], ["adoption", "adopt"], ["communism", "commun"],
    ["activate", "activ"], ["effective", "effect"], ["probate", "probat"], ["rate", "rate"], ["cease", "ceas"], ["controll", "control"], ["roll", "roll"],
  ];
  for (const [word, stem] of cases) it(`${word} -> ${stem}`, () => expect(porterStem(word)).toBe(stem));
});

describe("stemming makes inflections of one word meet (the review found only 11 of 31 pairs did)", () => {
  const same: string[][] = [
    ["stone", "stones"], ["cause", "causes", "caused", "causing"], ["reptile", "reptiles"], ["crocodile", "crocodiles"], ["place", "places"],
    ["image", "images"], ["wave", "waves"], ["horse", "horses"], ["simile", "similes"], ["evolve", "evolved"], ["family", "families"],
    ["thing", "things"], ["store", "stores"], ["shore", "shores"], ["hero", "heroes"], ["study", "studies"], ["history", "histories"],
    ["sound", "sounding", "soundings"], ["specimen", "specimens"], ["cliff", "cliffs"],
    // Known limit of the Porter algorithm, deliberately not covered: words that end in "s" themselves ("lens" / "lenses").
  ];
  for (const group of same) it(`English: ${group.join(" = ")}`, () => expect(new Set(group.map((w) => tokenize(w)[0])).size).toBe(1));

  const samePt: string[][] = [
    ["conclusão", "conclusões"], ["análise", "análises"], ["família", "famílias"], ["risco", "riscos"], ["economista", "economistas"],
    ["inflação", "inflações"], ["relação", "relações"], ["espécie", "espécies"], ["importante", "importantes"], ["financeiro", "financeira", "financeiros"],
    ["jornal", "jornais"], ["cidadão", "cidadãos"],
  ];
  for (const group of samePt) it(`Portuguese: ${group.join(" = ")}`, () => expect(new Set(group.map((w) => tokenize(w, false, "pt-BR")[0])).size).toBe(1));

  it("unrelated words stay apart", () => {
    for (const [a, b] of [["chalk", "chill"], ["sea", "see"], ["cliff", "class"], ["stone", "store"], ["risco", "rico"]]) {
      expect(tokenize(a, false, a === "risco" ? "pt" : "en")[0]).not.toBe(tokenize(b, false, a === "risco" ? "pt" : "en")[0]);
    }
  });
  it("Portuguese rules no longer corrupt English words", () => {
    expect(tokenize("shores stores heroes citizens")).toEqual(["shore", "store", "hero", "citizen"]);
  });
});

describe("stop words and spoken filler", () => {
  it("Portuguese stop words are matched after accents are removed", () => {
    expect(tokenize("não são é à")).toEqual([]);
    expect(tokenize("isso foi mais", false, "pt")).toEqual([]);
  });
  it("English question and auxiliary words are not content", () => {
    expect(tokenize("how does it and why can they")).toEqual([]);
  });
  it("words of the request itself are dropped from queries but not from the text", () => {
    expect(queryTokens("what does he say about newspapers")).toEqual(["newspap"]);
    expect(queryTokens("can you please show me where the author mentions the Pyramids")).toEqual(["pyramid"]);
    expect(tokenize("the author says please")).toContain("author");
  });
});

describe("parseSpokenQuery", () => {
  const cases: [string, string, boolean][] = [
    ["Find the part that talks about the sea floor", "sea floor", false],
    ["Where does the author explain the main argument?", "main argument", false],
    ["Can you find the part about the sea floor", "sea floor", false],
    ["Okay, find the part about the sea floor", "sea floor", false],
    ["Um, where does he talk about newspapers", "newspapers", false],
    ["What does the author say about newspapers", "newspapers", false],
    ["Show me the part where he compares reading to eating", "reading to eating", false],
    ["Read the conclusion", "conclusion", true],
    ["Read the conclusion aloud", "conclusion", true],
    ["Find the part about reading and read it", "reading", true],
    ["Find the part about writing and reading", "writing and reading", false],
    ["Find the part about chalk and then read it out loud", "chalk", true],
    ["Go back to the part about chalk", "chalk", false],
    ["Take me to the section on coccoliths", "coccoliths", false],
    ["Tell me where he mentions the Pyramids", "Pyramids", false],
    ["Can you please show me where the author mentions the Pyramids", "Pyramids", false],
    ["Encontre a conclusão e leia esse trecho", "conclusão", true],
    ["Leia a conclusão", "conclusão", true],
    ["Leia o trecho sobre os crocodilos", "crocodilos", true],
    ["Pode mostrar onde ele fala sobre jornais", "jornais", false],
    ["Onde o autor fala sobre a educação", "educação", false],
    ["Mostre a parte em que ele fala de Homero", "Homero", false],
  ];
  for (const [said, topic, readAloud] of cases) it(`"${said}"`, () => expect(parseSpokenQuery(said)).toEqual({ topic, readAloud }));
  it("never returns an empty topic for non-empty speech", () => expect(parseSpokenQuery("the").topic).toBe("the"));
});

interface Dataset {
  corpora: Record<string, { file?: string; blocks?: Block[] }>;
  queries: { id: string; corpus: string; query: string; expected: string[]; expectNoMatch?: boolean; ambiguous?: boolean }[];
}
const dataset = JSON.parse(readFileSync("tests/fixtures/retrieval-eval.json", "utf8")) as Dataset;
const blocksOf = (name: string): Block[] => {
  const c = dataset.corpora[name];
  return c.file ? (JSON.parse(readFileSync(c.file, "utf8")) as { blocks: Block[] }).blocks : c.blocks!.map((b) => ({ ...b, runs: [{ text: b.text }] }));
};
const indexes: Record<string, Bm25Index> = {};
for (const name of Object.keys(dataset.corpora)) indexes[name] = createIndex(blocksOf(name));
const run = (q: Dataset["queries"][number]) => indexes[q.corpus].search(parseSpokenQuery(q.query).topic, 12);

describe("confidence is judged on how much of the question the passage covers", () => {
  const chalk = indexes["chalk"];
  it("a rare single word is a confident match", () => expect(chalk.search("coccoliths").confidence).toBe("high"));
  it("a word that appears all over the text is not (it is ambiguous)", () => {
    const r = chalk.search("sea");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.confidence).toBe("low");
  });
  it("a word the text never uses yields no match at all, and no hits to mislead", () => {
    const r = chalk.search("dinosaurs");
    expect(r.confidence).toBe("none");
    expect(r.hits).toEqual([]);
  });
  it("shared incidental words do not make a match: 'stock market and interest rates' is not in a lecture on chalk", () => {
    const r = chalk.search("stock market and interest rates");
    expect(r.confidence).toBe("none");
    expect(r.hits).toEqual([]);
  });
  it("two rare words in one passage are a confident match", () => expect(chalk.search("Globigerina ooze").confidence).toBe("high"));
  it("reports the coverage the label was based on", () => {
    const r = chalk.search("sea floor");
    expect(r.coverage).toBeGreaterThan(0.4);
    expect(r.coverage).toBeLessThanOrEqual(1);
  });
});

describe("results", () => {
  it("never contain two windows that overlap in the same block", () => {
    for (const q of dataset.queries) {
      const hits = run(q).hits;
      for (let i = 0; i < hits.length; i++)
        for (let j = i + 1; j < hits.length; j++) {
          const overlap = hits[i].blockId === hits[j].blockId && hits[i].start < hits[j].end && hits[j].start < hits[i].end;
          expect(overlap, `${q.id}: ${hits[i].blockId}[${hits[i].start}-${hits[i].end}] vs [${hits[j].start}-${hits[j].end}]`).toBe(false);
        }
    }
  });
  it("carry offsets that slice back to the excerpt, verbatim from the document", () => {
    for (const q of dataset.queries)
      for (const h of run(q).hits) {
        const block = blocksOf(q.corpus).find((b) => b.id === h.blockId)!;
        expect(block.text.slice(h.start, h.end), q.id).toBe(h.excerpt);
      }
  });
});

describe("labelled evaluation (41 hand-written queries; thresholds sit just under the values measured when they were set, to catch regressions, not to claim accuracy)", () => {
  const samples = dataset.queries.filter((q) => q.corpus !== "pt-synthetic");
  const answerable = (qs: typeof samples) => qs.filter((q) => q.expected.length && !q.ambiguous && !q.expectNoMatch);
  it("finds the right paragraph in the sample texts", () => {
    const qs = answerable(samples);
    const top1 = qs.filter((q) => q.expected.includes(run(q).hits[0]?.blockId ?? "")).length / qs.length;
    const top3 = qs.filter((q) => run(q).hits.slice(0, 3).some((h) => q.expected.includes(h.blockId))).length / qs.length;
    expect(qs).toHaveLength(26);
    expect(top1).toBeGreaterThanOrEqual(0.55); // measured 0.577
    expect(top3).toBeGreaterThanOrEqual(0.65); // measured 0.692
  });
  it("finds the right paragraph in the Portuguese text", () => {
    const qs = answerable(dataset.queries.filter((q) => q.corpus === "pt-synthetic"));
    for (const q of qs) expect(q.expected.includes(run(q).hits[0]?.blockId ?? ""), q.id).toBe(true);
  });
  it("says 'no match' for concepts that are not in the text", () => {
    const absent = dataset.queries.filter((q) => q.expectNoMatch);
    expect(absent).toHaveLength(7);
    const withHits = absent.filter((q) => run(q).hits.length > 0);
    expect(withHits.length).toBeLessThanOrEqual(1); // measured 1 of 7 (French Revolution, a partial match)
    expect(absent.filter((q) => run(q).confidence === "high")).toHaveLength(0);
  });
  it("is never confident about an ambiguous one-word query", () => {
    for (const q of dataset.queries.filter((x) => x.ambiguous)) expect(run(q).confidence, q.id).not.toBe("high");
  });
  it("is usually right when it is confident", () => {
    const qs = answerable(dataset.queries).filter((q) => run(q).confidence === "high");
    const right = qs.filter((q) => q.expected.includes(run(q).hits[0].blockId)).length;
    expect(qs.length).toBeGreaterThanOrEqual(14);
    expect(right / qs.length).toBeGreaterThanOrEqual(0.85); // measured 14 of 16
  });
});
