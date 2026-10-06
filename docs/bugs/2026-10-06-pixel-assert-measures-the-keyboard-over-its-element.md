# BUG: a `color`/`ocr` assert on an element under the Android soft keyboard measures the keyboard

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
