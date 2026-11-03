# Monitoring, alerts and costs

What watches the beta, what each signal means, and how to read what the AI has cost. Nothing here needs a paid monitoring product.

> **Status, 2026-10-29: no external monitor is configured or tested.** What exists is the two health checks and a scheduled GitHub workflow that calls them (GitHub fires that schedule about every 6 hours in practice). Do not treat the site as monitored until the checklist under "Proving that alerts reach you" is filled in.

## The two health checks

There are two, kept apart on purpose. **Neither calls the AI provider, so polling costs nothing.** Only one of them can ever reach the database, and it is closed to the public.

### Liveness: `GET /api/health` (public)

The process is up, and this is the commit it runs. It touches no database, no store and no provider, whatever the request carries (a query string, a header, `?fresh=1`), so anybody may call it and nothing it does can wake a sleeping Neon compute. Use it for uptime monitors, deploy checks and "which commit is live".

```json
{ "status": "ok", "check": "liveness", "commit": "4962466", "environment": "production", "region": "iad1", "time": "2026-11-03T14:57:03.550Z" }
```

It answers 429 only past 600 calls a minute from one address (`GLOSS_HEALTH_RATE_PER_MIN`, `off` to disable): a guard on invocations, not on the database.

### Readiness: `GET /api/health/ready` (token only)

The database, the storage size and the AI ledger. It does not exist (404) unless `GLOSS_HEALTH_TOKEN` is set to 32 or more characters, and it answers only a caller that sends `Authorization: Bearer <token>` (401 otherwise, 429 after 30 attempts a minute from one address, valid or not). The token is never put in a URL. A caller without it costs the database nothing.

```json
{ "status": "ok", "check": "readiness", "reasons": [], "warnings": [], "commit": "4962466", "environment": "production", "region": "iad1", "database": "ok",
  "storage": { "usedMb": 41.2, "limitMb": 1024, "percent": 4, "level": "ok" }, "checked": { "at": "2026-10-30T04:23:42.255Z", "cached": true },
  "ai": { "configured": true, "model": "openai/gpt-oss-120b", "budget": "ok", "errorsLastHour": 0, "requestsLastHour": 3, "allowancesShared": true } }
```

