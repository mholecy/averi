# BUG: a `color`/`ocr` assert on an element under the Android soft keyboard measures the keyboard

> **Status (2026-10-08):** fixed on main in `95f75f4` (2026-10-06).
>
> Shas below are pre-squash branch commits; on main: `d69511e` → `b413ae8`, `6300325` → `926b826`, `f1f9ba8` → `95f75f4`.

**Measured 2026-10-06 16:56 CEST** against `d69511e`, mp-native SWIFT payment form, Android `emulator-5554` (API 33,
docked Gboard). Log: `$RUN/out/c-a-form.log`, with `RUN=/private/tmp/claude-501/-Users-mholecy-dev-mobile-verify/9f3935d1-240c-470b-93c9-c353ad95f1dd/scratchpad/device-run`.

## Claim

The tap path has a soft-keyboard guard (`⚠ tap: the soft keyboard covered id:"…"; hidden before tapping`, C1/V1). The
pixel asserts have no equivalent. The mp-native session notes said Android drops CONTINUE from the tree while the IME
is up. It did not here.

## Measured

`tap id:swift_payment.form.iban_input` raised the IME. The screenshot shows the keyboard covering the bottom ~40% of
the screen, including the pinned CONTINUE. `ui_snapshot` still reported
`swift_payment.form.continue_button` at `{x:66, y:1979, w:948, h:132}`, its at-rest layout rect. Then:

```
caret color continue 15s  --- ok in 16.7s
FAIL … fill within dE00 8 of #3F3F50 — sampled #FFFFFF (dominant, 52% of region) vs expected #3F3F50 → dE00 61.62 > 8
caret ocr CONTINUE 15s    --- ok in 17.0s
FAIL … renders text "CONTINUE" — read "123"; vs expected "CONTINUE" ≠
```

`#FFFFFF` is the keyboard's key face, and "123" is the keyboard's `?123` key. Both asserts measured the keyboard and
reported the result as the element's colour and copy, as a code-fix-style mismatch. `verify`'s text table already
words this case (`OCCLUDED … Usually an overlay: a focused field raises the IME …`). The single-element asserts do not.

## Why it matters

- The failure reads as an app defect ("CTA is white", "CTA reads 123").
- With an expected value that happens to equal the keyboard's colours (white or light grey, common for disabled
  controls), the assert would PASS on an element the user cannot see.

## Code says

`src/verify/pixel-poll.ts` crops the tree's rect. Nothing consults `DeviceAdapter.keyboard?` (the oracle the tap path
uses since `f543b2f`) before measuring.

## Suggestion

When the adapter offers the keyboard oracle and the element's rect intersects the keyboard frame, fail closed with
"covered by the soft keyboard — dismiss it and re-run" (or the `verify` table's OCCLUDED wording) instead of
measuring. Reuse the tap guard's pure table for the intersection test.

## Fix (2026-10-06, the commit after `6300325`)

**Where.** In the pixel poll (`pollPixels`, `src/verify/pixel-poll.ts`), once per round: after the find and the deadline
check, before the capture. The color and ocr asserts both poll through it, so both are covered by one check. The
`verify` legs, the tools and the tap guard are unchanged; the text table already reports this case as OCCLUDED.

**Rule.**
- The adapter has the keyboard oracle (`DeviceAdapter.keyboard`, Android) → ask `keyboard.state()`.
- `shown`, and its frame overlaps the element's rect by any positive area (`rectsOverlap`, new in
  `src/ui-tree/geometry.ts`) → the round is a fail-closed MISS and nothing is captured (`rendered text unchecked` for
  ocr). The remedy does not say "tap a field above": that keeps the keyboard up (review 2026-10-06).

  ```
  the soft keyboard covers the element (element 66,1979 948x132, keyboard 0,1285 1080x935) — dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run; failing closed, color unchecked
  ```
- The poll keeps going: a keyboard that goes away before the deadline costs a round, not the verdict.
- `hidden`, `unknown`, a frame elsewhere, an edge that only touches the element, or no oracle (iOS) → the round
  proceeds exactly as before.
- `witness()` is not asked. It exists to veto a `back` press, and nothing is pressed here. A stale `shown` costs
  covered rounds until the window state catches up (seconds, measured on `KeyboardOracle.witness`), within the 12 s
  pixel default. Under a short explicit timeout it fails closed with the covered wording. Never a false pass.
