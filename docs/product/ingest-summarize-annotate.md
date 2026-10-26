# Ingestion, summaries and annotations: inventory and plan

_Branch `feature/ingest-summarize-annotate`, started 2026-10-23 from `main` at `9bbf595`. Written before the code, from reading the code. Status words are the ones the brief uses. `main` and production are not touched by this work; see section 5._

## 1. Inventory (what exists, checked in source)

| Capability | Status | Evidence |
| --- | --- | --- |
| Upload PDF, TXT, Markdown | `EXISTS_AND_WORKS` | `api/import/file`, `lib/content/uploadKind.ts`, `pdf.ts` (page, char and time limits; a scanned PDF answers "That PDF has no selectable text… this app does not read text in images (there is no OCR)") |
| Import from URL (SSRF-safe, readable extraction, link-card fallback) | `EXISTS_AND_WORKS` | `api/import`, `lib/server/safeFetch.ts`, `extract.ts` |
| Paste text; captured page (bookmarklet) | `EXISTS_AND_WORKS` | `api/import/text`, `api/import/page` |
| **DOCX, EPUB, local HTML file upload** | `MISSING` | `classifyUpload` returns `unsupported`; no zip or docx library in `package.json` |
| **Several files at once, with a status per file** | `MISSING` | every picker reads `files[0]` |
| Importer behind one interface | `EXISTS_BUT_INCOMPLETE` | the route branches on `pdf` or `text` inline |
| Client-side duplicate check (address, text fingerprint) | `EXISTS_AND_WORKS` | `lib/store/duplicates.ts` |
| **Server-side duplicate check and idempotent retry** | `MISSING` | the server inserts whatever it is sent; the table has no content hash |
| Import status lifecycle | `EXISTS_BUT_INCOMPLETE` | an import is one request: the document exists only when it is ready. There is no pending record, so nothing can be "stuck processing" |
| Summaries: quick, executive, detailed, key ideas; concepts; comprehension questions; translation | `EXISTS_AND_WORKS` (never run against a live model) | `lib/ai/ops.ts`, `prompts.ts`, `results.ts`, `InsightsPanel` |
| Long texts: section chunks, ceilings, coverage stated, "summarize the rest" | `EXISTS_AND_WORKS` | `OP_LIMITS` (28,000 chars direct, 9,000 per chunk, 8 chunks, 110,000 total) |
| Evidence quotes checked against the document; claims labelled text, interpretation or external | `EXISTS_AND_WORKS` | `lib/ai/evidence.ts` |
| Results persisted per reader and document | `EXISTS_AND_WORKS` | `glosses.result` (jsonb) |
| **Study Notes mode** (outline, definitions, claims, relationships, takeaways, recall questions, glossary) | `MISSING` | concepts and questions exist as separate operations; there is no combined mode |
| **Which version of the text a summary was written for; stale detection; reuse of a compatible result** | `MISSING` | no content hash anywhere; every click regenerates |
| Highlight, underline, note; quote + context + offsets anchors; re-anchoring `ok/moved/orphaned` with an ambiguity margin; orphan UI | `EXISTS_AND_WORKS` | `lib/anchors/index.ts`, `MarginGlosses`, `Lens`, `annotations.spec.ts` |
| Marks persist across reloads and devices (with a database) | `EXISTS_AND_WORKS` | `store/library.ts`, `api/annotations`; ownership verified in `tests/integration` |
| Search the text of marks across the library | `EXISTS_AND_WORKS` | `lib/search/library.ts` |
| **A place in the Library to review, filter, open and remove marks** | `MISSING` | marks appear only as search results |

## 2. Plan (only the `MISSING` and `INCOMPLETE` rows)

**Ingestion**
1. `lib/content/importers/`: one `Importer` interface (`id`, `matches(name, type, head)`, `read(bytes, name)`) and a registry; PDF and text move behind it unchanged. New importers: `html` (local file, through the existing Readability path), `docx`, `epub`.
2. A bounded unzip (`lib/content/zip.ts`) on `fflate` (pure JavaScript, no dependencies, no install scripts): entry count, per-entry and total uncompressed ceilings checked against the central directory **and** against what actually comes out, so a lying header cannot expand past them. Tested with a crafted bomb.
3. DOCX: read `word/document.xml`, relationships (links) and core properties; headings, paragraphs, lists, emphasis and links become HTML and go through `blocksFromArticleHtml`, so the Reader sees the same block model as any other text. EPUB: container → package → spine order → each chapter through the same function; title, author, language from the package.
4. Kind stays `text` with `sourceLabel` = the file name: no new document kind, no schema change for formats.
5. Migration `0004` (additive, nullable `documents.content_hash`, index on `(reader_id, content_hash)`). The server computes the hash of the normalised text on save; the same text or the same normalised address for the same reader returns the existing document with `duplicate: true` instead of inserting. Old rows have no hash and are simply not deduplicated.
6. Batch: a small queue (two at a time, per-file state, cancel, retry) used by the library Add panel and the landing page; one file failing never removes another's result.

**Summaries**
7. `study` variant of the summary operation, built on the existing structured pipeline, so its evidence is verified by the same code. Sections: outline, concepts and definitions, claims and evidence, relationships, takeaways, recall questions, glossary.
8. A content hash of the text (SHA-256 of the normalised blocks, computed in the browser) stored in each result. A result whose hash differs from the current text is shown as "written for an earlier version" with Regenerate; a result without a hash (all existing ones) is shown as "version unknown", never as stale. A compatible result (same mode, same hash, same language) is reused instead of calling the model again.

**Annotations**
9. A "Marks" review in the Library: all marks grouped by text, filter by kind (highlight, underline, note), each with its quote, kind label (not only colour), open-at-passage and remove. Reads the same store; no second repository.

## 3. Deliberately not done

- No OCR (none exists; scanned PDFs keep the honest message).
- No job queue, background worker, event bus or vector store: imports finish inside one request and summaries inside one request, within the existing ceilings.
- No new summary table: results stay in `glosses.result`. The content hash lives inside the result, so summaries need no migration.
- "Save a summary as a personal note" as a second copy is not built: it would create exactly the redundant, AI-versus-author record the brief warns about. A saved summary is already a stored, retrievable result; Markdown export exists.
- No new connectors (RSS, cloud drives): the importer interface is the extension point.

## 4. Compatibility and rollback

Existing routes, response shapes, documents and results are unchanged; every new field is optional. Rolling back the code needs no data change. Migration `0004` is additive and nullable, so the previous application version runs against it.

## 5. Rollout constraint

The new save path writes `content_hash`, so **the migration must be applied before the code that uses it is deployed**. Production has a live database. Applying the migration and deploying are both left to you; nothing here does either. The branch is pushed so a Vercel preview can be built, and the preview has no `DATABASE_URL`, so it runs in local-only mode and cannot touch production data.
