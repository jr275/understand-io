# Verification matrix

> **Status note (2026-10-18, later the same day):** this file records the first library-search round. The gate results for the server-hardening round are in `phase-b-data-and-security.md` section 4 and the release candidate's in `release-candidate.md`; where numbers differ, those are newer.

_What was checked, how, and what was not. Run 2026-10-18 on the working tree at commit `7d490f3` plus one added unit test (`backup.test.ts`, oversize and non-JSON refusal). Every number is from a command run in this session. Claims about earlier rounds are in `docs/final-qa-report.md` and `docs/evolution-report.md`, not repeated here._

## 1. Gate commands

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p .` | 0 errors |
| `npx eslint src tests` | 0 errors, 0 warnings (one unused import in `lib/search/library.ts` was found and removed first) |
| `npx vitest run` | 43 files, **792 tests passed** (791 before the oversize/non-JSON case was added; the last total recorded in an earlier report was 760) |
| `npx playwright test` (desktop, phone and visual projects) | **230 passed** in 8.1 min: 184 functional, 46 visual-regression screenshots (earlier round: 174 + 46) |
| `npx next build` | exit 0 |
| `pnpm audit --prod` | no known vulnerabilities |

Typecheck, lint, the end-to-end run and the build were run on the tree before the one added unit test; that test touches no source file, so they were not repeated.

## 2. New behaviour: what proves each claim

| Claim | Unit | End to end |
| --- | --- | --- |
| A question finds the passage in the right text and opens it marked | `library-search.test.ts` (finds the passage; several texts ranked; limits per text; link builder) | "a question finds the passage in the right text, with the paragraph, and opens the text on it marked" |
| A question no text covers says so and states how many texts were searched | "finds nothing for a question no text covers" | "a question no text covers says so, and names how many texts were searched" |
| One letter does nothing; clearing brings back the shelf | "answers nothing under two characters" | "one letter does not search; clearing the box brings the plain shelf back" |
| The reader's notes and highlights are found and open at the mark | "finds the reader's own notes and highlights, notes first" | "the reader's own notes and highlights are found by their words and open at the mark" |
| Matched words are marked without altering characters | "marks the words that matched…", "marks nothing when nothing matched" | covered by the first e2e |
| A backup holds the texts that live only here, with marks, questions and positions | `buildBackup` cases | "a backup downloads with the text and the mark…" |
| Restore into an empty browser works and restoring twice adds nothing | "adds everything to an empty library", "is idempotent" | same e2e |
| Restore never replaces, never duplicates a mark or question, takes only a newer position | the three matching cases | not separately |
| A damaged, foreign, non-JSON or oversize file is refused whole with a reason | "refuses a damaged backup as a whole", "refuses a file too large… and one that is not JSON" | "a file that is not a backup is refused with a reason and changes nothing" (foreign file) |
| `javascript:` and `data:` addresses are never kept | "never keeps an address that is not a web address" | none |
| Notes export as one Markdown file | "writes one section per text that has notes" | "every note exports as one Markdown file" |
| The same page by another spelling, and the same text re-pasted, is not saved twice | the eight `duplicates.test.ts` cases | "importing an address already on the shelf opens it instead, whatever tracking is on the link" |
| Results and the backup panel pass axe in light and dark | n/a | "search results and the backup panel have no axe violations, in the light and the dark theme" |
| Results can be reached and opened with the keyboard alone | n/a | "results are reachable and openable with the keyboard alone" |

The new screens were also looked at in the running app earlier in this session (library search, backup panel, duplicate import). That look was not repeated after the final commit, and no screenshot of it is stored with these documents; the automated tests above are the evidence that can be re-run.

## 3. What this run does not cover

| Not covered | Why | Consequence |
| --- | --- | --- |
| Any live model answer | no key | Understand features remain unproven (`AI-4`) |
| A screen reader | needs a person | axe and keyboard tests pass; "accessible" is not claimed beyond that (`A11Y-4`) |
| Library search speed with hundreds of texts | not measured | no latency figure is given anywhere (`backlog.md` rank 3) |
| Restoring a backup made by a different browser or app version | only version 1 exists | a future version must keep reading version 1; no test exists for that because there is no version 2 |
| Restore of a very large backup (up to the 40 MB limit) | no fixture of that size | the size check is tested; the time to restore is not |
| Safari, Firefox, phones | only Chromium | layouts at phone sizes were checked by emulated width |
| Any change after `7d490f3` except the one added unit test | none were made to source | `git status` shows only the documentation under `docs/` and that test as changed |
| Restore, `javascript:`/`data:` rejection and the "never replaces" rule in a real browser | covered by unit tests only | the logic is tested; the file-picker path is exercised only for a foreign file and for the full round trip |

## 4. How to repeat it

```bash
npx tsc --noEmit -p . && npx eslint src tests && npx vitest run
npx playwright test
npx next build && pnpm audit --prod
```
