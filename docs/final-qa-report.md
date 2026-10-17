# Final QA report — Understand.io (Gloss reconstruction)

_Date: 2026-10-16. Audited directory: `~/gloss-reconstruction/gloss` (the only project touched).
Everything below was re-verified in this pass; nothing is carried over from the earlier report without
being re-run._

## 1. Project identification

| Check | Result |
| --- | --- |
| Directory | `/Users/joaormendes/gloss-reconstruction/gloss` (Next.js 16.4.2 app; `package.json` name `gloss`) |
| Git | Repository restored after the folder move (`.git` is never copied by the app). Branch `main`, history: `180dbb6` scaffold → `a693206` foundation → `613d8e3` fixes/tests → this pass |
| Env file | `gloss/.env.local` present. `DATABASE_URL` set; `GLOSS_COOKIE_SECRET` set (not the default); **`TOGETHER_API_KEY` empty**. Values were not printed. |
| PostgreSQL | `pg_isready` on 5432: accepting. Database `gloss`, PostgreSQL 16.15, 6 tables (`readers`, `documents`, `annotations`, `glosses`, `reading_progress`, `settings`). Rows at audit start: 13 documents, 11 annotations, 0 glosses, 30 readers, 12 progress rows. No destructive change was made. |
| Dev server | `pnpm dev --port 3100`, started from this directory (checked with `lsof`: process cwd = this folder). Another Next server on port 3010 belongs to an unrelated project and was left alone. |
| Launch config | `.claude/launch.json` at `~/gloss-reconstruction` and in `gloss/` both point at this project. **Caveat found:** the app's preview tool still launched the server from the previous session folder; use the command below instead. |

Problem found and fixed during Phase 1: the `.next` build cache and the preview server came from the
previous location and served stale sample data. Cache removed; server restarted from this folder.

## 2. Commands executed and results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | OK (dependencies were not copied with the folder) |
| `pnpm typecheck` | OK, no errors |
| `pnpm lint` | OK, 0 errors, 0 warnings (one unused import removed) |
| `pnpm test` (Vitest) | **35 passed** in 5 files (10 new tests in this pass: SSRF guard, speech controller) |
| `pnpm test:e2e` (Playwright, `PLAYWRIGHT_PORT=3100`) | **27 passed** (desktop 25, mobile 2) after fixes; one new regression test |
| `pnpm build` | OK — compiled, 18 routes |

No test was weakened. One mock-engine assertion that depended on a 300 ms race was replaced by a
deterministic assertion on the utterances actually spoken (first the selected passage, then the
following sentence).

## 3. Browser verification (Browser pane, Chromium)

| Check | Result |
| --- | --- |
| Landing opens, fonts (Newsreader, Schibsted Grotesk) loaded, no console errors, no failed requests | VERIFIED |
| Library loads, spines, stats, chips; open book → "Start reading" opens the reader | VERIFIED |
| Reader: header, 63 numbered blocks, composer; API calls `/api/documents/*/data`, `/api/gloss`, `/api/progress` all 200 | VERIFIED |
| Highlight → `POST /api/annotations` 200 → reload → highlight restored, notebook badge 1 | VERIFIED |
| Themes applied through `data-theme` and persisted (`gloss:settings`) | VERIFIED (Playwright) |
| Mobile 375 px: no horizontal overflow, paragraph numbers hidden, composer and hint toast | VERIFIED (Playwright mobile project + pane) |
| Console errors / failed network requests | None on landing, library, reader |

Pane limitations (documented, not app defects): the Browser pane blocks the microphone and emits no
speech-synthesis events, and CSS animations in a background or emulated-viewport tab stay at their
first frame in screenshots. Playwright screenshots in `docs/qa/` show the fully rendered pages.

## 4. The three additional features

### A. Read-aloud
- Implemented in `src/lib/speech/controller.ts` (one utterance per sentence, cancel-before-speak,
  token guard, keep-alive nudge, stall watchdog) and `ListenBar.tsx`.
- Automated: play/pause/resume/stop/restart, whole text, selected passage then continue, sentence
  highlight, speed, voice list, no overlap, skip-while-paused, restart from error — **VERIFIED with a
  fake engine** (Vitest + Playwright).
