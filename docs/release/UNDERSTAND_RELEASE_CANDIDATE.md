# Understand.io release candidate: Mission 02

Branch `release/mission-02`, based on `main` at `686d3be` (the commit running in production). **Not merged, not deployed.**
Everything below was run on this branch; each number says which commit it was measured on.

## Starting evidence

`docs/release/UNDERSTAND_LAUNCH_TRIAGE.md` was named as the starting evidence. **It does not exist** in this repository (any branch) or on the
machine, so there was no Mission 01 triage to build on. The starting point was instead `docs/audit/defect-backlog.md` and
`docs/audit/security-review.md`, plus a fresh read of the import, reader, AI and persistence code against each item of the brief. Findings
below are only those that were reproduced or shown by a test that fails without the fix.

## Defects fixed

| Issue | Root cause | Fix | Test | Result | Commit | Risk left |
| --- | --- | --- | --- | --- | --- | --- |
| **M2-8** A link, text file or saved page in a legacy charset (ISO-8859-1, windows-1252) is imported with replacement characters in place of accents | The URL route and both file importers decoded every body as UTF-8. Node 24's own `TextDecoder("windows-1252")` also reads the 0x80 block (curly quotes, dashes, euro, bullets) as control characters, so a plain decoder swap would still garble them | `lib/content/charset.ts`: byte-order mark, then the server's charset, then the page's `<meta>`, then valid UTF-8 or windows-1252, with a real windows-1252 table | `charset.test.ts` (13), `import-url-route.test.ts` (7: the real route with canned pages; 3 of them fail on the old decoding, checked by restoring it) | PASS | `0261685` | A charset Node does not know is read as UTF-8; East Asian legacy charsets rely on the runtime's ICU |
| **M2-1** Rate limits (server key, imports) counted in one process's memory: on serverless hosting the cap was the limit times the warm instances | In-memory sliding window only | `rate_hits` table (migration `0005`, additive), one atomic upsert per hashed client and window; the in-process window stays as first check and as the fallback when the store fails or takes over 1.5 s; no raw addresses stored | `rateLimitShared.test.ts` (10): two simulated instances share one counter; real PostgreSQL: 20 concurrent hits count 1..20; window rollover; key stored as hash; fallback on error and on hang; the full run left 18 rows in the table through a production build | PASS | `a0de8d7` | Fixed window: up to twice the limit across a boundary. **No global spending ceiling**, only per-client limits, the per-instance concurrency cap and the usage log |
| **M2-2** A provider that never answers held a request until the platform killed it; transient failures and bursts had no explicit bound | Deadline, retry count and concurrency were implicit | Per-request deadline (50 s streamed, 100 s structured), explicit two retries, a per-instance cap on server-key calls (503 busy, `retry-after`), plain 504 / trailer message on timeout | `ai-reliability.test.ts` (12) runs the real AI SDK with only the network stubbed: timeout, caller leaving (499), retry then success, bounded retries, rejected key not retried, burst and recovery, own key not counted. Each safeguard was broken on purpose and its test failed | PASS | `a0de8d7`, `d143abb` | Concurrency cap is per instance |
| **M2-3** Nothing told the model that the imported document is untrusted | Prompts named no trust boundary | One rule in every prompt (summaries, concepts, questions, translation, margin answers): the title, paragraphs and selection are data, not instructions, and the reader's question cannot change the rules; the document is fenced and cannot close its own fence | `ai-reliability.test.ts`: injected "ignore previous instructions … `</document>`" reaches the model inert; a model answer citing a paragraph that does not exist is shown as unverified interpretation, never as supported by the text | PASS | `d143abb` | A model can still be persuaded. The guarantee is on the output side: nothing is shown as supported by the text without a quote verified against the document (`lib/ai/evidence.ts`) |
| **M2-4** AI spend invisible on the server | No usage record | One log line per answered request: operation, whose key paid, tokens, cost estimate. No text, no key, no reader id | `ai-reliability.test.ts` (asserts the line and that it contains neither title text nor the key) | PASS | `a0de8d7` | Cost is an estimate from a fixed price table |
| **M2-5** A scanned PDF said "may be scanned images" and did not say there is no OCR | Vague message | Says there is no selectable text, that it looks like a scan, that the app does not read text in images (there is no OCR), and what to do | `pdf-unsupported.test.ts` with a real image-only PDF fixture; malformed, empty and truncated PDFs are refused as unreadable | PASS | `ed9dbbc` | None; OCR is not offered and is not claimed |
| **M2-9** A paywalled link (402) answered "That page answered 402." | Status not mapped | Explained as payment or subscription, with the bookmarklet and paste routes | `import-url-route.test.ts` | PASS | `0261685` | |
| **M2-6** Only Chromium was ever run | Single-engine suite | Firefox, desktop WebKit and iPhone WebKit projects for the critical journeys. Two Firefox failures were the harness (one huge `mouse.wheel` is clamped by Firefox), fixed in the test helper, the app was correct | see Browsers | PASS | `3f83546` | |

