# Activating keeple.me: domain, sign-in and mail

**Status: prepared, not executed.** keeple.me has not been confirmed as owned. No DNS was changed, no Vercel domain was added, no Google OAuth setting was touched, `APP_URL` in Production is unchanged, and nothing redirects. `BRAND.domain.verified` is `false` and a test (`tests/unit/brand.test.ts`) fails if a literal `keeple.me` address appears in the source.

This document adds the brand-specific items to [`docs/ops/domain-migration.md`](../ops/domain-migration.md), which remains the step-by-step procedure (order matters there: register the Google redirect first, change `APP_URL` second). Read that one for the order; read this one for what is new because of the name.

## What the code already does for the new domain

| Concern | Where it comes from | Change needed in code? |
| --- | --- | --- |
| Canonical URL, `hreflang`, Open Graph `url`, `metadataBase` | `APP_URL` (`lib/seo/site.ts`, `app/layout.tsx`) | none |
| Sitemap and robots (`host`, `Sitemap:`) | `APP_URL` (`app/sitemap.ts`, `app/robots.ts`); both stay empty or address-less when it is absent | none |
| Google redirect URI | `APP_URL` + `/api/auth/google/callback` (`lib/server/auth.ts`) | none |
| Cross-site request check | host of the request or of `APP_URL` (`proxy.ts`) | none |
| CORS | none: the API is same-origin and sends no `Access-Control-*` | none |
| Cookies | host-only (no `Domain`), `Secure`, `SameSite=Lax` | none, but see "What readers will notice" |
| Privacy and terms URLs | `/privacy`, `/terms`, `/legal/<doc>`, and `/pt-BR/...`; legal pages are served only after `GLOSS_LEGAL_PUBLISHED=1` | none |
| Product name, SEO copy, social card | `src/lib/brand.ts` | none |

So the code needs no change to go live on keeple.me. The work is configuration in four places the repository cannot change for the owner.

## Required changes, by system

### 1. Domain registration and DNS (owner)
* Confirm that keeple.me is registered to the owner. (Not verified here.) `.me` is a country-code domain; check the registrar's transfer lock and renewal rules.
* Vercel → project `understand-io` → Settings → Domains → add `keeple.me` and `www.keeple.me`; set the DNS records Vercel shows; wait for **Valid** and a certificate. The Vercel project keeps its name (renaming it changes the `*.vercel.app` alias and every script that names it; see the migration notes).
* Choose one primary host (apex `keeple.me` recommended) and redirect `www` to it, so there is one canonical address.

### 2. Vercel environment (owner or agent with the owner's go-ahead)
* `APP_URL=https://keeple.me` in Production, **after** step 3 below. Redeploy; the canonical address is fixed at build time.
* Repository variable `HEALTH_URL` and the external monitor: the new address.
* Preview deployments keep working with `APP_URL` unset (no canonical, no sitemap entries).

### 3. Google OAuth client (owner, Google Cloud Console → APIs & Services)
Existing client; do **not** create a new one and do not rotate its credentials.
* **Authorized redirect URIs:** add `https://keeple.me/api/auth/google/callback` (and `https://www.keeple.me/...` only if www will serve the app rather than redirect). Keep the old `understand-io.vercel.app` URI until the old address is retired.
* **Authorized JavaScript origins:** add `https://keeple.me`.
* **OAuth consent screen** (this is where the old name is still shown to people signing in):
  * App name: `Keeple.me` (was `Understand.io`). Changing the name of a published app can put it back into verification; do this early.
  * App logo, support email and developer contact: owner's choice (`BRAND.support.contactEmail` currently `jm@useclave.io`).
  * Application home page: `https://keeple.me/`; privacy policy: `https://keeple.me/privacy`; terms: `https://keeple.me/terms`. These pages exist in both languages but are served only once the legal texts are published.
  * **Authorized domains:** add `keeple.me`; keep `vercel.app` while the old address is live.
* Remove the old redirect URI only after a quiet period (step 9 of the migration checklist).

### 4. Email (owner), only when mail is introduced
Nothing in the product sends email today: sign-in is Google's, and there is no transactional or marketing mail. So there are no email templates to rebrand. When mail is added:
* Sender identity is `BRAND.email` (`Keeple.me`; the address is `null` until one exists on a verified domain).
* Set SPF, DKIM and DMARC for keeple.me at the provider before sending anything.
* Use a subdomain (for example `mail.keeple.me`) if the main domain will also receive human mail.

### 5. Legal and contractual (owner, counsel)
* The legal texts now say "Keeple.me (formerly Understand.io)" in English and Portuguese; the terms carry an explicit `LEGAL REVIEW` item for whether existing users must be told. `docs/legal/OPEN_ITEMS.md` was regenerated (20 legal-review items).
* Publish only with `GLOSS_LEGAL_PUBLISHED=1`, a separate gate.
* Third-party agreements and accounts that name the old product (Together AI account, Neon, Vercel team) are outside the repository; the owner decides whether to rename them. None needs to change for the product to work.

## What readers will notice, and what to say first

* **Cookies and the browser library do not move between addresses.** A signed-in reader signs in again on keeple.me and gets the same library (the account owns it). A reader who never signed in loses sight of the library kept in the old address's cookie and browser storage. Before redirecting, ask them to sign in with Google or download a backup (Library → Backup). The backup file keeps its original internal marker, so it restores in both the old and the new app.
* **Saved bookmarklets stop working after a redirect.** The "Read in Understand" / "Save to Understand" bookmarklet has the old address written into it and posts its message to that origin. After the old address redirects, readers must drag the new "Read in Keeple" bookmark from the Add panel. The app still understands the old message names, so a bookmarklet that is still pointed at a live address keeps working.
* The name on the Google consent screen changes only when the owner changes it (item 3).

## Order of activation (summary; details in `docs/ops/domain-migration.md`)

1. Prove ownership of keeple.me. Add it in Vercel and wait for Valid and a certificate.
2. Register the redirect URI and JavaScript origin in the Google client; update the consent screen.
3. Announce to anonymous readers (sign in or back up).
4. Set `APP_URL=https://keeple.me` in Production; redeploy.
5. Make keeple.me primary; redirect the old address to it.
6. Run `node scripts/domain-check.mjs keeple.me` and `node scripts/post-deploy-check.mjs https://keeple.me` (both read-only).
7. Update `HEALTH_URL` and the monitor; flip `BRAND.domain.verified` to `true` in a small commit so the record is honest.
8. After a quiet period, remove the old redirect URIs.

## Rolling back
Set `APP_URL` back to the old origin and redeploy; remove the redirect from the old domain. To undo the rename itself, revert this branch's commits or edit `src/lib/brand.ts` and the legal texts; no data, migration or credential depends on the name.
