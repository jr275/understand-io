# Interaction inventory — what the reference does

Legend: **Observed** (seen in the live DOM or screenshots), **Inferred** (visible affordance, result
not observed), **Not observable** (requires an account, a key, or server internals).

## Landing (`/`)

| Interaction | Behaviour | Status |
| --- | --- | --- |
| Type/paste a URL and press Read (or Enter) | Imports the article and opens `/read/<slug>`; button disabled while empty. | Observed affordance; import result only observed via the user's screenshots (reader for an imported article) |
| "Open a PDF" | Opens a hidden `<input type=file accept=".pdf,.txt,.md,.markdown,…">`. | Observed |
| "Paste text" | Opens a paste-text flow; ⌘V anywhere also imports clipboard contents. | Inferred |
| Sample chips (Huxley, Schopenhauer, Thoreau) | Link to the three sample readers with a cover thumbnail; tooltip shows title + author/year. | Observed |
| Signed in: "Continue *Title* 87%" + "Your library →" | Progress ring + link to the last text. | Observed (capture A) |
| Signed out with highlights: "Your latest highlights" desk | Quote tiles link to `/read/<slug>?hl=<id>`; "All N →"; footnote "These live in this browser only. Sign in". | Observed |
| Signed in: "How it works" | Three numbered step tiles. | Observed (capture A) |
| Footer "Keep your highlights on every device. Sign in" | Opens the Clerk sign-in modal (Google or email). | Observed |
| Topbar Aa / key / Library / avatar | Appearance popover, API key popover, library link, user menu. | Observed (user menu contents not observable) |

## Library (`/library`)

| Interaction | Behaviour | Status |
| --- | --- | --- |
| Stats line | "N texts · N topics · N hour(s) of reading · N in progress · N read". | Observed |
| "Add articles" | Opens `.add-panel` dialog: tab **Connect an agent** (MCP copy, "Sign in to connect" / connected list with Revoke when signed in) and **Save links manually** (textarea, one URL per line, "Drop its export here" for Pocket/Instapaper/Raindrop files, Save; bookmarklets "Read in Gloss" / "Save to Gloss"; "On a phone" details). | Observed; saving result not observable |
| Shelf / Topics switch | Shelf = bookcase of spines; Topics = grid of topic cards with art, count, minutes, mini shelf. | Observed |
| Search `/` | Filters the library. | Inferred |
| Arrange by Topic / Recent / Colour / Length | Reorders spines; Topic view groups with plank labels + bookend. | Observed affordance |
| Topic chips (with counts) + Reading now / Finished / Under 10 min | Filter the shelf. | Observed affordance |
| Click a spine (or arrow keys) | Book "comes down" in a 3D `.ob-stage` dialog: topic chip (change topic via select), favourite, remove, title, author, year · minutes, dek, tags, progress bar, **Start reading** / **Continue**, "Put it back (Esc)"; cover with ex-libris inside. | Observed |
| Spine styles | `data-style=label|sans|foil|bands`, `is-narrow|is-wide`, `data-light`, ribbon for in-progress, topic glyph, auto-fitted title size. | Observed |
| Starter cards (empty/sample library) | "Start with a few classics — Shelve them", "Save your own links", "Let your agent shelve for you". | Observed |
| Painted covers toggle (Appearance) | Generates a picture per text (~2¢ each). | Not observable |

## Reader (`/read/<slug>`)

