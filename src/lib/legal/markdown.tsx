import type { ReactNode } from "react";

/**
 * A small markdown renderer for the legal texts: headings, paragraphs, bullet and numbered lists (nested by indentation), tables, quotes,
 * bold, italics, inline code and links. HTML comments (the notes for the owner) are removed. Nothing in the source is ever rendered as HTML:
 * it all becomes React text, and a link is kept only if it is http(s), mailto, an anchor or a path on this site.
 */

const safeHref = (u: string) => /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(u);
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    const k = `${key}${n++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-sunk px-1 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? [];
      out.push(
        safeHref(href) ? (
          <a key={k} href={href} className="text-rubric-text underline underline-offset-2" {...(/^https?:/i.test(href) ? { rel: "noopener noreferrer" } : {})}>
            {inline(label, k)}
          </a>
        ) : (
          <span key={k}>{label}</span>
        ),
      );
    } else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ListItem {
  text: string;
  children: { ordered: boolean; items: ListItem[] } | null;
}

const LIST_LINE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const isBlockStart = (l: string) => /^#{1,4}\s/.test(l) || /^>/.test(l) || /^\|/.test(l) || LIST_LINE.test(l) || /^-{3,}\s*$/.test(l);

function buildList(lines: string[]): { ordered: boolean; items: ListItem[] } {
  const root = { ordered: /^\s*\d+\./.test(lines[0]), items: [] as ListItem[] };
  const stack: { indent: number; list: typeof root }[] = [{ indent: (LIST_LINE.exec(lines[0]) as RegExpExecArray)[1].length, list: root }];
  for (const line of lines) {
    const m = LIST_LINE.exec(line);
    if (!m) {
      const last = stack[stack.length - 1].list.items.at(-1);
      if (last) last.text += ` ${line.trim()}`; // a wrapped line belongs to the item above
      continue;
    }
    const indent = m[1].length;
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    if (indent > stack[stack.length - 1].indent) {
      const parent = stack[stack.length - 1].list.items.at(-1);
      if (parent) {
        parent.children ??= { ordered: /^\d+\./.test(m[2]), items: [] };
        stack.push({ indent, list: parent.children });
      }
    }
    stack[stack.length - 1].list.items.push({ text: m[3], children: null });
  }
  return root;
}

function List({ list, k }: { list: { ordered: boolean; items: ListItem[] }; k: string }) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag className={`mt-3 space-y-1.5 pl-5 text-[15.5px] leading-[1.6] text-ink-2 ${list.ordered ? "list-decimal" : "list-disc"}`}>
      {list.items.map((it, i) => (
        <li key={`${k}${i}`}>
          {inline(it.text, `${k}${i}`)}
          {it.children ? <List list={it.children} k={`${k}${i}.`} /> : null}
        </li>
      ))}
    </Tag>
  );
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function blocks(lines: string[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `${key}${n++}`;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = ["", "font-serif text-[34px] leading-[1.15] text-ink", "mt-10 font-serif text-[23px] leading-snug text-ink", "mt-7 text-[17px] font-semibold text-ink", "mt-5 text-[15px] font-semibold text-ink"][level];
      const Tag = (`h${level}` as "h1" | "h2" | "h3" | "h4");
      out.push(<Tag key={k} className={cls}>{inline(h[2], k)}</Tag>);
      i += 1;
    } else if (/^-{3,}\s*$/.test(line)) {
      out.push(<hr key={k} className="my-8 border-rule" />);
      i += 1;
    } else if (/^>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={k} className="mt-4 border-l-2 border-rule-strong pl-4 text-[14.5px] leading-[1.6] text-ink-3">{blocks(q, k)}</blockquote>);
    } else if (/^\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const [head, sep, ...body] = rows;
      const hasSep = !!sep && /^\|?[\s:|-]+\|?$/.test(sep);
      const bodyRows = hasSep ? body : rows.slice(1);
      out.push(
        <div key={k} className="mt-4 overflow-x-auto rounded-lg border border-rule">
          <table className="w-full border-collapse text-left text-[13.5px] leading-snug text-ink-2">
            <thead className="bg-sunk text-ink">
              <tr>{cells(head).map((c, j) => <th key={j} scope="col" className="px-3 py-2 font-semibold">{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {bodyRows.map((r, ri) => (
                <tr key={ri} className="border-t border-rule align-top">{cells(r).map((c, j) => <td key={j} className="px-3 py-2">{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (LIST_LINE.test(line)) {
      const l: string[] = [];
      while (i < lines.length && lines[i].trim() && (LIST_LINE.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) l.push(lines[i++]);
      out.push(<List key={k} list={buildList(l)} k={k} />);
    } else {
      const p: string[] = [line.trim()];
      i += 1;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) p.push(lines[i++].trim());
      out.push(<p key={k} className="mt-3 text-[15.5px] leading-[1.65] text-ink-2">{inline(p.join(" "), k)}</p>);
    }
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  return <>{blocks(clean.split("\n"), "b")}</>;
}
