# The local production server that stopped answering during the WebKit run (unexplained)

**Status: not explained, not reproduced, no sign it touched production.** Recorded so that it is neither forgotten nor inflated.

## What happened

On 2026-10-27, in the first full regression of the launch branch (commit `d1b9d62`), the production build was started with `next start -p 3201` on a disposable PostgreSQL and the browser suites ran against it in this order: integration tests, Chromium and Pixel 7, then Firefox, WebKit and iPhone WebKit.

* Chromium finished (198 passed, 5 failed for reasons that belong to the suite: see `docs/release/BETA_LAUNCH_REPORT.md`).
* During the WebKit step 25 tests failed with `connect ECONNREFUSED ::1:3201` and `connect ECONNREFUSED 127.0.0.1:3201`: the server was no longer listening. iPhone WebKit failed 2 more.
* The server's own log (`next start`'s standard output and error, 8 lines) shows its normal start-up and three `Warning: Indexing all PDF objects` lines from the PDF reader, and **nothing else**: no exception, no stack trace, no exit message.

## What was ruled out, and what was not

| Hypothesis | Evidence |
| --- | --- |
| A crash in the application | no error in the log, but a process killed by the system (SIGKILL) would also leave none, so this is **not** ruled out |
| Something in the WebKit tests brings the server down | the same WebKit tests ran again against a fresh production server (liveness checked after every step) and against the development server: **the server stayed alive in every step**, and WebKit passed on the development server (78 of 78 with Firefox and iPhone) |
| The 5 WebKit failures that do remain on the production build | **explained**: the reader cookie is `Secure` and WebKit does not keep a `Secure` cookie from `http://localhost` (Chrome and Firefox make an exception for localhost). On the real HTTPS site WebKit and iPhone keep it and pass every check (`docs/release/BETA_LAUNCH_REPORT.md`) |
| Memory pressure or another process on the machine ending the server | plausible (three browsers, a server and a build were running on a laptop, and other commands ran in parallel), **not measurable after the fact** |
| The same on Vercel | no sign: the production deployment answered `/api/health` with `ok` throughout, the runtime logs hold no crash, and the allowances test starts and stops five production servers without a stop |

## What was done

* The regression script now checks, after every step, that the server still answers, and writes `alive` or `DEAD` next to the step. Over the corrected run, and the run after it, it never printed `DEAD`.
* `scripts/post-deploy-check.mjs` was added so the same questions can be asked of the live site at any time.

## If it happens again

1. Start the server through a wrapper that records how the process ends (`next start ...; echo "exit $? at $(date)" >> server.exit`), so a signal is distinguishable from a crash.
2. Run it with `NODE_OPTIONS=--trace-uncaught` and keep the whole log.
3. Check `log show --last 30m --predicate 'eventMessage CONTAINS "jetsam" OR eventMessage CONTAINS "node"'` for the system ending a process.
4. If it reproduces on Vercel or on a machine with free memory, treat it as a defect in the application and open it in `docs/audit/defect-backlog.md`.
