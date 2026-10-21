# BUG: on iOS, after a fling carries the target past the screen's top, `scroll_until`'s turn-back strokes touch down above the list (in the header) and move nothing — four strokes, then "content exhausted"

> **Status (2026-10-21):** fixed under idb at `02aabfa6` (round 14, bugs/r14-lv3; prep `807cb30c`, lab cell
> `d805c5e4`; ADR 0010 residual 6, refined 2026-10-21). idb lists no scroll view, so the strokes take the region the
> target's motion showed (`interact/motion-shown.ts#MotionShown`: the nodes carried with it by its delta, two at least
> below the status band, cut at the chrome that held still across the rows), and `way`, the side the content moved
> toward at the first sample. A stroke carrying content back goes over the region (`goesOver`); one moving it `way`
> keeps the screen box. A stop is held short of the line such a stroke touches down on (`HeldBand`: on the `way` side
> and the side the last stroke pushed the content), or past the region toward a still node facing the rows
> (`carriedUnder`); a stuck or bound end says so, with `treeSource: wda`. No new state, no read added. Measured live
> at `02aabfa6`'s src by docs/truth/live-records/ios-vis-r14-lv3-dense-R-1…5.json (idb's `scroll:tabbar-dense.R`:
> (201,699), then (201,239) twice, Tapped R, five of five — once after a 4th stroke, (201,699), the fling having
> carried R into the band on the pushed side), -dense-L-1…3.json (its last row by the screen box's strokes as before,
> three of three), -floating-R-1…3.json (`scroll:tabbar-floating.R`: (201,699), then (201,391) three times, Tapped R,
> three of three, once after a 5th) and ios-vis-r14-lv3.json (the idb visibility group: 149 cases, 111 ok, 7 loud, 31
> mismatches, none not known; docs/truth/live-ios-2026-10-18-visibility.md, round 14 LV3). On a physics replay, per
> call against `e267ebfc` (41 grids, 46 660 calls): 1 new false stop (a 500-pt app scroll coinciding with the first
> stroke — a residual), 7 ok → fail (honest LOUDs), +1 stroke on about 1 % of calls; on the review's 61 grids more (a
> fling the read after a stroke sees only part of, short lists, deeper drifts: 102 372 calls) 5 — four the same
> residual, one a bar no node names reached through the turned strokes — and 85 ok → fail, all honest LOUDs; under a
> fling the strokes catch (the 30 fling grids, 51 860 calls) 6, one the same residual at a 300-pt app scroll, five a
> replay start past the list's end, and 51 ok → fail, all honest LOUDs. Live, an `up` call to the page's top pays
> strokes: the turned stroke pushes the content up and the confirming read holds the target in that side's band, so
> the strokes alternate until it lies past the line (`scroll-top-edge` T 1 → 4–6 swipes against round 7,
> carousel-in-list B 2 → 4; all Tapped). The last stroke's side is banded on every read until the next stroke
> (`State.lastDrawn`), not only on the read right after it: a fling carries the target into that side's band before
> the confirming read that claims a stop (100 new false stops on the fling grids otherwise). Golden: 0 of 1413 checks
> changed; tabbar-dense's 12 checks as at `d805c5e4`. Still `excluded` in calibration.json (live only); its live KNOWN
> entry struck off. An earlier form that vouched for the band by the motion (`2c9956f9`, records `4bda76a0`, on
> `bugs/r14-lv3-vouching-abandoned`) was rejected: ADR 0010 residual 6 says why.

> **Status (2026-10-17):** fixed under WDA, measured live by round 5's device check (src `b71cbbb`; records
> docs/truth/live-records/ios-vis-2725e76.json, and an earlier run of the cell alone, unrecorded, the same):
> `scroll:tabbar-floating.R` ok in both — touches (201,645), then the turned stroke at (201,335), inside the list below
> the header's 200, then the tap (201,550 / 572); list 0→197 / 0→175.7; "fully visible after 2 swipes", Tapped, R fired.
> Its WDA KNOWN entry struck off. Still open under idb (no scroll view listed, LE2), measured in the same runs: touches
> (201,699), then (201,175) ×4 in the header; list 0→1107.7 / 0→1116.3, R at y -387 / -395; "failed after 5 swipes …
> turned round 1 time" — KNOWN as before (`ios idb scroll:tabbar-floating.R`).
>
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
