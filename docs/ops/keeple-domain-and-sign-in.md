# Keeple: domain, sign-in and the old name (checklist for the owner)

The product is **Keeple**, served at **https://www.keeple.me**. The code now shows "Keeple" everywhere a reader can see a name (wordmark, titles, social cards, the Portuguese and English texts, the legal pages, the bookmarklet names, the downloaded backup and notes file names). The address and the Google sign-in screen are **not** code: they follow settings in Vercel and Google that only the owner can change. This page names each one exactly. The general procedure and the reasons are in `docs/ops/domain-migration.md`.

## Why sign-in still says "understand-io.vercel.app"

The server builds the Google redirect address, the canonical address and the social-card addresses from one variable, `APP_URL` (`src/lib/server/auth.ts`, `src/lib/seo/site.ts`). In Production it still holds the old Vercel address, so after sign-in the reader is sent back there, and Google prints that address on its consent screen ("Continue to …"). Nothing in the code has to change for the new domain; the variable and the Google client do.

## What was observed on 2026-11-04 (read-only, from outside)

| Check | Result |
| --- | --- |
| DNS | `keeple.me` and `www.keeple.me` resolve, and the zone's name servers are Vercel's: the domain is delegated to Vercel DNS |
| Certificate | `www.keeple.me`, Let's Encrypt, valid from 2026-11-03 to 2027-02-01 |
| Redirects | `http://www.keeple.me` and `https://keeple.me` answer `308` to `https://www.keeple.me/` |
| Serving | `https://www.keeple.me/` answers `200` with production commit `dd0a0f8` and `database: ok`: it is the same deployment as the old address |
| Title and canonical | `<title>Understand.io</title>` (this PR changes it) and canonical `https://understand-io.vercel.app` (`APP_URL`) |
| Sign-in | `GET /api/auth/google` on `www.keeple.me` sets its state cookie on `www.keeple.me` and builds `redirect_uri=https://understand-io.vercel.app/api/auth/google/callback`: the return goes to a host that never received that cookie, so **sign-in started on `www.keeple.me` cannot complete today** |
| Old address | `https://understand-io.vercel.app/` still answers `200` (no redirect configured) |
| Google client | which redirect URIs and origins it holds cannot be read without the Console: not verified |

## What to set (in this order; each step is the owner's)

| # | Where | Exact value |
| --- | --- | --- |
| 1 | Vercel, project settings, Domains | `www.keeple.me` (primary, valid certificate). Add `keeple.me` and set it to **redirect to** `www.keeple.me`. |
| 2 | Google Cloud, APIs and Services, Credentials, the OAuth web client | **Authorized JavaScript origins:** add `https://www.keeple.me`. **Authorized redirect URIs:** add `https://www.keeple.me/api/auth/google/callback`. Keep the old `understand-io.vercel.app` entries until step 6. |
| 3 | Google Cloud, Google Auth Platform, Branding | **App name:** `Keeple`. **Application home page:** `https://www.keeple.me`. **Privacy policy:** `https://www.keeple.me/privacy`. **Terms of service:** `https://www.keeple.me/terms`. **Authorized domains:** `keeple.me`. Add the support e-mail and the Keeple logo. Branding that changes the consent screen text may need Google's verification, which can take days: until then Google shows the domain, now `keeple.me`, instead of the old address. |
| 4 | Vercel, Production environment variables | `APP_URL=https://www.keeple.me` (origin only, no path, no trailing slash), then redeploy. Do this **after** steps 1 and 2: setting it earlier breaks sign-in. |
| 5 | Vercel, Domains, the old address | `understand-io.vercel.app`: **Redirect** to `https://www.keeple.me`. A sign-in started on any other host fails (its state cookie is host-only), so no reader is left on the old address. |
| 6 | After a quiet period | Remove the old redirect URI and JavaScript origin (`https://understand-io.vercel.app...`) from the Google client. |
| 7 | GitHub repository variable and the external monitor | `HEALTH_URL=https://www.keeple.me`; the monitor URLs in `docs/ops/monitoring-and-alerts.md` move to the same address. |

Check with `node scripts/domain-check.mjs www.keeple.me` (DNS, certificate, redirects, canonical) and then `node scripts/post-deploy-check.mjs https://www.keeple.me` (it proves the Google redirect now uses the new address).

## What still carries the old name, on purpose

* The Vercel project, the GitHub repository and the Neon projects keep their identifiers (`understand-io`): renaming them changes nothing a reader sees and would break deployment history and scripts.
* A backup file still says `"app": "understand-io"` inside (`BACKUP_APP`): that is the format's identifier, and changing it would make every backup already downloaded unreadable. Only the file name and the messages say Keeple.
* `docs/audit/`, `docs/release/`, `docs/quality/` and `docs/final-qa-report.md` are history and keep the name of their time.