## Already correct (checked, no change needed)

| Area | Evidence |
| --- | --- |
| URL import blocks SSRF: non-http(s), ports other than 80/443, localhost, private, link-local, CGNAT, metadata and IPv6-embedded addresses; every redirect re-validated; connection pinned to the validated address (DNS rebinding); 5 redirects, 20 s timeout, 10 MB cap | `safeFetch.test.ts`, `safeFetchPinning.test.ts` (real local listener), `safeFetchRanges.test.ts`; on the Preview: `169.254.169.254` and `localhost` refused with 400 and a reason, `not a url` refused |
| Article extraction keeps paragraph order, drops menu / sidebar / footer, keeps title, author and source URL | `import-url-route.test.ts` (new, real extraction on a canned page) |
| PDF: 25 MB upload cap, page / character / time limits, type sniffed from content not extension | `parserLimits.test.ts`, `uploadKind.test.ts`, `pdf-paragraphs.test.ts` |
| Pasted text: HTML is stored and shown as text, never executed | Preview: pasted `<script>alert(1)</script>` comes back as a paragraph of text; `security.spec.ts` |
| Structured AI results: every quote is verified against the named paragraph, offsets come from the document, an unverified claim is shown as interpretation | `ai-evidence.test.ts`, `ai-ops.test.ts`; `scripts/ai-smoke.mjs` repeats the check against a live answer |
| Streamed margin answers: ¶ citations to paragraphs the model was not given are struck through | `gloss-render.test.ts`. **Residual:** this check runs in the browser, on the paragraphs the browser sent; the server does not re-validate them (AI-3 in the backlog) |
| Persistence: server rows are scoped by reader, foreign ids refused, delete not undone by another device; browser-local mode survives refresh | `ownership.test.ts`, `library-sync.test.ts`, `annotations.spec.ts` (ANNOT-1 with two browsers), `position.spec.ts`, `backup.test.ts`. Clearing browser storage loses local-only libraries: documented in `docs/quality/known-limitations.md` |

## Quality gates

| Gate | Commit | Result |
| --- | --- | --- |
| Migrations from an empty database (8 tables incl. `rate_hits`) | `0261685` | PASS |
| `tsc --noEmit`, `eslint` (src, tests, scripts, config) | `0261685` | PASS, 0 errors |
| Unit tests with a real database | `0261685` | **912 passed**, 55 files |
| `next build` (production bundle; test fixtures not in it) | `0261685` | PASS |
| Integration tests against that production build | `0261685` | **27 passed** |
| `pnpm audit --prod` | `0261685` | no known vulnerabilities |
| Secret scan of the whole diff (connection strings, key prefixes, 64-hex strings) | `71e2a2f` | none found |
| Developer database untouched by the runs | both | 538 documents before and after |

### Browsers

Run on `71e2a2f` (the later commit `0261685` changes only server-side decoding of fetched and uploaded bytes, one status message, tests and docs; no UI file):