- **Real engine, VERIFIED in the user's Chrome 155 (macOS) on 2026-10-17** through the Claude in Chrome
  extension (see §11 for the evidence): `start`, `boundary` and `end` events fired on every utterance,
  sentence tint and counter advanced, pause/resume/skip/speed/voice/stop all behaved, a selected passage
  was read and then reading continued, and a 2-minute unattended run produced 20 utterances with no
  error, no stall and gaps under 100 ms. What this environment cannot attest is the loudspeaker itself:
  the engine produced audio events, but nobody in the loop *heard* it. The user's own ear is the last check.
- Resume after reload: starts at the saved paragraph, not mid-sentence (PARTIALLY IMPLEMENTED).
- Fixed in this pass: after a passage, or when resuming from the saved position, the counter kept
  restarting at `1/<remaining>`; it now counts in whole-text terms (`3/276`).

### B. Voice passage search
- Implemented in `VoiceSearch.tsx` + `src/lib/search/bm25.ts` (+ optional embedding re-rank through
  `/api/search`). Typed-transcript path, ranked excerpts, jump + highlight, read-aloud of a hit,
  no-match and low-confidence states — **VERIFIED** (Playwright + unit tests).
- Microphone permission prompt, live recognition and server transcription: IMPLEMENTED, NOT VERIFIED
  (pane blocks the microphone; server transcription needs a key).
- Honest labelling: results say "words only" without a key and "words + meaning" when the embedding
  re-rank ran. Lexical search is never presented as semantic.

### C. Annotations
- Highlights (4 colours), underlines, notes with edit/delete, persistence (localStorage + PostgreSQL),
  restoration on reopen, anchoring by block id + offsets + quote context with re-anchoring for
  repeated/shifted text — **VERIFIED** (Playwright reload tests, `anchors.test.ts`).
- Per-document separation: store is keyed by document id; verified by inspection and tests.
- Touch selection on a real device: NOT VERIFIED.

## 5. Problems found by the audit and fixed in this pass

Confirmed by an independent read-only code review and reproduced by tracing the code paths:

1. Deleting or retrying a gloss while it streamed could resurrect it (abort handling) — fixed; delete
   now aborts in margin, sheet and notebook paths. Regression test added.
2. The first paint wrote reading progress of 0 % before the server copy merged, so cross-device
   resume was lost — fixed (only the reader's own scrolling writes progress; short documents are no
   longer marked finished on open).
3. Failed server writes were silent and deletes could be undone by the next sync — fixed with
   tombstones replayed on load, newer-wins merge by `updatedAt`, and a toast when a sync fails.
4. SSRF guard in `/api/import` was hostname-only — replaced with DNS resolution + private-range checks
   for IPv4/IPv6, manual redirects re-validated per hop, and a 10 MB body cap. Unit-tested.
5. Cookie secret fell back to a hard-coded value — now fails fast in production when unset.
6. Annotation/gloss upserts could overwrite another reader's row with a known id — owner predicate added.
7. `persisted` flag could claim server persistence without a database — now set only from server responses.
8. Typing a question starting with h/u in the lens triggered highlight/underline — shortcuts moved to Shift+H / Shift+U.
9. Lens could close as soon as the user started typing after a paragraph-Ask — dismiss flag reset; selection changes inside the lens ignored.
10. Speech: skip while paused resumed the old sentence; error state could not restart; `voiceschanged` listener leaked — all fixed, unit-tested.
11. Import routes could return 500 (PDF without text, slug collision across readers) — wrapped; slug collision retried with a new suffix.
12. Dialog backdrops did not close on click — fixed (Keys, Voice search, Add panel, Paste text).
13. Documents deleted on another device stayed on the shelf; deleting a document left orphan rows — fixed (sync drops them; delete cascades in a transaction).
14. Follow-up questions were sent twice to the model — fixed.
15. `?hl=` deep links did not wait for server data — fixed.
16. `/api/gloss` had no request-size limits and ignored client aborts — limits added, abort propagated.
17. Accessibility: rail is keyboard-operable, voice options are buttons, note cards no longer nest a button in a button, Enter shortcut only fires from the page body.
18. Voice search input lost typed text on interim results; recorder auto-stop left the UI "listening" — fixed.
19. Visual fidelity: stray chip separator, missing "This area is for notes" margin hint, reading time rounding (now 38/27/16 min like the reference), typographic quotes in the sample texts.
20. Product renamed to **Understand.io** in the UI, metadata, prompts and README ("gloss" is kept only as the feature word for margin notes).

