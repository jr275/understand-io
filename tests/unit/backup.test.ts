import { describe, expect, it } from "vitest";
import { MAX_BACKUP_BYTES, allNotesMarkdown, buildBackup, parseBackup, planRestore } from "@/lib/store/backup";
import type { Annotation, Block, Gloss, GlossDocument, ReadingProgress } from "@/lib/content/types";

const B = (id: string, text: string, n?: number): Block => ({ id, type: "p", text, n });
const doc = (slug: string, text = "The first sentence. The second sentence."): GlossDocument => ({ id: `local:${slug}`, slug, kind: "text", title: `Title ${slug}`, topic: "writing", minutes: 2, paragraphs: 1, blocks: [B("p1", text, 1)] });
const mark = (id: string, documentId: string, quote = "The first sentence", extra: Partial<Annotation> = {}): Annotation => ({ id, documentId, kind: "highlight", color: "yellow", anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: quote.length }, quote }, createdAt: 1000, updatedAt: 1000, ...extra });
const ask = (id: string, documentId: string, extra: Partial<Gloss> = {}): Gloss => ({ id, documentId, action: "ask", anchor: null, turns: [{ role: "user", content: "Why?" }, { role: "assistant", content: "Because." }], createdAt: 1000, ...extra });
const pos = (documentId: string, updatedAt: number, ratio = 0.5): ReadingProgress => ({ documentId, blockId: "p1", ratio, updatedAt });

const state = (over: Partial<Parameters<typeof buildBackup>[0]> = {}) => ({ docs: {}, progress: {}, annotations: {}, glosses: {}, ...over });

describe("buildBackup", () => {
  it("keeps the texts that live only here, with the marks, questions and positions for them and for the samples", () => {
    const a = doc("alpha");
    const server: GlossDocument = { ...doc("beta"), id: "7b0c8d0e-1111-2222-3333-444455556666", blocks: [] };
    const b = buildBackup(
      state({
        docs: { alpha: a, beta: server },
        annotations: { "local:alpha": [mark("aaaa1", "local:alpha", undefined, { syncedAt: 5 })], "sample:on-a-piece-of-chalk": [mark("bbbb2", "sample:on-a-piece-of-chalk")], [server.id as string]: [mark("cccc3", server.id as string)] },
        glosses: { "local:alpha": [ask("gggg1", "local:alpha"), ask("gggg2", "local:alpha", { status: "streaming" })] },
        progress: { "local:alpha": pos("local:alpha", 10) },
      }),
      new Date("2026-10-18T12:00:00Z"),
    );
    expect(b.docs.map((d) => d.slug)).toEqual(["alpha"]);
    expect(Object.keys(b.annotations).sort()).toEqual(["local:alpha", "sample:on-a-piece-of-chalk"]);
    expect(b.annotations["local:alpha"][0]).not.toHaveProperty("syncedAt");
    expect(b.glosses["local:alpha"].map((g) => g.id)).toEqual(["gggg1"]);
    expect(b.progress["local:alpha"].ratio).toBe(0.5);
    expect(b.exportedAt).toBe("2026-10-18T12:00:00.000Z");
  });
});

describe("parseBackup", () => {
  const good = () => JSON.stringify(buildBackup(state({ docs: { alpha: doc("alpha") }, annotations: { "local:alpha": [mark("aaaa1", "local:alpha")] } })));

  it("reads what buildBackup wrote, unchanged", () => {
    const r = parseBackup(good());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.docs[0].blocks[0].text).toContain("first sentence");
      expect(r.backup.annotations["local:alpha"][0].anchor.quote).toBe("The first sentence");
    }
  });

  it.each([
    ["not JSON", "nope{", /not valid JSON/],
    ["JSON that is not a backup", JSON.stringify({ hello: 1 }), /not an Understand\.io backup/],
    ["another version", JSON.stringify({ app: "understand-io", version: 2 }), /different version/],
  ])("refuses %s with a plain reason", (_n, raw, reason) => {
    const r = parseBackup(raw as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(reason as RegExp);
  });

  it("refuses a file too large to be a backup before parsing it, and one that is not JSON", () => {
    const big = parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/too large/);
    const bad = parseBackup("not json at all");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/not valid JSON/);
  });

  it("refuses a damaged backup as a whole, so nothing is half restored", () => {
    const j = JSON.parse(good());
    j.annotations["local:alpha"][0].anchor.end.o = 3; // offsets no longer match the quote
    const r = parseBackup(JSON.stringify(j));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/damaged/);
  });

  it("never keeps an address that is not a web address (no javascript: links or data: images)", () => {
    const j = JSON.parse(good());
    j.docs[0].blocks[0].runs = [{ text: "x", href: "javascript:alert(1)" }];
    expect(parseBackup(JSON.stringify(j)).ok).toBe(false);
    const k = JSON.parse(good());
    k.docs[0].sourceUrl = "data:text/html,<script>1</script>";
    expect(parseBackup(JSON.stringify(k)).ok).toBe(false);
  });

  it("gives every restored text the local id for its address, whatever the file says", () => {
    const j = JSON.parse(good());
    j.docs[0].id = "someone-elses-id";
    const r = parseBackup(JSON.stringify(j));
    expect(r.ok && r.backup.docs[0].id).toBe("local:alpha");
  });
});

