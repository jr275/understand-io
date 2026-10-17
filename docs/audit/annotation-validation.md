# Annotation validation

_Code under test: `src/lib/anchors/{index,schema,annotate}.ts`, `src/lib/store/library.ts`, `src/components/reader/{Block,Lens,MarginGlosses,Notebook,Reader}.tsx`, `notebookMarkdown.ts`, `src/app/api/{annotations,glosses,progress,documents}`. Findings ANNOT-1 to ANNOT-22; statuses in `defect-backlog.md`._

## What an annotation is

`{ id, documentId, kind: highlight | underline | note, color, note, anchor, createdAt, updatedAt }` with `anchor = { start:{b,o}, end:{b,o}, quote, prefix, suffix, prevBlock?, nextBlock? }`. Offsets are UTF-16 units into the block's plain text. The quote and its context exist so the mark can be found again when the text changes.

## Evidence

| Area | Evidence | Level |
| --- | --- | --- |
| Anchor creation, including across inline runs (em, strong, link, code) and across blocks | `anchors.test.ts` (7), `anchors-resolve.test.ts` (30) | U |
| Selection to anchor from a real DOM selection, triple-click shapes, element-boundary offsets, grapheme snapping | `anchors-dom.test.ts` (13, jsdom); `annotations.spec.ts` triple-click including the last paragraph in real Chromium | U, E |
| Re-anchoring after edits: context checked on the fast path, fallback scoring by prefix/suffix/neighbour blocks, ambiguity or weak evidence becomes an orphan, NFC and typographic-quote folding | `anchors-resolve.test.ts` | U |
| Randomised contract: unchanged blocks return the identical anchor; after inserting text before the range the anchor follows its text or is orphaned, never attached to different text; and at least 80 % follow | `anchors-property.test.ts` (201 cases, seeded; fails when resolution is broken) | U |
| Painting without altering the text: marks re-slice the original runs, overlapping marks nest | `segmentBlock` cases in `anchors.test.ts`; the full `Block` render was checked by a review experiment with `renderToStaticMarkup` (text preserved across em/strong/link/code), which is not a committed test | U |
| Toggle and recolour of identical marks, lens "Remove" | `annotate.test.ts` (7), `annotations.spec.ts` | U, E |
| Notes: 5000-character limit enforced in both editors with a counter | `anchors-resolve.test.ts` (`clampNote`), `annotations.spec.ts` | U, E |
| Validation at the server: lengths, offsets must match the quote, no lone surrogates, timestamps in range | `annotation-schema.test.ts`; `annotations-api.spec.ts` (400 and nothing stored) | U, I |
| Last-write-wins on the client `updatedAt`; late PATCH is a no-op; PATCH of a missing row is 404 and the client falls back to a full POST | `annotations-api.spec.ts`, `library-sync.test.ts` | I, U |
| Ownership: another reader's id answers 409, the owner's row is untouched; the data answer carries an opaque reader key, never the reader id | `annotations-api.spec.ts`, `import-and-isolation.spec.ts` | I, E |
| Sync: a synced, unedited item that is missing remotely is dropped, not re-posted (deleted elsewhere); tombstones survive until the server confirms; requests per id are ordered | `library-sync.test.ts` (13), `annotations.spec.ts` ("ANNOT-1, real server") | U, E |
| Outage: 503 `database-unavailable` for mutations, `persisted:false` for the snapshot, local copy kept | `annotation-routes-outage.test.ts` (real postgres.js against a dead port) | U |
| Orphans: no mark painted, listed under "Couldn't find this passage" with Delete, badge in the Notebook | `annotations.spec.ts` | E |
| Notebook export: document order, colour, date, multi-line quotes and notes kept inside their list item, Markdown injection neutralised, orphans marked | `notebook-markdown.test.ts` | U |
| Click inside a highlight keeps the reader's own drag selection; only the innermost mark answers | `annotations.spec.ts` | E (Chromium) |
| Unicode: emoji with skin tones and accented letters are never cut in two | `anchors-dom.test.ts`, `anchors-resolve.test.ts` | U |
| Performance guard: 3000 blocks by 40 marks resolves in well under 60 ms | `anchors-resolve.test.ts` | U (threshold, not a browser measurement) |

## Behaviour that is true by design (say it plainly)

- Matching is exact apart from Unicode folding. If the reader's text is edited inside a quoted passage, the mark becomes an orphan instead of guessing. Orphans stay in the margin list and the Notebook so nothing the reader wrote is lost.
- Annotations on `local:` documents (text pasted or imported while the library is offline) stay on the device. They never sync and are merged into the account on sign-in only as local data (ANNOT-17, open).
- Delete on one device and a newer edit on another resolves to the edit (there is no server tombstone). Items saved before the sync fix have no `syncedAt` and re-upload once.
- Anchors stored before neighbour context existed have none: an ambiguous repeat now orphans instead of guessing.

## Not verified

| Item | Why |
| --- | --- |
| Touch selection, long-press, selection handles, copy on a phone | no real device (H) |
| Safari and Firefox selection and triple-click behaviour | only Chromium available |
| Keyboard access to existing marks: marks are not focusable and focus is not moved into the lens (ANNOT-19, partial) | known gap, backlog |
| Concurrent editing from two real browsers over minutes | the two-device case is simulated with two reader contexts against the real server |
| Large documents (book length) in a browser | unit threshold only |

## Checks for a human (about 5 minutes)

1. In Chrome, open a text, drag-select a sentence, press Shift+H: it is highlighted. Reload: it is still there. Open the Notebook: it is listed.
2. Select the same sentence and press Shift+H again: the highlight is removed. Choose another colour: it recolours.
3. Add a note to another sentence, reload, edit it, delete it.
4. Sign in is not required. In a second browser profile open the same text: the first profile's marks are not visible there (they belong to the first reader).
5. On a phone or tablet: long-press a word, extend the selection, use the toolbar. Report whether the toolbar appears, where, and whether the selection survives tapping it.
6. Triple-click a paragraph in Safari if available and report whether the highlight covers exactly that paragraph.
