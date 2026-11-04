/**
 * The product's identity, in one place. A rename or a domain change is an edit to this file (and to `APP_URL` in the environment), never to application
 * logic: every user-visible name, the SEO and social copy, the colours the social card and the browser chrome use, the legal and support references and
 * the bookmarklet/bookmark labels read from here.
 *
 * What is deliberately NOT here, because it is an internal identifier and renaming it would break data or users who already have it:
 * the `gloss_*` cookie names, the `GLOSS_*` environment variables, the database names and migrations, the package name, the repository name, the backup
 * file's `app` marker (`understand-io`, see `LEGACY`) and the bookmarklet's `understand:*` message types. See `docs/brand/keeple-migration.md`.
 *
 * This module has no imports, so server, client and edge code can all use it.
 */

export const BRAND = {
  /** The product's name as a reader sees it. */
  name: "Keeple.me",
  /** The short form used where the full name would not fit a label ("Read in Keeple", the bookmarklet's name). */
  shortName: "Keeple",
  /** What the product was called before. Used only to recognise old things (an old backup, an old bookmark) and in the migration notes, never shown as the current name. */
  previousName: "Understand.io",
  /** Shown by the application chrome (tab title suffix, install name, "application name" meta). */
  applicationName: "Keeple.me",

  domain: {
    host: "keeple.me",
    /**
     * Not yet true. keeple.me has not been confirmed as owned and no DNS has been pointed at this project. The code therefore NEVER builds an address from
     * `host`: every canonical, sitemap, Open Graph and OAuth address still comes from `APP_URL`, so the domain goes live by changing that one variable
     * (see `docs/brand/domain-and-oauth-plan.md`). This flag exists so a check (`tests/unit/brand.test.ts`) can refuse a hard-coded address.
     */
    verified: false,
  },

  assets: {
    /** The mark drawn in the top bar (`components/chrome/marks.tsx`). */
    mark: "components/chrome/marks.tsx#GlossMark",
    /** The browser-tab icon (Next serves `app/favicon.ico`). */
    favicon: "src/app/favicon.ico",
    /** The social cards, drawn from this config by `lib/seo/ogCard.tsx` (no image file to keep in step). */
    ogCard: "src/app/opengraph-image.tsx",
  },

  colors: {
    /** The paper theme the social card and the browser chrome use. Mirrors the `--bg` / `--ink` tokens in `app/globals.css`. */
    paper: "#f6f3ec",
    paperDark: "#151412",
    ink: "#151412",
    inkMuted: "#4a463f",
    inkFaint: "#7a756c",
    /** The pen colour behind the highlighted words of the hero (the rubric). */
    highlight: "#f1c9bd",
  },

  typography: {
    /** The families loaded in `app/layout.tsx` through `next/font`; the wordmark uses the serif. */
    serif: "Newsreader",
    sans: "Schibsted Grotesk",
    book: "Literata",
    legible: "Atkinson Hyperlegible Next",
  },

  /** Copy that names the product, per language. The dictionaries (`i18n/messages`) take their SEO strings from here so a name or a line is written once. */
  copy: {
    en: {
      tagline: "Highlight any line and ask it anything.",
      description: "Highlight any line and ask it anything. An open model writes the answer in the margin, beside the words, citing the paragraphs it used.",
      seoTitle: "Keeple.me: highlight any line and ask it anything",
      seoDescription: "Read articles, PDFs and your own text, select a line and ask. The answer is written in the margin beside the words, citing the paragraphs it used.",
    },
    "pt-BR": {
      tagline: "Destaque qualquer trecho e pergunte o que quiser.",
      description: "Destaque qualquer trecho e pergunte o que quiser. Um modelo aberto escreve a resposta na margem, ao lado das palavras, citando os parágrafos que usou.",
      seoTitle: "Keeple.me: destaque qualquer trecho e pergunte o que quiser",
      seoDescription: "Leia artigos, PDFs e seus próprios textos, selecione um trecho e pergunte. A resposta é escrita na margem, ao lado das palavras, citando os parágrafos que usou.",
    },
  },

  /**
   * Who writes to people and who they write to. Addresses are placeholders to be confirmed by the operator: nothing sends mail today (sign-in is Google's,
   * there is no transactional email), so nothing reads `email.from` yet; it is here so the sender identity is decided in one place when mail is added.
   */
  email: {
    senderName: "Keeple.me",
    /** `null` until a sender address on a verified domain exists (SPF, DKIM and DMARC for keeple.me are part of the activation plan). */
    senderAddress: null as string | null,
  },

  support: {
    /** The contact the legal texts name for privacy requests and feedback; kept as it was until the operator chooses a keeple.me address. */
    contactEmail: "jm@useclave.io",
  },

  legal: {
    /** The operator named in the legal texts (`docs/legal/OPEN_ITEMS.md`). Unchanged by the rename: the legal entity is not the product's name. */
    operator: "Menlo Software AIP",
  },

  /** Identifiers that carry the old name on purpose, and are still accepted. Never shown to a reader. */
  legacy: {
    /** The `app` marker inside a backup file. Files written before the rename carry it, and new ones keep writing it so an older copy of the app can still read them. */
    backupApp: "understand-io",
  },
} as const;

export type BrandCopyLocale = keyof typeof BRAND.copy;
