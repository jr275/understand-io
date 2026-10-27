import { describe, expect, it } from "vitest";
import { AiOpError, coverageOf, extractJson, planChunks, runAiOp, salvageItems, type AiOpInput, type Generate, type OpBlock } from "@/lib/ai/ops";

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

describe("runAiOp: study notes", () => {
  const withHeadings = (): OpBlock[] => [{ id: "h1", type: "h2", text: "Why tides move" }, ...blocks(4)];

  it("asks for the study sections, gives the model the outline and room to answer, and returns a summary of variant study", async () => {
    let seen: { system: string; prompt: string; maxOutputTokens: number } | undefined;
    const generate: Generate = async (a) => {
      seen = a;
      return reply({
        items: [
          { label: "Outline", text: "Tides rise and fall with the moon.", basis: "interpretation", evidence: [] },
          { label: "Concepts and definitions", text: "Tide: the rise of water when the moon passes overhead.", basis: "text", evidence: [{ id: "p2", quote: "tide 2 rises when the moon passes overhead" }] },
          { label: "Recall question", text: "What happens to the tide after the moon has passed?", basis: "interpretation", evidence: [] },
        ],
        caveats: [],
      });
    };
    const { result } = await runAiOp(input({ variant: "study", blocks: withHeadings(), totalParagraphs: 4 }), generate);
    expect(result.kind).toBe("summary");
    if (result.kind !== "summary") return;
    expect(result.variant).toBe("study");
    expect(result.items.map((i) => i.label)).toEqual(["Outline", "Concepts and definitions", "Recall question"]);
    for (const label of ["Outline", "Concepts and definitions", "Claims and evidence", "Relationships", "Key takeaways", "Recall question", "Glossary"]) expect(seen!.prompt + seen!.system).toContain(`"${label}"`);
    expect(seen!.prompt).toContain("Outline of the text you were given");
    expect(seen!.prompt).toContain("- Why tides move");
    expect(seen!.maxOutputTokens).toBe(5000);
  });

  it("holds study notes to the same rule as every summary: a claim with no real quote is shown as interpretation", async () => {
    const generate: Generate = async () =>
      reply({ items: [{ label: "Claims and evidence", text: "The author proves tides are caused by wind.", basis: "text", evidence: [{ id: "p1", quote: "tides are caused entirely by the wind, as proven here" }] }], caveats: [] });
    const { result } = await runAiOp(input({ variant: "study" }), generate);
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.items[0]).toMatchObject({ basis: "interpretation", unverified: true, evidence: [] });
  });
});

