# Operational closure plan (2026-11-02)

For the owner. Nothing here has been executed: no service was connected, no resource contracted, no billing changed, no migration run, nothing merged or deployed. Evidence: `docs/ops/database-recovery-report.md`, `docs/ops/migration-0007-risk-review.md`, `docs/ops/neon-staging-runbook.md`, `docs/release/FASE_8_REPORT.md`, `docs/product/google-cloud-ai-architecture.md`.

## 1. Executive summary

- **The product is healthy and the code is ready.** Production serves commit `57d9a76`, database ok, 8.3 MB. PR #12 (Draft, head `52f7e14`) passed CI #34 and the three previews; it adds analytics (off by default), the SEO layer and migration 0007.
- **One thing blocks the migration: control of the database.** Production uses a Neon database that no reachable account lists, and there is no backup under our control. Merging PR #12 deploys production and applies 0007 automatically, so the merge waits for identity (G1), a restorable backup (G2) and a Neon-branch rehearsal.
- **0007 is low risk** (one new table, nothing existing touched, old deployment keeps serving if it fails), and reversible.
- **Google Cloud and Gemini are an independent, later track.** They are cheaper to start than to keep safe: model prices rise on 2026-12-01 and 2027-01-01. The proposal is a provider-neutral AI layer first, then Gemini behind a flag, with objective go/no-go metrics.
- **Critical path: S0 to S4 below.** Roughly 2 to 3 hours of the owner's time plus mine, $0.

## 2. Blockers, by kind

### Infrastructure

| ID | Blocker | State | Unblocked when |
| --- | --- | --- | --- |
| I1 | The Neon account that owns the production database is not identified | open; the endpoint is in none of the 3 visible projects; no recently-deleted project | G1: 4 of 5 fingerprints match (runbook) |
| I2 | No backup under our control; Neon Free restores 6 hours | open | G2: dump restored locally, every table's row count equal |
| I3 | The Neon-branch rehearsal of 0007 never ran | blocked by I1, I2 | 13 PASS with the pooled and 13 with the direct string; branch deleted |
| I4 | Neon Free limits (1 GB, 100 compute hours a month, 6 h restore) | accepted for now | owner chooses plan (D2) |
| I5 | `DATABASE_URL` is Sensitive: no one can read it back | by design | a copy is in the owner's vault whenever it is rotated |
| I6 | Two extra Vercel projects linked to the repository build on every push | open | owner disconnects or deletes them (D7) |
| I7 | Domain not chosen; `APP_URL` is the Vercel address | open | D8 |
| I8 | The rehearsal script's production guard was replaced by a fail-closed guard (endpoint id, five inputs, confirmation) with offline tests; the script also stops, changing nothing, on a database that already has 0007 | fixed on a local branch, **not yet published** | the owner approves publishing it; the owner follows runbook gate G6 |

### Product

