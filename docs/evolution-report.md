# Evolution report: intelligent reading and understanding

_Second brief, executed on 2026-10-17 on top of the audited code base (see `docs/final-qa-report.md` for the first). Every number comes from commands run in this session. The model provider has no key here, so nothing below claims that a live model answered anything._

## 1. Diagnosis of the existing code (before the changes)

| Question of the brief | What the code actually did |
| --- | --- |
| Stack and structure | Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Drizzle on PostgreSQL, AI SDK 7 to Together AI. `src/lib/{ai,anchors,content,search,speech,server,store,db}` plus `src/components/{reader,library,landing,chrome}` |
| Routes | `/`, `/library`, `/read/[slug]`; API routes for import (link, file, text, captured page), documents, annotations, glosses, progress, `/api/gloss` (streamed answer), `/api/search` (re-rank), `/api/speech/transcribe`, Google sign-in |
| Import | links (Readability), PDFs (pdf.js), pasted text, uploaded files, a browser bookmarklet for sites that block servers. Real. A direct PDF link worked only when the server said `application/pdf` |
| Selection | selection to a text anchor with offsets, quote and context; the toolbar offered Ask, Explain, Simplify, More, Highlight, Underline, Note, Read aloud; no Translate, no Summarize |
| Questions and answers | one free-text streaming prompt for every action (`/api/gloss`). Real when a key exists; answers rendered with ¶ citations |
| Citations | **not verified**: any "¶n" the model wrote became a link, including paragraphs the model was never given. An "overview" took a sample of paragraphs and said "the gist of the whole text" without saying so |
| Highlights, notes, progress | real: local first, mirrored to PostgreSQL; progress resumed after reload but was never tested |
| Real, simulated or only visual | everything in the toolbar and margin was wired to real code. Not built: summaries, translation, concepts, comprehension questions, in-text search, section navigation, spoken answers. The "Web" toggle in the composer and "Painted covers" are inert placeholders kept for fidelity to the reference |
| Authentication, persistence, security, tests | Google sign-in behind env vars (unverified live), anonymous signed-cookie readers, hardened server (see the audit); 668 unit and 112 end-to-end tests at the start of this brief (42 and 32 at the start of the first audit) |
| AI and integrations | Together AI only. No key in this environment |
| Limits that affect the brief | no structured output, no evidence checking, no summary of long texts, no translation, TTS by the browser (events verified in Chrome, audibility not) |

## 2. Architecture and order (what was built and why in this order)

The audit showed Phase 1 was mostly done; its real gaps were **verifiable references** and **honest coverage**. The order therefore followed dependency: first the evidence layer (everything else needs it), then the operations that use it, then the interface, then voice.

```
Understand panel / selection toolbar ──► lib/client/aiOps.ts ──► POST /api/ai ──► lib/ai/ops.ts ──► model (JSON)
                                                                                   │
                                                          validate (zod) ◄─────────┘
                                                          check quotes against the document (lib/ai/evidence.ts)
                                                          attach coverage (which paragraphs were read)
                                         result ◄─────────┘ ──► stored in glosses.result (PostgreSQL + browser)
```

- One prompt and one schema per operation (summary variants, concepts, questions, translation); the model answers one JSON object; the app retries once on invalid JSON and then says so plainly.
- Evidence is the app's check, not the model's word: a quote counts only if it is found in the paragraph the model names, and the offsets come from the document. A statement that claims to be from the text without a verifiable quote is shown as interpretation and flagged.
- Long texts are read section by section with a fixed ceiling on calls and size; what was not read is stated on the result, and "Summarize the rest" continues from the next paragraph.
- Domain mapping: Document, Source and ReadingProgress are the existing document and progress rows; Highlight, TextAnnotation and Note are annotations; AIInteraction, Summary and Translation are `glosses` rows with a new nullable `result` column (migration 0003, additive; recovery: `ALTER TABLE glosses DROP COLUMN result`). A separate table was not justified: ownership, sync, deletion and tombstones already work for glosses.

