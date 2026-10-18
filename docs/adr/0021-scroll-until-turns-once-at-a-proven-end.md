# 21. `scroll_until` turns once toward the target at an end the tree proves, and a short scroll view's strokes carry it no further than it needs

Status: decisions 1–3 accepted, 2026-10-17 (owner, on lab note LV4, option (b): the three conditions and the
one-stroke stop); decision 4 (lab note LV5's carry model) implemented 2026-10-18 on `arch/r22-lv4` under the round-6
brief, pending the owner and the device check. Open points for the owner, both on uiautomator (below): the
exclusion from the turn, and the one-stroke stop.

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
   3. the reply says averi turned: `; 1 swipe up did not move it — the tree lists the content of scrollable (0,380
      402x180) ending at its top — so averi turned down, as the tree places the element below it` (or `3 swipes up, the
      last of which did not move it …` when the ones before moved it) — the proof in the words of the one-stroke stop's
      failure (decision 3; scroll-text.ts#endText, one wording for both since round 6's code review).
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
   the same size, a sample past 4 × the travel (or the wrong way, or a tap's) dropped, the largest kept — kept for the
   scroll view the stroke went over: a carry measured over one is never applied to a stroke over another (the plan
   falling back to an outer scroll view), and a sample over another replaces it (round 6's code review, P5). Once the
   target lies short of its window and a stroke at the turns' reach would carry it further than the window lets it
   travel whole, the stroke's travel is cut to what brings it to the window's middle over that carry. Any window one
   stroke can skip, not only a short scroll view's: on a long WDA list the final approach is cut too (a carry of ≈ 2.4
   × a 420-pt stroke, ~1000 pt, is more than a ~650-pt slack); only a window wider than one stroke's carry keeps the
   full stroke. That final-approach cut on a long list is inferred, not measured (LV5 measured `lower`, 180 pt): the
   device check runs a long-list live case under WDA (a row far down a full-height list — the lab app's
   `sheet-long-list`, or a cell like it) beside `scroll-bounded`'s, and judges that the cut stroke lands the row in its
   window without an extra stroke or turn.

## Where it applies, and where not

- **WDA**: decided — its frames are unclipped, so a scroll view's content is listed where it lies.
- **uiautomator: excluded — an open point for the owner.** Its reads cannot prove the end: rects are cut to the
  scroll container, so content past the edge reads flush with it; Compose omits nodes past the edge altogether; a
  RecyclerView's child index is no adapter position, so the first row listed says nothing of rows before it; and
  `scrollable` stays `true` at the end. The only evidence left is strokes that changed nothing — which the owner
  ruled is not proof. Android keeps the caller's direction and fails with the advice, as before; its strokes drag at
  `dragSpeed` (no fling), so the carry model has nothing to do there. If the owner accepts two identical unmoved
  strokes touching down on nothing drawn over the list as proof on Android, the turn extends there.
- **uiautomator: the one-stroke stop — also open for the owner.** Off WDA the stop still needs
  `UNMOVED_STROKES_EXHAUST` (2, scroll-rounds.ts) identical strokes that moved nothing, and the stuck test likewise
  (then one stroke back), so a scroll that cannot move anything costs at least two swipes and their settles before it
  fails. Measured on the golden replay of the Android lab app (truth/round-6): F2A1's phone (`form-keyboard.xml`, a
  form that fits above the IME, nothing to scroll) still fails after 3 swipes — `540 1034 → 424` twice, then one back
  up — though round 6's fix (6d8f8de) made its verdict right. Whether one unmoved stroke, touching down on nothing
  drawn over its scroll view, may end the scroll there too is the same question as the turn's — what on uiautomator's
  tree may stand for the end WDA lists — asked for the stop alone: a one-stroke stop that is wrong costs a failure
  where a second stroke would have moved the list; a two-stroke stop that is right costs a swipe and a settle.
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
