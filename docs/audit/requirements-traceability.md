# Requirements traceability

_Source of requirements: `docs/product-specification.md` (scope, additions, quality bars), `docs/interaction-inventory.md` (28 observed reference interactions) and the master engineering brief of this audit (security, accessibility, outage tolerance, honesty rules). Statuses use the six allowed values only. "Verified" never means "a mock passed": the evidence level is a separate column._

**Evidence levels**

| Code | Meaning |
| --- | --- |
| S | static (types, lint, build) |
| U | unit test with mocked or in-process boundaries |
| I | integration with the real local PostgreSQL and real route handlers |
| E | Playwright end-to-end against the running app; speech engine, microphone and model are fakes or absent |
| R | recorded manual check in the user's real Chrome 155 (driven through the extension), events and DOM only |
| H | needs a human with ears, a microphone, a phone, credentials or a key (instructions in `docs/final-qa-report.md` section H) |

**Rule applied to speech.** A real `speechSynthesis` run in Chrome that produces start/boundary/end events and a moving highlight is evidence level R for *behaviour*. It is not evidence that sound came out of a speaker. The "audible" requirement is therefore tracked separately and stays BLOCKED until a human confirms it.

## A. Reference product (reproduce)

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| REF-1 | Landing: hero, import bar, samples, latest-highlights desk, how-it-works, footer sign-in line | VERIFIED WORKING | E `landing.spec.ts`; axe both themes `a11y.spec.ts` |
| REF-2 | Landing "Continue *title* N%" line after reading | IMPLEMENTED, NOT VERIFIED | renders from stored progress; no test drives progress and returns |
| REF-3 | Latest-highlights desk and `?hl=` deep link | PARTIALLY IMPLEMENTED | desk renders (manual); deep-link scroll implemented, untested |
| REF-4 | Library: stats, shelf, topics grid, filters, sort by Topic/Recent/Length, search, open book, starter cards | VERIFIED WORKING | E `library.spec.ts`, `a11y.spec.ts` |
| REF-5 | Library sort by Colour and topic change persistence | IMPLEMENTED, NOT VERIFIED | no test |
| REF-6 | Add panel: multiple links, import-export file, bookmarklets, PDF/text file, paste | VERIFIED WORKING | E `library.spec.ts`, `reader.spec.ts`, `import-and-isolation.spec.ts`; capture bookmarklet R on a live article |
| REF-7 | Add panel "Connect an agent" (MCP) | NOT IMPLEMENTED | honest placeholder copy; out of scope per specification |
| REF-8 | Reader: header, numbered blocks, drop cap, footer, composer | VERIFIED WORKING | E `reader.spec.ts` |
| REF-9 | Unknown slug shows a not-found state | VERIFIED WORKING | E `reader.spec.ts` |
| REF-10 | Imported documents (URL, PDF, text) open in the reader | VERIFIED WORKING | U `content.test.ts`, `pdf-paragraphs.test.ts`; I/E `api.spec.ts`, `import-and-isolation.spec.ts`; real PDF (arXiv 1706.03762) imported through the route |
| REF-11 | Selection lens: Ask, Explain, Simplify, More, Highlight colours, Note | VERIFIED WORKING | E `reader.spec.ts`, `annotations.spec.ts` (UI only; the answers need a model, see REF-13) |
| REF-12 | Margin gloss UI: card, collapse, active, error state, delete, persistence | VERIFIED WORKING | E `reader.spec.ts` (with the no-key 402 answer) |
| REF-13 | Margin gloss streamed model answers, citations, follow-up | BLOCKED | no `TOGETHER_API_KEY` and no user key in this environment; see REF-13 |
| REF-14 | Whole-text question and "Gloss this text" | BLOCKED | same |
| REF-15 | Notebook: tabs, cards, delete, Markdown copy/download | VERIFIED WORKING | U `notebook-markdown.test.ts`; E `reader.spec.ts`, `annotations.spec.ts` |
| REF-16 | Appearance: themes, pens, typefaces, size, spacing, numbers, map, focus, listen | VERIFIED WORKING | E `landing.spec.ts`, `reader.spec.ts`; contrast `a11y.spec.ts` in all five themes |
| REF-17 | API key panel stores the key only in the browser and sends it per request | VERIFIED WORKING | U `serverKeyAbuse.test.ts`; E `api.spec.ts` (402 without a key); live use of a key is BLOCKED (REF-13) |
| REF-18 | Keyboard shortcuts `/ J K Enter [ ] B N F Esc ?` plus L, Space, V, Shift+H, Shift+U | VERIFIED WORKING | E `reader.spec.ts`, `search-and-speech.spec.ts`, `a11y.spec.ts` (every Tab stop shows focus) |
| REF-19 | Map rail, scroll progress bar, topbar title on scroll | VERIFIED WORKING | E DOM assertions in `reader.spec.ts` |
| REF-20 | Reading progress persists and resumes | VERIFIED WORKING | E `position.spec.ts` (scroll, reload, the saved paragraph is on screen); the server copy of progress is covered by the data route tests |
| REF-21 | Mobile: hint toast, numbers hidden under 720 px, full-width composer, bottom-sheet glosses | PARTIALLY IMPLEMENTED | E `mobile.spec.ts` covers toast and layout; touch interaction on a real phone is H |
| REF-22 | Persistence of settings, highlights, notes, glosses across reloads | VERIFIED WORKING | E + I `reader.spec.ts`, `annotations*.spec.ts`, `library-sync` unit tests |
| REF-23 | Sign in / accounts | IMPLEMENTED, NOT VERIFIED | Google OAuth (PKCE) coded and unit-tested for state, merge and hardening (`auth.test.ts`, `authHardening.test.ts`, `accountMerge.test.ts`); the disabled-state UI is E-verified; the real round trip needs credentials (H) |
| REF-24 | Painted covers | NOT IMPLEMENTED | toggle says "Not available in this build" |
| REF-25 | Web search inside answers | NOT IMPLEMENTED | out of scope; toggle kept for fidelity |
| REF-26 | Visual fidelity to reference screenshots at 1440x900 and 375x812 | PARTIALLY IMPLEMENTED | `docs/qa/` side-by-side shots and `scripts/visual-diff.mts` outputs under `docs/audit/visual/`; cover art and partner logo are procedural stand-ins |