Risks and dependencies named at the start: no key (live behaviour cannot be tested), model compliance with the JSON shape and with the labelling instruction (handled by validation, retry and downgrade, not by trust), cost on the shared key (existing per-reader and per-address limits, bounded calls per request).

## 3. Phase 1: reliable reading

**Delivered**
- Partner logo removed from the top bar (the provider is still named in the footer and the privacy notes).
- Any link, any PDF: links are classified by their bytes and type, not by the server's label. PDFs served as octet-stream or without an extension, plain text and markdown links are read; images and other binaries get a clear message. Live: an arXiv PDF URL imported (189 blocks), a Project Gutenberg text URL imported, an image URL refused with the message.
- PDF import keeps headings and paragraphs apart and merges runs of tiny figure fragments (arXiv 1706.03762: 258 blocks with 103 short became 189 with 29).
- Checked references: ¶ citations in margin answers are checked against the paragraphs the model was given (an unknown paragraph is struck through and does not link); the prompt asks the model to label its interpretation ("My reading:"), outside knowledge ("Outside the text:") and gaps ("The text does not say:") and those render as badges; an overview says how many paragraphs it read.
- Reading position: resume after reload is now tested; "Back to where you were" appears after a deliberate jump (citation, evidence, search hit, section).
- Selection toolbar: Translate, Summarize (the passage only) and a direct Copy quote button next to Explain, Ask, Simplify, Highlight, Underline and Note.

**Files** `src/lib/ai/{evidence,ops,languages,results}.ts`, `src/lib/ai/prompts.ts`, `src/app/api/ai/route.ts`, `src/app/api/import/route.ts`, `src/lib/content/{uploadKind,pdf}.ts`, `src/components/reader/{Reader,Lens,MarginGlosses,Notebook,glossMarkdown}.tsx`, `src/components/chrome/{Topbar,marks}.tsx`, `src/lib/db/schema.ts`, `drizzle/0003_*.sql`, `src/lib/anchors/schema.ts`, `src/lib/store/library.ts`.

**Decisions** structured results live in `glosses.result`; evidence verification is deterministic and shared by every operation; a translation never replaces the text; the provider's name stays as a text credit (the request was about the logo).

**Limits** the labels depend on the model following the instruction; citations are checked either way. Some publishers refuse server fetches (use the bookmarklet).

## 4. Phase 2: understanding

**Delivered** the Understand panel (key `I`, top-bar button): quick, executive, detailed and key-ideas summaries; key concepts; "Test me" (comprehension questions, answers hidden until asked); answer language; results kept with the document, copyable as Markdown, cancellable, retryable and deletable; every card states which paragraphs were read, shows quote chips that jump to the source, labels interpretation and outside-the-text statements, and lists the limits the model reported. Literal search in the text (key `S`): marks, count, next and previous, accent, case, quote and whitespace tolerant, a Sections menu from the headings, and a separate "Search by meaning" that hands over to the question panel.

**Files** `src/components/reader/{InsightsPanel,FindBar}.tsx`, `src/lib/search/find.ts`, `src/lib/client/aiOps.ts`, `src/lib/ai/results.ts`.

**Decisions** results are not mixed into the margin (they are documents about the text, not notes on a passage); the find bar and the side panels give way to each other; the literal search never calls a model.

## 5. Phase 3: languages and audio

**Delivered** translation of a selection (original beside the translation, literal rendering only when it differs, notes on idioms, terms and ambiguities, the surrounding paragraph used only to settle meaning, source language reported by the model, target chosen from eleven languages, adding one is one line in `src/lib/ai/languages.ts`) and translation of the whole text part by part, about a page each, with "Translate the next part". Read-aloud was already in place and verified; this phase re-ran it in the real Chrome against the rewritten controller (see `docs/audit/tts-validation.md`).

