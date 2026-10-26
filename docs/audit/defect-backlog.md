# Defect backlog

_Every finding of the audit, with its current status, the commit that fixed it, the test that guards it and what remains. Statuses were set by a second, read-only pass over the current code (not from commit messages) and updated for the fixes of the final stretch. "Fixed" means the code changed and a test or a recorded run covers it. "Partial" names the residual. "Open" is not addressed. "Needs browser" means the fix cannot be confirmed without a real browser, device or deployment._

Severity: P0 data loss or security breach in normal use; P1 a main feature broken or a serious abuse path; P2 wrong or unsafe in realistic use; P3 minor or polish; INFO observation.

## Totals (tallied from the tables below)

| Area | Findings | Fixed | Partial | Open | Not a defect |
| --- | --- | --- | --- | --- | --- |
| Read aloud (TTS-1..23) | 23 | 19 | 4 | 0 | 0 |
| Voice and retrieval (VOICE-1..19, RETR-1..12) | 31 | 25 | 4 | 1 | 1 |
| Annotations (ANNOT-1..22) | 22 | 18 | 3 | 1 | 0 |
| Security (SEC-1..16) | 16 | 9 | 5 | 0 | 2 |
| Import, build, hygiene, accessibility, found in testing | 15 | 10 | 2 | 3 | 0 |
| Second brief: AI, import, interface (below) | 10 | 7 | 1 | 2 | 0 |
| Visual pass: phones and panels (below) | 5 | 5 | 0 | 0 | 0 |
| Saving every link (below) | 1 | 1 | 0 | 0 | 0 |
| **All** | **123** | **94** | **19** | **7** | **3** |

Open items by priority: AI-4 (the live model has never answered, needs a key), A11Y-4 (no screen-reader pass, needs a person), ANNOT-17 (`local:` documents never sync; a file backup now protects them), IMP-7 (a text link is titled by its file name), RETR-10 (no inverted index), A11Y-5 (lens toolbar roving tabindex), BUILD-1 (font metrics warning). None blocks the product; each is described below.

## Read aloud (fixes: commit 2b76932, later 5edb3fa and the Stop-focus commit)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| TTS-1 | P1 | pause then skip/stop/restart then speak could stay silent if `cancel()` leaves `paused` true | Fixed | unit "pause, skip, resume still speaks..." and e2e; **confirmed in real Chrome 155**: Chrome keeps `paused` after cancel and the controller's un-pause makes the next utterance start |
| TTS-2 | P2 | engine error left the token valid; a late `end` kept speaking | Fixed | unit |
| TTS-3 | P2 | whole-text counter reset after retry, restart, skip in error | Fixed | unit; `restart()` now means start of the whole text |
| TTS-4 | P2 | sentences never chunked (longest 1257 characters) | Fixed | unit; chunks at most 220 characters |
| TTS-5 | P2 | sentence splitter cut on decimals, e.g., Ph.D., domains | Fixed | 26 unit cases. Trade-off: a dotted abbreviation at the end of a sentence followed by a capital merges two sentences |
| TTS-6 | P2 | document language never used for the voice | Fixed | unit; only en, pt, es are told apart; no e2e |
| TTS-7 | P2 | auto-scroll followed the block, not the sentence | Fixed | e2e (3). Keyboard scrolling and scrollbar drag do not stop following. Needs browser |
| TTS-8 | P2 | per-word re-render storm; memoised blocks defeated | Partial | word-boundary storm gone (unit). Blocks still re-render on each sentence because `Block` receives inline callbacks; no test |
| TTS-9 | P2 | `L` and the top-bar button started from different places; stop point not remembered | Partial | one start rule (e2e). Where reading stopped is not remembered between presses or reloads |
| TTS-10 | P2 | Space hijacked from focused controls | Fixed | e2e. Needs browser |
| TTS-11 | P2 | unsupported path silent; Listen setting did not gate everything | Partial | message and hidden controls (unit, e2e). The Listen setting still only controls the top-bar button; `L`, the lens action and voice-search "read" ignore it. Intended meaning is undecided |
| TTS-12 | P2 | voice menu ARIA, keyboard, announcements; focus lost when the bar closes | Partial | menu semantics, arrows, Escape, live region, Try again (e2e). **Focus after Stop fixed in the final stretch** (2 e2e), and a new Appearance switch turns off all single-key shortcuts (WCAG 2.1.4; 2 e2e in `reader.spec.ts`). Remaining: axe does not run with the voice menu open; "Finished reading" announcement not asserted |
| TTS-13 | P2 | utterance not referenced after `speak()` (Chrome GC drops `onend`) | Fixed | unit asserts the reference; GC behaviour needs browser |
| TTS-14 | P3 | rate or voice change while paused not applied | Fixed | unit |
| TTS-15 | P3 | `start()` cancelled before invalidating | Fixed | unit |
| TTS-16 | P3 | unknown start block silent no-op | Fixed | unit |
| TTS-17 | P3 | skip could not cross passage boundary; dead `seekTo` | Fixed | unit, e2e |
| TTS-18 | P3 | StrictMode dispose killed the voice listener | Fixed | unit |
| TTS-19 | P3 | `[n]` markers and code spoken | Fixed | unit. Figure alt text is deliberately not read |
| TTS-20 | P3 | toast covered the bar's retry control | Fixed | e2e (bounding boxes). Needs browser |
| TTS-21 | P3 | forced-colors made the spoken sentence vanish | Fixed | e2e with a weak assertion (non-transparent background) |
| TTS-22 | P3 | completed indistinguishable from stopped | Fixed | unit; "Finished reading" announcement has no e2e; no visible "Read again" |
| TTS-23 | P3 | external interruption ignored until the watchdog | Fixed | unit |