## B. Text-to-speech (addition)

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| TTS-R1 | Play, pause, resume, stop, restart | VERIFIED WORKING | U `speech-controller.test.ts` (fake engine incl. one that keeps `paused` after cancel and one that fires `end` inside `cancel`); E `search-and-speech.spec.ts`; R events in Chrome 155 |
| TTS-R2 | Whole text or selected passage, then continue | VERIFIED WORKING | U + E |
| TTS-R3 | Sentence-level highlight synchronised with the utterance | VERIFIED WORKING | E; R the highlight followed `start` events. Word-level highlight is deliberately not offered |
| TTS-R4 | Speed and voice change take effect, also while paused | VERIFIED WORKING | U + E; R rate and voice changes observed in Chrome |
| TTS-R5 | Language: voice follows the text language | PARTIALLY IMPLEMENTED | U verifies the pick; Portuguese and Spanish text were not heard on a real voice (H) |
| TTS-R6 | Long documents: chunked utterances, no overlap, stall watchdog | VERIFIED WORKING | U `segments.test.ts`, `sentences.test.ts`; R a 2-minute run, 20 utterances, no stall |
| TTS-R7 | Skip across the passage/continuation boundary, disabled at the ends | VERIFIED WORKING | U + E |
| TTS-R8 | Keyboard and screen-reader access, announcements, forced-colors | VERIFIED WORKING | E; axe. Real screen reader not run (H) |
| TTS-R9 | Unsupported browsers say so and hide the controls | VERIFIED WORKING | U `speech-unsupported.test.ts`, E |
| TTS-R10 | Resume from the exact sentence after a page reload | PARTIALLY IMPLEMENTED | pause/resume keeps the sentence; a reload restarts from the paragraph on screen |
| TTS-R11 | **Sound is actually audible** on the user's output device | BLOCKED | an automated agent cannot hear; Level 3 checklist in the final report |
| TTS-R12 | Server-side TTS | NOT IMPLEMENTED | evaluated and not chosen: browser engine first per specification; a provider voice needs a key and audio streaming |

