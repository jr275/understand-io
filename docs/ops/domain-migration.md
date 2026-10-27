# Moving to the final domain

Prepared, not executed. **Do not change `APP_URL` in production until the domain is confirmed and working** (step 4).

## What depends on the address (checked in the code)

| Part | How it behaves | Consequence |
| --- | --- | --- |
| `APP_URL` | In production the server **refuses to start sign-in** without it. The Google redirect address is `APP_URL` + `/api/auth/google/callback` (`appOrigin` in `lib/server/auth.ts`) | it must be the final origin, with `https://` and no trailing slash |
| Google OAuth client | accepts only the redirect addresses and JavaScript origins registered for it | register the new ones **before** changing `APP_URL`; keep the old ones until the old address is retired |
| Sign-in cookie `gloss_oauth` | host-only, set on the address where sign-in **started**, path `/api/auth`, 10 minutes | the callback returns to the `APP_URL` host. **A sign-in started on any other host fails** (its state cookie is not sent to the callback host), so after the switch sign-in works only from the new domain |
| `gloss_reader`, `gloss_session` | host-only (no `Domain`), `HttpOnly`, `SameSite=Lax`, `Secure` | **cookies do not move between addresses.** A signed-in user signs in again on the new domain and gets the same library (the account owns the reader). A visitor who never signed in has the library only on the old address (and in a downloaded backup) |
| CSRF / cross-site check (`src/proxy.ts`) | a state-changing browser request must come from the host it was sent to, or from the `APP_URL` host | the new domain works as soon as it is attached; the old one keeps working while it stays attached |
| CORS | none: the API is same-origin only and sends no `Access-Control-*` header | nothing to change |
| HTTPS | Vercel issues certificates for attached domains; the app sends `Strict-Transport-Security` in production and the cookies are `Secure` | confirm the certificate is issued before switching |
| Canonical URL | the app sets no `<link rel="canonical">` and no `metadataBase` | two addresses serving the same pages are two copies for a search engine; decide on a redirect (below) rather than leaving both open to indexing for long |
| Reader pages | `/read/<slug>` are personal libraries and built-in samples | not meant to be indexed; consider `noindex` after launch (not done: no new features before launch) |

## Redirect policy for the old address (`understand-io.vercel.app`)

* **Recommended:** make the new domain primary and configure the old address to **redirect to it** (Vercel → Settings → Domains → the old domain → Redirect to the new one). It stops the sign-in failure above and the duplicate copy. Everyone then lands on one address.
* **Cost of redirecting:** a visitor who never signed in loses sight of the library they built on the old address (their cookie is on the old host). Before the switch, tell them to sign in with Google (it carries the library to the account) or download a backup in the library. At the beta's size this is a short message, not a project.
* **Alternative:** keep the old address live for a transition (no redirect), accepting that sign-in works only on the new domain, and redirect later.

## Steps

1. Choose the domain. In Vercel → Settings → Domains → **Add**; follow the DNS instructions (automatic if the domain is bought through Vercel). Wait until it shows **Valid** and has a certificate.
2. Google Cloud Console → APIs & Services → Credentials → the OAuth Web client: add `https://<new-domain>/api/auth/google/callback` to **Authorized redirect URIs** and `https://<new-domain>` to **Authorized JavaScript origins**. Keep the old ones.
3. Announce the change to people who use the site without signing in (sign in first, or download a backup).
4. **Only now:** set `APP_URL=https://<new-domain>` in Production, redeploy. (Setting it earlier would break sign-in on the old address.)
5. Make the new domain primary and set the old address to redirect to it.
6. Point the health workflow at the new address (repository variable `HEALTH_URL`).
7. Verify: `GET /api/health` on the new domain (commit, `ok`); sign in with Google on the new domain and check the library is the same; sign out; reload (the session survives); import a text; ask one question; the old address redirects.
8. After a quiet period, remove the old redirect URIs from the Google client.

## Rolling back

Set `APP_URL` back to the old origin and redeploy; remove the redirect from the old domain. Nothing in the database depends on the address.
