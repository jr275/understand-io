# Design system — extracted from the reference

Source of truth: the reference stylesheet (`/_next/static/immutable/chunks/293zmod70a_mm.css`)
read through the browser's CSSOM, plus computed styles. Values below are the reference values and
are what this implementation targets.

## Typography

| Role | Family | Loaded as | Notes |
| --- | --- | --- | --- |
| Serif (display + reading default) | **Newsreader** (variable 200–800, italic) | `--font-serif: var(--nf-serif), "Iowan Old Style", Georgia, serif` | Optical size axis used: `opsz` 20/24/36/72. Wordmark: 21px, weight 440, tracking −0.018em, opsz 36. |
| Sans (UI) | **Schibsted Grotesk** (variable 400–900) | `--font-sans` | UI labels 11–14.5px. |
| Book (reading option) | **Literata** (variable 200–900, italic) | `--font-book` | |
| Legible (reading option) | **Atkinson Hyperlegible Next** (variable 200–800, italic) | `--font-legible` | |
| Mono | `ui-monospace, SFMono-Regular, Menlo, …` | `--font-mono` | `kbd` chips |

Reading controls (set on `<html>`): `data-face=serif|book|sans|legible`, `--read-size` 15–28px
(default 20), `--leading` (snug/even/airy → default 1.64), `--measure-k` (narrow/even/wide → default
32; measure `--m: min(calc(var(--read-size) * var(--measure-k)), 50rem)`),
`data-align=left|justify`, `data-paras=spaced|indented`.

Reader title: `clamp(2.6rem, 6.4vw, 4.3rem)`, weight 380, tracking −0.022em, leading 1.02, opsz 72.
Dek: `clamp(1.05rem, 1.7vw, 1.19rem)`, leading 1.55, `--ink-2`.
Library title `.lib-title`, hero `.hero-title` (two lines, `.hero-mark` wash + pen underline).

## Colour tokens

Themes are set with `data-theme` on `<html>`: `paper` (default/light), `sepia`, `snow`, `night`,
`ink`; `auto` follows the system. Pen colour via `data-pen`: `vermilion` (default), `cobalt`, `moss`,
`graphite`.

| Token | paper | sepia | snow | night | ink |
| --- | --- | --- | --- | --- | --- |
| `--bg` | #f6f3ec | #f1e6cf | #fdfdfc | #151412 | #0f1319 |
| `--bg-raised` | #fcfaf6 | #f7eedc | #fff | #1d1b18 | #161b23 |
| `--bg-sunk` | #ede8dd | #e7d9bb | #f1f1ef | #24221e | #1c222c |
| `--bg-pill` | #fffdf9 | #fbf5e8 | #fff | #34312b | #2c3441 |
| `--ink` | #1d1b18 | #33281b | #141518 | #e9e3d6 | #e3e8f0 |
| `--ink-2` | #4b463f | #5a4a36 | #45474d | #b6ae9e | #abb4c1 |
| `--ink-3` | #857e72 | #8c785c | #82848a | #878073 | #7a8594 |
| `--ink-4` | #aba394 | #ae9b78 | #abadb3 | #5b564d | #505a69 |
| `--rule` | #e5dfd2 | #e0cfad | #e9e9e6 | #2c2a26 | #232b36 |
| `--rule-strong` | #d3cab8 | #d1bd96 | #d7d7d3 | #3e3a34 | #303947 |
| `--hl` | #f2c43875 | #ecba326b | #fad23c6b | #f0c44633 | #f0c85033 |
| `--hl-strong` | #f2c438b3 | #ecba32a8 | #fad23ca8 | #f0c44657 | #f0c85057 |
| `--lens-bg` | #1d1b18 | #2e2418 | #141518 | #ece6d9 | #e3e8f0 |
| `--lens-fg` | #f3efe6 | #f4ead6 | #f5f5f4 | #191714 | #10141a |
| `--lens-mute` | #9a9285 | #a8957a | #8e9096 | #7d766a | #6c7685 |
| `--lens-hover` | #34312c | #463a2a | #2c2e33 | #d6cfbf | #c9d0db |
| `--good` | #3f7d4e | (paper) | (paper) | #79b98a | #7fbf95 |
| `--grain-opacity` | .045 | .06 | .02 | .035 | .03 |
| `--shadow-pop` | `0 1px 1px #281e140a, 0 14px 36px -14px #281e144d, 0 3px 8px -3px #281e141a` | (paper) | `0 1px 1px #0f141e0a, 0 14px 36px -14px #0f141e38, 0 3px 8px -3px #0f141e14` | `0 1px 1px #0000004d, 0 18px 44px -14px #000000a6, 0 3px 8px -3px #0006` | `0 1px 1px #00000059, 0 18px 44px -14px #000000b3, 0 3px 8px -3px #00000073` |
| `--shadow-card` | `0 1px 1px #281e1408, 0 10px 26px -16px #281e143d` | (paper) | `0 1px 1px #0f141e08, 0 10px 26px -16px #0f141e2e` | `0 1px 1px #00000040, 0 12px 30px -16px #0009` | `0 1px 1px #0000004d, 0 12px 30px -16px #000000a6` |

