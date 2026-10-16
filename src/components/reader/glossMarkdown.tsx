import type { ReactNode } from "react";

/**
 * Tiny renderer for gloss answers: paragraphs, bullets, *em*, **strong**, `code`,
 * ==key sentence== → <mark class="key">, and ¶12 → citation buttons.
 */
export function renderGlossBody(text: string, onCite: (n: number) => void, streaming = false): ReactNode {
  const paras = text.replace(/\r/g, "").trim().split(/\n{2,}/);
  return paras.map((p, pi) => {
    const lines = p.split("\n");
    if (lines.length > 1 && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return (
        <ul key={pi}>
          {lines.map((l, li) => (
            <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ""), onCite)}</li>
          ))}
        </ul>
      );
    }
    const last = pi === paras.length - 1;
    return (
      <p key={pi}>
        {inline(lines.join(" "), onCite)}
        {streaming && last ? <span className="caret" aria-hidden="true" /> : null}
      </p>
    );
  });
}

function inline(s: string, onCite: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  // Key sentence first (may contain other inline markup).
  const re = /(==[\s\S]+?==|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|¶\s?\d+|\[¶\s?\d+\]|\(¶\s?\d+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("==")) out.push(<mark key={k++} className="key">{inline(tok.slice(2, -2), onCite)}</mark>);
    else if (tok.startsWith("**")) out.push(<strong key={k++}>{inline(tok.slice(2, -2), onCite)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={k++}>{inline(tok.slice(1, -1), onCite)}</em>);
    else {
      const n = Number(tok.replace(/\D/g, ""));
      out.push(
        <button key={k++} type="button" className="cite" aria-label={`Jump to paragraph ${n}`} onClick={() => onCite(n)}>
          ¶{n}
        </button>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  // Unclosed key marker while streaming: render as plain text.
  return out;
}

export function plainAnswer(text: string) {
  return text.replace(/==/g, "").replace(/\*\*|`/g, "").replace(/(^|\s)\*([^*]+)\*/g, "$1$2");
}
