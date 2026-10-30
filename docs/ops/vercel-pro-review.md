# Vercel Pro: what was checked, and what the plan does not protect against

Checked read-only on 2026-10-29 with the Vercel CLI session of the project owner. Nothing was changed, no secret value was read (the CLI shows variables as "Hidden/Sensitive"). Spend figures are the owner's to read in the dashboard.

## The right team and project

| Check | Result |
| --- | --- |
| Project | `understand-io`, team **`menlo6`** ("Menlo"), the project's account is that team |
| Plan | **Pro, in a trial period**: the trial ends **2026-11-01 (about 21:38 UTC)**; after it the team is billed (Pro is US$ 20 per seat per month, per [vercel.com/pricing](https://vercel.com/pricing); one seat today) |
| Members | one: the owner (role OWNER). Nobody else can change Vercel settings. **A push to `main` on GitHub deploys Production, so GitHub write access is also deploy access** (the repository is private on the free plan, so there is no branch protection or required review) |
| Git | GitHub repository `jr275/understand-io`, production branch `main`; a push to `main` builds and deploys Production; other branches get Preview deployments; **Git fork protection is on** |
| Two other projects on the same team | `understand-io-6ugt` and `understand-io-z8gn`: no variables, built on every push, no database. They use build time and add nothing: **recommend deleting them** (owner's decision; not touched) |

## Configuration reviewed

| Item | Value |
| --- | --- |
| Framework / Node | Next.js; Node **24.x** |
| Build command | `node scripts/vercel-build.mjs` (from `vercel.json`): applies database migrations **only** when `VERCEL_ENV=production`, then `next build`. A Preview never migrates |
| Region | functions in **iad1** (Washington, D.C.) |
| Compute | **Fluid Compute on** |
| Function duration | the platform default is 300 s on all plans; the routes set their own: `/api/ai` 300 s, `/api/gloss` 60 s, `/api/import` 45 s, `/api/import/file` 60 s, `/api/import/page` 30 s, `/api/search` 30 s, `/api/speech/transcribe` 60 s. The AI work also has its own deadlines and one retry round (`src/lib/ai/guard.ts`) |
| Skew protection | on, 12 hours |
| Deployment protection | Vercel Authentication is configured as "all except custom domains"; the public production address answers without a login (observed), as intended |
| Deployment retention | 30 days; the 10 latest deployments are always kept |
| Request body limit | 4.5 MB on Vercel Functions; the app's own limits are lower or equal (`src/lib/ai/requestLimits.ts`) |

## Production environment variables (names and age only)

`APP_URL`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GLOSS_COOKIE_SECRET`, `TOGETHER_API_KEY`, `GLOSS_CHAT_MODEL`, `GLOSS_REASONING_EFFORT`. All are **Production only** and **Sensitive** (their values cannot be read back, not even by the owner). `GLOSS_BUDGET_*` is **not set**, so the provisional **US$ 3 per day and US$ 40 per month** defaults apply (the owner confirmed those numbers). `GLOSS_QUOTA_*` is not set: the shipped defaults (3 questions a day for visitors, 20 for signed-in users) apply. Optional ones added in this round (`GLOSS_DB_STORAGE_LIMIT_MB`, `GLOSS_HEALTH_DB_CACHE_SECONDS`) have defaults suited to Neon Free; see `docs/ops/configuration.md`.

## Spend management: the hard limit, and what Pro does **not** do

**Pro does not stop extra usage charges by itself.** It includes a US$ 20 monthly credit; metered usage beyond the credit (function CPU and memory, invocations, data transfer beyond what is included, build minutes and so on) is billed. Seats, Marketplace integrations and add-ons are billed separately and **are not covered by the spend amount**.

[Spend Management](https://vercel.com/docs/spend-management) is available to Pro at no cost and is where a limit is set, by the Owner or a Billing role:

* **Where:** Team Settings → Billing → Spend Management → **On-Demand Budget** (or `vercel budgets` with Vercel CLI 59.23.0 or later; this machine has 59.5.0, so the current setting could not be read from here).
* **Notifications:** web and email at 50%, 75% and 100% of the amount; SMS at 100% when enabled.
* **Hard stop:** the switch **Pause Production Deployments** pauses production for **all projects of the team** when the amount is reached. While paused, **visitors get a 503 `DEPLOYMENT_PAUSED`** (including `/api/health`), and each project has to be resumed by hand. It is **not instantaneous** (Vercel checks every few minutes, so a little more can accrue), and it does not stop storage-type charges.
* **Whether it is set now: not known.** The owner should look at it.

**Recommendation for the beta (owner's decision, nothing was changed):** set an On-Demand Budget of a modest amount (for example US$ 20 to 30 above the plan), keep the email notifications on, and decide deliberately about Pause: with it on, an unexpected bill becomes an outage; with it off, an unexpected bill is possible and is limited only by the notifications and by how little this app uses. The AI cost, which is the large and variable one, is **not** on Vercel: it is on Together AI and has its own budget and ledger.

## What usage to expect on Vercel

The app is light on Vercel: pages are server-rendered or static, the AI call is the long function (seconds to a couple of minutes, mostly waiting for the provider, which Fluid Compute bills as little active CPU). The estimate used in the cost model (`docs/release/UNDERSTAND_FREEMIUM_LAUNCH.md`) is the US$ 20 plan, plus a few to a few tens of dollars of usage at 1,000 to 10,000 active users. These are estimates, not measurements: read **Usage** in the dashboard after the first weeks.

## Owner actions

1. Know that the **trial ends on 2026-11-01**: confirm the payment method and that you want Pro afterwards.
2. Look at Spend Management and set a budget and notifications (see above).
3. Delete the two duplicate projects when you decide to.
4. Keep the number of members at one, or give others the least role they need (no one else has access now).