| Field | Meaning |
| --- | --- |
| `database` | `ok`, `down` (no answer within 3 seconds per step and 8 seconds in all; HTTP 503) or `not-configured` (a preview or local run) |
| `ai.budget` | `ok`, `low` (80% of today's budget used or set aside), `exhausted` (the shared AI is paused) or `unknown` (no database) |
| `ai.errorsLastHour` / `requestsLastHour` | the shared AI's requests in the current UTC hour, and how many ended in a provider failure or a timeout |
| `storage` | the database size against `GLOSS_DB_STORAGE_LIMIT_MB` (default 1024, Neon Free's 1 GB): `level` is `ok`, `watch` (70% or more) or `high` (85% or more) |
| `warnings` | `db-storage-70`: informational, never changes the HTTP status |
| `checked` | when the database was last read and whether this answer reused that reading |
| `reasons` | `database-down`, `ai-failing` (5 or more errors and at least half of the requests failed), `ai-budget-exhausted` or `db-storage-85` |

With `?strict=1` the answer is 503 whenever `reasons` is not empty. It holds no secret and no amount of money.

How many times it can read the database, whoever asks (per instance): **one reading at a time** (concurrent callers share it); **at most one every 10 seconds** (`GLOSS_HEALTH_MIN_PROBE_SECONDS`), success or failure, so a down database is not hammered by its own checks and a leaked token has a ceiling; a healthy reading is **reused for 15 minutes** (`GLOSS_HEALTH_DB_CACHE_SECONDS`) so a monitor polling every few minutes does not hold a Neon Free compute awake; `?fresh=1` (exactly once, token only) skips the 15-minute reuse and nothing else; the whole reading is abandoned after **8 seconds**. A down database is read twice (one retry for a waking compute) per 10 seconds.

## Alerts

| Alert | How |
| --- | --- |
| Database failure | `database-down` makes `/api/health/ready` answer 503 (after one repeat; a failure is reused for at most 10 seconds, so recovery shows within 10 seconds; a failure can be up to 15 minutes late when the last reading was healthy) |
| AI provider failure | `ai-failing` (and the log line `[ai] provider call failed: <status>`: 401 the key, 400 the model, 429 the provider's own limit) |
| Budget used up | `ai-budget-exhausted` |
| Database filling up | `warnings: ["db-storage-70"]` at 70% (monitor on the text `"warnings":[]`), `db-storage-85` at 85% (strict answer 503) |
| Delivery | `.github/workflows/health.yml` runs every 30 minutes: liveness always, and readiness too when the repository secret `GLOSS_HEALTH_TOKEN` is set. It calls `https://understand-io.vercel.app` (set the repository variable `HEALTH_URL` for another address, for example the final domain). A failing run is a failed workflow, and GitHub emails the people watching the repository: check **Watch → Custom → Actions** in your GitHub notification settings, and that scheduled workflows are enabled (GitHub pauses them after 60 days without activity in the repository) |
| Optional, in Vercel | Project → Settings → Notifications: deployment failures; Observability shows function errors and durations |
| Optional | any external uptime monitor pointed at `/api/health` (liveness; a free tier of one is enough). To watch the database too it must send the `Authorization` header: Better Stack and similar can, a plan that cannot send headers can only watch liveness |

## Costs and tokens

Each answered AI request writes one line to the function logs and one row to the ledger, with no text and no key:

```
[usage] route=ai op=summarize:study key=server model=openai/gpt-oss-120b in=680 out=2558 cost_usd=0.00164
```

* **Logs:** Vercel → project → Logs, search `[usage]`; or `vercel logs --scope menlo6 --environment production --since 24h | grep "\[usage\]"`.
* **Ledger (the numbers the budget uses),** read-only, in the Neon SQL editor:

  ```sql
  SELECT left(period, 10) AS day, round(sum(spent_micro) / 1e6, 4) AS usd, sum(requests) AS requests, sum(errors) AS errors,
         sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
  FROM ai_ledger GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
  ```
* The cost is an **estimate**: tokens times the price table, or the prices you give in `GLOSS_PRICE_IN_PER_M` and `GLOSS_PRICE_OUT_PER_M` (copy them from the provider's pricing page). Compare the ledger with the provider's invoice once, and set the two variables if they differ. The hard limit is the spending limit on the provider's own account; set one.
* Requests that failed after the provider may have charged (a timeout, an unusable answer) are charged to the ledger at the amount that was set aside for them, so the ledger errs on the high side.

## External monitor (recommended, about 10 minutes, no code)

GitHub fires the scheduled `Health` workflow only about every 6 hours in practice, which is too slow for an alert. Add a monitor from outside, as a second layer (keep the workflow):

1. Create a free account at [UptimeRobot](https://uptimerobot.com) (5-minute interval) or [Better Stack](https://betterstack.com/uptime) (3-minute interval). Check the free plan's terms and limits on the vendor's page: third-party comparisons disagree on some details, and UptimeRobot's free plan has been reported as not allowed for commercial use.
2. Create an **HTTP(S) monitor** for `https://understand-io.vercel.app/api/health` (liveness), method GET, interval at the minimum, alert when the status is not **200**. Optional: also require the text `"status":"ok"`. For the database, add a second monitor on `https://understand-io.vercel.app/api/health/ready?strict=1` with the header `Authorization: Bearer <GLOSS_HEALTH_TOKEN>` (a 5-minute interval is safe: readings are reused, see above). The token goes into the vendor's header field, never into the URL.
3. Add yourself as an alert contact (e-mail; a phone push or SMS if the plan has it). Send the vendor's **test alert**.
4. Do not point it at a page that calls the AI: neither health check does, so the monitors cost nothing. Never add `?fresh=1` to a monitor.
5. After a domain change (`docs/ops/domain-migration.md`) update the monitor's URL.

An alert from the readiness monitor means: call `/api/health/ready?strict=1` with the token and read `reasons`; see `docs/ops/runbook.md`. An alert from the liveness monitor means the site itself is not answering.

## Reading what the AI has cost: `scripts/spend-report.mjs`

Read-only (one SELECT, nothing written, the connection string never printed). Run it with your own Neon connection string (Neon console → Connection details; do not store it in the repository):

```bash
DATABASE_URL='<your Neon connection string>' node scripts/spend-report.mjs 14
```

It prints, per UTC day, the estimated spend, the share of the daily budget, requests, errors and tokens, then the month against the monthly budget. It reads the limits from `GLOSS_BUDGET_DAILY_USD` / `GLOSS_BUDGET_MONTHLY_USD` if you set them in the same shell, else the defaults (3 and 40). The numbers are estimates; the provider's invoice is the truth. The same data can be read with the SQL in the previous section.

## Log retention

On this plan the platform keeps runtime logs for about an hour (observed), so yesterday's request logs are gone. **Nothing needs them for money**: the ledger (above) is the durable record of AI usage, and `/api/health` plus the external monitor cover errors. What is lost is the detail of an old error (status code lines such as `[ai] provider call failed: 429`).

A Vercel **log drain** (Team settings → Drains, to a destination such as Better Stack Logs or Axiom) keeps them longer, at a cost that depends on the volume and the destination plan: check the current price before enabling. The logs carry no reader text, key, cookie or password (an automated test checks it), so a drain is privacy-safe. **Recommendation for the beta: do not add one yet**; revisit if a problem cannot be explained without older logs. At the time of writing no drain is configured on the team.

## The two monitors to create (when you set the external monitor up)

| Monitor | URL | Alert when |
| --- | --- | --- |
| Availability | `https://understand-io.vercel.app/api/health` | the status is not **200** (the site is not answering) |
| Database and budget | `https://understand-io.vercel.app/api/health/ready?strict=1`, header `Authorization: Bearer <token>` | the status is not **200** (database down, AI failing, budget exhausted, or storage at 85%) |
| Early warning | the readiness URL | the response does **not contain** `"warnings":[]` (storage at 70%, or the site is down): a keyword monitor |

Together AI failures: `ai-failing` appears in `reasons` when 5 or more of the last hour's shared-AI requests failed and at least half of the requests did (a rejected key, a spent account, the provider down); the `/api/health/ready` answer then turns 503 under `?strict=1` and the Database and budget monitor alerts. The `[ai] provider call failed: <status>` log line says why (401 the key, 402 or 429 the provider's own limit, 400 the model).

## Proving that alerts reach you

Fill this in when the monitor exists. **An alert path is not working until a test alert has been seen arriving.**

| Check | How | Date | Seen by | Result |
| --- | --- | --- | --- | --- |
| External monitor created, interval at the vendor's minimum | the vendor's dashboard | | | |
| The vendor's own "send test alert" arrived by e-mail | the inbox (and the spam folder) of `jm@useclave.io` | | | |
| A real failure was detected: point the Availability monitor for a minute at a URL that answers 503, or pause the check and use the vendor's incident test | the vendor's incident list and the e-mail | | | |
| The GitHub `Health` workflow's failure e-mail arrived ("Run failed: Health"): run it from Actions → Health → Run workflow with the `url` input set to a 503 address | the inbox; GitHub → Settings → Notifications → Actions | | | |
| Spend notifications reach the owner (Vercel Spend Management 50/75/100%) | Vercel → Settings → My Notifications | | | |
| Neon compute and storage are looked at weekly (until a key lets the app read them) | calendar entry | | | |

## Spend reporting

`DATABASE_URL='<your Neon connection string>' node scripts/spend-report.mjs 14` prints the estimated AI spend per day and per month against the budget (read-only). Compare it with the Together invoice weekly during the beta. The Vercel and Neon costs are in their dashboards.

## Reading the usage limits

* Per user and per day: rows of `rate_hits` (keys are hashes, so they cannot be read back to a person).
* In flight: `ai_leases` (who is generating now) and `ai_reservations` (money set aside); both expire by themselves.
