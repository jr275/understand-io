# Brand migration: Understand.io → Keeple.me

A rename, not a rewrite. Functionality, data, accounts, integrations, the database, the Vercel and Google Cloud projects and every credential are untouched. Nothing was deployed, no migration was applied to a shared database, no DNS or redirect was changed.

* Product name: **Keeple.me** (short form **Keeple**). Previous: Understand.io.
* Where it lives: `src/lib/brand.ts` (one module; no imports). The dictionaries (`en`, `pt-BR`), the SEO module, the social card, the AI prompt, the bookmarklet labels and the import/backup messages all read from it.
* Branch: `feat/keeple-brand-migration`, stacked on `feature/i18n-en-pt-br` (PR #20). See "Dependencies".
* Domain, Google and mail activation: [`domain-and-oauth-plan.md`](domain-and-oauth-plan.md).

## Dependencies on open release PRs (none were modified)

The bilingual product, the locale routes, sitemap/robots, OG cards and the SEO module do not exist on `main`; they are in the stack #12 → #13 → #18 → #19 → #20. The rename edits files those PRs create or change (`i18n/messages/*`, `lib/seo/*`, `app/layout.tsx`). So this branch is based on the tip of that stack and its PR targets `feature/i18n-en-pt-br`. It cannot merge before #20 (and #12 to #19 beneath it). If the stack is squashed or re-ordered, this branch rebases onto the new tip; the edits are small and mostly one-line.

## Classification of every occurrence

A user-visible branding · B internal technical identifier · C historical record · D external integration · E legal or contractual.

| Class | What | Count / where | Decision |
| --- | --- | --- | --- |
| A | Wordmark, titles, `applicationName`, OG/Twitter, social card, hero metadata, `landingTitle`, learn page copy, sample page description | `layout.tsx`, `Topbar.tsx`, `lib/seo/*`, dictionaries | **Renamed** from `BRAND` |
| A | Dictionary strings that name the product (16 per language) and the bookmark labels | `i18n/messages/en.ts`, `pt-BR.ts` | **Renamed** (`Read in Keeple` / `Ler no Keeple`, `Save to Keeple` / `Salvar no Keeple`) |
| A | Import errors that point at the bookmark; "not a Keeple.me backup"; backup download file names (`keeple-backup-…`, `keeple-notes-…`) | `importStatus.ts`, `backup.ts`, `BackupPanel.tsx`, `serverMessages.ts` | **Renamed**; the regex catalogue that translates server messages was updated with them |
| A | AI persona ("You are Keeple.me, a careful reading companion") | `lib/ai/prompts.ts` | **Renamed** |
| A | The reader panel "Understand" (summaries, concepts, questions, translation) and "Gloss" / "glossed" (margin notes) | dictionaries, reader | **Kept.** These name features, not the product. Renaming a feature is a product decision, not part of a brand change |
| B | Package `gloss`, repository `understand-io`, Vercel project `understand-io`, Neon database, DB roles `understand_*`, dump names `understand-*.dump` | `package.json`, `scripts/`, `scripts/sql/` | **Kept.** Renaming touches production (aliases, roles, backups) and gains nothing visible |
| B | `GLOSS_*` environment variables, `gloss_*` cookies, `x-gloss-*` headers, `/api/gloss` | code, `.env.example` | **Kept.** Renaming would sign everyone out and break configuration |
| B | Bookmarklet message types `understand:ready` / `understand:page` | `bookmarklet.ts`, `ImportBar.tsx` | **Kept.** Bookmarklets already saved in readers' browsers speak these |
| B | Backup file `app` marker `understand-io` | `BRAND.legacy.backupApp` | **Kept.** Old backups still restore; new ones still open in an older copy |
| B | Test fixture host `understand.example` | `tests/unit/*` | Kept (an example host, never resolved) |
| C | Earlier reports, audits, release notes, evolution report, launch docs | `docs/` (38 lines in 17 files) outside `docs/legal` | **Kept as written.** They record what was true then. The README now says the product is Keeple.me |
| C | Old drizzle snapshots mention `gloss` | `drizzle/meta` | Kept (migration history) |
| D | Google OAuth consent-screen app name and authorized domains; Vercel domain list; Neon/Together/Vercel account names | outside the repo | **Plan only**, in `domain-and-oauth-plan.md` |
| E | Privacy policy, terms, AI notice, beta notice, retention policy (en and pt-BR) | `docs/legal/*` | Renamed to "Keeple.me (formerly Understand.io)"; the terms carry a new explicit `LEGAL REVIEW` item; `OPEN_ITEMS.md` regenerated (20 legal-review items). Not published: publication is gated by `GLOSS_LEGAL_PUBLISHED=1` |
| E | Operator "Menlo Software AIP" | legal texts | Unchanged (the entity is not the product) |

Remaining `understand.io` / `understand-io` after the change: 66 lines in 34 files, all class B, C or a fixture, the five deliberate "formerly Understand.io" lines in the legal texts (class E), and `src/lib/brand.ts` itself, which records the previous name. A unit test (`tests/unit/brand.test.ts`) fails if the old name reappears in `src/` outside `brand.ts` and the legacy identifiers.

## Files changed (37, +296 / −103)

* **New:** `src/lib/brand.ts`, `tests/unit/brand.test.ts`, `docs/brand/*`.
* **App:** `app/layout.tsx`, `app/read/[slug]/page.tsx`, `components/chrome/{Topbar,marks}.tsx`, `components/library/BackupPanel.tsx`.
* **i18n:** `i18n/messages/{en,pt-BR}.ts`, `i18n/serverMessages.ts`.
* **Lib:** `lib/ai/prompts.ts`, `lib/client/bookmarklet.ts` (comment), `lib/seo/{learn,ogCard,site}.ts(x)`, `lib/server/importStatus.ts`, `lib/store/backup.ts`.
* **Legal:** ten files in `docs/legal/` (five documents × two languages, plus the regenerated `OPEN_ITEMS.md`).
* **Tests:** `tests/unit/{backup,i18nCoverage,seo,seoRoutes}.test.ts`, `tests/e2e/{landing,library,library-search,seo}.spec.ts`.
* **README.md.**
* Two stray `sed` backup files were committed by mistake and removed in follow-up commits; the net diff contains neither.

## Visual identity

The brief asks for a consistent new identity. What exists now: the name everywhere, the brand colours and typography recorded as configuration (`BRAND.colors`, `BRAND.typography`, mirroring the existing `--bg` / `--ink` tokens and the four `next/font` families), the social card drawn from them, and the existing mark kept (three text lines, a faint rule and a rubric dot, which already says reading and organisation). **No new logo or palette was designed:** that needs a design decision and artwork from the owner. When it exists, the mark is one component (`components/chrome/marks.tsx`), the favicon one file (`app/favicon.ico`) and the colours one object.

## Bilingual coverage (en, pt-BR)

The product already had full English and Portuguese on the stack this branch sits on: locale routes (`/pt-BR/...`), a persisted choice, `hreflang`, per-language OG cards, translated server messages and a dictionary-coverage test. The rename keeps that intact:

* Every changed string is in both dictionaries; `tests/unit/i18nCoverage.test.ts` checks both have the same keys and placeholders and that the proper noun is whitelisted as untranslatable (`Keeple.me`).
* `tests/unit/brand.test.ts` checks the SEO title, description and the home-link label in both languages against `BRAND.copy`, and the bookmark labels in both.
* Browser: `i18n.spec.ts`, `pt-journey.spec.ts` (home → several links → library → reader → Understand panel in Portuguese), `seo.spec.ts`, `multi-links.spec.ts` (English and Portuguese).
* The server answers in English by contract and the client translates it (`serverMessages.ts`); the new "not a Keeple.me backup" and bookmark messages are in that catalogue and its test.

## Homepage ingestion

Unchanged and verified: the home page leads with the import bar; several links pasted one per line are read in (`multi-links.spec.ts`, 28 tests, English and Portuguese, including accessibility of the running and finished lists).

## Tests and results (this machine, 2026-11-03)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| Unit (`pnpm test`) | 89 files, **1507 passed**, 0 failed (against a disposable local Postgres, see below) |
| Integration `legal` | 7 passed. The other integration files (accounts, allowances, ownership, ingest) need a running server and were not run: nothing they cover changed |
| `pnpm build` | pass |
| Browser, desktop: landing, seo, i18n, pt-journey, library, library-search, add-content, multi-links | 98 passed, **1 failed once** (`multi-links` a11y test 13, English: "Open your library" link not visible); the same test passed alone and the whole `multi-links` spec passed on re-run (28/28). Treated as a first-run timing flake, not proven on the base |
| Browser, desktop: reader, understand, phone-layout, a11y, security, ai-limits | 95 passed |
| Firefox, WebKit, mobile projects | not run: nothing in the change affects engine-specific behaviour |
| Visual baselines (`pnpm test:visual`) | **fail on this machine, with or without the rename**: the unmodified base also differs (landing 66,064 px on base, 66,779 px with the rename; the extra ~700 px is the shorter wordmark). The baselines were made with a different Chromium/fonts. They were not regenerated, so as not to mix environment drift with the rename |
| Secret scan | gitleaks on the branch's commits: no leaks. Tracked tree: no matches except pre-existing test sentinels and CI placeholders. 22 gitleaks findings are all in gitignored local files (`.env.local`, `.next`) and none is tracked |

Environment note: the existing local database `gloss` is behind this branch's migrations (no `content_hash` column), so DB-backed unit tests failed against it before any change of mine. I did **not** migrate it (another session may use it). I created a disposable database `keeple_brand_scratch`, migrated only that, ran the tests against it and dropped it afterwards.

## Reverting

Revert the branch's commits, or edit `src/lib/brand.ts` and the legal texts. No data, migration, cookie, credential or identifier depends on the name.