## C. Voice semantic search (addition)

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| VS-R1 | Microphone button never starts capture on open; permission states handled; mic released on every exit | IMPLEMENTED, NOT VERIFIED | U `voice-search.test.ts` with fake recogniser and fake `getUserMedia` (25 lifecycle tests, fail on the old code); no real microphone was opened by an agent (H) |
| VS-R2 | Real speech recognition (browser recogniser, interim results) | IMPLEMENTED, NOT VERIFIED | the in-app browser blocks the mic; real Chrome needs a human to speak (H) |
| VS-R3 | Server transcription fallback (MediaRecorder to Whisper) | BLOCKED | no key; route validation, size/MIME/time caps and the no-key 402 are E/I verified |
| VS-R4 | Visible, editable transcript; typing wins over the recogniser | VERIFIED WORKING | U + E (typed path) |
| VS-R5 | Lexical retrieval over the current document, ranked excerpts with exact offsets | VERIFIED WORKING | U `search.test.ts`, `retrieval.test.ts` (41-query labelled set); E |
| VS-R6 | Semantic retrieval (embeddings re-rank) | BLOCKED | needs a key; the "words only" degradation is verified, the re-rank is not |
| VS-R7 | Jump to the passage and highlight the hit | VERIFIED WORKING | E |
| VS-R8 | Read the match aloud | VERIFIED WORKING | E with fake engine; audibility is TTS-R11 |
| VS-R9 | Honest "none" and "low" confidence | VERIFIED WORKING | U + E; the 0.4 cutoff is uncalibrated (documented, not tuned) |
| VS-R10 | Privacy disclosure of where voice and text go | VERIFIED WORKING | E reads the panel copy; wording reviewed, not legally reviewed |

## D. Annotations (addition)

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| AN-R1 | Select with mouse, triple-click, keyboard shortcuts | VERIFIED WORKING | U `anchors-dom.test.ts` (jsdom), E (real Chromium triple-click including last paragraph) |
| AN-R2 | Select by touch | IMPLEMENTED, NOT VERIFIED | no real touch device (H) |
| AN-R3 | Highlight (4 colours), underline, notes, edit, delete, toggle/recolour of identical marks | VERIFIED WORKING | U `annotate.test.ts`; E `annotations.spec.ts` |
| AN-R4 | Persistence local + server, sync without resurrecting deletions, last-write-wins | VERIFIED WORKING | U `library-sync.test.ts`, `annotation-schema.test.ts`; I/E `annotations-api.spec.ts` (400/404/409, last-write-wins, reader key) and `annotations.spec.ts` (a deletion on one device is not resurrected by another) |
| AN-R5 | Robust anchoring: context-verified fast path, fallback by quote with Unicode folding, ambiguity becomes an orphan | VERIFIED WORKING | U `anchors*.test.ts` |
| AN-R6 | Orphans are listed and deletable, never painted wrongly | VERIFIED WORKING | E |
| AN-R7 | Annotation view and Markdown export | VERIFIED WORKING | U `notebook-markdown.test.ts`, E |
| AN-R8 | Outage tolerance: 503 on mutations, local copy kept | VERIFIED WORKING | U `annotation-routes-outage.test.ts`, `db-outage.test.ts` |
| AN-R9 | `local:` documents never reach the server, so their annotations stay on the device | PARTIALLY IMPLEMENTED | by design; documented in the backlog (ANNOT-17) |

