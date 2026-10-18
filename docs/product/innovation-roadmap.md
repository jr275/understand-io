# Innovation roadmap

_Written 2026-10-18 after the third round of work. Built from the repository, the audit documents and the two earlier reports, not from user research: there is none in the repository, and where an item rests on a guess about readers it says so. Principles: `docs/product/principles.md`. Detailed list: `docs/product/backlog.md`._

## 1. Where the product stands

The reader is solid: import of links, PDFs, pasted text and files; checked citations; summaries, concepts, comprehension questions and translation (all built, **none ever run against a live model**, no key); read aloud and voice search in the browser; highlights, notes and a notebook; five themes; phone layouts; a visual regression net. What it lacked was **a library that behaves like one**: a reader with thirty saved texts could only search inside the text they had open, could lose everything by clearing site data, and could import the same article twice.

## 2. How candidates were chosen

Each candidate needs (a) a documented gap or defect it removes, (b) a way to check it without a model key or a person, or an honest statement that it needs one, (c) no new place that stores reader data off the device. Candidates are ranked by **evidence × reach ÷ effort**; the scores are judgement, shown so they can be argued with.

| Score | Meaning |
| --- | --- |
| Evidence | 3 = a recorded defect or a missing item in the traceability matrix; 2 = a decision left open in an earlier report; 1 = a reasoned guess |
| Reach | 3 = every reader every session; 2 = every reader sometimes; 1 = a subset |
| Effort | S = under a day, M = a few days, L = a week or more |

## 3. Delivered in this round (commit `7d490f3`)

| # | Change | Gap it closes | Evidence | Reach | Effort | Checked by |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **Search the whole library.** One box on `/library` finds passages across every saved text (BM25 per text, ranked, with a "partly covers" label for weaker hits) and in the reader's own notes and highlights. Each result opens the text on that passage (`?at=`) or mark (`?hl=`). Says "nothing found" and how many texts were searched; texts kept on the account but not in this browser are named as not searched. | search existed only inside one open text (RETR family); "many items" state of the library was untested | 3 | 3 | M | `tests/unit/library-search.test.ts`; `tests/e2e/library-search.spec.ts` |
| D2 | **Backup and restore.** One JSON file with the texts that exist only in this browser plus every mark, question and reading position; one Markdown export of all notes. Restoring validates with the server's own schemas, accepts only web addresses for links and images, refuses oversize and foreign files, and **only adds**. | the browser is the only copy of `local:` texts (ANNOT-17); "backups: NOT IMPLEMENTED" | 3 | 2 | M | `tests/unit/backup.test.ts`; e2e round trip |
| D3 | **No second copy.** Importing an address (normalised) or a text (fingerprint over 200+ characters) already on the shelf opens the saved one instead of adding another. | IMP-3 | 3 | 2 | S | `tests/unit/duplicates.test.ts`; e2e |

## 4. Next, in order

| # | Candidate | Why now | Evidence | Reach | Effort | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | **Run every AI operation against a live model and tune** (JSON validity rate, summary and translation quality, label compliance). | The largest piece of built, unproven work. Everything in Understand is unverified until this is done. | 3 | 3 | M | a Together AI key (the reader's own is enough), a person who reads both languages for translation |
| N2 | **Re-key `local:` documents when an account appears** so marks follow the text to the server and across devices. | ANNOT-17 is the one open item that can strand data; backup is the safety net, not the fix. | 3 | 2 | M | the database; a migration test |
| N3 | **Measure library search at scale** (hundreds of texts, long books) and add a persistent inverted index only if typing lags. | RETR-10 (no inverted index). Today one index per text is built lazily and cached while the blocks array is the same object; it has not been timed on a large shelf. | 2 | 2 | S to measure, M to build | none |
| N4 | **Notes that carry AI results.** Let a summary or answer be pinned into the notebook with its evidence links intact. | Deferred on purpose until the AI features had run live (evolution report, section 11). | 2 | 2 | M | N1 |
| N5 | **Remember where reading aloud stopped** between presses and reloads. | TTS-9 (partial). | 3 | 2 | S | a browser |
| N6 | **Title a text link from its content**, not its file name. | IMP-7. | 3 | 1 | S | none |
| N7 | **Bilingual reading view**: the translation beside the original, paragraph by paragraph. | Decision 2 of the evolution report; costs a request per page and needs a place to keep the result. | 2 | 1 | L | N1, a decision to store results |
| N8 | **Finish accessibility**: roving tabindex in the lens toolbar (A11Y-5) and a real screen-reader pass (A11Y-4). | The only way to claim the accessibility principle without a caveat. | 3 | 2 | S + a person | a person using a screen reader |

## 5. Later, only with a decision

| # | Idea | Why it waits |
| --- | --- | --- |
| L1 | Connect an agent over MCP (REF-7, not built) | Needs a decision on what an outside agent may read; the library is local-first, so the server cannot serve it. |
| L2 | Server voice instead of the browser's (TTS-R12) | Only if browser voices are judged poor in a human listening test; costs money and sends text to a provider. |
| L3 | Shared rate limit, server backups, deployment | Operational readiness items 9 and 10; the brief forbade deployment. |
| L4 | Web search inside answers (REF-25) | Breaks principle 2 unless every web claim is checked as well. |
| L5 | Resurfacing old highlights for review | A guess about readers, not backed by evidence; must not add streaks or pressure (principles). Validate with readers first. |

## 6. Hypotheses to validate with readers

None of these is established. Each has a cheap test.

1. *Readers keep a shelf long enough that finding a passage matters.* Test: count texts and marks per reader (needs consented, local-only counts; nothing is collected today).
2. *Readers want a file backup rather than an account.* Test: offer both in a prototype and see which is used.
3. *"Nothing found, 12 texts searched" is clearer than a ranked list of weak hits.* Test: five readers search for something absent.
4. *A summary pinned to a note is used more than a standalone summary.* Test after N1.

## 7. Risks

- **The model:** every Understand feature depends on JSON compliance that is validated and retried but never observed. Mitigation: N1 first.
- **Browser storage is small and clearable.** Mitigation: D2; N2; the library says where texts live.
- **Search is lexical.** A reader who remembers an idea but not its words will not find it. Not fixed here; semantic search would need a provider and breaks local-first.