describe("long answers and long texts", () => {
  const ok = (text = "A note.") => reply({ items: [{ text, basis: "interpretation" }] });

  it("study notes and detailed summaries get room for a long answer, and are told to stay within an item count", async () => {
    const seen: { system: string; maxOutputTokens: number }[] = [];
    const generate: Generate = async (a) => {
      seen.push({ system: a.system, maxOutputTokens: a.maxOutputTokens });
      return ok();
    };
    await runAiOp(input({ variant: "study" }), generate);
    await runAiOp(input({ variant: "detailed" }), generate);
    expect(seen[0].maxOutputTokens).toBeGreaterThanOrEqual(5000);
    expect(seen[0].system).toMatch(/at most 24 items in total/);
    expect(seen[1].maxOutputTokens).toBeGreaterThanOrEqual(3200);
    expect(seen[1].system).toMatch(/at most 16 items in total/);
  });

  // 24 paragraphs of 3000 characters: far more than one call reads, so the text is read section by section.
  const long = Array.from({ length: 24 }, (_, k) => para(k + 1, `${BODY(k + 1)} ${"The tide goes in and out. ".repeat(110)}`));
  const longInput = () => input({ variant: "study", blocks: long, totalParagraphs: 24 });
  const isSection = (system: string) => /This is one section/.test(system);
  const sectionOf = (system: string) => /paragraphs (\d+) to (\d+)/.exec(system)!.slice(1).map(Number);

  it("a section the model cannot answer is left out, the others still make the summary, and the reader is told what was not read", async () => {
    let failedRange: number[] | undefined;
    const generate: Generate = async (a) => {
      if (!isSection(a.system)) return ok("Combined notes.");
      const range = sectionOf(a.system);
      failedRange ??= range; // the first section asked for is the one that fails, on both attempts
      if (range[0] === failedRange[0]) return { text: "I could not produce JSON for this.", inputTokens: 1, outputTokens: 1 };
      return ok(`Notes on ${range.join("-")}.`);
    };
    const { result } = await runAiOp(longInput(), generate);
    expect(result.kind).toBe("summary");
    if (result.kind !== "summary") return;
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.used).toBeLessThan(24);
    expect(result.coverage.note).toMatch(/not read/);
    expect(result.caveats.join(" ")).toMatch(/1 section of the text could not be summarised/);
  });

  it("when the sections that were read are not one stretch, the coverage says there are gaps instead of claiming a range", () => {
    const read = [...blocks(3), ...blocks(9).slice(6)]; // paragraphs 1-3 and 7-9
    const c = coverageOf(read, 9, true);
    expect(c.complete).toBe(false);
    expect(c.note).toMatch(/with gaps/);
    expect(c.note).not.toMatch(/paragraphs 1 to 9/);
  });

  it("when no section can be read, the answer is the plain refusal, not an empty summary", async () => {
    const generate: Generate = async () => ({ text: "no", inputTokens: 1, outputTokens: 1 });
    await expect(runAiOp(longInput(), generate)).rejects.toMatchObject({ code: "bad-output" });
  });

  it("a timeout or a reader who leaves is not mistaken for an unusable section: it ends the request", async () => {
    const generate: Generate = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    await expect(runAiOp(longInput(), generate)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("reading a long text section by section", () => {
  it("asks for a short set of notes per section, so the combining step has less to read and the sections finish sooner", async () => {
    const long = Array.from({ length: 24 }, (_, k) => para(k + 1, `${BODY(k + 1)} ${"The tide goes in and out. ".repeat(110)}`));
    const systems: string[] = [];
    const generate: Generate = async (a) => {
      systems.push(a.system);
      return reply({ items: [{ text: "A note.", basis: "interpretation" }] });
    };
    await runAiOp(input({ variant: "quick", blocks: long, totalParagraphs: 24 }), generate);
    const sections = systems.filter((s) => /This is one section/.test(s));
    expect(sections.length).toBeGreaterThan(1);
    for (const s of sections) expect(s).toMatch(/five to eight short notes/);
  });
});

describe("a reply that was cut off", () => {
  const item = (text: string, extra = "") => `{"text":${JSON.stringify(text)},"basis":"interpretation"${extra}}`;

  it("salvageItems keeps the complete items and drops the one that was being written", () => {
    const cut = `{"items":[${item("One.")},${item("Two.")},{"text":"Thr`;
    expect(salvageItems(cut)).toEqual({ items: [{ text: "One.", basis: "interpretation" }, { text: "Two.", basis: "interpretation" }] });
  });
  it("follows strings: braces, brackets, quotes and escapes inside an item do not end it", () => {
    const tricky = 'He said "stop" } and then ] left { alone \\ done';
    const cut = `\`\`\`json\n{"items":[${item(tricky)},{"text":"cut off in the mid`;
    expect(salvageItems(cut)).toEqual({ items: [{ text: tricky, basis: "interpretation" }] });
  });
  it("answers null when there is no complete item or no items at all", () => {
    expect(salvageItems('{"items":[{"text":"Thr')).toBeNull();
    expect(salvageItems("I cannot do that.")).toBeNull();
    expect(salvageItems('{"other":[{"a":1}]}')).toBeNull();
  });
  it("a whole reply is read as before (salvage never replaces a complete answer)", () => {
    expect(salvageItems(`{"items":[${item("One.")}],"caveats":["x"]}`)).toEqual({ items: [{ text: "One.", basis: "interpretation" }] });
  });

  it("a final answer that is cut off keeps its complete items, says so, and is not asked for again", async () => {
    let calls = 0;
    const generate: Generate = async () => {
      calls += 1;
      return { text: `{"items":[${item("First idea.")},${item("Second idea.")},{"text":"Third id`, inputTokens: 10, outputTokens: 5000 };
    };
    const { result } = await runAiOp(input({ variant: "study" }), generate);
    expect(calls).toBe(1);
    expect(result.kind).toBe("summary");
    if (result.kind !== "summary") return;
    expect(result.items.map((i) => i.text)).toEqual(["First idea.", "Second idea."]);
    expect(result.caveats.join(" ")).toMatch(/cut off before it ended, so only the complete items are shown/);
  });

  it("salvaged items are still checked against the text: a quote that is not there leaves the item flagged, not supported", async () => {
    const generate: Generate = async () => ({
      text: `{"items":[{"text":"Claimed from the text.","basis":"text","evidence":[{"id":"p1","quote":"words that are not in paragraph one at all"}]},{"text":"Cut`,
      inputTokens: 1,
      outputTokens: 1,
    });
    const { result } = await runAiOp(input({ variant: "study" }), generate);
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.items[0]).toMatchObject({ basis: "interpretation", unverified: true, evidence: [] });
  });

  it("a reply with nothing complete is still asked for once more, then refused", async () => {
    let calls = 0;
    const generate: Generate = async () => {
      calls += 1;
      return { text: '{"items":[{"text":"Thr', inputTokens: 1, outputTokens: 1 };
    };
    await expect(runAiOp(input({ variant: "study" }), generate)).rejects.toMatchObject({ code: "bad-output" });
    expect(calls).toBe(2);
  });

  it("a section whose notes are cut off is kept with what arrived, and the summary says so", async () => {
    const long = Array.from({ length: 21 }, (_, k) => para(k + 1, `${BODY(k + 1)} ${"The tide goes in and out. ".repeat(110)}`));
    let firstSection = true;
    const generate: Generate = async (a) => {
      if (!/This is one section/.test(a.system)) return reply({ items: [{ text: "Combined notes.", basis: "interpretation" }] });
      if (firstSection) {
        firstSection = false;
        return { text: `{"items":[${item("A note that arrived.")},{"text":"A note that was cu`, inputTokens: 1, outputTokens: 900 };
      }
      return reply({ items: [{ text: "A note.", basis: "interpretation" }] });
    };
    const { result } = await runAiOp(input({ variant: "quick", blocks: long, totalParagraphs: 21 }), generate);
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.coverage.complete).toBe(true); // every section contributed something
    expect(result.caveats.join(" ")).toMatch(/notes on 1 section were cut off/);
  });
});
