# Final QA report: Understand.io (code folder `gloss`)

_Written 2026-10-17. Everything here comes from commands run and files read in this audit. Where something was not exercised, the report says so. Supporting detail is in `docs/audit/`. The earlier report (reference-fidelity audit, the 403 import fix and the database-outage defect write-up) is in git history before this commit, and its screenshots remain in `docs/qa/`._

## A. Executive summary

**Verdict: functionally usable with known limitations.** It is not a release candidate, and it is not production-ready.

What works, with evidence: the landing page, library, reader, link, PDF, text and bookmarklet import, highlights, underlines and notes with local plus PostgreSQL persistence, per-reader data isolation, read-aloud controls (driven against fake engines and against the real Chrome 155 speech engine for events and flags), typed and fake-recogniser voice search with measured retrieval quality, accessibility checks that now report no axe violations, and a hardened server (SSRF pinning, request caps, cross-site guard, headers, rate limits on the shared key). Typecheck, lint, 752 unit tests, 169 end-to-end tests and 46 visual comparisons, the production build and the dependency audit all pass.

What is not proven, and why it matters to you:

- **Nobody has heard the read-aloud audio.** An agent cannot hear. Chrome reports the utterances as started and ended, which is strong but not conclusive.
- **Nobody has spoken into the microphone.** Real speech recognition and server transcription were never run.
- **No live model call was made.** There is no Together AI key here, so margin answers, whole-text answers, embedding re-rank and Whisper transcription are untested against the provider.
- **Google sign-in was never run.** There are no OAuth credentials here.
- **Touch selection, Safari, Firefox and real phones were not tested.**

Not "production-ready": there is no CI, no monitoring, the rate limiter is per process, the server has never run behind real TLS or a real host, and the items above are unverified. A passing build is not a readiness claim.

Over both briefs and the visual pass: 122 findings were tracked; 92 are fixed with a test or a recorded run, 19 are partial with the residual named, 8 are open, 3 are not defects (`docs/audit/defect-backlog.md`). Test count went from 42 unit and 32 end-to-end to 752 and 169, plus 46 visual comparisons.

**Second brief (intelligent reading, see `docs/evolution-report.md`).** The reader now has summaries in five kinds, key concepts, comprehension questions, translation of a selection and of the text part by part, literal search with section navigation, checked citations, honest coverage statements, a way back to where you were, and a conversation by voice with spoken answers. The partner logo is gone and any readable link or PDF can be opened. **None of the AI features has been run against a live model**: there is no key here, so what is verified is the pipeline around the model (request, validation, quote checking, coverage, storage, display, navigation, errors) with a fake model, not the quality of any answer.

## B. Verified environment

