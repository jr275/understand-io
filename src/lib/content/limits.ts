/** Bounds that keep one untrusted page or PDF from blocking the whole server process (the parsers are synchronous). */
export const HTML_LIMITS = { chars: 4_000_000, elements: 50_000, depth: 200 } as const;
/** Mutable on purpose: tests shorten the timeout. */
export const PDF_LIMITS = { pages: 500, textChars: 3_000_000, ms: 25_000 };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements whose end tag may be omitted: HTML closes them implicitly, so they never add nesting depth. */
const OPTIONAL_END = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "rt", "rp", "html", "head", "body"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number) => isAlpha(c) || (c >= 48 && c <= 57) || c === 45 || c === 58 || c === 95;

/**
 * One cheap linear pass over raw HTML (no tree): counts start tags and tracks element nesting, stopping as soon as a
 * limit is crossed. Approximate by design (it only has to reject pages built to be pathological, not to parse HTML).
 */
export function measureHtml(html: string, maxElements: number = HTML_LIMITS.elements, maxDepth: number = HTML_LIMITS.depth): { ok: true; elements: number; depth: number } | { ok: false; reason: "elements" | "depth"; elements: number; depth: number } {
  const n = html.length;
  let i = 0;
  let elements = 0;
  let depth = 0;
  let deepest = 0;
  while ((i = html.indexOf("<", i)) !== -1) {
    const c = html.charCodeAt(i + 1);
    if (c === 33) {
      // <!-- comment -->, <!doctype>, <![CDATA[ ]]>
      const end = html.startsWith("<!--", i) ? html.indexOf("-->", i + 4) : html.indexOf(">", i);
      i = end === -1 ? n : end + (html.startsWith("<!--", i) ? 3 : 1);
      continue;
    }
    if (c === 47) {
      let j = i + 2;
      while (j < n && isNameChar(html.charCodeAt(j))) j++;
      const name = html.slice(i + 2, j).toLowerCase();
      if (name && !OPTIONAL_END.has(name) && !VOID.has(name) && depth > 0) depth--;
      i = j;
      continue;
    }
    if (!isAlpha(c)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && isNameChar(html.charCodeAt(j))) j++;
    const name = html.slice(i + 1, j).toLowerCase();
    if (++elements > maxElements) return { ok: false, reason: "elements", elements, depth: deepest };
    // End of the start tag: the first ">" outside a quoted attribute value.
    let quote = 0;
    let selfClosing = false;
    for (; j < n; j++) {
      const ch = html.charCodeAt(j);
      if (quote) {
        if (ch === quote) quote = 0;
      } else if (ch === 34 || ch === 39) quote = ch;
      else if (ch === 62) {
        selfClosing = html.charCodeAt(j - 1) === 47;
        break;
      }
    }
    i = j + 1;
    if (RAW_TEXT.has(name) && !selfClosing) {
      // Skip the element's text: it is not markup.
      const close = html.indexOf(`</${name}`, i);
      const closeUpper = close === -1 ? html.indexOf(`</${name.toUpperCase()}`, i) : close;
      i = closeUpper === -1 ? n : closeUpper;
      continue;
    }
    if (selfClosing || VOID.has(name) || OPTIONAL_END.has(name)) continue;
    if (++depth > deepest) deepest = depth;
    if (deepest > maxDepth) return { ok: false, reason: "depth", elements, depth: deepest };
  }
  return { ok: true, elements, depth: deepest };
}
