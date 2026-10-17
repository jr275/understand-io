/**
 * The Porter stemming algorithm (M. F. Porter, 1980) for English: conflates inflections and common derivations
 * ("cause, causes, caused, causing" -> "caus"; "reptile, reptiles" -> "reptil") so a spoken query matches the written form.
 * Expects a lowercase ASCII word.
 */
const STEP2: Record<string, string> = { ational: "ate", tional: "tion", enci: "ence", anci: "ance", izer: "ize", bli: "ble", alli: "al", entli: "ent", eli: "e", ousli: "ous", ization: "ize", ation: "ate", ator: "ate", alism: "al", iveness: "ive", fulness: "ful", ousness: "ous", aliti: "al", iviti: "ive", biliti: "ble", logi: "log" };
const STEP3: Record<string, string> = { icate: "ic", ative: "", alize: "al", iciti: "ic", ical: "ic", ful: "", ness: "" };

const C = "[^aeiou][^aeiouy]*";
const V = "[aeiouy][aeiou]*";
const MGR0 = new RegExp(`^(${C})?${V}${C}`); // m > 0
const MEQ1 = new RegExp(`^(${C})?${V}${C}(${V})?$`); // m = 1
const MGR1 = new RegExp(`^(${C})?${V}${C}${V}${C}`); // m > 1
const HAS_VOWEL = new RegExp(`^(${C})?[aeiouy]`);
const CVC = new RegExp(`^${C}[aeiouy][^aeiouwxy]$`);

export function porterStem(word: string): string {
  let w = word;
  if (w.length < 3) return w;
  const first = w[0];
  if (first === "y") w = "Y" + w.slice(1);

  // Step 1a
  if (/^(.+?)(ss|i)es$/.test(w)) w = w.replace(/^(.+?)(ss|i)es$/, "$1$2");
  else if (/^(.+?)([^s])s$/.test(w)) w = w.replace(/^(.+?)([^s])s$/, "$1$2");

  // Step 1b
  const eed = /^(.+?)eed$/.exec(w);
  const edIng = /^(.+?)(ed|ing)$/.exec(w);
  if (eed) {
    if (MGR0.test(eed[1])) w = w.slice(0, -1);
  } else if (edIng && HAS_VOWEL.test(edIng[1])) {
    w = edIng[1];
    if (/(at|bl|iz)$/.test(w)) w += "e";
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    else if (CVC.test(w)) w += "e";
  }

  // Step 1c
  const y = /^(.+?)y$/.exec(w);
  if (y && HAS_VOWEL.test(y[1])) w = y[1] + "i";

  // Step 2
  const s2 = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(w);
  if (s2 && MGR0.test(s2[1])) w = s2[1] + STEP2[s2[2]];

  // Step 3
  const s3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w);
  if (s3 && MGR0.test(s3[1])) w = s3[1] + STEP3[s3[2]];

  // Step 4
  const s4 = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w);
  const s4ion = /^(.+?)(s|t)(ion)$/.exec(w);
  if (s4) {
    if (MGR1.test(s4[1])) w = s4[1];
  } else if (s4ion && MGR1.test(s4ion[1] + s4ion[2])) w = s4ion[1] + s4ion[2];

  // Step 5
  const e = /^(.+?)e$/.exec(w);
  if (e && (MGR1.test(e[1]) || (MEQ1.test(e[1]) && !CVC.test(e[1])))) w = e[1];
  if (/ll$/.test(w) && MGR1.test(w)) w = w.slice(0, -1);

  return first === "y" ? "y" + w.slice(1) : w;
}
