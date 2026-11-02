# Google Cloud, Gemini, Vertex AI, ADK and agents: independent architecture proposal (2026-11-02)

**Status: proposal only.** Nothing was connected, contracted or built; no Google Cloud account, project, key or billing was touched. Prices were read on 2026-11-02 from [Google's Gemini pricing page](https://aistudio.google.com/docs/pricing) (official) and from secondary sources where marked; they change, so confirm before contracting. It is independent of the database work: it needs none of S0 to S4 in `docs/release/OPERATIONAL_CLOSURE_PLAN.md` except where stated.

## 1. Goals and non-goals

Goals: (1) let the owner choose the model provider per feature without rewriting the product; (2) use Gemini where it is better or cheaper; (3) add agents that do multi-step study work on a reader's own texts; (4) keep every principle in `docs/product/principles.md`.

Non-goals (the principles rule them out): a chat that answers from memory instead of from the saved texts; silent cloud sync of private imports; any answer without a checked pointer to the paragraph it came from; text leaving the device without a button press and an entry in `docs/privacy-and-providers.md`.

## 2. Where the code is today

- AI goes through the Vercel AI SDK (`ai` 7, `@ai-sdk/openai-compatible`) in `src/lib/ai/provider.ts`, to Together AI. Default model `openai/gpt-oss-120b` ($0.15 in, $0.60 out per million tokens, from the price table in the code); embeddings `BAAI/bge-base-en-v1.5`; transcription `openai/whisper-large-v3`.
- The operator can already point the provider at another OpenAI-compatible address (`GLOSS_TOGETHER_BASE_URL`). A reader may bring their own key (header, never stored).
- Around the provider are the parts that must survive any change: admission and daily allowances (`aiAdmission.ts`), a global budget with reservations and a ledger (`ai_ledger`, `ai_reservations`, `ai_leases`), one generation at a time per reader, deadlines inside Vercel's 60 s function limit, and the evidence check that verifies every cited quote against the document (`src/lib/ai/evidence.ts`).
- The model is an input to the ledger through a price table, so a new provider also needs prices there.

## 3. Target architecture

```
 Reader's browser
      | (button press; same routes as today)
      v
 Next.js on Vercel  ---------------------------------------------+
   admission, allowances, budget ledger, evidence check          |
   AI port: generate / stream / embed / transcribe               |
      |                |                      |                   |
      v                v                      v                   v
  Together adapter   Gemini adapter       Agent client        Neon Postgres
  (today)            (Vertex, keyless)    (signed call)       (+ pgvector later)
                          |                    |
                          |                    v
                          |            Cloud Run: ADK agent service
                          |            (read-only tools, step and time limits)
                          v                    |
                 Gemini on Vertex AI  <--------+
                 (regional endpoint)
```

**Rules of the design**
1. **A port, not a provider.** One small interface (`generate`, `stream`, `embed`, `transcribe`, each returning text plus token counts) with a Together adapter (today's code) and a Gemini adapter. The AI SDK already ships Google providers (`@ai-sdk/google-vertex`, `@ai-sdk/google`), so the adapter is a thin layer, not a rewrite. Everything around it (admission, ledger, evidence check) stays in the product and is provider-blind.
2. **Provider per feature, set by configuration, with a safe default.** Together stays the default until a Gemini model passes the section 6 gates for that feature. The price table moves to configuration with model ids pinned.
3. **Keyless identity.** Vercel's OIDC token is exchanged through Google Workload Identity Federation for a short-lived credential of one service account; no JSON key is created, stored or pasted. Vercel documents this for all plans ([Vercel OIDC for GCP](https://vercel.com/docs/oidc/gcp)). The service account gets only the role to call models (and, for the agent service, to be invoked).
4. **Vertex AI over the Developer API for production.** Vertex gives IAM, quotas, audit logs, regional endpoints and Google's data-governance terms: customer data is not used to train models without permission, and caching and zero-data-retention are configurable ([data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)). The Developer API key route is acceptable only for the offline evaluation. Google has begun renaming the product (Gemini Enterprise Agent Platform), so the exact names should be confirmed when the project is created.
5. **Regional endpoint, not global.** The global endpoint may serve and cache from any region; a regional endpoint near the functions (`iad1`, Washington D.C.) keeps processing in place. Confirm the chosen model is offered in that region.
6. **Agents are a service, not code in the web function.** ADK for TypeScript ([google/adk-js](https://github.com/google/adk-js), Apache-2.0, Node 20.19+, `npm install @google/adk`) runs as a container on Cloud Run, which its CLI deploys to. Agent Engine support for the TypeScript kit was not confirmed, so Cloud Run is the plan. The kit was described as "mostly stable" before 1.0 in one source, so it is pinned and wrapped.
7. **Agents read; they do not write.** Their tools are the same read-only surface planned for the MCP server (Mission 06 section E): `search_library`, `get_document`, `list_annotations`, each filtered by the reader id the web app supplies, never by anything the model says.
8. **The product still checks the answer.** An agent's result goes through the existing evidence check before it is shown; a claim whose quote is not in the text is dropped, and "nothing found" is a valid answer.

## 4. Components

**4.1 Models.** Official list prices, per million tokens, standard tier (2026-11-02):

| Model | Input | Output | Note |
| --- | --- | --- | --- |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | cheapest; older generation |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | |
| `gemini-3.6-flash` / `gemini-3.8-flash` | $0.75 | $3.75 | **$1.50 and $7.50 from 2027-01-01** |
| `gemini-3.1-pro-preview` | $2.00 | $12.00 | preview; above 200k tokens $4 and $18 |
| `gemini-4-argon` | $2.00 | $10.00 | **$4 and $20 from 2026-12-01** |
| `gemini-2.5-flash` | $0.30 | $2.50 | deprecated; routed to 3.5 Flash-Lite on 2026-12-01 |
| `gemini-embedding-2` / `-001` | $0.20 / $0.15 | n/a | |

Together `gpt-oss-120b` today: $0.15 and $0.60. For this product's request mix, Gemini costs from 0.7x (2.5 Flash-Lite) to 16x (3.1 Pro) of today's cost per request. Two lessons: **prices and model lifecycles move fast** (a deprecation with automatic re-routing on 2026-12-01, two scheduled price doublings), so model ids are pinned and the price table is configuration; and **thinking tokens are billed as output**, so a thinking budget is set per feature.

**4.2 Embeddings and library search.** Fits Mission 06 section D (per-reader vectors in `pgvector`). Embedding model and dimension are stored per row, so a model change re-indexes instead of corrupting search. Gemini Embedding 2 costs $0.20 per million against about $0.008 for the current model: for 100 documents (0.65 M tokens) that is $0.13 once, so cost is not the reason to choose either; quality on the evaluation set is.

**4.3 Agents (candidates, in order of value and safety).**
1. **Study agent**: builds notes for a document by chunking, extracting, then verifying each item against the text (today's summary flow, as an agent with an explicit verify step).
2. **Library librarian**: answers "where did I read about X" with passages and anchors from the reader's own library; no free-form answer.
3. **Cross-text agent**: compares two or three of the reader's texts, quoting both.
Not proposed: web research or Google Search grounding by default, because it sends queries to a third service; it would be opt-in per request with its own entry in the privacy document.

**4.4 Limits that already exist and carry over:** 60 s function limit (an agent call has a deadline below it and degrades to the plain answer); one generation at a time per reader; the daily allowance counts an agent run as one question; the global budget reserves the worst case before the call and settles after it, with the agent's tokens summed from the service's report.

## 5. Security and governance gates (must hold before any Google call from production)

| Gate | Condition |
| --- | --- |
| X1 | A separate Google Cloud project for production; the billing account is owned by the owner; a **budget with alerts at 50, 90 and 100%** and per-model **quota caps** set before the first call |
| X2 | No service-account keys exist (`iam.disableServiceAccountKeyCreation` enforced); identity is federation only; the service account holds the minimum roles; audit logs are on |
| X3 | No secret in the repository or in logs; the existing redaction rules apply to the new adapter |
| X4 | The Google Cloud terms, the data-processing terms and the sub-processor list are reviewed by counsel; `docs/privacy-and-providers.md` and the privacy policy name Google as a provider for the features that use it, **before** any reader's text goes there |
| X5 | A regional endpoint is configured; caching and retention settings are chosen and written down |
| X6 | The untrusted-document fence and the evidence check run on Gemini and agent output exactly as on Together output; a prompt-injection test set is part of the evaluation |
| X7 | A reader's own key and the offline mode keep working; with the Google configuration removed, the product falls back to Together |
| X8 | Agent tools are read-only, filtered by the reader id in code, with a negative test that one reader can never see another's passage |
| X9 | Public-repository hygiene: no project id, account, address or credential in any committed file |

## 6. Phases, dependencies and objective go/no-go criteria

| Phase | Work | Needs | Go when (all measurable) |
| --- | --- | --- | --- |
| **P0** Port and evaluation harness (no Google account) | the AI port; Together adapter equal to today; an offline evaluation set of at least 100 cases (questions, summaries, translations, quotes that must verify, refusals, prompt-injection attempts) | none | all 1,126+ unit tests, integration and browser tests unchanged and green; Together output identical on a recorded sample; the harness reports citation validity, latency, tokens and cost per case |
| **P1** Gemini behind a flag, offline | Google project, federation, Gemini adapter; no reader traffic | X1 to X5, D4, D5 | on the evaluation set, for the chosen model: citation validity at least 98% and not worse than Together by more than 1 point; zero prompt-injection successes; p95 first token at most 2.5 s for margin answers and p95 total at most 25 s for summaries inside the 60 s limit; cost per 1,000 requests at most 1.5 times Together's (about $1.50) unless the owner approves more |
| **P2** Gemini for one feature, small share | one feature (for example translation) on a fraction of the shared-key traffic | P1 go, X4 signed off | 14 days: error rate under 1%, no budget breach, no privacy-document gap, quality metric not worse in a blind comparison on 50 samples |
| **P3** Embeddings and library search | `pgvector`, per-reader index, model id per row | Mission 06 D, a database plan that holds it, S4 done | the 80% top-5 retrieval target of that design on its fixed set; zero cross-reader results in the negative tests |
| **P4** First agent (study agent) on Cloud Run | ADK service, read-only tools, evidence check on output | P1 go, P3, X8 | the agent's cited items verify at least 98%; the step limit and deadline always hold; a killed agent degrades to the plain answer; cost per run within the owner's cap |
| **P5** Librarian and cross-text agents; MCP server | as above | P4 go, accounts and revocable sessions | Mission 06 section E criteria |

Each phase ends with a written report and the owner's approval before the next starts.

## 7. Estimated cost (USD a month)

Fixed: Google Cloud project, federation and IAM $0; Secret Manager under $1; Cloud Run for an agent service $0 to about $10 at low traffic (scale to zero; first-call cold start of a few seconds); logging within the free allotment at this volume. Variable (per 1,000 requests of the assumed mix: 80% margin answers of 3,000 input and 450 output tokens, 20% summaries of 8,000 and 1,500): Together $1.00; 2.5 Flash-Lite $0.66; 3.1 Flash-Lite $1.99; 3.5 Flash-Lite $2.85; 3.6 Flash $5.47, rising to $10.95 in 2027; 3.1 Pro $15.92. At 10,000 requests a month that is $10 (today) against $20 to $55 for the 3.x Flash-Lite and Flash models ($7 for 2.5 Flash-Lite); agents multiply tokens by the number of steps, so they are budgeted per run, not per request. Agent Engine's runtime (about $0.0864 per vCPU-hour and $0.009 per GiB-hour, free tier 50 vCPU-hours, from a secondary source) is not recommended first.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Price rises and deprecations (already scheduled) | pinned ids, configuration price table, a rule to re-run the evaluation before changing a model, alert on provider notices |
| Vendor lock-in | the port, Together kept as the default and fallback |
| Cost surprise from thinking tokens and agent loops | thinking budgets, step limits, reservation of the worst case in the ledger, Google-side budget and quota caps |
| ADK for TypeScript is pre-1.0 | pin the version, wrap behind the agent client, keep the plain flow as fallback |
| Privacy: reader text to a second provider | gate X4 before any traffic; button-press only; entry in the privacy document |
| More moving parts to operate | one Cloud Run service, one project, one dashboard; no second database |

## 9. Decisions for the owner

D4 provider strategy (keep Together by default and add Gemini, or replace); D5 billing account owner, monthly cap and region; whether web grounding is ever offered; who approves the Google terms (counsel); and whether agents may ever write (the proposal says no for v1).
