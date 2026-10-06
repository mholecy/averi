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
  these devices. Use a continuously animating spinner instead. (Corrected 2026-10-06 in review: a 1 Hz clock seconds
  field is not a reliable substitute. Simulated under the real rule, the pair settles between its steps in ≈25% of
  runs at c = 0.65 s, ≈92–100% at c = 0.5 s (100% idealised, 96.6% at ±10% jitter, 91.7% at ±25%), always at c ≤ 0.4 s, and never at c = 0.8 s: five re-capture intervals
  of ≈0.8 s span ≈4 s and hold at most four steps, so a pair between steps is the rule, not the exception.)

## Suggestion

- Require three captures for "settled", with spacings that do not divide each other (for example 300 ms then 550 ms),
  so a ≈1 s periodic blink cannot alias both pairs.
- Or, for baseline creation only, compare captures across a window longer than one blink period.
- Update the handoff §5 expectations: "caret ⇒ one `⚠ frame:`" does not hold on Android API 33 or iOS 26.5 simulators.

## Fix (2026-10-06, the commit after `4b1f7fa`) — baseline creation only

**Scope (decided with the user).** Only the screenshot assert's CREATION of a baseline changes. The general stability
wait, its constants and its capture/sleep sequences stay as they are for every other consumer: the tools,
`ensure_state`, the `verify` legs, the color/ocr asserts, and a diff against an existing baseline. The `⚠ frame:` note
is unchanged, so on these devices it stays silent on a caret screen. That is recorded on `capture.ts`'s header as a
known blind spot, not fixed.

**Feedback loop.** A deterministic simulation, `tests/verify/baseline-confirmation.test.ts`. It drives the real
`captureBaselineFrame` (and, for the differential, plain `captureFrame`) through a fake device whose screenshot is one
of two frames chosen by a square-wave blink. A test-owned clock advances by each sleep and by a capture time c per
screencap.
- Grid: period 0.4–2.0 s in 0.05 s steps, 20 phase offsets, c ∈ {0.15, 0.4, 0.65, 0.8} s.
- Criterion: creation is refused for ≥99% of the grid at 50% duty, and for 100% of the points at a 0.9–1.1 s period
  with c = 0.65 s (Android emulator) or 0.15 s.

**Search (offline, the same model).**
- Within a ≈2.1 s budget at c = 0.65, three confirming captures never met the criterion. With any fixed delays the
  best was 94% refused and never 100% of the 1 s band; with three captures at fixed offsets from the pair's start, the
  best was 97%.
- Outside that budget, `[300, 0, 0]` (the chosen schedule minus its last capture) reaches 100% of the band and 98.6%
  overall, at ≈2.25 s for c = 0.65. It is the cheaper alternative, excluded by the 99% line, not by the band (review
  2026-10-06).
- Four captures is the cheapest that clears both lines. Among four-capture schedules, `[300, 0, 0, 0]` ms has the
  widest margin: 99.8% with 20 phases and 99.8% with 200 phases. `[250, 0, 0, 0]` is 50 ms cheaper but sits on the
  line at 99.1%.

**Model sensitivity (review 2026-10-06).** The figures above come from an idealised model: a fixed c, exact sleeps,
and a capture that samples the instant it starts. "100% of the band" holds in that model only. The reviewer's model,
whole grid / band:
- every capture and sleep jittered ±10%: 99.0 / 100;
- ±25%: 98.8 / 99.5 (the simulation test pins its own seeded ±25% run at 98.1 / 99.5; 16 seeds give 98.1–98.6 /
  98.5–100, so the test bounds both at ≥98%);
- a screencap that samples a random instant within its capture: 97.4 / 95.0;
- the window's captures 1.25× slower than the pair's: 96.8 / 95.0; 1.5× slower: 94.4 / 77.0.

So the schedule is the cheapest that clears the criterion in the model, not a guarantee on a device. The device check
in handoff §5 is the real proof.

**Fix.**
- `capture.ts`: `BASELINE_CONFIRMATION_DELAYS_MS = [300, 0, 0, 0]`. These are constants, not options, like the
  stability budget.
- `captureBaselineFrame(adapter)` runs `captureFrame`'s png-only arm unchanged. Only when that pair settled, it waits
  300 ms and takes four more captures back to back. Each must be byte-identical to the settled shot, and the window
  stops at the first that is not.
- The frame reports `confirmed: true | false`. `stability` still describes the pair.
- There is no deadline, as before. The doc says that a deadline added later must count the confirmations, and that a
  window cut short is unconfirmed.
