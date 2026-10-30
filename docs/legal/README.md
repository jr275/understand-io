# Launch legal drafts

These are **drafts**, written from the code and from `docs/privacy-and-providers.md`. They are not legal advice and have not been reviewed by counsel. Do not publish any of them until every item below is closed and a lawyer has reviewed the texts.

Each document exists in English (`.en.md`) and Brazilian Portuguese (`.pt-BR.md`), with the same placeholders:

- `privacy-policy`, `terms-of-use`, `ai-notice`, `retention-and-deletion`, `beta-notice`

Placeholders look like `⚠️ [OWNER DECISION: ...]` or `⚠️ [LEGAL REVIEW: ...]`. Search for `⚠️` to find them all. HTML comments starting with `NOTE FOR OWNER` mark places where the code and an older doc disagree, or where a shipped value must be checked.

## Open items

"Every file" means both language versions. "Contact", "date" and similar items appear in several places and are listed once.

| Item | File | Why it is open |
| --- | --- | --- |
| Operator legal name, address, registration number | privacy-policy, terms-of-use | No legal identity exists in the repo; it must come from the owner. |
| Contact email or form (privacy, deletion requests, bug reports) | every file | No contact channel exists in the repo or the app. |
| Date of publication ("Last updated") | every file | Set when the texts are published. |
| Privacy contact or data protection officer | privacy-policy | Whether one is required, and who it is, is a legal decision. |
| Region of the Vercel deployment and the Neon database | privacy-policy | The repo does not state any region. |
| Transfer mechanism and disclosures for data processed abroad | privacy-policy | Vercel, Neon, Together AI and Google are third parties that may process data in other countries; a lawyer must say what is required. |
| Cookie consent or notice | privacy-policy | Three cookies are set (`gloss_reader`, `gloss_session`, `gloss_oauth`); whether a banner is needed depends on the countries served. |
| Legal bases for each purpose | privacy-policy | A lawyer must choose and state them. |
| Wording of user rights, identity checks, authority to name | privacy-policy, retention-and-deletion | Legal wording; no rights language was invented. |
| What each provider logs and the terms under which it acts for us | privacy-policy | Provider terms are outside the repo. |
| Minimum age and children's data | privacy-policy, terms-of-use | No age rule exists in the app or the repo. |
| How users are told about policy and terms changes | privacy-policy, terms-of-use | Needs a decision (in-app notice, email). |
| Time to answer data requests | privacy-policy, retention-and-deletion | No service level is defined. |
| Together AI retention and training terms, and the operator's account settings | ai-notice, retention-and-deletion | Not stated in the repo; must be read from Together AI's current terms and the account. |
| Licence status of the built-in sample texts | terms-of-use | The app labels them public domain; the source files cite Project Gutenberg; a lawyer should confirm. |
| Licence wording for storing and processing user content | terms-of-use | Legal wording. |
| Availability or support commitment (if any) | terms-of-use | None is promised in the drafts; owner may want one. |
| Disclaimer and limits of liability | terms-of-use | Must be valid under the laws that apply, including consumer law. |
| Price: free beta, future paid plans, notice before charging | terms-of-use | No payment feature exists in the app; pricing is the owner's call. |
| Notice period and export time before the service or beta ends | terms-of-use | Owner decision. |
| Governing law, courts, consumer rights that cannot be waived | terms-of-use | Not invented; a lawyer must choose. |
| Log retention on the Vercel plan | retention-and-deletion | Set by the Vercel plan, not the code. |
| Database backups or point-in-time recovery on the Neon plan, and how long | retention-and-deletion | The app makes no server backups; the provider may. |
| Backup retention period (deleted data may remain in backups) | retention-and-deletion | Depends on the previous item. |
| Period after which inactive readers and accounts are deleted, and whether one is required | retention-and-deletion | The code never deletes them; there is no self-service account deletion. |
| Contact for feedback and bug reports | beta-notice | See contact above. |

## Checks for the owner (HTML `NOTE FOR OWNER` comments)

| Check | File | Why |
| --- | --- | --- |
| Confirm the shipped beta limits match the text (anonymous 3 AI questions per day per client, signed-in 20 per day, one generation at a time per user, document size limits, global daily budget) | privacy-policy, ai-notice, beta-notice, retention-and-deletion | The limits are being built now. The code I read has only hourly limits (30 AI, 60 search, 15 transcription per client; 60 imports per ten minutes), and only when the operator's key pays. |
| Decide whether the new limits also apply to a reader's own Together key | privacy-policy, ai-notice | Today a reader's own key is not limited. |
| Confirm a production database on Neon is on (and its plan and region) | privacy-policy | `docs/ops/configuration.md` and `docs/ops/runbook.md` (2026-10-18) say no production database was configured. |
| Google sign-in stores name and picture address, not only id and email | privacy-policy | `docs/privacy-and-providers.md` says "account id and email"; `schema.ts` and `auth.ts` store more. The draft follows the code. |
| Rate limits also count in the `rate_hits` table (hashed keys) | privacy-policy | `docs/privacy-and-providers.md` says the limiter is per process only; `rateStore.ts` adds a shared database counter. |
| PostgreSQL is named as Neon, not "your own database" | privacy-policy | `docs/privacy-and-providers.md` still says "your own database". |
| `settings` table exists but nothing writes to it | privacy-policy | Settings stay in the browser. Update the policy if sync is added. |
| Request-counter expiry is twice the window | retention-and-deletion | Changes with daily limits. |
| Character amounts sent to the AI (about 24,000 for margin answers, 110,000 for summaries) | ai-notice | True in `Reader.tsx` and `ops.ts` today; update if the new size limits change them. |

## Other things noticed (not in the drafts)

- The app has no page for the privacy policy, terms, AI notice or beta notice yet, and no link to them from the interface.
- The in-app text is in English only; the Portuguese drafts name interface buttons as they appear in English ("Download backup").
- Sessions cannot be revoked by the server before 90 days (`docs/quality/phase-b-data-and-security.md`, S1). The drafts say so plainly.

## How these texts reach readers

The app has the pages and the links, switched off. `/privacy`, `/terms` and `/legal/ai-notice`, `/legal/retention`, `/legal/beta` (each in English, `?lang=pt` for Portuguese) answer **404**, and the links "Privacy · Terms" are not drawn on the landing page or in the library, until **both** of these are true:

1. The operator sets `GLOSS_LEGAL_PUBLISHED=1` in Production and redeploys.
2. The text itself is final: **no `⚠️` marker is left in the English or the Portuguese file** (every open owner decision, every legal review item and the "draft, not legal advice" banner carries one). If the variable is on while a marker is left, the page stays a 404 and the server log says `[legal] <text> is not shown: it still has open items`.

So the order is: fill the fields (`OPEN_ITEMS.md` lists every one; rebuild it after each edit with `node scripts/legal-open-items.mjs`, and `--check` fails if it is stale or the two languages differ), have the texts reviewed, remove the markers and the banner in both languages, merge, and only then set the variable. To preview final texts without touching these files, put them in a subfolder of `docs/legal` and start the server with `GLOSS_LEGAL_SET=<folder>` (the repository's own tests use `test-fixtures`).

The in-app text is English; the Portuguese texts name interface buttons as they appear ("Download backup", "Remove").
