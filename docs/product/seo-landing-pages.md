# SEO, international distribution and the high-intent pages

**Status:** the technical layer below is implemented and tested locally; **nothing is deployed, and no page is published.** One page (`/learn/ai-pdf-reader`) is written and is a *draft*: it answers 404 in production (and is `noindex` even when previewed) until the owner has read it and set `status: "published"` in `src/lib/seo/learn.ts` in a reviewed change.

## What is implemented

| Need | How | Where | Tested |
| --- | --- | --- | --- |
| Canonical URLs | per page, absolute, from `APP_URL` (so a domain change needs no code change); none when the origin is unknown | `lib/seo/site.ts` `alternatesFor` | `seo.test.ts`, `seoRoutes.test.ts` |
| hreflang | a language is declared only for a page that exists in it (`available`), plus `x-default`; the legal texts (`/privacy`, `/privacy?lang=pt`) declare both | `alternatesFor`, `lib/seo/legal.ts` | `seo.test.ts` |
| Unique metadata per route | landing, each sample text, each learn page, legal texts have their own title and description; the library, a reader's own texts and drafts say `noindex` | `app/page.tsx`, `app/read/[slug]`, `app/learn/[slug]`, `app/library` | `seoRoutes.test.ts`, `seo.spec.ts` |
| Open Graph / Twitter | per page title, description, URL; one drawn card (`opengraph-image`, no external asset) | `socialFor`, `app/opengraph-image.tsx` | `seo.spec.ts` |
| Structured data | `SoftwareApplication` on the landing page and `WebPage` on learn pages. **No** `offers`, `aggregateRating` or `Article` dates: nothing is claimed that the product cannot show | `jsonLd` | `seo.spec.ts` |
| XML sitemap | landing, the three sample texts, published learn pages and (once published) the legal texts; never the library, a private text, a draft or the API; no invented `lastModified` | `app/sitemap.ts` | `seoRoutes.test.ts`, `seo.spec.ts` |
| Robots and indexing | `robots.txt` blocks `/api/` and `/library`; `/read/` is not blocked because a blocked page cannot tell a crawler it is `noindex`; privacy of a text is decided per page | `app/robots.ts` | `seoRoutes.test.ts`, `seo.spec.ts` |

Without `APP_URL` (previews, local) the sitemap is empty and no canonical or hreflang is written, rather than a relative or wrong one.

## Multilingual architecture (decision, not yet built)

The interface is English; the legal texts exist in English and Brazilian Portuguese. A translated interface is a product decision with real cost (every string, the model's answers already follow the reader's language). The route design that keeps SEO correct when it is made:

- **Path prefix per language** (`/pt-BR/...`), one URL per language per page; never a cookie- or `Accept-Language`-driven page at the same URL (a crawler cannot see it).
- `LOCALES` in `lib/seo/site.ts` is the single list; a locale is added only together with real pages, and `alternatesFor(path, { en: "/x", "pt-BR": "/pt-BR/x" })` then emits reciprocal `hreflang` plus `x-default`.
- `<html lang>` follows the page's language (today it is fixed to `en`); learn pages are written per language by a person, not machine-translated and published unreviewed.
- The first candidate market is Brazilian Portuguese (the owner's language, legal texts already drafted).

## The seven high-intent pages

Rule: each page has **its own argument, its own facts, and a real way to try the product**; none is a template with a swapped phrase. `tests/unit/learnPages.test.ts` holds every page to: unique title (<=60) and description (70-160), at least 350 words and three sections with distinct headings, no paragraph repeated across pages, a demo that links to a real bundled text, only links to pages that exist, none of the banned claims below, and the numbers the code enforces. A page is not published by that test; the owner publishes it.

**Claims that are not allowed on any page today** (banned in the test): semantic search, a Chrome extension, Pocket or Instapaper import, "unlimited", "free forever", "100%", guarantees, OCR. Each can be added to a page only in the change that ships the feature.

| Page (`/learn/...`) | Intent | Its own argument | Demonstration | What it may not say yet | State |
| --- | --- | --- | --- | --- | --- |
| `ai-pdf-reader` | "AI PDF reader" | answers beside the passage, cites paragraphs, says when it leaves the text; honest about scans and tables | the Huxley sample, ask a question | OCR; chat with a whole library | **written (draft)** |
| `read-later-with-ai` | "read later with AI" | saving is the start: marks, notes and questions stay with the text, retrieval later | save a link from the landing page, then mark and ask | a browser extension; mobile share sheet | to write |
| `search-across-documents` | "search across documents" | library search finds words and your own marks across everything saved; says what it did not search | the library search on the three samples | meaning-based search (it is lexical) | to write |
| `save-webpages-permanently` | "save webpages permanently" | the text is kept in your library (not a link that rots), plus backup file | import a link, open it offline-ish from the library | archiving images or the page layout (text only) | to write |
| `personal-knowledge-management` | "personal knowledge management" | a reading-first notebook: marks, questions, notes exported as Markdown | the notebook on the samples | graph view, backlinks, sync with other tools | to write |
| `pocket-alternative` | "Pocket alternative" | what carries over (links, text, marks) and what does not; **blocked** until import from Pocket's export exists, because the page would otherwise promise a migration it cannot do | n/a until import exists | "import your Pocket library" | **blocked on feature C (Pocket and Instapaper import) of the Mission 06 next-phase architecture (`docs/product/NEXT_PHASE_ARCHITECTURE.md`, on branch `mission-06/production-closure`)** |
| `ai-reading-app` | "AI reading app" | the broadest page; the margin as the interface, not a chat window; limits stated | the Huxley sample | being "better than" named competitors without evidence | to write, last |

Writing order follows what is true today: `ai-pdf-reader`, `read-later-with-ai`, `search-across-documents`, `save-webpages-permanently`, `personal-knowledge-management`, `ai-reading-app`, then `pocket-alternative` once Pocket import ships. Each page ships with a screenshot taken from the running product (not mocked) and with copy the owner has read; a page about a competitor is checked for factual claims (dates, shutdowns, formats) against that company's own announcements before it is published.

## Measuring it

`landing_viewed` carries the campaign and referrer host; `channelOf` separates `organic-search` from other sources, so the growth report shows visits and registrations from search per channel. Search Console is the source for impressions and queries and is the owner's to connect (verification is a DNS or HTML-tag change, not made here).

## Owner decisions

1. Read and approve `ai-pdf-reader`; publish it (or not).
2. Language: is the next market Brazilian Portuguese, and who writes/reviews the pages?
3. Which of the other pages to write next, and who checks competitor claims.
4. Connect Google Search Console once the public domain is chosen (`docs/ops/domain-migration.md`).
