# Access, export and deletion of analytics records (`full` mode): technical design

**Status: design only. Nothing here is built, `full` mode is not switched on, and the consent policy is untouched.** This is what must exist, and be tested, before `GLOSS_ANALYTICS=full` is ever enabled (verdict C in `docs/release/FASE_8_REPORT.md`). Legal framing (LGPD arts. 18 and 19, GDPR arts. 15 to 21) is for counsel; the privacy policy draft marks it (`⚠️ LEGAL REVIEW`, section 3A). Dates and deadlines below are the engineering target, not a legal statement.

## What there is to find

In `full` mode every event row carries `actor = HMAC-SHA256(secret, "pseudonym:reader:" + readerId)`, truncated to 22 characters of base64url (132 bits), and `ref = HMAC(secret, "pseudonym:ref:" + code)`. The table holds no reader id, no e-mail, no address. Rows in `daily` mode carry a one-day hash of address, browser and day. Rows are deleted after 120 days.

So a person's records are exactly the rows whose `actor` equals the pseudonym of **a reader id they control**. Finding them needs (1) that reader id, and (2) the key that made the pseudonym.

## Who can ask, and how they prove it

| Requester | Proof | How the server learns the reader id |
| --- | --- | --- |
| Signed in | the session cookie (a verified signature of the account id) | account row, `accounts.reader_id` |
| Anonymous, same browser | the reader cookie (a verified signature of the reader id) | the cookie, verified by `verifyReaderCookie` |
| By e-mail to the operator | the operator checks the sender is the account's e-mail (the Google address on file) and asks them to sign in and use the self-service page; if they cannot, the operator looks up `accounts.email` and uses the script below | `accounts.reader_id` for that account |
| Anonymous, other browser or cookie lost | **cannot be served.** Nothing in a row identifies the person without the cookie. This is a stated limit, not a gap to close by guessing | n/a |

A request is never accepted on an e-mail address alone for an account the sender does not control.

## Design

### Self-service (preferred: the reader id never leaves the server)

Two routes under `/api/privacy/analytics`, same-origin only (`src/proxy.ts` already refuses cross-site writes), rate-limited per reader (5 an hour), `Cache-Control: no-store`:

- `POST .../export` returns a JSON file of the reader's rows: `at`, `event`, `route`, `props`, `channel`, `campaign`. **Not returned:** the `actor` value, the `ref` hash, the reader id, any other reader's data. It also returns the request id, the retention (120 days) and the oldest and newest row dates.
- `POST .../delete` (body must carry `confirm: true`): deletes the rows and answers with the request id and the counts, then **adds the reader to a suppression list** so later events are not recorded (otherwise the next page view recreates the data). Deletion is also what an objection (art. 18 IV / GDPR art. 21) triggers; it is one action.

The server computes the pseudonym from the verified cookie; the browser never sees it, so it cannot be used to look up another reader's rows (the route takes no identifier at all).

### Operator path (`scripts/analytics-dsr.mjs`, read-only unless `--execute`)

```
DATABASE_URL=... GLOSS_COOKIE_SECRET=... node scripts/analytics-dsr.mjs --account-email <e-mail on file> [--export out.json] [--delete --execute]
```
It resolves the account to its reader id inside the process (printing only an opaque handle, never the id), computes every pseudonym that reader id could have had (one per key version, below), prints counts per event and the date range, writes the export with the same fields as the self-service route, and with `--delete --execute` deletes in a transaction. Dry run is the default. It never prints the connection string, the secret, the reader id or an actor value.

### Verifiable deletion

1. Count rows for the pseudonym(s): `before`.
2. `DELETE ... WHERE actor = ANY($1) RETURNING id` in one transaction; the returned count must equal `before`, otherwise roll back and report.
3. Count again: `after` must be 0, else the request is marked `failed`, not `completed`.
4. Insert the suppression entry in the same transaction.
5. The receipt (request id, kind, counts before/after, finished-at, status) is shown to the requester and stored in the audit log.

What deletion cannot reach, and the owner must say so to the requester: Neon's restore history (6 hours on the Free plan, 7 days on Launch) still holds the rows until it ages out, and Vercel's request logs (addresses, user agents) are outside this table.

### Audit of the request (`privacy_requests`, new table, additive)

```
privacy_requests(id text pk, kind text ('export'|'delete'|'object'), channel text ('self-service'|'operator'),
                 subject_digest text,   -- HMAC of the pseudonym under a DIFFERENT key (GLOSS_AUDIT_KEY), so the log cannot be joined to the events table
                 requested_at timestamptz, completed_at timestamptz,
                 rows_before int, rows_after int, status text ('completed'|'failed'),
                 note text)              -- free text for the operator; never an e-mail address or a reader id
```
Kept for 5 years as the record that a request was handled (counsel to confirm the period), not subject to the 120-day purge. It holds no personal data beyond a digest.

