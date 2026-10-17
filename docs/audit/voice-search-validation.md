# Voice semantic search validation

_Code under test: `src/components/reader/VoiceSearch.tsx`, `src/lib/speech/recognition.ts`, `src/lib/search/{bm25,porter,tokenize}.ts`, `src/app/api/search/route.ts`, `src/app/api/speech/transcribe/route.ts`. Findings VOICE-1 to VOICE-19 and RETR-1 to RETR-12; statuses in `defect-backlog.md`._

## Rule applied

A typed query is not a microphone test and a fake recogniser is not speech recognition. This document therefore separates three things that are easy to confuse:

| Part | What exercises it here | What would prove it |
| --- | --- | --- |
| Capture lifecycle (permission, start, stop, abort, release of the microphone) | unit tests with a fake `SpeechRecognition`, `getUserMedia`, `MediaRecorder` and `fetch` | a person speaking into a real microphone (H) |
| Speech-to-text accuracy | nothing: not measured | the same, with a word-error count |
| Retrieval (text query to ranked passages) | a labelled set of 41 queries run through the exact code path the panel uses | already real for the lexical path; the meaning re-rank needs a key |

## 1. Capture lifecycle (fake devices, no real microphone opened)

`tests/unit/voice-search.test.ts` has 26 tests. Twenty-five of them were run against the code before the fix and failed. The fakes follow the documented contracts: `stop()` flushes a pending final result and then fires `end`; `abort()` drops it; only `MediaStreamTrack.stop()` releases the microphone.

| Behaviour guarded | Finding |
| --- | --- |
| a re-render of the parent (every scroll frame) does not stop listening | VOICE-1 |
| a result that arrives after the panel closed neither searches nor starts reading | VOICE-2 |
| the microphone is released when recorder setup fails after permission was granted | VOICE-3 |
| closing or Cancel while the permission prompt is open: nothing records if it is granted later | VOICE-4 |
| an upload that fails ends with a message, not a stuck UI | VOICE-5 |
| the late `end` of one recogniser cannot orphan the next | VOICE-6 |
| typing while listening wins: interim speech does not overwrite it, a final result that arrives before Enter neither overwrites nor searches (found by the verification pass in this audit and fixed), a slow answer to an older question cannot replace a newer one | VOICE-7 |
| silent ending explained; hidden tab stops listening | VOICE-8 |
| failover from the blocked browser recogniser to server transcription when a key exists | VOICE-9 |
| read-aloud pauses when the panel opens | VOICE-10 |
| focus in on open, Tab trap, focus back on close, live status, alert errors | VOICE-11 |
| privacy line says where voice and text go | VOICE-12 |
| error text distinguishes denied, dismissed, no device, busy, insecure, unsupported | VOICE-16 |
| "read that passage" reads only that passage | VOICE-17 |

E2E (`search-and-speech.spec.ts`) covers the same panel through the real UI with typed input: focus on open, Tab trap, scroll while open, read-aloud pausing, "...and read it".

**Never started by default.** The microphone starts only after a click. Nothing is captured or transcribed on open.

**Real microphone: not exercised.** The built-in browser blocks it, and the user's Chrome needs a human to grant the permission and speak. The code path from `startRecognition` to a result in a real browser is therefore IMPLEMENTED, NOT VERIFIED.

## 2. Retrieval quality, measured

`scripts/eval-retrieval.mts` (run: `pnpm exec tsx scripts/eval-retrieval.mts`) scores the 41 queries in `tests/fixtures/retrieval-eval.json` (26 answerable over the three English samples, 5 answerable over a synthetic Portuguese text, 7 absent concepts, 3 ambiguous one-word queries). It calls what the panel calls without a key: `parseSpokenQuery`, then `Bm25Index.search(topic, 12)`.