| Item | Value |
| --- | --- |
| Project path | `/Users/joaormendes/gloss-reconstruction/gloss` |
| Branch | `main`, no remote configured |
| HEAD when this report was written | `0987206` (the commit containing this report follows it; `git log -1` shows it) |
| Node.js / pnpm | v24.9.0 / 12.10.1 |
| Next.js / React / TypeScript | 16.4.2 / 19.3.0 / 5.9.3 (strict) |
| Test runners | Vitest 5.0.5, Playwright 1.64.1 (Chromium desktop and Pixel 7) |
| Database | PostgreSQL 16.15 (Homebrew), accepting connections on 5432, database `gloss`, 3 migrations applied (0000, 0001, 0002) |
| Dev database contents now | 266 documents, 73 annotations, 0 glosses, 529 readers, 104 progress rows, 0 accounts. At the start of the audit: 49, 25, 0, 86, 28, 0. The end-to-end suite writes into this database on every run, so most of the growth is test residue. Nothing was deleted |
| Local URL | http://localhost:3100 (a `next dev` process whose working directory is this folder is serving it) |
| Start command | `pnpm dev --port 3100` |
| Real browser used | Google Chrome 155 on macOS (the user's own), driven through the Claude in Chrome extension; Playwright's Chromium for automated runs |
| Environment variables present (names only) | `DATABASE_URL`, `GLOSS_COOKIE_SECRET`, `GLOSS_CHAT_MODEL`, `GLOSS_EMBED_MODEL`, `GLOSS_WHISPER_MODEL`, `TOGETHER_API_KEY` (empty). Absent: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` |

Full inventory: `docs/audit/environment-inventory.md`.

## C. Test results

All run on 2026-10-17 in this folder; exit codes are real.

| Command | Result | Output that matters | Exclusions | Mocks | Limitation |
| --- | --- | --- | --- | --- | --- |
| `pnpm typecheck` | exit 0 | clean | none | n/a | none |
| `pnpm lint` | exit 0 | clean, 0 warnings | `test-results/` and scratch outputs are ignored | n/a | none |
| `pnpm test` | exit 0 | 39 files, 752 passed, 0 failed, 0 skipped | none | speech engines, microphone, recorder and `fetch` are fakes in the speech and voice tests; the database is **not** mocked (outage tests use the real driver against a dead port); the models are never called | 201 tests are seeded random anchor cases; some account-merge cases need PostgreSQL |
| `pnpm test:e2e` | exit 0 | 169 passed (167 desktop, 2 mobile), 0 failed, 0 skipped, no retries | none | speech engine is a fake; voice search uses typed input; models answer 402 (no key) | runs against `next dev` and the shared development database, one worker |
| `pnpm build` | exit 0 | compiled; warning: no fallback font metrics for Atkinson Hyperlegible Next | none | n/a | production server behaviour (`next start`, TLS, CDN) not exercised |
| `pnpm audit --prod` | exit 0 | no known vulnerabilities | dev dependencies not audited | n/a | reflects the advisory database at run time |
| `pnpm exec tsx scripts/eval-retrieval.mts` | exit 0 | top-1 57.7 %, top-3 69.2 % on 26 sample-document queries; absent concepts showing hits 1 of 7; 215 of 215 offsets exact | meaning re-rank not evaluated | none | 41 hand-written queries: a regression signal, not an accuracy claim |
| `pnpm exec tsx scripts/visual-diff.mts` | exit 0 | pixel difference 0.42 % to 16.40 % (table in `docs/audit/visual-accessibility-review.md`) | five screens have no reference capture | none | a comparison between two runs, not a pass mark |

Baseline before any change (HEAD `e6fd1d7`): typecheck, lint, 42 unit, 32 end-to-end, build and audit were green; `prettier --check` failed on 115 files (formatting only, HYG-1). See `docs/audit/baseline-results.md`.

## D. Feature verification matrix

Status words are the six allowed values. Full 71-row matrix with sources, tests, dates and next actions: `docs/implementation-status.md`. Evidence for each row: `docs/audit/requirements-traceability.md`.

| Requirement | Status | Evidence | Remaining blocker |
| --- | --- | --- | --- |
| Landing and navigation | VERIFIED WORKING | `landing.spec`, axe | none |
| Library and document lifecycle | VERIFIED WORKING | `library.spec`, `reader.spec`, `a11y.spec`; Colour sort and topic persistence untested | Colour sort test |
| URL import | VERIFIED WORKING | live fetches of public pages, `api.spec`, `safeFetch*` tests | sites that answer 403 need the bookmarklet |
| Bookmarklet import | VERIFIED WORKING | `landing.spec` handshake tests; run for real on a live Atlantic article in Chrome | none |
| PDF and text import | VERIFIED WORKING | `content.test`, `pdf-paragraphs.test`, `import-and-isolation.spec`; real arXiv PDF imported | figure and table text still forms some short blocks (IMP-5) |
| PostgreSQL persistence | VERIFIED WORKING | I/E specs write and read real rows; outage reproduced with the real driver | no disposable test database |
| Read-aloud controls | VERIFIED WORKING | 74 unit tests, 27 e2e speech and voice tests, real Chrome 155 run of the rewritten controller (pause, skip while paused, resume, back, stop, 0 errors) | other browsers |
| Audible output | BLOCKED | none: no independent human verification has occurred | a person must listen (`docs/audit/tts-validation.md`, Level 3) |
| Passage-level reading | VERIFIED WORKING | e2e: select, read that passage, continue; voice hit read-only | audibility as above |
| Microphone permissions | IMPLEMENTED, NOT VERIFIED | 26 lifecycle tests with fake devices | a person must grant and deny the prompt in Chrome |
| Real speech transcription | IMPLEMENTED, NOT VERIFIED (browser recogniser); BLOCKED (server Whisper) | fake recogniser only; no key | a person speaking; a Together key |
| Semantic passage retrieval | BLOCKED (meaning re-rank); VERIFIED WORKING (lexical) | 134 retrieval tests, labelled set; re-rank needs a key | Together key |
| Exact source navigation | VERIFIED WORKING | e2e jump and mark; 215 of 215 hit offsets slice back to the excerpt | none |
| Annotation anchoring | VERIFIED WORKING | `anchors-*` tests (251, of which 201 are seeded random cases), randomised contract, real-Chromium triple-click | Safari and touch unverified |
| Annotation persistence | VERIFIED WORKING | `annotations-api.spec`, `library-sync.test`, two-device deletion e2e | `local:` documents never sync (ANNOT-17) |
| AI provider integration | BLOCKED | 402 path, request limits, error hygiene only | Together key |
| Google OAuth round-trip | BLOCKED | pure helpers and disabled-state UI only | Google client id and secret |
| User data isolation | VERIFIED WORKING | `import-and-isolation.spec`, `annotations-api.spec` (409, invisible reads) | none |
| Responsive behavior | PARTIALLY IMPLEMENTED | `mobile.spec`, axe at 375 px (Pixel 7 emulation) | real phone, touch |
| Visual fidelity | PARTIALLY IMPLEMENTED | pixel diff 0.42 % to 16.40 %; painted art and logo are stand-ins | none required |
| Accessibility | VERIFIED WORKING (automated: 0 axe violations in every state of all five themes, visible focus, dialog focus) | `a11y.spec` | no screen-reader pass |
| Security review | PARTIALLY IMPLEMENTED | 9 of 16 findings fixed, 5 partial, 2 information | shared limiter, anonymous growth cap, CSP script-src |
| Production build | VERIFIED WORKING | `pnpm build` exit 0 | production host not exercised |
| Database outage tolerance | VERIFIED WORKING | `db-outage.test`, `annotation-routes-outage.test`, real app on a dead port | none |
| Dialog keyboard focus | VERIFIED WORKING | 4 e2e (found and fixed in this audit) | none |
| Open any readable link or PDF by URL | VERIFIED WORKING | `classifyFetched` unit tests; live imports of an arXiv PDF URL and a Gutenberg text URL; an image URL refused | sites that answer 403 need the bookmarklet |
| Summaries (5 kinds), concepts, comprehension questions | VERIFIED WORKING for the pipeline; BLOCKED for the live model | `ai-ops`, `ai-route` (fake model), `understand.spec` (stand-in) | a key, to see real output |
| Evidence checking and coverage statements | VERIFIED WORKING | `ai-evidence`, `ai-ops` | none |
| Translation (selection; whole text part by part) | VERIFIED WORKING for the pipeline; BLOCKED for quality | `ai-ops`, `understand.spec` | a key and a bilingual reader |
| Checked citations in margin answers | VERIFIED WORKING | `gloss-render`, `understand.spec` | the model's use of its labels is unverified |
| Find in the text, sections, back to where you were, resume | VERIFIED WORKING | `find`, `find.spec`, `position.spec` | none |
| Ask by voice or typed, spoken answers | VERIFIED WORKING for the flow (fakes); BLOCKED for audio and microphone | `voice-ask` unit and e2e | a person with speakers and a microphone, and a key |

## E. Defects

Complete list with severity and status: `docs/audit/defect-backlog.md` (122 entries). The ones that mattered most, with root cause, correction and regression test:

| ID | Sev | Root cause | Correction | Regression test | Status |
| --- | --- | --- | --- | --- | --- |
| IMP-4 "That page answered 403." | P2 | some publishers refuse server-side fetches by TLS fingerprint | clear message; capture bookmarklet hands the page HTML from the reader's own browser to the server | `importStatus.test`, `landing.spec`, real article | Fixed |
| DB-1 library 500 and overlay when PostgreSQL was down | P1 | server components assumed a database; the save path leaked SQL | `isConnectionError`, degraded results with `persisted:false`, generic messages | `db-outage.test` (real driver, dead port) | Fixed |
| SEC-1 server key usable by anyone | P1 | no metering, loose bounds | per-reader and per-address limiter, schema bounds, fixed provider errors | `serverKeyAbuse.test` | Partial (per process) |
| ANNOT-1 deleted marks resurrected by another device | P1 | sync re-posted anything missing remotely | `syncedAt` marks, tombstones until confirmed, per-id ordering | `library-sync.test`, e2e with the real server | Fixed |
| VOICE-1 any re-render ended recognition | P1 | cleanup effect depended on an inline callback | callbacks through a ref, session tokens | `voice-search.test`, e2e scroll test | Fixed |
| VOICE-2/4 late result or permission grant acted after close | P1 | no session ownership | every callback bound to a session; abort on close | `voice-search.test` | Fixed |
| TTS-1 silence after pause, skip, speak | P1 | `cancel()` can leave `paused` true | un-pause after every cancel | `speech-controller.test`; confirmed in real Chrome | Fixed |
| RETR-1/2 confidence skewed by filler words | P1 | query filler counted; "none" only on zero overlap | idf-weighted coverage, filler list, rare-word rule | `retrieval.test` | Fixed |
| SSRF rebinding, ports, ranges (SEC-3, 10) | P2 | check-then-use DNS, no port policy, gaps | connect-time pinned lookup, ports 80/443, full ranges | `safeFetchPinning/Ranges.test` | Fixed |
| SEC-4 sign-in destroyed another account | P2 | cookie of another account merged or adopted | `planSignIn`, unique `accounts.reader_id` | `accountMerge.test` | Fixed |
| SEC-5 pathological HTML or PDF froze or killed the server | P2 | unbounded synchronous parsing | element, depth, page and character limits, deadline | `parserLimits.test` | Fixed |
| A11Y-1 368 axe violations | P2 | contrast tokens, names, landmarks | token changes, names, landmarks | `a11y.spec` | Fixed |
| A11Y-3 aria-modal dialogs did not trap or restore focus | P2 | no focus management | `useModalFocus` | 4 e2e (fail without it) | Fixed (this stretch) |
| VOICE-7 typed text overwritten by a late spoken result | P2 | final handler ignored typing | typed text wins, spoken result dropped | `voice-search.test` | Fixed (this stretch) |
| SEC-11 DB errors with note text logged by annotation routes | P3 | guard rethrew non-outage errors | code-only log, fixed 500 | `guarded-errors.test` | Fixed (this stretch) |
| TTS-12 focus lost when Stop closed the listen bar | P2 | bar unmounted with focus inside | focus to listen button or the text | 2 e2e (fail without it) | Fixed (this stretch); shortcut off-switch still open |
| AI-1 a model's ¶ citation always linked, even to paragraphs it was never given | P1 | citations were trusted | the paragraphs given are stored per answer and others are struck through; evidence quotes are checked against the document | `gloss-render.test`, `ai-evidence.test` | Fixed |
| AI-2 an overview of a sample was presented as the whole text | P2 | no coverage statement | every AI result says which paragraphs were read | `ai-ops.test`, `understand.spec` | Fixed |
| IMP-6 PDF links served as octet-stream, and text links, were not imported | P2 | the server's label was trusted | links classified by bytes and type | `uploadKind.test`, live imports | Fixed |
| IMP-1 a GIF imported as a text document | P2 | no content sniffing | content sniffing | `uploadKind.test`, e2e | Fixed |
| IMP-5 PDF paragraphs fused with headings | P2 | line-end text without paragraph gaps | break on vertical gaps larger than 1.5 times normal | `pdf-paragraphs.test` | Fixed, with a cost (see G) |

Open: AI-4 (no live model run), A11Y-4 (no screen-reader pass), ANNOT-17, IMP-3, IMP-7, RETR-10, A11Y-5, BUILD-1.

## F. External dependencies

| Dependency | Needed for | Configured | Cost | Verification |
| --- | --- | --- | --- | --- |
| PostgreSQL 16 | persistence | yes, local | free | real |
| Together AI (`TOGETHER_API_KEY`, or a reader's own key) | margin answers, whole-text answers, embeddings, Whisper | **no key** | pay per token and per audio minute; no call was made | none |
| Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`) | accounts | **not configured** | free | none |
| Browser speech synthesis | read aloud | yes (browser feature) | free | real engine, events only |
| Browser speech recognition and microphone | voice search | browser feature | the browser vendor's service receives the audio in Chrome | none |
| Public websites | URL import | n/a | free | real |

