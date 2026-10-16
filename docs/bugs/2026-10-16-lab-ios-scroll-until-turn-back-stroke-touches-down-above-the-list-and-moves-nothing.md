# BUG: on iOS, after a fling carries the target past the screen's top, `scroll_until`'s turn-back strokes touch down above the list (in the header) and move nothing — four strokes, then "content exhausted"

> **Status (2026-10-16):** fixed under WDA on branch `arch/r21-strokes` (from `debc9b2`), with LE4
> (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md, the same root: WDA's empty
> clipping chain, see its status); unmeasured on a device. Every stroke for R — the turned one too — is now drawn over
> `list` and cut above the tab bar's items WDA lists over it: replayed, `201 645 → 311` twice, then the turned
> `201 335 → 537` (touch-down inside the list, below the header's 200). Not fixed under idb, which lists no scroll
> view (LE2): its turned stroke still touches down at y 175. What the evidence can show: the static golden replays
> one unmoving tree, so it never sees the fling and never turns on its own — its `tabbar-floating` rows show only that
> the forward strokes moved into the list (the third, turned call above is the stuck turn's, not the fling's); the
> differential replays recorded device trees the same way. The turn after a fling is pinned by a unit test
> (tests/interact/scroll-rounds.test.ts, "a WDA target's strokes go over its own scroll view"); that it moves the
> list on a device is for the live golden (scripts/truth/live.ts, case `scroll:tabbar-floating.R`).

Lab note LV3. **Measured 2026-10-16** on the `averi-lab iPhone 17` simulator (iOS 27.0, 402x874), averi =
`arch/round-20`'s `src/` (`debc9b2`), through the live golden (`scripts/truth/live.ts --udid … --groups visibility`,
both tree sources), the lab app's `tabbar-floating` cell (fixtures/apps/ios/AveriLab/Bars.swift). The app's own scroll
offset, stroke log and touch log (LabState.offsets, .strokes, the `touch` events — round 4) are the oracle. Summary:
docs/truth/live-ios-2026-10-16-visibility.md (case `scroll:tabbar-floating.R`, wda and idb alike; the figures below are
that run's).

## Observed (measured)

`tabbar-floating`: a 200-pt header (`Header`, not scrollable), then the list (`list`, clip 0,200 402x640) with R at its
content y 521 — lying under the floating tab bar (743–830), `under-chrome:tabBar`.

```
scroll_until { selector: 'id:"lab.tabbar-floating.R"', direction: 'down' }                          (idb)
→ ERROR scroll_until id:"lab.tabbar-floating.R" failed after 5 swipes (the last 2, swiping up, did not move it: content
  exhausted, or the swipes were not taken) — element was in the viewport before the first swipe but did not stay (a
  fling?) — in tree, off the 402x874 viewport at the last read (last rect {"x":24,"y":-391,"width":354,"height":52}). It
  was turned round 1 time: a swipe carried it past the viewport (a fling), …, so the next was drawn the other way
app: list offset 1111.7 (launched 0); strokes list 0→1111.7 (one); R 24,-390.7 354x52 (off-screen)
touches (201,699) (201,175) (201,175) (201,175) (201,175)

(wda: the same reply, last rect y -359; list 0→1079.7, R at -358.7; the same five touches)
```

The first stroke (touch-down at y 699, inside the list) flings the list 1080–1112 pt and carries R off the top — averi
sees it and turns. Every turned stroke touches down at y 175: above the list's top (200), in the header, which scrolls
nothing. Four strokes move nothing; the reply calls the content exhausted, with all of that offset to scroll back.

## Cause (as first inferred; see the status above for the cause found)

The strokes are the screen's default band (80 % ↔ 20 % of its height: 699 ↔ 175), turned by swapping its ends — not
drawn inside the target's own scroll view, which WDA lists (`list`, 0,200 402x640). The same root as
docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md (LE4: the forward stroke
touching down below a bounded scroll view); here the forward stroke happens to start inside the list and only the
turn lands outside it. Under idb, which lists no scroll view (LE2's note), averi has nothing to draw the stroke in.

## Why it matters

A list under a header — the common screen — loses every target a first fling overshoots: the turn is right, the stroke
is not, and the failure blames the content. The static golden cannot see it: the replayed tree never moves, so the
turn never happens there (R-stroke judges the forward strokes, which touch down inside the list).

## Expected

Strokes drawn inside the target's scroll view (as the flush probe already is, swipe.ts#strokeRoom), the turned stroke
too — at least under WDA, whose tree names the scroll view; under idb, a turned stroke whose touch-down stays inside
the region the forward stroke moved.

## Notes

- Live only. Listed in scripts/truth/calibration.json `excluded`.