## Voice search and retrieval (fixes: commit 44ab1bc, 5edb3fa)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| VOICE-1 | P1 | any parent re-render stopped the recogniser | Fixed | unit, e2e |
| VOICE-2 | P1 | late final result ran after close | Fixed | unit |
| VOICE-3 | P2 | microphone left on after a recorder setup failure | Fixed | unit |
| VOICE-4 | P1 | closing during the permission prompt still recorded and uploaded | Fixed | unit |
| VOICE-5 | P2 | transcription network failure stuck the UI | Fixed | unit |
| VOICE-6 | P2 | stale `end` clobbered the next recogniser | Fixed | unit |
| VOICE-7 | P2 | typing overridden by the recogniser; stale searches | Fixed | unit. **Gap found by the second pass and fixed in the final stretch**: a final result arriving after typing used to overwrite the text and search |
| VOICE-8 | P2 | silent endings; no tab-blur handling | Fixed | unit. Real mobile backgrounding needs browser |
| VOICE-9 | P2 | no failover to server transcription | Fixed | unit |
| VOICE-10 | P2 | read-aloud not paused while listening | Fixed | unit, e2e |
| VOICE-11 | P2 | dialog accessibility | Fixed | unit, e2e, axe |
| VOICE-12 | P2 | privacy disclosure | Fixed | unit. The README does not repeat it yet |
| VOICE-13 | P2 | search and transcribe routes were open proxies for the server key | Fixed | by the SEC-1 commit; `serverKeyAbuse.test.ts` |
| VOICE-14 | P3 | recognition language is the document's, not the speaker's | Partial | no hint sent to Whisper; the browser recogniser still uses the document language; no selector |
| VOICE-15 | P3 | fallback quality gaps | Partial | empty transcript explained, auto-search. No silence check before upload; uploaded file always named `speech.webm` |
| VOICE-16 | P3 | copy and error mapping | Fixed | unit. Rare unknown recogniser codes still show the raw code |
| VOICE-17 | P3 | read from a hit continued through the whole document | Fixed | e2e |
| VOICE-18 | P3 | documentation drift | Fixed | `docs/architecture.md` request flow corrected in the final stretch; the file also points to `docs/audit/runtime-architecture.md` |
| VOICE-19 | P3 | test coverage | Fixed | 26 lifecycle tests; e2e voice tests still type their input |
| RETR-1 | P1 | confidence skewed by filler tokens | Fixed | 134 retrieval cases. Cost: answerable queries labelled "none" went from 3 to 7 |
| RETR-2 | P1 | "none" fired only on zero overlap; one-word queries always "high" | Partial | none below 40 % coverage, one-word queries high only when the word is rare. Absent concepts still showing hits: 1 of 7 ("French Revolution", a partial match). The 0.4 cutoff is uncalibrated |
| RETR-3 | P2 | stemmer split inflections; Portuguese rules corrupted English | Fixed | Porter stemmer plus light Portuguese stemmer by language |
| RETR-4 | P2 | stop lists | Fixed | |
| RETR-5 | P2 | overlapping windows in the top results | Fixed | 0 of 41 queries overlap |
| RETR-6 | P2 | spoken-query parsing gaps | Fixed | 22 table cases |
| RETR-7 | P2 | semantic path is a thin re-rank with uncalibrated confidence | Partial | it can no longer raise the label and failure is shown. Weights uncalibrated; only the top 12 lexical hits are re-ranked; English-only embedding model. Not measured (no key) |
| RETR-8 | P3 | sentence splitter defects (shared with TTS) | Fixed | |
| RETR-9 | P3 | highlight regex missed stems | Fixed | no test (function not exported) |
| RETR-10 | P3 | no inverted index | Open | only matters for very large documents (8 ms at 22 000 passages measured in the review) |
| RETR-11 | P3 | excerpt longer than the route limit failed the whole re-rank | Fixed | excerpts cut to 2000 characters in the final stretch |
| RETR-12 | obs | offsets and navigation are correct | Not a defect | 215 of 215 hit offsets slice back to the excerpt |

