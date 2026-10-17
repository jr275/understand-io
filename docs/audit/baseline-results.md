# Baseline verification — Phase C

_Run on 2026-10-16 (evening, local) against HEAD `e6fd1d7` with a clean working tree, before any change of this pass. Commands come from `package.json`; nothing was invented. Logs were kept in the session scratchpad._

| # | Command | Exit | Duration | Result | Classification |
| --- | --- | --- | --- | --- | --- |
| 1 | `pnpm exec prettier --check .` (no check script exists; `format` only writes) | **1** | 2 s | 115 files are not Prettier-formatted, including every `src/` file, docs, lockfile, `drizzle/meta/*.json` | Repository hygiene (HYG-1). The codebase was never formatted with the configured Prettier + Tailwind plugin. Not a product defect; a dedicated formatting commit is recommended rather than mixing it into fixes. Generated files (`pnpm-lock.yaml`, `drizzle/meta`, `.claude`) should be ignored via `.prettierignore`. |
| 2 | `pnpm typecheck` (`tsc --noEmit`) | 0 | 2 s | clean | — |
| 3 | `pnpm lint` (`eslint`) | 0 | 3 s | clean, 0 warnings | — |
| 4 | `pnpm test` (Vitest) | 0 | 1 s | **42 passed**, 7 files (`anchors`, `content`, `search`, `safeFetch`, `speech-controller`, `importStatus`, `auth`) | Unit level. `speech-controller.test.ts` uses a fake `speechSynthesis` (jsdom). |
| 5 | `pnpm test:e2e` (Playwright, reused the running server on 3100) | 0 | 40 s | **32 passed** (desktop 30, mobile 2) | End-to-end against the real app + real local PostgreSQL. Speech tests use a fake engine installed by `installFakeSpeech`; the voice-search tests type the transcript (no microphone); model routes are exercised only on their no-key (402) path. |
| 6 | `pnpm build` (`next build`) | 0 | 4 s (Turbopack, warm) | compiled, 23 routes; 1 warning: font override values for `Atkinson Hyperlegible Next` | BUILD-1 (P3) |
| 7 | `pnpm audit --prod` | 0 | <1 s | no known vulnerabilities | — |
| 8 | `pnpm outdated` | 1 (= updates exist) | <1 s | react 19.3.1, @types/node 26, eslint 10, typescript 7 available | No action (see environment inventory). |
| 9 | Migration status | — | — | `drizzle.__drizzle_migrations` has 2 rows matching the 2 journal entries; `\d accounts` matches `0001_heavy_the_order.sql` | consistent |
| 10 | Secret-leak check | — | — | `grep -r` for `process.env.` shows every secret read only in server modules (`lib/server`, `lib/ai/provider.ts`, `lib/db/client.ts`); none in `"use client"` files. `.env.local` is git-ignored and absent from history (`git log --all -- .env.local` empty). | sound |

## Evidence levels of the green results

| Level | What the baseline proves |
| --- | --- |
| Static | types and lint pass; build compiles |
| Unit (mocked boundaries) | anchoring, segmentation, BM25 ranking, SSRF address logic, cookie/token signing, PKCE, playback state machine (fake engine) |
| Integration with real local dependencies | e2e API tests write and read PostgreSQL rows through the real routes with real cookies |
| End-to-end, providers mocked or absent | reader/library/landing journeys; read-aloud via fake engine; voice search via typed transcript; AI via 402 path |
| End-to-end, live providers | **none** (no Together key, no Google credentials) |
| Manual real-browser | see `docs/final-qa-report.md` §11 (Chrome 155 read-aloud, capture bookmarklet) and the Phase D notes in this folder |

## Failures and how they were classified

Only the Prettier check failed, and it is a formatting gap rather than a functional defect. No test was excluded, skipped or edited to obtain this baseline.

## Import pipeline probes run during baseline (HTTP, against the running server)

| Case | Response | Verdict |
| --- | --- | --- |
| `/api/import/text` empty / whitespace | 400 "Nothing to read." / 422 "Nothing to read." | ok |
| `/api/import/text` malformed JSON | 400 "Nothing to read." | message misleading (IMP-2) |
| `/api/import/text` 2 000 001 chars | 400 "Nothing to read." | should say too large (IMP-2) |
| `/api/import/text` Unicode (diacritics, CJK, emoji, typographic quotes) + repeated paragraphs | 200, title "Ünïcödé 测试 🚀", 4 paragraphs | ok |
| same text posted twice | two documents, different slugs | duplicates allowed (IMP-3) |
| `/api/import` missing url / ftp / javascript: | 400 with clear messages | ok |
| `/api/import` unresolvable host | 400 "That host could not be found." | ok |
| `/api/import` 404 page | 404 "That page no longer exists (404)." | ok |
| `/api/import` example.com (no article) | 422 "The page had no readable paragraphs." | ok |
| `/api/import` 169.254.169.254, decimal 2130706433, `[::1]`, `0x7f000001` | 400 "Only public links can be read." | SSRF guard holds for these forms |
| `/api/import` `https://example.com:81/` (black-hole port) | 502 "That page could not be reached." after 10.4 s | ok (connect timeout) |
| `/api/import/file` corrupted PDF bytes | 422 "Invalid PDF structure." | ok |
| `/api/import/file` `x.gif` (image/gif) | **200** — imported as a text document titled "x.gif" with body "GIF89a" | defect IMP-1: non-text binary accepted |
| `/api/import/file` no file | 400 "No file received." | ok |
| `/api/import/page` HTML without article | 422 "The page had no readable paragraphs." | ok |
| `/api/import/page` 10 MB + 1 HTML | 400 "No page content received." | message misleading (IMP-2) |
