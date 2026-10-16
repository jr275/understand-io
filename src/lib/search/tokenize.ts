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

/** Split a block's text into sentences with offsets. */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const start = m.index + lead;
    const t = raw.trim();
    if (!t) continue;
    // Merge abbreviations like "Mr." / "Dr." / single capital initials with the next sentence.
    const prev = out[out.length - 1];
    if (prev && /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc|No|p|pp|fig|ch|H\.M\.S|M|[A-Z])\.$/.test(prev.text)) {
      prev.text = text.slice(prev.start, start + t.length);
      prev.end = start + t.length;
      continue;
    }
    out.push({ text: t, start, end: start + t.length });
  }
  return out;
}