| Engine | Specs | Result |
| --- | --- | --- |
| Chromium desktop and Pixel 7 | full functional suite | **197 passed** |
| Firefox | import, reader, annotations, reading position, isolation | **32 passed** |
| WebKit (Safari engine) | same | **32 passed** |
| WebKit, iPhone 14 | mobile reader | **2 passed** |
| Chromium visual baselines (5 themes, desktop and phone) | | **46 passed** |

Exceptions, console errors and layout overflow are asserted inside these specs (`collectErrors`, `phone-layout.spec.ts`, axe in `a11y.spec.ts`).

## Production-like Preview

Vercel built the branch (`71e2a2f`) as a Preview: the build log says `Skipping database migrations (VERCEL_ENV=preview, not a production build)`,
so a Preview cannot change the production schema. The Preview has no database and no model key by design. Through `vercel curl`:
home, reader and library 200; reader bootstrap `persisted:false` (local-only mode); text import works locally; pasted `<script>` kept as text;
scanned PDF refused with the no-OCR message (422); metadata address, localhost and a malformed URL refused (400); `/api/ai` answers 402
(no key). The Preview was **not** driven by a real browser (it is behind Vercel login).

## NOT_TESTED

* **A real browser against a production build or the Preview.** The browser suites run against the dev server. A run against `next start`
  was started and could not execute: the Playwright browser cache (`~/Library/Caches/ms-playwright`) had been deleted from the machine between
  runs. Reinstalling needs a download (`npx playwright install chromium firefox webkit`), which was not done without asking.
* **All browsers after `0261685`** (same reason). The change is server-side decoding; no UI file changed.
* **A real-provider answer.** See Blockers.
* Rate limits across real serverless instances (tested with simulated instances and real PostgreSQL concurrency).
* A hostile DNS server that really rebinds; a screen-reader pass (A11Y-4).

## Blockers

1. **BLOCKED: no working model key in production.** `TOGETHER_API_KEY` is set in Production but the provider answers **401** (the log shows
   `[ai] provider call failed: 401`). The value entered showed 63 characters; Together keys are normally 64, so it was probably cut off when
   pasted. Until a valid key is stored, Study notes and every AI answer fail on production, and the real-provider smoke test cannot pass.
   After re-adding the key and redeploying: `node scripts/ai-smoke.mjs https://understand-io.vercel.app` (one tiny request; checks every quote
   independently and that an instruction hidden in the text is not obeyed).
2. No P0 or P1 defect remains open in the code.

## Notes for Mission 03 (deployment)

* Merging to `main` makes Vercel build Production; that build applies migration `0005` (one new table and index, no existing data touched)
  before `next build`, as it did for `0004`.
* New optional settings: `GLOSS_AI_TIMEOUT_MS`, `GLOSS_AI_STREAM_TIMEOUT_MS`, `GLOSS_AI_MAX_CONCURRENT` (`docs/ops/configuration.md`).
* CI runs `rateLimitShared.test.ts` in its database job.
* `setSharedCounter` in `lib/server/rateLimit.ts` is a test seam; nothing in the application calls it.

## Definition of done

| # | Requirement | Result |
| --- | --- | --- |
| 1 | Homepage and reader load | PASS (Preview 200, browsers) |
| 2 | Supported imports work | PASS (URL route with canned pages, files, pasted text; integration suite) |
| 3 | Text selection works | PASS on Chromium, Firefox, WebKit, iPhone WebKit (`annotations.spec.ts`) |
| 4 | Contextual AI answers from real document context | PASS in tests with the real AI SDK and a stubbed provider; **BLOCKED live** (key) |
| 5 | Citations resolve to real passages | PASS for structured results (server-verified); streamed answers verified in the browser only |
| 6 | Data persists as advertised | PASS |
| 7 | No P0/P1 blocker unresolved | PASS for code; the model key above is an operational blocker for AI features |
| 8 | Tests and production build pass | PASS |
| 9 | Critical mobile flows | PASS (Pixel 7 Chromium, iPhone WebKit) |
| 10 | Production-like Preview tested | PASS by HTTP; not by a real browser |
