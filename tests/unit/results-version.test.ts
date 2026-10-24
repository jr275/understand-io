import { describe, expect, it } from "vitest";
import { findReusable, regenerable, versionOf } from "@/lib/ai/results";
import type { AiResult, Coverage, Gloss, GlossResult } from "@/lib/content/types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const cov = (over: Partial<Coverage> = {}): Coverage => ({ used: 5, total: 5, from: 1, to: 5, complete: true, ...over });
const gloss = (result: GlossResult | undefined, over: Partial<Gloss> = {}): Gloss => ({ id: Math.random().toString(36).slice(2), documentId: "d", action: "summarize", anchor: null, turns: [], createdAt: 1, status: "done", result, ...over });
const summary = (variant: "quick" | "study" | "passage", docHash?: string, outLang?: string, c = cov()): AiResult => ({ kind: "summary", variant, items: [], caveats: [], coverage: c, docHash, outLang });

describe("versionOf", () => {
  it("is current when the result was written for the text now on screen", () => {
    expect(versionOf(gloss(summary("quick", HASH_A)), HASH_A)).toBe("current");
  });
  it("is earlier only when the result recorded another text", () => {
    expect(versionOf(gloss(summary("quick", HASH_A)), HASH_B)).toBe("earlier");
  });
  it("is unknown, never earlier, for a result made before versions were recorded", () => {
    expect(versionOf(gloss(summary("quick")), HASH_B)).toBe("unknown");
  });
  it("is unknown while the current text's hash is not yet known, and for a gloss with no structured result", () => {
    expect(versionOf(gloss(summary("quick", HASH_A)), "")).toBe("unknown");
    expect(versionOf(gloss(undefined), HASH_A)).toBe("unknown");
    expect(versionOf(gloss({ kind: "stream", context: [], coverage: cov() }), HASH_A)).toBe("unknown");
  });
});

describe("regenerable", () => {
  it("names the operation a document-level result can be made again with", () => {
    expect(regenerable(gloss(summary("study", HASH_A)))).toEqual({ op: "summarize", variant: "study" });
    expect(regenerable(gloss({ kind: "concepts", items: [], caveats: [], coverage: cov() }))).toEqual({ op: "concepts" });
    expect(regenerable(gloss({ kind: "questions", items: [], caveats: [], coverage: cov() }))).toEqual({ op: "questions" });
  });
  it("is null for a passage summary, a translation and a streamed answer", () => {
    expect(regenerable(gloss(summary("passage", HASH_A)))).toBeNull();
    expect(regenerable(gloss({ kind: "translation", sourceLang: "en", targetLang: "pt", original: "a", natural: "b", notes: [], contextUsed: false }))).toBeNull();
    expect(regenerable(gloss({ kind: "stream", context: [], coverage: cov() }))).toBeNull();
  });
});

describe("findReusable", () => {
  const want = { op: "summarize" as const, variant: "quick" as const, outLang: "" };

  it("finds a finished result for the same operation, text and language, newest first", () => {
    const older = gloss(summary("quick", HASH_A), { createdAt: 1 });
    const newer = gloss(summary("quick", HASH_A), { createdAt: 2 });
    expect(findReusable([newer, older], want, HASH_A)).toBe(newer);
  });
  it("does not reuse a result for another variant, another text or another language", () => {
    expect(findReusable([gloss(summary("study", HASH_A))], want, HASH_A)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A))], want, HASH_B)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A, "pt"))], want, HASH_A)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A, "pt"))], { ...want, outLang: "pt" }, HASH_A)).not.toBeNull();
  });
  it("does not reuse a result of unknown version, one that is still running or failed, or one that began part-way", () => {
    expect(findReusable([gloss(summary("quick"))], want, HASH_A)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A), { status: "streaming" })], want, HASH_A)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A), { status: "error" })], want, HASH_A)).toBeNull();
    expect(findReusable([gloss(summary("quick", HASH_A, "", cov({ from: 40, to: 60, complete: false })))], want, HASH_A)).toBeNull();
  });
  it("reuses nothing before the current hash is known", () => {
    expect(findReusable([gloss(summary("quick", HASH_A))], want, "")).toBeNull();
  });
  it("matches concepts and questions by operation alone", () => {
    const concepts = gloss({ kind: "concepts", items: [], caveats: [], coverage: cov(), docHash: HASH_A, outLang: "" });
    expect(findReusable([concepts], { op: "concepts", outLang: "" }, HASH_A)).toBe(concepts);
    expect(findReusable([concepts], { op: "questions", outLang: "" }, HASH_A)).toBeNull();
  });
});
