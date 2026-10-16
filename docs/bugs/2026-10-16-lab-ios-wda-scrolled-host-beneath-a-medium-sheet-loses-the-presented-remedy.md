# BUG: under WDA, beneath a SwiftUI medium sheet over a SCROLLED host, a target wholly off the screen, wholly under the status bar or a 5-pt sliver at the bottom edge gets scroll or status-bar advice again, and `scroll_until` swipes the sheet — a regression of round 20's presented-layer marks (41c394a) on the shape #30, #32 and #34 fixed

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/sheet-medium-edges.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402×874 pt, WDA on port 8120). averi = `truth/b3-presented` on
`arch/round-20`'s `src/` (`debc9b2`). Phase 3, batch B3 (presented), calibrating
calibration.json #30, #32 and #34.

## The cell

`presented/sheet-medium-edges` (fixtures/apps/ios/AveriLab/Presented.swift#ScrolledHost): a SwiftUI `ScrollView` over
the whole screen, scrolled 200 pt down on appear, a sheet at the medium detent presented over it (no content of its
own). Its four targets, all beneath the sheet (the truth's measured geometry):

| target | frame | geometry | probe |
|---|---|---|---|
| H | 51,-88 300x64 | off-screen (above) | never tapped (centre off the screen) |
| G | 51,-20 300x64 | status-band (wholly under the 62-pt status bar) | (201,12): no touch, swallowed by the status bar |
| E | 51,869 300x64 | sliver (5 pt at the screen's bottom, under the sheet) | never tapped (centre off the screen) |
| F | 51,1009 300x64 | off-screen (below) | never tapped |

WDA's tree is the phase-1 `sheet-medium`'s (where A–D are refused "close it first" at HEAD), with the targets in a
`ScrollView` (`0,0 402x874`, its content `0,-200 402x1600`) and every node of the layer beneath `isVisible=0`; the
sheet's layer follows, a visible `Other 0,0 402x874` holding `PopoverDismissRegion` (`dismiss popup`,
`-402,-874 1206x2622`) and the sheet's `8,415 386x451` panel.

## Observed (replayed at debc9b2)

```
tap H  → ERROR … is off screen at (201,-56) on a 402x874 screen (rect 51,-88 300x64) — scroll_until it first; nothing was tapped
tap G  → ERROR … is under the status bar at (201,12), in the top 62 of the screen (tree units), where a tap goes to the status bar
         (rect 51,-20 300x64) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped
tap E  → ERROR … is off screen at (201,901) … only 8% of it (rect 51,869 300x64) is on screen … — scroll_until it with fully: true first
colour G → FAIL … the status bar is drawn over the element … — scroll_until the element with `fully: true` first and re-run — …
colour E → FAIL … container "dismiss popup" (-402,-874 1206x2622) is drawn over the element … — scroll_until the element with
           `fully: true` first and re-run — …
scroll_until F → failed after 2 swipes … element in tree but never intersected the 402x874 viewport     (idb ui swipe 201 699 201 175 ×2)
scroll_until E → failed after 3 swipes — element is in the viewport but CLIPPED at bottom …            (3 strokes, two of them from 699)
scroll_until G → failed after 3 swipes — its centre stays under the status bar …                        (201 175 → 201 437 ×2, 201 699 → 568)
```

All 12 rows are red: every tap and colour assert gives scroll or status-bar advice (no "close it first"), and every
`scroll_until` swipes, touching down on the sheet's dim (on the device a stroke from y 699 lands in the sheet and moves
it to another detent; #32's note). The colour asserts fail, so no false PASS: #30's own symptom does not return.

## When

A first-parent sweep of golden over `arch/round-20` (`--side <sha> --only sheet-medium-edges.wda`):

| commit | red rows |
|---|---|
| 753b560 (fix/r17-presented, #30 and #34's fix) … c9ae31c, 20b800a (fix/r20-fold) | 0 of 12 — every reply "close it first", every scroll stopped before any swipe |
| 41c394a (fix/r20-marks: "WDA marks the presented layer …, a marked layer covers only outside itself, the shape rule is not asked of a judged tree") … debc9b2 | 12 of 12 |

So `scripts/truth/calibration.json` #30, #32 and #34 calibrate (red before their fixes, green after), and the rows are
red again from 41c394a. The same merge turned `dim-cover` and `sheet-background` green (#27, #28).

Two replays of an edited copy of the tree change nothing (still 12 of 12 red): the scroll view's trailing children (two
`0,0 402x874` containers, two scroll bars) removed; the `ScrollView` retyped `Other`. So it is not the scroll view as
such; the phase-1 `sheet-medium` targets (whole, on the screen under the dim) keep their remedy — the difference is
that nothing of H, G, F lies in the screen's frame beneath the sheet, and E's only part on the screen is under the dim
at the bottom edge.

## Expected (ADR 0018, amendment "presented judged of the node")

Each of the four is told "close it first" by tap, the pixel asserts and `scroll_until`, whatever else keeps it from a
tap — off the screen, under the status bar, a sliver — and `scroll_until` sends no stroke that touches down on the
sheet. As at 753b560 … 20b800a.

## Notes

- Kept in tests/differential/golden/presented.known.ts as `bug:` this note (the 12 WDA rows of sheet-medium-edges).
- idb lists only the presented layer (as on `sheet-medium`): its rows are the KNOWN "not in the tree" shapes, not this
  note's.
- G's probe: on iOS the status bar swallows a raw tap in the top of its band — measured on the `open` cell with raw
  `idb ui tap 201 y` (no touch at y ≤ 50, a touch at y ≥ 55 of the 62-pt band; truth.ts `IOS_STATUS_BAR_SWALLOWS_ABOVE`,
  `statusBarMaySwallow`), and G's probe at (201,12) here left none.
