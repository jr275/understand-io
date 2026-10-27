# Operational runbook

_Written 2026-10-18. Commands were read from the Vercel CLI's own help and, where marked **exercised**, run during this work. Anything marked **not exercised** has not been run against this project. Facts about the live project: `docs/quality/phase-a-baseline.md`; variables: `docs/ops/configuration.md`._

## What runs where

- One Vercel project, `menlo6/understand-io` (id `prj_SgJkxEHGwUD9bjXABjUo8UIuxniC`). Git integration: a push to `main` builds a **production** deployment; any other branch builds a **preview**. The aliases `understand-io.vercel.app`, `understand-io-menlo6.vercel.app` and `understand-io-git-main-menlo6.vercel.app` all point at the current production deployment.
- The Vercel MCP connector is refused for team `menlo6`; use the CLI (`vercel … --scope menlo6`), which is logged in. **Exercised** for read-only commands.
- No monitoring, alerting or error-reporting service is attached. The only signals are the platform's request and function logs and the application's `console` output.

## Look first

```bash
vercel list understand-io --scope menlo6                  # recent deployments, status, environment (exercised)
vercel inspect <deployment-url> --scope menlo6            # aliases, build output (exercised)
vercel logs <deployment-url> --scope menlo6               # request logs (not exercised)
vercel logs --follow --scope menlo6                       # live runtime logs of production (not exercised)
vercel curl /api/documents --deployment <url> --scope menlo6   # request a deployment with protection bypass (not exercised)
```

Which commit a deployment holds: `vercel api "/v13/deployments/<host>?teamId=team_EMKkH0xLCssCo3OPQQ4bT4QH"` and read `meta.githubCommitSha` (exercised; run it in the background, it can take longer than a minute).

## Smoke test of a deployment

Replace `<host>` with the deployment URL (production or preview; for a protected preview use `vercel curl`).