## E. Non-functional and cross-cutting

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| NFR-1 | SSRF protection on URL import | VERIFIED WORKING | U `safeFetch.test.ts`, `safeFetchRanges.test.ts`, `safeFetchPinning.test.ts` (address ranges, connect-time pinning); E `api.spec.ts` (private hosts refused); probes in `security-review.md` |
| NFR-2 | Server key cannot be abused as an open proxy (limits, caps) | VERIFIED WORKING | U `serverKeyAbuse.test.ts` (limits, caps, fixed provider errors); the limiter is per process, so a multi-instance deployment is not covered |
| NFR-3 | Cross-site mutation blocked | VERIFIED WORKING | E `security.spec.ts` (cross-site refused, same-origin and header-less clients pass, multipart covered) |
| NFR-4 | Security headers | VERIFIED WORKING | E `security.spec.ts` (headers present, app runs under them, cannot be framed, no Referer for article images); HSTS is production-only and was not exercised behind real TLS |
| NFR-5 | Reader isolation (no cross-reader read, write or delete) | VERIFIED WORKING | I/E `import-and-isolation.spec.ts`, `annotations-api.spec.ts` |
| NFR-6 | Parser limits (HTML, PDF) | VERIFIED WORKING | U `parserLimits.test.ts` |
| NFR-7 | Error hygiene: no SQL, document text or secrets in responses or logs | VERIFIED WORKING | U `importErrors.test.ts`, `db-outage.test.ts`; E `import-and-isolation.spec.ts` (text-route messages) |
| NFR-8 | WCAG 2.2 AA automated checks in all five themes, visible focus on every Tab stop | VERIFIED WORKING | E `a11y.spec.ts` (axe: 368 violating nodes at start, 334 of them contrast; 0 now, in all five themes); manual screen-reader pass is H |
| NFR-9 | Library and reader survive a PostgreSQL outage | VERIFIED WORKING | U `db-outage.test.ts`; E-level outage run recorded in `external-integrations.md` |
| NFR-10 | Production configuration guardrails (cookie secret, `APP_URL`) | VERIFIED WORKING | U `authHardening.test.ts`; never run behind a real production deployment (not allowed by the brief) |
| NFR-11 | No console errors or failed requests on primary journeys | VERIFIED WORKING | E assertions in `landing.spec.ts`, `reader.spec.ts`, and the dev-only script-tag error regression test |
| NFR-12 | Production build | VERIFIED WORKING | S `pnpm build`; one font-metric warning (BUILD-1) |
| NFR-13 | Google OAuth round trip | BLOCKED | no client id or secret |
| NFR-14 | Real-device and real-browser matrix (Safari, Firefox, iOS, Android) | NOT OBSERVABLE | only Chrome 155 and Playwright Chromium were available |

## F. Evolution: intelligent reading and understanding (second brief)