## Annotations (fixes: merge 38ff2e0 and its commits)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| ANNOT-1 | P1 | deleting on one device undone by another device | Fixed | `library-sync.test.ts`, e2e with the real server. No server tombstone: a newer edit elsewhere wins |
| ANNOT-2 | P2 | fast path ignored context | Fixed | `anchors-resolve.test.ts` |
| ANNOT-3 | P2 | fallback had no ambiguity handling | Fixed | same. Anchors stored before neighbour context orphan on ambiguity |
| ANNOT-4 | P2 | unresolved anchors invisible but live | Fixed | e2e. Any real edit inside a quote orphans it; there is no "re-attach" |
| ANNOT-5 | P2 | resolved result used only for painting | Fixed | e2e |
| ANNOT-6 | P2 | multi-block quotes brittle | Fixed | unit |
| ANNOT-7 | P2 | triple-click spilled into the next paragraph | Fixed | unit, e2e (Chromium). Safari needs a device |
| ANNOT-8 | P3 | element-boundary end mapped to the block end | Fixed | unit |
| ANNOT-9 | P2 | shape-only server validation | Fixed | `annotation-schema.test.ts` (41), e2e. No per-reader row cap |
| ANNOT-10 | P2 | note over 5000 accepted locally, refused by the server forever | Fixed | unit, e2e. No per-item "not synced" badge |
| ANNOT-11 | P2 | update ordering and clock semantics lost edits | Fixed | unit, e2e |
| ANNOT-12 | P2 | tombstone cleared on "not persisted"; delete racing create | Fixed | unit |
| ANNOT-13 | P2 | click inside a highlight replaced the drag selection | Fixed | e2e (Chromium). Touch long-press needs a device |
| ANNOT-14 | P2 | no way to remove or recolour a mark; duplicates stacked | Fixed | unit, e2e |
| ANNOT-15 | P3 | Unicode handled by code unit only | Fixed | unit. Multi-block quotes are not folded |
| ANNOT-16 | P3 | notebook export lossy and could corrupt Markdown | Fixed | unit |
| ANNOT-17 | P3 | `local:` documents never sync; sign-in merges anonymous local marks | Open | no re-keying when a `local:` document gains a server id; no test. Mitigated, not fixed: backup and restore keep the marks (`backup.test.ts`) |
| ANNOT-18 | P3 | mark segmentation O(blocks^2) | Fixed | unit threshold only (not measured in a browser) |
| ANNOT-19 | P3 | keyboard, touch and focus | Partial | Space no longer starts a question inside the lens. Existing marks are still not focusable, focus never moves into the lens, the lens does not reposition on scroll |
| ANNOT-20 | P3 | small UI and state issues | Partial | note draft resets on open. Empty note still saved; toast still optimistic; unknown `?hl=` id skips progress resume |
| ANNOT-21 | P3 | route robustness | Partial | 503 on outage for annotation, gloss, progress and document PATCH/DELETE routes; 409 for foreign ids. Still no foreign key on `document_id` and no orphan-row cleanup (needs a migration) |
| ANNOT-22 | P3 | defensive gaps in anchor helpers | Fixed | unit |

