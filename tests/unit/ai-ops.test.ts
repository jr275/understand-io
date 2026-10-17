import { describe, expect, it } from "vitest";
import { AiOpError, coverageOf, extractJson, planChunks, runAiOp, type AiOpInput, type Generate, type OpBlock } from "@/lib/ai/ops";

/** The model is a fake that returns what the test says; everything else (parsing, validation, evidence checks, coverage) is the real code. */
const para = (i: number, text: string): OpBlock => ({ id: `p${i}`, n: i, type: "p", text });
const BODY = (i: number) => `Paragraph number ${i} explains that tide ${i} rises when the moon passes overhead, and falls afterwards.`;
const blocks = (n: number) => Array.from({ length: n }, (_, k) => para(k + 1, BODY(k + 1)));
const reply = (obj: unknown): Awaited<ReturnType<Generate>> => ({ text: JSON.stringify(obj), inputTokens: 100, outputTokens: 50 });
const input = (over: Partial<AiOpInput> = {}): AiOpInput => ({ op: "summarize", variant: "quick", title: "Tides", author: "A. Writer", blocks: blocks(5), totalParagraphs: 5, ...over });

describe("extractJson", () => {
  it("reads plain, fenced and surrounded JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json at all")).toThrow();
  });
});

describe("planChunks and coverageOf", () => {
  it("splits by size and prefers heading boundaries once half full", () => {
    const bs: OpBlock[] = [...blocks(3), { id: "h1", type: "h2", text: "Next part" }, ...blocks(3).map((b) => ({ ...b, id: `q${b.n}`, n: b.n! + 3 }))];
    const chunks = planChunks(bs, 200);
    expect(chunks.flat()).toHaveLength(bs.length);
    expect(chunks.length).toBeGreaterThan(1);
    expect(planChunks(bs, 1_000_000)).toHaveLength(1);
  });
  it("says when only part of the text was read", () => {
    const c = coverageOf(blocks(5).slice(0, 3), 10, true);
    expect(c).toMatchObject({ used: 3, total: 10, from: 1, to: 3, complete: false });
    expect(c.note).toMatch(/paragraphs 1 to 3 of 10/);
    expect(coverageOf(blocks(5), 5, true).complete).toBe(true);
  });
});

describe("runAiOp: summaries", () => {
  it("verifies evidence, shows what could not be verified as interpretation, and reports full coverage", async () => {
    let seen: { system: string; prompt: string } | undefined;
    const generate: Generate = async (a) => {
      seen = a;
      return reply({
        items: [
          { text: "Tides follow the moon.", basis: "text", evidence: [{ id: "p2", quote: "tide 2 rises when the moon passes overhead" }] },
          { text: "Tides were studied by Newton.", basis: "text", evidence: [{ id: "p3", quote: "Newton explained the tides in 1687 precisely" }] },
        ],
        caveats: [],
      });
    };
    const { result, usage } = await runAiOp(input(), generate);
    expect(result.kind).toBe("summary");
    if (result.kind !== "summary") return;
    expect(result.items[0].basis).toBe("text");
    expect(result.items[0].evidence[0]).toMatchObject({ blockId: "p2", n: 2 });
    expect(result.items[1]).toMatchObject({ basis: "interpretation", unverified: true, evidence: [] });
    expect(result.caveats.join(" ")).toMatch(/could not be tied to a quote/);
    expect(result.coverage).toMatchObject({ used: 5, total: 5, complete: true });
    expect(usage).toEqual({ input: 100, output: 50 });
    expect(seen!.prompt).toContain("[p3] ¶3 Paragraph number 3");
    expect(seen!.system).toMatch(/ONE JSON object/);
  });

  it("retries once on invalid JSON and then succeeds, adding the usage of both calls", async () => {
    let calls = 0;
    const generate: Generate = async () => {
      calls++;
      return calls === 1 ? { text: "Sure! Here is a summary.", inputTokens: 10, outputTokens: 5 } : reply({ items: [{ text: "ok", basis: "interpretation" }] });
    };
    const { result, usage } = await runAiOp(input(), generate);
    expect(calls).toBe(2);
    expect(result.kind).toBe("summary");
    expect(usage.input).toBe(110);
  });

  it("fails clearly after two unusable replies", async () => {
    const generate: Generate = async () => ({ text: "nope", inputTokens: 1, outputTokens: 1 });
    await expect(runAiOp(input(), generate)).rejects.toMatchObject({ code: "bad-output" });
    await expect(runAiOp(input(), generate)).rejects.toBeInstanceOf(AiOpError);
  });

  it("rejects replies of the wrong shape (no items) the same way", async () => {
    const generate: Generate = async () => reply({ summary: "a string, not items" });
    await expect(runAiOp(input(), generate)).rejects.toMatchObject({ code: "bad-output" });
  });

  it("reads a long text section by section, then combines, and says which paragraphs it read", async () => {
    const long = Array.from({ length: 600 }, (_, k) => para(k + 1, `${BODY(k + 1)} ${"More words that pad the paragraph out to a realistic length. ".repeat(3)}`));
    const calls: string[] = [];
    const generate: Generate = async (a) => {
      calls.push(a.system.includes("one section") ? "map" : "reduce");
      return reply({ items: [{ text: "note", basis: "interpretation" }] });
    };
    const { result } = await runAiOp(input({ blocks: long, totalParagraphs: 600, variant: "executive" }), generate);
    expect(calls.filter((c) => c === "map").length).toBeGreaterThan(1);
    expect(calls.filter((c) => c === "map").length).toBeLessThanOrEqual(8);
    expect(calls[calls.length - 1]).toBe("reduce");
    if (result.kind !== "summary") throw new Error("kind");
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.to).toBeLessThan(600);
    expect(result.coverage.note).toMatch(/the rest of the text was not read/);
  });

  it("a passage summary uses only the selection, and its coverage says so", async () => {
    let prompt = "";
    const generate: Generate = async (a) => {
      prompt = a.prompt;
      return reply({ items: [{ text: "s", basis: "text", evidence: [{ id: "p2", quote: "tide 2 rises when the moon passes" }] }] });
    };
    const { result } = await runAiOp(input({ variant: "passage", selection: "tide 2 rises when the moon passes overhead", blocks: blocks(5).slice(1, 3), totalParagraphs: 5 }), generate);
    expect(prompt).toContain("Selected passage: “tide 2 rises when the moon passes overhead”");
    if (result.kind !== "summary") throw new Error("kind");
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.note).toMatch(/selected passage only/i);
    await expect(runAiOp(input({ variant: "passage" }), generate)).rejects.toMatchObject({ code: "bad-input" });
  });

  it("evidence may only point at paragraphs the model was given", async () => {
    const generate: Generate = async () => reply({ items: [{ text: "x", basis: "text", evidence: [{ id: "p5", quote: "tide 5 rises when the moon passes overhead" }] }] });
    const { result } = await runAiOp(input({ blocks: blocks(5).slice(0, 2), totalParagraphs: 5, variant: "quick" }), generate);
    if (result.kind !== "summary") throw new Error("kind");
    expect(result.items[0]).toMatchObject({ basis: "interpretation", unverified: true });
  });
});

