# Backlog

_Open work only, in the order it should be picked up. Done items live in `docs/audit/defect-backlog.md` (defects) and `docs/product/innovation-roadmap.md` (features). Updated 2026-10-18. "Needs" names what the work cannot do without; an item that needs a person or a key is not something a test run can close._

| Rank | ID | Item | Type | Size | Needs | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AI-4 / N1 | Run every Understand operation against a live model, record the JSON validity rate, review summaries and citations, tune prompts | verification | M | a model key; a bilingual reader for translation | `docs/audit/external-integrations.md` has a table of live results; failures have tests |
| 2 | ANNOT-17 / N2 | Re-key `local:` documents (and their marks, questions, positions) when the reader gains an account or the server saves the text | defect | M | the database | a unit test and an e2e where a `local:` text keeps its marks after sign-in; no duplicate on the server |
| 3 | RETR-10 / N3 | Time library search on a large shelf (for example 300 texts, a 500-page book); add a persistent index only if keystrokes lag | measurement | S | none | a number in `docs/quality/verification-matrix.md`; an index only if it exceeds a stated budget |
| 3a | CI-1 | Make the browser suite run against a production build and a disposable database (so CI can run it and it stops writing to the developer database): adapt the three dev-only assertions, diagnose the find-bar `color-contrast` finding | quality | M | none | a CI browser job that passes on a clean checkout; `phase-b-data-and-security.md` section 3c closed |
| 4 | A11Y-4 / N8 | Screen-reader pass over the reader, library (including the new search results and backup panel) and Understand panel | verification | S | a person with VoiceOver or NVDA | findings logged in `docs/audit/visual-accessibility-review.md` |
| 5 | A11Y-5 | Roving tabindex in the lens toolbar | defect | S | none | e2e: Tab enters once, arrows move, Escape returns |
| 6 | TTS-9 / N5 | Remember where reading aloud stopped between presses and reloads | defect | S | a browser | e2e across a reload |
| 7 | IMP-7 / N6 | Title a text link from its content rather than its file name | defect | S | none | unit on the title picker; live import of a `.txt` link |
| 8 | N4 | Pin a summary or answer into the notebook with its evidence links | feature | M | rank 1 | the notebook export includes the result and its links resolve |
| 9 | LIB-1 | Library search: offer the reader's "partly covers" hits in a collapsed group when there are strong ones | polish | S | none | e2e |
| 10 | LIB-2 | Backup: a reminder when the shelf holds texts that exist only in this browser and no backup has been made | feature | S | none | e2e; the reminder can be dismissed and stays dismissed |
| 11 | BUILD-1 | Font metrics warning for Atkinson Hyperlegible Next at build and test time | hygiene | S | none | no warning, or a documented reason it cannot be removed |
| 12 | N7 | Bilingual reading view | feature | L | rank 1; a decision to store results | decision recorded first |

## Added by this round

- LIB-1 and LIB-2 are new: they follow directly from D1 and D2 and were not in any earlier list.
- Not added on purpose: semantic (embedding) search of the library. It needs a provider and would send every saved text off the device, against principle 5.

## Closed by this round

| ID | What | Evidence |
| --- | --- | --- |
| IMP-3 | the same text or address imported twice | `tests/unit/duplicates.test.ts`; e2e "importing an address already on the shelf opens it instead" |
| (part of) ANNOT-17 | marks on `local:` texts can no longer be lost with the browser, only left unsynced | `tests/unit/backup.test.ts`; e2e "a backup downloads … restores … adds nothing" |

ANNOT-17 itself stays open: backup protects the data, it does not sync it.
