import { porterStem } from "./porter";

/** Strip accents and lowercase, so lookups never depend on how a word was typed or dictated. */
const fold = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const STOP_EN =
  "a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing done down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same shall she should so some such than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom whose why will with would you your yours yourself yourselves";
// Stored with accents removed: input is folded before the lookup, so "não" must be listed as "nao".
const STOP_PT =
  "a ao aos as ate com como da das de dela dele deles do dos e ela ele eles em entre era essa esse essas esses esta estas este estes foi ha isso mais mas na nas nao no nos o os ou para pela pelas pelo pelos por qual quais quando quem que sao se sem ser seu seus sobre sua suas tambem tem um uma uns umas ja so muito onde";
const STOP = new Set(`${STOP_EN} ${STOP_PT}`.split(/\s+/));

/**
 * Words that belong to the spoken request, not to the topic ("can you please show me where the author mentions ...").
 * They are dropped from queries only: in the text they are ordinary words.
 */
const QUERY_FILLER = new Set(
  "please okay ok um uh hey well so tell show find take bring give go back say says said saying talk talks talking mention mentions mentioned author authors writer text passage part section paragraph place bit sentence read aloud something anything want need like look looking search locate whats pode mostrar mostre encontre localize procure autor texto trecho parte fala falam diz".split(/\s+/),
);

type Lang = "en" | "pt" | "es" | string;
const baseLang = (lang?: string) => (lang ?? "en").slice(0, 2).toLowerCase();

/** Light Portuguese stemmer on accent-folded words: plurals, feminine/masculine endings and a few derivational endings. */
export function ptStem(input: string): string {
  let w = input;
  if (w.length <= 3) return w;
  if (/(oes|aes|aos)$/.test(w)) w = w.slice(0, -3) + "ao";
  else if (/ais$/.test(w)) w = w.slice(0, -3) + "al";
  else if (/eis$/.test(w)) w = w.slice(0, -3) + "el";
  else if (/ns$/.test(w)) w = w.slice(0, -2) + "m";
  else if (/res$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
  w = w.replace(/(amente|mente)$/, "").replace(/(idade|ismo|ista)$/, "");
  if (w.length > 5 && w.endsWith("ao")) w = w.slice(0, -2);
  if (w.length > 4 && /[aoe]$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Stem one already-folded word for the given language. */
export function stem(word: string, lang: Lang = "en"): string {
  const l = baseLang(lang);
  if (word.length <= 3) return word;
  if (l === "pt") return ptStem(word);
  if (l === "es") return word.replace(/(ciones|cion|mente)$/, "").replace(/(es|s)$/, "");
  return porterStem(word);
}

/** Lowercase, strip accents and punctuation, drop stop words, stem. */
export function tokenize(text: string, keepStop = false, lang: Lang = "en"): string[] {
  return fold(text)
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/[\s'’-]+/)
    .filter((t) => t.length > 1 && (keepStop || !STOP.has(t)))
    .map((t) => stem(t, lang));
}

/** Tokens of a search query: like `tokenize`, and also without the words of the spoken request itself. */
export function queryTokens(text: string, lang: Lang = "en"): string[] {
  return fold(text)
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/[\s'’-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !QUERY_FILLER.has(t))
    .map((t) => stem(t, lang));
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
