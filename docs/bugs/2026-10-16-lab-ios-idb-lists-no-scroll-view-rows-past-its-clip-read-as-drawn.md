# BUG: under idb, a row past its scroll view's clip is judged on the screen alone — a row outside the scroll view is `Tapped` on the background and its colour assert PASSES on the background, a sliver is `Tapped`, and both stops call cut rows "fully visible"

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