| Metric | Review baseline | Now |
| --- | --- | --- |
| Top-1, 26 sample-document queries | 15/26 = 57.7 % | 15/26 = 57.7 % |
| Top-3, same | 17/26 = 65.4 % | 18/26 = 69.2 % |
| Top-3, all 31 answerable | 22/31 = 71.0 % | 23/31 = 74.2 % |
| Absent concepts that still show a hit list | 4 of 6 (4 of 7 with the Portuguese one) | 1 of 7 |
| Absent concepts labelled "high" | 0 | 0 |
| Ambiguous one-word queries labelled "high" | 2 of 3 | 0 of 3 |
| Queries with overlapping windows in the top 3 | 20 of 30 | 0 of 41 |
| Answerable queries labelled none / low / high | 3 / 10 / 18 | 7 / 6 / 18 |
| Precision of "high" (top-1 correct) | 17/18 = 94.4 % | 16/18 = 88.9 % |
| Hit offsets that slice back to the excerpt | 172/172 | 215/215 |

Reading it honestly:

- The big wins are what the user sees as noise: far fewer false lists for absent topics, no overlapping duplicates, no confident answer to a one-word ambiguous query.
- Top-1 did not improve. Four answerable queries (conclusion and argument questions) are still missed.
- The cost is real: seven answerable queries now say "no match" instead of three. Of the seven, one (Q31) is a near miss, the rest are paraphrases with few words in common with the text (Q05, Q07, Q21, Q22) or Portuguese queries about an English text (Q16, Q34), which pure word matching cannot find. This is what the (key-gated) meaning re-rank is for, and its quality has not been measured.
- "High" is slightly less precise than before (two confident misses: Q08 and Q23). With 18 cases this is one query of difference; it is not significant, and it is not hidden.
- The 0.4 coverage cutoff is not calibrated. The set is too small to tune it without overfitting, so it was left where the structure of the problem put it. The thresholds in `retrieval.test.ts` sit just under the measured values to catch regressions; they do not claim accuracy.

Misses at the time of this run (answerable, top-1 wrong): Q03, Q05, Q06, Q07, Q08, Q16, Q21, Q22, Q23, Q31, Q34 (listed by the script with their category).

Latency (measured during the review on Node 24: 0.04 ms median per query, 8.3 ms at 22 000 passages, index build 2 to 4 ms for the samples) was not re-measured; the algorithm change added a stemmer and filler filter and no new loop over passages.

## 3. Meaning (embedding) re-rank

Not exercised: there is no `TOGETHER_API_KEY` and no user key. What is verified is the contract around it: the lexical result stands when the re-rank is unavailable and the panel says "words only (meaning search unavailable)"; the re-rank can reorder the top 12 but cannot raise the confidence label; excerpts are cut to the route's 2000-character limit before sending (RETR-11 fix, this pass); the route has its caps, rate limit and fixed error text (`serverKeyAbuse.test.ts`). Whether the re-rank actually improves recall is **unknown**.

## 4. Server transcription fallback

Not exercised against a provider. Verified: route validation, the 5 MB cap, the audio type allow-list, the 30 s timeout, the no-key 402, the client's handling of network failure and empty transcripts. Residual: no silence check before upload, the uploaded filename is always `speech.webm`.

## 5. Privacy

The panel states where voice and text go. In browsers where `SpeechRecognition` is the vendor's cloud service (Chrome), the audio goes to that vendor's servers; the server fallback sends the recording to Together AI when a key exists. No audio or transcript is logged by this app. The README does not yet repeat this disclosure.

## 6. Checks for a human (about 5 minutes)

1. Open a text in Chrome on localhost, press `V`, allow the microphone when asked.
2. Say "find the part about the sea floor". Confirm the transcript appears while you speak, the search runs by itself when you stop, and the first result jumps to the right paragraph with the matched words marked.
3. Say a topic the text does not contain. Confirm the panel says it found nothing instead of listing near misses.
4. Start listening and close the panel with Escape: the browser's microphone indicator must go off at once.
5. Deny the microphone in the browser prompt. Confirm the message explains how to allow it.
6. With a Together key saved in the key panel, repeat step 2 with a paraphrase ("where does he talk about the bottom of the ocean") and report whether the answer is better than without the key.
7. Report browser, language, any wrong transcript, and the privacy line you saw.
