# Product principles

_What every change to Understand.io is judged against. They come from what the code already does and from the defects the audits found; none is aspirational._

1. **Reading comes first.** The text is the product. A feature earns its place by helping someone read, remember or find something in a text they chose, never by adding a place to go that is not a text. Nothing opens over the page without being asked.
2. **A claim is checked, not trusted.** An answer, a summary or a search hit points at the paragraph it came from, and the app checks that pointer against the document itself (`lib/ai/evidence.ts`, `lib/anchors`). What the model says about its own sources is never the proof.
3. **Say what was not read.** Coverage is part of every result: which paragraphs were used, which were skipped, and "nothing found" when that is the truth. A confident empty answer is worse than an honest one.
4. **Nothing is faked.** No key, no answer: the app says "needs a key". A feature that is not built is not shown. A result from a model is labelled as one.
5. **The reader's data is the reader's.** The library, marks, questions and positions live in the browser first; the server mirrors them only when it can. Anything that leaves the device is named in `docs/privacy-and-providers.md`. The reader can always take everything out (backup, notebook export) and bring it back.
6. **Never lose, never duplicate, never overwrite.** Importing something already saved opens it. Restoring a backup only adds. A failed save is shown, not swallowed.
7. **Works offline, degrades without a database.** Reading, marking and searching the library need no network and no server. Features that need one say so where they are used.
8. **Keyboard and screen reader are first-class.** Every action has a keyboard path and a name; focus goes somewhere sensible when a panel closes; motion respects the system setting. What cannot be checked without a person is listed as unchecked, not as passed.
9. **Small and reversible.** Prefer a change that can be removed over one that reshapes the data. New stored fields are optional; a backup from an older version still restores.
10. **Evidence before claims.** A feature is "done" only with a test that fails without it and a look at it running. Where only a person can verify (sound, a screen reader, a phone) the documents say so (`docs/quality/verification-matrix.md`).

## What these rule out

- A "chat with your library" that answers from memory instead of from the saved texts.
- Silent cloud sync of texts the reader imported from private files.
- Scores, streaks and other pressure to read more.
- Features whose honest state cannot be explained in one sentence in the interface.
