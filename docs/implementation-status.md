# Implementation status

Statuses: **NOT IMPLEMENTED** · **IMPLEMENTED, NOT VERIFIED** · **PARTIALLY IMPLEMENTED** ·
**VERIFIED WORKING** · **BLOCKED** · **NOT OBSERVABLE**. "Verified" means a Playwright or Vitest test
in this repository, or a recorded manual check in the Browser pane noted below, exercised it.
Untested code is never counted as working.

_Last updated: 2026-10-16. Test evidence: `pnpm test` (25 unit tests, all passing) and
`pnpm test:e2e` (26 end-to-end tests across desktop and mobile projects, all passing at the time of
writing; see "Test run" at the end). Screenshots for visual QA are in `docs/qa/`._

## Completion

| Area | Denominator | Done | % |
| --- | --- | --- | --- |
| Reference route coverage | 6 routes (`/`, `/library`, `/read/[slug]`, `/?url=`, `/?save=`, `/read/[slug]?hl=`) | 6 implemented, 4 verified by tests (`/`, `/library`, `/read/[slug]`, `?hl=` via desk link), `?url=`/`?save=` implemented not verified | 100% implemented · 67% verified |
| Visual fidelity | 12 screens compared against reference screenshots at the same viewports | 10 match in structure, type, colour and spacing (landing, library shelf, library topics, open book, add panel, reader, lens, gloss margin, appearance, notebook); 2 partial (mobile reader: gloss sheet not screenshot-compared; landing signed-in desk: shows highlights desk but no "Continue" ring until progress exists) | ~83% |
| Existing product functionality | 28 "Observed" interactions in `interaction-inventory.md` | 22 verified working, 4 implemented not verified (bookmarklets, Pocket/Raindrop export parsing, Colour/Length sort, topic change persistence), 2 not implemented (Clerk sign-in, MCP agent connection) | 79% verified · 93% implemented |
| Text-to-speech | 9 requirements | 7 verified with a mock engine (play/pause/resume/stop/restart, whole text, selected passage then continue, sentence highlight, speed, voices, no overlap), 2 implemented not verified with real audio (resume position after reload, long-document keep-alive) | 78% verified · 100% implemented |
| Voice semantic search | 10 requirements | 7 verified (typed transcript path, in-document search, ranked excerpts, navigation, highlight of the match, read-aloud of a hit via mock, honest no-match / low-confidence), 2 implemented not verified (microphone permission + live recognition, server transcription fallback), 1 partially (semantic re-rank only runs with a Together key) | 70% verified · 100% implemented |
| Text annotations | 9 requirements | 8 verified (mouse selection, keyboard shortcuts H/U, highlight colours, underline, notes, edit, delete, persistence across reload, restoration, notebook view), 1 implemented not verified (touch selection on a real device) | 89% verified |
| Automated test coverage | 13 test areas in the brief | 11 covered (routes, responsive, article loading, playback controls incl. errors via mock, transcription failure path *typed only*, exact + fuzzy retrieval, ambiguous/nonexistent results, underline/highlight/notes/edit/delete, persistence, integration of voice search → reading, keyboard, console errors + failed requests); 2 not covered (microphone permission prompt, live provider verification of LLM answers) | 85% |

## Items

### Routes and pages

