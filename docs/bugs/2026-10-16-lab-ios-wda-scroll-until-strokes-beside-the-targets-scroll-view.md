# BUG: under WDA, `scroll_until` for a row of a bounded scroll view strokes the SCREEN, touching down beside that scroll view — the stroke moves nothing it holds, and the reply then names the very scroll view it never swiped

> **Status (2026-10-17):** fixed, and measured so live by round 5's device check (src `b71cbbb`; see "Measured live at
> the fix" below): every WDA stroke for a row of `lower` touches down inside it, and five of the seven live cases filed
> here read ok — their KNOWN entries struck off. The two cases of F, whose strokes now go inside `lower` too, still fail
> for other reasons, refiled: `turn:scroll-bounded.F` as LV4 (no turn without a sighting), `scroll:scroll-bounded.F` as
> LV5 (intermittent: momentum past a 116-pt window).
>
> **Status (2026-10-16):** fixed on branch `arch/r21-strokes` (from `debc9b2`); unmeasured on a device. The cause was
> not the one inferred below: the target IS found (WDA lists O and F, `best` is judged), but the stroke's candidates
> were its CLIPPING chain alone (ui-tree/geometry.ts#Clips.scrollersOf), and WDA marks no node as clipping — the chain
> is empty for every node of a WDA tree, so every WDA stroke for a found target went over the screen box. The fix
> (interact/scroll-rounds.ts#targetScrollers, since A1 interact/stroke-plan.ts#targetScrollers): the chain, else the ancestors that scroll on a tree of unclipped
> frames (`Clips.drawnIn`'s `scrollers`, the very scroll view the reply names); and draw-order.ts#drawnOver now finds
> its container among the nodes that SCROLL, not only those that clip, so what WDA draws over the scroll view (a
> floating tab bar's items, a pinned button above the keyboard) cuts the stroke as it does on Android. Golden (vs
> `debc9b2`): the three KNOWN rows turn green — `scroll-bounded.wda.json` O and F (strokes `201 524 → 416`, inside
> `lower`) and `sheet-long-list-short.wda.json` F (`201 369 → 139`, inside the table); 18 other WDA `scroll_until`
> rows keep their verdict and kind — 16 with their strokes now inside the target's scroll view (scroll-bounded P
> fully, S, S fully; sheet-long-list F; tabbar-floating R, F; toolbar-dismiss-short and form-keyboard, five each), and
> `sheet-medium-edges.wda.json` F and H with the same strokes and a reply that now names the sheet's container drawn
> over the touch-down (`drawnOver` answers on WDA; still mismatches, the presented-sheet note's). idb, which lists no
> scroll view, is unchanged (LE2): its strokes still go over the screen. The differential (corpus-r19) replays
> `scroll_until` only `down`, `up` and `fully`: sideways WDA strokes, which now go inside a carousel, are unexercised.
>
> **Residual (handed to A1, the stroke plan):** the nearest scroll view is taken WHATEVER ITS AXIS. Account Detail's
> card carousel (`24,138 354x85`), a card right of it scrolled for `down`: the stroke, the screen's `699 → 175`
> before, is now `207 → 155` inside the carousel, and the exhausted reply names the transactions list drawn over that
> touch-down (70 differential diffs, all failing after 2 swipes as before). On a device a cross-axis drag in a
> carousel is usually handed to the outer scroller, so it would move the page about 51 pt a stroke — UNMEASURED: no
> device has run it, and no lab cell can show it (none holds a horizontal scroll view); it is on round 5's
> device-check list (the account-detail screen of the app the differential replays, or a new lab cell: a card
> carousel inside a vertical list, a card off its right edge asked for `down`). Pinned as it is today in
> tests/interact/scroll-rounds.test.ts ("a card of a horizontal carousel, scrolled for `down`") and
> tests/interact/stroke-plan.test.ts ("a card of a horizontal carousel, stroked for `down`").
>
> **Residual addressed (2026-10-18, round 22, `arch/r22-axis`; unmeasured on a device):** the stroke plan is
> axis-aware (interact/stroke-plan.ts#strokeRoom, #clearLane; ADR 0010's "A stroke across a scroll view's axis"). A
> scroll view's axis is read from the tree (ui-tree/scroll-containers.ts#scrollAxis: Android's class, WDA's `Table`,
> else WDA content past the frame on one axis — Account Detail's carousel reads horizontal from its `Other 24,138
> 1416x85`, its list vertical from `Other 0,180 402x1925`; unknown for a Compose lazy list, a RecyclerView, idb). A
> stroke goes over the target's scroll views that scroll along it, and its path keeps off a nested one that scrolls
> only across it: a card of a carousel NESTED in a vertical page, scrolled for `down`, is stroked over the page, and a
> page's content-down touch-down on such a carousel (`24,700 354x85` in `0,180 402x694`: 201,735) moves to the page's
> longest stretch clear of it (`201 596 → 284`). Account Detail AS CAPTURED is unchanged: its carousel is no child of
> the list (siblings, the list drawn over the carousel's lower part), so for `down` no scroll view along the stroke
> holds the card and the plan falls back to the pick as before — still `207 → 155` inside the carousel; the two pins
> above, renamed, now say so (stroke-plan.test.ts "mp-native Account Detail as captured", scroll-rounds.test.ts "a
> card of a horizontal carousel no list holds"). Still to measure: the ~51 pt a carousel hands the outer scroller, on the
> lab's `carousel-in-list` (harness task H2).

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

The stroke is the screen's default (80 % → 20 % of its height). Inferred from the replay and the committed frames, not
measured on the device (no live run was made): touching down at y 699, below `lower`'s frame, it lands on the white
background and should scroll nothing; the reply blames the content ("exhausted, or the swipes were not taken"). For `O` it even names `lower` — the
tree tells averi which scroll view holds the row, and the stroke ignores it. idb, which lists no scroll view, strokes the
same line for `F` (docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md, LE2).

## Expected

The stroke drawn in the target's own scroll view (`lower`), as interact/swipe.ts#strokeRoom draws one in a container
when it has a candidate: `lower` is 180 pt tall, above MIN_STROKE_BOX (80).

## Cause (as first inferred from the source; superseded by the cause found, in the status above)

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

## Measured live (phase 5, 2026-10-16)

The inference above, measured: `scripts/truth/live.ts --udid <averi-lab iPhone 17> --groups visibility` (src
`debc9b2`), the lab app logging every touch's start and each scroll view's strokes (LabState.strokes — round 4).
Summary: docs/truth/live-ios-2026-10-16-visibility.md.

```
wda  scroll_until O (down)   touches (201,699) (201,699)   strokes none                   O stays outside lower
wda  scroll_until F (down)   touches (201,699) (201,699)   strokes none                   lower offset 0
wda  scroll_until S (down)   touches (201,699) (201,699) (201,175)   strokes upper 0→0    S stays a sliver
wda  scroll_until P fully    touches (201,699)×2 (201,175) (201,699)×3   strokes upper 0→0  P stays cut (63 %)
```

Every stroke for a row of `lower` touches down at y 699, on the white background below it — nothing moves; the turned
stroke (y 175) lands in `upper`, which bounces at its top. The replies blame the content ("content exhausted … nor does
swiping up", "a layout defect"). The same root makes the turned stroke for `tabbar-floating`'s R touch down above its
list, in the header (docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md,
LV3). Under idb (no scroll view listed) the same touch-downs, F's and the turn-back case's included.

## Measured live at the fix (round 5's device check, 2026-10-17)

`scripts/truth/live.ts --udid <averi-lab iPhone 17> --sources idb,wda --groups visibility,dismissal --record …`, src
`arch/round-21` `b71cbbb` (truth/phase-3 `2725e76`), WDA on 8120. Record: docs/truth/live-records/ios-vis-2725e76.json;
summary: docs/truth/live-ios-2026-10-17-visibility.md. Under WDA:

```
scroll_until P fully   touches (201,286) (201,154), tap (201,220)            strokes upper 0→102        P whole; Tapped, fired   ok
scroll_until S         touches (201,524) (201,416), tap (201,401)            strokes lower 0→183.3      S 82 % (CLIPPED, said); Tapped, fired   ok
scroll_until S fully   touches (201,524) (201,416) (201,416), tap (201,447)  strokes lower 0→180.7→137.3   S whole; Tapped, fired   ok
scroll_until O         touches (201,524), tap (201,394)                      strokes lower 0→258.7      O 71 % (CLIPPED, said); Tapped, fired   ok
sheet-long-list-short scroll_until F   touches (201,369), tap (201,121)      strokes list 0→485.3       F whole; Tapped, fired   ok
scroll_until F         touches (201,524) ×4, (201,525), (201,416)            strokes lower 0→1052.3     F 18 %: failed at maxSwipes (LOUD) — LV5; ok in two reruns
turn F (up)            touches (201,416) ×3                                  strokes lower 0→0 ×3       no turn back — LV4
```

Every stroke touches down inside the target's own scroll view (`upper` 110–330, `lower` 380–560, the table 62–446).
LV3's turned stroke under WDA is cured by the same fix (its note).

