# BUG: under idb, a row past its scroll view's clip is judged on the screen alone — a row outside the scroll view is `Tapped` on the background and its colour assert PASSES on the background, a sliver is `Tapped`, and both stops call cut rows "fully visible"

> **Status (2026-10-22, round 16): the harmful remainder fixed at `19525e29` + `9fd4aff2` (bugs/r16-le2); the rest still ADR 0010's
> residual 5, now narrowed to "nothing listed beneath".** The shape that fired a control: under idb a row past its clip,
> listed BEFORE a control under the clip whose top lies above the row's (`Continue 16,600 370x56`, listed after the row)
> and which holds the row's centre — ADR 0015's reading-order break excused Continue as a cover, so `tap O` was
> `reachable` at (201,652), on Continue, and `Tapped O` FIRED it; the colour passed on Continue's colour, the plain stop
> said visible. A control past the break that overlaps the target and holds its centre is now a cover whose order is
> not told (`reading-order.ts#ReadingOrder`'s `coversAfter`, read by the break's own row `draw-order.ts#NOT_DRAWN`'s
> `flatListReadingOrder` since the branch's review; ADR 0015 amended 2026-10-22, ADR 0024's third trigger). It asks the
> eyes of 3 nodes over the 128 trees of the committed corpus: this O, the lab menu's W in `blur-menu-grouped` (its
> screenshot sees W on top: verdicts unchanged, one screenshot per tap and plain stop where there was none), and
> mp-native's chooser `row_swift` — refused unless the eyes see it on top, and on real pixels they cannot: a false
> refusal ACCEPTED as a residual (ADR 0015's amendment, its residuals; measured on the chooser's lab rebuild, below).
> Measured on the new lab
> cell `scroll-bounded-footer` (O; its idb and WDA captures in tests/fixtures/truth/ios-iphone17-ios27) — the colour
> assert fails closed, the plain stop refuses before any swipe, the tap is moved clear of Continue to (201,670) and
> fires nothing (live, idb, docs/truth/live-records/ios-vis-r16-le2-1.json; at the base the app logged
> `button footer.continue`); golden against `4ee14f1c`: 1425 checks, 0 changed; WDA answers all three rows as the truth
> does. Still the residual, KNOWN: the row's tap says `Tapped`, on the background below the clip, and no swipe is sent.
>
> **Code review (2026-10-22, round 16):** the chooser's cost measured on real pixels. The lab cell
> `presented/chooser-over-list` rebuilds mp-native's chooser at its geometry (a white card `24,381 354x140` of white
> option rows O `45,397` and S `45,453` (312x52) over a list dimmed 40 %, R `24,435 354x52` holding S's centre; idb lists the card's
> rows first): the eyes cannot tell S over R — overlap, S's band and R's bands all the card's white ("it shows the colour
> around it #FFFFFF beside the overlap") — so under idb S's tap, plain stop and colour assert refuse, nothing tapped, no
> swipe; live, `tap S` refused and nothing fired in two runs of two (docs/truth/live-records/ios-vis-r16-le2-2.json,
> -3.json); WDA taps S. ACCEPTED as a residual by the orchestrator: the refusal is the safe direction against a tap that
> fired the wrong control; one screenshot per tap and plain stop on such a row; remedy `treeSource: wda`. The live cases
> of this note ran again at the final src (the same -2/-3 records): O's tap moved clear to (201,670), nothing fired; the
> plain stop refused before any swipe; under WDA refused, then reached by a stroke. Also KNOWN (ADR 0024's third
> trigger): the refusal's remedy is worded for a menu — "if it is the one on top, tap it by coordinates" at O's centre
> would press Continue; `treeSource: wda` is the right one there.