| Item | Route | Status | Evidence / notes |
| --- | --- | --- | --- |
| Landing: hero, import bar, samples, desk, footer line | `/` | VERIFIED WORKING | `landing.spec.ts`; `docs/qa/landing-desktop.png`, `landing-mobile.png` |
| "Continue *title* N%" line after reading | `/` | IMPLEMENTED, NOT VERIFIED | Renders from stored progress; no test drives progress then returns |
| "Your latest highlights" desk + `?hl=` deep link | `/` → `/read/[slug]?hl=` | PARTIALLY IMPLEMENTED | Desk renders from annotations (manual check); deep-link scroll implemented, not tested |
| Library shelf, stats, filters, sort, search, open book, topics grid, starter cards | `/library` | VERIFIED WORKING | `library.spec.ts`; `docs/qa/library-*.png` |
| Add panel: manual links (multi), import-export file, bookmarklets | `/library` | PARTIALLY IMPLEMENTED | Panel + validation verified; saving links exercised manually through the API (`/api/import` with paulgraham.com and Wikipedia); bookmarklet entry `/?url=` implemented, not tested |
| Add panel: "Connect an agent" (MCP) | `/library` | NOT IMPLEMENTED | Honest placeholder copy; no MCP server in this build |
| Reader: header, numbered blocks, drop cap, footer, composer | `/read/[slug]` | VERIFIED WORKING | `reader.spec.ts` (63 numbered blocks, Notes h2) |
| Not-found state for unknown slugs | `/read/[slug]` | VERIFIED WORKING | `reader.spec.ts` |
| Imported documents (URL, PDF, pasted text) open in the reader | `/read/[slug]` | VERIFIED WORKING | `landing.spec.ts` (paste), `api.spec.ts` (text); PDF verified manually with arXiv 1706.03762 (62 blocks) |
| Sign in / accounts | — | NOT IMPLEMENTED | Reference uses Clerk. This build uses an anonymous signed cookie per browser; no cross-device sync |
| Painted covers | — | NOT IMPLEMENTED | Toggle present, labelled "Not available in this build" |
| Web search inside answers ("Fact-check … Searches the web") | — | NOT IMPLEMENTED | Toggle kept for fidelity; answers are grounded in the text only |

### Reader interactions (existing product)

| Item | Status | Evidence |
| --- | --- | --- |
| Selection lens: Ask, Explain, Simplify, More (Define, Fact-check, Related, Counterpoint, Copy quote), Highlight colours, Note | VERIFIED WORKING (UI) | `reader.spec.ts`, `search-and-speech.spec.ts`; `docs/qa/reader-lens-desktop.png` |
| Margin gloss: streaming answer, key sentence mark, ¶ citations, follow-up, retry, copy, delete, collapse, leader lines, bottom sheet < 1080px | PARTIALLY IMPLEMENTED | Rendering, collapse/active, error state and persistence verified; **streamed answers from the model are IMPLEMENTED, NOT VERIFIED** because no Together key was available in this environment (the no-key path returns an explicit 402 and the card shows the message, verified) |
| Whole-text question (composer) | IMPLEMENTED, NOT VERIFIED | Same key constraint |
| "Gloss this text" overview (B) | IMPLEMENTED, NOT VERIFIED | Same key constraint |
| Notebook: tabs, cards, delete, copy/download Markdown | VERIFIED WORKING | `reader.spec.ts`; `docs/qa/reader-notebook-desktop.png` |
| Appearance: themes, pens, highlighter, Numbers/Map/Focus/Listen, Text tab, Answers tab | VERIFIED WORKING | `landing.spec.ts` (theme persists), `reader.spec.ts` (typeface, size, focus) |
| API key panel (browser-only storage, sent per request) | VERIFIED WORKING | Manual: key saved to localStorage and sent as `x-gloss-key`; GET `/api/gloss` reports server key presence |
| Keyboard: `/` J K Enter [ ] B N F Esc ? + new L Space V H U | VERIFIED WORKING | `reader.spec.ts` (J/K/?/F/Esc), `search-and-speech.spec.ts` (L, Space, V) |
| Map rail, scroll progress, topbar title on scroll, reading progress persistence | VERIFIED WORKING (rail, progress bar) / IMPLEMENTED, NOT VERIFIED (resume position) | Rail present in `reader.spec` DOM; resume logic in `Reader.tsx` |
| Mobile hint toast, numbers hidden < 720px, full-width composer | VERIFIED WORKING | `mobile.spec.ts`; `docs/qa/reader-mobile.png` |

### Text-to-speech (addition)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Play, pause, resume, stop, restart | VERIFIED WORKING (mock engine) | `search-and-speech.spec.ts` |
| Whole text or selected passage (then continue) | VERIFIED WORKING (mock) | same |
| Sentence highlight synchronised with speech | VERIFIED WORKING (mock) | `.m-speak` follows the utterance; word boundaries exposed via `charIndex` when the engine reports them |
| Resume from the correct position | PARTIALLY IMPLEMENTED | Pause/resume keeps the sentence; after a reload playback starts from the current paragraph, not mid-sentence |
| Speed | VERIFIED WORKING (mock) | 0.75×–2× select |
| Voices and languages | IMPLEMENTED, NOT VERIFIED with real voices | Voice list sorted by document language; Browser pane reported 180 voices but produced no audio events |
| Long documents, interruptions, errors | IMPLEMENTED, NOT VERIFIED | One utterance per sentence, keep-alive nudge, watchdog that surfaces a stalled engine |
| No overlapping sessions | VERIFIED WORKING (mock) | cancel-before-speak + token guard |
| Server-side TTS | NOT IMPLEMENTED (evaluated) | Browser engine chosen first per brief; a provider voice would need a key and audio streaming |

