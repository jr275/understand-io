# The cookie secret: where it is, what depends on it, and what rotating it does

`GLOSS_COOKIE_SECRET` is the one key behind every signature the app makes.

## Where it is configured

Which environments hold the secret, and whether it works in each, is checked by the owner and recorded in the private operations repository. In production the server refuses a secret that is missing, shorter than 32 characters or `change-me` (`src/lib/server/reader.ts`).

## What the secret signs

| Thing | Where | What a new secret does to it |
| --- | --- | --- |
| Reader cookie `gloss_reader` (`id.signature`, 2 years) | `reader.ts` | every existing cookie stops verifying: the browser has no reader |
| Session cookie `gloss_session` (90 days) | `reader.ts`, `auth.ts` | every signed-in user is signed out |
| Sign-in state `gloss_oauth` (10 minutes) | `auth.ts` | a sign-in in flight fails once ("the sign-in link was stale") |
| Analytics pseudonyms: reader actor, daily actor, referral-code hash | `analytics.ts` (`pseudonym()`) | every identifier changes (see below) |
| The anonymous allowance keys | derived from the reader cookie | an anonymous visitor gets a fresh allowance |

## Impact of a rotation (read from the code; a rotation was not performed or simulated in a browser)

1. **Anonymous readers lose their server library, silently.** The old reader id is in no browser any more. The server answers `GET /api/documents` with an empty list and `persisted: true` for a request without a valid reader, and the browser's sync (`syncRemoteLibrary`, `src/lib/store/library.ts`) takes `persisted: true` to mean "documents missing from the server were deleted elsewhere" and **removes the server-backed documents from the local library view**. The rows are still in the database under the old reader id, but nothing can reach them. Recovery is the reader's own backup file, or an operator who knows the old reader id and signs a cookie for it. This is the serious one.
2. **Signed-in readers keep their data**: their account owns the reader id. After the sign-out they sign in again and the library comes back. Until then their browser also hides the server-backed documents (same sync rule); the data is intact.
3. **Analytics continuity breaks at the rotation date.** All pseudonyms change, so old and new events of the same reader cannot be joined: retention cohorts reset (everyone looks like a new reader, D1/D7/D30/D90 fall, activation and "new readers" rise for a while), WAU/MAU double-count the week around the change, and the funnel's registration-to-first-save cohort splits.
4. **Data subject requests across a rotation.** A reader's old events can only be found by recomputing the old pseudonym, which needs the old secret. Throw the old secret away and those rows (up to 120 days of them) can no longer be exported or deleted by pseudonym; they would still expire on schedule. `docs/product/analytics-data-subject-requests.md` designs the key versioning that avoids this.
5. **Nothing else is signed with it**: no stored data is encrypted with it, so no stored data becomes unreadable. The AI ledger, documents, marks and accounts are unaffected.

## What to do instead of rotating today

- **Do not rotate casually.** There is no way today to rotate without item 1.
- **If it leaks, rotate anyway** (a leaked secret lets anyone forge a reader or session cookie for any reader id they know): announce it, tell readers to download a backup first (Backup in the library), and accept item 1 for anonymous readers. Signed-in readers are safe.
- **Recommended change (not made here; it touches sign-in):** a graceful rotation, with a `GLOSS_COOKIE_SECRET_PREVIOUS` that is accepted for verification and never used for signing, kept for the cookie lifetime; and a separate `GLOSS_ANALYTICS_KEY` with a key id stored with each pseudonym, so analytics can be re-keyed without touching cookies and old rows can still be found by their key id. Both are in the backlog of this phase; neither is needed to keep analytics off.
- A rotation is a change to the production environment: it needs the owner, and a new deployment to take effect.

## Owner items

1. Decide whether to build graceful rotation before anything but the owner depends on the library (it is the only way to rotate without stranding anonymous readers).
2. Keep a copy of the current secret in the owner's password manager; Sensitive Vercel variables cannot be read back.
3. If Preview deployments are ever used with real data, set the Preview value deliberately (equal or different) rather than by accident.
