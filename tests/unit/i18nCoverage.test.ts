// Completeness of the two dictionaries, and a ratchet against hard-coded interface text: every component that has been moved to the dictionaries
// must stay clean, and the list of components not yet moved (PENDING) can only shrink.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@/i18n/messages/en";
import { ptBR } from "@/i18n/messages/pt-BR";

type Leaf = string | { one: string; other: string };
function flatten(o: Record<string, unknown>, prefix = ""): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || (v && typeof v === "object" && "other" in (v as object))) out.set(key, v as Leaf);
    else for (const [kk, vv] of flatten(v as Record<string, unknown>, key)) out.set(kk, vv);
  }
  return out;
}
const texts = (l: Leaf) => (typeof l === "string" ? [l] : [l.one, l.other]);
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const EN = flatten(en);
const PT = flatten(ptBR as unknown as Record<string, unknown>);
/** Values that are the same in both languages on purpose: a name, a code, a punctuation mark. */
const SAME = new Set(["lang.en", "lang.pt-BR", "meta.appCategory", "landing.heroDot", "appearance.web", "topics.design", "topics.startups", "library.minutes", "add.linkCount", "reader.kindPdf", "composer.web", "insights.original", "insights.literal", "insights.mdOriginal", "notebook.summary", "listen.online", "ingest.cTotal"]);

describe("the dictionaries", () => {
  it("have exactly the same keys in English and Portuguese (the compiler also enforces it)", () => {
    expect([...PT.keys()].filter((k) => !EN.has(k))).toEqual([]);
    expect([...EN.keys()].filter((k) => !PT.has(k))).toEqual([]);
    expect(EN.size).toBeGreaterThan(200);
  });

  it("have the same placeholders in every message, in both languages and in every plural form", () => {
    const bad: string[] = [];
    for (const [k, e] of EN) {
      const p = PT.get(k)!;
      const eh = texts(e).map(holes);
      const ph = texts(p).map(holes);
      if (typeof e === "string" !== (typeof p === "string")) bad.push(`${k}: one is a plural, the other is not`);
      else if (new Set([...eh, ...ph].filter((h) => h)).size > 1 && JSON.stringify(eh) !== JSON.stringify(ph)) bad.push(`${k}: ${eh.join("|")} vs ${ph.join("|")}`);
      else if (holes(texts(e).join(" ")) !== holes(texts(p).join(" "))) bad.push(`${k}: ${holes(texts(e).join(" "))} vs ${holes(texts(p).join(" "))}`);
    }
    expect(bad).toEqual([]);
  });

  it("have no empty message, and no Portuguese message that was left as the English one", () => {
    const empty = [...EN, ...PT].filter(([, v]) => texts(v).some((s) => !s.trim())).map(([k]) => k);
    expect(empty).toEqual([]);
    const untranslated = [...EN].filter(([k, v]) => !SAME.has(k) && JSON.stringify(v) === JSON.stringify(PT.get(k))).map(([k]) => k);
    expect(untranslated).toEqual([]);
  });

  it("use the typographic apostrophe nowhere that would break a placeholder, and no stray markup", () => {
    for (const [k, v] of [...EN, ...PT]) for (const s of texts(v)) expect(s, k).not.toMatch(/<\/?[a-z][^>]*>|\{\s|\s\}/i);
  });
});

/* ------------------------------------------------------------------ hard-coded text */

const BRAND = /^(Keeple\.me|Together( AI)?|Google|GOOGLE_CLIENT_\w+|DATABASE_URL|tgp_v1_\.\.\.)$/;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));

/** Sentences a reader would see, written straight into a component: JSX text and the attributes that screen readers and tooltips read. */
export function hardCoded(source: string): string[] {
  const found: string[] = [];
  const lines = source.split("\n");
  let inBlockComment = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      return;
    }
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("import ") || line.startsWith("export type") || line.startsWith("{/*")) return;
    for (const m of line.matchAll(/\b(?:aria-label|aria-description|title|placeholder|alt|data-tip|label)=\"([^\"{}]*[A-Za-z]{3}[^\"{}]*)\"/g)) if (!BRAND.test(m[1]) && !/^(https?:\/\/|[\w-]*[./:][\w./:-]*)$/.test(m[1])) found.push(`${i + 1}: ${m[0]}`);
    // text between a tag and the next tag: a sentence or a label (starts with a capital; generics such as `Set<string>` and expressions are not text)
    for (const m of line.matchAll(/>\s*([A-Z][A-Za-z’'.,!?\- ]*)\s*</g)) {
      const text = m[1].trim();
      if (BRAND.test(text) || /^[A-Z_]+$/.test(text) || (!/\s/.test(text) && text.length < 5)) continue;
      found.push(`${i + 1}: >${text}<`);
    }
    // a line that is nothing but words, between tags (multi-line JSX text)
    if (/^[A-Z][A-Za-z’'.,!?:\- ]{3,}$/.test(line) && !BRAND.test(line) && !/^(return|const|let|import|export|default|break|case|else|try|catch|finally|await|async|function|type|interface)\b/.test(line) && /\s/.test(line)) found.push(`${i + 1}: ${line}`);
  });
  return found;
}

/**
 * Components that still carry English text of their own. Moving one to the dictionaries (`useT()` / `getT()`) means deleting its line here: the test
 * below fails for a listed file that has become clean, so the list cannot go stale, and for any other file that gains a hard-coded sentence.
 */
const PENDING_FILE = join(__dirname, "i18nPending.json");
const PENDING = new Set<string>(JSON.parse(readFileSync(PENDING_FILE, "utf8")) as string[]);

if (process.env.I18N_WRITE_PENDING) {
  // `I18N_WRITE_PENDING=1 pnpm test tests/unit/i18nCoverage.test.ts` rewrites the list from what is found now (use it to see the backlog, never to hide a new one).
  const now = ["src/components", "src/app"].flatMap(walk).map((f) => relative(process.cwd(), f)).filter((f) => hardCoded(readFileSync(f, "utf8")).length > 0).sort();
  writeFileSync(PENDING_FILE, `${JSON.stringify(now, null, 2)}\n`);
}

describe("hard-coded interface text", () => {
  const files = ["src/components", "src/app"].flatMap(walk).map((f) => relative(process.cwd(), f));

  it("is found by the scanner where it exists (so the ratchet is not asleep)", () => {
    expect(hardCoded('<p className="x">Select a line in anything you read</p>').length).toBe(1);
    expect(hardCoded('<button aria-label="Close" onClick={f} />').length).toBe(1);
    expect(hardCoded("<p>{t(\"a.b\")}</p>\n<button aria-label={t(\"a.c\")} />")).toEqual([]);
    expect(hardCoded("// a comment with words in it\n/* another comment */")).toEqual([]);
    expect(hardCoded("<span>\n  Your library\n</span>").length).toBe(1);
  });

  it("is absent from every component that has been moved to the dictionaries", () => {
    const dirty = files.filter((f) => !PENDING.has(f) && hardCoded(readFileSync(f, "utf8")).length > 0).map((f) => `${f}: ${hardCoded(readFileSync(f, "utf8"))[0]}`);
    expect(dirty).toEqual([]);
  });

  it("is still present in every file listed as pending (a clean file must leave the list)", () => {
    const clean = [...PENDING].filter((f) => !files.includes(f) || hardCoded(readFileSync(f, "utf8")).length === 0);
    expect(clean).toEqual([]);
  });
});
