# Test strategy and results

_Final run on 2026-10-17 against the working tree at the commit that follows 0987206. Every number below comes from a command run in this session, with its real exit code._

## Final results

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | clean, no warnings |
| `pnpm test` (Vitest) | 0 | 32 files, **663 tests passed**, 0 failed, 0 skipped. 201 of them are seeded randomised anchor cases; 134 are table-driven retrieval cases |
| `pnpm test:e2e` (Playwright, desktop plus mobile, one worker, real dev server and real PostgreSQL) | 0 | **98 passed** (96 desktop, 2 mobile), 0 failed, 0 skipped, 0 retried |
| `pnpm build` | 0 | compiled; one warning: no fallback font metrics for Atkinson Hyperlegible Next (BUILD-1) |
| `pnpm audit --prod` | 0 | no known vulnerabilities |

At the start of the audit the same commands gave 42 unit tests and 32 end-to-end tests. Tests added by this audit: 621 unit and 66 end-to-end.

No test was skipped, deleted, loosened or marked flaky to obtain these results. Where a test was wrong it was fixed and the reason recorded in the commit (for example a security test that depended on a NUL byte reaching the database now uses a lone surrogate, because NUL is refused earlier).

## Strategy

| Layer | Tool | What it is for | What it cannot prove |
| --- | --- | --- | --- |
| Static | `tsc --noEmit` (strict), ESLint (Next config), `next build` | type and framework misuse, dead code | behaviour |
| Unit | Vitest, node environment by default, jsdom per file where a DOM is needed | pure logic: anchors, retrieval, stemming, sentence splitting, safe fetch address rules, limits, cookie and OAuth helpers, the speech controller against fake engines, the voice panel against fake devices, route handlers against a real driver pointed at a dead port | that a real browser, microphone, speaker, model or OAuth provider behaves like the fake |
| Integration through HTTP | Playwright `request` fixture against the running app and the real local PostgreSQL | ownership, validation, status codes, last-write-wins, upload limits, security headers, CSRF guard | production infrastructure |
| End to end | Playwright (Chromium desktop 1440x900 and Pixel 7) | real UI journeys, keyboard behaviour, dialogs, speech with a fake engine, voice search with typed input, a11y | other browsers; real audio; real speech recognition |
| Accessibility | axe-core through Playwright in two themes plus a keyboard focus scan and dialog focus tests | WCAG A and AA rules axe can see, visible focus, focus traps | screen-reader experience, cognitive load |
| Visual | pixelmatch against saved reference screenshots, current tokens versus original tokens | measured distance and the cost of the contrast fix | design quality |
| Retrieval evaluation | `scripts/eval-retrieval.mts` over 41 labelled queries | regression signal for ranking and confidence labels | accuracy claims (the set is small) |
| Real browser | Chrome 155 driven through the extension | the real speech engine's events and flags, the capture bookmarklet on a live page | audible sound, microphone |

### Fakes and why they are honest

- **Speech synthesis fake.** Models start, end, error, pause and cancel. Options reproduce two real defects: `cancel()` leaving `paused` true, and `end` firing inside `cancel()`. The first was then confirmed in real Chrome.
- **Speech recognition fake.** Follows the documented contract: `stop()` flushes a pending final result then fires `end`; `abort()` drops it. It makes no claim about accuracy.
- **Microphone fake.** Only `MediaStreamTrack.stop()` releases the device; tests assert it is called on every exit path.
- **Database.** Not mocked. Outage tests use `DATABASE_URL` pointing at a port nothing listens on, so the real driver raises the real error. The only mock is the cookie reader, because `cookies()` needs a request scope.
- **Models.** Not mocked in e2e: without a key the routes answer 402 and the UI shows it. The paid path is therefore untested, and that is stated rather than hidden.

### Regression discipline

Each fix in the review set came with a test that was run against the old code and failed there (the commit messages say how many). In this final stretch the same check was done by disabling the fix: the four dialog-focus tests, the two Stop-focus tests, the typed-over-spoken voice test and the randomised anchor test (by breaking resolution) all fail without their fixes.

## Test inventory

### Unit (32 files, 663 tests)

| File | Tests | Area |
| --- | --- | --- |
| speech-controller | 37 | playback state machine with fake engines |
| sentences, segments | 26, 10 | sentence splitting, chunking, spoken text |
| speech-unsupported | 1 | no speech engine |
| voice-search | 26 | capture lifecycle, permission flow, stale callbacks, fallback |
| retrieval | 134 | stemmer vocabulary, stop words, spoken queries, confidence, labelled evaluation |
| search | 8 | BM25 basics |
| anchors, anchors-resolve, anchors-dom, anchors-property | 7, 30, 13, 201 | anchoring, resolution, DOM selection, randomised contract |
| annotate, annotation-schema, annotation-routes-outage, library-sync, notebook-markdown | 7, 41, 4, 13, 3 | annotation logic, validation, outage, sync, export |
| safeFetch, safeFetchRanges, safeFetchPinning | 5, 5, 6 | SSRF address rules, ranges, connect-time pinning |
| serverKeyAbuse, parserLimits, importErrors, importStatus, uploadKind, guarded-errors | 16, 13, 4, 3, 4, 3 | limits, parser bounds, error hygiene, file sniffing |
| auth, authHardening, accountMerge | 3, 8, 9 | OAuth helpers, production guards, account merge planner (some cases need the database) |
| content, pdf-paragraphs | 10, 4 | extraction, PDF paragraph gaps (real PDF fixture) |
| db-outage, theme-boot | 5, 4 | outage with the real driver, no React script-tag error |

### End to end (98 runs)

a11y 15, annotations 8, annotations-api 6, api 6, import-and-isolation 3, landing 10, library 3, mobile 2, reader 9, search-and-speech 27, security 9.

## Known weaknesses of the test suite

- One shared development database. Tests add rows and never remove them.
- Playwright runs with one worker against `next dev`, not `next start`; production-only behaviour (HSTS, the secure cookie flag, `APP_URL` enforcement) is unit-tested but not seen end to end.
- Test titles occasionally promise more than the assertion proves: the forced-colours test only checks that the highlight has a non-transparent background; the "Finished reading" announcement is not asserted.
- The retrieval thresholds are set just below measured values on a small hand-written set.
- No CI is configured (`.github/` is absent), so nothing runs these automatically.

## How to run everything

```bash
cd ~/gloss-reconstruction/gloss
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
pnpm dev --port 3100          # in one terminal; the Playwright config also starts it when nothing is listening
pnpm test:e2e                 # needs PostgreSQL with DATABASE_URL set for the server-backed specs
pnpm build && pnpm audit --prod
pnpm exec tsx scripts/eval-retrieval.mts    # retrieval metrics
pnpm exec tsx scripts/a11y-scan.mts         # axe over 30 states
pnpm exec tsx scripts/visual-diff.mts       # pixel comparison, writes docs/audit/visual/
```