## Security (details in `security-review.md`)

| ID | Sev | Finding | Status | Remaining |
| --- | --- | --- | --- | --- |
| SEC-1 | P1 | server key open and unmetered | Partial | in-memory limiter per process, no global spend ceiling; trust in `x-forwarded-for` |
| SEC-2 | P2 | no rate limits; unbounded anonymous storage | Partial | no limiter on import and annotation routes; reader rows can be minted without limit; no quotas |
| SEC-3 | P2 | SSRF rebinding, any port, status oracle | Fixed | status/timing of public hosts on 80/443 still visible |
| SEC-4 | P2 | sign-in merged or destroyed another account | Fixed | migration 0002 must be applied elsewhere |
| SEC-5 | P2 | unbounded HTML and PDF parsing | Fixed | main-thread parsing, no worker; not load-tested |
| SEC-6 | P3 | import on GET | Fixed | |
| SEC-7 | P3 | capture trusted any opener | Partial | opener keeps a handle to the tab |
| SEC-8 | P3 | CSRF only SameSite | Fixed | Content-Type not enforced; production proxy behaviour not observed |
| SEC-9 | P3 | no security headers | Partial | no script-src CSP; production headers not observed |
| SEC-10 | P3 | SSRF address gaps | Fixed | |
| SEC-11 | P3 | raw errors returned, verbose logs | Fixed | final stretch closed the annotation-route gap and guarded `documents/[id]` PATCH and DELETE (outage test) |
| SEC-12 | P3 | cookie design | Partial | bare-id signature, no `__Host-`, no revocation, dev fallback secret |
| SEC-13 | P3 | `next` and `APP_URL` handling | Fixed | |
| SEC-14 | INFO | upsert and numeric edges | Fixed | |
| SEC-15 | INFO | slug oracle | Not a defect | |
| SEC-16 | INFO | remote images, key in localStorage | Not a defect | remote images reveal the reader's IP to the image host |

## Import, build, hygiene, accessibility and defects found while testing

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| IMP-1 | P2 | a GIF was imported as a text document ("GIF89a") | Fixed | content sniffing (`uploadKind.test.ts`, e2e) |
| IMP-2 | P3 | "Nothing to read." for malformed JSON, oversize and other errors | Fixed | e2e names the real problem |
| IMP-3 | P3 | the same text imported twice creates two documents | Fixed | importing an address (normalised) or a text (fingerprint, 200+ characters) already on the shelf opens the saved one (`duplicates.test.ts`, e2e in `library-search.spec.ts`). Limits in `docs/quality/known-limitations.md` |
| IMP-4 | P2 | sites that block servers (403) gave "That page answered 403." | Fixed | capture bookmarklet, honest message (`importStatus.test.ts`, e2e); needs the reader's own browser tab |
| IMP-5 | P3 | PDF text lost paragraph breaks, so headings fused with paragraphs | Fixed | `pdf-paragraphs.test.ts` with a real PDF fixture. Cost and its mitigation: on a real paper (arXiv 1706.03762) blocks went from 62 to 258 with 103 shorter than 40 characters. Runs of three or more tiny pieces are now merged back (`mergeFragmentRuns`): 189 blocks and 29 shorter than 40 characters, of which 26 are headings, formulas or table rows. A second paper (arXiv 1810.04805): 297 blocks and 44 short before the merge, 280 and 24 after. Figure text is still its own blocks, only fewer |
| DB-1 | P1 | library returned 500 and an overlay when PostgreSQL was unreachable; SQL and document leaked in errors | Fixed | `db-outage.test.ts` against a dead port; real app run on a dead port |
| DEV-1 | P3 | dev-only "Encountered a script tag" React error | Fixed | jsdom test with a control |
| A11Y-1 | P2 | 368 axe violations (334 contrast) | Fixed | `a11y.spec.ts` in all five themes |
| A11Y-2 | P3 | text fields without a visible focus indicator | Fixed | focus scan e2e |
| A11Y-3 | P2 | four `aria-modal` dialogs let Tab leave and never returned focus | Fixed | final stretch: `useModalFocus`, 4 e2e (fail without it) |
| A11Y-4 | P2 | no screen-reader pass at all | Open | human check |
| A11Y-5 | P3 | lens toolbar without roving tabindex | Open | |
| BUILD-1 | P3 | next/font cannot compute fallback metrics for Atkinson Hyperlegible Next | Open | small layout shift while the font loads; one build warning |
| HYG-1 | P3 | 115 files not Prettier-formatted; no format check script | Partial | not fixed on purpose: a repository-wide reformat should be its own commit; `prettier --write` must not be run per file (it diverged from the codebase style) |
| TEST-1 | P3 | dev database shared with the e2e suite; no CI | Partial | documented in `external-integrations.md` and `test-strategy-and-results.md` |

