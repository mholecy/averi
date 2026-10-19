# BUG: under WDA, beneath a SwiftUI medium sheet over a SCROLLED host, a target wholly off the screen, wholly under the status bar or a 5-pt sliver at the bottom edge — and even one whole on the screen under its dim — gets scroll or status-bar advice again, and `scroll_until` swipes the sheet — a regression of round 20's presented-layer marks (41c394a) on the shape #30, #32 and #34 fixed

> **Status (2026-10-17):** fixed, and measured so live by round 5's device check (src `b71cbbb`, WDA;
> docs/truth/live-records/ios-vis-2725e76.json, summary docs/truth/live-ios-2026-10-17-visibility.md): `scroll_until` H and G
> beneath the sheet stop before any swipe — "a screen is presented over it … close it first" — no touch logged, the
> host left at its offset 200, nothing dismissed; the taps of G, E (and the cell's others) refused with "close it
> first". Their live KNOWN entries struck off.
>
> **Status (2026-10-16):** fixed on `arch/r21-presented` (round 5 of phase 3, task 0b): the cause was not the scrolled
> host but the EMPTY sheet — the flags rule walked past a layer with no non-structural element (ADR 0018's residual 7),
> and the judged tree asks no shape. See "Fix" below; the 15 WDA rows of `sheet-medium-edges` are green.

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/sheet-medium-edges.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402×874 pt, WDA on port 8120). averi = `truth/b3-presented` on
`arch/round-20`'s `src/` (`debc9b2`). Phase 3, batch B3 (presented), calibrating
calibration.json #30, #32 and #34.

## The cell

`presented/sheet-medium-edges` (fixtures/apps/ios/AveriLab/Presented.swift#ScrolledHost): a SwiftUI `ScrollView` over
the whole screen, scrolled 200 pt down on appear, a sheet at the medium detent presented over it (no content of its
own). Its five targets, all beneath the sheet (the truth's measured geometry):

| target | frame | geometry | probe |
|---|---|---|---|
| H | 51,-88 300x64 | off-screen (above) | never tapped (centre off the screen) |
| G | 51,-20 300x64 | status-band (wholly under the 62-pt status bar) | (201,12): no touch, swallowed by the status bar |
| E | 51,869 300x64 | sliver (5 pt at the screen's bottom, under the sheet) | never tapped (centre off the screen) |
| F | 51,1009 300x64 | off-screen (below) | never tapped |
| M | 51,290 300x64 | whole, on the screen under the dim (the positive control, added in review) | (201,322): its touch logged, `dismissed sheet`, not reached |

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
tap M  → ERROR … is under container "dismiss popup" (-402,-874 1206x2622) at its centre (201,322), drawn over it; nothing of it
         shows — scroll_until it first …
scroll_until M → failed after 3 swipes — element is in the viewport but under container "dismiss popup" …  (201 699 → 175 ×2, 175 → 437)
```

All 15 rows are red: every tap and colour assert gives scroll or status-bar advice (no "close it first"), and every
`scroll_until` swipes, touching down on the sheet's dim (on the device a stroke from y 699 lands in the sheet and moves
it to another detent; #32's note). The colour asserts fail, so no false PASS: #30's own symptom does not return.

## When

A first-parent sweep of golden over `arch/round-20` (`--side <sha> --only sheet-medium-edges.wda`):

| commit | red rows |
|---|---|
| 753b560 (fix/r17-presented, #30 and #34's fix) … c9ae31c, 20b800a (fix/r20-fold) | 0 of 15 — every reply "close it first", every scroll stopped before any swipe |
| 41c394a (fix/r20-marks: "WDA marks the presented layer …, a marked layer covers only outside itself, the shape rule is not asked of a judged tree") … debc9b2 | 15 of 15 |

So `scripts/truth/calibration.json` #30, #32 and #34 calibrate (red before their fixes, green after), and the rows are
red again from 41c394a. The same merge turned `dim-cover` and `sheet-background` green (#27, #28).

Two replays of an edited copy of the tree (before M was added) change nothing (still 12 of 12 red): the scroll view's
trailing children (two `0,0 402x874` containers, two scroll bars) removed; the `ScrollView` retyped `Other`. M — whole
on the screen under the dim, as the phase-1 `sheet-medium`'s A–D, which keep their remedy at HEAD — is refused with
"scroll_until it first" too: so it is not where the target lies but this host (the targets in the scrolled content
`0,-200 402x1600`) beneath the marked sheet.

## Expected (ADR 0018, amendment "presented judged of the node")

Each of the four is told "close it first" by tap, the pixel asserts and `scroll_until`, whatever else keeps it from a
tap — off the screen, under the status bar, a sliver — and `scroll_until` sends no stroke that touches down on the
sheet. As at 753b560 … 20b800a.

## Notes

- Kept in tests/differential/golden/presented.known.ts as `bug:` this note (the 15 WDA rows of sheet-medium-edges).
- idb lists only the presented layer (as on `sheet-medium`): its rows are the KNOWN "not in the tree" shapes, not this
  note's.
- G's probe: on iOS the status bar swallows a raw tap in the top of its band — measured on the `open` cell with raw
  `idb ui tap 201 y` (no touch at y ≤ 50, a touch at y ≥ 55 of the 62-pt band; truth.ts `IOS_STATUS_BAR_SWALLOWS_ABOVE`,
  `statusBarMaySwallow`), and G's probe at (201,12) here left none.

## Cause (established 2026-10-16)

- Bisected with golden (`--side … --only sheet-medium-edges`): 20b800a 0 of 15 WDA rows red, 41c394a 15 of 15.
- The parse at debc9b2 (`parseWdaSourceValue` over the committed `sheet-medium-edges.wda.json`): the root is
  `presentationsJudged`, and NO layer is marked. `wda-source.ts#presentedScreen` finds the host's layer wholly
  `isVisible="0"` (beneath), then walks past the sheet's layer — `Other 0,0 402x874` holding `dismiss popup` and the
  card's nested `Other`s, all shown, none of a non-structural role — as "no content" (a bare dim, the input host's
  placeholder), and the Window ends: nothing marked. On a judged tree draw order asks no shape
  (`draw-order.ts#drawOrder`, `Seen.byShape` only without `presentationsJudged`), so the labelled dim that the shape
  rule had read as the sheet's surface (753b560 … 20b800a) presents nothing, and each target gets its own geometry's
  advice. `sheet-medium` keeps its remedy only because its sheet holds `Target S`, a Button.
- Corroborated on a copy of the tree: one visible `Button` added inside the sheet's card, and debc9b2 marks the layer
  `screen`. Neither the scroll view nor where the targets lie matters (the note's own two edited replays, which
  changed nothing, agree).
- So the suspect named for this task — `presentationsJudged` switching the shape fallback off wholesale — is the
  mechanism by which the gap shows, not the gap: the source's fact (the beneath wholly `0` under a shown later layer)
  was in the tree; the parser did not name the layer.

## Fix (2026-10-16, branch `arch/r21-presented`)

`wda-source.ts#presentedScreen`: in the app's Window (the payload's first), when a wholly `0` layer was walked past
and no content layer follows it, the first screen-sized layer after it with no content that SHOWS (some element BELOW
it — never the layer itself — `isVisible="1"` sharing area with the Window) is marked `screen`. A content layer after
the beneath still wins (even with an empty one between), a content leftover parked off the screen still marks
nothing; an empty layer with no hidden layer before it, a bare shown leaf (Contacts' sheet with the keyboard up ends
its Window with one, corpus run16-ios/contacts-sheet-keyboard-wda.json), a layer whose shown frames all lie off the
Window, and one in a later Window (the keyboard's or the input host's, wholly `0` while the keyboard is down) mark
nothing.
ADR 0018, "Amendment: a presented layer of only empty frames" (residual 7 closed for WDA); ADR 0019's summary of the
flags rule names it. Draw order is unchanged.

Golden vs debc9b2: the 15 `sheet-medium-edges.wda.json` rows (H, G, E, F, M × tap, colour, scroll_until) turn green —
every reply "close it first", every `scroll_until` stopped before any swipe — and no other row of the 1131 changes
(260 → 245 mismatches, 0 broken). Tests: tests/adapters/wda-source-presentation.test.ts (the empty sheet marked; a
content layer after it still the one marked; no mark without a hidden layer before it or with nothing of it shown, for
a bare shown leaf, for frames shown only off the Window, in a later Window; the first of two empty layers marked; draw
order reads all five targets of the scrolled host beneath as under a presented screen).