Dark themes also set `--hl-a: 24%`, `--hl-a-strong: 38%`, `--key-a: 19%` (light: 46% / 70% / 13%).

Pens (`--pen-l` light, `--pen-l-text`, `--pen-d` dark, `--pen-d-text`):

| Pen | light | light text | dark | dark text |
| --- | --- | --- | --- | --- |
| vermilion | #c1401b | #a9361a | #ef7a50 | #f28b65 |
| cobalt | #2c58c9 | #234cb4 | #86a8ff | #9bb7ff |
| moss | #3b7a3d | #316934 | #8fc68c | #a2d29f |
| graphite | #4b4a47 | #3a3936 | #cfc9bd | #ddd7cb |

`--rubric` = pen (light or dark variant per theme); `--rubric-text` likewise.
Derived with `color-mix(in oklab, var(--rubric) N%, transparent)`: `--rubric-line` 52%,
`--rubric-wash` 9%, `--rubric-wash-strong` 17%, `--rubric-key` `var(--key-a, 13%)`, `--selection` 18%.

Highlighter markers: `--mk-yellow #f2c438`, `--mk-green #7cc66f`, `--mk-blue #6aa8f0`, `--mk-pink #f084ac`.
Highlight spans: `.m-hl[data-c=yellow|green|blue|pink]` (`--mk`), gloss anchors `.m-gloss` (underline
`--ul: var(--rubric-line)`, active → `--rubric`), pending selection `.m-pending`.

Topic colours (`--c` on chips/spines): ai #5b4a9e, programming #2f4f8f, design #c0603a,
product #8a5a9e, business #7a5230, science #3a6b45 (deep #274a30), philosophy #5e4b7a (deep #3f3154),
learning #2c7a76 (deep #1c5654). Spine light text `#f6efe2`, dark text `#2a2520`.

## Spacing, radii, motion

- `--topbar-h: 60px`; topbar inner max-width 1400px (landing/library) / 1440px (reader), padding
  `px-5 sm:px-8` (landing) / `px-4 sm:px-6` (reader). Buttons 36px tall (`h-9`) pills.
- Library main: `max-w-[1180px] px-4 sm:px-8 pb-32`. Landing hero section `max-w-[980px]`, import bar
  `max-w-[600px]`.
- Reader grid `.reader-grid`: columns rail (`.rg-rail`), number gap (`.rg-numgap`), text column
  (`--m`), gutter (`.rg-gutter`, 64px leader lines), margin (`.rg-margin`, glosses). Main
  `pt-[calc(var(--topbar-h)+64px)] pb-10 px-4 sm:px-6`.