Not fixed (documented): Lens toolbar/menu have no roving tabindex; dialogs do not trap/restore focus;
no accounts; no MCP server; "Painted covers" and web search are placeholders.

## 6. External dependencies

| Service / library | Used for | Works locally | Needs key | Configured | Real call tested | Cost | When unavailable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL 16 (Homebrew) | documents, annotations, glosses, progress | Yes | No | Yes (`DATABASE_URL`) | Yes (rows written/read in tests) | None locally | App runs local-only; API returns `persisted:false` |
| Together AI (OpenAI-compatible, via `ai` + `@ai-sdk/openai-compatible`) | margin glosses, whole-text answers | — | **Yes** | **No** | **No** | Pay per token (DeepSeek-V3.1 list price ≈ $0.60 in / $1.70 out per 1M; shown as an estimate in the UI) | 402 "needs a key"; UI explains |
| Together AI embeddings (`BAAI/bge-base-en-v1.5`) | semantic re-rank of search hits | — | Yes | No | No | Small per-call cost, not measured | Lexical search only, labelled "words only" |
| Together AI Whisper (`openai/whisper-large-v3`) | server transcription fallback | — | Yes | No | No | Per audio minute, not measured | Browser recognition only; otherwise type |
| Browser Speech Synthesis (Web Speech API) | read-aloud | Yes (browser) | No | n/a | **Yes** — Chrome 155 via the Chrome extension: engine events on 20+ utterances, 199 voices listed, voice switch took effect (not heard by a human in this loop) | None | Watchdog error with guidance |
| Google OAuth 2.0 (sign-in, optional) | accounts; library follows the reader across browsers | — | **Yes** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | **No** | **No** | Free (Google Cloud OAuth client) | "Sign in" button opens an explanation; anonymous cookie keeps working |
| Publisher sites (The Atlantic, Medium, NYT…) | URL import | — | — | — | Yes: all three answer **403 to any non-browser client**, even with full Chrome headers (TLS fingerprinting) | — | Clear message + bookmarklet that captures the page from the reader's own tab |
| Browser Speech Recognition (Web Speech API) | voice search | Chrome/Edge/Safari | No | n/a | **No** (pane blocks mic) | None (Chrome sends audio to Google) | Server fallback or typing |
| Google Fonts via `next/font` (Newsreader, Literata, Schibsted Grotesk, Atkinson Hyperlegible Next) | typography | Yes (self-hosted at build) | No | n/a | Yes | None | n/a |
| Readability + linkedom, unpdf | import | Yes | No | n/a | Yes (paulgraham.com, Wikipedia, arXiv PDF) | None | Clear error messages |

No new paid service was added. Together AI is the only recurring cost and is optional.

## 7. Visual fidelity vs reference (same viewports, headless Chromium, `docs/qa/ref-*.png` vs `docs/qa/*.png`)

| Area | Verdict | Concrete differences |
| --- | --- | --- |
| Layout and dimensions | Match | Max-widths, column widths, topbar height, card sizes identical within a few px |
| Typography | Match | Same families, weights, optical sizes; typographic quotes now match |
| Spacing | Match | Hero, import bar, desk, library hero, reader header spacing identical |
| Colours and contrast | Match | Token values copied from the reference stylesheet; five themes × four pens |
| Navigation components | Partial | "Sign in" present (Google, env-gated; explains itself when not configured) plus an "Add" button the reference does not have; partner mark is text + three discs instead of the logo artwork |
| Reader hierarchy | Match | Kicker, title, dek, byline, "Gloss this text", drop cap, numbers, composer; margin hint added |
| Menus, panels, dialogs | Match | Appearance, Keys, Notebook, Lens, open book, add panel reproduced; "Connect an agent" is an honest placeholder |
| Themes | Match | Verified by test |
| Interactive states | Mostly | Hover/active transitions reproduced; lens roving focus not implemented |
| Responsiveness | Match | 375 px landing/library/reader compared; no overflow |
| Imagery | Different | Topic icons, covers and topic-card art are procedural SVG, not the reference's painted images |

