import type { ReactNode } from "react";

/**
 * Tiny renderer for gloss answers: paragraphs, bullets, *em*, **strong**, `code`,
 * ==key sentence== → <mark class="key">, and ¶12 → citation buttons.
 */
/**
 * `valid` is the set of paragraph numbers the model was actually given (when known). A citation to any other paragraph is shown as
 * unverified and does not link: the model cannot make the reader believe the text says something at a place it never saw.
 */
export function renderGlossBody(text: string, onCite: (n: number) => void, streaming = false, valid: Set<number> | null = null): ReactNode {
  const paras = text.replace(/\r/g, "").trim().split(/\n{2,}/);
  return paras.map((p, pi) => {
    const lines = p.split("\n");
    if (lines.length > 1 && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return (
        <ul key={pi}>
          {lines.map((l, li) => (
            <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ""), onCite, valid)}</li>
          ))}
        </ul>
      );
    }
    const last = pi === paras.length - 1;
    return (
      <p key={pi}>
        {inline(lines.join(" "), onCite, valid)}
        {streaming && last ? <span className="caret" aria-hidden="true" /> : null}
      </p>
    );
  });
}

const BASIS_TAGS: Record<string, string> = { "My reading:": "My reading", "Outside the text:": "Outside the text", "The text does not say:": "The text does not say" };

function inline(s: string, onCite: (n: number) => void, valid: Set<number> | null): ReactNode[] {
  const out: ReactNode[] = [];
  // Key sentence first (may contain other inline markup).
  const re = /(My reading:|Outside the text:|The text does not say:|==[\s\S]+?==|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|¶\s?\d+|\[¶\s?\d+\]|\(¶\s?\d+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (BASIS_TAGS[tok]) out.push(<span key={k++} data-basis={BASIS_TAGS[tok]} className="mr-1 inline-block rounded-full bg-sunk px-2 py-[3px] align-[1px] text-[11px] font-medium leading-none text-ink-3">{BASIS_TAGS[tok]}</span>);
    else if (tok.startsWith("==")) out.push(<mark key={k++} className="key">{inline(tok.slice(2, -2), onCite, valid)}</mark>);
    else if (tok.startsWith("**")) out.push(<strong key={k++}>{inline(tok.slice(2, -2), onCite, valid)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={k++}>{inline(tok.slice(1, -1), onCite, valid)}</em>);
    else {
      const n = Number(tok.replace(/\D/g, ""));
      if (valid && !valid.has(n)) {
        out.push(
          <span key={k++} className="cite is-unverified" data-unverified={n} role="img" aria-label={`Paragraph ${n} was not among the paragraphs the model was given, so this citation cannot be checked`} data-tip="Not among the paragraphs the model was given" style={{ textDecoration: "line-through", color: "var(--ink-3)", cursor: "help" }}>
            ¶{n}
          </span>,
        );
        last = m.index + tok.length;
        continue;
      }
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