- Radii: import bar 18px / button 13px; popovers `.pop` 14–18px; cards 14–16px; lens 14px;
  segmented controls 10px outer / 8px inner; pills `rounded-full`.
- Easing: `--ease-out: cubic-bezier(.22,1,.36,1)`, `--ease-spring: cubic-bezier(.34,1.36,.64,1)`.
  Animations: `rise` (enter from below, 0.35–0.45s), `sheet-in` 0.38s (notebook), grain overlay on
  `body::before` with `--grain-opacity`.

## Iconography

Lucide icons (`lucide-*` class names in the DOM): library, key-round, keyboard, headphones,
notebook-pen, link-2, file-up, text-cursor-input, arrow-right, arrow-up, arrow-up-right, globe,
message-circle-plus, lightbulb, feather, ellipsis, highlighter, pen-line, chevrons-down-up,
rotate-ccw, copy, trash-2, x, search, layout-grid, chevron-left/right, plus, pilcrow, map, focus,
paintbrush, star, book-open, bookmark-plus. Custom SVGs: Gloss mark (three lines + rubric dot),
Together AI wordmark, bookend, plant, Claude/ChatGPT/Grok marks.

## Component hierarchy

- **Topbar** (`header`): wordmark; nav: Library link (landing/library)
  or reader tools (Shortcuts `?`, Read aloud, Appearance `Aa`, Key, Notebook `N`, Sign in / avatar).
- **Landing**: `.hero-title`, `.import-bar`, secondary actions, `.lib-line` (samples or continue),
  `.desk` (how-it-works steps `.desk-tile.is-step` or highlights `.desk-tile.is-quote` + `.is-room`),
  `.desk-foot`.
- **Library**: `.lib-hero` (`.lib-title`, `.lib-stats`, `.lib-add` with `.mark-stack`), `.lib-tools`
  (`.lib-switch`, `.lib-search`, `.lib-sort`), `.lib-chip-row` (`.lib-chip`, `.lib-n`, pagers),
  `.lib-screen` → `.bookcase` (`.plank`, `.plank-label`, `.bookend`, `.shelf-plant`, `.shelf-pile`,
  `.bk-x > .bk-y > .bk-in > button.bk > .spine[data-style=label|sans|foil|bands]`) or `.topic-grid`
  (`.topic-card`, `.topic-card-art`, `.mini-shelf`), `.starter` cards, `.lib-hint`.
  Open book `.ob-stage` (3D: `.ob-book`, faces, `.ob-page` with topic chip, title, author, dek,
  progress, "Start reading", "Put it back"; `.ob-cover` with `.cover` + ex-libris).
  Add panel `.add-panel` (tabs "Connect an agent" / "Save links manually", textarea, bookmarklets).
- **Reader**: header (source kicker, title, dek, byline, "Original" link, "Gloss this text" card `B`),
  `.prose-read` of `.blk[data-block][data-type=p|h2|note|…][data-n]` each with `.pnum` button and
  `.blk-text`; drop cap on `.blk.is-first`; footer (❦, source, model credit, buttons); sticky
  `.composer` ("Ask about the whole text", `/`, Web toggle, send); rail minimap (`role=slider`);
  margin `.gloss` articles (active / `is-collapsed` / `is-mini`) with SVG `.leader` lines.
- **Selection lens** `.lens[role=toolbar]`: Ask ▸, Explain, Simplify, More (menu: Define, Fact-check,
  Related, Counterpoint, Copy quote), Highlight (4 colour dots on hover), Add a note
  (`.lens-morph` textarea form).
- **Popovers** `.pop`: Appearance (tabs Look / Text / Answers), API key, Keys dialog (modal).
- **Notebook** `aside`: header, Copy/Download Markdown, tabs All/Questions/Highlights, cards.
- **Toasts** (`role=status` pill on `bg-lens`), **Read-aloud region** pill.
