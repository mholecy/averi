# BUG: `scroll_until` on Android, for a target beneath a presented layer (an AlertDialog, a half-expanded ModalBottomSheet), strokes the screen anyway — the first stroke DISMISSES the dialog (it lands on its dim) or EXPANDS the sheet, so the layer the caller did not ask to touch is gone or changed; `tap` waits 5 s for the element "to appear" without naming the layer either

**Found 2026-10-15** by the golden mode (scripts/differential/golden.ts) over the Android lab app's ground truth
(`tests/fixtures/truth/android-averi_lab-api33`, captured by scripts/truth/capture-android.ts on a dedicated
`averi_lab` AVD, Pixel 3a profile, Android 13 / API 33, 1080x2220, Gboard hidden). averi = mobile-verify
`truth/phase-0-1` on `arch/round-20`'s `src/` (`debc9b2`; no other `src/` change on the branch — first seen on
`truth/android` with `dda435b`'s, unchanged since). The stroke's effect was then reproduced on the emulator with the
same raw `adb shell input swipe` averi sent.

## Why the tree does not show the targets

`uiautomator dump` lists the ACTIVE window only. With a Compose `AlertDialog` up, that is the dialog's window
(`[155,851][925,1368]`, the title, the message, Keep / Discard) — the screen beneath, targets A–D, is not in the dump.
With a `ModalBottomSheet` up, it is the sheet's full-screen window: the scrim (`content-desc="Close sheet"`, clickable,
`[0,0][1080,1110]`), the drag handle and the sheet's own target S. Both trees say a layer is presented (a root window
smaller than the screen; a full-width clickable `Close sheet` scrim above the sheet), but averi reads neither as such.

## Observed (replayed, then the stroke on the device)

Truth (`alert-dim.truth.json`, `sheet-medium.truth.json`): targets A–D are declared `presented-over`; a raw tap at their
centre never fires them (the probe logged `dismissed alert` / `dismissed sheet` / `tap S` instead), and 0 % of their
frame is drawn in their own colour.

```
scroll_until { selector: 'id:"lab.alert-dim.D"', direction: "down" }
→ [isError] scroll_until id:"lab.alert-dim.D" failed after 2 swipes (the last 2, swiping down, did not change the
  screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
device: wm size | dumpsys window displays | uiautomator dump | … | input swipe 540 1776 540 444 1334 | uiautomator dump
        | … | input swipe 540 1776 540 444 1334 | uiautomator dump | …
tap { selector: 'id:"lab.alert-dim.A"' }
→ [isError] Timed out after 5000ms waiting for element id:"lab.alert-dim.A" to appear          (11 dumps)
```

The same on `sheet-medium` (A–D): two strokes `540 1776 → 540 444`, "never appeared in the tree"; `tap` times out.

The replay's tree is static, so it shows the strokes and not what they do. On the emulator, the cell launched fresh and
one `adb shell input swipe 540 1776 540 444 1334` sent:

- `alert-dim`: the stroke starts on the dim outside the dialog's window; Compose's dialog dismisses on a touch outside.
  The app logs `{"kind":"dismissed","tag":"alert"}`, and the next dump lists `lab.alert-dim.A`…`D`. A live
  `scroll_until` would then find D in its next read and answer it REACHED — having closed the user's alert on its way,
  with nothing in the reply saying so.
- `sheet-medium`: the stroke starts inside the half-expanded sheet and drags up: the sheet expands to full height (S's
  frame moves from y 1353 to y 243). The layer stays, changed; the targets stay beneath it.

## Expected (the golden spec, ADR 0018's rule as on iOS)

A target beneath a presented layer: `tap` refused with `close it first`, nothing tapped; `scroll_until` stops before
any stroke, `close it first`. Neither verb should send a gesture that lands on the layer. The Android tree carries the
evidence (the dialog's window smaller than the screen; the sheet's `Close sheet` scrim), but the target is not in the
tree at all, so the rule needs "the tree is a presented window" rather than "this node lies under a cover".

## Notes

- Not a false `Tapped`: the tap refuses (by timeout). The cost is the 5 s wait and a reply that blames the element
  rather than the layer.
- iOS idb has the same tree shape (only the presented layer listed; KNOWN in tests/differential/golden.test.ts); whether
  its `scroll_until` strokes dismiss a SwiftUI alert was not measured here.
- Kept in golden.test.ts's KNOWN list as `lab finding: …` until fixed.
- Re-verified by replay at `8600176` (`arch/round-20` merged: round 19's alert fix, round 20's presented layer):
  unchanged — the same `Timed out … to appear`, `not found within 1 s` and two `input swipe 540 1776 540 444 1334`
  strokes for A–D on both cells. Round 20 reads the presented layer from the source's own facts; uiautomator's dump
  of the active window lists no layer beneath to judge.