describe("planRestore", () => {
  const backup = () => {
    const r = parseBackup(
      JSON.stringify(
        buildBackup(
          state({
            docs: { alpha: doc("alpha"), gamma: doc("gamma") },
            annotations: { "local:alpha": [mark("aaaa1", "local:alpha"), mark("aaaa2", "local:alpha")], "local:gamma": [mark("gggg9", "local:gamma")], "sample:walden-reading": [mark("ssss1", "sample:walden-reading")] },
            glosses: { "local:alpha": [ask("qqqq1", "local:alpha")] },
            progress: { "local:alpha": pos("local:alpha", 500, 0.8) },
          }),
        ),
      ),
    );
    if (!r.ok) throw new Error(r.error);
    return r.backup;
  };

  it("adds everything to an empty library", () => {
    const p = planRestore(state(), backup());
    expect(p.counts).toMatchObject({ docs: 2, marks: 4, questions: 1, positions: 1, skippedDocs: 0, skippedMarks: 0 });
  });

  it("never replaces a text already on the shelf, and does not duplicate a mark or question already there", () => {
    const mine = { ...doc("alpha", "My own, different words."), title: "Edited by me" };
    const cur = state({ docs: { alpha: mine }, annotations: { "local:alpha": [mark("aaaa1", "local:alpha")] }, glosses: { "local:alpha": [ask("qqqq1", "local:alpha")] } });
    const p = planRestore(cur, backup());
    expect(p.docs.map((d) => d.slug)).toEqual(["gamma"]);
    expect(p.counts.skippedDocs).toBe(1);
    expect(p.annotations["local:alpha"].map((a) => a.id)).toEqual(["aaaa2"]);
    expect(p.glosses["local:alpha"]).toBeUndefined();
    expect(mine.title).toBe("Edited by me");
  });

  it("takes a reading position only when it is newer", () => {
    const newer = planRestore(state({ docs: { alpha: doc("alpha") }, progress: { "local:alpha": pos("local:alpha", 100, 0.1) } }), backup());
    expect(newer.progress["local:alpha"].ratio).toBe(0.8);
    const older = planRestore(state({ docs: { alpha: doc("alpha") }, progress: { "local:alpha": pos("local:alpha", 900, 0.95) } }), backup());
    expect(older.progress["local:alpha"]).toBeUndefined();
  });

  it("is idempotent: restoring what was just restored changes nothing", () => {
    const first = planRestore(state(), backup());
    const after = state({
      docs: Object.fromEntries(first.docs.map((d) => [d.slug, d])),
      annotations: first.annotations,
      glosses: first.glosses,
      progress: first.progress,
    });
    const second = planRestore(after, backup());
    expect(second.counts).toMatchObject({ docs: 0, marks: 0, questions: 0, positions: 0 });
  });

  it("leaves out, and counts, marks for a text that is neither here nor in the backup", () => {
    const b = backup();
    b.annotations["local:ghost"] = [mark("hhhh1", "local:ghost")];
    const p = planRestore(state(), b);
    expect(p.counts.skippedMarks).toBe(1);
    expect(p.annotations["local:ghost"]).toBeUndefined();
  });
});

describe("allNotesMarkdown", () => {
  it("writes one section per text that has notes, and nothing for a text without", () => {
    const md = allNotesMarkdown(state({ docs: { alpha: doc("alpha"), empty: doc("empty") }, annotations: { "local:alpha": [mark("aaaa1", "local:alpha", "The first sentence", { kind: "note", note: "Check this." })] } }) as never);
    expect(md).toContain("# Title alpha");
    expect(md).toContain("Check this.");
    expect(md).not.toContain("Title empty");
    expect(allNotesMarkdown(state({ docs: { alpha: doc("alpha") } }) as never)).toBe("");
  });
});