**Decisions** whole-text translation is part by part on purpose: one request for a book would be slow, costly and impossible to cancel usefully, and every part shows exactly which paragraphs it covers. TTS stays on the browser engines (free, private for local voices, no key); a provider voice remains an evaluated option, not built.

**Limits** translation quality and language detection are unmeasured (no key, and a human who reads both languages is needed).

## 6. Phase 4: advanced experience

**Delivered** conversation by voice or typing in the voice panel ("Ask a question" next to "Find a passage"; the composer's microphone opens it ready to ask): the answer is written in the margin and shown in the panel with checked citations; follow-ups continue the conversation; the answer is read aloud once when finished, at the reader's rate and voice, only if "Read answers aloud" is on; Stop speaking and Read this answer aloud are explicit; the voice stops before the microphone is used, when the panel closes and when a new question is asked; asking never starts the microphone; no audio is kept. Comprehension questions (Phase 2) cover that item of Phase 4.

**Files** `src/components/reader/VoiceSearch.tsx`, `src/lib/speech/answerSpeaker.ts`, `src/components/reader/Reader.tsx`.

**Decisions** an answer reuses the margin gloss pipeline (one place for limits, checks and storage); the spoken answer uses a separate small speaker because the reading controller is built around the document's own sentences.

**Limits** no real microphone and no audible check were possible here (see section 8).

## 7. Tests actually run (final, 2026-10-17)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | clean |
| `pnpm test` | 0 | 39 files, **752 passed** (at the start of this brief: 32 files, 668) |
| `pnpm test:e2e` | 0 | **145 passed** (143 desktop, 2 mobile; at the start: 112) |
| `pnpm build` | 0 | compiled; the one font-metric warning (BUILD-1) |
| `pnpm audit --prod` | 0 | no known vulnerabilities |

New test files: `ai-evidence`, `ai-ops`, `ai-route`, `answer-speaker`, `voice-ask`, `find`, `gloss-render` (unit); `understand`, `find`, `position`, `voice-ask` (end to end). Key regression checks were run against a broken implementation and failed there (the microphone-stops-the-voice test, the dialog focus tests, the typed-over-spoken test).

What the tests are: the fake model in the unit tests and the stand-in for `/api/ai` and `/api/gloss` in the browser tests make the **pipeline** verifiable (the request the app builds, validation, evidence checks, coverage, storage, display, navigation, errors). They do **not** show that a live model produces valid JSON, good summaries or good translations.

## 8. What is not verified, and how to verify it

| Not verified | Why | How |
| --- | --- | --- |
| Live answers for every operation (JSON validity rate, summary and translation quality, the model's use of its labels) | no `TOGETHER_API_KEY` | add a key (`docs/audit/external-integrations.md`), open a text, press each button in Understand, read the cards; check that quotes jump to the right place and that "Interpretation" appears where the text does not say it |
| Translation quality | same, plus a person who reads both languages | translate five passages in each direction and judge them |
| Audible spoken answers, real microphone recognition | an agent cannot hear or speak | `docs/audit/tts-validation.md` and `docs/audit/voice-search-validation.md`; then ask "what is chalk made of?" aloud with a key and listen |
| Phone and other browsers | only Chrome 155 and Playwright Chromium | open the same text on a phone and in Safari |

## 9. Decisions that need you

1. **A key for the model.** Without one, every AI feature answers "needs a key". Recommended: your own Together AI key in the key panel while testing (nothing is stored on the server); a server key only after a shared limiter and spend ceiling exist (`docs/audit/security-review.md`). Alternative: another OpenAI-compatible provider through the same route.
2. **Whole-text translation as a bilingual reading view** (the translation shown paragraph by paragraph beside the original). Recommended only if you want to read translated texts regularly; it costs a request per page and needs a place to keep the result.
3. **A provider voice instead of the browser's.** Recommended: no, until the browser voices are judged poor in a human test.

## 10. Next steps

Run the human checks in section 8; add the key and review live output; apply migration 0003 anywhere other than this machine's development database before deploying; then decide on section 9.

## 11. Visual pass (after the four phases)

Done without a model key. Order: phones first, then a visual regression net, then the Understand panel.

**Phones.** The reader was inspected at 320, 360, 375, 412 and 768 px. The real faults found: at 375 px the top bar ran off the right edge, so the Notebook and Understand buttons could not be tapped; the selection toolbar scrolled sideways with no sign of it and its highlight colours opened only on hover; on landing and library the wordmark, the Library button and "Sign in" collided. Fixed (wordmark text gives way to the mark on narrow screens, badges on the button corner, the toolbar in two rows with the colours always shown, "Sign in" icon-only under 480 px, sheets that leave text visible). `tests/e2e/phone-layout.spec.ts` checks every top-bar control is on screen and at least 32 px, nothing overlaps, the page never scrolls sideways, panels fit and the toolbar is reachable, at five widths on three pages. It fails on the old layout.

**Visual baselines.** `pnpm test:visual` compares 46 screenshots (landing, library and reader in five themes at desktop and phone size; the Understand panel empty and with a result, the selection toolbar and the find bar in two themes) with baselines stored in `tests/visual`. Content is fixed, animation off, the framework's dev indicator and the empty margin hint hidden, the library's filter chips masked (they differ by sub-pixels from run to run). Over repeated runs it is stable; reverting a deliberate header fix makes it fail. The baselines found one real bug that the layout tests had not (the sign-in wrapping). Limits: the baselines are this machine's Chromium and fonts, so on another operating system they must be regenerated and reviewed; a failing comparison says "looks different", not "wrong".

**Understand panel.** Before anything is made every action is described under its name (and the key and privacy notes stay visible); afterwards the tools tuck behind "Make something new", the newest result is open and older ones are collapsed with a two-line preview (keyboard and mouse), and from the third result tabs filter by kind. No example result is shown: nothing in the product presents invented output as real.

**Tests (final for this pass).** `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 760 passed, `pnpm test:e2e` 174 passed, `pnpm test:visual` 46 passed, `pnpm build` 0, `pnpm audit --prod` 0.

**Not done from the list, on purpose.** Notebook integration of AI results and the landing page copy wait until the AI features have run against a live model; the library's "many items" state and the generated covers, and the remaining accessibility polish (focusable existing marks, lens roving focus, a screen-reader pass), are still open (see `docs/audit/defect-backlog.md`).

## 12. Saving every kind of link

Reported with `https://finalosint.lat/`: the page is an application page with no article, so the import answered "Could not find a readable article on that page." and saved nothing. Now every link is kept. Readable pages, PDFs and plain text are read as before. Anything else (no article, a site that blocks servers, a missing page, an unreachable host, an address that is not public) becomes a **link card**: a document of kind `link` holding the address, the title and description the page gives about itself (taken from the start of its HTML by plain pattern matching, without credentials typed into the address), and a sentence on why it could not be read. The card has its own page with Open the original, Try reading it again (a success replaces the card with the text), Remove, and the honest ways to read it here (paste the text, the bookmarklet that hands over the page you are looking at, or a downloaded PDF). In the library it is labelled a saved link. Live: finalosint.lat is saved as "FinalOSINT | Plataforma OSINT para investigação digital" with its own description, example.com as "Example Domain". The server API keeps its old answers unless the client asks to keep the link (`keep: true`), which every screen now does; links that are not web addresses (`ftp:`, `javascript:`, `file:`) are still refused.

Limits: a link card has nothing to annotate, summarize or search until its text is brought in. Saved links are not de-duplicated _(update 2026-10-18: a readable page, PDF or text already on the shelf is now opened instead of saved again; a link card is still never treated as a duplicate, so the address can be tried again; see `docs/quality/known-limitations.md`)_. Reading a card again is one fetch, so a site that blocks servers will still refuse; the bookmarklet is the way in for those.