| Check | Expect |
| --- | --- |
| `GET /` and `/library` | 200 |
| `GET /api/documents` | 200 and a JSON body; `"persisted":false` today because no database is configured; `Cache-Control: private, no-store` (after the Phase B release) |
| `GET /read/on-a-piece-of-chalk` | 200 (a built-in sample, needs no database) |
| `POST /api/import/text` with `{"text":"A.\n\nB."}` | 200 and a document (it is saved locally by the browser; with no database `persisted` is false) |
| `GET /api/gloss` | `{"serverKey":false,...}` until a key exists |
| `GET /api/auth/me` | `{"configured":false,...}` until Google is configured |
| Response headers | `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |

Library search, backup and restore are client-side: open `/library`, add a pasted text, and confirm the search box finds a word from it and the Backup panel downloads a file.

## Failure modes

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Every request that sets or reads the reader cookie answers 500 in production | `GLOSS_COOKIE_SECRET` missing, `change-me`, or under 32 characters | set a 32+ character secret, redeploy. Do not change a working one (it logs every reader out) |
| `persisted:false` where it should be true | `DATABASE_URL` unset, or the database is unreachable (the app reports an outage as `persisted:false` so the browser keeps its local copy) | check the variable; check the database service; look for `gloss: … database unavailable` in the logs |
| Saves answer 503 `database-unavailable` | connection-level database failure | readers keep their data in the browser and retry; fix the database |
| 500 `server-error` on a save | any other database error (the log line carries the error code, never the SQL or the reader's text) | find `gloss: … database error (code <code>)` in the logs; `42P01` means a migration has not been applied |
| 429 `quota` on AI requests | the reader used the day's allowance (3 for a visitor, 20 signed in, by default) | it renews at midnight UTC; a reader can sign in or add their own Together key; the operator can change `GLOSS_QUOTA_AI_*` |
| 429 `busy-user` | the same user has an AI answer being written | wait for it to finish (a lease expires by itself) |
| 503 `budget` on every AI request | the day's or month's budget is used up (`GLOSS_BUDGET_*`), so the shared AI is paused for everyone | check the spend (`docs/ops/monitoring-and-alerts.md`), raise the budget if the use is legitimate, or wait for the day to renew; readers with their own key are unaffected |
| 503 `unavailable` on AI requests | the database that holds the allowances cannot be read, so the shared key is not spent | check Neon (`/api/health` says `database-down`); nothing needs to be done to the AI |
| `/api/health?strict=1` answers 503 | `database-down`, `ai-failing` (most of the last hour's AI requests failed) or `ai-budget-exhausted`; the reasons are in the body | see the matching rows above; the scheduled "Health" workflow fails and GitHub emails the watchers of the repository |
| AI answers 502 and the log says `provider call failed: 400` | the model is not available serverless on this account (`model_not_available`) or the account blocks third-party models | list models with the key (`curl https://api.together.xyz/v1/models`), pick one that answers, set `GLOSS_CHAT_MODEL`, redeploy |
| A margin answer says "used up its room thinking" | a reasoning model spent the whole output cap thinking | try again or ask for a longer answer; set `GLOSS_REASONING_EFFORT=low` |
| 503 "busy" on AI requests | more than `GLOSS_AI_MAX_CONCURRENT` server-key calls were running on that instance | wait five seconds (`retry-after`), or raise the setting |
| 504 "took too long" on AI requests | the provider did not answer within `GLOSS_AI_TIMEOUT_MS` / `GLOSS_AI_STREAM_TIMEOUT_MS` (it was retried up to twice first) | try a shorter passage; check the provider's status; the log shows `[ai] provider call failed: <status>` |
| `[rate] shared counter unavailable` in the log | the `rate_hits` table is missing (migration `0005` not applied) or the database is slow | limits fall back to per instance; apply migrations / check the database |
| `[usage] route=… in=… out=… cost_usd=…` lines | one per answered AI request: operation, whose key paid, tokens, cost estimate (no text, no key) | sum them from the platform logs for a spend estimate |
| 429 on imports | the reader or address passed `GLOSS_RATE_IMPORT` imports in ten minutes | wait for `retry-after`, or raise or switch off the setting |
| 429 on AI calls | the server-key limits | wait, raise the limit, or the reader adds their own key |
| "needs a key" everywhere | `TOGETHER_API_KEY` unset | expected until you set it |
| Sign-in answers 503 | `APP_URL`, `GOOGLE_*` or `DATABASE_URL` missing | `docs/ops/configuration.md` |
| Build fails on Vercel | previously: esbuild's build script was undecided (fixed in `217cf7e`). Now also: "The database migration failed, so this build is stopped" | read the build log (`vercel inspect <url> --logs`). For a migration failure the current deployment is still live and nothing changed in the code that serves; check that `DATABASE_URL` is right and the database is reachable, then rebuild once. Do not start two production builds at once |
| A mark seems to have come back after being deleted on another device | the reader was split across two anonymous readers by overlapping first requests (R16) | fixed from the Phase B release on; an older browser tab keeps the old behaviour until reloaded |

## Rollback

**Application.** Vercel keeps every deployment. To return production to a previous one:

```bash
vercel rollback <deployment-url-or-id> --scope menlo6      # not exercised
vercel rollback status understand-io --scope menlo6        # not exercised
```

The last deployment known to work before this work: `understand-13ucxhsjk-menlo6.vercel.app`, built from `a13f28a`. Record the deployment you are leaving **before** promoting a new one.

**Git.** `main` is only ever advanced by normal commits and merges. To undo a release, `git revert -m 1 <merge commit>` and push; never force-push.

**Database.** There is no production database yet, so nothing to roll back. When there is one: migrations are forward-only (Drizzle has no down migrations) and the four existing ones are additive or create-only, so the previous application version runs against the newer schema. Take a snapshot before the first migration.

**Browser data.** Libraries live in each reader's browser. A deployment cannot change them. The Backup panel is the readers' own recovery path; it is additive only.

## Investigating a report from a reader

1. Ask for the text's address or title, the time, and the browser, not the text itself.
2. Reproduce on a sample text first (`/read/on-a-piece-of-chalk`), which needs no database.
3. `vercel logs` for the time window; the application logs error codes, not document contents, notes or quotes.
4. If it involves saved data, find out whether the reader is signed in and whether the deployment has a database: without one, saved data exists only in that browser.

## Remaining operational gaps

No shared rate-limit store, no automated alerting, no server-side backup, no staging environment with a database, and no CI before this release added one (`.github/workflows/ci.yml`; it has not run on GitHub yet).
