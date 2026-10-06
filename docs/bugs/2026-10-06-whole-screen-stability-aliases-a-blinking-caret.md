# BUG (measurement): whole-screen stability calls a blinking-caret screen "settled", so no `⚠ frame:` appears and a baseline is created from it

**Measured 2026-10-06 16:47–16:52 CEST** against `d69511e`, finportal login screen with `login_username` focused.
Android `emulator-5554` (API 33) and iOS `iPhone 17` (iOS 26.5, WDA). Logs: `$RUN/out/b-android-caret*.log`,
`$RUN/out/b-ios.log`, with `RUN=/private/tmp/claude-501/-Users-mholecy-dev-mobile-verify/9f3935d1-240c-470b-93c9-c353ad95f1dd/scratchpad/device-run`.

## Claim

Handoff §0 (`4954ab4`, pixel poll step 2) and §5: on a screen with a caret, `screenshot`/`ensure_state` output carries
exactly one `⚠ frame:` line, and a baseline `screenshot` assert says `baseline not created: the screen did not settle …`.

## Measured

The caret really blinks. Six back-to-back raw captures on each platform alternated between two images:
- Android `adb exec-out screencap` md5s: A B A A B A.
- iOS `simctl io screenshot` md5s: A A B A B A.

averi on the same screens:
- Android: `screenshot` run 8 times, `ensure_state logged_out` once. None of them printed a `⚠ frame:` line.
- iOS: `screenshot` run 2 times, `ensure_state` once. None printed a `⚠ frame:` line.
- Android `assert { screenshot: { baseline: "login_caret_probe" } }` returned
  `PASS … baseline created at …/.averi/baselines/android/login_caret_probe.png`, i.e. it was created from a caret screen.

Cadence: one Android capture takes ≈0.65 s, plus the 300 ms `STABILITY_DELAY_MS`, so successive capture starts are
≈0.95 s apart. A standard caret blinks 500 ms on and 500 ms off, a ≈1 s period. Two captures one period apart usually
land in the same phase, and the pair compares equal. iOS shows the same effect at a ≈0.8 s spacing.

## Code says

`src/verify/capture.ts`: settled means two identical consecutive captures `STABILITY_DELAY_MS` (300) apart. The real
spacing is that delay plus the device's capture time, so the check samples at the device's cadence. It cannot see
motion whose period is close to a multiple of that spacing.

## Why it matters

- On these devices the `⚠ frame:` note is silent for exactly the caret case it was written for. Its absence does not
  prove the screen is static.
- A baseline can be created from a frame that contains a caret. A later comparison then fails or passes according to
  the caret's phase. The 1% threshold hides a caret today, but it would not hide a larger blinking element.
- The handoff's on-device proofs that rely on a caret (`⚠ frame:` present, baseline refused) cannot be reproduced on
  these devices. Use a spinner or a clock seconds field instead.

## Suggestion

- Require three captures for "settled", with spacings that do not divide each other (for example 300 ms then 550 ms),
  so a ≈1 s periodic blink cannot alias both pairs.
- Or, for baseline creation only, compare captures across a window longer than one blink period.
- Update the handoff §5 expectations: "caret ⇒ one `⚠ frame:`" does not hold on Android API 33 or iOS 26.5 simulators.