| Interaction | Behaviour | Status |
| --- | --- | --- |
| Header | Source kicker (rubric dot + domain/source), title, dek, byline "Author · year", "N min read · N paragraphs", **Original ↗** link, **Gloss this text** card (B). | Observed |
| Blocks | Each paragraph `.blk` has a `.pnum` button ("Ask about ¶n", hover reveals a + bubble; numbers hidden unless **Numbers** is on). First paragraph has a drop cap. Types seen: `p`, `h2`, `note`. | Observed |
| Select text | `.lens` toolbar appears above the selection: **Ask** (type a question), **Explain**, **Simplify**, **More** (Define, Fact-check, Related, Counterpoint, Copy quote), **Highlight** (hover: yellow/green/blue/pink), **Add a note**. Selection becomes `.m-pending`. | Observed |
| Explain / Simplify / Ask | A `.gloss` article appears in the right margin (or as a bottom sheet under ~1180px), aligned to the anchor with an SVG leader + rubric dot; anchor text becomes `.m-gloss` underline. Body streams; first sentence is `<mark class=key>`; citations `¶n` jump to paragraphs; footer shows model, tokens, cost, Try again, Copy, Delete; follow-up input. Collapses to `.is-collapsed` summary when another is active. | Observed (free quota signed out) |
| Highlight colour | Wraps selection in `.m-hl[data-c]`; appears in Notebook and on landing desk; stored locally when signed out ("Kept in this browser"). | Observed |
| Add a note | Lens morphs into a textarea "A note, in your own words" (↵ to keep, Shift↵ newline). | Observed (saved note rendering not observed) |
| Composer (bottom, sticky) | "Ask about the whole text", `/` focuses, **Web** toggle (search the web, cited as [1]), send ↑. | Observed; answer not observed |
| Keyboard | `/` ask whole text · J/K next/prev paragraph · Enter ask current paragraph · [ ] prev/next gloss · B gloss this text · N notebook · F focus mode · Esc close/step back · ? this list. | Observed (Keys dialog) |
| Appearance **Look** | Theme Auto/Paper/Sepia/Snow/Night/Ink; Pen Vermilion/Cobalt/Moss/Graphite; Highlighter Yellow/Green/Blue/Pink; switches Numbers, Map (rail minimap), Focus, Listen; Painted covers toggle. | Observed |
| Appearance **Text** | Typeface Serif/Book/Sans/Legible; Size slider 15–28 with −/+; Spacing Snug/Even/Airy; Width Narrow/Even/Wide; Align Left/Justified; Paragraphs Spaced/Indented. | Observed |
| Appearance **Answers** | Answer length Short/Balanced/Detailed ("About a paragraph."). | Observed |
| API key popover | "Free use resets each day, and signing in doubles it. After that, answers need your key. Reading aloud always does." Quota bar "Free today N% left", password input `tgp_v1_…`, "Get a key on Together", Save. Key stored in the browser only. | Observed |
| Read aloud (headphones) | With Listen on, a headphones button "Read aloud from here" appears. Signed out without a key it shows a pill "Reading aloud uses your own Together key · Add key · ■". | Observed; the actual player, voice, sync and controls are **not observable** |
| Map (rail) | Left sticky minimap of paragraph bars (`role=slider`, "Position in the text"); shows above ~1180px. | Observed |
| Focus mode (F) | Hides chrome (`.focus-mode` rules hide rail, numbers, margin, `focus-hide` elements). | Observed via CSS; toggled state not captured |
| Notebook (N) | Right sheet `aside`: title, "N questions, N highlights", Copy/Download Markdown, tabs All/Questions/Highlights, cards (¶n, kind, time ago, quote, Q/A with "Read the whole answer", delete/remove), footnote about sign-in. | Observed |
| Toasts | `role=status` pill: "Kept in this browser. Sign in to have it on every device." / mobile hint "Select any passage to ask about it, explain it or highlight it." | Observed |
| Footer | ❦, "From <source>.", "Glosses are powered by DeepSeek V4.1 Flash, served by Together AI.", "Open your notebook", "Back to the library". | Observed |
| Scroll | Topbar shows the title centred after scrolling past the header; a rubric progress bar runs along the topbar bottom. | Observed (DOM) |

## Responsive behaviour

- Below `sm` (640px): topbar labels collapse to icons; "Read" label hidden; ⌘V hint hidden; `kbd`
  hints hidden; shelf scrolls horizontally; stats wrap.
- Below ~1180px: glosses render as a bottom sheet instead of the margin; rail hidden.
- Mobile reader shows a one-time hint toast and a full-width composer.

## Persistence observed

Signed out, everything lives in `localStorage`: `gloss:settings` (theme, pen, face, size, leading,
width, align, paras, marker, length, model, search, numbers, rail, listen), `gloss:v1` (glosses and
highlights per article with anchors `{start:{b,o}, end:{b,o}, quote}`), `gloss:nudge`,
`gloss:library-seen`. Signing in (Clerk) syncs to the account (not observable).
