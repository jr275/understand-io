# Security review

_Scope: the application code at HEAD, run locally against a development PostgreSQL. No production system, no shared database and no third-party service was touched or attacked. Probes were made only against this app on localhost, plus resolution of public hostnames for SSRF tests. Secret values were never printed; only names appear here._

## Method

1. Read every route handler, the proxy, the auth and cookie code, the content parsers, the fetch layer and the client code that handles untrusted data (full list of files in the review notes: 16 findings, SEC-1 to SEC-16).
2. Reproduced each finding with a script or a request before changing anything (for example: a 25 KB page nested 5 000 deep ran for more than 60 s; 10 MB of `<p>` took 18 s; a 30 000-page PDF killed the process; the Drizzle error text for a failed insert embedded the whole document).
3. Fixed in small commits, each with a regression test that fails on the old code, and re-ran the full suites.
4. A second, read-only pass re-checked every finding against the current code (not against commit messages) and recorded what remains. That pass found two gaps that were then fixed (the annotation routes still logged full driver errors; see SEC-11).

No P0 was found. No way to read, write or delete another reader's data by id was found.

## Threat model in one paragraph

Anonymous readers on the public internet, each identified by a signed cookie. The server holds an optional shared Together AI key, an optional Google OAuth client, and a PostgreSQL connection. The app fetches URLs on a reader's behalf and parses untrusted HTML and PDF. Attackers want to spend the operator's key, reach the operator's internal network through the fetcher, exhaust the server, read other readers' data, hijack sign-in, or run script in a reader's browser.

## Findings and current status

Statuses come from the second pass. "Partial" means the main harm is gone and a named residual remains.

