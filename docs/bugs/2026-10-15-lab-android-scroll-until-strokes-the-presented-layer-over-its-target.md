# BUG: `scroll_until` on Android, for a target beneath a presented layer (an AlertDialog, a half-expanded ModalBottomSheet), strokes the screen anyway — the first stroke DISMISSES the dialog (it lands on its dim) or EXPANDS the sheet, so the layer the caller did not ask to touch is gone or changed; `tap` waits 5 s for the element "to appear" without naming the layer either

> **Status (2026-10-18):** fixed on `arch/r22-l1` in `d43df5d` for the AlertDialog and the half-expanded sheet; the
> fully expanded sheet (`form-picker`) stands. The uiautomator root carries `activeWindowOnly` (the dump lists the
> active window only), and the parser marks that window presented — `dialog` when it floats off the screen's top and
> left edges, `screen` when its clickable, labelled scrim lies screen-wide above its sheet (adapters/android.ts
> #presentedWindow). `scroll_until` for a target not in the tree then stops before any stroke ("… — a dialog is
> presented over it — close it first, and a swipe would land on the dialog, so none was sent"), and the tap's wait ends
> "Timed out after 5000ms: element … is not in the tree, which lists only the window presented on top … — close it
> first" instead of "to appear". Measured by golden replay from truth/round-6 with `--side` that commit: the 16 rows
> of `alert-dim.xml` and `sheet-medium.xml` A–D `tap` and `scroll_until` turned green (242 → 226 mismatches, no other
> row changed); their colour rows stay KNOWN (the assert's "not found" is vacuous). `form-picker`'s expanded country
> sheet dumps no scrim, so it is not marked: its rows stay KNOWN, filed as this note, which calibration.json calibrates
> partially (the AlertDialog and the half-expanded sheet; the fully expanded sheet open) — ADR 0018's residual 18 for
> it awaited the owner (round 6's code review, P1; decided below). Not yet re-measured on the emulator. docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md, "Amendment: Android's presented
> window".
>
> **Live (2026-10-18, round 6's Android device check):** confirmed on the emulator for the AlertDialog and the
> half-expanded sheet. The live golden gained a `scroll_until` case per target beneath a presented layer in no scroll
> view (live-visibility.ts#judgePresentedScroll: any touch the app logs is a stroke on the layer), run on the
> `averi_lab` AVD with the lab app of truth/round-6 at round 5's src (`--side` b71cbbb) and at round 6's (e98b87e):
> before, `alert-dim` A–D and `sheet-medium` A–B stopped "fully visible after 1 swipe" — the one stroke (touch-down
> `540,444` or `540,1776`) DISMISSED the layer (`dismissed alert`, `dismissed sheet`) and the tap then found the
> target; `sheet-medium` C–D sent three strokes at `540,1776` that EXPANDED the sheet (S from y 1353 to 243) and failed
> "never appeared in the tree". After: all eight `stopped before any swipe — element is not in the tree, and the next
> swipe would touch down at (540,444) on the dim outside container (155,851 770x517) — a dialog is presented over it —
> close it first` (the sheet: `… on other "Close sheet" (0,0 1080x1110) — a screen is presented over it (a modal or a
> sheet) — close it first`), the app logging no touch, nothing dismissed; the eight taps refused with "is not in the
> tree, which lists only the window presented on top … close it first". docs/truth/live-android-2026-10-18-visibility.md,
> docs/truth/live-records/android-vis.json (and android-vis-b71cbbb.json). `form-picker`'s fully expanded sheet has no
> live case (no coloured target): unmeasured live, still open.
>
> **Decided (2026-10-18, the owner):** ADR 0018's residuals 18 (the fully expanded sheet) and 19 (the shapes measured
> on one AVD) ACCEPTED, with an honest hint: the uiautomator replies that say a target is not in the tree and are not
> already given the presented window's words — the tap's, fill's and the presence check's "… to appear", `scroll_until`'s
> "element never appeared in the tree" — adds `(the tree lists only the active window: if a sheet or a dialog is open
> over the screen, close it first)` (ui-tree/miss.ts#ACTIVE_WINDOW_HINT, arch/r22-hint 9acbf77; ADR 0018's
> amendment "Android's presented window", decision 5). `form-picker`'s six rows are filed as residual 18 now
> (tests/differential/golden/forms.known.ts), the taps' class `not in the tree` (the hint says "close it first"; the
> reply is still a not-found) where it was "refused without close it first"; calibration.json's L1 leaves nothing open.
> Golden (sandbox, no OCR): 1322 checks / 228 mismatches / 0 broken / 86 skipped, as before — 24 Android rows' wording
> changed, no verdict.

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
- iOS idb has the same tree shape (only the presented layer listed; KNOWN in
  tests/differential/golden/presented.known.ts); whether its `scroll_until` strokes dismiss a SwiftUI alert was not
  measured here.
- Kept in the presented family's KNOWN list (tests/differential/golden/presented.known.ts) as `lab finding: …`,
  `as: bug:` this note, until fixed.
- Re-verified by replay at `8600176` (`arch/round-20` merged: round 19's alert fix, round 20's presented layer):
  unchanged — the same `Timed out … to appear`, `not found within 1 s` and two `input swipe 540 1776 540 444 1334`
  strokes for A–D on both cells. Round 20 reads the presented layer from the source's own facts; uiautomator's dump
  of the active window lists no layer beneath to judge.
- Also on the phase-2b form cell `form-picker` (2026-10-16, `android-averi_lab-api33/form-picker.xml`): the country
  picker, a ModalBottomSheet fully expanded over the form, is the only window uiautomator dumps; `tap` on the form's
  `name`, `country` and `submit` times out "waiting for element … to appear" (no "close it first"), and `scroll_until`
  strokes the sheet twice (`input swipe 540 1768 540 608 1162`). Their probes landed on the sheet's rows (a tap at the
  name field's centre chose `Åland Islands`). KNOWN in tests/differential/golden/forms.known.ts, `as: bug:` this note.
