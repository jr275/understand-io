# Monitoring, alerts and costs

What watches the beta, what each signal means, and how to read what the AI has cost. Nothing here needs a paid monitoring product.

## The health check

`GET /api/health` (public, never calls the AI provider, so polling it costs nothing):

```json
{ "status": "ok", "reasons": [], "commit": "4962466", "environment": "production", "region": "iad1", "database": "ok",
  "ai": { "configured": true, "model": "openai/gpt-oss-120b", "budget": "ok", "errorsLastHour": 0, "requestsLastHour": 3, "allowancesShared": true } }
```

| Field | Meaning |
| --- | --- |
| `commit` | the first 7 characters of the commit that is live (set by Vercel). Compare it with `git log` after every deploy |
| `database` | `ok`, `down` (no answer within 3 seconds; HTTP 503) or `not-configured` (a preview or local run) |
| `ai.budget` | `ok`, `low` (80% of today's budget used or set aside), `exhausted` (the shared AI is paused) or `unknown` (no database) |
| `ai.errorsLastHour` / `requestsLastHour` | the shared AI's requests in the current UTC hour, and how many ended in a provider failure or a timeout |
| `reasons` | `database-down`, `ai-failing` (5 or more errors and at least half of the requests failed) or `ai-budget-exhausted` |

With `?strict=1` the answer is 503 whenever `reasons` is not empty, so a monitor can alert on it. It holds no secret and no amount of money.

## Alerts

| Alert | How |
| --- | --- |
| Database failure | `database-down` makes `/api/health` answer 503 |
| AI provider failure | `ai-failing` (and the log line `[ai] provider call failed: <status>`: 401 the key, 400 the model, 429 the provider's own limit) |
| Budget used up | `ai-budget-exhausted` |
| Delivery | `.github/workflows/health.yml` runs every 30 minutes against `https://understand-io.vercel.app/api/health?strict=1` (set the repository variable `HEALTH_URL` for another address, for example the final domain). A failing run is a failed workflow, and GitHub emails the people watching the repository: check **Watch → Custom → Actions** in your GitHub notification settings, and that scheduled workflows are enabled (GitHub pauses them after 60 days without activity in the repository) |
| Optional, in Vercel | Project → Settings → Notifications: deployment failures; Observability shows function errors and durations |
| Optional | any external uptime monitor pointed at `/api/health?strict=1` (a free tier of one is enough) |

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

## Reading the usage limits

* Per user and per day: rows of `rate_hits` (keys are hashes, so they cannot be read back to a person).
* In flight: `ai_leases` (who is generating now) and `ai_reservations` (money set aside); both expire by themselves.
