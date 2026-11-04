/**
 * The high-intent pages (`/learn/<slug>`): one page per real question a person types into a search box, each with its own argument, its own
 * facts and a way to try the product on a real text. Written by hand, one at a time; never generated from a template and never a page whose only
 * difference from another is a swapped phrase. A page is `draft` (404 in production, so it cannot be found or indexed) until the owner has
 * read it and set it to `published` in a reviewed change. `tests/unit/learnPages.test.ts` holds every page to the same bar.
 *
 * What a page may say is limited to what the product does today (`docs/product/seo-landing-pages.md` lists, for each planned page, what it may
 * and may not claim). Facts that are numbers (limits, allowances) are the ones in the code; the test compares them.
 */

import { BRAND } from "@/lib/brand";

export interface LearnSection {
  heading: string;
  paragraphs: string[];
  /** Short points, drawn as a list after the paragraphs. */
  points?: string[];
}

export interface LearnPage {
  slug: string;
  status: "draft" | "published";
  /** The `<title>`: at most 60 characters, unique across pages. */
  title: string;
  /** The meta description: 70 to 160 characters, unique across pages. */
  description: string;
  h1: string;
  intro: string;
  sections: LearnSection[];
  /** The real demonstration: a link into a bundled text, where the reader can do what the page describes. */
  demo: { href: string; heading: string; body: string; cta: string };
  /** Other pages worth reading next (slugs of pages in this registry). */
  related: string[];
}

export const LEARN_PAGES: LearnPage[] = [
  {
    slug: "ai-pdf-reader",
    status: "draft",
    title: "An AI PDF reader that answers in the margin",
    description: "Open a PDF, select a passage and ask. The answer is written beside the words and cites the paragraphs it used. PDFs with selectable text only; no OCR.",
    h1: "An AI PDF reader that answers beside the words",
    intro:
      `Most AI tools for PDFs ask you to leave the page: upload the file, type into a chat box, and read an answer that is detached from the sentence that made you ask. ${BRAND.name} keeps the reading where it was. You select the passage that puzzles you, ask, and the answer is written in the margin next to it, with the paragraph numbers it relied on.`,
    sections: [
      {
        heading: "What happens when you import a PDF",
        paragraphs: [
          "The text layer of the PDF is read and rebuilt into paragraphs, so you read it as text rather than as pages: line breaks inside a paragraph are joined, hyphenated words are mended, page numbers are dropped. Headings and paragraphs are kept apart.",
          "The reading is only as good as the file. A PDF made from a scan has no text for the app to read and there is no OCR, so it is refused with a plain message instead of being turned into noise. Tables and figures come out as the loose fragments the PDF stores, and the app joins runs of short fragments back together, but a complicated table will not be a table.",
        ],
        points: ["PDFs up to 25 MB and 500 pages", "Text layer only: scans are refused, never guessed at", "The imported text is kept in your library on the server, under your browser or your Google account"],
      },
      {
        heading: "Ask about a passage, not about a file",
        paragraphs: [
          "Select a sentence and choose what you want: explain it, say it in plain words, define a term as the author uses it, weigh a claim, find where the text takes it up again, or give the strongest objection. Or type your own question. The answer streams in beside the selection.",
          "The answer is built from the paragraphs around your selection and says so. It begins with one sentence you can mark, cites the paragraphs it drew on as ¶12, and says plainly when it moves off the text: a sentence that starts “My reading:” is the model's interpretation, “Outside the text:” relies on knowledge from beyond the paragraphs it was given, and “The text does not say:” is exactly that. It does not claim to have read the rest of the document.",
        ],
      },
      {
        heading: "Your marks stay yours",
        paragraphs: [
          "Highlights, underlines and notes are saved against the passage, and they come back when you come back, on this browser or on any device you sign in on. You can search across everything you have saved by words (not by meaning: the search is lexical), and you can download a backup file of your library at any time.",
        ],
      },
      {
        heading: "What it costs and who sees your text",
        paragraphs: [
          "Without an account you get three AI questions a day; signing in with Google makes it twenty. You can also add your own Together AI key, in which case the questions are yours to spend and are not counted against the shared allowance.",
          "When you ask, the passage and the paragraphs around it are sent to the model provider (Together AI) to write the answer. The rest of your library is not sent. The imported text itself is kept on this service's database so that it is there next time.",
        ],
      },
    ],
    demo: {
      href: "/read/on-a-piece-of-chalk",
      heading: "Try it on a real text",
      body: "Open Huxley's lecture “On a Piece of Chalk”, select any sentence and ask about it. No account is needed for the first three questions of the day.",
      cta: "Open the sample and ask a question",
    },
    related: [],
  },
];

export const learnPage = (slug: string) => LEARN_PAGES.find((p) => p.slug === slug) ?? null;

/** Draft pages are visible only where the operator asks (`GLOSS_LEARN_PREVIEW=1`) and in development; published pages always. */
export function learnVisible(p: LearnPage, env: Record<string, string | undefined> = process.env): boolean {
  if (p.status === "published") return true;
  return env.NODE_ENV !== "production" || ["1", "true", "yes", "on"].includes((env.GLOSS_LEARN_PREVIEW ?? "").trim().toLowerCase());
}

export const publishedLearnPages = () => LEARN_PAGES.filter((p) => p.status === "published");