Secrets: `.env.local` is git-ignored and absent from history; no secret value was printed or written to any file in this audit. Details, setup steps and verification steps: `docs/audit/external-integrations.md`.

## G. Known limitations

Unverified or blocked:

- Every AI feature against a live model: summaries, concepts, comprehension questions, translation, margin answers, the model's own labels, JSON validity rate (BLOCKED, key).
- Translation quality and language detection (BLOCKED, key and a bilingual reader).
- Audible read-aloud output and audible spoken answers (BLOCKED, human).
- Microphone permission flow and real recognition (IMPLEMENTED, NOT VERIFIED, human).
- Server transcription, embedding re-rank, margin and whole-text answers (BLOCKED, key).
- Google sign-in round trip and the anonymous-to-account library merge (BLOCKED, credentials).
- Touch selection and every non-Chromium browser (NOT OBSERVABLE here).
- Screen-reader experience (not tested).
- Production behaviour behind TLS and a real host (not tested, not allowed).

Partial or by design:

- Passage retrieval by words alone misses paraphrases: on the labelled set seven answerable queries now answer "no match" (three before) and top-1 is 57.7 %. The 0.4 coverage cutoff is not calibrated.
- PDF import now separates headings and paragraphs, at a cost: on a real paper the block count went from 62 to 258, of which 103 were shorter than 40 characters. Merging runs of tiny pieces brought it to 189 blocks with 29 short ones (26 of them headings, formulas or table rows). Figure and table text still produces some short blocks.
- Annotations on `local:` documents never sync. Edits inside an annotated quote orphan the mark instead of guessing. A newer edit on one device beats a deletion on another.
- Resume after a reload starts from the paragraph on screen, not mid-sentence; where reading stopped is not remembered.
- `/?url=` and `/?save=` fill the field and wait for Read (security change from the reference).
- Existing marks are not keyboard-focusable; the lens does not take focus.
- The development database is shared with the test suite.
- Whole-text translation is part by part (about a page at a time), not one request for the whole text.
- Streamed margin answers rely on the model using its labels ("My reading:", "Outside the text:"); citations are checked regardless.
- Texts beyond about 72,000 characters are summarized in parts, and the result says which paragraphs it read.
- Not built, by specification: Painted covers, web search in answers (the composer's "Web" toggle is an inert placeholder), MCP agent connection, server-side TTS.

## H. Completion metrics

Each percentage is `VERIFIED WORKING` over a defined set, counting each requirement once. Blocked, not observable and implemented-not-verified items are never counted as complete and are listed. These are requirement counts, not code coverage and not test pass rate. The sets and definitions are in `docs/implementation-status.md`.

| Metric | Set | Verified | % | Not counted as complete |
| --- | --- | --- | --- | --- |
| Existing product functionality | 26 | 15 | 58 % | partially implemented 3; implemented, not verified 3; blocked 2; not implemented 3 |
| Text-to-speech | 12 | 8 | 67 % | partially implemented 2; blocked 1; not implemented 1 |
| Voice capture and transcription | 5 | 2 | 40 % | implemented, not verified 2; blocked 1 |
| Passage retrieval | 5 | 4 | 80 % | blocked 1 |
| Annotations and persistence | 9 | 7 | 78 % | partially implemented 1; implemented, not verified 1 |
| AI provider integration | 8 | 2 | 25 % | blocked 6 |
| Intelligent reading features (second brief) | 23 | 19 | 83 % | partially implemented 1; blocked 3 |
| Authentication | 3 | 1 | 33 % | implemented, not verified 1; blocked 1 |
| Route coverage | 6 | 5 | 83 % | partially implemented 1 (`?hl=` deep link). Note: `/?url=` and `/?save=` now only fill the field and wait for Read, a deliberate security deviation from the reference |
| Automated test coverage of requirements | 94 | 75 | 80 % | requirements with no automated test: REF-2, REF-3, REF-5, REF-7, REF-14, REF-24, REF-25, REF-26, TTS-R10, TTS-R11, TTS-R12, AN-R2, AN-R9, NFR-12, NFR-13, NFR-14, UND-18, UND-19, UND-20. A requirement with a test is not necessarily verified (see Status) |
| Security review | 16 | 9 | 56 % | partially fixed 5 (SEC-1, 2, 7, 9, 12), information only 2 (SEC-15, 16) |
| Operational readiness | 10 | 6 | 60 % | not implemented: CI, logging and monitoring, shared limiter and backups, deployment |
| Visual fidelity | n/a | n/a | n/a | measured instead: pixel difference against the reference at six screens (0.42 % to 16.40 %), see `docs/audit/visual-accessibility-review.md`. A percentage of "fidelity" is not claimed |
| Code coverage (lines, branches) | n/a | n/a | n/a | not claimed |

Across all 94 requirements: 67 verified working, 7 partially implemented, 6 implemented but not verified, 9 blocked, 1 not observable, 4 not implemented.

## I. Recommended next actions

**Required before basic user testing**
0. To try the new AI features you need a key (`docs/audit/external-integrations.md`): paste your own Together AI key in the key panel; open a text, press `I`, and press each button; select a sentence and use Translate and Summarize; press `V`, choose Ask a question. Read what comes back and report anything wrong, especially quotes that do not match, summaries that claim too much, and translations that read badly.
1. Open http://localhost:3100 and follow the human checks: read-aloud (`docs/audit/tts-validation.md`), voice search (`docs/audit/voice-search-validation.md`), annotations on a phone (`docs/audit/annotation-validation.md`). About fifteen minutes in total.
2. If you want margin answers and meaning search: add a Together key (see `docs/audit/external-integrations.md`) and run Explain, a whole-text question, a paraphrase voice query.

**Required before a release candidate**
1. Run Google sign-in with real credentials, including the library merge and a second browser.
2. Repeat the human checks in Safari and on a phone.
3. Add CI that runs typecheck, lint, unit and end-to-end tests with a disposable database.
4. Do a screen-reader pass (VoiceOver).
5. Decide the behaviour for ANNOT-17 (`local:` documents) and make existing marks keyboard-reachable.

**Required before production deployment**
1. Move the rate limiter to a shared store and add a daily spend ceiling for the server key; cap anonymous reader creation (SEC-1, SEC-2).
2. Run the server on a staging host behind TLS and observe the headers, the cross-site guard, the secure cookie and `APP_URL` enforcement; apply migration 0002 there.
3. Add a `script-src` CSP by moving the theme bootstrap to a hash or nonce (SEC-9); sign the reader cookie with a purpose label (SEC-12).
4. Add logging, error tracking, backups and a restore procedure.

**Optional improvements**
1. Decide what to do with the remaining figure and table fragments in PDFs (IMP-5), for example a font-size signal from pdf.js.
2. Calibrate the retrieval cutoff on a larger labelled set; add an inverted index if documents get very large (RETR-10).
3. Remember where reading stopped (TTS-9).
4. Run `prettier --write` as one repository-wide commit with a `.prettierignore`, then add a check script (HYG-1).

## J. Final commands

Only commands that exist in this repository and were run in this audit.

| Purpose | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Database migration (needs `DATABASE_URL`) | `pnpm db:migrate` |
| Start the app | `pnpm dev --port 3100` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test` |
| Visual comparison (baselines for this machine; `pnpm test:visual:update` rewrites them) | `pnpm test:visual` |
| Integration tests | there is no separate script: the HTTP-level specs run inside `pnpm test:e2e` (for example `pnpm exec playwright test tests/e2e/annotations-api.spec.ts tests/e2e/api.spec.ts tests/e2e/import-and-isolation.spec.ts`) |
| End-to-end tests | `pnpm test:e2e` (starts `next dev` on 3100 unless it is already running; `PLAYWRIGHT_PORT` changes the port) |
| Production build | `pnpm build` |
| Dependency audit | `pnpm audit --prod` |
| Retrieval metrics | `pnpm exec tsx scripts/eval-retrieval.mts` |
| Accessibility scan of 30 states | `pnpm exec tsx scripts/a11y-scan.mts` |
| Visual comparison | `pnpm exec tsx scripts/visual-diff.mts` |
