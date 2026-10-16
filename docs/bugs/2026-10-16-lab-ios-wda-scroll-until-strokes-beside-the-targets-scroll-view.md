# BUG: under WDA, `scroll_until` for a row of a bounded scroll view strokes the SCREEN, touching down beside that scroll view — the stroke moves nothing it holds, and the reply then names the very scroll view it never swiped

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/scroll-bounded.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `truth/b2-edges` on `arch/round-20`'s
`src/` (`debc9b2`). Replayed only: a replayed tree never moves, so what is judged is where the strokes touch down, not
what they move. Raised by B2's review round 1 (MAJOR-1).

## The screen

`scroll-bounded` (fixtures/apps/ios/AveriLab/Edges.swift): two bounded SwiftUI `ScrollView`s, `upper` `0,110 402x220`
and `lower` `0,380 402x180`. In `lower`'s content: `O` `51,620 300x64` (below the scroll view, on the screen:
`outside-scroll-view`) and `F` `51,1380 300x64` (laid out below the screen: `off-screen`). WDA lists both scroll views
with their frames, `O` and `F` as children of `lower` (`isVisible 0`).

## Truth

Bringing `O` or `F` into view means scrolling `lower`: a stroke must touch down inside `lower`'s frame (380–560). Below
it (560–874) lies the white background; above it, `upper` and the gap between them. rows.ts#strokeRow (R-stroke): every
touch-down on the screen, clear of the bands and the chrome, and inside the target's own scroll view where the truth
names it.

## Observed (replayed)

```
wda  scroll_until { selector: 'id:"lab.scroll-bounded.O"', direction: "down" }
device: idb ui swipe 201 699 201 175 --duration 0.3   ×2      ← touches down at y 699, below `lower` (bottom 560)
→ ERROR scroll_until id:"lab.scroll-bounded.O" failed after 2 swipes (the last 2, swiping down, did not move it:
  content exhausted, or the swipes were not taken) — element in tree but never drawn: it lies outside its scroll view
  scrollable (0,380 402x180) …

wda  scroll_until { … F, direction: "down" }
device: idb ui swipe 201 699 201 175 --duration 0.3   ×2
→ ERROR … failed after 2 swipes … — element in tree but never intersected the 402x874 viewport …
```

The stroke is the screen's default (80 % → 20 % of its height). On the device it lands on the background and scrolls
nothing; the reply blames the content ("exhausted, or the swipes were not taken"). For `O` it even names `lower` — the
tree tells averi which scroll view holds the row, and the stroke ignores it. idb, which lists no scroll view, strokes the
same line for `F` (docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md, LE2).

## Expected

The stroke drawn in the target's own scroll view (`lower`), as interact/swipe.ts#strokeRoom draws one in a container
when it has a candidate: `lower` is 180 pt tall, above MIN_STROKE_BOX (80).

## Cause (inferred from the source, not traced in full; not changed here)

interact/scroll-rounds.ts#strokeCandidates takes the target's containers once they are known (`targetContainers`), else
the tree's main scroller (`facts.mainScroller`), and with no candidate that has room `strokeRoom` returns undefined and
the stroke is drawn over the screen whole. A target never drawn (O outside its scroll view, F off the screen) seems never
to give its containers, and the main scroller is not `lower` — so the stroke falls back to the screen.

## Possible fix directions (owner's choice)

- Take the target's scrolling ancestors (`Clips.scrollersOf` / `drawnIn`'s `scrollers`, which the reply already reads to
  name `lower`) as the stroke's candidates whenever the target is in the tree, drawn or not.
- At least, when every stroke touched down outside the scroll view the reply names, say so instead of "content
  exhausted".

## Rows (golden, KNOWN in tests/differential/golden/edges.known.ts)

`ios-iphone17-ios27/scroll-bounded.wda.json O scroll_until`, `F scroll_until`.