## 8. Status table

| Funcionalidade | Status | Evidência | Dependência | Problema restante |
| --- | --- | --- | --- | --- |
| Landing e biblioteca | VERIFIED WORKING | `landing.spec.ts`, `library.spec.ts`, pane checks, `docs/qa` | none | Painted imagery replaced by procedural art; no accounts |
| Leitor e importação | VERIFIED WORKING | `reader.spec.ts`, `api.spec.ts`, manual URL/PDF imports | Readability, unpdf | Figures without captions render empty text block |
| Persistência PostgreSQL | VERIFIED WORKING | reload tests, `psql` row counts, cookie ownership test | PostgreSQL | Pending-write replay is best-effort (no retry while offline) |
| Leitura em voz alta | VERIFIED WORKING (real engine, Chrome 155) | 6 unit + 3 e2e tests with a fake engine; §11 real-browser run with engine events | browser speech engine | Loudspeaker output not attested by a human in this loop; resume is per paragraph |
| Busca textual | VERIFIED WORKING | `search.test.ts`, 3 e2e tests | none | — |
| Busca semântica | IMPLEMENTED, NOT VERIFIED | code path + 402 test | Together key | No key available; falls back to lexical, labelled |
| Microfone e transcrição real | IMPLEMENTED, NOT VERIFIED | code review, error copy | browser mic / Together key | Pane blocks the microphone |
| Destaques e sublinhados | VERIFIED WORKING | `reader.spec.ts`, `anchors.test.ts` | none | Touch selection untested on device |
| Notas persistentes | VERIFIED WORKING | `reader.spec.ts` (create/edit/delete/reload) | none | — |
| Integração entre recursos | VERIFIED WORKING (mock) | voice hit → jump + read aloud; lens → read passage then continue; delete gloss regression | fake speech engine | Real-audio path unverified |
| Responsividade | VERIFIED WORKING | `mobile.spec.ts`, ref vs impl mobile screenshots | none | Gloss bottom-sheet not screenshot-compared |
| Fidelidade visual | PARTIALLY IMPLEMENTED | `docs/qa/ref-*` vs `docs/qa/*` | none | Imagery, partner logo, Sign in |
| Importação de links bloqueados (bookmarklet de captura) | VERIFIED WORKING | `api.spec.ts` (page import), `landing.spec.ts` (handshake), real Atlantic article captured in Chrome (§11) | reader's own browser tab | Paywalled pages yield only what the browser shows |
| Mais entradas (botão Add na barra, soltar ficheiro/link em qualquer página, ⌘V fora da landing, faixa "Read something else" no fim do texto) | VERIFIED WORKING | `reader.spec.ts` "more ways in"; Chrome check of the Add panel from the top bar | none | Dropping a link from another window not exercised by a test (only a file drop) |
| Sign in (Google) | IMPLEMENTED, NOT VERIFIED | `auth.test.ts` (tokens, PKCE), `api.spec.ts`/`landing.spec.ts` (unconfigured path), `accounts` table migrated | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No credentials on this machine; the OAuth round-trip and the anonymous→account library merge have not run |
| Build de produção | VERIFIED WORKING | `pnpm build` | none | — |
| Testes automatizados | VERIFIED WORKING | 42 unit + 32 e2e passing | Playwright Chromium | Live-provider, microphone and real OAuth paths untested |

## 9. Percentages (denominators stated; unverified items are not counted as working)

