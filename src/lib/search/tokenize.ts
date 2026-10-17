const STOP = new Set(
  (
    "a an and are as at be but by for from has have he her his i if in into is it its of on or " +
    "she so that the their them then there these they this to was we were what when where which " +
    "who will with would you your " +
    "o a os as um uma de do da dos das em no na nos nas por para com que se não é são ao à " +
    "sobre onde qual quais como quem e ou mas"
  ).split(/\s+/),
);

/** Lowercase, strip accents and punctuation, drop stop words, light stemming. */
export function tokenize(text: string, keepStop = false): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/[\s'’-]+/)
    .filter((t) => t.length > 1 && (keepStop || !STOP.has(t)))
    .map(stem);
}

export function stem(t: string): string {
  if (t.length <= 4) return t;
  // Portuguese/Spanish endings first (input is already accent-stripped), then English.
  const pt = t.replace(/(coes|cao|mente|ismo|istas?|idades?)$/, "").replace(/(ores|ais|eis|oes|ens)$/, "");
  if (pt !== t) return pt;
  return t.replace(/(ations?|ively|ingly|ements?|nesses?)$/, "").replace(/(ing|edly|ed|ies|es|ly|s)$/, (m) => (m === "ies" ? "y" : ""));
}

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "prof", "sr", "jr", "vs", "fig", "figs", "cf", "viz", "co", "inc", "ltd", "bart", "gen", "col", "capt", "sgt", "lt", "rev", "hon", "esq", "mt", "ft", "approx", "dept", "est", "ave"]);
/** Abbreviations that only take a full stop when a number follows ("No. 5", "p. 45"). */
const NUMBERED = new Set(["no", "nos", "p", "pp", "vol", "art", "sec", "ch", "fig"]);
const TERMINATOR = /[.!?…]/;
const CLOSER = /["'”’)\]»›]/;
const OPENER = /["'“‘(\[«‹]/;

/** The word that ends just before `end` (letters, digits, inner full stops, apostrophes, hyphens). */
function wordBefore(text: string, end: number) {
  let b = end;
  while (b > 0 && /[\p{L}\p{N}.'’-]/u.test(text[b - 1])) b--;
  return { word: text.slice(b, end), begin: b };
}

/**
 * Split a block's text into sentences with offsets.
 *
 * A full stop, question mark, exclamation mark or ellipsis ends a sentence only when it is followed by
 * whitespace (or the end) AND the text that follows does not continue the sentence: no lowercase letter
 * next ("e.g. apples", "per cent. of it", "Wait... what?"), not an abbreviation ("Dr.", "U.S.", "Ph.D.",
 * "No. 5"), not an initial in a name ("J. K. Rowling"). Decimals, versions and domains ("3.5", "v1.2.3",
 * "example.com") never split because no whitespace follows their full stop.
 */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const n = text.length;
  let start = 0;
  while (start < n && /\s/.test(text[start])) start++;
  const push = (from: number, to: number) => {
    let e = to;
    while (e > from && /\s/.test(text[e - 1])) e--;
    if (e > from) out.push({ text: text.slice(from, e), start: from, end: e });
  };
  for (let i = start; i < n; i++) {
    if (!TERMINATOR.test(text[i])) continue;
    let k = i;
    while (k + 1 < n && TERMINATOR.test(text[k + 1])) k++; // "?!" and "..."
    const single = k === i && text[i] === ".";
    for (;;) {
      // closing quotes and brackets, then footnote markers such as "[1]"
      while (k + 1 < n && CLOSER.test(text[k + 1])) k++;
      const marker = /^\[\d+\]/.exec(text.slice(k + 1, k + 8));
      if (!marker) break;
      k += marker[0].length;
    }
    if (k + 1 < n && !/\s/.test(text[k + 1])) {
      i = k; // "3.5", "example.com", "cent.—of it": no whitespace, so the sentence goes on
      continue;
    }
    let m = k + 1;
    while (m < n && /\s/.test(text[m])) m++;
    let f = m;
    while (f < n && OPENER.test(text[f])) f++;
    const following = text[f];
    if (following !== undefined) {
      if (/\p{Ll}/u.test(following)) {
        i = k; // a lowercase continuation: "e.g. apples", "etc. and", "Wait... what?"
        continue;
      }
      if (single) {
        const { word, begin } = wordBefore(text, i);
        const lower = word.toLowerCase();
        if (ABBREVIATIONS.has(lower)) {
          i = k;
          continue;
        }
        if (NUMBERED.has(lower) && /\d/.test(following)) {
          i = k;
          continue;
        }
        if (/^(?:\p{L}{1,2}\.)+\p{L}{1,2}$/u.test(word)) {
          i = k; // dotted abbreviations: "H.M.S.", "U.S.", "Ph.D."
          continue;
        }
        if (/^\p{Lu}$/u.test(word)) {
          // An initial joins the next word only inside a name ("John F. Kennedy", "J. K. Rowling"), not after "vitamin C."
          const prev = wordBefore(text, Math.max(0, begin - 1)).word;
          const nextIsInitial = /^\p{Lu}\./u.test(text.slice(f, f + 2));
          if (!prev || /^\p{Lu}/u.test(prev) || nextIsInitial) {
            i = k;
            continue;
          }
        }
      }
    }
    push(start, k + 1);
    start = m;
    i = k;
  }
  if (start < n) push(start, n);
  return out;
}
