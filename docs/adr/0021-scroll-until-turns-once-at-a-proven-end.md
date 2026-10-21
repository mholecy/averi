# 21. `scroll_until` turns once toward the target at an end the tree proves, and a short scroll view's strokes carry it no further than it needs

Status: decisions 1–3 accepted, 2026-10-17 (owner, on lab note LV4, option (b): the three conditions and the
one-stroke stop); decision 4 (lab note LV5's carry model) implemented 2026-10-18 on `arch/r22-lv4` under the round-6
brief, device-checked 2026-10-19 (round 7: it lands the row, no extra stroke or turn) and its residual 1 accepted
2026-10-19 by the round-7 orchestrator, who holds the owner's delegation of round-7 decisions (2026-10-18); the
one-stroke stop that did not hold on iOS fixed at round 7's A1 (480660a4; decisions 2 and 5 added). The two points on
uiautomator decided 2026-10-18 (owner, on round 6's Android device check): NO turn, and the two-stroke stop KEPT —
unmoved strokes on uiautomator are no proof; the tool reports the direction, the agent turns (below). Device-checked
on iOS 2026-10-18 (round 6, WDA, below): the turn holds (once, toward the target, said); the one-stroke stop does not
(2–4 unmoved strokes before the proof held, in four runs); decision 4 holds on `lower` (F landed in its window four
times of four), its long-list half unmeasured — no lab cell can measure it yet.
Round 7 (2026-10-18, the owner's brief: "make the one-stroke stop hold on iOS"): measured live on the lab simulator,
the one-stroke stop did not hold under WDA because a list resting a fraction of a point off its end reads a whole
point off — "unmoved" is now within a point (decision 2), and 6 WDA runs of 6 (the four traced runs,
docs/truth/live-records/ios-wda-stop-carousel-r23-1…4.json, and the visibility group,
ios-vis-r23-ios-stop-e687fe83.json, at e687fe83; the scroll cells at 659fdf00, ios-wda-scroll-cells-659fdf00.json)
turn after one stroke; the carry model cuts a first stroke over each scroll view too (decision 4); a stop is judged on
the read a fling comes to rest in (decision 5).

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
   it was never near — and is not counted among the fling's turns (`course.ts#EndTurn`).
2. **What counts as proof** (`scroll-rounds.ts#Observed.ends`, `stroke-plan.ts#strokedContent`,
   `ui-tree/geometry.ts#Clips.contentToward`, its `ends`): on the read right after a stroke toward the target (never the flush probe):
   every match where it was (with no target, the whole tree unchanged), no progress node shown, the stroke touching
   down on nothing drawn over its scroll view, and the tree LISTING that scroll view's content ending at the edge the
   stroke brings content in through — no node of it past that edge — for a scroll view that scrolls along that axis
   (`scroll-containers.ts#scrollAxis`). The strokes are no proof on their own: a stroke not taken moves nothing too.
   The listing is: a stroke not taken cannot make the content end where the tree shows it ending. A read still moving
   (a bounce at the end, an earlier fling) proves nothing until one reads still.
   **Unmoved is within a point** (round 7, adapters/types.ts#sameRectWithinPixel): every match at most one unit from
   where it was on each of x, y, width and height. WDA lists frames in whole points, each of a frame's sub-point origin
   and size rounded on its own, and a list a stroke left resting a third of a point off its top (scale 3) reads a whole
   point off on one side. Measured live (round 6's iOS check, then round 7's trace of averi's reads per stroke): F at
   51,1380 300x64 before the stroke up, then 51,1381 300x64 or 51,1380 300x65 after each, `lower`'s content
   0,380 402x1300 → 0,381 402x1300 or 0,380 402x1301; the strict "under one unit" read each such read as moved, so the
   proof came on the first read that happened to round as the one before — after 2 unmoved strokes (3 runs of 4) or 4
   (1 run, budget spent). Not a read still bouncing: every read after the stroke, ~1.1 s on, was within that point.
   With one unit: every WDA run since turns after exactly one stroke — 6 of 6 (the status above names them). A real motion of one unit reads as none — no stroke moves
   content that little; two units are motion (the bounce rule above stands).
3. **The one-stroke stop.** With that proof the scroll ends after the first unmoved stroke (bound `exhausted`,
   `ends`: `(swiping up did not move it: the tree lists the content of … ending at its top — content exhausted)`),
   where `UNMOVED_STROKES_EXHAUST`'s two identical unmoved strokes stay the rule wherever the tree cannot list the end.
4. **The carry model (LV5)** (`stroke-plan.ts#carried`, `course.ts#stillNeeds`): on the same trees, the read
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
   window without an extra stroke or turn. Measured 2026-10-19 (round 7, once LV6 was fixed): the cut lands the row,
   but a fling varies run to run around the largest carry sampled, so the rest can fall a few points past the window
   — residual 1.
   **The first stroke too** (round 7, `stroke-plan.ts#UNMEASURED_CARRY`): until a stroke over a scroll view was measured
   (the carry is kept per scroll view, above) the carry is taken as 2.8 a point, the most any measured WDA fling
   carried (`lower` 2.1–2.4, the SwiftUI form 2.1–2.8, sheet-long-list 2.1, the carousel 2.1–2.5); the first measured sample replaces it. Measured on `carousel-in-list`
   (docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md): C, a
   card as wide as its 354-pt carousel, is whole at one offset (354) and has its centre inside over 177–531; the full
   212-pt stroke flung the carousel 447, 454, 495, 532 pt (one run past the window, the tap then refused). Cut to
   126 pt: 283, 289, 315, 317 pt in 4 runs of 4 — C 80–90 % drawn, "visible after 1 swipe", settled, tapped. The most,
   not a mean: shorter than needed costs a stroke, longer a turn. Where the target is far (F from `lower`'s top: 942 pt
   needed) the cut is no cut — the full stroke. Never under 108 pt (`UNMEASURED_MIN_DRAG`), the shortest drag a fling
   was measured at: below it the fling is not proportional — `scroll-bounded` S (`fully: true`), its first stroke cut
   to 41 pt, carried `lower` 36 pt (0.9 a point), and the 0.9 then measured sent the next stroke past S's window and
   back: 4 swipes where the full first stroke took 2 (the visibility run at `e687fe83`). Held at 108, S's first
   stroke is the full one again.
5. **A stop is judged on a settled read** (round 7, `scroll-rounds.ts#SETTLE_CONFIRM_READS`, `Observed.slowing`): the
   rule stays two reads agreeing (within a point, as above), and a confirming read that found the target moving less
   than the read before found it moving — a fling slowing — spends none of the SETTLE_CONFIRM_READS budget. The
   carousel's fling ran ~2.5 s; the reads, 0.47 s apart, found C moving 54, 21, 8 pt, so the third confirming read was
   still 8–10 pt from rest and the stop was claimed "still moving" — on a read with C's centre inside, in the run whose
   fling then carried it out. Now every run stops on two agreeing reads, 6 of 6 (in the traced four, C moving e.g. 44, 17, 5, then 0). An
   animation moving as much at every read still spends the budget and is reported "still moving", as before.

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
  - **Refined 2026-10-21 (round 14, lab note LV1,
    docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md): the rule
    counts only reads that list content of the stroked scroll view able to show motion.** Measured: the lab app's
    `tabbar-floating` `list` 0,550 1080x1670 (Compose `verticalScroll`, which dumps no content container) lists T and
    R and nothing else, F lying at content y 5500 px past a blank stretch. Live, the strokes moved it 0→858→1714→2578→3437;
    after the second R was gone too, and the third and fourth read the same empty list — `failed after 4 swipes (the
    last 2, swiping down, did not change the screen …)` with F one stroke away. `scroll-bounded`'s `upper` (W at 10 dp,
    P at 180 dp of 700) read empty after its second stroke, and its third moved it 435 px. An unchanged tree says the
    content did not move only where the stroked scroll view lists a node whose edge along the stroke's axis lies off
    the frame's own edges, where it would move. So `Clips.endsAt` became `geometry.ts#Clips.contentToward`, the one
    question of what a read lists of that scroll view's content toward the stroke's edge (`ListedContent`): `ends`
    (the WDA proof above, unchanged), `listed`, or `blank` — no node of some area under it with an edge on that axis more
    than a pixel off both of the frame's edges (an empty viewport, or only a node cut at both ends; a rule of the frame
    alone, so WDA's unclipped frames are blank only when truly empty — and an empty WDA scroll view, which proved `ends`
    before, is now `blank`: no end proof over an empty state or a lazy stack's unrealised stretch, the strokes run to
    the bound; not of rows that each span the frame on that axis lying apart across it, `stackedAcross` — the lab
    app's `form-picker` list, whose class names no axis, lists 14 full-width rows: a sideways stroke over it reads them
    as content shown and still ends after two unchanged reads; never of a scroll view the tree says scrolls on the
    other axis and holding no scroll view that may scroll on this one, whose content moves none that way — while a
    ViewPager, horizontal by its class, over a vertical list of its own rect reads by that list's content). The round asks it (`scroll-rounds.ts#ledgerRead`, since round 15; the motion ledger counts the answer, `motion-ledger.ts#seeMotion`) once a read after a stroke
    with the target not in the tree (`stroke-plan.ts#strokedContent`; undefined over the gesture box whole — a screen
    with no scroll view — and under idb, whose region its motion showed is no node of the tree: the rule is unchanged
    there): a `blank` read is no evidence — it counts as moved, the
    streak starts again (a reset, not a freeze), and an `absent` failure at maxSwipes or the deadline says so
    (`motion-ledger.ts#UnseenStrokes`, counted over one scroll view, one way): `; after the last 5 swipes over the scroll container
    0,550 1080x1670 the tree listed none of its content where a swipe's motion would show (blank space, content with no
    node, or a node cut at both of the container's edges), so how far they moved it is unknown — the element may lie
    further down: raise maxSwipes or timeoutMs`. "How far", not "whether": the first of those strokes may show the
    content moved, by carrying the last of it listed off the viewport — but none shows how far.
    - **"did not change the screen" kept:** the streak keeps its meaning — the same stroke twice left a tree that
      would show motion unchanged — so the sentence is true wherever it is still said; no replayed reply changed
      (golden against 85109487: 0 of 1413 checks; every committed Android capture's largest scroller reads `listed`
      toward all four edges, pinned in tests/ui-tree/listed-content.test.ts).
    - **Cost:** none wherever the list shows content. Over a blank viewport the strokes run to the bound the call
      already allowed, 2.8–4.1 s each on the lab AVD — a true end with a blank viewport included (`upper` at its end
      1320, a list ending in a footer taller than its viewport: up to maxSwipes−2 more strokes, ≈5–6 s on
      `scroll-bounded` O and F), reported honestly at the bound.
    - **Residuals:** a node inside the scroll view that does not move with its content (a sticky header child) reads
      as content shown, so a blank stretch under it still reads exhausted after two strokes; so too content laid
      out in two columns, or a full-height decor node beside a container, each cut at both ends (`stackedAcross`
      reads them as rows lying apart — the price of a sideways stroke over a list of full-width rows ending honestly);
      and at drag speed the
      15 s default reaches about 4–5 Android strokes, so a target past a long blank stretch may fail at the deadline
      (docs/bugs/2026-10-09-android-scroll-until-default-budget-too-short-at-drag-speed.md) — the new clause names
      the remedy.
    - **Rejected:** fingerprinting the content container's bounds (the note's option (a): Compose dumps none, and a
      View child is cut to the viewport, so its rect never moves); a screenshot diff per stroke (blank content draws
      the same pixels, at a screencap a stroke); the scroll offset from the device (no source dumps it — `scrollable`
      stays true at the end, above — and it needs a new adapter query); a third stroke, or N for blank (the blank
      stretch has no bound length — 2400 dp here — so any N is arbitrary); wording alone (keeps the false "not found"
      under budget, the bug); a `blank` flag on the fingerprint in `TreeFacts` (wider, and it splits one question
      about the stroked view across two modules).
    - **Live (2026-10-21, averi_lab, twice at the fix's first form `bd1c1107`: docs/truth/live-records/android-vis-r14-lv1.json, -2.json; once at `770344ae`, `00ed9ec8`'s src but for names and comments: -3.json):**
      tabbar-floating F visible after 5 swipes at (540,1598), one every 3.2 s, the list 0→861→…→4273, Tapped F — also
      at timeoutMs 30000 (`blank:tabbar-floating.F`); scroll-bounded O and F LOUD at the 15 s deadline after 5 strokes
      into `upper` (one every 2.8 s), saying the last 4 went over it while the tree listed none of its content (the
      clause's first wording, at `bd1c1107`; at `770344ae` its final one, above, the same 4 of 5), no unchanged claim; `turn:scroll-bounded.F` unchanged (2 unmoved, `upper` listing W and P).
- **idb**: its flat list lists no scroll view (lab note LE2): no proof, no window; unchanged. The turn's stroke under
  idb goes over the region the target's motion showed once two reads saw it carried, when it carries content back the other way from how it was first seen moving (2026-10-21, lab note LV3: ADR
  0010's residual 6, refined) — the turn itself is decided as before.

## Consequences and residuals

- A lazy list (a table) lists only the rows it has laid out: resting exactly on a row boundary (or with a sticky
  header pinned at its top) it lists nothing past that edge, and a stroke not taken there is a false proof — one
  stroke, then a turn or a failure calling the content exhausted. Rare (a list rests on a boundary by chance, the
  stroke must go untaken, nothing drawn over its touch-down), not impossible; nothing in the reads rules it out.
- An axis the tree cannot tell proves nothing (a fitting page, the false negatives scroll-containers.ts names).
- The carry model takes the fling as proportional to the drag at the fixed 300 ms (a shorter drag is a slower one) —
  measured at 108, 212 and 344 pt, and at 126 (the carousel's cut first stroke: 2.25–2.52 a point, as the full
  stroke's 2.1–2.5), unmeasured below; a mid-fling read understates a sample, which is why the largest is
  kept. Both are the device check's to confirm (`ios wda turn:scroll-bounded.F`, `ios wda scroll:scroll-bounded.F`).
- Two tolerances meet across reads, on purpose: whether a stroke moved the match ("unmoved") forgives under a pixel
  (`sameRectWithinPixel`), while the proof's and the carry's scroll view is found again by its EXACT rect
  (`Clips.contentToward`, `stroke-plan.ts#carryOver`, as `axesOf` and `drawnOver` find it — round 6's code review, S1/P5).
  WDA's rects reach the tree rounded (ios-node.ts), so a scroll view at rest keeps its rect; one that moves by a pixel
  between reads loses the proof (no turn after one stroke: the two-stroke rule decides) or the carry (no shortened
  final stroke), both the safe side. The live cases are where such a 1-px flip would show:
  `ios wda turn:scroll-bounded.F` turning only after the second stroke, `ios wda scroll:scroll-bounded.F` overshooting
  with a full final stroke — the device check reads both for it.

## The iOS device check (2026-10-18, round 6; docs/truth/live-ios-2026-10-18-visibility.md)

Under WDA at truth/round-6's src (11683c3), four runs of each case:
- **The turn (decision 1)** holds in kind: the caller's `up` stroked first, one turn `down`, the reply saying averi
  turned (`… 2 swipes up, the last of which did not move it — the tree lists the content of scrollable (0,380 402x180)
  ending at its top — so averi turned down …`). **The one-stroke stop (decision 3) does not hold live**: the proof held
  after 2 unmoved strokes in three runs (F then reached, tapped, fired) and after 4 in one (the budget spent before F,
  `failed after 6 swipes`). Two is the two-stroke rule's count, the residual above foretold (a 1-px flip between reads
  losing the proof — F reads 300x64 at launch and 300x65 after a stroke — or a read still bouncing at the top; no trace
  of averi's reads was kept to tell which). `ios wda turn:scroll-bounded.F` stays KNOWN (lab note LV4).
- **The carry model (decision 4)** holds on `lower`: F landed whole in all four runs (`lower` at rest at 915–981 of its
  884–1000 window; LV5 struck off). Its long-list half is unmeasured, and no lab cell can measure it yet: the live
  case built for it (a far row of `sheet-long-list`, `CARRY` in scripts/truth/live-visibility.ts) is blocked by a WDA
  reading of scrolled tables (lab note LV6,
  docs/bugs/2026-10-18-lab-ios-wda-scrolled-tables-parked-row-text-reads-above-the-screen.md) — and with LV6 fixed it
  still could not fail on a missing cut: the table's last offset (1748) lies inside Row 30's window (1172–1748), so a
  full final stroke comes to rest at the end, inside the window; no row of its 40 has a window wholly before the end
  and past one stroke's carry (≈ 1040 pt). The measurement needs a longer table (the plan's round 7).
  **Round 7 (2026-10-19, docs/truth/live-ios-2026-10-19-lab-fixes.md):** the table is 56 rows and holds a target L at
  row 30 with its own identifier (whole over the offsets 1172–1920, the table's end at 2772): a full final stroke
  overshoots its window, so the carry case (`carry:sheet-long-list.L`) can now fail on a missing cut. Live it still
  reads LV6 (three turns, two runs of two); the long-list half stays unmeasured until LV6's fix.
  **LV6 fixed (round 7's A2, a1b0b82; docs/truth/live-ios-2026-10-18-visibility.md, its round-7 section):** in three
  runs (docs/truth/live-records/ios-wda-long-list-parked-1…3.json) L was reached after 2 strokes down, no turn, every
  run; the final approach rested L at 1917.3 and 1903.3, inside its window 1172–1920, and once at 1933.7 — 14 pt past
  it, L 78% shown, the reply honest ("CLIPPED at top, 78% of it is in the viewport"). The long-list half holds in kind:
  no extra stroke, no turn; its margin is residual 1.

## Residuals accepted

1. **The final approach's carry on a long WDA list can rest a row a few points past its window** (recorded
   2026-10-19 at round 7's integration; accepted 2026-10-19 by the round-7 orchestrator — the owner delegated round-7
   decisions on 2026-10-18). The cut stroke is planned over the largest carry sampled
   (decision 4), and a fling is not exactly proportional run to run: on the lab's 56-row table it brought L to rest
   14 pt past its window in one run of three (1933.7 against 1920), the row still 78% shown with its centre clear. The
   reply says so ("CLIPPED at top, … % of it is in the viewport"), so a caller asking `fully` is told; no stop is
   claimed on a row not shown, no extra stroke or turn spent. The live golden filed the carry case as this residual,
   intermittent (scripts/truth/live-known.ts, `ios wda carry:sheet-long-list.L`, R-direction on `visible`), until
   round 7's final device check (2026-10-19, truth/round-7 836e04b1: A1's src in, A2's runs were before it): L at rest at
   1635, 1869.3, 1853.3 and 1590 — 51–330 pt inside its window, "fully visible after 2 swipes" — in four runs of four
   (docs/truth/live-records/ios-wda-vis-r7final.json, ios-wda-long-list-r7final-1…3.json); the entry struck off. The
   residual stays as the mechanism's bound — the cut is still planned over the largest carry sampled — but its measured
   margin is now 51 pt inside, not 14 pt past (the lab logs the table's offset after the strokes, not per stroke, so
   which of A1's changes moved it is not measured).