| Area | Denominator | Verified | % verified |
| --- | --- | --- | --- |
| Route coverage | 6 public routes/entries | 4 verified (`/`, `/library`, `/read/[slug]`, `?hl=` by test), 2 implemented not verified (`/?url=`, `/?save=`) | 67% (100% implemented) |
| Visual fidelity | 11 areas in §7 | 7 match, 2 partial, 1 mostly, 1 different (imagery) | 64% full match (82% match or mostly) |
| Original functionality | 28 observed interactions | 23 verified (bookmarklets now verified for real), 4 implemented not verified (incl. sign-in, pending credentials), 1 not implemented (MCP) | 82% |
| Read-aloud | 9 requirements | 8 verified with the real Chrome engine (play/pause/resume/stop/restart, whole text, passage-then-continue, sentence tint, speed, voices, long run without stall, no overlap); 1 partial (mid-sentence resume after reload) | 89% real engine |
| Voice search | 10 requirements | 7 verified, 2 not verified (mic, server STT), 1 partial (semantic) | 70% |
| Annotations | 9 requirements | 8 verified, 1 not verified (touch) | 89% |
| Test coverage | 13 areas in the brief | 11 covered | 85% |

## 10. Summary for the hand-off

- **Project directory:** `/Users/joaormendes/gloss-reconstruction/gloss`
- **Local URL:** http://localhost:3100
- **Start command:** `cd ~/gloss-reconstruction/gloss && pnpm dev --port 3100` (first time: `pnpm install`; database: `pnpm db:migrate` with `DATABASE_URL` set)
- **Database:** local PostgreSQL 16, database `gloss`, migrated, reachable; no destructive changes made.
- **Tests:** typecheck ✓ · lint ✓ · 42 unit ✓ · 32 e2e ✓ · build ✓
- **Verified for real:** landing, library, reader, import (URL/PDF/text, and bot-blocked sites through the capture bookmarklet), highlights/underlines/notes with persistence, typed voice search, themes, responsive layout, API ownership and no-key behaviour, read-aloud with the real Chrome speech engine (§11).
- **Not yet verified:** a human hearing the read-aloud audio, microphone recognition, server transcription, model answers (glosses / whole-text / overview), semantic re-rank, touch selection, Google sign-in round-trip and library merge.
- **Credentials needed (names only):** `TOGETHER_API_KEY` for answers, embeddings and transcription; `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` for sign-in (free OAuth client; redirect URI `http://localhost:3100/api/auth/google/callback` locally). `DATABASE_URL` and `GLOSS_COOKIE_SECRET` are set.
- **Costs:** none today; Together AI usage is pay-per-token/minute when a key is added (not yet measured); Google OAuth is free.
- **Next actions:** (1) press `L` on any text in Chrome and confirm you *hear* it; (2) press `V`, allow the microphone, say "find the part about the sea floor"; (3) add a Together key in the key panel and run Explain, a whole-text question and `B`; (4) create a Google OAuth client, fill the two env vars, restart, click Sign in, then sign in on a second browser and confirm the library follows; (5) optionally rename the `gloss` folder/package to match Understand.io.

## 11. Follow-up pass (2026-10-17): real-browser read-aloud, blocked imports, more ways in, sign-in

Trigger: the user tried to save a link and got "That page answered 403.", noted there was no login,
and asked for three more places to add links/PDFs. They also asked for the read-aloud script to be run.

### Read-aloud in the user's Chrome (via the Claude in Chrome extension)

Browser: Chrome 155, macOS, `speechSynthesis.getVoices()` = 199 voices. `speechSynthesis.speak` was
wrapped in the page to log each utterance's `start`/`boundary`/`end`/`error` events.

| Step | Observed |
| --- | --- |
| Click, press `L` | Pill "Reading · 1/276 · 0%", first sentence tinted; utterance 1 fired `start` after 408 ms and 44 word boundaries before `end` at 15.3 s; utterance 2 started 55 ms later |
| `Space` | `speechSynthesis.paused = true`, button label → "Resume", counter 2/276 · 1% |
| `Space` again | Boundaries resumed (48 → 61), `paused = false` |
| Forward / back arrows | 5/276 → 4/276; the interrupted utterance reported `error: interrupted` (expected) and the new sentence started within ~10 ms |
| Speed 1.5× | Current sentence restarted with `rate: 1.5` |
| Voice list | 40+ en voices listed (System default, Albert, Daniel en-GB, Google UK/US "online", Samantha…); picking Daniel restarted the sentence with `voice: Daniel` immediately |
| Stop | `speaking = false`, pill and tint gone |
| Select sentence in ¶2 → … → Read aloud | "Passage · 1/1 · 100%", then "Reading · 1/274" and the next sentence ("Northward, the chalk…") — this exposed the counter restart, fixed in this pass (now `3/276`) |
| 2-minute unattended run | 20 utterances, 0 errors, 0 unfinished, max gap between sentences 81 ms, page auto-scrolled (scrollY 2345), no stall message, no console errors |

