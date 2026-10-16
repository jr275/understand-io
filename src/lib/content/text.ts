import type { Block, GlossDocument, Run } from "./types";
import { readingMinutes, slugFor } from "./slug";

/** Inline markdown-ish runs: *em*, **strong**, `code`. */
export function runsFromText(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), strong: true });
    else if (tok.startsWith("`")) out.push({ text: tok.slice(1, -1), code: true });
    else out.push({ text: tok.slice(1, -1), em: true });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function finishBlocks(raw: Omit<Block, "n" | "text" | "id">[]): Block[] {
  let n = 0;
  return raw.map((b, i) => {
    const runs = b.runs ?? [];
    const text = runs.map((r) => r.text).join("");
    const numbered = b.type !== "h2" && b.type !== "h3";
    if (numbered) n += 1;
    return { ...b, id: b.type === "h2" || b.type === "h3" ? `h${i + 1}` : `p${n}`, n: numbered ? n : undefined, text, runs };
  });
}

/** Plain text or markdown → blocks. Blank lines separate paragraphs; `#` headings; `>` quotes; `-` lists. */
export function blocksFromText(input: string): Block[] {
  const paras = input.replace(/\r\n?/g, "\n").split(/\n\s*\n+/);
  const raw: Omit<Block, "n" | "text" | "id">[] = [];
  for (const p0 of paras) {
    const p = p0.trim();
    if (!p) continue;
    const lines = p.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^[-*•]\s+/.test(l))) {
      for (const l of lines) raw.push({ type: "li", runs: runsFromText(l.replace(/^[-*•]\s+/, "")) });
      continue;
    }
    if (/^#{1,2}\s/.test(p)) {
      raw.push({ type: "h2", runs: [{ text: p.replace(/^#{1,2}\s+/, "") }] });
      continue;
    }
    if (/^#{3,6}\s/.test(p)) {
      raw.push({ type: "h3", runs: [{ text: p.replace(/^#{3,6}\s+/, "") }] });
      continue;
    }
    if (lines.every((l) => l.startsWith(">"))) {
      raw.push({ type: "quote", runs: runsFromText(lines.map((l) => l.replace(/^>\s?/, "")).join(" ")) });
      continue;
    }
    if (/^```/.test(p)) {
      raw.push({ type: "pre", runs: [{ text: p.replace(/^```\w*\n?|```$/g, "") }] });
      continue;
    }
    raw.push({ type: "p", runs: runsFromText(lines.join(" ")) });
  }
  return finishBlocks(raw);
}

export function documentFromText(text: string, title?: string): GlossDocument {
  let blocks = blocksFromText(text);
  let t = title?.trim();
  if (!t && blocks[0]?.type === "h2") {
    t = blocks[0].text;
    blocks = finishBlocks(blocks.slice(1).map(({ type, runs }) => ({ type, runs })));
  }
  if (!t) t = (blocks[0]?.text ?? "Pasted text").split(/(?<=[.!?])\s/)[0].slice(0, 80);
  return {
    slug: slugFor(t),
    kind: "text",
    title: t,
    author: null,
    dek: null,
    year: null,
    sourceUrl: null,
    sourceLabel: "Pasted text",
    topic: "unsorted",
    minutes: readingMinutes(blocks),
    paragraphs: blocks.filter((b) => b.n).length,
    blocks,
  };
}
