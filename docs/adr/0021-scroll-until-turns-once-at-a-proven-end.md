# 21. `scroll_until` turns once toward the target at an end the tree proves, and a short scroll view's strokes carry it no further than it needs

Status: decisions 1–3 accepted, 2026-10-17 (owner, on lab note LV4, option (b): the three conditions and the
one-stroke stop); decision 4 (lab note LV5's carry model) implemented 2026-10-18 on `arch/r22-lv4` under the round-6
brief, pending the owner and the device check. The points on uiautomator decided 2026-10-18 (owner, on round 6's
Android device check): NO turn, and the two-stroke stop KEPT — unmoved strokes on uiautomator are no proof; the tool
reports the direction, the agent turns (below).

## Context

- docs/bugs/2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md
  (LV4): on the lab app's `scroll-bounded`, `scroll_until` for F with `direction: "up"`, `lower` (0,380 402x180)
  already at its top and F at content y 1380 below it, stroked up three times under WDA, moved nothing, and failed
  advising `direction: "down"`. The reply was true and knew the way; the strokes never took it. The rule behind it
  was recorded only in interact/scroll-rounds.ts's module docs (`beyondFarEdgeIn`, `nextStroke`, `Shortfall`): a
  target never sighted short of the far edge is "the caller's direction to honour", "a turn needs a sighting", and
  nothing is guessed from a screen no stroke changed — because strokes that change nothing may not have been taken.
- docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
  (LV5): one 108-pt drag over `lower` moved it about 259 pt (226–263 by run), F is whole in it over a 116-pt window of
  offsets only, and one run in three carried F past the window, turned at the last swipe and failed at maxSwipes.

## Decision

1. **The end turn.** averi turns ONCE toward the target when all three hold:
   1. the strokes provably did not move the list — the content is exhausted the caller's way, proven by the reads,
      not guessed (below);
   2. the tree places the target past the opposite (far) edge of the SAME scroll view those strokes went over, inside
      it;
   3. the reply says averi turned: `; 1 swipe up did not move scrollable (0,380 402x180) — the tree lists its content
      ending at its top — so averi turned down, as the tree places the element below it` (or `3 swipes up, the last of
      which did not move …` when the ones before moved it).
   The caller's direction is always stroked first. The turn keeps the full reach — no fling carried the target past;
   it was never near — and is not counted among the fling's turns (`scroll-rounds.ts#EndTurn`).
2. **What counts as proof** (`scroll-rounds.ts#Observed.ends`, `stroke-plan.ts#strokedEnd`,
   `ui-tree/geometry.ts#Clips.endsAt`): on the read right after a stroke toward the target (never the flush probe):
   every match where it was (with no target, the whole tree unchanged), no progress node shown, the stroke touching
   down on nothing drawn over its scroll view, and the tree LISTING that scroll view's content ending at the edge the
   stroke brings content in through — no node of it past that edge — for a scroll view that scrolls along that axis
   (`scroll-containers.ts#scrollAxis`). The strokes are no proof on their own: a stroke not taken moves nothing too.
   The listing is: a stroke not taken cannot make the content end where the tree shows it ending. A read still moving
   (a bounce at the end, an earlier fling) proves nothing until one reads still.
3. **The one-stroke stop.** With that proof the scroll ends after the first unmoved stroke (bound `exhausted`,
   `ends`: `(swiping up did not move it: the tree lists the content of … ending at its top — content exhausted)`),
   where `UNMOVED_STROKES_EXHAUST`'s two identical unmoved strokes stay the rule wherever the tree cannot list the end.
4. **The carry model (LV5)** (`stroke-plan.ts#carried`, `scroll-rounds.ts#stillNeeds`): on the same trees, the read
   after a stroke measures what it carried the target, per point of the finger's actual travel, of the same node at
   the same size, a sample past 4 × the travel (or the wrong way, or a tap's) dropped, the largest kept. Once the
   target lies short of its window and a stroke at the turns' reach would carry it further than the window lets it
   travel whole, the stroke's travel is cut to what brings it to the window's middle over that carry. Any window one
   stroke can skip, not only a short scroll view's: on a long WDA list the final approach is cut too (a carry of ≈ 2.4
   × a 420-pt stroke, ~1000 pt, is more than a ~650-pt slack); only a window wider than one stroke's carry keeps the
   full stroke.

## Where it applies, and where not

- **WDA**: decided — its frames are unclipped, so a scroll view's content is listed where it lies.
- **uiautomator: no turn — decided (owner, 2026-10-18).** Its reads cannot prove the end: rects are cut to the
  scroll container, so content past the edge reads flush with it; Compose omits nodes past the edge altogether; a
  RecyclerView's child index is no adapter position, so the first row listed says nothing of rows before it; and
  `scrollable` stays `true` at the end. The only evidence left is strokes that changed nothing, and unmoved strokes on
  uiautomator are no proof (a stroke not taken moves nothing too). So Android keeps the caller's direction and fails
  LOUDLY naming the direction that reveals the target — the tool reports the direction, the agent turns. Its strokes
  drag at `dragSpeed` (no fling), so the carry model has nothing to do there either.
- **uiautomator: the two-stroke stop — kept (owner, 2026-10-18).** Off WDA the stop needs `UNMOVED_STROKES_EXHAUST`
  (2, scroll-rounds.ts) identical strokes that moved nothing — the rule: after two consecutive identical strokes that
  changed nothing (the target's matches where they were, or with no target the whole tree), the content is taken as
  exhausted that way and the scroll fails, naming the side the target was last seen past and the direction that
  brings it back; the stuck test likewise (then one stroke back). A scroll that cannot move anything therefore costs
  two swipes and their settles before it fails — the price of never calling one untaken stroke an end. Measured live
  (round 6's Android device check, 2026-10-18, docs/truth/live-android-2026-10-18-visibility.md):
  `turn:scroll-collapsing.A` (lab note #10) — `direction: "down"` toward A, a row scrolled above the list with
  inverted bounds: 4 swipes down touching down at `540,1820`, the first two moving the list 715 → 1984 → 2488 (A
  carried from y -11 to -1784), the last 2 unmoved — the rule — then the loud failure `failed after 4 swipes (the
  last 2, swiping down, did not change the screen …) — element was in the tree before the first swipe, clipped out
  above its scroll container, … — scroll_until it with direction: "up"`, naming `up`; no turn. And
  `turn:scroll-bounded.F`: 2 swipes up at `540,424` in `upper` at its top, neither moving anything, F unlisted (Compose
  dumps no node past the edge) — `failed after 2 swipes (the last 2, swiping up, did not change the screen …) —
  element never appeared in the tree`: no side was ever read, so no direction is named (the strokes never ran to an
  end the caller's way after one that moved: `Shortfall.absent`'s `unsearched` needs that). The live judge holds
  Android's turn cases to exactly this (scripts/truth/live-visibility.ts, `judgeAndroidTurn`): no turn, at most
  `UNMOVED_STROKES_EXHAUST` unmoved swipes in the whole call (its swipes less the strokes the app logged moving the
  target's scroll view — a swipe that moves nothing may log none, so they are counted, not located), and a loud failure naming the target's direction — not
  R-direction's turn, which WDA's turn cases keep. F2A1's phone was cited here as an unmoved scroll on the replay
  (`form-keyboard.xml`: the replayed tree never moves, 3 swipes — `540 1034 → 424` twice, then one back up); live
  (case k7) ONE stroke at `540,1034` moved the form 167 px and stopped on phone — no unmoved stroke at all.
- **idb**: its flat list lists no scroll view (lab note LE2): no proof, no window; unchanged.

## Consequences and residuals

- A lazy list (a table) lists only the rows it has laid out: resting exactly on a row boundary (or with a sticky
  header pinned at its top) it lists nothing past that edge, and a stroke not taken there is a false proof — one
  stroke, then a turn or a failure calling the content exhausted. Rare (a list rests on a boundary by chance, the
  stroke must go untaken, nothing drawn over its touch-down), not impossible; nothing in the reads rules it out.
- An axis the tree cannot tell proves nothing (a fitting page, the false negatives scroll-containers.ts names).
- The carry model takes the fling as proportional to the drag at the fixed 300 ms (a shorter drag is a slower one) —
  measured at 108 and 344 pt, unmeasured below; a mid-fling read understates a sample, which is why the largest is
  kept. Both are the device check's to confirm (`ios wda turn:scroll-bounded.F`, `ios wda scroll:scroll-bounded.F`).