| ID | Blocker | State | Unblocked when |
| --- | --- | --- | --- |
| P1 | Legal pages unpublished (404); privacy policy and terms are drafts | open; 25 owner decisions and 19 legal-review items (`docs/legal/OPEN_ITEMS.md`) | counsel signs off |
| P2 | Analytics activation: consent wording, mode, retention; access and deletion for `full` mode is design only | open | verdict C of the Fase 8 report flips |
| P3 | Five browser tests fail on a production build (fix `302569d` is on the Mission 06 branch, not in PR #12) | open | owner picks: cherry-pick into PR #12, or land with Mission 06 (D10) |
| P4 | Mission 06's draft migration is named `0007_...draft` | open | renumbered 0008 **and** journal timestamp later than 0007's (risk R4) |
| P5 | `/learn/ai-pdf-reader` is a draft (404 in production) | open | owner approves copy |
| P6 | Billing is not built; money measures print "not measurable" | later | billing provider chosen |

### Security

| ID | Blocker | State | Unblocked when |
| --- | --- | --- | --- |
| S1 | Any database credential that was ever displayed outside a password manager is treated as exposed and rotated | rotation status is tracked privately by the owner | owner confirms every rotation |
| S2 | Cookie secret rotation would strand anonymous readers' libraries and change every analytics pseudonym | accepted, documented | graceful rotation built, or the risk accepted in writing (D6) |
| S3 | No hard spending limit confirmed on the AI provider's own account | unconfirmed | owner sets the monthly limit there |
| S4 | No second human recovery path on the database account | open | second owner added (S2 below) |
| S5 | Public repository hygiene (no hostnames, e-mails, account or deployment ids) | applied to the report; the PR's other files contain only placeholders | rule kept for every public repository |
| S6 | Google Cloud, when it comes: no long-lived keys, budgets and quota caps, least privilege | design only | architecture gates (section 5) |

### Owner decisions

| ID | Decision | Needed by |
| --- | --- | --- |
| D1 | May merging PR #12 deploy production (it applies 0007)? | S4 |
| D2 | Neon plan: stay Free, or Launch (7-day restore, about $0 to $19 a month) | before analytics grows |
| D3 | Analytics mode (`daily` or `full`), consent wording, retention (120 days) and cap (5,000 a day) | before activation |
| D4 | AI provider strategy: keep Together as default and add Gemini as an option, or replace | S7 |
| D5 | Google Cloud billing account owner, monthly budget cap, region | S7 |
| D6 | Cookie secret: build graceful rotation or accept the risk | before any rotation |
| D7 | The two extra Vercel projects: disconnect or delete | any time |
| D8 | Public domain | before indexing |
| D9 | Who reviews the 19 legal items | before P1 |
| D10 | Order of PR #12 and Mission 06 | before S4 |

## 3. Execution sequence

| Step | What | Depends on | Who | Objective approval criterion | Cost |
| --- | --- | --- | --- | --- | --- |
| **S0** | Find the Neon login that opens the Understand.io project; send the project name and the account e-mail privately | none | owner | the project's endpoint list contains the production endpoint | $0 |
| **S1** | G1 fingerprints from the project's default branch (read-only `SELECT`s) | S0 | owner, with the health answer open | at least 4 of 5 match, none contradicts | $0 |
| **S2** | G2 backup, restored into a disposable local PostgreSQL; add a second owner; keep the connection string in the vault | S1 | owner | every table's row count equal; second owner listed | $0 |
| **S3** | Rehearsal on `staging-0007`, pooled then direct; delete the branch | S1, S2, gates G3 to G6 (I8) | owner runs the script, I read the output | 13 PASS twice; branch deleted; default branch size and endpoint unchanged | about $0 (a few compute hours) |
| **S4** | Merge decision and merge | S3, D1, D10, checklist of the risk review | owner decides; the merge applies 0007 | build log "migrations applied successfully"; journal has 8 rows; `analytics_events` has 0 rows; health ok; `post-deploy-check` passes | $0 |
| S5 | Analytics activation track (legal, consent, deletion design) | S4, P1, P2, D3 | owner and counsel | verdict C flips to YES | counsel's fees |
| **S6** | Provider-neutral AI layer and an offline evaluation set (no Google account needed); a separate branch, not PR #12 | none (can run during S0 to S3) | me | all existing tests pass; Together behaves bit-for-bit as before; evaluation harness runs offline | $0 |
| S7 | Google Cloud project, keyless Vercel identity, Gemini adapter behind a flag, evaluation against Together | S6, D4, D5 | owner creates the billing account; I write code | the metrics in `docs/product/google-cloud-ai-architecture.md` section 6 | see section 4 |
| S8 | Embeddings and per-reader vector search (Mission 06, D) | S4, D2, S7 or Together embeddings | me | retrieval target of that design met; zero cross-reader leakage in negative tests | cents to a few dollars |
| S9 | First ADK agent on Cloud Run, read-only tools | S7, S8 | me | agent gates of the architecture document | $0 to about $10 a month |
| S10 | MCP server for outside assistants | S8, accounts and revocable sessions | me | Mission 06 section E criteria | later |

The critical path to a safe merge is S0, S1, S2, S3, S4. S6 can run in parallel. Nothing after S4 should start before S4's verification passes.

## 4. Estimated cost (USD a month, list prices read on 2026-11-02; confirm before contracting)

| Item | Now | After this plan |
| --- | --- | --- |
| Neon database | $0 (Free) | $0, or Launch at about $0 to $19 for a 7-day restore window |
| Backup storage (dump, encrypted) | $0 | under $1 |
| AI provider (Together, `gpt-oss-120b`) | about $1.00 per 1,000 requests; provisional caps of $3 a day and $40 a month | unchanged |
| Gemini, same 1,000-request mix (4.0 M input and 0.66 M output tokens) | not used | 2.5 Flash-Lite $0.66; 3.1 Flash-Lite $1.99; 3.5 Flash-Lite $2.85; 3.6 Flash $5.47 (doubles to $10.95 on 2027-01-01); 3.1 Pro preview $15.92 |
| Embeddings, 100 documents (0.65 M tokens) | Together bge $0.005 | Gemini Embedding 2 $0.13 |
| Google Cloud project, identity federation, IAM | n/a | $0 |
| Cloud Run for an agent service | n/a | $0 to about $10 at low traffic (scale to zero) |
| Vertex Agent Engine runtime | n/a | not recommended first; about $76 for one always-on vCPU and 2 GiB, with a free tier of 50 vCPU-hours |

Request mix assumed: 80% margin answers (3,000 input, 450 output tokens) and 20% summaries (8,000 input, 1,500 output). Thinking tokens are billed as output and can raise the Gemini figures.

## 4a. Dependencies at a glance

`S0 -> S1 -> S2 -> S3 -> S4 -> S5`; `S6 -> S7 -> S8 -> S9 -> S10`; `S4 -> S8`; D4 and D5 gate S7; D1 and D10 gate S4.

## 5. What would stop the plan

Any gate that fails (a FAIL line, a fingerprint that contradicts, a restore that does not match) stops it and is reported with the output before anything else is tried. If no account can be found for S0, the fallback is an owner decision with data-loss implications and is described in the recovery report; no replacement project is created without it.

## 6. Not done by this plan

No merge, no deploy, no migration, no change to Vercel, Neon, Google Cloud or billing. PR #12 stays in Draft. Analytics stays off.