- "Any overlap" is deliberate. ocr crops the whole rect; colour insets 12%, so a keyboard under only the bottom edge
  fails closed where colour could have measured. The sentence quotes both rects, so that case is plain to diagnose.
- Both rects are device pixels on Android: the tree's `bounds` and the IME `InsetsSource` `frame=` are read by the same
  `parseBounds` in `src/adapters/android.ts`.
- When every round was covered, the covered miss is the timeout's wording. It is the last finding, which outranks the
  silent rounds and not-found in `PixelPollMemory.timeoutDetail`, and a round the deadline cut before its query does
  not erase it. A later round whose query found the element clear DOES (review 2026-10-06): the covered sentence is
  then skipped, and that round's own outcome speaks — e.g. the cut sentence when its capture ran out of time.
- Residual: the old behaviour returns, silently, when the oracle cannot see the keyboard. A floating or split IME
  supplies no insets frame (it reads hidden, or a zero-size frame read as unknown); the API 34+ `type=ime` line comes
  from AOSP and has not been captured on a device; a multi-display device reads unknown.

**Cost.** One `dumpsys window displays` per round, tens of ms, on Android only, against a round of ~2.6–4.3 s there.
A round that begins past the deadline asks nothing. The quoted round cost includes the query; its wording ("a tree read and
its captures") is unchanged.

**Regression tests.**
- In `tests/verify/assert.test.ts`, "pixel asserts under the Android soft keyboard":
  - a covering keyboard: color and ocr FAIL with the exact sentence; no screenshot is taken; the recognizer is not
    called; four queries in a 1 s budget at a 300 ms poll; the witness is never asked; no key is pressed. The colour
    test expects `#FFFFFF` over a white screenshot, so a measurement would have passed;
  - a keyboard shown below the card, and one flush with its bottom edge: both pass, one query, two captures;
  - `hidden` and `unknown`: pass, one query;
  - covered in round 1, hidden in round 2: passes, with two tree reads, two queries, two captures and the sleeps
    `[300, 300]`;
  - covered in round 1, hidden in round 2 whose one capture the deadline cuts: the timeout is the cut sentence, not
    the covered one;
  - covered, then clear (measured, wrong), then covered again: the covered sentence is the timeout's wording again.
- No oracle: unchanged, pinned by every existing color/ocr test (e.g. `passes on a matching fill and reports the
  sampled hex, dE and scale`).
- `rectsOverlap` unit tests in `tests/ui-tree/geometry.test.ts`: the device case, either order, a 1x1 corner; below,
  flush with an edge, a corner touch and zero-area all read as no overlap.

**Mutation checks (all killed).** The check removed; edge contact counted as overlap; any shown frame counted as
covering; the check moved before the deadline check; the witness asked as well; the covered round made silent;
`unknown` treated as covered; the two rects swapped in the sentence; overlap tested on one axis only; the stale
covered sentence still winning; the clear round never recorded; a pre-query cut clearing the cover; the old remedy
wording; a new covered round not re-arming after a clear.

**Device check.** Not run yet: the fix is verified against the fake oracle only.

## Device check of the fix (2026-10-06 evening, `f1f9ba8`, finportal)

Setup: finportal login screen on Android `emulator-5554` (API 33). Focusing `login_username` raises Gboard over
`login_submit`. The tree keeps `login_submit` at `99,1400 300x132`.

Results:
- **Keyboard up, explicit `timeout: "4s"`:** color twice and ocr once. Each FAILED closed with the exact sentence:
  `the soft keyboard covers the element (element 99,1400 300x132, keyboard 0,1398 1080x822) — dismiss it (…) and
  re-run; failing closed, color unchecked`. The ocr version ends in `rendered text unchecked`. The keyboard frame matches
  the screenshot. The keyboard's pixels were no longer reported.
- **`login_title` above the keyboard:** PASS (5.7 s). The guard raised no false cover.
- **After `back` hid the IME:** PASS (5.6 s). On finportal, back only hid the IME; it did not navigate.
- **Keyboard hidden ~3.5 s into an assert:** PASS in 5.0 s.
  - A `dumpsys` loop logged every ~40 ms showed `visible=false` ~0.45 s after the key. The stale full frame lasted another
    ~0.7 s with `visible=false`.
  - The oracle decides on `visible=` alone, so no long stale "shown" was observed.
- **iOS:** no oracle and no soft keyboard (hardware keyboard), so behaviour is unchanged. PASS, with no covered sentence.

Not exercised: a floating or split IME, API 34+, multi-display (the recorded residuals).
