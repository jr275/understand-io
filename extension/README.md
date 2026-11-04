# Keeple for Chrome

Milestone 1 of the extension: send the page you are reading to Keeple. Plain JavaScript, no build step, no dependencies.

## What it does today
* A toolbar popup and a right-click menu: **Read this page in Keeple** and **Save this page to Keeple**.
* It runs the same handshake as the "Read in Keeple" / "Save to Keeple" bookmarklets (`src/lib/client/bookmarklet.ts`, received in `src/components/landing/ImportBar.tsx`): the page opens `https://www.keeple.me/?capture=read|save&url=...`, Keeple answers `understand:ready`, and the page posts its own HTML. Pages behind a login or a paywall you can open work, because the browser that is logged in is the one that sends the text. The two message names are protocol identifiers and stay unchanged so the bookmarklet and the extension remain interchangeable.
* Permissions: `activeTab`, `contextMenus`, `scripting`. No host permissions, no `<all_urls>`, no storage, no analytics. The page is read only after your click.

## Try it
`chrome://extensions` → Developer mode → **Load unpacked** → this `extension/` folder. Open any article, click the toolbar icon or right-click the page.

## Architecture
```
popup.html / popup.js ──message──▶ background.js (service worker) ──executeScript (MAIN world)──▶ page
right-click menu ───────────────▶ background.js                                                    │ window.open(keeple.me/?capture=…)
                                                                                                    ◀── "understand:ready" ── Keeple tab
                                                                                                    ── {type:"understand:page", html} ──▶ Keeple tab
```
Keeple checks the sender (`window.opener`), the origin of the captured address and the page size before it imports (`src/components/landing/ImportBar.tsx`, `POST /api/import/page`). The extension holds no credentials and no session: signing in and the library stay on keeple.me.

## Milestones
| # | Milestone | Needs |
| --- | --- | --- |
| M1 (this) | send the page: read or save | nothing on the server |
| M2 | send only the **selection** as text (`importText`), with the page's address as the source | a `understand:text` message in `ImportBar`, a size limit, a test |
| M3 | in-page **highlight and underline** of text you already saved: content script paints the marks of the saved document on the live page | a read-only endpoint for the reader's marks of one address, and the sign-in cookie (`host_permissions` for `www.keeple.me` only) |
| M4 | **read aloud** from the toolbar using the same speech layer as the reader (see `docs/product/read-aloud.md`) | the speech engine extracted to a shared module |
| M5 | options page: choose the address (production or a preview), language | `storage` permission |
| M6 | icons (16, 48, 128), privacy text, screenshots, Chrome Web Store listing and review | the owner's developer account and the privacy policy URL (`https://www.keeple.me/privacy`) |

## Before publishing
Icons are not added yet (Chrome shows a letter). Store review needs the single-purpose description, the permission justifications above, and the privacy policy URL. Test with `tests/unit/extension.test.ts` (manifest shape, permissions, protocol names).
