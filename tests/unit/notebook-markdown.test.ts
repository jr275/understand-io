import { describe, expect, it } from "vitest";
import { makeAnchor, resolveAll } from "@/lib/anchors";
import type { Annotation, Block, Gloss } from "@/lib/content/types";
import { notebookMarkdown } from "@/components/reader/notebookMarkdown";

/** ANNOT-16: the export is document-ordered, keeps multi-line quotes/notes inside their item, and cannot be turned into headings by a note. */
const blocks: Block[] = [
  { id: "p1", type: "p", n: 1, text: "The chalk is soft. The chalk is white." },
  { id: "p2", type: "p", n: 2, text: "Over the whole county the chalk is soft and deep." },
  { id: "p3", type: "p", n: 3, text: "A closing line." },
];
const T = Date.UTC(2026, 9, 17, 12); // 2026-10-17
const ann = (id: string, kind: Annotation["kind"], anchor: ReturnType<typeof makeAnchor>, over: Partial<Annotation> = {}): Annotation => ({ id, documentId: "d", kind, color: "green", anchor, createdAt: T, updatedAt: T, ...over });

describe("notebookMarkdown", () => {
  const doc = { title: "On a Piece of Chalk", author: "T. H. Huxley", sourceUrl: "https://example.org/chalk" };
  const second = ann("late", "highlight", makeAnchor(blocks, { b: "p3", o: 0 }, { b: "p3", o: 9 }), { createdAt: T - 1000 }); // created first, but later in the text
  const first = ann("early", "note", makeAnchor(blocks, { b: "p1", o: 30 }, { b: "p2", o: 4 }), { note: "line one\n# not a heading\n- not a list\nlast line", createdAt: T });
  const under = ann("ul", "underline", makeAnchor(blocks, { b: "p2", o: 26 }, { b: "p2", o: 39 }), { color: undefined, createdAt: T + 86_400_000 });
  const lost: Annotation = ann("gone", "highlight", { start: { b: "p9", o: 0 }, end: { b: "p9", o: 20 }, quote: "a sentence that was removed from the text" }, { color: "pink", note: "kept anyway" });
  const gloss: Gloss = { id: "g1", documentId: "d", action: "explain", anchor: makeAnchor(blocks, { b: "p2", o: 0 }, { b: "p2", o: 4 }), turns: [{ role: "assistant", content: "It means **this**.\n# and more" }], createdAt: T, status: "done" };

  const md = notebookMarkdown({ doc, blocks, annotations: resolveAll(blocks, [second, lost, first, under]), glosses: resolveAll(blocks, [gloss]) });

  it("matches the expected document (order by position in the text, colour, ISO date, orphans last and labelled)", () => {
    expect(md).toBe(`# On a Piece of Chalk
*T. H. Huxley*
Source: https://example.org/chalk

## Explain (¶2), 2026-10-17
> Over

**A:** It means this.
\\# and more

## Highlights and notes

- **Note** (¶1, green, 2026-10-17)
  > s white.
  > Over

  line one
  \\# not a heading
  \\- not a list
  last line

- **Underline** (¶2, 2026-10-18)
  > chalk is soft

- **Highlight** (¶3, green, 2026-10-17)
  > A closing

## Passages that could not be found in the text any more

- **Highlight** (pink, 2026-10-17) (couldn't find this passage)
  > a sentence that was removed from the text

  kept anyway
`);
  });

  it("keeps every multi-line quote and note inside its own list item and creates no headings of its own", () => {
    const headings = md.split("\n").filter((l) => /^#{1,6}\s/.test(l));
    expect(headings).toEqual(["# On a Piece of Chalk", "## Explain (¶2), 2026-10-17", "## Highlights and notes", "## Passages that could not be found in the text any more"]);
    const section = md.slice(md.indexOf("## Highlights and notes"));
    for (const l of section.split("\n").filter(Boolean)) expect(l.startsWith("#") || l.startsWith("- ") || l.startsWith("  ")).toBe(true);
  });

  it("an empty notebook exports just the title", () => {
    expect(notebookMarkdown({ doc: { title: "T" }, blocks, annotations: [], glosses: [] })).toBe("# T\n");
  });
});
