# Known limitations

_What the product does not do, or does only in part, stated plainly. Written 2026-10-18; kept in step with `docs/audit/defect-backlog.md`. Nothing here is hidden in the interface: where a limit affects a reader, the interface says so._

## Cannot be verified here

| Limit | Why | How to close it |
| --- | --- | --- |
| No Understand feature has answered from a live model | no `TOGETHER_API_KEY` in this environment | a key in the key panel, then each button; `docs/evolution-report.md` section 8 |
| Translation quality is unknown | needs a key and a person who reads both languages | translate five passages each way and judge them |
| Read aloud and spoken answers are audible | an agent cannot hear; events are verified, sound is not | `docs/audit/tts-validation.md` |
| Microphone recognition | needs a microphone and a person | `docs/audit/voice-search-validation.md` |
| Screen readers | no pass has been made by a person (A11Y-4); axe finds no violations on the library search results and backup panel in light and dark | VoiceOver and NVDA pass |
| Browsers and phones | only Chrome 155 and Playwright Chromium; phone layouts checked by emulated size | open the same texts in Safari, Firefox and on a phone |

## Library search (new)

- **Lexical only.** It matches words and word forms, not ideas: the tokenizer folds case and accents, drops stop words and stems (a full stemmer for English, a light one for Portuguese, a very rough one for Spanish; any other language is stemmed as English). A reader who remembers a concept but not its words will see "nothing found".
- **Only texts whose words are in this browser are searched.** Texts kept on the account but not held locally are counted as "not searched" and matched by title alone.
- **Link cards** (pages that could not be read) have no words to search.
- **Not timed on a large shelf.** An index is built per text on first use and reused while the text is unchanged. Whether typing stays smooth with hundreds of texts is unmeasured (backlog rank 3).
- A query of one character does nothing, by design. A result list is capped, and one text can contribute only a few passages, so a very common word shows a sample, not all occurrences.

## Backup and restore (new)

- **Additive only.** Restore never replaces or deletes. To roll a text back to a backed-up state, remove the text first.
- A text already on the shelf is kept as it is; its marks and questions from the file are added if not already there; a reading position is taken only if newer.
- Marks for a text that is neither on the shelf nor in the file are left out and counted in the result.
- A backup holds only what this browser holds; texts that exist only on the account, and AI results stored only on the server, are not in it.
- The file is **not encrypted**. It contains the reader's texts and notes; keep it where the texts would be kept.
- Files over 40 MB, files that are not this app's backup, and damaged files (offsets that no longer match their quotes) are refused whole.
- Backups are made by hand. There is no schedule and no reminder yet (backlog LIB-2).

## Duplicates (new)

- An address is compared after normalisation: host in lower case, no `www.`, default port dropped, no fragment, no trailing slash, query parameters sorted, and only the tracking parameters `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid` and `ref_src` removed. `ref` and `spm` are kept (some sites use them to pick the content), so a link shared with `?ref=newsletter` is saved as a separate text from the plain link; that is the conservative choice. `http` and `https` of the same address are treated as one.
- A pasted text is compared by a fingerprint of its words (case and spacing ignored) and only when it has 200 or more characters; a shorter text is always added.
- A saved link card is never called a duplicate, so the reader can try the address again.
- Different edits of the same article are different texts.

## Carried from earlier rounds

| Limit | Reference |
| --- | --- |
| `local:` documents never sync to the account | ANNOT-17 |
| A text link is titled by its file name | IMP-7 |
| Reading aloud does not remember where it stopped between presses | TTS-9 |
| The lens toolbar is one tab stop, not arrow-key navigable | A11Y-5 |
| Sites that refuse server fetches need the bookmarklet | IMP-4 |
| A saved link has nothing to annotate or search until its text is brought in | `docs/evolution-report.md` section 12 |
| Rate limits count in the database when there is one (so they hold across instances) and per process when there is not or it is slow; a fixed window allows up to twice the limit across a boundary; there is no global spending cap, only the per-client limits, the concurrency cap per instance and the `[usage]` log lines | `docs/ops/configuration.md` |
| No server backups | operational readiness item 9 |
| Not built: connect an agent (MCP), painted covers, web search inside answers, server TTS and transcription | REF-7, REF-24, REF-25, TTS-R12, VS-R3 |

## Server and sessions (Phase B)

- **There is no production database.** The deployed site runs in local-only mode: every reader's library exists only in that browser. Backup is the only recovery path, and it is manual.
- **Counters are per process.** The AI limits and the import limit (60 per ten minutes) count in one function instance's memory; on Vercel the effective cap is that times the number of warm instances. A speed bump, not a quota or a spending cap.
- **Overlapping first requests.** The client now settles the reader cookie before its first save, but the import routes still mint a cookie themselves, and two tabs opened together by a brand-new visitor can still end up as two readers.
- **Sessions cannot be revoked.** A signed-in session is a signed cookie valid for 90 days; signing out deletes the cookie, but a copied one stays valid until it expires. Relevant only once sign-in is configured.
- **Content Security Policy has no `script-src`.** It covers framing, `<base>` and form targets only; the one raw-HTML sink is a static constant, and imported content is rendered through React.
- **No monitoring or alerting.** Logs are the platform's request logs and 10 `console` calls that record error codes, not text.
- **The browser suite is a dev-server suite.** Run against a production build, 181 of 185 tests pass; see `phase-b-data-and-security.md` section 3c. One end-to-end test (ANNOT-1, real server) is intermittent under parallel load on the dev server.
- **Google sign-in** has not run against Google. The account merge after it is tested against a local PostgreSQL (`accountMerge.test.ts`), never against a production database.

## Added for the controlled public beta

| Limit | Note |
| --- | --- |
| The shared AI is allowed 3 questions a day per browser for visitors (10 per network address, 300 in all) and 20 for a signed-in account, one generation at a time per user, and a global daily and monthly budget; all set by environment variables | `docs/ops/configuration.md`; a reader's own Together key is not counted but also runs one generation at a time |
| Days are UTC days; a fixed window allows up to twice an hourly limit across a boundary; costs are estimates | the spending limit on the provider's account is the hard stop |
| A generation is one request: closing the tab loses it, and a long text's study notes take 45 to 130 seconds | the function limit is 300 seconds; no queue exists and none was needed |
| Several people behind one network address share the address's allowance and its one-at-a-time lease | the per-browser allowance is the one that applies first |
| The browser suite is written for the development server; against a production build over plain http WebKit refuses the `Secure` cookie, and three Chromium tests assume development behaviour | proven separately on the live HTTPS site (`docs/release/BETA_LAUNCH_REPORT.md`) |
