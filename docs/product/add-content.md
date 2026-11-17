# Adding content: every entry point, one pipeline

Adding a text is the first thing a reader does, so it is reachable from four places. None of them has an ingestion of its own: a link goes to
`POST /api/import`, a file to `POST /api/import/file`, pasted text to `POST /api/import/text`, a page captured by the bookmarklet to `POST /api/import/page`.
The client reaches them through one hook, `useImport` (`src/lib/client/import.ts`), and one field, `UrlField` (`src/components/ingest/UrlField.tsx`).

| Entry point | Where | After a link is added |
| --- | --- | --- |
| Link field | home page, in the first screen (`ImportBar`, label **Read**) | opens the reader |
| **Add content** | top bar on the home page and the library (an icon only on a phone and in the reader) | stays on the page; the field says what was added, with **Open** |
| **Add a source** | the library's card under the title, and the empty-shelf card | stays in the library; the shelf updates |
| Anywhere | paste (⌘V or Ctrl+V) or drop a file on any page | opens the reader / the batch panel |

The Add panel puts the two kinds of input in two named places: **Add a link** (the field, focused when the panel opens) and **Upload a file**
(buttons and the drop hint). Several links at once, the bookmarklets and the phone note stay below, under their own headings.

## What each can read (and nothing more)

* **A link** reads web pages, PDFs and plain-text or Markdown files. A link that serves anything else is not read: it is **saved as a link card** with
  the reason, and the page offers "Try reading it again", the original, and the other ways in. EPUB and Word are not read from a link, only as files.
* **A file** reads PDF, text (.txt), Markdown (.md), Word (.docx), EPUB and HTML (saved web pages). Anything else is refused with that list.
* The server fetches only public addresses on the standard web ports (80 and 443); other addresses are saved as link cards, never fetched.

## States of the link field

| State | What the reader sees |
| --- | --- |
| empty, button pressed | focus moves to the field (the button is never greyed out) |
| not an address | an explanation under the field once the reader tabs away, types more than a few characters or presses the button; nothing is sent. Another protocol (mailto:, ftp:) gets its own sentence |
| sending | "Fetching and reading the page…", the field locked, a progress line |
| failed (no connection, server error) | the reason in the page's language, the address kept, **Try again** |
| added / already in the library / saved as a link only | one sentence with the title and **Open** (stay mode); the field is cleared for the next address |

Duplicates are recognised twice: by address in the browser before anything is sent, and by text on the server.

## Languages

Everything above is in `en.ts` and `pt-BR.ts` under `ingest`, `add`, `library` and `srv`. Server answers stay English on the wire and are mapped to the
page's language by the catalog in `src/i18n/serverMessages.ts`.

## Tests

`tests/unit/urlProblem.test.ts` (what is said about an address), `tests/e2e/add-content.spec.ts` (all entry points, both languages, retry after a failed
request, the panel on a phone, axe), plus the existing import, library and link specs.
