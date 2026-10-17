# Gloss reconstruction — product specification

## Goal

Rebuild the publicly observable Gloss experience (usegloss.io) as an independent application, then
add three features: **text-to-speech**, **voice-based semantic passage search**, and **text
annotations** (highlights, underlines, notes). Fidelity to the reference is the baseline; the new
features extend it without redesigning it.

## What Gloss is

A reading app. You paste a link (or a PDF, or text), Gloss turns it into a clean, numbered,
typographically careful reading view. Select any line and ask about it; an open model answers in
the margin, quoting and citing paragraph numbers. Texts are shelved in a library as books with
spines, grouped by topic.

## Personas and jobs

- A reader who wants to understand a hard text: select → Explain / Simplify / Ask.
- A collector who shelves articles and comes back: library, progress, topics.
- (New) A listener who wants the text read aloud and to ask aloud where something is discussed.
- (New) A student who marks up the text and wants those marks back next time.

## Scope — reproduce (verified observable)

1. Landing page with import bar (URL, PDF/text file, paste), sample texts, latest highlights desk,
   "How it works" steps, sign-in prompt.
2. Library: stats, shelf of spines grouped by topic with planks, bookend, plant, pile; topics grid;
   search; sort; filter chips; open-book dialog with Start reading / Put it back; add-articles panel
   (manual links, bookmarklets, agent tab copy).
3. Reader: header, numbered blocks, drop cap, selection lens (Ask, Explain, Simplify, More, Highlight,
   Note), margin glosses with leaders and citations, composer for whole-text questions, Notebook,
   Appearance (Look / Text / Answers), API key panel, Keys dialog, keyboard shortcuts, focus mode,
   rail minimap, five themes × four pens, four typefaces, reading progress.
4. Persistence of settings, highlights, notes and glosses across reloads.

## Scope — the three additions

- **Text-to-speech**: play/pause/resume/stop/restart, whole text or selection, sentence-level
  highlighting synchronised to speech, resume position, speed, voice and language choice, long
  documents, no overlapping sessions. Engine: browser Speech Synthesis first; server TTS evaluated.
- **Voice semantic search**: microphone with permission handling, real speech recognition, visible
  editable transcript, lexical + semantic retrieval over the current document's blocks, ranked
  results with excerpts, jump + highlight, read aloud the match, honest no-match / low-confidence.
- **Annotations**: highlights (4 colours), underlines, notes, edit/delete, robust anchoring (block id
  + offsets + quote context), persistence (local + server), per-document annotation view.

## Out of scope / not reproducible

- Clerk accounts and the exact sign-in flow (third-party). This build uses an anonymous reader
  identity cookie plus server persistence; a real auth provider is a documented follow-up.
- The MCP server for agents, "Painted covers" image generation, Pocket/Instapaper import parsing,
  web search inside answers (Fact-check), the proprietary prompts and models.
- Any server internals of the reference.

## Quality bars

- Visual: match typography, tokens, spacing, radii, shadows, motion and responsive breakpoints as
  documented in `design-system.md`.
- Honesty: no fabricated AI output; when a provider key is missing the UI says so, like the reference.
- Accessibility: keyboard reachable controls, ARIA roles mirroring the reference (toolbar, dialog,
  radiogroup, switch, slider, status).
- Tests: Playwright end-to-end on the primary flows; unit tests for parsing, anchoring, search and
  TTS segmentation.

## Decisions and assumptions

- Sample texts are the same three public-domain essays the reference ships (Project Gutenberg).
- LLM answers use an OpenAI-compatible endpoint (Together AI by default, as the reference does), with
  the server key or a user-provided key sent per request and never stored server-side.
- Database: PostgreSQL via Drizzle ORM. The app also runs without a database (local-only mode) so the
  reading experience never depends on infrastructure.

## Addendum: intelligent reading (second brief)

Principle: the reader reads, Understand.io helps to understand. Added on top of the reproduction and the three first additions:

- Open any readable link, PDF (also by URL) or text; the partner logo is not shown.
- Selection toolbar: Ask, Explain, Simplify, Translate, Summarize (the passage only), Highlight, Underline, Note, Copy quote.
- Understand panel: summaries (quick, executive, detailed, key ideas), key concepts, "Test me" questions, translation of a text part by part; results are stored with the document and say which paragraphs were read.
- AI honesty rules: quotes are checked against the text; a statement claimed to be from the text without a verifiable quote is shown as interpretation; the model's own labels (interpretation, outside the text, not in the text) are shown; coverage is stated; nothing is invented when the model cannot answer.
- Literal search inside the text with a section menu; "Back to where you were" after a jump; resume on reopening.
- Questions by voice or typing with answers in text and speech (explicit microphone, nothing recorded by the app).
- Not in scope: a knowledge graph, spatial maps, general memory, publishing, social features.

See `docs/evolution-report.md` for what was built per phase and what is not verified, and `docs/privacy-and-providers.md` for what is sent where.
