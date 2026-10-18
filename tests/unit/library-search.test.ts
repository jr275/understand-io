import { describe, expect, it } from "vitest";
import { highlightTerms, markHref, passageHref, searchLibrary } from "@/lib/search/library";
import type { Annotation, Block, GlossDocument } from "@/lib/content/types";

const B = (id: string, text: string, n?: number): Block => ({ id, type: "p", text, n });
const doc = (slug: string, title: string, blocks: Block[], author?: string): GlossDocument => ({ id: `local:${slug}`, slug, kind: "text", title, author, topic: "writing", minutes: 3, paragraphs: blocks.length, blocks });
const mark = (id: string, documentId: string, quote: string, note?: string, kind: Annotation["kind"] = "highlight"): Annotation => ({
  id,
  documentId,
  kind,
  note,
  anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: quote.length }, quote },
  createdAt: 1,
  updatedAt: 1,
});

const chalk = doc(
  "chalk",
  "On a Piece of Chalk",
  [B("p1", "Chalk is a soft white limestone formed from the shells of tiny sea creatures.", 1), B("p2", "The cliffs of Dover are made of it, laid down over millions of years.", 2)],
  "Huxley",
);
const reading = doc("reading", "Reading", [B("p1", "Books are the carriers of civilisation, and without them history is silent.", 1), B("p2", "A man who reads nothing at all is no better off than a man who cannot.", 2)]);
const thinking = doc("thinking", "Thinking", [B("p1", "Reading is a mere substitute for thinking for oneself, and the mind goes slack.", 1)]);
const none = () => [];

describe("searchLibrary (where did I read about this?)", () => {
  it("finds the passage in the right text and names the text, with the paragraph and offsets that open it", () => {
    const r = searchLibrary([chalk, reading, thinking], none, "limestone shells");
    expect(r.passages).toHaveLength(1);
    const p = r.passages[0];
    expect([p.slug, p.title, p.author, p.hit.blockId, p.hit.n]).toEqual(["chalk", "On a Piece of Chalk", "Huxley", "p1", 1]);
    expect(chalk.blocks[0].text.slice(p.hit.start, p.hit.end)).toContain("limestone");
    expect(r.searched).toBe(3);
  });

  it("finds the same idea in several texts, and ranks first the text whose passage covers more of the question", () => {
    const r = searchLibrary([chalk, reading, thinking], none, "reads");
    expect(r.passages.map((p) => p.slug).sort()).toEqual(["reading", "thinking"]);
    // "reading thinking oneself": only one passage holds all three ideas; the text that holds one of three is left out, not listed as a match.
    const ranked = searchLibrary([chalk, reading, thinking], none, "reading thinking oneself");
    expect(ranked.passages.map((p) => p.slug)).toEqual(["thinking"]);
    expect(ranked.passages[0].confidence).toBe("high");
  });

  it("finds nothing for a question no text covers, rather than something loosely related", () => {
    const r = searchLibrary([chalk, reading, thinking], none, "quantum chromodynamics");
    expect(r.passages).toEqual([]);
    expect(r.marks).toEqual([]);
    expect(r.searched).toBe(3);
  });

  it("answers nothing under two characters, and never searches a text with no words", () => {
    expect(searchLibrary([chalk], none, "c").passages).toEqual([]);
    const account = { ...doc("on-account", "On the account", []), blocks: [] };
    const r = searchLibrary([chalk, account], none, "limestone");
    expect(r.unsearched).toBe(1);
    expect(r.searched).toBe(1);
  });

  it("finds the reader's own notes and highlights, notes first, and links each to its text", () => {
    const notes: Record<string, Annotation[]> = {
      "local:chalk": [mark("h1", "local:chalk", "formed from the shells of tiny sea creatures"), mark("n1", "local:chalk", "Chalk is a soft white limestone", "Compare with the coral argument", "note")],
      "local:reading": [mark("h2", "local:reading", "a man who reads nothing")],
    };
    const r = searchLibrary([chalk, reading], (d) => notes[d.id ?? ""] ?? [], "shells");
    expect(r.marks.map((m) => [m.annotation.id, m.in])).toEqual([["h1", "quote"]]);
    const byNote = searchLibrary([chalk, reading], (d) => notes[d.id ?? ""] ?? [], "coral");
    expect(byNote.marks.map((m) => [m.annotation.id, m.in, m.slug])).toEqual([["n1", "note", "chalk"]]);
    expect(markHref("chalk", "n1")).toBe("/read/chalk?hl=n1");
  });

  it("limits how much one text can contribute and how long the list is", () => {
    const many = doc("many", "Many", Array.from({ length: 10 }, (_, i) => B(`p${i}`, `Sentence number ${i} talks about gardens and orchards at length.`, i + 1)));
    const r = searchLibrary([many], none, "gardens orchards", { perDocument: 2, limit: 5 });
    expect(r.passages.length).toBeLessThanOrEqual(2);
  });

  it("builds a link the reader understands for a passage", () => {
    expect(passageHref("a b", { blockId: "p3", start: 4, end: 20 })).toBe("/read/a%20b?at=p3&s=4&e=20");
  });
});

describe("highlightTerms", () => {
  it("marks the words that matched, whatever their form, and keeps every character", () => {
    const text = "The Shells of sea creatures were shelled.";
    const runs = highlightTerms(text, ["shell"], "en");
    expect(runs.map((r) => r.text).join("")).toBe(text);
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["Shells", "shelled"]);
  });
  it("marks nothing when nothing matched", () => {
    expect(highlightTerms("Plain text.", ["zebra"], "en")).toEqual([{ text: "Plain text.", hit: false }]);
  });
});
