# Visual fidelity and accessibility review

_Measured on 2026-10-17 against the dev server on port 3100, Playwright Chromium, plus the user's Chrome 155 for the checks marked R._

## 1. Automated accessibility scan (axe-core 4.14 through Playwright)

`scripts/a11y-scan.mts` visits 15 states in each of two themes (paper and night) and produced the table below: landing, landing with the paste dialog, library, add panel, open book, reader, appearance, key panel, keys dialog, selection toolbar, notebook, listen bar, voice search, and the phone-width reader and landing. That is 30 scans. The same states run as the regression test `tests/e2e/a11y.spec.ts`, which now covers **all five themes** (Paper, Night, Sepia, Snow, Ink; four tests each, and it asserts that `data-theme` really is the theme under test).

| Rule | Violating nodes at start | Now |
| --- | --- | --- |
| color-contrast | 334 | 0 |
| label-content-name-mismatch | 16 | 0 |
| region | 6 | 0 |
| landmark-no-duplicate-banner | 4 | 0 |
| landmark-unique | 4 | 0 |
| aria-allowed-role | 2 | 0 |
| link-name | 2 | 0 |
| **Total** | **368** | **0** |

What was changed:

- Muted text tokens (`--ink-3`, `--ink-4`, `--lens-mute`) were darkened or lightened per theme to reach 4.5:1. Library exhibit text and chips were adjusted with the same rule.
- Book spines and glyphs: the visible title and author are the accessible name; decorative glyph text is no longer in the DOM text. The name starts with the visible label, which satisfies label-in-name.
- Landmarks: one banner, one main, unique labels; dialogs have names and roles; the top-bar and desk regions are labelled.
- Text fields have a visible focus ring (they previously relied on the browser default being suppressed by a reset).

What the scan cannot prove: axe finds roughly a third of real accessibility problems. It does not judge reading order, the quality of names, focus management quality, or whether announcements make sense.

## 2. Keyboard and focus

`a11y.spec.ts` presses Tab through the landing page, the library and the reader (desktop theme variants) and fails if any stop has no visible focus indicator. Beyond that, specific behaviours have their own tests:

| Behaviour | Evidence |
| --- | --- |
| Space on a focused control belongs to the control, not to read-aloud pause | E `search-and-speech.spec.ts` |
| No shortcut fires behind an open dialog | E |
| Voice search: focus goes to the question on open, Tab stays inside, focus returns on close | E |
| Voice menu: arrows, Enter, Escape, focus return | E |
| State changes are announced (paused, finished, stopped, errors) through an always-mounted live region | E (checks the region text) |

Not exercised: a real screen reader (VoiceOver, NVDA), switch access, or voice control. Those are human checks (final report section H).

## 3. Contrast and themes

Five themes exist (Paper, Sepia, Snow, Night, Ink). Axe now covers all five and reports no violation in any of the states listed above (Sepia, Snow and Ink were first scanned at the end of the audit and passed without further changes).

## 4. Forced colors and reduced motion

- `forced-colors: active`: the sentence being read used only a background and box-shadow, which vanish. It now has an outline in system colours. Verified by an E test that emulates forced colors and reads the computed style, not by looking at a real Windows high-contrast session.
- `prefers-reduced-motion`: auto-scroll while reading uses instant scrolling; voice-search panel animation is removed. Verified by E with emulated reduced motion.

## 5. Visual fidelity against the reference

`scripts/visual-diff.mts` compares this build with the saved reference captures (`docs/qa/ref-*.png`, same viewport, dark, signed out) using pixelmatch, once with the current colour tokens and once with the original reference token values, so the cost of the contrast fix is measured instead of assumed. Output images: `docs/audit/visual/diff-*.png`.

| Screen | Viewport | Pixels different (current) | With original tokens | Cost of the contrast fix |
| --- | --- | --- | --- | --- |
| landing | 1440x900 | 0.42 % | 0.42 % | 0.01 pt |
| library | 1440x900 | 8.72 % | 8.69 % | 0.03 pt |
| reader | 1440x900 | 1.07 % | 0.99 % | 0.08 pt |
| landing | 375x812 | 0.63 % | 0.63 % | 0.00 pt |
| library | 375x812 | 16.40 % | 16.31 % | 0.09 pt |
| reader | 375x812 | 0.73 % | 0.72 % | 0.01 pt |

Reading the numbers: these are comparisons between two runs of the same build, not a pass mark. The library differences are dominated by content that is not reproducible: the reference shows the original author's shelf with painted covers, while this build shows its own database rows with procedural art. Landing and reader are close because they share the same layout, type and tokens. No claim is made that the build is pixel-identical; the specification says painted covers and the partner logo are stand-ins.

Screens not covered by the pixel comparison (no reference capture exists for them): mobile gloss bottom sheet, open book, appearance panel, notebook, key dialogs. Those were compared by eye in the earlier pass (`docs/qa/`) and are marked PARTIALLY IMPLEMENTED for fidelity in the traceability matrix.

## 6. Layout robustness

- Phone width (375x812) is scanned by axe and exercised by `mobile.spec.ts`. No horizontal overflow assertion exists beyond what those tests touch.
- Real devices, Safari and Firefox were not available (NFR-14, NOT OBSERVABLE).

## 7. Known residual issues

| ID | Item | Severity |
| --- | --- | --- |
| A11Y-1 | (closed) Sepia, Snow and Ink were not contrast-scanned; they are now and pass | P3 |
| A11Y-2 | No screen-reader pass | P2 (human check) |
| A11Y-3 | Lens toolbar has no roving tabindex (earlier report) | P3 |
| BUILD-1 | `next/font` cannot compute fallback metrics for Atkinson Hyperlegible Next, so there is a small layout shift while it loads | P3 |
