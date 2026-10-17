# Read-aloud (text-to-speech) validation

_Code under test: `src/lib/speech/controller.ts`, `segments.ts`, `src/lib/search/tokenize.ts` (`sentences`), `src/components/reader/ListenBar.tsx`, the speech parts of `Reader.tsx` and `Block.tsx`. Findings: TTS-1 to TTS-23 from the review, statuses in `defect-backlog.md`._

## What was validated, at which level

| Level | Meaning | Done |
| --- | --- | --- |
| 1 Logic | state machine against fake engines | yes, 74 unit tests in four files (`speech-controller` 37, `sentences` 26, `segments` 10, `speech-unsupported` 1) |
| 2 Browser behaviour | the real `speechSynthesis` in the user's Chrome reports start/end/error events, `paused` flag, voices | yes, this pass, see below |
| 3 Audible sound | a human hears the voice through speakers or headphones | **not done and not possible for an agent** |

**Nothing below claims that sound was heard.** Chrome reporting a `start` event and a long `end` time for an utterance is strong evidence that the engine accepted and played it, but muted output, a wrong output device or a silent voice would produce the same events. TTS-R11 ("audible") stays BLOCKED until a person confirms it (instructions at the end).

## Level 1: fake engines

The fake engine in the unit tests models the documented contract and, deliberately, two real-world defects: `cancel()` that leaves `paused` true, and `cancel()` that fires `end` synchronously. Tests that guard the key review findings were run against the old controller and failed there:

| Guarded behaviour | Finding |
| --- | --- |
| pause, skip/stop/restart, then speak is not silent | TTS-1 |
| an engine error invalidates the utterance, so a late `end` cannot keep speaking | TTS-2 |
| the whole-text counter survives error, retry, restart | TTS-3 |
| no utterance longer than 220 characters (was up to 1257); highlight stays on the sentence | TTS-4 |
| sentences are not split on decimals, "e.g.", "Ph.D.", domains, versions | TTS-5 |
| a Portuguese text gets a Portuguese voice even if an English voice was chosen | TTS-6 |
| rate or voice changed while paused applies on resume | TTS-14 |
| synchronous `end` inside `cancel()` cannot clobber a passage | TTS-15 |
| unknown start block falls back to the top | TTS-16 |
| skip crosses the passage/continuation boundary, ends are disabled | TTS-17 |
| attach, detach, attach again keeps the voice listener (React StrictMode) | TTS-18 |
| footnote markers and code are not spoken | TTS-19 |
| interruption by something else is reported, our own cancel is not | TTS-23 |

Segmentation measured on the three sample texts: no sentence starts in lowercase (4+2 before), every chunk is at most 220 characters.

## Level 2: real Chrome 155 (user's browser, driven through the Claude in Chrome extension, 2026-10-17)

Setup: the page's `speechSynthesis.speak/pause/resume/cancel` were wrapped to log every call and event with timestamps. `getVoices()` returned 199 voices. The saved reader settings were voice "Daniel" (en-GB) at 1.5×. Playback was started with a real click followed by the `L` key (Chrome needs a user gesture; an earlier attempt without one was discarded as inconclusive).

| Check | Observed | Verdict |
| --- | --- | --- |
| `L` from the paragraph on screen | pill "Reading · 116/267", first utterance `speak` then `start` 4 ms later (217 characters, en-GB, Daniel, rate 1.5); next utterance started 31 ms after the previous one ended; the current sentence carried the highlight class | pass |
| Segment count | 267 sentences for the chalk sample (276 with the old splitter, which cut on abbreviations) | consistent with TTS-5 fix |
| `Space` pauses | `paused` reads **false** right after `pause()` and **true** about 400 ms later; bar shows "Resume", live region says "Paused" | pass; note the lag |
| `Space` resumes | `resume()` called while `paused` true; speech continued, no new `speak` | pass in the second trial. In the first trial the same sentence was spoken again from its start (a `cancel` at resume time, then a `speak` of the same length). The cause was not isolated. The code restarts a sentence on resume when `paused` already reads false, which the 400 ms lag can produce. Behaviour is acceptable (no silence, no overlap) but not mid-sentence in that case |
| Back / Forward one sentence | 118 → 119 → 118 of 267; the interrupted utterance's own cancel did not surface as an error | pass |
| **TTS-1 scenario**: Pause, Forward while paused, Resume | `cancel()` was called while `paused` was true (Chrome keeps the flag after cancel, confirming the review's concern); the controller called `resume()` to clear it; the next `speak` produced a `start` event and `paused` went false | pass; the defensive un-pause is required in real Chrome |
| Stop | `speaking` false, `paused` false, bar gone, highlight gone, live region "Stopped reading" | pass |
| Errors | 0 `error` events across all runs | pass |

Not repeated in this pass: the 2-minute unattended run (earlier pass, before the controller rewrite: 20 utterances, 0 errors, longest gap 81 ms, no stall). It should be repeated against the current controller by the person doing Level 3 below.

Not verified at any level: Safari and Firefox, Android Chrome (known to behave differently with `pause()`), iOS, Edge, online "Google" voices, a Bluetooth output switching mid-read, tab backgrounding for minutes, a screen reader running at the same time.

## Level 1 and 2 results for the UI

- Keyboard: `L`, `Space`, Escape, arrow keys in the voice menu are covered by e2e tests with the fake engine (`search-and-speech.spec.ts`, 25 tests incl. voice search).
- Live region announcements: paused, finished, stopped, errors (e2e checks "Stopped reading"; "Finished reading" is not asserted).
- Unsupported browser: the controls are hidden and `L` explains why (`speech-unsupported.test.ts`, e2e).

## Residual TTS items

See `defect-backlog.md`: TTS-8 (memoised blocks still re-render on sentence change), TTS-9 (stop point is not remembered across `L` presses or reloads), TTS-11 (the Listen setting only hides the top-bar button), TTS-12 (focus is lost when the bar closes on Stop; no way to turn off the single-key `L` shortcut).

## Level 3: what a person must do (about 5 minutes)

1. Open http://localhost:3100/read/on-a-piece-of-chalk in Chrome with the system volume up and no Bluetooth device switching.
2. Click once on the text, press `L`. Confirm you **hear** a voice reading the highlighted sentence and that the highlight moves with it.
3. Press `Space`: audio stops. Press `Space`: audio continues (a restart of the current sentence is acceptable).
4. Use the Forward arrow three times quickly, then wait: reading continues from the new sentence with no overlapping voices.
5. Change speed to 1.5× and the voice to another one: the next sentence uses it.
6. Leave it running for 2 minutes without touching the page. Confirm it never stalls and the page follows the sentence.
7. Select one sentence, choose the speaker action in the selection toolbar, confirm only that sentence is read and then the text continues.
8. Report browser, operating system, output device, any step that failed and any error text in the bar.