describe("runAiOp: questions, concepts, translation", () => {
  it("returns comprehension questions with answers kept for later", async () => {
    const generate: Generate = async () => reply({ items: [{ text: "When does tide 4 rise?", answer: "When the moon passes overhead.", basis: "text", evidence: [{ id: "p4", quote: "tide 4 rises when the moon passes overhead" }] }] });
    const { result } = await runAiOp(input({ op: "questions" }), generate);
    if (result.kind !== "questions") throw new Error("kind");
    expect(result.items[0].answer).toBe("When the moon passes overhead.");
    expect(result.items[0].evidence).toHaveLength(1);
  });
  it("returns concepts with the term as the label", async () => {
    const generate: Generate = async () => reply({ items: [{ label: "Tide", text: "The rise and fall of the sea.", basis: "interpretation" }] });
    const { result } = await runAiOp(input({ op: "concepts" }), generate);
    if (result.kind !== "concepts") throw new Error("kind");
    expect(result.items[0].label).toBe("Tide");
  });
  it("translation keeps the reader's original text and never lets the model rewrite it", async () => {
    let prompt = "";
    const generate: Generate = async (a) => {
      prompt = a.prompt;
      return reply({ sourceLang: "EN", natural: "A maré sobe.", literal: "A maré sobe.", notes: ["idiom: none"] });
    };
    const { result } = await runAiOp(input({ op: "translate", selection: "The tide rises.", targetLang: "pt", blocks: [para(1, "Context paragraph about tides.")] }), generate);
    if (result.kind !== "translation") throw new Error("kind");
    expect(result).toMatchObject({ original: "The tide rises.", natural: "A maré sobe.", sourceLang: "en", targetLang: "pt", contextUsed: true });
    expect(result.literal).toBeUndefined(); // identical to the natural one: not repeated
    expect(prompt).toContain("SELECTED TEXT:\nThe tide rises.");
  });
  it("translation needs a selection and a target language", async () => {
    const generate: Generate = async () => reply({ natural: "x" });
    await expect(runAiOp(input({ op: "translate", targetLang: "pt" }), generate)).rejects.toMatchObject({ code: "bad-input" });
    await expect(runAiOp(input({ op: "translate", selection: "hello" }), generate)).rejects.toMatchObject({ code: "bad-input" });
  });
  it("nothing to read is an error, not an invented answer", async () => {
    const generate: Generate = async () => reply({ items: [{ text: "x" }] });
    await expect(runAiOp(input({ blocks: [] }), generate)).rejects.toMatchObject({ code: "no-content" });
  });
});