| ID | Sev | Finding | Status | What was done / what remains |
| --- | --- | --- | --- | --- |
| SEC-1 | P1 | Server key usable as an open, unmetered LLM, embedding and Whisper proxy | PARTIAL | Per-reader and per-address sliding-window limiter (429 with Retry-After) on calls that spend the server key; zod bounds on quote, context, history (12 turns, 24 000 characters), search passages; transcribe 5 MB, audio types only, 30 s timeout; fixed provider error text. Residual: the limiter is in memory, so every instance has its own budget; there is no global spend breaker; the client address comes from `x-forwarded-for`, which is trustworthy only behind a proxy you control; `GET /api/gloss` still reports whether a server key exists |
| SEC-2 | P2 | No rate limits or body caps; unbounded anonymous storage | PARTIAL | Bodies are counted while they stream (url 16 KB, text 8 MB, page about 16 MB, file 25 MB, annotation routes 1.2 MB); string limits in every schema. Residual: no limiter on import, annotation, gloss or progress routes; each cookie-less request can still create a reader row, so anonymous growth is unbounded; no per-reader quota |
| SEC-3 | P2 | SSRF: DNS rebinding window, any port, status oracle | FIXED | Connect-time address validation inside the socket's own lookup (no check-then-use gap), ports 80 and 443 only, every redirect hop revalidated. Residual: a public host's status and timing are still visible through the error text (port scanning of public hosts on 80/443 only). No egress firewall: that is infrastructure |
| SEC-4 | P2 | Sign-in with another account's reader cookie destroyed or shared that account | FIXED | `planSignIn` never merges or adopts a reader owned by an account; `accounts.reader_id` unique (migration 0002). Residual: migration 0002 must be applied to any real database and fails if duplicate rows already exist; not run against production by design |
| SEC-5 | P2 | 10 MB HTML or 25 MB PDF parsed synchronously without bounds | FIXED | HTML: 4 MB, 50 000 elements, depth 200, checked in one linear pass; PDF: 500 pages, 3 million characters, 25 s deadline, page-at-a-time with yields. Residual: parsing is still on the main thread, there is no worker, and it was not load-tested in a deployment |
| SEC-6 | P3 | `/?url=` imported on a plain GET (drive-by library injection) | FIXED | links only fill the field; the reader presses Read |
| SEC-7 | P3 | Bookmarklet capture trusted any opener | PARTIAL | Requires a real opener whose origin equals the posted URL's origin and the `url=` origin; handshake posted to that origin only. Residual: the opener keeps a handle to the Understand tab and can navigate it (no COOP, no way to sever from the receiving side) |
| SEC-8 | P3 | CSRF rested only on SameSite=Lax | FIXED | `src/proxy.ts` refuses mutating `/api` calls with a cross-site Sec-Fetch-Site or a foreign Origin. Clients that send neither header pass by design. Content-Type is still not enforced. The proxy's behaviour on a production host was not observed |
| SEC-9 | P3 | No security headers | PARTIAL | nosniff, Referrer-Policy, Permissions-Policy (`microphone=(self)`), X-Frame-Options DENY, CSP limited to `frame-ancestors`, `base-uri`, `form-action`, HSTS in production only; article images load without a Referer. Residual: no `script-src`, `default-src` or `img-src`, because the theme bootstrap is an inline script; nothing contains a future XSS. Headers on a real production host or CDN were not observed |
| SEC-10 | P3 | SSRF address list gaps | FIXED | IPv6 parsed to 16 bytes; `::/96`, `::ffff:0:0/96`, `64:ff9b::/96`, 6to4, Teredo, `fec0::/10`, `192.0.0.0/24`, `198.18.0.0/15`, documentation and reserved ranges; non-addresses fail closed |
| SEC-11 | P3 | Raw upstream and exception text returned; full Drizzle error (SQL and document JSON) logged | FIXED | import routes show only deliberate messages; server-key provider errors are fixed text; save logs `code NNNNN` only; **annotation, gloss and progress routes now do the same** (this pass: the guard rethrew non-outage errors, so Next logged the driver error with SQL parameters including note text). The `documents/[id]` PATCH and DELETE routes now use the same guard |
| SEC-12 | P3 | Cookie design: one 2-year bearer cookie, weak secret policy, no domain separation | PARTIAL | production requires a secret of at least 32 characters and refuses `change-me`. Residual: the reader cookie still signs the bare id (a test pins that format), no `__Host-` prefix, no server-side revocation, a development fallback secret exists outside production |
| SEC-13 | P3 | `next` checked with `startsWith("/")`; `APP_URL` optional | FIXED | `safeNext` (single leading slash, never `//` or `/\`, conservative characters, 512 characters); production refuses to build redirect URIs without `APP_URL` |
| SEC-14 | INFO | upserts silently skipped foreign rows but answered `persisted:true`; bad `createdAt` gave a 500 | FIXED | 409 for a foreign id; timestamps validated |
| SEC-15 | INFO | slug uniqueness oracle | NOT A DEFECT | no cross-reader enumeration found |
| SEC-16 | INFO | remote images in articles, user key in localStorage | NOT A DEFECT | images fetched without Referer; remote images still reveal the reader's IP to the image host; the key in localStorage is by design and is sent only to this app's routes |

## Checked and found sound

- Ownership: every read, update and delete filters by `id` and `reader_id`. Another reader's id is a 409 on write and invisible on read. Ids are crypto-random.
- XSS: notes, quotes and answers render as React text; there is no `dangerouslySetInnerHTML` except the theme boot script; imported links are limited to http(s) and get `rel="noopener noreferrer"`.
- Secrets: every `process.env` read of a secret is in a server module. No client file imports one. `.env.local` is git-ignored and absent from history. The user's own key is never stored server-side and never echoed.
- SQL: all queries go through Drizzle with parameters. Lone surrogates and NUL are refused before the database.
- Dependency audit: `pnpm audit --prod` reports no known vulnerabilities.

## SSRF probes run (against the local app)

At baseline, 169.254.169.254, decimal 2130706433, `[::1]` and `0x7f000001` were answered 400 "Only public links can be read." over HTTP. The review also confirmed with the address check that `0177.0.0.1`, `127.1` and `0x7f.1` normalise to 127.0.0.1 and are flagged. After the fix, a port other than 80 or 443 (for example the black-hole port 81, which used to take 10.4 s to fail) is refused before any connection is made. A pinned-lookup unit test uses a real local listener and proves it is never contacted when the resolver returns a private address.

## What could not be tested here

- A real public deployment: HSTS, CDN header behaviour, `x-forwarded-for` trust, the Next proxy under production, TLS termination. The brief forbids deploying.
- Multi-instance rate limiting on a real deployment: the shared counter (`rate_hits`) is tested against PostgreSQL and with two simulated instances sharing one counter, not across real serverless instances.
- Google OAuth state and PKCE against Google (the pure parts are unit-tested).
- Behaviour against a hostile DNS server that really rebinds (the pinning is tested with a stubbed resolver and a local listener).
- Load and denial-of-service testing: not authorised and not done.

## Open security work, in priority order

1. Put the limiter on a shared store before running more than one instance, and add a daily spend ceiling for the server key.
2. Cap anonymous reader creation per address and add a per-reader row quota (SEC-2).
3. Add a `script-src` CSP once the theme bootstrap is moved to a nonce or hash (SEC-9).
4. Sign the reader cookie with a purpose label and add a `__Host-` prefix when it is safe to rotate existing cookies (SEC-12).