### Suppression list (`analytics_suppressions`, additive)

`actor text primary key, created_at timestamptz` of the pseudonym of a reader who objected or deleted. The collector checks it (an indexed lookup) and drops the event. It is the only place a pseudonym outlives its events, and it holds nothing else; it is removed if the reader asks to be measured again. Document this in the policy: honouring an objection requires remembering that it was made.

## The hard cases

| Case | What happens | Limit to state |
| --- | --- | --- |
| **Before login.** Events recorded under an anonymous reader id, then the reader signs in. If the account is new, the reader id is *adopted*: same id, same pseudonym, all history is found. If the account already existed, `mergeReaders` moves the library to the account's reader id and **deletes the old reader id**, so the old pseudonym can no longer be recomputed | Fix in the merge: `UPDATE analytics_events SET actor = <new pseudonym> WHERE actor = <old pseudonym>` in the same transaction (the old id is known at that moment and never again). That keeps cohorts continuous and makes the history findable | rows written **before this fix exists** under a merged-away id cannot be attributed to anyone and simply expire in 120 days; say so. Without the fix, every returning user's pre-login history is unreachable |
| **Daily-mode rows** | the identifier is a one-day hash of address, browser and day; it cannot be recomputed without the visitor's address and agent on that day, and the operator does not keep them | cannot be exported or deleted by person; they expire in 120 days; the policy says daily mode is pseudonymous and not individually retrievable |
| **Several browsers, one account** | the account has one reader id, so all its browsers share one pseudonym and are found together | none |
| **Several accounts or readers for one human** | each has its own pseudonym; the requester must ask once per account (the operator script takes several e-mails) | the product cannot know they are one person |
| **Cookie cleared** | the reader id is gone from the browser; the person is a new reader; the old rows are unreachable by them | stated limit above |
| **Rows older than 120 days** | already deleted by retention (`pruneAnalytics`); the export says "records are kept 120 days" | none |
| **`ref` and campaign columns** | `ref` is a hash of a referral code, `campaign` and `channel` are from the operator's lists: neither identifies the reader | none |

## Keys: HMAC and rotation

The pseudonym today uses `GLOSS_COOKIE_SECRET` (`docs/ops/secrets-and-rotation.md`). For requests to survive a rotation, store a key id with each row and keep old keys as long as rows made with them can exist:

- add `GLOSS_ANALYTICS_KEYS` (`kid1:secret1,kid2:secret2`; the first signs, all verify) and a `kid` column (or a `kid:` prefix on `actor`, which needs no migration);
- a DSR tries every key in the list; a key is discarded only 120 days after it stopped signing;
- the self-service routes and the script compute `pseudonym(kid, readerId)` for each kid.

The separate key also stops a cookie-secret rotation from breaking analytics, and the reverse.

## Data minimisation notes

- The export contains only what the reader's own events say; it never contains another reader's rows or the pseudonym.
- The audit log and the suppression list hold digests and a pseudonym, never the reader id or an e-mail address.
- Nothing here needs a new cookie.

## Acceptance criteria (to build and test later)

1. Export for a reader returns exactly that reader's rows, with no actor value, no reader id and no other reader's row (fixture with two readers and marker strings).
2. Delete removes every row of that pseudonym (all key ids), reports `before = deleted` and `after = 0`, writes an audit row and a suppression row in one transaction, and a failure leaves everything as it was.
3. After a delete, new events from that reader are dropped; after "measure me again" they are recorded.
4. A request cannot read or delete another reader's rows by any parameter (the route takes none).
5. The merge rekey test: events before sign-in are found by the account's pseudonym afterwards.
6. A rotation test: with two keys configured, rows made under the old key are found and deleted; with the old key discarded they are reported as unreachable.
7. The script is a dry run unless `--execute`, never prints the URL, secret, reader id or actor value, and an unknown e-mail changes nothing.

## Size and order

About 3 to 4 days: the two tables and the migration (additive), the collector's suppression check, the merge rekey (one statement, its test), the two routes and a small page in the library, the script, tests. Do the merge rekey **first and alone**: it is the only part that is lost forever if it is late, because the old reader id is deleted at merge time.

## Owner decisions

1. Confirm the audit retention (5 years proposed) and the response target (counsel).
2. Whether the self-service page is wanted at launch or the operator script is enough for the first requests.
3. Approve the suppression-list approach (a pseudonym is kept to honour an objection).
4. Ship the merge rekey before `full` is ever enabled, even if nothing else is built.
