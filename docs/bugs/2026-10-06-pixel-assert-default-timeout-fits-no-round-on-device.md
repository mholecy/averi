# BUG: with the default 3 s timeout a `color`/`ocr` assert cannot pass on the Android emulator, and passes only sometimes on iOS

**Measured 2026-10-06 16:45–17:00 CEST** against `d69511e` (`dist/` built from it), driven by the handoff's stdio driver.
Android `emulator-5554` (Pixel_3a AVD, API 33, 1080x2220). iOS `iPhone 17` iOS 26.5 (finportal: `treeSource: wda`;
mp-native: idb). Logs: `$RUN/out/b-android-static*.log`, `b-ios*.log`, `c-a-form.log`, `c-a-spinner.log`, where
`RUN=/private/tmp/claude-501/-Users-mholecy-dev-mobile-verify/9f3935d1-240c-470b-93c9-c353ad95f1dd/scratchpad/device-run`.

## Claim

The handoff (§0, pixel poll step 2; §5) says that on a static login screen a `color` assert on `login_submit` and an
`ocr` assert on its label PASS, and that on a caret screen they pass "in two rounds of a still screen's cost".
`Verifier.poll`'s comment (`src/verify/assert.ts`) says that with "a 1.5 s dump and a 3 s budget exactly one evaluation
fits".

## Measured

Android, finportal login screen, nothing focused. The screen was still: `assert { screenshot }` read `0.00% of pixels
differ` one step earlier. No `timeout` was set, so the default 3000 ms applied:

```
static color submit      --- ok in 3.4s   FAIL … element found, but no time was left within 3000ms to capture a settled frame
static ocr submit        --- ok in 3.3s   FAIL … element found, but no time was left within 3000ms to capture a settled frame
static ocr title         --- ok in 3.5s   FAIL … (same sentence)
static color submit (repeat, fresh launch) 3.3s  FAIL … (same sentence)
```

The same asserts with `"timeout": "15s"`:

```
static color submit 15s  --- ok in 4.5s   PASS … sampled #FAFAFA (dominant, 90% of region) … dE00 0.00 ≤ 8
static ocr submit 15s    --- ok in 4.5s   PASS … read "Log in"
```

mp-native SWIFT form (Android) with default timeout: `caret ocr title default 3s` 3.3 s, FAIL with the same sentence.
With 15 s: 4.4 s, PASS.

Host timings measured by hand on this emulator: `uiautomator dump` + `cat` ≈ 2.7 s; `adb exec-out screencap -p` ≈
0.64–0.75 s. One round is therefore one tree read (≈2.7 s), then two captures and a 300 ms gap (≈1.6 s). That is about
4.3 s, and the 4.1–4.5 s passes above match it. The 3 s deadline falls during the first capture. The capture is
`unjudged`, the next round starts past the deadline, and the timeout wording is "no time was left".

iOS (finportal, WDA), caret screen, default timeout, 6 runs of each: color PASS 1 of 3 (2.5 s), FAIL 2 of 3 (4.0 s);
ocr PASS 1 of 3 (2.8 s), FAIL 2 of 3 (3.8–3.9 s). With 15 s every run passed, in 5.1–5.4 s. That is two rounds, which
is what the handoff predicts for a region-only settle. With a 3 s budget, two rounds never fit.

## Code says

- `src/verify/assert.ts`: `this.timeoutMs = opts.timeoutMs ?? 3_000`.
- `src/verify/pixel-poll.ts`: a round that begins past the deadline takes no screenshot. A capture the deadline cuts
  before a second frame is `unjudged`, which makes the round silent (`foundSilently = 'cut'`).
- Since `c444c79`, a frame that settled over the region only needs a second round to confirm the rect. On a screen
  with a live caret or clock, that is the normal case.

Taken together: on a device whose tree read takes more than about 1.4 s (every Android device measured so far), the
default budget can never produce a verdict. On iOS it produces one only when the whole screen happens to settle in
round 1.

## Suggestion

- Raise the pixel asserts' default timeout to cover two rounds on the slowest supported tree (for example 10 s), or
  derive it from the round's measured cost.
- Or keep 3 s and change the wording: "no time was left within 3000ms" reads like a flaky screen, when the cause is
  that the budget is smaller than one round on this device. Name the round cost in the sentence.
- Pin the behaviour in a test using the fake-device harness from `Verifier.poll`'s table, with a 2.7 s dump and a
  0.65 s screencap (the numbers measured here). The table's 1.5 s / 300 ms fakes are what hid this.
