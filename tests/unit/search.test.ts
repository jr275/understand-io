import { describe, expect, it } from "vitest";
import { Bm25Index, buildPassages, parseSpokenQuery } from "@/lib/search/bm25";
import { sentences, tokenize } from "@/lib/search/tokenize";
import chalk from "@/content/samples/on-a-piece-of-chalk.json";
import type { Block } from "@/lib/content/types";

const blocks = (chalk as { blocks: Block[] }).blocks;

describe("tokenize", () => {
  it("drops stop words, strips accents and stems lightly", () => {
    expect(tokenize("The chalks were crushed into the Cliffs")).toEqual(["chalk", "crush", "cliff"]);
    // Portuguese is stemmed with Portuguese rules when asked to. This test used to expect "conclusões" -> "conclus" next to
    // "conclusão" -> "conclusao", i.e. a plural that could never match its singular; singular and plural now give one stem.
    expect(tokenize("conclusões da análise", false, "pt-BR")).toEqual(["conclus", "analis"]);
    expect(tokenize("conclusão", false, "pt-BR")).toEqual(["conclus"]);
  });
  it("splits sentences without breaking abbreviations", () => {
    const s = sentences("Dr. Wallich looked. H.M.S. Bulldog sailed on! Then what?");
    expect(s.map((x) => x.text)).toEqual(["Dr. Wallich looked.", "H.M.S. Bulldog sailed on!", "Then what?"]);
    expect(s[1].start).toBe(20);
  });
});

describe("spoken query parsing", () => {
  it("strips command phrasing in English", () => {
    expect(parseSpokenQuery("Find the part that talks about the sea floor").topic).toBe("sea floor");
    expect(parseSpokenQuery("Where does the author explain the main argument?").topic).toBe("main argument");
  });
  it("strips command phrasing in Portuguese and detects read-aloud", () => {
    const r = parseSpokenQuery("Encontre a conclusão e leia esse trecho");
    expect(r.topic).toBe("conclusão");
    expect(r.readAloud).toBe(true);
    expect(parseSpokenQuery("Localize o parágrafo sobre os riscos financeiros").topic).toBe("riscos financeiros");
  });
});

describe("BM25 passage search", () => {
  const index = new Bm25Index(buildPassages(blocks));
  it("finds the deep-sea soundings passage with high confidence", () => {
    const r = index.search("deep sea soundings Atlantic");
    expect(r.confidence).toBe("high");
    expect(r.hits[0].excerpt.toLowerCase()).toMatch(/sounding|atlantic/);
    expect(r.hits[0].n).toBeGreaterThan(1);
  });
  it("returns an honest no-match for text that is not in the document", () => {
    const r = index.search("quantum chromodynamics gluon");
    expect(r.hits).toHaveLength(0);
    expect(r.confidence).toBe("none");
  });
  it("reports low confidence for partial matches", () => {
    const r = index.search("Norwich spaceship");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.confidence).toBe("low");
  });
  it("keeps offsets that point back into the block text", () => {
    const r = index.search("Globigerina ooze");
    const h = r.hits[0];
    const b = blocks.find((x) => x.id === h.blockId)!;
    expect(b.text.slice(h.start, h.end)).toBe(h.excerpt);
  });
});