The model is not reachable in this environment (no key). Rows marked VERIFIED WORKING for these features mean the code we own is verified: the request the app builds, the validation and checking of the answer, storage, display, navigation and the error paths, using a fake model in unit tests and a stand-in for the route in the browser. Whether a live model returns good answers is the separate BLOCKED rows.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| UND-1 | The top bar carries no partner logo | VERIFIED WORKING | E `landing.spec.ts` (all three pages) |
| UND-2 | Open any readable link: web pages, PDFs by URL (even served as octet-stream or without an extension), plain text and markdown by URL; other types refused with a clear message | VERIFIED WORKING | U `uploadKind.test.ts` (`classifyFetched`); live imports of an arXiv PDF URL (189 blocks), a Project Gutenberg text URL and an image URL (refused) through the running server |
| UND-3 | Five summary kinds (quick, executive, detailed, key ideas, passage) as validated JSON, each with a coverage statement | VERIFIED WORKING | U `ai-ops.test.ts`, `ai-route.test.ts`; E `understand.spec.ts` (stand-in) |
| UND-4 | Every quote offered as evidence is checked against the paragraph it names; unverifiable statements are shown as flagged interpretation | VERIFIED WORKING | U `ai-evidence.test.ts`, `ai-ops.test.ts` |
| UND-5 | Long texts are read section by section within a bounded number of calls, and a partial reading says which paragraphs were read, with "Summarize the rest" | VERIFIED WORKING | U `ai-ops.test.ts`; E |
| UND-6 | Key concepts and comprehension questions (answers hidden until asked) | VERIFIED WORKING | U, E |
| UND-7 | Translation of a selection with the original beside it, literal versus natural rendering, notes on idioms and terms, document never replaced | VERIFIED WORKING | U `ai-ops.test.ts`; E `understand.spec.ts` |
| UND-8 | Translation of the whole text, part by part with "Translate the next part" | PARTIALLY IMPLEMENTED | E verifies the flow; by design it is not one request for the whole text, and long texts are translated a page at a time |
| UND-9 | Margin answers: ¶ citations are checked against the paragraphs the model was given, the model's own labels render as badges, an overview states how many paragraphs it read | VERIFIED WORKING | U `gloss-render.test.ts`; E `understand.spec.ts` |
| UND-10 | AI results persist with the document (new `glosses.result` column), survive reload, validate on write | VERIFIED WORKING | U `annotation-schema.test.ts`; I `annotations-api.spec.ts` (real PostgreSQL round trip); E reload |
| UND-11 | Literal search inside the document with marks, count, next and previous, and a separate "Search by meaning" | VERIFIED WORKING | U `find.test.ts`; E `find.spec.ts`, axe |
| UND-12 | Section navigation from the headings | VERIFIED WORKING | U, E |
| UND-13 | Reading position resumes after a reload, and "Back to where you were" follows a deliberate jump | VERIFIED WORKING | E `position.spec.ts` |
| UND-14 | Ask a question by voice or typed in the voice panel, answered in text with checked citations, follow-ups, Show in the margin | VERIFIED WORKING | U `voice-ask.test.ts` (fake recogniser and engine); E `voice-ask.spec.ts` (stand-in model) |
| UND-15 | Spoken answers: read once when finished, at the reader's rate, never while the microphone is on, stopped on close and on request, microphone never started by asking | VERIFIED WORKING | U `answer-speaker.test.ts`, `voice-ask.test.ts`; E. Events only: audibility is TTS-R11 |
| UND-16 | Single-key shortcuts can be switched off (WCAG 2.1.4) | VERIFIED WORKING | E `reader.spec.ts` |
| UND-17 | Modal dialogs trap and restore keyboard focus | VERIFIED WORKING | E `a11y.spec.ts` |
| UND-18 | The live model returns usable structured answers for every operation, and good ones (summaries, translations, concepts, questions, answers with the model's labels) | BLOCKED | no `TOGETHER_API_KEY`; the pipeline copes with bad JSON (retry then a plain error) but quality and the rate of valid JSON are unmeasured |
| UND-19 | Translation quality, language detection and idiom notes for Portuguese and English and other languages | BLOCKED | needs a live model and a human who reads both languages |
| UND-20 | Spoken answers are audible and a question can be spoken and recognised | BLOCKED | needs a person (see TTS-R11, VS-R1, VS-R2) |
| UND-21 | The reader, landing and library are usable from 320 to 768 px: every top-bar control on screen and tappable, no overlap, no sideways scroll, panels fit and leave text visible, the selection toolbar fits in rows | VERIFIED WORKING | E `phone-layout.spec.ts` (five widths, three pages); found and fixed: Notebook and Understand were off screen at 375 px |
| UND-22 | Visual regression baselines for landing, library and reader in five themes at desktop and phone size, plus the Understand panel (empty and with a result), selection toolbar and find bar | VERIFIED WORKING | `pnpm test:visual` (46 comparisons, stable over repeated runs). Baselines belong to this machine's Chromium and fonts; they are not portable and a failure means "looks different", not "is wrong" |
| UND-23 | The Understand panel is easy to scan: every action described before anything is made, the newest result open and older ones collapsed with a preview, tabs by kind once there are three results | VERIFIED WORKING | E `understand.spec.ts`, axe in both states, visual baselines |
| UND-24 | Every link can be saved: readable pages, PDFs and text are read; a page that cannot be read (a site that blocks servers, an app page with no article, a missing page, an unreachable host) is kept as a link card with its address, the title and description the page gives about itself, and the reason; the card offers Open the original, Try reading it again and Remove, and says how to read it here | VERIFIED WORKING | U `linkDoc.test.ts`; E `links.spec.ts` (offline, with private addresses); live: https://finalosint.lat/ saved with its own title and description, example.com saved as a link |