- `assert.ts#assertScreenshot` now reads the baseline file first. With no file, it captures through
  `captureBaselineFrame`. With a file, it captures through plain `captureFrame`, exactly as before.
- The refusal, built from `capture.ts#unconfirmedReason`:
  `baseline not created: the screen did not settle: N captures — two consecutive ones matched, then a later confirming
  capture differed from them — a periodic change such as a blinking caret or a ticking clock, which a matching pair can
  land in phase with; hide or stop it (unfocus the field, freeze the clock) and re-run (a baseline holding one phase of
  it would pass or fail every later run by that phase)`.
- A frame that never settled keeps its old sentence (`… each different from the last …`).

**Measured on the grid.**

| rule | 50% duty, whole grid | 50% duty, 0.9–1.1 s band at c 0.65/0.15 | 30% and 70% duty |
|---|---|---|---|
| the pair alone (before) | 14.3% refused | 24.0% | 6.3% |
| pair + `[300, 0, 0, 0]` | 99.8% (6 of 2640 created) | 100% | 86.9% (recorded, not the criterion; ~95% needs five captures) |

**Cost.**
- Still screen, creation: 4 extra captures and 1 extra 300 ms wait. That is ≈2.9 s at c = 0.65, ≈2.3 s at the
  iOS simulator's c ≈ 0.5, and ≈0.9 s at c = 0.15. The sleep sequence goes from `[300]` to `[300, 300]`.
- This is above the ≈2 s first asked for. No cheaper schedule met the criterion. It is paid once per baseline.
- A refused caret screen stops at the first differing capture. In the assert-level test (a 1 s caret at c = 0.65 s)
  that is the second confirmation, 4 captures in all.
- A diff against an existing baseline costs exactly what it did: 2 captures and `[300]` on a still screen.

**Regression tests.**
- `tests/verify/baseline-confirmation.test.ts`:
  - the old rule fails the criterion (14.3%, 24.0%);
  - the window meets it (≥99%, 100% of the band, pinned at 99.8%);
  - the 30%/70% rates are recorded;
  - a seeded ±25% jitter on every capture and sleep is recorded at 98.1% / 99.5% (bounded at ≥98% / ≥99%);
  - a still screen is created at every c.
- `tests/verify/capture.test.ts`:
  - the still-screen sequence (6 captures, `[300, 300]`, no `sleep(0)`);
  - a change on the third and on the fourth confirmation refuses, keeps the settled shot and stops there;
  - a moving frame gets no window;
  - the window confirms against the pair that settled after earlier motion;
  - the exact wording.
- `tests/verify/assert.test.ts`:
  - a 1 s caret at c = 0.65 s that `captureFrame` alone calls settled is refused by `Verifier.assert` with the
    sentence above, after 4 captures and `[300, 300]`, and no file is written;
  - on the same caret screen, a diff against an existing baseline still takes 2 captures and `[300]`.
- `tests/verify/assert-baseline-fail-closed.test.ts` (review 2026-10-06): creation stores only a CONFIRMED frame. An
  `unjudged` frame, which has no `confirmed` and which the real capture cannot produce today because creation has no
  deadline, is refused as `baseline not created: the screen was not judged: 1 capture …` and nothing is written. The
  capture is mocked in that file only. `BaselineFrame` is a union in which `confirmed` is a boolean exactly when the
  pair settled.
- The assert's comment records that the read-to-write window is now ≈3 s, so two concurrent first runs can both
  write. Both write a confirmed frame, and no lock is taken.
- One existing pin moved: the creation path of `diffs and baselines the SETTLED frame …`, from 4 captures and
  `[300, 300, 300]` to 8 and `[300, 300, 300, 300]`. Its diff half is unchanged at +2 captures.

**Mutation checks.** All killed:
- an empty window (the old rule);
- three confirmations;
- `[0, 0, 0, 0]`, i.e. no irregular wait;
- a window that never refuses;
- `sleep(0)` recorded;
- a window that does not stop at the first change;
- a window run on a moving frame;
- the assert ignoring `confirmed: false`;
- the diff paying the window;
- creation through plain `captureFrame`;
- the refusal worded with `unsettledReason`;
- (review round) the creation check put back to `confirmed === false`, which stores the `unjudged` frame;
- (review round) the ±25% jitter dropped from the window's sleeps or captures, or the window shortened to `[300, 0, 0]`.
