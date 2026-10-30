# Initial AI budget report

Prepared 2026-10-29. Model: `openai/gpt-oss-120b` on Together AI, reasoning effort `low`. Price table in the app (and in the estimates below): **US$ 0.15 per million input tokens, US$ 0.60 per million output tokens** ([computeprices.com](https://computeprices.com/providers/together-ai/models/gpt-oss-120b), [CloudZero](https://www.cloudzero.com/together-ai-pricing/)). These are aggregator figures: **confirm them on the Together invoice**, and if they differ set `GLOSS_PRICE_IN_PER_M` / `GLOSS_PRICE_OUT_PER_M`. The owner has confirmed the budget (**US$ 3 per day and US$ 40 per month, AI only**) and sets the spending limit in the Together panel; no financial setting was touched.

## What a question really costs (measured on production, 2026-10-30)

One request each, on the first 10 paragraphs (15,988 characters) of the bundled "Walden" sample, sent to the live site with the shared key (tokens as reported by the provider):

| Operation | Input tokens | Output tokens | Cost | Time |
| --- | --- | --- | --- | --- |
| Quick summary | 3,938 | 620 | **US$ 0.00096** | 12.9 s |
| Study notes | 4,091 | 1,037 | **US$ 0.00124** | 14.1 s |
| Margin answer (explain a passage) | **not measured**: see below | | estimate about US$ 0.0008 (2,200 in, 700 out) | about 3.6 s |

**A defect found while measuring, and fixed in this round.** The margin answer logged `in=0 out=0 cost=0` in production: the provider only reports usage on a streamed answer when asked (`stream_options.include_usage`), the app did not ask, so **the ledger charged margin answers about nothing** (one millionth of a dollar each) and the budget under-counted the most frequent operation. Fixed by asking for usage, and, when a provider still sends none, by charging an estimate from the characters sent and received rather than zero (tests in `tests/unit/ai-reliability.test.ts`). The fix is in this branch and **takes effect when it is deployed**; the margin cost above is an estimate until a real answer is measured after that (run `scripts/spend-report.mjs` or read `[usage]` lines).

Until the fix is deployed the ledger **under-reports** margin answers, so the US$ 3 / US$ 40 budget is not yet a reliable stop for them: the spending limit on the Together account is the real brake, and the owner should set it before the beta opens.

## What the budget reserves versus what is charged

A request first **reserves** its worst case (every call it could make, at its output cap, each asked twice), then is charged what it used. The reservation protects against concurrent requests overspending; it is deliberately large.

| Request | Reserved (worst case) | Typical real cost |
| --- | --- | --- |
| Quick summary, 10 paragraphs | US$ 0.0042 | US$ 0.00096 |
| Study notes, 10 paragraphs | US$ 0.0092 | US$ 0.00124 |
| Study notes, a whole 50,000-character essay | US$ 0.0325 | not measured (several calls; roughly US$ 0.005 to 0.015, an estimate) |
| Study notes, the largest text the app will read (8 sections) | US$ 0.0415 | not measured |
| Margin answer, long | US$ 0.0015 | about US$ 0.0008 (estimate) |

With the daily US$ 3 budget, at least 70 of the largest requests could be in flight at once, and about 3,000 typical questions can be charged in a day before the day's budget is spent.

## The limits, and the most they allow

| Limit | Value (configurable: `GLOSS_QUOTA_AI_*`, `GLOSS_BUDGET_*`) | Maximum per day at the typical cost (about US$ 0.0011) |
| --- | --- | --- |
| Visitor, per browser | 3 questions a day | US$ 0.003 |
| Visitors, per network address | 10 a day | US$ 0.011 |
| All visitors together | 300 a day | **US$ 0.33** |
| Signed-in account | 20 a day, one account | US$ 0.022 per account; **US$ 0.66 a month** |
| Concurrency | one generation at a time per user | |
| Global budget | US$ 3 a day, US$ 40 a month | the shared AI pauses for everyone when reached |

How anonymous identity resists a reset: the limit is per browser cookie, **and** per network address (10) **and** in total (300). Clearing cookies gives a new browser allowance but not a new address allowance, and the total cannot be raised by anyone. A determined person with many addresses can still use up the 300 visitor questions; that is bounded by the global budget and the provider limit. Sign-in costs the user nothing and raises their own limit to 20.

Worst case if everything is used: **visitors US$ 0.33 a day (about US$ 10 a month)**, signed-in users 20 a day each. A day cannot exceed **US$ 3** and a month **US$ 40** in the ledger's estimate, **once the margin fix is deployed**.

## How many people the US$ 40 a month covers

At about US$ 0.0011 a question the month holds about **36,000 questions**:

| People | Questions each a month | Cost a month (AI only) |
| --- | --- | --- |
| 100 | 40 | US$ 4.4 |
| 1,000 | 40 | US$ 44: **above the US$ 40 budget** |
| 1,000 | 10 | US$ 11 |
| 10,000 | 10 | US$ 110: above the budget |

Texts larger than the 10-paragraph sample cost more per question (study notes of a long essay cost several times more). The earlier model (US$ 0.00139 a question, weighted toward long texts) is the conservative one; the measured figure is for a medium text. Both give the same order of magnitude: **about 900 to 1,000 typical users fit in US$ 40 a month**; beyond that the budget, not the product, is the limit, and raising it is the owner's decision (price and margin).

## What protects the money, and where each piece is

| Protection | Where |
| --- | --- |
| Input size limits | `src/lib/ai/requestLimits.ts` (context 30,000 characters, history 24,000, body 600 KB, search 40,000, audio 5 MB); long texts are read in sections, at most 8 per request |
| Output limits | per-operation token caps plus room for the model's reasoning (`src/lib/ai/guard.ts`) |
| Time limit | provider deadlines (`DEADLINE_MS`); a request that exceeds it answers 504 and the lease is released |
| Retries | bounded: `PROVIDER_RETRIES`, at most 3 calls, never on a rejected key; an unusable answer is asked once more (the reservation counts both) |
| Per-user and per-address quotas | database-backed (`rate_hits`), counted atomically across instances; refused with **429** and a plain message that says when it renews and what to do |
| One generation at a time | a lease in the database; a second request gets 429 `busy-user` and does not spend the quota (so a double click or two tabs cannot bypass the limits) |
| Global threshold | daily and monthly reservations and charges in `ai_ledger`; at the limit the shared AI pauses (503 `budget`); the reader's own key still works |
| Usage ledger and visibility | `ai_ledger` (per hour: spend, tokens, requests, errors), `[usage]` log lines, `scripts/spend-report.mjs`, `/api/health` (`ai.budget`, errors) |
| Credits exhausted or provider refusal (402/429) | the reader gets a plain 502 with a fixed message (no 500, no provider text) and their question is given back; tested for `/api/ai` and the streamed margin answer |
| Database unreadable | fail closed: the shared AI refuses rather than spending unmetered |
| Hard stop | **the spending limit on the Together account**: the owner configures it; the app's ledger is an estimate |

## Owner actions on cost

1. Set the spending limit in the Together panel (suggestion: at or a little above US$ 40 a month).
2. After this branch is deployed, run one real margin answer and check the `[usage]` line (or `scripts/spend-report.mjs`) shows non-zero tokens.
3. Compare the first week's `scripts/spend-report.mjs` output with the Together invoice and, if they differ, set `GLOSS_PRICE_IN_PER_M` / `GLOSS_PRICE_OUT_PER_M`.
4. Revisit the budget when the number of active users nears 900.
