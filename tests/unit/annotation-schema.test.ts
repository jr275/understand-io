import { describe, expect, it } from "vitest";
import { AnnotationPatchZ, AnnotationZ, GlossZ, ProgressZ } from "@/lib/anchors/schema";

/** ANNOT-9 / SEC-14: every input the audit found accepted-but-bad must now be refused, and a normal annotation still passes. */
const NOW = Date.now();
const good = () => ({
  id: "abcdefghij12",
  documentId: "sample:on-a-piece-of-chalk",
  kind: "highlight" as const,
  color: "yellow" as const,
  anchor: { start: { b: "p1", o: 4 }, end: { b: "p1", o: 17 }, quote: "chalk is soft", prefix: "The ", suffix: ". The chalk is white." },
  createdAt: NOW,
  updatedAt: NOW,
});
type Mut = (a: ReturnType<typeof good>) => unknown;
const withAnchor = (p: Record<string, unknown>): Mut => (a) => ({ ...a, anchor: { ...a.anchor, ...p } });

describe("AnnotationZ", () => {
  it("accepts a normal annotation, a multi-block one, a note, and a legacy one without the newer optional fields", () => {
    expect(AnnotationZ.safeParse(good()).success).toBe(true);
    expect(AnnotationZ.safeParse({ ...good(), kind: "note", note: "my note\nsecond line 👍🏽", anchor: { start: { b: "p1", o: 30 }, end: { b: "p2", o: 4 }, quote: "te.\nOver" } }).success).toBe(true);
    expect(AnnotationZ.safeParse({ ...good(), anchor: { ...good().anchor, prevBlock: "tail of the previous", nextBlock: "head of the next" } }).success).toBe(true);
    expect(AnnotationZ.safeParse({ ...good(), createdAt: NOW + 3_600_000 }).success).toBe(true); // a clock an hour ahead is fine
  });

  const bad: [string, Mut][] = [
    ["5 MB quote", withAnchor({ quote: "x".repeat(5_000_000), end: { b: "p1", o: 5_000_004 } })],
    ["quote just over 20000", withAnchor({ quote: "x".repeat(20_001), end: { b: "p1", o: 20_005 } })],
    ["1 MB prefix", withAnchor({ prefix: "x".repeat(1_000_000) })],
    ["65-char suffix", withAnchor({ suffix: "x".repeat(65) })],
    ["1 MB block id", (a) => ({ ...a, anchor: { ...a.anchor, start: { b: "x".repeat(1_000_000), o: 0 }, end: { b: "x".repeat(1_000_000), o: 13 } } })],
    ["empty block id", (a) => ({ ...a, anchor: { ...a.anchor, start: { b: "", o: 4 } } })],
    ["offset 9e15 with end before start", withAnchor({ start: { b: "p1", o: 9e15 }, end: { b: "p1", o: 1 } })],
    ["offset above 10 million", withAnchor({ end: { b: "p1", o: 10_000_001 } })],
    ["end before start in the same block", withAnchor({ start: { b: "p1", o: 17 }, end: { b: "p1", o: 4 } })],
    ["end offset that does not match the quote", withAnchor({ end: { b: "p1", o: 999_999 } })],
    ["non-integer offset", withAnchor({ end: { b: "p1", o: 17.5 } })],
    ["empty quote", withAnchor({ quote: "", end: { b: "p1", o: 4 } })],
    ["whitespace-only quote", withAnchor({ quote: "   ", end: { b: "p1", o: 7 } })],
    ["lone-surrogate quote", withAnchor({ quote: "ab\udc4d", end: { b: "p1", o: 7 } })],
    ["lone high surrogate in the prefix", withAnchor({ prefix: "a\ud83d" })],
    ["lone surrogate in a note", (a) => ({ ...a, kind: "note", note: "x\ud800y" })],
    ["note over 5000", (a) => ({ ...a, kind: "note", note: "x".repeat(5001) })],
    ["createdAt 1e300", (a) => ({ ...a, createdAt: 1e300 })],
    ["updatedAt beyond the Date range", (a) => ({ ...a, updatedAt: 8.64e15 + 1 })],
    ["fractional timestamp", (a) => ({ ...a, updatedAt: NOW + 0.5 })],
    ["negative timestamp", (a) => ({ ...a, createdAt: -1 })],
    ["timestamp two days ahead", (a) => ({ ...a, updatedAt: NOW + 2 * 86_400_000 })],
    ["id with a space", (a) => ({ ...a, id: "abc def ghij" })],
    ["id with a slash", (a) => ({ ...a, id: "abc/../ghij" })],
    ["4-char-minimum violated", (a) => ({ ...a, id: "abc" })],
    ["document id with a space", (a) => ({ ...a, documentId: "my doc" })],
    ["bad colour", (a) => ({ ...a, color: "red" })],
  ];
  it.each(bad)("rejects %s", (_name, mut) => {
    expect(AnnotationZ.safeParse(mut(good())).success).toBe(false);
  });
});