> **Status (2026-10-20, round 14): partly fixed; the rest an accepted residual (ADR 0010's residual 5).** Fixed at
> `11daf08` (bugs/r14-le2), measured by the golden mode (against `3b6d2b0a`: exactly the four rows below changed, all
> green), calibrate (CALIBRATED, `3b6d2b0` → `11daf08`) and the lab simulator (two runs,
> docs/truth/live-records/ios-idb-vis-r14-le2-1.json, -2.json). idb's drawn frame is now UNTOLD
> (`ui-tree/geometry.ts#DrawnUntold`), and the eyes look where a claim rests on it: O's colour (`#FFFFFF`) and C's
> (`#EEEEEE`), whose region reads as the screen beside it, fail closed — "its region reads as the screen beside it …
> idb lists no scroll view to say it is drawn there … measure it under treeSource: wda" (`verify/eyes.ts#apartOfFrame`,
> on the frame the assert measures); P's and S's `fully: true` stops see the clip line on one screenshot (bottom 24 pt,
> 56 pt) and fail — "cut at the edge of a scroll view the tree does not list". Live, P.fully and S.fully no longer
> claim a stop (P: two strokes over the screen move nothing; S: the case's tap then Tapped on the background). Accepted
> (ADR 0010's residual 5, the cost of a screenshot per tap or plain stop under the default tree source): S and O
> `Tapped` on the background, S and O reached by the plain stop, F's and C's strokes over the screen — their rows filed
> as that residual; `treeSource: wda` answers every row as the truth does.

> **Status (2026-10-18, round 6's iOS device check):** open; two more rows. carousel-in-list's iOS capture adds C, a
> card wholly right of its carousel's clip (378,138 354x85 against 24,138 354x85) with 7 % of it on the screen: under
> idb its colour passes on the page's background (#EEEEEE), and scroll_until strokes sideways across the screen's
> middle, `322 437 → 80 437` twice and one back, outside the carousel ("content exhausted … a layout defect"); live
> the same (`ios idb scroll:carousel-in-list.C`, KNOWN). WDA answers all of C's rows as the truth does.

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/scroll-bounded.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `truth/b2-edges` on `arch/round-20`'s
`src/` (`debc9b2`). Replayed only; what a tap there does is the capture's own probe on the simulator. The WDA capture of
the same screen is judged as the truth says on every row.

## The screen

`scroll-bounded` (fixtures/apps/ios/AveriLab/Edges.swift): two bounded SwiftUI `ScrollView`s, `upper` `0,110 402x220`
and `lower` `0,380 402x180`, each target a 300x64 button at a fixed place in its content, scrolled to 0. The app's own
frames (`scroll-bounded.truth.json`):

| target | frame | geometry (truth.ts#geometryOf) | probe at its centre |
|---|---|---|---|
| `P` | `51,290 300x64` | `partly-centre-in` — cut at `upper`'s bottom (330): 40 of 64 drawn | fired |
| `S` | `51,552 300x64` | `sliver` — cut at `lower`'s bottom (560): 8 pt drawn, under the 24-pt minimum | at `(201,584)` not fired (the background); at its piece `(201,556)` fired |
| `O` | `51,620 300x64` | `outside-scroll-view` — wholly below `lower` (560), on the screen | at `(201,652)` not fired; the screenshot shows the white background there |

idb lists the five targets flat, each at its laid-out frame (`scroll-bounded.idb.json`: `P {{51, 290}, {300, 64}}`,
`S {{51, 552}, {300, 64}}`, `O {{51, 620}, {300, 64}}`), and NO scroll view — nothing in the list says where either
scroll view's clip lies. WDA lists both `ScrollView`s with their frames, the targets beneath them (`O` and `F` with
`isVisible 0`).

## Observed (replayed)

```
idb  tap { selector: 'id:"lab.scroll-bounded.O"' }
→ Tapped id:"lab.scroll-bounded.O"
device: idb ui tap 201 652                         ← the background below the scroll view: nothing fires
idb  assert [{ element: { id: "lab.scroll-bounded.O" }, color: { expected: "#FFFFFF" } }]
→ All 1 asserts passed — PASS … sampled #FFFFFF (dominant, 100% of region) vs expected #FFFFFF → dE00 0.00 ≤ 8
idb  scroll_until { … O, direction: "down" }               → Element id:"lab.scroll-bounded.O" fully visible after 0 swipes

idb  tap { … S }                                           → Tapped id:"lab.scroll-bounded.S"   (idb ui tap 201 584: nothing fires)
idb  scroll_until { … S, direction: "down" }               → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
idb  scroll_until { … S, direction: "down", fully: true }  → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
idb  scroll_until { … P, direction: "down", fully: true }  → Element id:"lab.scroll-bounded.P" fully visible after 0 swipes

wda  the same calls → O: "is outside its scroll view scrollable (0,380 402x180) at (201,652): nothing of it is drawn …
     — scroll_until it first; nothing was tapped"; the colour "nothing of the element is drawn … failing closed";
     S: "only 13% of it … is drawn … — scroll_until it with fully: true first; nothing was tapped"; P and S `fully`:
     "CLIPPED at bottom by its scroll view …" (ERROR)
```

The colour row is the one docs/bugs/2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes.md
reported under WDA (fixed for WDA by `b7eac90`): under idb it still passes on whatever lies beneath.

## Expected

What WDA answers (above); or, where idb cannot see the clip, an answer that does not certify what it cannot see — no
`Tapped` on a point where nothing of the target is drawn, no PASS on pixels that are not the element's.

## Cause (read from the source, not changed here)

`src/ui-tree/geometry.ts#Clips.drawnIn` is undefined "on idb's flat list, which lists no scroll view (a residual: its
rows below a short scroll view are judged on the screen alone)", and `scrollersOf` is empty on a flat list, so neither
the sliver rule (ADR 0013) nor the `fully` probe has a container to judge by. The src comment calls it a residual; no
ADR records that decision, so it is filed here as an open finding with its rows.

## Possible fix directions (owner's choice)

- Record the residual as a decision (an ADR: under idb a row is judged on the screen alone), and have the replies say
  so where it matters — a colour/ocr PASS and a `fully` stop under idb on a node idb cannot place in a scroll view.
- Or read the clip from elsewhere: idb's frames are WDA's (both are the accessibility frames), so a tree source that
  lists the scroll views (WDA) is needed for the judgement; under `treeSource: idb` the check could fall back to it for
  a colour assert or a `fully` stop.

## Rows (golden, KNOWN in tests/differential/golden/edges.known.ts)

`ios-iphone17-ios27/scroll-bounded.idb.json P fully`, `S tap`, `S scroll_until`, `S fully`, `O tap`, `O colour`,
`O scroll_until`, and `F scroll_until` (the screen's stroke, `201 699 → 175`, touches down below `lower`, the scroll view
that holds `F`; under WDA the same stroke is docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md).
Round 6: `ios-iphone17-ios27/carousel-in-list.idb.json C colour` (passed on #EEEEEE) and `C scroll_until` (touched down
outside its scroll view carousel at (322,437) (322,437) (80,437)), in calibration.json's LE2 `checks`.