## Found and handled in the second brief (intelligent reading)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| AI-1 | P1 | a model's ¶ citation always became a link, including to paragraphs the model was never given | Fixed | the paragraphs given are stored with each answer; others are struck through and do not link (`gloss-render.test`, `understand.spec`) |
| AI-2 | P2 | an overview built from a sample of paragraphs was presented as the gist of the whole text | Fixed | every overview says "Based on N of M paragraphs ... the rest was not read"; structured results carry a coverage statement (`ai-ops.test`, `understand.spec`) |
| AI-3 | P2 | nothing distinguished what the text says from the model's interpretation or outside knowledge | Partial | structured results: a statement claimed to be from the text needs a verified quote or is shown as flagged interpretation (deterministic, tested). Streamed margin answers rely on the model using "My reading:" / "Outside the text:" labels, which a live model may ignore (unverified) |
| AI-4 | P2 | the live model has never answered in this environment (no key): JSON validity rate, summary and translation quality, label compliance are unmeasured | Open | needs a key and a reader |
| IMP-6 | P2 | a PDF link served as octet-stream, or without a `.pdf` ending, was not imported; text links were not read | Fixed | `classifyFetched` (`uploadKind.test`); live imports of a PDF URL and a text URL |
| IMP-7 | P3 | a text link (for example a Project Gutenberg `.txt`) is titled by its file name | Open | minor; the first line is not trusted as a title |
| UI-1 | P2 | the collapsed margin note was an `<article role="button">` whose name did not contain its visible text (axe aria-allowed-role and label-in-name) | Fixed | `voice-ask.spec` axe test with a margin answer on screen |
| UI-2 | P3 | top-bar buttons with a count badge named themselves with an aria-label that left out the visible number | Fixed | named by content (`understand.spec` axe tests) |
| UI-3 | P3 | the unverified-citation style lowered contrast below AA | Fixed | same axe tests |
| POS-1 | P3 | resume after reload was implemented but never tested | Fixed | `position.spec` |

## Found and fixed in the visual pass (phones, panels)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| UI-4 | P1 | at 375 px the reader's top bar ran off the right edge: the Understand and Notebook buttons were cut off, so the Notebook could not be tapped | Fixed | wordmark text gives way to the mark under 480 px, badges sit on the button corner; `phone-layout.spec` (320, 360, 375, 412, 768 px; fails on the old layout) |
| UI-5 | P2 | on landing and library at 375 px the wordmark, the Library button and "Sign in" collided, and "Sign in" wrapped over two lines | Fixed | sign-in control is icon-only under 480 px, still named Sign in; found by the visual baselines; `phone-layout.spec` checks on screen and no overlap |
| UI-6 | P2 | the selection toolbar scrolled sideways with no sign of it on a phone, and the highlight colours opened only on hover (no hover on touch) | Fixed | two rows on phones, colour dots always shown; `phone-layout.spec` |
| UI-7 | P3 | the Notebook and Understand sheets covered the whole phone screen | Fixed | they start at 14 % of the height so text stays visible above; `phone-layout.spec` |
| UI-8 | P3 | the Understand panel stacked a large tool block above long cards with no way to scan them | Fixed | every action described before anything is made, tools tuck away afterwards, the newest result open and older ones collapsed with a preview, tabs by kind from the third result; `understand.spec`, axe, baselines |

