# The cookie secret: where it is, what depends on it, and what rotating it does

`GLOSS_COOKIE_SECRET` is the one key behind every signature the app makes. Checked 2026-11-02 from the Vercel CLI (names and settings only; **no value was read, and Sensitive values cannot be read back by anyone**) and by a read-only probe of the live site. Nothing was changed.

## Verified state

| Question | Evidence | Status |
| --- | --- | --- |
| Does it exist in the environments that need it? | `vercel env ls`: `GLOSS_COOKIE_SECRET`, type Sensitive, in **Production** (created 15 days ago) and in **Preview** (separate record, 15 days ago); none in Development (no development environment variables exist) | verified |
| Is it usable in production? | In production the server refuses a secret that is missing, shorter than 32 characters or `change-me` (`src/lib/server/reader.ts`). A request that carries a cookie that cannot be valid reaches the signing code and gets 500 if the secret is unusable and 200 if it is usable. 12 such requests to `https://understand-io.vercel.app/api/documents` answered 200 each (no write, no cookie issued) | verified (tested against production, read-only) |
| Is it the same across deployments? | The variable is project-level for its environment: every production deployment built after it was created receives the same value. The five latest production deployments are 3 to 6 days old, the variable 15, so all of them have it. The 12 probes were answered by several instances. A byte-for-byte comparison of values is not possible (Sensitive) and is not needed | verified by configuration; equality of the bytes is not observable |
| Do Production and Preview share the value? | They are two records, so they can differ; the value cannot be read to compare. Cookies issued by a preview deployment are valid in production only if the two values were set equal | unknown, and not required (previews have no `DATABASE_URL`, are behind Vercel SSO, and use no real library) |
| Is analytics safe if it is absent? | `effectiveMode()` (`src/lib/server/analytics.ts`) turns analytics **off** when the key is missing, short or the example value: the collector answers `204` and `x-gloss-analytics: off`, writes nothing, the sign-in callback goes on, and one warning is logged without the secret. Unit tests for the three cases; and a real production-build start with the variable removed and `GLOSS_ANALYTICS=full`: landing 200, health 200, `/api/events` 204 `off`, **0 rows written**, no secret in the log. (The cookie routes themselves, for example `POST /api/reader`, answer 500 in that state, by design: they fail closed.) | tested locally on a production build; not tested against production |
| Is `/api/events` live in production? | No: it answers 404, because production runs `main` (57d9a76) and PR #12 is a draft. So no analytics code is running in production | verified |

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
