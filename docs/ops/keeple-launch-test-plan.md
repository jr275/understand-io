# Keeple launch: end-to-end test plan

Run it on **https://www.keeple.me** after the steps of `docs/ops/keeple-domain-and-sign-in.md` (domain, Google client, `APP_URL`, old-address redirect). Each row says what to do, what must be true, and what a failure points at. Automated checks (unit, integration, browser, CI) already cover the code; this plan covers what only the real domain, the real Google client and a real browser can show.

## 0. Before anything (read-only, scriptable)
| # | Check | Pass |
| --- | --- | --- |
| 0.1 | `node scripts/domain-check.mjs www.keeple.me` | DNS resolves, certificate valid, `http` redirects to `https`, `keeple.me` redirects to `www.keeple.me`, canonical shows the new address |
| 0.2 | `node scripts/post-deploy-check.mjs https://www.keeple.me` | health ok, cookies `Secure`/`HttpOnly`/`SameSite`, security headers, and "the Google sign-in redirect uses this address for the return" |
| 0.3 | `curl -sI https://www.keeple.me/api/auth/google` | `302` to Google with `redirect_uri=https%3A%2F%2Fwww.keeple.me%2Fapi%2Fauth%2Fgoogle%2Fcallback` (today it names the old address: that is the symptom) |
| 0.4 | `curl -s https://www.keeple.me/ \| grep -E "<title>\|canonical"` | title `Keeple`; canonical `https://www.keeple.me` |

## 1. Sign-in, accounts and session (needs a real Google account; use one that never signed in, then one that did)
| # | Do | Pass | Failure points at |
| --- | --- | --- | --- |
| 1.1 | New user: in a clean browser profile import one link, then **Sign in** | consent screen names **Keeple** (or the domain `keeple.me`, never `understand-io.vercel.app`); you return to `www.keeple.me`; the header shows the account; the link you imported is in the library | redirect URI not registered, `APP_URL` not switched, branding unverified |
| 1.2 | Existing user: another clean profile, sign in with the same Google account | the same library appears (documents, marks, notes) | account merge (`/api/auth/google/callback`) |
| 1.3 | Session persistence | reload; close and reopen the browser; `/api/auth/me` still answers the account; the cookie is `HttpOnly; Secure; SameSite=Lax` | cookie attributes, `GLOSS_COOKIE_SECRET` |
| 1.4 | Sign in started on the **old** address after its redirect exists | the redirect puts you on `www.keeple.me` first, and sign-in completes there | step 5 of the checklist missing |
| 1.5 | Logout | `Sign out`; `/api/auth/me` answers anonymous; the library of the signed-out browser is that browser's own reader | `/api/auth/signout` |

## 2. Reading, ingestion, AI (run in English, then in Portuguese)
| # | Do | Pass |
| --- | --- | --- |
| 2.1 | Paste one article link on the home page; press **Read** | the reader opens with the text |
| 2.2 | Paste three links, one per line, one of them invalid; **Read links** | three results, the invalid one skipped, the others imported; **Retry** works after switching a link to fail |
| 2.3 | A PDF by link; a PDF, a Word file and a text file by upload; pasted text | each is read; an unsupported link is saved as a link card with the reason |
| 2.4 | Reader: select a sentence; **Highlight**; **Underline** (Shift+U); a note; **Read aloud** (L) with pause, resume, stop | marks persist after a reload and appear in the library under Your marks; speech follows the sentence |
| 2.5 | AI: ask about a selection; make a quick summary (one of each only; it costs a little) | an answer written in the margin that cites paragraphs; an error is shown in words, not as a blank |
| 2.6 | Switch **EN/PT** on the home page, the library and the reader | everything switches with no English left in the interface; the reading position and open panel stay |

## 3. Backup and restore
| # | Do | Pass |
| --- | --- | --- |
| 3.1 | Library, **Back up**: download `keeple-backup-<date>.json` | the file opens as JSON with `"app": "understand-io"` (the format id, kept on purpose) |
| 3.2 | New browser profile: restore that file | documents, marks and notes return; a damaged or foreign file is refused with a reason |
| 3.3 | Restore a backup downloaded **before** the rename (old file name) | restores the same way |

## 4. Chrome extension (milestone 1; `extension/README.md`)
| # | Do | Pass |
| --- | --- | --- |
| 4.1 | `chrome://extensions`, Developer mode, **Load unpacked**, the `extension/` folder | loads with no error; permissions listed: active tab, context menus, scripting |
| 4.2 | On an article, click the toolbar icon, **Read this page in Keeple** | a Keeple tab opens and imports the page you were on |
| 4.3 | The same through the right-click menu, and with **Save this page** | the document lands in the library without opening the reader |
| 4.4 | A page behind a login that you can open | the text imported is the one you see |
| 4.5 | Block pop-ups for the site, repeat 4.2 | Keeple opens with the address filled in (the fallback); reading starts when you press Read |
| 4.6 | `chrome://extensions` page and the new tab page | nothing happens (not an ordinary web page) |

## 5. The old address
| # | Do | Pass |
| --- | --- | --- |
| 5.1 | `curl -sI https://understand-io.vercel.app/` | redirects to `https://www.keeple.me/` |
| 5.2 | `https://understand-io.vercel.app/library` and a `/read/<slug>` link | land on the same paths on `www.keeple.me` |
| 5.3 | The scheduled health workflow and the external monitor | green on the new address (`HEALTH_URL` set) |

## Stop conditions and rollback
Any failure of 1.1 to 1.4 means the `APP_URL` switch is wrong or incomplete: set `APP_URL` back to the previous origin and redeploy (nothing in the database depends on it); the old Google entries are still there, because they are removed only after a quiet period.