## Found and fixed: saving every link

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| LNK-1 | P2 | a link whose page could not be read (an app or landing page with no article, a site that blocks servers, a missing page) showed a toast and saved nothing, so the reader lost the link (reported with https://finalosint.lat/) | Fixed | the import keeps the link as a link card with the page's own title and description and the reason; `linkDoc.test`, `links.spec`, live. A card has no text to read until it is brought in; the card says how (bookmarklet, paste, file) |


## Mission 02: AI reliability, shared limits, honest PDF refusals (branch `release/mission-02`)

| ID | Sev | Finding | Status | Guard / remaining |
| --- | --- | --- | --- | --- |
| M2-1 | P1 | Rate limits (SEC-1, SEC-2) counted in one process's memory, so on serverless hosting the cap was the limit times the warm instances | Fixed with a residual | `rate_hits` table (migration 0005), atomic upsert per hashed client and window; `rateLimitShared.test.ts` (two simulated instances share one counter, real PostgreSQL concurrency, no raw addresses stored, fallback when the store fails or hangs). Residual: fixed window (up to twice the limit across a boundary); no global spending ceiling |
| M2-2 | P2 | A provider that never answered held the request for the whole function time; transient failures and bursts had no explicit bound | Fixed | per-request deadline (50 s streamed, 100 s structured), at most two retries, a per-instance cap on concurrent server-key calls (503 busy), a plain 504 / trailer message; `ai-reliability.test.ts` against the real AI SDK with a stubbed network (each safeguard mutation-checked) |
| M2-3 | P2 | Nothing told the model that the imported text is untrusted | Fixed | one shared rule and a fence the text cannot close in every prompt (summaries, concepts, questions, translation, margin answers); the model's output is still only shown as supported when a quote is verified against the document (`ai-evidence.test.ts`, `ai-reliability.test.ts`). Residual: a model can still be persuaded by text; the defence is that nothing it says can claim support from the text without a verified quote |
| M2-4 | P2 | AI spend was not visible on the server | Fixed | one `[usage]` log line per answer (operation, key owner, tokens, cost estimate; no text, no key) |
| M2-5 | P3 | A scanned PDF was refused with "may be scanned images", which does not say that the app has no OCR | Fixed | `pdf-unsupported.test.ts` (real image-only PDF fixture; malformed, empty and truncated PDFs are refused as unreadable) |
| M2-6 | P3 | Only Chromium was ever run | Fixed | Firefox, desktop WebKit and iPhone WebKit projects for the critical journeys; two Firefox failures were the test harness (one huge wheel event is clamped by Firefox), fixed in `wheelScroll`, not in the app |
| M2-7 | P2 | The server key put in production was rejected by the provider (401) | Open, needs the key owner | the key is stored; Study notes and every AI answer on production fail until a valid key is set (`scripts/ai-smoke.mjs` verifies it end to end) |
| M2-8 | P2 | A link, text file or saved page in a legacy charset (ISO-8859-1, windows-1252: older Portuguese and other Western sites) came out with replacement characters, because everything was read as UTF-8; and Node's own decoder reads the windows-1252 block (curly quotes, dashes, euro) as control characters | Fixed | `lib/content/charset.ts` (byte-order mark, then the server's charset, then the page's own `<meta>`, then UTF-8 or windows-1252) with its own windows-1252 table; `charset.test.ts`, `import-url-route.test.ts` (3 tests fail on the old decoding). Residual: charsets Node does not know are read as UTF-8; East Asian legacy charsets rely on the runtime's ICU |
| M2-9 | P3 | A paywalled link (402) answered "That page answered 402." | Fixed | explained as payment or subscription with the ways forward (`import-url-route.test.ts`) |