describe("AnnotationPatchZ", () => {
  it("accepts a client timestamp and the editable fields; refuses the same bad values", () => {
    expect(AnnotationPatchZ.safeParse({ note: "ok", updatedAt: NOW }).success).toBe(true);
    expect(AnnotationPatchZ.safeParse({ color: "pink" }).success).toBe(true); // older clients send no updatedAt
    expect(AnnotationPatchZ.safeParse({ note: "x".repeat(5001) }).success).toBe(false);
    expect(AnnotationPatchZ.safeParse({ note: "x\udc00" }).success).toBe(false);
    expect(AnnotationPatchZ.safeParse({ updatedAt: 1e300 }).success).toBe(false);
    expect(AnnotationPatchZ.safeParse({ updatedAt: 1.5 }).success).toBe(false);
  });
});

describe("GlossZ and ProgressZ", () => {
  const gloss = () => ({ id: "gloss0000001", documentId: "sample:on-a-piece-of-chalk", action: "explain", anchor: good().anchor, turns: [{ role: "assistant", content: "An answer." }], createdAt: NOW });
  it("accept normal input, including a whole-text gloss with no anchor", () => {
    expect(GlossZ.safeParse(gloss()).success).toBe(true);
    expect(GlossZ.safeParse({ ...gloss(), action: "whole", anchor: null, usage: { input: 10, output: 20, cost: 0.0012 }, model: "m/x" }).success).toBe(true);
    expect(ProgressZ.safeParse({ documentId: "sample:on-a-piece-of-chalk", blockId: "p12", ratio: 0.4, finished: false, updatedAt: NOW }).success).toBe(true);
  });
  it.each<[string, Record<string, unknown>]>([
    ["unknown action", { action: "hack" }],
    ["a gloss anchor with a 1 MB quote", { anchor: { ...good().anchor, quote: "x".repeat(1_000_000), end: { b: "p1", o: 1_000_004 } } }],
    ["a gloss anchor whose end precedes its start", { anchor: { ...good().anchor, start: { b: "p1", o: 30 } } }],
    ["a lone surrogate in a turn", { turns: [{ role: "assistant", content: "x\ud800" }] }],
    ["a timestamp beyond the Date range", { createdAt: 1e300 }],
    ["a negative token count", { usage: { input: -1, output: 1 } }],
  ])("GlossZ rejects %s", (_n, patch) => {
    expect(GlossZ.safeParse({ ...gloss(), ...patch }).success).toBe(false);
  });
  it.each<[string, Record<string, unknown>]>([
    ["a 1 MB block id", { blockId: "x".repeat(1_000_000) }],
    ["a ratio above 1", { ratio: 1.5 }],
    ["a NaN-like ratio", { ratio: Number.NaN }],
    ["a timestamp of 1e300", { updatedAt: 1e300 }],
    ["a bad document id", { documentId: "a b" }],
  ])("ProgressZ rejects %s", (_n, patch) => {
    expect(ProgressZ.safeParse({ documentId: "sample:x", ratio: 0.5, updatedAt: NOW, ...patch }).success).toBe(false);
  });
});
