# TRIAGE: under WDA, `scroll_until` a carousel card `right` stops "visible" on a read still moving, and the fling carries the card's centre out of the carousel — the tap after it is refused; the two verbs disagree

> **Status (2026-10-18):** open, triage, intermittent; measured live only (round 6's iOS device check). KNOWN as this
> note, `intermittent` (scripts/truth/live-known.ts, `ios wda scroll:carousel-in-list.C`, stop-claim on `visible`): one
> run of two read it (b71cbbb's), the other (11683c3's) was ok.

**Found 2026-10-18** by round 6's iOS device check: the live golden (`scripts/truth/live.ts --udid <averi-lab iPhone
17> --sources idb,wda --groups forms,visibility,dismissal --side <b71cbbb checkout> --record …`) on the `averi-lab
iPhone 17` simulator (iOS 27.0, 402x874), WDA 16.1.7 on port 8120. Records: docs/truth/live-records/ios-vis-b71cbbb.json
(round 5's src, the stop claimed) and ios-vis.json (round 6's src 11683c3, ok). Summary:
docs/truth/live-ios-2026-10-18-visibility.md.

## Observed (measured, WDA)

`carousel-in-list`: the carousel 24,138 354x85 (a horizontal ScrollView in a vertical page), its card C wholly right
of the clip at launch (378,138 354x85). The case: `scroll_until id:"lab.carousel-in-list.C"`, `right`, then `tap`.

```
b71cbbb   touch (307,181) — one sideways stroke inside the carousel, along its axis
          strokes carousel 0→532.3; C at rest at x −154.3 (its centre x 22.7, a point and a third left of the clip)
→ scroll_until: Element id:"lab.carousel-in-list.C" visible after 1 swipe — CLIPPED at left, 50% of it is in the
  viewport. … still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot
  taken now may not match
→ tap: ERROR id:"lab.carousel-in-list.C" is outside its scroll view scrollable (24,138 354x85) at (23,181): only 50%
  of it (rect -155,138 355x85) is drawn, and a tap goes to its centre — scroll_until it with fully: true first;
  nothing was tapped
11683c3   the same stroke; carousel 0→446.7; C at rest at x −68.7 (74 % drawn) — "visible after 1 swipe — CLIPPED at
  left, 74%"; Tapped, fired
```

The stop was judged on a read taken while the fling still ran (averi says so); the fling then carried C's centre past
the carousel's left edge. 50 % drawn is the centre on the edge itself: the plain stop needs the centre inside, and the
read it was judged on (not recorded) can have had it a point inside while the card was still moving left.

## Cause (inferred)

C is as wide as the carousel (354 pt), so it shows whole at one offset only (354) and has its centre inside over
offsets 177–531. One full-reach stroke flung the carousel 447 and 532 pt: inside that window once, a point past its end
once. The stop accepts a read still moving (it says so) rather than waiting for rest. The carry model (ADR 0021 decision 4) cannot help a first stroke: it needs
a measured stroke of the same scroll view.

## Expected (the owner's)

A stop not claimed on a read still moving when the target lies within a few points of losing what the stop needs —
read again once still — or a first stroke over a short scroll view shortened for its width. Or accepted as scroll
dynamics, the case KNOWN and intermittent.

## Notes

- Live only (a replayed tree never moves). Not S4: both srcs stroke inside the carousel, along its axis.
- Related: docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
  (LV5, a fling past a short scroll view's window, fixed by the carry model from the second stroke on).
