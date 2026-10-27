import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The legal texts (`docs/legal/*.md`, in two languages) and the rule that keeps a draft from ever being shown to a reader.
 *
 * A text is shown only when BOTH are true: the operator has turned publication on (`GLOSS_LEGAL_PUBLISHED=1`), and the text itself is final,
 * meaning it holds no ⚠️ marker (every owner decision and legal review item in the drafts carries one, and so does the "draft, not legal
 * advice" banner). Both language versions must be final, so switching language can never reveal a draft. Until then the pages answer 404
 * and no link to them is drawn anywhere, so a release of this code changes nothing a reader can see.
 */

export type LegalDoc = "privacy" | "terms" | "ai-notice" | "retention" | "beta";
export type LegalLang = "en" | "pt";

export const LEGAL_DOCS: Record<LegalDoc, { file: string; route: string; title: Record<LegalLang, string> }> = {
  privacy: { file: "privacy-policy", route: "/privacy", title: { en: "Privacy Policy", pt: "Política de Privacidade" } },
  terms: { file: "terms-of-use", route: "/terms", title: { en: "Terms of Use", pt: "Termos de Uso" } },
  "ai-notice": { file: "ai-notice", route: "/legal/ai-notice", title: { en: "Third-party AI notice", pt: "Aviso de uso de IA de terceiros" } },
  retention: { file: "retention-and-deletion", route: "/legal/retention", title: { en: "Retention and deletion", pt: "Retenção e exclusão" } },
  beta: { file: "beta-notice", route: "/legal/beta", title: { en: "Beta limitations", pt: "Limitações da versão beta" } },
};

export const LEGAL_LANGS: LegalLang[] = ["en", "pt"];
const SUFFIX: Record<LegalLang, string> = { en: "en", pt: "pt-BR" };
export const isLegalDoc = (s: string): s is LegalDoc => Object.prototype.hasOwnProperty.call(LEGAL_DOCS, s);
export const asLang = (s: string | undefined): LegalLang => (s === "pt" || s === "pt-BR" ? "pt" : "en");

/** The operator's switch. Off unless it says so. */
export const legalFlagOn = (env: Record<string, string | undefined> = process.env) => ["1", "true", "yes", "on"].includes((env.GLOSS_LEGAL_PUBLISHED ?? "").trim().toLowerCase());

/** How many open items a text still carries (owner decisions, legal review, and the draft banner). */
export const openItems = (text: string) => (text.match(/⚠️/g) ?? []).length;

/**
 * `docs/legal`, or a subfolder of it named in `GLOSS_LEGAL_SET` (for previewing final texts locally and for tests). The path is kept inside
 * `docs/legal` on purpose: a path built from a free-form variable makes the build trace, and ship, the whole project.
 */
const SET = /^[a-z0-9-]{1,40}$/;
const defaultDir = () => {
  const set = process.env.GLOSS_LEGAL_SET?.trim();
  return set && SET.test(set) ? path.join(process.cwd(), "docs", "legal", set) : path.join(process.cwd(), "docs", "legal");
};

export interface Options {
  env?: Record<string, string | undefined>;
  /** Where the texts are (tests point this at a folder of their own). */
  dir?: string;
  /** Replaces reading from disk (tests). */
  read?: (file: string) => string | null;
}

const cache = new Map<string, string | null>();
function load(dir: string, file: string, lang: LegalLang, read?: Options["read"]): string | null {
  const name = `${file}.${SUFFIX[lang]}.md`;
  if (read) return read(name);
  const full = path.join(dir, name);
  if (!cache.has(full)) {
    try {
      cache.set(full, readFileSync(full, "utf8"));
    } catch {
      cache.set(full, null);
    }
  }
  return cache.get(full) ?? null;
}

/** Test hook: forget what was read from disk. */
export const forgetLegalCache = () => cache.clear();

export type Resolved = { ok: true; markdown: string; lang: LegalLang } | { ok: false; reason: "off" | "missing" | "open-items" };

/** The text of `doc` in `lang`, or why it must not be shown. */
export function resolveLegal(doc: LegalDoc, lang: LegalLang, o: Options = {}): Resolved {
  if (!legalFlagOn(o.env)) return { ok: false, reason: "off" };
  const dir = o.dir ?? defaultDir();
  const texts = LEGAL_LANGS.map((l) => load(dir, LEGAL_DOCS[doc].file, l, o.read));
  if (texts.some((t) => t === null)) return { ok: false, reason: "missing" };
  if (texts.some((t) => openItems(t as string) > 0)) return { ok: false, reason: "open-items" };
  return { ok: true, markdown: texts[LEGAL_LANGS.indexOf(lang)] as string, lang };
}

/** The footer links: the privacy policy and the terms, only when both may be shown. */
export function legalLinks(o: Options = {}): { href: string; label: string }[] {
  const both = (["privacy", "terms"] as const).map((d) => ({ d, r: resolveLegal(d, "en", o) }));
  if (!both.every((x) => x.r.ok)) return [];
  return both.map(({ d }) => ({ href: LEGAL_DOCS[d].route, label: d === "privacy" ? "Privacy" : "Terms" }));
}

/** What is still open in each text, for the operator (a list of "file: n item(s)"), whatever the switch says. */
export function legalStatus(o: Options = {}): { doc: LegalDoc; lang: LegalLang; open: number | "missing" }[] {
  const dir = o.dir ?? defaultDir();
  const out: { doc: LegalDoc; lang: LegalLang; open: number | "missing" }[] = [];
  for (const doc of Object.keys(LEGAL_DOCS) as LegalDoc[])
    for (const lang of LEGAL_LANGS) {
      const t = load(dir, LEGAL_DOCS[doc].file, lang, o.read);
      out.push({ doc, lang, open: t === null ? "missing" : openItems(t) });
    }
  return out;
}
