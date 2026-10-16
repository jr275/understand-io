# Reference route inventory — usegloss.io

Audited 2026-10-16 with the built-in browser (signed out) plus two full-page captures the
user saved while signed in (landing page and library). Signed-in-only behaviour that was not
directly observed is marked **not observable**.

## Public routes

| Route | Status | What renders | Evidence |
| --- | --- | --- | --- |
| `/` | 200 | Landing: topbar, hero "Highlight any line. Ask it anything.", import bar, "Open a PDF" / "Paste text" / ⌘V hint, sample texts row (signed out) or "Continue … / Your library" line (signed in), "How it works" tiles (signed in) or "Your latest highlights" desk (signed out, once a highlight exists), footer "Keep your highlights on every device. Sign in". | live DOM + capture A |
| `/library` | 200 | Library: hero "Your library" + stats, "Add articles" button, Shelf/Topics switch, search, "Arrange by" sort, topic chips, bookcase with spines, plank labels, bookend, plant, pile; starter cards (signed out / empty); Topics grid view. | live DOM + capture B |
| `/read/on-a-piece-of-chalk` | 200 | Reader for the Huxley sample (Project Gutenberg). | live DOM |
| `/read/on-thinking-for-oneself` | 200 | Reader for the Schopenhauer sample. | sitemap + library |
| `/read/walden-reading` | 200 | Reader for the Thoreau sample. | live DOM (mobile) |
| `/read/<slug>` | 200 (any slug) | Reader shell; user-owned slugs look like `menlo-design-7ck5b` (title slug + 5-char id). Unknown slugs return the shell (contents not observed). | capture A link, probe |
| `/?url=<href>` | 200 | Bookmarklet entry "Read in Gloss" (imports the URL). | add-panel bookmarklet |
| `/?save=<href>` | 200 | Bookmarklet entry "Save to Gloss" (saves to library). | add-panel bookmarklet |
| `/read/<slug>?hl=<id>` | 200 | Deep link to a highlight from the landing desk. | landing desk tile |
| `/robots.txt` | 200 | Allows `/`, disallows `/api/` and `/mcp`. | curl |
| `/sitemap.xml` | 200 | Lists `/`, `/library`, the three sample readers. | curl |
| `/og.jpg?v=3` | 200 | Open Graph image. | meta tags |

## Routes that return 404

`/notebook`, `/sign-in`, `/sign-up`, `/pricing`, `/about`, `/privacy`, `/terms`, `/api/health`.
Sign-in is a Clerk modal on the current page, not a route.

## Server endpoints inferred (not directly observable)

- `/api/*` exists (robots disallow). Gloss answers stream from a model ("DeepSeek V4.1 Flash,
  served by Together AI"). Request shapes were not captured.
- `/mcp` — an MCP server that agents (Claude, ChatGPT, Grok) use to save links into a library.
  Protocol details not observed.
- Read-aloud ("Listen") requires the user's own Together key; the audio pipeline was not observable.

## Static assets observed

- `/library/icons/<topic>.webp` (science, philosophy, learning, agent, …) — topic glyphs.
- `/library/covers/<slug>.webp` — sample covers (on-a-piece-of-chalk, on-thinking-for-oneself,
  walden-reading, hamming-research, feynman-cargo, orwell-politics, sutton-bitter, karpathy-sw2).
- `/library/topics/<topic>.webp` — topic-card illustrations.

## Topic taxonomy (from the topic `<select>`)

ai, programming, infra (Infrastructure), data, security, tech (Tech & internet), design, product,
startups, business, work (Work & careers), economics, money, science, health, mind,
climate (Climate & energy), philosophy, history, politics (Politics & society), culture, writing,
learning, living, unsorted.