### Voice semantic search (addition)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Microphone interaction and permission handling | IMPLEMENTED, NOT VERIFIED | Browser pane blocks the microphone; error copy for denied/no-speech/no-device exists |
| Real speech recognition | IMPLEMENTED, NOT VERIFIED | Web Speech API (`SpeechRecognition`) with interim results; MediaRecorder + server Whisper fallback behind a key |
| Visible, editable transcript | VERIFIED WORKING | typed-transcript path in `search-and-speech.spec.ts` |
| Search within the current article | VERIFIED WORKING | BM25 over sentence windows (`search.test.ts`, e2e) |
| Semantic retrieval | PARTIALLY IMPLEMENTED | Embedding re-rank through `/api/search` only when a key exists; lexical path always available and labelled "words only" |
| Ranked matches with excerpts | VERIFIED WORKING | e2e + unit |
| Navigate to the passage, highlight the match | VERIFIED WORKING | e2e (`.hit-mark`, cursor in view) |
| Read the passage aloud | VERIFIED WORKING (mock) | "Read aloud" button per hit; "…and read it" in the query triggers it when confidence is high |
| Honest no-match and low-confidence | VERIFIED WORKING | e2e + unit |

### Annotations (addition)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Selection with mouse / keyboard / touch | VERIFIED (mouse via DOM selection, keyboard shortcuts H/U) / NOT VERIFIED (touch) | `reader.spec.ts` |
| Underline, highlight, 4 colours | VERIFIED WORKING | `reader.spec.ts` |
| Notes attached to selections, edit, delete | VERIFIED WORKING | `reader.spec.ts` |
| Persistence across refresh and sessions | VERIFIED WORKING | localStorage + PostgreSQL (`annotations` table) — reload tests; DB rows observed with `psql` |
| Restoration on reopen, robust anchoring | VERIFIED WORKING | `anchors.test.ts` (offsets, quote + context, repeated text, text shifts) |
| Annotation view per document | VERIFIED WORKING | Notebook tabs |

### Backend

| Item | Status | Evidence |
| --- | --- | --- |
| PostgreSQL schema + migrations (Drizzle) | VERIFIED WORKING | `drizzle/0000_*.sql` applied to local `gloss` DB |
| Anonymous reader identity (signed httpOnly cookie) | VERIFIED WORKING | `api.spec.ts` (same-browser ownership) |
| Import: URL (Readability), PDF (unpdf), text/markdown | VERIFIED WORKING | `content.test.ts`, `api.spec.ts`, manual curl runs |
| Annotations / glosses / progress / documents CRUD | VERIFIED WORKING (annotations, documents list) / IMPLEMENTED, NOT VERIFIED (glosses, progress PUT) | DB rows observed; no dedicated test for glosses/progress endpoints |
| LLM proxy with user-key or server-key, explicit 402 without a key | VERIFIED WORKING (402 path) | `api.spec.ts`; live provider path not verified |
| Local-only mode when `DATABASE_URL` is unset | IMPLEMENTED, NOT VERIFIED | Code path returns `persisted:false`; tests ran with a database |

## Known deviations from the reference

- No accounts (Clerk) and no MCP agent connection; "Sign in" affordances are omitted rather than shown dead.
- Topic icons, cover illustrations and topic-card art are procedural SVG, not the reference's painted
  images (which are generated assets). Shelf colours, spine styles and layout rules follow the reference.
- The partner mark is rendered as a three-disc glyph plus the text "together.ai" instead of the
  reference's logo artwork.
- Deks for the Schopenhauer and Thoreau samples were written for this build; the Huxley dek matches.
- Model credit reads the configured model id; the reference names "DeepSeek V4.1 Flash".

## Test run

```
pnpm test        → 3 files, 25 tests passed
pnpm test:e2e    → 26 tests passed (desktop 24, mobile 2)  — PLAYWRIGHT_PORT=3100 against `next dev`
pnpm build       → compiled, 18 routes
```
