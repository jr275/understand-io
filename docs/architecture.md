# Architecture

> **Status note (2026-10-17):** this file is the original plan. The as-built description is `docs/audit/runtime-architecture.md`; where they differ, that file is correct.

## Stack

- **Next.js 16.4 (App Router), React 19, TypeScript strict, Tailwind CSS v4** (`@theme` tokens +
  a small hand-written component layer that mirrors the reference class names so the DOM reads the
  same way: `.hero-title`, `.lib-*`, `.bk`, `.spine`, `.reader-grid`, `.blk`, `.lens`, `.gloss`, …).
- **Fonts** via `next/font/google`: Newsreader, Literata, Schibsted Grotesk, Atkinson Hyperlegible
  Next, exposed as `--nf-serif / --nf-book / --nf-sans / --nf-legible` exactly like the reference.
- **Icons**: `lucide-react` (the reference uses Lucide).
- **Persistence**: PostgreSQL through Drizzle ORM (`postgres` driver). Identity is an anonymous
  reader id in an httpOnly cookie (`gloss_reader`). The client keeps a local mirror in
  `localStorage` so reading, highlighting and settings work offline / without a database; the
  server is the source of truth when `DATABASE_URL` is configured.
- **AI**: Vercel AI SDK with an OpenAI-compatible provider pointed at Together AI (same vendor as
  the reference). Key resolution: per-request header `x-gloss-key` (user key kept in the browser) →
  `TOGETHER_API_KEY` env. No key → explicit "needs a key" response; nothing is faked.
- **Tests**: Vitest (unit) and Playwright (end-to-end).

## Directory layout

```
src/
  app/                    routes (App Router)
    page.tsx              landing  (/)
    library/page.tsx      library  (/library)
    read/[slug]/page.tsx  reader   (/read/:slug)
    api/…                 route handlers (import, documents, annotations, glosses, search, speech)
  components/
    chrome/               Topbar, popovers (Appearance, Key, Keys), toasts
    landing/              Hero, ImportBar, SampleRow, Desk
    library/              Shelf (bookcase), TopicGrid, OpenBook, AddPanel, chips/tools
    reader/               Reader, Block, SelectionLens, Gloss margin, Composer, Rail, Notebook,
                          ListenBar (TTS), VoiceSearch, AnnotationLayer
    ui/                   primitives: Segmented, Switch, Pop, Kbd, Tip
  lib/
    content/              block model, HTML→blocks (Readability + linkedom), PDF→blocks (unpdf),
                          text→blocks, sample documents
    anchors/              text anchoring (block id + offsets + quote context, re-anchoring)
    search/               tokeniser, BM25 lexical index, optional embedding rerank, query parsing
    speech/               sentence segmentation, Web Speech synthesis controller, recognition
    store/                client store (settings, documents, annotations, glosses) + sync
    db/                   drizzle schema, client, migrations
    ai/                   provider resolution, prompts, streaming helpers
tests/
  e2e/                    Playwright specs
  unit/                   Vitest specs
docs/                     specification and status
```

## Data model (Postgres, Drizzle)

- `readers(id, created_at)` — anonymous identity.
- `documents(id, reader_id, slug, title, author, dek, source_url, source_label, year, topic,
  kind: 'url'|'pdf'|'text'|'sample', minutes, blocks jsonb, created_at, updated_at)`
- `reading_progress(document_id, reader_id, block_id, ratio, updated_at)`
- `annotations(id, document_id, reader_id, kind: 'highlight'|'underline'|'note', color, note,
  anchor jsonb {start:{b,o}, end:{b,o}, quote, prefix, suffix}, created_at, updated_at)`
- `glosses(id, document_id, reader_id, action, anchor jsonb, turns jsonb, model, usage jsonb,
  created_at)`
- `settings(reader_id, data jsonb)`

Blocks: `{ id: "p1", type: "p"|"h2"|"h3"|"quote"|"note"|"li", n?: number, text: string,
runs?: [{text, em?, strong?, code?, href?}] }`. Ids are stable per document version; anchors
store offsets into the block's plain text plus the quoted string and 32 chars of prefix/suffix so
they can be re-anchored if the text shifts (fuzzy search by quote → nearest offset).

## Feature interfaces

```ts
// Shared reader context
interface ReaderApi {
  doc: Document; blocks: Block[];
  scrollToBlock(id, opts?): void; flashRange(anchor): void;
  selection: Anchor | null;
}
// TTS
interface SpeechController {
  state: 'idle'|'playing'|'paused'; rate: number; voice: SpeechSynthesisVoice | null;
  playFrom(blockId, offset?): void; playRange(anchor): void; pause(); resume(); stop(); restart();
  onSentence(cb: (s: {blockId, start, end}) => void): unsubscribe;
}
// Search
interface PassageSearch {
  query(q: string): Promise<{ hits: Hit[]; confidence: 'high'|'low'|'none'; mode: 'lexical'|'hybrid' }>;
}
interface Hit { blockId; score; excerpt; start; end; }
// Annotations
interface AnnotationStore {
  list(docId): Annotation[]; add(a): Annotation; update(id, patch); remove(id);
  subscribe(cb): unsubscribe;
}
```

The lens (selection toolbar) calls `AnnotationStore` and `SpeechController.playRange`; the voice
search panel calls `PassageSearch`, then `ReaderApi.scrollToBlock` + `flashRange`, and optionally
`SpeechController.playRange`. Switching documents disposes the speech controller and reloads the
annotation store for the new id, so positions and marks never mix.

## Request flow

1. `POST /api/import` `{url}` → server fetches, extracts with Readability, builds blocks, stores a
   document for the reader, returns `{slug}`. Files go to `POST /api/import/file` (PDF via unpdf,
   text/markdown parsed directly). Pasted text → `POST /api/import/text`.
2. `GET /read/[slug]` → server component loads the document (sample or DB) and renders the reader
   shell with the blocks; client hydrates annotations/glosses from the store.
3. `POST /api/gloss` streams an answer (`action`, `anchor`, `blocks` context, `length`).
4. Search runs in the browser: BM25 over sentence windows of the open document (`src/lib/search`). When a key is
   available the client sends the top 12 hits to `POST /api/search` `{q, passages}` to be re-ordered by embedding
   similarity; the answer can reorder hits but never raises the confidence label. No key: the lexical result stands,
   labelled "words only".
5. Annotations: `GET/POST/PATCH/DELETE /api/annotations`.
6. Speech: synthesis is browser-native; `POST /api/speech/transcribe` accepts audio (5 MB, audio types only) for
   server transcription when the browser recogniser is unavailable or blocked. It needs a provider key and answers 402
   `needs-key` otherwise.

## Environment

See `.env.example`. Nothing secret is ever shipped to the client; the user's own key is read from
`localStorage` and sent only as a request header to our own route handlers, which forward it.

## Running without a database

If `DATABASE_URL` is unset, route handlers return `{ persisted: false }` and the client keeps data
locally. The samples always work. Tests run against a local Postgres when available and skip the
server-persistence specs otherwise (reported as skipped, never as passed).
