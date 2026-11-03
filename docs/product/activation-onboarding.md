# Activation and onboarding

**Status:** the measurement is built (events and `activation`, `retention` in the growth report); the interface changes below are a prioritised plan, not built. They are small, they preserve the editorial reading experience, and each is judged by the numbers `scripts/growth-report.mjs` already prints.

## What already exists (verified in the code)

| Need | State |
| --- | --- |
| Immediate URL capture | the landing page is an import bar: paste a link and read; the bookmarklet and `?url=`/`?save=` deep links capture a page |
| Sample document experience | three bundled texts open without an account or a key; three AI questions a day are free |
| Anonymous first, account later | the library works under a reader cookie; signing in adopts the anonymous library into the account (`planSignIn`, tested) |
| Backup | a downloadable backup file and Markdown export of notes exist in the library |

## What is missing, in the order it should be built

1. **Time to first value, measured.** Switch analytics on in `full` mode (owner decision), then read D1 activation and the funnel for two weeks before changing anything: without a baseline no change can be judged.
2. **A login invitation after meaningful use, not before.** After a reader's *third active event* (a save, a mark or an AI question) on an anonymous reader, show one dismissible line in the library: "Keep this on every device: sign in with Google." Never a modal, never on the reader page while reading, shown once per week at most (dismissal in `localStorage`, nothing stored server-side). It is the only prompt and it is skipped when sign-in is not configured. Measured by registrations per channel and by `account_registered` after the invitation.
3. **A visible synchronisation state.** Today an anonymous or offline library silently keeps a local copy. A small, calm status in the library header ("Saved on this device", "Saved to your account", "Will sync when the connection is back"), driven by what the store already knows (`persisted`, the queue of tombstones, `readerKey`), so a reader never wonders whether a text is safe. No new network calls.
4. **Recovery and backup explained where they matter.** One sentence beside the Backup button and in the empty library: what a backup contains, that it is not encrypted, and that it is the reader's own copy independent of the service (the wording already in `docs/quality/known-limitations.md`, shortened).
5. **Contextual onboarding on the reader page.** The first time a text is opened, a single hint attached to the selection toolbar's first use ("Select a sentence, then ask"), dismissed forever by using it. Not a tour.

## How success is read

| Question | Measure | Source |
| --- | --- | --- |
| Do new readers do something useful in their first day? | activation (first active event within 24 h of first seen) | `activation()` |
| Do they return? | D1, D7, D30, D90 retention | `retention()` |
| Does the invitation convert without annoying? | registrations per channel; D7 of invited vs not (compare in the report) | `byChannel()`, `retention()` |
| Do they use what they saved? | weekly knowledge retrieval rate | `weeklyRetrievalRate()` |

## Owner decisions

1. Switch analytics on (and in which mode) before building 2 to 5, so the effect can be measured.
2. Approve the wording of the invitation and the sync status line.