Not verifiable from here: whether sound came out of the speakers. Everything the engine reports says it did.

### Link import: root cause and fix

- Reproduced with `curl`: theatlantic.com, medium.com and nytimes.com answer **403** to the server's
  fetch *and* to a full Chrome header set (UA, sec-ch-ua, accept-language…), while paulgraham.com,
  Wikipedia, BBC, Substack and The New Yorker answer 200. The block is TLS-fingerprint bot protection,
  not our user agent; no server-side fetch can pass it.
- Fix 1 (`src/lib/server/importStatus.ts`, `api/import/route.ts`): 401/403/429/451 now return 422 with
  "That site blocks readers like this one. Open the page in your browser and use the “Read in
  Understand” bookmarklet, or paste its text." (unit-tested). The server fetch also sends a browser-like
  UA and `accept-language`.
- Fix 2 (`api/import/page/route.ts`, `lib/client/bookmarklet.ts`, `ImportBar.tsx` capture mode): the
  bookmarklets now open `/?capture=read|save` and hand the page's `outerHTML` to that tab through
  `postMessage` (origin- and source-checked handshake); the server runs Readability over the HTML it is
  given and never contacts the site. Falls back to the server fetch after 6 s if no page arrives.
  **Verified for real**: the bookmarklet code was run on a live Atlantic article in Chrome and the
  reader opened with the article (6 paragraphs — the paywalled page exposes only that much). Also
  covered by `api.spec.ts` and a two-tab handshake test in `landing.spec.ts`.

### Three more ways in (plus one)

1. **Top bar "+" button** on landing, library and reader → the Add panel (links, Pocket/Raindrop export,
   bookmarklets, and now "Open a PDF or text file" and "Paste text").
2. **Drop anywhere**: a PDF / text / markdown file or a dragged link on any page shows "Drop to read" and
   imports it (`GlobalImport.tsx`; drags that start inside the page are ignored).
3. **"Read something else" strip** at the end of every text: link field, Open a PDF, Paste text.
4. **⌘V on library and reader pages** (the landing already had it); in the reader it asks first so a stray
   paste never navigates away mid-read.

### Sign-in (Google, env-gated) — IMPLEMENTED, NOT VERIFIED

The reference uses Clerk; this build adds a self-contained Google OAuth 2.0 (PKCE) flow with no new
paid service: `accounts` table (migration `0001`), `/api/auth/google` → Google → `/api/auth/google/callback`,
`/api/auth/me`, `/api/auth/signout`. An account owns one reader id; signing in swaps the browser's reader
cookie to it and merges that browser's anonymous library (documents, annotations, glosses, progress,
settings) into the account in one transaction. Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` the
Sign in button opens a popover saying sign-in is not set up and what is needed (verified in Chrome and
by test). The real round-trip and the merge have **not** run: no Google credentials exist on this machine.
Setup: Google Cloud Console → Credentials → OAuth client (Web application) → redirect URI
`http://localhost:3100/api/auth/google/callback` → put both values in `.env.local`, restart.

### Commands in this pass

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm test` | 42 passed (7 files; new: `importStatus.test.ts`, `auth.test.ts`, counter test in `speech-controller.test.ts`) |
| `pnpm test:e2e` | 32 passed (desktop 30, mobile 2; new: page import, capture handshake, sign-in honesty, more-ways-in) |
| `pnpm db:generate && pnpm db:migrate` | `0001_heavy_the_order.sql` applied; `accounts` table present; ledger has 2 entries |
| `pnpm build` | OK — compiled, 23 routes (5 new: `/api/import/page`, `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/signout`) |
