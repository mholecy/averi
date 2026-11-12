# 10. The pixel assert judges the soft keyboard first, with K1's reading outside standing

Status: accepted, 2026-10-12 (owner). Amended 2026-10-20 (round 14, lab note LE1): the drawn frame on Android (below).

## Context

Measured on an API 33 emulator: a tap on a field raised the IME over the bottom ~40 % of a payment form. uiautomator
went on reporting the pinned CONTINUE at its at-rest rect, because the keyboard is a separate window. A colour assert
sampled the key faces (`#FFFFFF`), and an ocr assert read the `?123` key ("123"). Each was reported as the element's. Had
the expected value been the keyboard's colour, the assert would have passed on an element nobody can see.

When the pixel assert moved onto standing, the keyboard could have joined the bands and covers in standing's one order.
It could also have stayed ahead of them, where the old round put it.

## Decision

- **Keyboard first.** The order is the keyboard, then the system bands, then cut, then covered. The keyboard's remedy
  (hide it) is no scroll, so it is said first.
- **K1's reading stays outside standing.** The pixel poll asks the reading (`ui-tree/keyboard-cover.ts#readKeyboard`)
  `overlapping` itself, before standing. That reading covers Android's window, WDA's in-tree band and floating panels.
  It never asks the witness, which exists to veto a key press, and nothing is pressed here.
- **Only idb's band is a standing region** (ADR 0006). A panel's rect is no `KeyboardLine`.
- **Any overlap counts** (`rectsOverlap`): the ocr assert crops the whole rect. The colour sampler insets 12 %, so a
  keyboard under only the bottom edge fails closed where colour could have measured. That cost is accepted to keep one
  rule. An edge that only touches is not covered.
- **The miss continues the poll.** The round is a fail-closed miss that quotes both rects and captures nothing. The poll
  goes on, so a keyboard that leaves before the deadline costs a round, not the verdict.

## Amendment: the off-screen case and the thin sliver (2026-10-14)

K1's reading is still asked first, before any standing. Inside the standing, the pixel standing's off-screen case
precedes idb's keyboard band: when nothing of what the assert reads lies on the screen, nothing is on the screen to be
under the keyboard, so the region is judged off the screen first. The thin sliver — an element the screen's edge leaves
no thicker than the slack on the screen (ADR 0002) — comes after idb's keyboard band and before the system bands, so an
element under the band is a keyboard miss, as under WDA's and Android's reading (`ui-tree/standing.ts#regionPlace`). See
ADR 0018, "Amendment: presented judged of the node".

## Amendment: the drawn frame (2026-10-14)

The pixel standing's order is now: off the screen → **outside its scroll view** → idb's keyboard band → the thin sliver
→ the system bands. K1's reading is still asked first, outside standing.

A WDA tree lists a scroll view's content at its laid-out rect even past the scroll view's frame, and the scroll view
draws none of it there (UIKit's `UIScrollView` clips to its bounds; so do a table, a collection view and SwiftUI's
`ScrollView`). Measured: the at-rest SWIFT form lists `payee_street_input` at `24,869 354x52`, below its
`ScrollView 0,0 402x780`; 5 pt of it lie on the 402x874 screen. A colour assert on it passed on the bare background
the capture shows there (`sampled #DEE0E6 … clipped 90% off-png`), and a tap on `payee_name_input` (`24,801 354x52`)
was reported done at (201,827), 3 pt below CONTINUE.

- **The drawn frame** (`ui-tree/geometry.ts#Clips.drawnIn`): the intersection of the frames of every ancestor that
  scrolls (an ancestor of no area cuts nothing: it fails open), on a tree whose SOURCE says its frames are unclipped:
  the WDA parser marks its root (`UiNode.unclippedFrames`), as idb's marks `flatList` and uiautomator's
  `paddedTouchTargets`, and `draw-order.ts#listsUnclippedFrames` reads it. Android's rects are already cut to their
  ancestors and carry no mark — whatever they flag: a web view or a `scrollable="false"` list with no scroller flagged
  is unchanged — and idb lists no scroll view: both are unchanged by construction. **Superseded for Android
  2026-10-20** (below, "the drawn frame on Android"): uiautomator does not always cut. A normalized WDA tree saved before
  the mark (the differential corpus's `ui_snapshot` trees) is given it when the harness serves it.
- **Outside its scroll view** comes after off the screen: an element nothing of which lies on the screen is off the
  screen, whatever its scroll view. An element on the screen nothing of which is drawn there is `offScreen` with its
  scroll view named (`OUTSIDE_ITS_SCROLL_VIEW`), with the off-screen remedies (a scroll; beneath a presented screen,
  close it first). No new kind.
- **The thin sliver at the scroll view's edge** as at the screen's (ADR 0002's slack), named with the scroll view
  (`TOO_THIN_IN_ITS_SCROLL_VIEW`).
- **What the assert reads** is asked of the element's drawn part, and the pixel poll measures that same part: ONE
  region for the judge (the bands, the covers, the thin sliver) and the sampler, sharing the scroll view's clip as they
  share the screen's (`verify/capture.ts#clipThenInset`). What lies over only the undrawn part covers nothing the
  capture shows of the element: CONTINUE from 780 over a row running past its form's 780, the status bar over a row
  above its form's top at 62, a carousel's next card over the undrawn part of the card before it. Those asserts,
  which failed closed naming that cover, now measure the drawn part — and the tap and `scroll_until` agree on the same
  node (a plain stop at its drawn centre, `fully: true` clipped at the scroll view's edge). The owner kept this
  (2026-10-15) over failing closed on such a cover: the sweep's 19 colour/ocr asserts that turned from a fail closed
  to a measurement are measured on what the capture shows of the element. The region is one function
  (`ui-tree/standing.ts#Scene.pixelRegion`) that the judge and the sampler both ask, of one screen per round, so they
  cannot diverge (on a root of no area neither cuts).
- Before idb's band: idb is flat, so its band never meets this rule.
- The same frame cuts the tap's and `scroll_until`'s judgement (`ui-tree/standing.ts#Scene`, "THE DRAWN FRAME"), so the
  verbs agree: the tap refuses naming the scroll view (after the keyboard guard, since a scroll view laid out above
  the keyboard grows back once it hides), and `scroll_until` strokes — under a witnessed keyboard line too: a stop
  never stops on a centre its scroll view does not draw.
- **A centre outside its scroll view, part of the node drawn** (owner, 2026-10-15): the tap REFUSES it as at the
  screen's edge — "outside its scroll view … only N% of it … is drawn, and a tap goes to its centre — scroll_until it
  with fully: true first" — and does not tap the drawn part. The tap's rule for a centre past the screen's edge is the
  same (interact/tap-judgement.ts, "ON THE SCREEN"): moving the point would change what the keyboard guard judged,
  the drawn part of such a node is a strip at an edge where a tap is least likely to reach it, and `scroll_until`'s
  plain stop stops only with the centre drawn, so `scroll_until X` then `tap X` agree. Measured shape: a carousel's
  card at a form's foot (`low_card 24,750 200x80` in a carousel at 740, the form ending at 780: 38 % drawn).

## Amendment: the drawn frame on Android (2026-10-20, round 14)

Measured by the lab app (`averi_lab`, API 33, edge-to-edge): uiautomator does NOT always cut a rect to its scroll
container. Compose's `verticalScroll` is cut, if at all, at a line the status bar's height (66 px) past it:
`scroll-bounded` lists `P` whole at `[128,798][953,974]` under `upper` ending at 908, and `S` at `[128,1519][953,1607]`
under `lower` ending at 1541 — 22 px of it drawn. Its `horizontalScroll` carousel's card `C` is cut to the SCREEN's
edge, `[1014,380][1080,614]`, right of the carousel ending at 1014 — nothing of it drawn. `S` and `C` were tapped on
the background and reported done, `C`'s colour passed on the page's background, and both stops called all three visible
after 0 swipes. Google Contacts' staged form (`android-ui-snapshot-compose.json`) lists the "First name" field 142 px
above its scroll view's top too.

- **The drawn frame is asked on every tree that lists ancestry** (`Clips.drawnIn`'s gate is `ancestry` alone), not on
  WDA's alone. A scroll view draws nothing outside its frame on either platform — a fact of drawing, not of a source's
  dialect. Where uiautomator did cut, the frame is a no-op: over the 43 Android XML captures (771 nodes) only the eight
  rects measured past their scroll view change, and over the ui_snapshot capture (`android-ui-snapshot-compose.json`)
  only Google Contacts' "First name" field and boxes above its form and its "Add fields" containers past it
  (`tests/ui-tree/standing.test.ts`, "a no-op where uiautomator did cut").
  The verbs answer as on WDA's tree of the same screen: `S`'s tap is refused outside `lower` ("only 25% of it … is
  drawn"), both stops stroke inside `lower` and `upper` and fail clipped at their edge; `C`'s tap is refused outside
  the carousel, its colour fails closed, and `scroll_until C right` strokes sideways inside the carousel.
- **A unit past the edge is flush, not past** (`geometry.ts#overhangAsFlush`), on every tree — the tolerance is one
  unit of the source, a px on Android and a pt on WDA, as `flushEdges`' is; measured on Android only: mp-native's SWIFT
  toggle `66,1924 948x55` ends at 1979 under its form `[0,242][1080,1978]`, the line CONTINUE starts on. Cut there by a
  pixel, the `fully` stop read it `clipped` where its flush probe is the rule (ADR 0013). `flushEdges` and `contentToward`
  read "past" as more than a pixel already.
- **The carry model stays WDA's** (`ui-tree/geometry.ts#DrawnFrame.listedWhereItLies`, true only where
  `draw-order.ts#listsUnclippedFrames`; the standing hands it on as `StandingFacts.listedWhereItLies`, which
  `interact/course.ts#stillNeeds` asks): the drawn frame no longer tells the dialect, and on Android a row's
  rect as it comes in is mostly cut to its scroll view, so its motion is no measure of the content's. The dialect is
  read in ui-tree, by the drawn frame's owner, not again by `scroll_until`.
- **The sliver rule stays for a rect cut flush** (ADR 0013): a rect cut flush with its container is judged by the
  sliver rule and the flush probe, a rect past it by the drawn frame.

- **The navigation-bar cut reads the drawn part** (`standing.ts#cutAtNavigationBar`, ADR 0009's N-b): a node dumped
  past a scroll view ending at the navigation bar (Contacts' "Add fields" container `132,2067 312x132` under its form
  ending at 2154, the lab's `form-picker` `FO` at `[0,2080][1080,2220]`, its glyphs cut at the form's 2154 in the
  screenshot) is drawn to that bar's top exactly as a node uiautomator cut flush there is, so an ocr assert on it fails
  closed the same way; a colour assert measures its drawn part (D5).

Residuals: the share a reply quotes is of the DUMPED rect, which may itself be partly cut (`S`: "25%" where 12.5 % of
its 176-px frame is drawn — WDA says 13 %). A `scrollable="true"` node that does not clip what it lists (a Compose
`Modifier.scrollable` without a clip, a peek carousel drawn past its frame) is read as clipping: what it draws past
its frame is read as not drawn — a tap refused, a colour or ocr assert failing closed, never a pass on what is not
there; unmeasured, no capture shows one. The unnamed children of `scroll-bounded-flush`'s targets and `form-picker`'s
`FO` are judged by the frame too (each runs 66 px past), and so is `android-lab-form-keyboard-k7-stop`'s `reference` (17 px above its
ScrollView) — none with a golden check changed.

Bug note: docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md

## Residuals accepted

1. When the reading cannot see the keyboard, the old behaviour returns silently. Examples: a floating or split IME that
   supplies no insets frame, and the transient read right after the focus tap.
2. The API 34+ `type=ime` line comes from AOSP and has not been captured on a device.
3. A multi-display device reads unknown.
4. A stale `shown` costs covered rounds until the window state catches up. Under a short timeout it fails closed with the
   covered wording, never a false pass.
5. **idb lists no scroll view** (a flat list) — **refined 2026-10-20** (round 14, LE2): the drawn frame is UNTOLD there
   (`ui-tree/geometry.ts#DrawnUntold`, a named answer of `Clips.drawnIn`, not "nothing cuts it"), and the eyes look
   where a claim rests on it, from the frame the claim is checked on:
   - the colour assert asks whether its region reads as the screen beside it (`verify/eyes.ts#apartOfFrame`, on the
     frame it measures — no capture added): a region of nothing but one colour, a plain strip beside it that colour
     too, fails closed ("its region reads as the screen beside it … measure it under treeSource: wda"). The lab's
     `scroll-bounded` O (wholly below `lower`) and `carousel-in-list`'s C (right of its carousel) no longer pass on the
     background; every node drawn where idb lists it shows something of its own — "nothing of its own" is a COUNT,
     at most one point's worth of pixels off the region's dominant (`OWN_PIXELS_MAX`), not a share, so a short label
     on a wide row is its own: over the 393 nodes idb lists in the 32 lab captures, O and C have 0 px off, every other
     node at least 777 (a placeholder, a label). Asked on a frame settled over the region only too: the background
     under a clip holds still while a spinner or a caret elsewhere moves, and a strip beside still moving is no plain
     strip — so it fails closed as on a still screen, the miss no final one (unlike ADR 0024's order question, whose
     `untold` keeps the element covered; skipping it here would measure, a PASS on the background). What it does not
     see, measured as before (a PASS on the background, as before this refinement): anything of what lies beneath the
     clip inside the region (a separator, a shadow, text — more than a point of pixels reads apart), and no plain strip
     of the screen beside the region (`untold`). The ocr assert is not asked: a region of one colour holds no glyphs
     to pass on. Its cost: an element drawn in nothing but the colour around it (an empty, unbordered card on a page
     of its colour) fails closed under idb too — nothing in the frame tells it from the screen either;
   - a `fully: true` claim looks for a clip line at each edge, one screenshot (ADR 0013, "the eyes", refined
     2026-10-20): P (cut at `upper`'s 330) and S (at `lower`'s 560) are no longer "fully visible". It cannot see a
     clip with no plain screen beside the target (a full-width row) or a scroll view the colour of what lies beneath
     it (ADR 0013's residuals): there the claim stays the tree's.
   - **Narrowed 2026-10-22** (round 16, LE2's rest, `19525e29` + `9fd4aff2`): a CONTROL listed after the row, past the reading-order
     break, that overlaps it and holds its centre is a cover whose order is not told (ADR 0015 amended; ADR 0024
     gets a third trigger): the lab's `scroll-bounded-footer` O, a Continue `16,600 370x56` under the clip listed after
     it with its top above the row's, was `Tapped` — the tap FIRED Continue — its colour passed on Continue's colour and
     the plain stop said "fully visible after 0 swipes". Now the colour assert and the plain stop refuse (the order
     question is asked where a control listed after the row holds its centre — one screenshot per plain stop, and per tap only
     where no tappable piece is left clear of it (O's tap moves clear and asks nothing); the colour assert asks on the
     frame it measures, none added; the targets it asks of, over the committed corpus: ADR 0015's 2026-10-22 amendment)
     and the tap is moved clear of Continue; what the row's tap says is still `Tapped`, on the background below the clip.
   What stays, accepted: where NOTHING IS LISTED BENEATH the row (no control over its centre), the tap, the plain stop
   and the strokes are judged on the screen alone — an element below a
   short scroll view (the SWIFT form's text field at `42,817`, the lab's O and S) is refused only where something the
   flat list pins over it says so (a bar's reach to the screen's bottom, `draw-order.ts#bottomPinned`), and otherwise
   tapped and stopped on; `scroll_until` strokes over the screen's middle, which may miss the scroll view that holds
   it (the lab's F, C) — until two reads see the target carried, then a stroke carrying content back goes over the
   region its motion showed (residual 6, refined 2026-10-21); **narrowed 2026-11-12** (A38b, below): a SIDEWAYS stroke
   for a target the read lists goes over the target's own row, so C is stroked inside its carousel's band. Why not more: a screenshot per tap or plain stop would
   double the cost of the commonest verbs
   under the default tree source (idb), and nothing cheaper sees the clip — idb's `Scrollable` trait marks 372 of the
   409 nodes idb lists in the 33 iOS lab captures (the 32 above and the React Native app's), contents and all, and an
   element "listed past the screen" is no clip (13 of those 33 captures, 11 with nothing cut); refusing every untold node would refuse 88 green taps. The remedy is the tree source that lists
   the scroll views: `treeSource: wda`, which the tool descriptions name, and under which every one of these rows is
   answered as the truth does.
   docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
6. **Strokes over the screen's middle, not the target's scroll view** (iOS) — **closed 2026-10-16**: the scrollers now
   feed the stroke's containers on a WDA tree (`interact/stroke-plan.ts#targetScrollers`: the clipping chain, else
   `Clips.drawnIn`'s `scrollers`), and what WDA draws over such a scroll view cuts the stroke as on Android
   (`draw-order.ts#DrawOrder.drawnOver` finds its container among the nodes that scroll). Lab notes LE4 and LV3
   (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md). Still so under idb, which
   lists no scroll view — **refined 2026-10-21** (round 14, lab note LV3,
   docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md; fix
   `02aabfa6`, `interact/motion-shown.ts`):
   - **The bar**, judged PER CALL against the code before the fix (`e267ebfc`): a call that ended in an honest failure
     there and in a false stop here is a new false stop, whatever false stops the fix removes elsewhere — the agent
     that asked for X gets "Tapped X" where it got "failed", and the tap lands on a header. Measured on a physics replay
     of the lab's `tabbar-dense` and `tabbar-floating` captures (the list shifted as each stroke would carry it; a touch
     on the header or the tab bar moving nothing; 41 grids — drag ratios 0.6–3, seven starts, the rows of the list, both
     directions, plain stop and `fully: true`; header centred, to one side, with no node, 200–300 pt deep; no tab-bar
     node; a plain list; a scroll begun mid-list; rebounds at the end of 1–3 reads; drifts of 60, 300 and 500 pt
     beginning with the first stroke; a bar from 680; a 50-pt slip; jitter at the ends; each of strokes 1–5 dropped; a
     ticking label; `tabbar-floating` with the list's end at 1960–2100 pt, rebounds, no tab-bar node — 46 660 calls).
   - **The rule** (`MotionShown`, `goesOver`, `carriedUnder`; judged per read from the region and the last stroke
     drawn — the round's `lastDrawn`, a field it already kept — no tree read added, no new state):
     1. THE REGION: once two reads see the target moved, the nodes carried with it by its delta (within a 20th of it:
        idb reads a list mid-fling node by node), two at least on the screen below the status band, bounded in both
        reads and cut at the chrome that held still in a band across the rows (`chromeOf`, `stillCut`: the header's
        title, the tab bar's buttons; a floating button or a section index beside the rows is none) — 24,300 354x455 on
        `tabbar-floating`, 24,110 354x645 on `tabbar-dense`, whose rows idb lists under the header up to its title.
        `way`: the side the content moved toward at the FIRST sample on the axis, kept (a bounce, a rebound or a jitter
        flips the latest).
     2. PLACEMENT: a stroke moving content the other way from `way` goes over the region — the turned stroke touches
        down at (201,391) on `tabbar-floating`, (201,239) on `tabbar-dense`, inside the list, not at 175 in the header,
        where it moved nothing. A stroke moving it `way` keeps the screen box: the stroke that made the region, so the
        forward side is the code's before (forward over the region too: 94 new false stops without a tab-bar node).
     3. THE BAND (`HeldBand`): a match whose centre (for `fully: true` any of it) lies short of the line a stroke
        over the region touches down on (`swipe.ts#swipeVector`: the region's centre less SWIPE_REACH_FRACTION of its
        length — 391 on `tabbar-floating`, 239 on `tabbar-dense`), on the side `way` names and on the side the last
        stroke drawn pushed the content toward, is no stop. The last stroke's side holds on every read until the next
        stroke, the confirming reads included: a stop after a stroke is claimed only on a confirming read, and a fling
        carries the target on into that side's band between the read right after the stroke and it — judged on the read
        right after the stroke alone, 100 new false stops on a replay where that read sees a share of the stroke's
        motion (0.3–0.9, one grid 1) and the next the rest (51 860 calls, 30 grids); on every read, 1 (residual (f)).
        Sound as a refusal: a stroke touching down at the line lands on chrome and moves nothing, or lands on content —
        and then no chrome on that side reaches past the line; so a target carried toward that side is never claimed
        before it lies past the line, whatever idb lists under a header. It closes the false `Tapped` measured live at
        an intermediate form (05a16a9a's src, records on `bugs/r14-lv3-vouching-abandoned`): rows carried under
        `tabbar-dense`'s header grew the region to the title (110), and R carried back to 158 and 143, inside it, was
        claimed — the tap went to the header (2 runs of 13).
     4. STILL-FACING: a match past the region's edge toward a node that held still facing the rows (across the axis,
        the region's span — not the match's: a narrow target beside a centred title faces it all the same) is no stop,
        on any side — R carried to 114 under `tabbar-floating`'s header, toward its title; on a short list, a row under
        the tab bar's buttons on a side neither the first motion nor the last stroke covers. Kept against the reset
        design, which dropped it: without it, new false stops per call on short lists — 2 on a 300-pt list, 4 with no
        header node, 8 with every row a target — and none with it. It faces any node that held still, not only the
        chrome `stillCut` cuts at (`chromeOf`): a refusal only, so the broader set can only refuse more; on every grid
        here `chromeOf`'s set holds back the same stops, call for call.
     5. A held match at the far edge turns the strokes, as a target across that edge does; at a stuck or bound end an
        honest LOUD names the band and its line ("it lay above y 239, where a stroke over where its content was seen
        moving (24,110 354x645) touches down carrying content away from its top edge — in the band 24,110 354x129 or
        past it — … no stop was claimed on it"), or the still node (`toward text "Header" (173,90 56x20), which held
        still while it moved`), and the remedy, `treeSource: wda`.
   - **What it costs**, per call against `e267ebfc`. On the 41 grids: ONE new false stop (DRIFT 500, below); 7 ok →
     fail, every one an honest LOUD (a row stuck under the tab bar's buttons after a drift, a floating F in a 145-pt
     region); +1 stroke on 188 of the 17 903 calls ok in both, +2 on 66, +3…+5 on 22 (the floating grids); no read more.
     Base's own false stops after a stroke 1490 → 255 (254 where base has them, and the DRIFT-500 one), calls ok 17 911
     → 20 297. Under a ticking label and the rebounds: no new false stop and no ok → fail (the rule reads no rest; the
     label moves one call's stroke count, ok in 4 or 7, never a verdict). Live, an `up` call to the page's top pays
     strokes: the first stroke carries the page down to its top (`way` bottom), the turned stroke over the region pushes
     the content up, and a confirming read finds the target in the band on that side and holds it — the strokes
     alternate (the screen box's 175, the region's 376) until it lies past the line: `scroll-top-edge`'s and
     `scroll-top-edge-end`'s T 1 → 4–6 swipes against round 7, their turn cases 1 → 3, carousel-in-list's B 2 → 4; all
     ok and Tapped, no read more. Beyond the 41 grids, on the review's: under a fling (above; 51 860 calls) 1 new false
     stop (residual (f)), 22 ok → fail, +1075 strokes over 760 calls; on 31 more
     grids (50 512 calls: 300- and 600-pt lists, headers 100–150 pt or to one side, a bar from 600 or 680, drifts of
     −300…500 pt, rebounds, slips, jitter, dropped strokes, the floating rows under most of these) 4 new false stops,
     all DRIFT 500 (residual (a)), and 63 ok → fail, every one an honest LOUD naming the band — 45 on a 300-pt list with
     every row a target, started past its end (rows 10 and 11, `down`: the first read sees the content carried down, and
     the row, near the tab bar at the list's end, lies in the bottom band — an artifact of the replay, whose start is
     not clamped to the list, not a device's behaviour), 4 of the floating F at drag ratios 4 and 6, the rest after a
     drift, a jitter or under a 100-pt header, where the turned strokes spend the budget alternating to the bound. Under
     a CAUGHT fling (the same 30 fling grids, a stroke's touch-down stopping what the fling had left; 51 860 calls): 6
     new false stops, none on the rule's own path — one the coincident app scroll (`F 3 700 row.20 up` at a 300-pt
     drift, residual (a)), five on a 600-pt list started past its end (`S * 1700 row.12 down`, the replay's unclamped
     start); 51 ok → fail, all honest LOUDs, 20 of them at a fling of 0.3; +1272 strokes over 874 calls. 31 of the 51
     are L at the list's end: there "L at the end stays the code's before" does not hold — base confirms L at 833, under
     the tab bar, and the fling carries it on to 680, claimed; here the still-facing hold refuses it at 833, each stroke
     after it catches the fling, L crawls a third of a stroke at a time and the bound (8) finds it under the tab bar's
     button. Live (idb, the lab simulator, at `02aabfa6`'s src): tabbar-dense R (201,699), (201,239), (201,239), Tapped
     R, five of five — once after a 4th stroke, (201,699), the turned strokes' fling having carried R past the bottom
     line, held on the confirming read; tabbar-floating R (201,699), then (201,391) three times, Tapped R, three of
     three, once after a 5th the same way; tabbar-dense L by the screen box's strokes as before, three of three; the idb
     visibility group with nothing not known — swipes up where the band holds a target near its list's end (against
     round 7: scroll-top-edge T 1 → 4–6, its turn cases 1 → 3; carousel-in-list B 2 → 4)
     (docs/truth/live-ios-2026-10-18-visibility.md, round 14 LV3). Grids and harness: the round's scratch
     (`lv3-reset/grid.sh`, `zz-b.test.ts`; the fling's `zz-c.test.ts`), not committed.
   - **Rejected: the pushed sides kept over the call** — every side a stroke of the call pushed content toward stays
     banded (sticky; derivable from the course's `strokedToward`, no new state). It closes residual (f) and the
     DRIFT-500 calls, but a side pushed by strokes that moved nothing (touching down on the header) stays banded,
     refuses an honest stop, and the next stroke carries the row under a deep header: 2 new false stops under a fling
     (`F 1 700 row.20 up` at a 300-pt header), +41 ok → fail and +329 strokes over the grids above.
   - **Rejected: motion-proof vouching** — crediting the touch-downs of strokes that moved the content, reads at rest
     before such a stroke, magnitude gates, end probes, least strokes, a lone-target mode (`2c9956f9` and its records
     `4bda76a0`, kept on `bugs/r14-lv3-vouching-abandoned`, not landed). (A) Credit taken from the tree cannot tell the
     stroke's motion from an overscroll or the app's own scroll coinciding with it: on the replay, a rebound at the
     list's end, a fling still running or a drift beginning with the stroke credited a touch-down on the header — false
     stops reachable (3 new at DRIFT 300, 9 at DRIFT 500, per call). (B) It needs reads at rest, and one ticking label
     (a clock, a rate) means none is: every idb stop after a stroke failed — 1034 ok → fail of 2224 on the all-rows
     grid; 39 ok → fail on the standard grid, 209 on all rows, 170 with deep headers, 202 under rebounds. Cost: up to 5–6
     strokes and about 2 reads more a call.
   - **Rejected: eyes** — a screenshot judging a stop in the band, LE2's clip line read the other way round (the
     orchestrator's decision, 2026-10-21): (1) the band they would judge is bounded by where content is vouched for,
     and a call that starts mid-list, rows already under the header at its first read, has none there — nothing for the
     eyes to tell a drawn row from; (2) a clip line read the other way round takes whatever is not the screen beside the
     row for the row drawn: the header's title glyphs, a back button, a blurred or translucent header — and iOS's
     default navigation bar is translucent (a material idb lists as no node), its content showing through — all read as
     "drawn" over a row beneath them; (3) it was never asked live (every after-run's read after the turned stroke caught
     R mid-fling past the region) and costs a screenshot, 0.6 s.
   - **Residuals**: (a) THE COINCIDENT APP SCROLL — an app scroll that coincides with the first stroke (which landed on
     the header) sets `way` wrong: the strokes that move the content then go over the region and the turned ones keep
     the screen box; measured at 300 and 500 pt — at a 500-pt scroll, one call in 1120 on the standard rows (`F 3 700
     row.20 up`: row.20 claimed at 136, under the header — the 41 grids' one new false stop), 3 in 5600 with every row a
     target, 1 in 420 on the floating rows (`S 3 700 x.R up`); none at 60 or 300 pt there, but one at 300 pt under a
     caught fling (above). `way` from the course instead closes it and opens 349 (in an `up` call the strokes that move
     content are the turned ones). (b) Chrome idb does not list, or whose extent it cannot show, reached by the forward
     stroke — the code's before, residual 5 (base's own false stops, 255 left on the 41 grids: 254 where base has them,
     and the DRIFT-500 one); remedy `treeSource: wda`. (c) The first stroke is the
     screen box's: nothing has moved yet (residual 5). (d) A target not in the tree (a lazy list's unlabelled rows, NI1)
     gives no region — and since 2026-10-22 (round 16, open-bugs #9; ADR 0018, "idb's presented layer", Decision 3)
     its first content-up strokes, until one has moved the tree, are feelers: the screen box's touch-down, 160 pt in
     600 ms (interact/stroke-plan.ts#StrokeKind), so a large sheet idb shows no sign of springs back; a list moves on
     the first and gets full strokes after it — one short stroke a call. (e) A target in the band that the strokes cannot carry past the line (the list's first row reached
     from above at the list's top, a floating row in a short region) is refused to the stuck or bound end — an honest
     failure naming the band, never a stop; and L at the list's end under a fling its strokes catch (above). The cells
     started past the list's end (`short300all`, `f7s600`) are the replay's unclamped start, not device behaviour. (f) A
     BAR NO NODE NAMES, reached through the turned strokes: with neither a header nor a tab-bar node the region is the
     gesture box (24,62 354x812, `way` top); under a fling the turned strokes carry the row past the bottom, the forward
     stroke brings it back to 699–751, its foot under the unlisted bar at 743, on the bottom side, which neither `way`
     nor that stroke bands — claimed `fully` (`F 3 300 row.20 down`, a fling of 0.7, 1 call in 1120; base's turned
     strokes touched down on the header, moved nothing and failed honestly). Residual 5's mechanism: nothing in the tree
     says the bar is there.
7. **A stroke across a scroll view's axis** (LE4's residual) — **refined 2026-10-18** (round 22, `arch/r22-axis`): the
   stroke's scroll view is taken among the target's scroll views that scroll ALONG the stroke or whose axis the tree
   cannot tell, nearest first, and inside it the stroke's path keeps off every nested scroll view that scrolls only
   ACROSS it — the longest stretch of the scroll view clear of it on the stroke's line, when that stretch has room
   (`interact/stroke-plan.ts#strokeRoom`, `#clearLane`). A card of a horizontal carousel nested in a vertical page,
   scrolled for `down`, is stroked over the page, not vertically in the carousel; a page's content-down touch-down on
   such a carousel is moved off it. The cost: the lane shortens the stroke to its stretch's 60 % — on the note's
   geometry (a carousel `24,700 354x85` in the page `0,180 402x694`) 312 pt of finger travel (596 → 284) for the page's
   416 (735 → 319), so more rounds against the swipe and time budget for one scroll. The axis per source
   (`ui-tree/scroll-containers.ts#scrollAxis`): Android by class (`ScrollView`, `ListView`, … vertical;
   `HorizontalScrollView`, `ViewPager` horizontal — a Compose `verticalScroll` dumps as `ScrollView`,
   `horizontalScroll` as `HorizontalScrollView`); WDA's `Table` vertical, else a scroll view's content that runs on
   past its frame on one axis alone — a node straddling the frame's edge by a quarter of its side, or one wholly past
   it continuing a same-sized sibling inside it, never any node past it (a drawer at x −300, swipe-action buttons, a
   page beside a fitting page read nothing). False readings left: a node of a fitting page straddling its side by a
   quarter without scrolling (an overflowing row it clips), and a same-sized sibling beside a fitting page's content (a
   pager's page the tree lists as no scroll view) — each reads that page horizontal; unknown — today's behaviour — for
   a Compose lazy list or grid, a RecyclerView, a WDA scroll view whose content fits or runs on past it by less than a
   quarter of its side with no same-sized sibling past it, and idb — false negatives among them (a chip carousel of
   mixed widths, a card carousel spaced more than a quarter card apart with none straddling its edge, full-width cells
   paged exactly with the next cell unlisted) all fall back to today's stroke. Fallbacks: no candidate along the stroke
   with room — the pick as before (the nearest with room, whatever its axis: mp-native's Account Detail as captured,
   whose carousel no list holds); no clear stretch with room, or none left with room by the cut for what is drawn over
   the scroll view — the stroke as before, over the nested scroll view; the `fully: true` probe never goes over a
   scroll view that scrolls only across it (unchecked, not a probe that moves nothing; a flush chain of such scroll
   views alone says so, `flush.why: 'axis'` — Android only in practice: WDA's clipping chain is empty). Still
   UNMEASURED on a device: what a carousel hands the outer scroller of a cross-axis drag (~51 pt a stroke, inferred);
   the lab's `carousel-in-list` cell (harness task H2) is to show it, and a lazy-row carousel there reads of unknown
   axis on Android. See the D59b amendment below.
8. **An ocr assert on a text line cut at its scroll view's edge** reads only the drawn part, so its glyphs may be cut (a
   21-pt line with 15 pt drawn is read on clipped glyphs). Android's glyph readers fail closed on a node that may be cut
   at the navigation bar (`ui-tree/standing.ts#cutAtNavigationBar`); there is no counterpart at a scroll view's edge yet.
9. **A scroll view that draws past its frame** (SwiftUI's `.scrollClipDisabled()`, a UIKit scroll view with
   `clipsToBounds = NO`) is judged as one that clips: content it draws outside its frame is refused, never measured —
   the safe direction.

## Amendment: D59b — before the target is found, the largest scroller's nested scroll views (2026-11-03)

**Context.** Residual 7's rule chose among the TARGET's scroll views; before a read finds the target the only
candidate was the screen's largest scroller (`ui-tree/geometry.ts#largestScroller`). Batch-11 (the averi_lab emulator,
API 33, 1080x2220, `d59b-measure` on main a5fefd32): `scroll_until` right for card C of the L7 cells
`carousel-lazy-free` and `carousel-recycler-free` from a fresh launch, where C is not laid out, so no read finds it.
6/6 runs stroked `(864,1110)→(216,1110)`, the page's centre row, 496 px below the carousel's band (y 380–614). The
carousel never moved, and the call failed "content exhausted, still loading, or the swipes were not taken". A raw stroke
in the band, `(872,497)→(208,497)`, moved it 4/4. Cause: the page `0,0 1080x2220` (a ScrollView, told vertical) scrolls
across a `right` stroke, so `strokeRoom` dropped it, found no other candidate and took it anyway through the
`'any axis'` fallback. The carousel (a LazyRow dumped as `android.view.View` or a RecyclerView, no told axis) was never
a candidate.

**Decision.**
1. Before a read finds the target, the candidates are the largest scroller, then the scroll views nested in it
   (`interact/stroke-plan.ts#candidatesOf`, from the `ScrollAxes.nested` it already reads). The nested ones the tree
   tells scroll along the stroke come first, then the rest, each group largest first. Text inputs (`INPUT_ROLE`) are
   left out (`Clips.axesOf`, through the one predicate `toldOn` shares): a Compose text field dumps as a scrolling
   (Horizontal)ScrollView, role `textfield`, and a sideways stroke must not land in one. That is an Android matter:
   WDA marks no node clipping, so it has no largest scroller. The page stays FIRST, so residual 7's axis rule takes a
   nested one only when the page scrolls across the stroke. Every stroke along the page, a page of unknown axis and
   the all-across fallback are as before; so are iOS and idb. The lab's carousel is now stroked inside,
   `swipeVector(66,380 948x234, right)` = `(824,497)→(256,497)`.
2. The rule is symmetric, on purpose: a page told HORIZONTAL (a pager) stroked `down` or `up` before the target is
   found now strokes the list nested in it (of unknown axis or told vertical), where it stroked the pager across its
   axis before. It changed for the same reason as the carousel: a stroke across the pager moves nothing of it, and
   the list inside is the one a vertical stroke is for. The stroke there is cut above what is drawn over the list, as
   any stroke (tests/interact/stroke-plan.test.ts, "the same rule the other way").
3. When the strokes still went across a scroll view whose axis the tree tells (`stroke-plan.ts#strokedAcross`), the
   exhausted stop says so first, after a node named under the touch-down and below an end the tree proves
   (`scroll-rounds.ts#BoundBy`'s `across`, `scroll-text.ts#boundText`). What it says of the other way is asked of the
   WHOLE tree (`Clips.toldOn`), counting only scroll views that meet the usable screen (the round's box less the
   status and navigation bands, `geometry.ts#clearOfSystemBands`) and none of the keyboard's own
   (`soft-keyboard.ts#keyboardSideNodes`, the reading's `ofKeyboard`: WDA's suggestion strip). Three wordings:
   - one such view the swipes did not go over (the largest is named): `… which scrolls vertically, and the tree shows
     scrollable id:feed.chips (0,2000 1080x150), which scrolls horizontally, and which the swipes did not go over —
     swipe inside it (swipe, its coordinates), then scroll_until it; else: content exhausted, still loading, or the
     swipes were not taken)`;
   - one the plan judged without room (`StrokeRoom.roomless`, recorded where the plan judges room): `…, which scrolls
     horizontally, but which had no room for a swipe — …`;
   - none: `failed after 2 swipes (the last 2, swiping right, did not change the screen: each went across the scroll
     view it was drawn over, 0,0 1080x2220, which scrolls vertically, and the tree shows no scroll view that may
     scroll horizontally — if the element lies in a horizontal list the tree does not show as one, swipe inside that
     list (swipe, its coordinates), then scroll_until it; else: content exhausted, still loading, or the swipes were
     not taken)`.
   After the `else:` the generic stop's causes stand whole, idb's top-layer hint (`TOP_LAYER_ONLY_HINT`) included.
   The clause does not depend on whether a read found the target: it describes the strokes.
4. No change to `swipeVector` or to the stroke's length.

**Departures decided in review.** The spec asked for the page's nested scroll views largest first and an across
clause saying no scroll view on screen scrolls that way. The reviews changed three things, each for an honest reply
or the stroke that reply implies: `Clips.toldOn` asks the whole tree, so a chips row beside the page is not denied
(round 1); the three wordings above, so a view that exists is named and one without room is said to have none
(rounds 1 and 2, with the screen and keyboard filters of round 2); and told-along nested views rank before
unknown-axis ones, so a chips row is stroked before a larger feed that is most likely vertical (round 1).

**Residuals.** (a) A nested scroll view of unknown axis that really scrolls vertically (a RecyclerView list inside a
NestedScrollView) is now stroked sideways when no told-along one has room, and the reply stays the generic one. (b)
On a page with two carousels of one kind the larger is stroked, and it may not hold the target. (c) A scroll view of
UNKNOWN axis does not count for the across clause, so "the tree shows no scroll view that may scroll horizontally"
can sit beside a RecyclerView that does. The plan strokes such a view only when it is nested in the page; a sibling
one is never stroked. (d) A carousel the dump marks neither scrolling nor clipping is no candidate. Only the across
clause helps there. (e) Where the nested view does not take the strokes, the stop changes. Over the page, batch-11's
run stopped exhausted after 2 swipes. Inside a carousel whose dump lists no content (the derived lab tree: no card
under it), no read can show the strokes' motion, so no stroke counts as unmoved. The call runs to maxSwipes: `failed
after 6 swipes (maxSwipes) — … after the last 6 swipes over the scroll container 66,380 948x234 the tree listed none
of its content where a swipe's motion would show (…), so how far they moved it is unknown — the element may lie
further right: raise maxSwipes or timeoutMs` (a default call, DEFAULT_MAX_SWIPES 6; the test pins it at its own
maxSwipes, 4). That costs 6 swipes instead of 2, and it advises raising maxSwipes although nothing visibly moved. The
reply says the motion is unknown, not that the carousel moved, so it stays honest. On the device the carousel lists
its cards, so this applies only where it lists none.

**Golden.** Changed 0 against main's baseline after each round: Android truth's only sideways target
(carousel-in-list C) is listed, so its strokes take the target's path, untouched; iOS has no largest scroller; no
capture holds an absent target with a sideways direction. Golden would not catch D59b anyway: its stroke row skips
the in-scroll-view check when the target is absent (T6). The shared band helper (`clearOfSystemBands`, now also
`standing.ts#systemBands`' `clear`) changed no row.

**Tests.** tests/interact/stroke-plan.test.ts (the derived lab trees
`tests/fixtures/uiautomator-lab-carousel-*-launch.xml`, made from the committed `carousel-in-list` capture, since the
batches kept no dump, and batch-11's strokes, `tests/fixtures/d59b-b11-strokes.json`, trimmed),
tests/interact/scroll-rounds.test.ts (the across clause, its order and wordings, the screen bands, the maxSwipes stop
of the derived tree), tests/ui-tree/geometry-clips.test.ts (the text input left out, `toldOn` and its filters),
tests/ui-tree/geometry-viewport.test.ts (`clearOfSystemBands`). Hand mutants, each from a saved copy, each killed:
- M1 page only → the lazy-free stroke; M2 nested smallest first → "two nested of unknown axis"; M3 nested before the
  page → the `down`/`up` control; M4 text-input filter removed → geometry's text-input test; M5 unknown axis as
  across → the carousel `down` group; M6 `strokedAcross` on an unknown axis and M7 `===` for `!==` → its test; M8 the
  across clause before `touched` → `boundText`'s order; M9 `across` dropped from the bound and M13 the bound asked
  for `down` → the across reply; M10 nested `over` emptied → the pager `down` under a bar; M11 nested axes undefined →
  the told-vertical-list control; M12 the axis word fixed → `boundText`'s horizontal-page case.
- Round 1: N1 ranking dropped and N2 inverted → chips before feed; N3 `toldOn` keeps text inputs and N4 its flat-list
  guard removed → `toldOn`'s test; N5 `along` never set, N6 smallest picked, N7 `noRoom` inverted, N9 asked of the
  page's own axis → `strokedAcross`' tests; N8 the two wordings swapped → the rounds replies.
- Round 2: R1 the screen filter removed and R2 the keyboard filter → `toldOn`'s test; R3 no bands, R4 no navigation
  band, R5 no status band → the rounds bands test; R6 no keyboard predicate → the WDA keyboard test.
- Code review: S1 and S2 the generic causes or idb's hint dropped after the `else:` → across with `unlisted`; S3
  `roomless` never recorded and S4 always set → the no-room and sibling tests; S5 the shared predicate without the
  text-input clause → the text-field form page; S6 and S7 `clearOfSystemBands` without its navigation band or its
  `shape` → its test; S8 `systemBands`' `clear` without the navigation band → the navigation-band standing tests. One
  equivalent survivor: `strokeRoom`'s `along.length === candidates.length` guard removed (with no candidate across,
  the fallback's pass is the first pass again).

Device gate: `d59b-measure` rerun in the next batch, FAIL → PASS.

## Amendment: D76 — the scroll views along the stroke the swipes did not go over (2026-11-09)

**Context.** D59b's candidates, before a read finds the target, are the largest scroller and the scroll views nested
in it (`stroke-plan.ts#candidatesOf`). A sibling of the largest is never one. On android `scroll-bounded`
(tests/fixtures/truth/android-averi_lab-api33/scroll-bounded.*) the screen holds two vertical lists, `upper`
`0,303 1080x605` and `lower` `0,1046 1080x495`. O and F are rows of `lower` that uiautomator does not list. Every
stroke for them went over `upper`, at (540,788), twice, and the call failed "content exhausted, still loading, or the
swipes were not taken". The reply never said that `lower` was not tried. That is D59b's honesty class: there the
scroll view lay across the stroke, here beside it.

**Decision.** (a) When a bound stops the call before any read found the target — exhausted, maxSwipes or the
timeout, once a swipe was sent and the round's tree read — the reply names the scroll views the tree tells scroll
along the stroke that the swipes did not go over: no swipe of the call touched down in them (`stroke-plan.ts#strokedBeside`,
carried as `scroll-rounds.ts#BoundBy`'s `beside`, said by `scroll-text.ts#boundText`). They are asked of the whole tree
(`Clips.toldOn`, as the across clause asks it: the usable screen, no text input, none of the keyboard's own), less
any that holds the touch-down of ANY stroke sent in the call (the stroke memory keeps them all,
`stroke-plan.ts#strokeSent`: an earlier stroke inside a nested list, the last over the page holding it, leave out
both; each stroked view holds its own touch-down, so it is left out with it), largest first; the 3 largest are named, the rest counted (`and 2 more`). The order touched → across → beside is the
sentence's, not a precedence: under a node named at the touch-down the clause is said inside its `else:` (`… which
may have taken them (else: <beside>; else: content exhausted, still loading)`). It never comes with the across
clause: `strokedBeside` is undefined when the last stroke went across its scroll view. An end the tree proves
outranks it, as it outranks both. At maxSwipes and the timeout the bound's own way out follows it: `after 1 swipe
(maxSwipes: <beside>; else: raise maxSwipes or timeoutMs)`, `after 16000ms (timeout 15000ms; 1 swipe sent; 2 tree
reads took 900ms, the last 450ms; <beside>; else: raise maxSwipes or timeoutMs)` — told only to raise the bound, a
caller strokes the same list again (review round 1). The exhausted wording:

`failed after 2 swipes (the last 2, swiping down, did not change the screen: the swipes went over the scroll view
0,303 1080x605 only; the tree shows another scroll view that scrolls vertically, which the swipes did not go over:
scrollable (0,1046 1080x495) — if the element lies in it, swipe inside it (swipe, its coordinates) until the element
shows, then scroll_until it; else: content exhausted, still loading, or the swipes were not taken)`

Several are counted (`2 other scroll views that scroll vertically, …: A, B — if the element lies in one of them, …`).
Over the screen box (WDA marks no node clipping, so before the target is read it strokes the screen whole) the first
clause reads `the swipes were drawn over the screen whole (aimed at no scroll view), touching down at x,y inside the
scroll view <rect>` (the last touch-down; the smallest scroll view told along the stroke holding it, the point alone
where none does), and `a scroll view` replaces `another`. That touch-down clause is an extension accepted in review
round 1 (its NIT-2), beyond the decision's wording: over the screen whole, "the swipes went over X only" has no X,
and where the finger landed is what the reader can check. On the WDA capture of the same cell a target not in the
tree now names `lower` (0,380 402x180), touching down at 201,175 inside the scroll view 0,110 402x220, the list above
it — tests/interact/scroll-end-turn.test.ts's "nope" stop, re-pinned for it. Golden does not cover it: no iOS capture
holds a framed target that the tree does not list, so no iOS row asks the R-stroke naming.

(b) **Rejected:** trying the candidates in turn, as D59b's nested ones are tried. It spends device time. It moves
lists the caller never named. On `scroll-bounded` it still cannot reach F within the defaults (6 swipes, 15 s).

(c) **Filed then, built since (D78, the amendment below):** a `within` option on `scroll_until` that names the scroll
view to stroke. The reply now cites it as the remedy, in place of the manual swipe.

**Residuals.** (1) ~~The remedy is manual: a swipe inside the named list, then `scroll_until` again.~~ Closed by D78:
the remedy is `scroll_until it again with within: <its rect>`. (2) idb lists no
scroll view (`Clips.toldOn` answers none on a flat tree), so nothing is named there. The reply is the generic one, as
before. (3) A scroll view of unknown axis (a RecyclerView or a LazyColumn dumped as `android.view.View`) is not named,
as residual (c) of D59b. (4) A bound before any swipe was sent (maxSwipes 0, a timeout spent on the first read) says
nothing of it: no swipe went anywhere.

**Golden.** Against a `git archive 6b7e49b5` base: Changed exactly 2, android `scroll-bounded` O and F `scroll_until`,
the reply only; Strike 0, COUNTS 0, Re-pin 0 (the same after review round 1 and the code review: no capture's
maxSwipes or timeout stop holds an untried list). The R-stroke row of a framed target that the tree does not list, in a
scroll view the replayed tree lists, now holds a touch-down beside that scroll view only when the reply quotes its
rect inside the reply's `which the swipes did not go over:` clause, up to its ` — if the element lies in` (StrokeOptions'
`namedSuffices` in scripts/differential/golden-spec/rows.ts, set by `edgeRows` in golden-spec/edges.ts; the reply read
by `namesUntried` in scripts/truth/replies.ts, ADR 0020's one reader, from scroll-text.ts's `UNTRIED_LEAD` and
`UNTRIED_END` and geometry.ts's `rectText`). It is red at 6b7e49b5's src
(`--side` at the extract: 2 new) and green here. Holding the strokes inside `lower` outright stays out: T6 tried that,
and averi cannot know which list holds a row it never saw.

**Tests.** tests/interact/stroke-plan.test.ts (`strokedBeside`: the sibling named; the touch-down's list left out; one
across the axis left out; undefined once found and when across; largest first; text inputs and the keyboard left
out; none when no other list), tests/interact/scroll-rounds.test.ts (`boundText` with one and several, the screen box,
the clause order; the round over the real `scroll-bounded` dump), tests/interact/scroll-end-turn.test.ts (the WDA
"nope" stop re-pinned: it names `lower`), tests/differential/golden-rows.test.ts (`namedSuffices`, a label holding a dash), tests/truth/replies.test.ts
(`namesUntried`), tests/mcp/tool-descriptions.test.ts (the troubleshooting entry, pinned through `boundText`). Hand
mutants,
each killed: the found and the across guards, the touch-down and stroked-view filters, the sort, the empty result,
the keyboard predicate, the text-input predicate (geometry.ts), `beside` dropped from the bound, the clause put
first, the `a`/`another` and `it`/`one of them` words, the axis word; in golden, `namedSuffices` always and never met,
its clip unset, its `absent` guard and its listed-scroller guard. Review round 1's, each killed: `beside` dropped from
the maxSwipes and the timeout bound and from their sentences, the swipe-count guard, the `else:` advice dropped, the
clause hidden under `touched`, the cap at 4 and `and N more` dropped, the screen box's point and list dropped, the
largest holding list for the smallest, the within path saying the point; in golden, the clause match widened to the
whole reply and past its dash. The `toldOn` sort is shared by `strokedAcross` and `strokedBeside`
(`toldLargestFirst`). Redundant guards were removed rather than left as equivalent mutants: the round's
`across !== undefined` and `movesWith !== undefined` before asking `strokedBeside` (it asks the first itself; a
`movesWith` stop has found a match). The code review's, each killed: the touch-downs kept as the last only, the
exclusion asked of the last only, the first touch-down said for the last, the timeout's `; ` as `: `, the shared
spread emptied or dropped from maxSwipes; `namesUntried` bounded by the first dash, without its lead check, passing
with no `UNTRIED_END`, or read from the reply's start or past its end. One equivalent survivor stays: `planProbe`'s
touch-down left out of the memory — a probe is sent only for a found target, and `strokedBeside` says nothing then.

## Amendment: D78 — `within`, the scroll view the caller names for the strokes until the target is read (2026-11-10)

**Context.** D76 named the lists the strokes did not go over and left the remedy manual: a `swipe` inside the list by
coordinates until the element shows, then `scroll_until` again. A caller who knows which list holds the row (D76's
reply tells it which lists there are) had no way to say so: before a read finds the target the candidates are the
screen's largest scroller and the scroll views nested in it (`stroke-plan.ts#candidatesOf`), so android
`scroll-bounded`'s O and F, rows of `lower`, were never reached by `scroll_until` alone.

**Decision.** (a) `scroll_until` takes `within`: a selector of the scroll view or of an element inside it, or the
scroll view's rect (`{"x":…,"y":…,"width":…,"height":…}`, as `ui_snapshot` and a failure reply quote it; the MCP
schema a string or that object, strict). `ScrollOptions.within` (interact/scroll.ts) is a selector string or a `Rect` — no element spec (the code review: the flow
YAML, which would need one, is out of scope, (f)).

(b) It is resolved ONCE, at the scroll's first read that reads, before anything of that read is judged
(`interact/within.ts#resolveWithin`, called by `scroll-rounds.ts#round`): a selector must match exactly one node; a
scroll view of that match's very rect is the one named (the match itself when it scrolls, the list a wrapper is laid
exactly over), else its nearest scroll view by the rule a found target's are taken by (`stroke-plan.ts#targetScrollers`,
exported for it, not copied) — one rule wherever the match lies (review round 1's MINOR-2). A string `within` is parsed,
its regexes compiled, before any device read (`within.ts#checkWithin`): one that does not parse throws `within <it>:
<why>` (MINOR-1), not an unnamed "Invalid selector" from inside the round. A rect must be the rect of a
listed scroll view exactly (`Clips.axesOf`, which finds it by `isScrollViewOf`, the test every remembered scroll view is
found again by). The resolved rect is kept in the stroke memory (`stroke-plan.ts#nameScrollView`, `Memory.named` —
not `within`, which already names the scroll view the last stroke went over), so a later read that lost it keeps it
with the cut and axes it was last seen with, as the target's scroll views are kept.

(c) Until a read finds the target the named scroll view is the first candidate in place of the largest scroller, and
the scroll views nested in it stay candidates after it, as the largest scroller's do (D59b). Once a read has found the
target, its own scroll views are the candidates as before, and `within` counts no more — silently: the target's own
list is the better evidence. On `scroll-bounded` with `within` = `lower` (its rect, or `id:lab.scroll-bounded.S`, a row
of it) every stroke for O touches down inside `lower`, not at `upper`'s (540,788).

(d) Refused before any swipe — a new stop, `ScrollOutcome`'s `within` (`swipes: 0`), its sentence `scroll_until <target>
stopped before any swipe — within <as given> …` (`scroll-text.ts#withinText`) — when it names no scroll view to
stroke: the selector matches nothing, or several (each listed, as the tap's ambiguous refusal lists them), or one in no
scroll view; no listed scroll view has that rect (every scroll view the rect path would accept is listed — told to scroll along the
stroke, or of an axis the tree does not tell, marked `(its axis not told)` — each with its rect as `within` takes it,
`Clips.scrollViewsOn`; with none, `no scroll view that may scroll <axis> — the N it shows scroll <other>`, or `no scroll
view` only when the tree lists none); the named scroll view is told to scroll only across the stroke
and holds none nested that is told along it or of unknown axis (the other axis' directions and "another scroll view"
offered; unknown axis proceeds); or the tree lists no scroll view at all (idb's flat list: `set app.ios.treeSource:
wda, or swipe inside it by coordinates`). Never a silent fallback to the largest scroller: a caller who named a list
and had another stroked would read the exhausted reply as that list's. It is refused even when the first read already
shows the target: the option is checked where it is resolved, not only when a swipe needs it.

(e) D76's reply cites it: `— if the element lies in it, scroll_until it again with within: {"x":0,"y":1046,"width":1080,"height":495}`
(several: each named `<node> as within: {…}`, as the stale refusal lists them, then `— if the element lies in one of
them, scroll_until it again with that one's within` — review round 1's NIT-1). `UNTRIED_LEAD`
and `UNTRIED_END` are unchanged, so `namesUntried` (scripts/truth/replies.ts) and golden's `namedSuffices` read the
names as before. The across clause's named branch (D59b: a scroll view told along the stroke that the swipes did not
go over) cites it the same way — `— scroll_until it again with within: <its rect>` — but keeps the manual words when the
plan judged that view without room (`noRoom`: a `within` naming it would have no room either) and when a read had
found the target (`StrokedAcross.along.targetRead`: its own scroll views were the candidates, so `within` would be
ignored).

(f) ~~**Not in scope:** the flow YAML (`src/flow/config.ts#ScrollUntilSpec`) does not take `within` yet — a follow-up;
it adds what it needs (an element spec) then.~~ Closed by D81 (the amendment below): the flow step takes `within` as an
element spec.

**Residuals.** (1) ~~A named scroll view with no room for a stroke (under `MIN_STROKE_BOX`, or cut to nothing by what is
drawn over it) falls to `strokeRoom`'s own fallbacks — a nested one, else the gesture box WHOLE — as the largest
scroller's would; not refused, as room is judged per round. Over the gesture box whole the stroke may touch down on
another scroll view than the one named (a follow-up row is filed for it).~~ Closed by D80 (the amendment below): a
nested one still takes the stroke; with none, the scroll stops `noRoom`, never the gesture box whole. (2) ~~A stale
rect's refusal lists only scroll views whose axis the tree tells~~ — closed by the code review: it lists those of
unknown axis too (a Compose lazy list, a RecyclerView), marked so, as the rect path accepts them. (3) The selector
resolves on the first read only: a list laid out later is not found. (4) A `within` whose list scrolls away under the
page (nested in the largest) is kept by its last rect: a stroke over that rect may land beside it, as a target's
remembered scroll view may. (5) Not measured on a device (the emulator was down). The live cases are drafted
(scripts/truth/live-visibility.ts, its `WITHIN` table, Android only): `within:scroll-bounded.O` with `lower`'s rect from
the capture's `scrollViews`, `within:scroll-bounded.F` with `id:"lab.scroll-bounded.S"`, direction down, 12 swipes and
30 s (F lies ~2300 px down a 495-px list), judged by `judgeWithin` — judgeScroll's stop and tap from the app's stroke
log (every stroke on `lower` bringing the target closer), a loud failure its MISMATCH. Their first run is on the owner's
list. (6) A selector's match names the scroll view of its very rect wherever it lies (found by `Clips.axesOf`, as a rect
is): a wrapper laid exactly over its list names that list, at the root or inside a vertical page alike; so does an
unrelated overlay of the list's rect — accepted, the rect is that scroll view's. Only a match in no scroll view and of
no scroll view's rect is refused.

**Golden.** Against the base JSON of `main` 4b6e3b56: Changed exactly 2, android `scroll-bounded` O and F
`scroll_until`, the reply's wording only (D76's remedy now `within`), still green; Strike 0, COUNTS 0, Re-pin 0. The
across clause's change moves no row: no capture's reply holds a named across clause. Golden calls `scroll_until`
without `within`, so the cells are not reached in it.

**Tests.** tests/interact/within.test.ts (over the real android dump, the WDA capture and idb's list of
`scroll-bounded`: a row's selector resolves to `lower`, `upper`'s row to `upper`; `role:scrollable` refused with both
listed; absent; `android:id/content` in no scroll view; an exact rect; a rect a pixel off refused naming the told
views, none on the other axis; across refused, a nested view along or of unknown axis not; unknown axis proceeds; idb
refused), tests/interact/stroke-plan.test.ts (the named rect's stroke inside `lower`, not at (540,788); a nested view
after it; kept by a read that lost it and by one that did not read; the target's views once found; `strokedBeside`
then names `upper`; `targetRead` on the across clause), tests/interact/scroll-rounds.test.ts (the round over the real
dump with the rect and the selector: every stroke inside `lower`, the stop citing `upper`'s rect; each refusal's
sentence; idb; refused when the first read shows the target; a failed first read resolves nothing; D76's `BESIDE`
re-pinned; the across clause with and without `targetRead`), tests/interact/scroll-end-turn.test.ts (the WDA "nope"
stop re-pinned), tests/mcp/tools.test.ts (the schema takes a selector and a rect, passed through; a rect missing a
side, of strings, or a number refused before a device is bound), tests/mcp/tool-descriptions.test.ts (the
troubleshooting entry, its way out now `within`), tests/mcp/tool-surface-budget.test.ts (the budget raised from 31,000 —
30,999 used — to 31,500 for the option's schema and description, 460 bytes), tests/truth/live-visibility.test.ts (the
two within cases asked on Android only, their calls; `judgeWithin`). Hand mutants, each killed: the first-read guard
(`treesRead === 1`) dropped, the refusal stop dropped, the plan not told the rect, the caller's direction for `down`,
`within` not passed by the driver nor the MCP handler, the rect's height optional, the selector arm `z.any()`; the
reply's rect fields reordered, the selector form said as a target, the count, `a`/`2` words, the other axis' directions,
the stroke's direction dropped; `targetRead` inverted, its guard and `noRoom`'s each dropped; the plan's refresh of the
named view dropped, its axes not kept by a read that lost it, named with no axes; the live cases' F by rect, on iOS
too, 6 swipes, the LOUD not turned. One equivalent: `others[0]` as `others.at(-1)` where there is one. Mutation
(scripts/mutation/scope.json, core): `src/interact/within.ts` 100 % (70 mutants), floor 98; after review round 1
100 % (86 mutants). Review round 1's tests: `checkWithin` (both repros, an exact value no regex, a rect and a spec not
parsed) and the driver refusing before any device read; one rule for a match — a same-rect wrapper at the root and
inside a vertical page both name the list, a node in no scroll view of no scroll view's rect refused; the several-views
form's `as within:`. The code review's: `Within` a selector or a rect only; the stale refusal's offers through
`Clips.scrollViewsOn` (geometry.ts — every scroll view with its told axis, `toldOn` now those told on one axis), the
unknown ones marked, the across ones counted (a RecyclerView-style fixture pins it); the old `within` of the stroke plan
(the scroll view the last stroke went over: `Memory`, `carry`, `StrokedBeside`) renamed `strokedOver` and
`StrokeRoom`'s `scrollView`, so `within` names only the option; `scrollViewOn` (stroke-plan.ts) for the scroll view a
read gives a rect, `asWithin` and `OTHER_AXIS` (scroll-text.ts) each one helper. Their hand mutants, each killed: the
unknown axis dropped from the offers, its mark dropped, `across` uncounted; `scrollViewsOn`'s axis and screen filter;
the `no scroll view` and `the one`/`a scroll view` words, the mark inverted, the other axis said as the stroke's or
broken; the largest scroller's branch dropped. Review round 1's hand mutants, each killed: the regex not compiled, the driver's check dropped, the `within`
prefix dropped, a spec parsed as a string, the same-rect rule dropped, the `as within:` dropped and given to the one
view too.

## Amendment: D81 — a flow's `scroll_until` takes `within`, as an element spec (2026-11-11)

**Context.** D78 built `within` for the MCP tool only ((f) above): a flow could not name the list a row lies in, so a
flow reaching `scroll-bounded`'s O had to `swipe` by coordinates — the device-specific step `scroll_until` exists to
replace.

**Decision.** (a) `ScrollUntilSpec` (`src/flow/config.ts#ScrollUntilSpec`) takes `within?: ElementSpec` — the step's own
`element` vocabulary, so an author sees one: `scroll_until: { element: { id: row_o }, within: { id: lower_list } }`.
No rect: a rect is one device's layout, and a flow is replayed on others.

(b) One resolver. `Within` (`src/interact/within.ts#Within`) widens from a selector string or a rect to `Target` (a
selector string or an element spec, `src/ui-tree/selectors.ts#Target` — the two forms every target is named in) or a
rect; `resolveWithin` finds the match with `findTarget`, the lookup a step's `element` is found with (every field
exact; never a spec serialized into a selector string, which cannot quote a `"`), so the rule for a match and every
refusal — absent, ambiguous, in no scroll view, across the stroke, idb's flat list — are D78's. `isRect` is a rect's
`x`, not "not a string". `checkWithin` parses a string only: a spec's values are exact, nothing to parse, so no
up-front refusal is needed or possible. The engine passes the step's `within` through untouched
(`src/flow/engine.ts`, `runScrollUntil`'s spread), as it passes `direction`, `maxSwipes` and `fully`.

(c) Load-time refusals (`src/flow/config.ts`, `withinSpec`), each said as the one issue at `….scroll_until.within`,
not the step union's bare `Unrecognized key(s) in object: 'scroll_until'` (since D86 the step is judged by its key,
`src/flow/config.ts#routeStep`; the union and its bare message are gone — the D86 amendment below): anything carrying
a rect's side (`x`, `y`, `width`, `height` — the whole rect or one side beside a spec field) — `within takes an element
spec (id, text, role, label) of the scroll view or of an element inside it, not a rect: a rect is device-specific`; a
selector string, the MCP tool's other form — `within takes an element spec ({ id: … }), as the step's element does,
not a selector string`; otherwise the element spec schema's own (`element spec needs at least one of: …`, an unknown key).

(d) The refusal's words (`src/interact/scroll-text.ts`, `withinText`): a spec is said as a step's element is
(`describeTarget`: `within id:"nope"`), and its absent and ambiguous refusals offer no rect, which a flow cannot give:
`— give an element spec of the scroll view or of an element inside it` and `— narrow it so exactly one matches`. The
MCP tool's words are unchanged. A flow's success line carries no `within`, as the tool's reply carries none.

(e) Review round 1 (MINOR-2), as the code review shaped it: a flow's exhausted reply offers no rect either. Where
the tool's reply says `scroll_until it again with within: {"x":…}` (D76's scroll views beside, at the exhausted,
maxSwipes and timeout bounds; D59b's named across clause), a flow's says `scroll_until it again naming that scroll
view by an element spec of it or of an element inside it (within: { id: … })` — a list with no id or text of its own
(RN, Compose) is named through a row — and several beside are named without their `as within: {…}`. The caller says
which it is, explicitly: `ScrollOptions.remedy` (`src/interact/scroll.ts`), `'rect'` by default — the MCP tool sets
nothing — and `'spec'` set by the engine's `runScrollUntil`. `src/interact/scroll-text.ts#scrollFailure` turns it
once into a `WithinRemedy` (`src/interact/scroll-text.ts#WITHIN_REMEDY`: how a scroll view is listed among several,
the way into one, into one of several, and the absent and ambiguous refusals' ways out), handed down to `boundText`,
`timeoutText`, `besideText`, `acrossText` and `withinText` unbranched — `withinText` takes its way out from the same
form, not from `within`'s own type. `boundText` and `timeoutText` default to the rect form, so the tool's words, the
troubleshooting reference's and golden's are byte-identical. `WithinRefusedError` lives beside `WithinRefusal`
(`src/interact/within.ts#WithinRefusedError`).

(f) Review round 1 (MINOR-1, the coordinator's decision): inside `optional:` a `within` refusal that is an authoring
error fails the flow. The refusal is a `WithinRefusedError` (`src/interact/within.ts#WithinRefusedError`) carrying
its kind (`WithinRefusal['of']`); the engine's `notSkippable` (`src/flow/engine.ts`) turns every kind but `absent` —
several matches, a match in no scroll view, across the stroke, idb's flat list (and `stale`, which a flow cannot
reach) — into the terminal `OptionalNotSkipped`, `optional step not skipped: its within names no scroll view to
swipe, which no screen cures — …`; as for a refused tap, a reach ladder then checks `detect` once and does not
escalate. An `absent` one is skipped with its own sentence: the list, like the interstitial, may not be on this
screen. Outside `optional:` every kind is the step's plain failure, as before.

**Residuals.** (1) ~~The exhausted reply's remedy quotes a rect in a flow's trace~~ — closed by (e). (2) ~~Inside
`optional:` a `within` refusal is skipped~~ — decided by (f). (3) Not measured on a device; no lab flow uses it yet.
(4) A list a flow cannot name: an element spec matches exact id, text, role and label only, so a scroll view with
none that is unique (a bare RecyclerView or Compose lazy list, `role: scrollable` beside another) is named through a
row inside it — and a list whose rows carry no unique field either cannot be named by a flow at all (the MCP tool's
rect can). No spec form takes an index or a position; filed as a residual, not a row.

**Golden.** Golden calls `scroll_until` without `within`: Changed 0, Strike 0, COUNTS 0, Re-pin 0.

**Tests.** tests/interact/within.test.ts (a spec of a row of `lower` names `lower` on Android and WDA, of `upper`'s row
`upper`; the same refusals for a spec; a spec's `text` no regex; `isRect` of a spec, a string, a rect; `checkWithin` of
a spec), tests/interact/scroll-rounds.test.ts (the round with a spec: every stroke inside `lower`; a spec's absent,
ambiguous and unscrolled sentences, no rect offered), tests/flow/config.test.ts (accepted, the spec kept; a rect whole
and one side refused with the words; `{}`, an unknown key and a selector string refused), tests/flow/engine.test.ts
(the step's `within` reaches the scroll: a spec that matches nothing stops it before any swipe, the tool's sentence;
inside `optional:` an absent `within` skipped and the flow run on, an ambiguous, unscrolled, across and idb one each
failing the flow with no swipe sent; a flow's exhausted reply over the real `scroll-bounded` dump naming `lower` by
spec, no `"x":`), tests/interact/scroll.test.ts (review round 2's MINOR-A: the driver to the exhausted bound over the
real dump with a selector and no `remedy` quotes `lower`'s rect, with `remedy: 'spec'` asks for a spec). Review round
1's in tests/interact/scroll-rounds.test.ts: `boundText` by spec — one, several, at
maxSwipes and the timeout, the across clause, no rect; a refusal a `WithinRefusedError` carrying its kind.
Hand mutants, each killed: a spec not matched (`findTarget` given a never-matching selector for it), `isRect` without
its `x`, the spec words never and always chosen, the rect clause's `''` not empty, the spec said as JSON, the string
refusal on numbers, `RECT_SIDES.some` as `every`, `height` dropped from `RECT_SIDES`, the rect refusal dropped,
`within` as `z.any()`, the engine dropping `within`. One equivalent, removed: `spec` first read `typeof within ===
'object' && !isRect(within)` — a rect is never absent nor ambiguous, so it is `typeof within !== 'string'`. Review
round 1's hand mutants, each killed: `notSkippable` taking every `within` refusal, only `untold`, and sparing each of
`across`, `unscrolled`, `ambiguous` in turn; the not-skipped words; the refusal a plain Error, its kind `absent`
always; the driver not passing `bySpec`, `failureText` not passing it, `besideText`, `acrossText`, `boundBeside`
(twice) and `timeoutText` each given false; several named `as within:` by spec; `one of them` said `it`; the across
remedy always the rect and always the spec; the beside remedy always the spec (then a `bySpec` boolean, now the
`WithinRemedy` form). The code review's and review round 2's, each killed: the driver forcing the spec form and dropping
the caller's `remedy`; the engine not setting `'spec'`; `scrollFailure`, `failureText`, `boundBeside` (twice) and
`timeoutText` each handed the rect form; `withinText` given the rect form; the spec form's `listed`, `into`,
`intoOneOf`, `absent` and `ambiguous` each changed; the across remedy always the rect; `WithinRefusedError`'s name
dropped. Mutation
(scripts/mutation/scope.json, core): `src/interact/within.ts` 100 % (105 mutants, narrowed cold run; 106 after the code review moved `WithinRefusedError` here), floor 98.

## Amendment: D80 — a named scroll view with no room stops the scroll, never the gesture box whole (2026-11-11)

**Context.** D78's residual 1: when the scroll view `within` names, and every one nested in it, leaves no room for a
stroke (`MIN_STROKE_BOX` along it, above the keyboard and clear of what is drawn over it), `planStroke` fell back to the
gesture box WHOLE, as it does for the screen's largest scroller. Over android `scroll-bounded`'s real dump with a
keyboard whose top lies at 1100 — `lower` (1046–1541) left 54 of its height — the stroke for O touched down at
(540,880), inside `upper`: the list the caller did not name, and the reply would read as `lower`'s.

**Decision.** (a) Where the fallback happens: `src/interact/stroke-plan.ts#planStroke`, its `strokeRoom` answering no
room. The plan now says so (`src/interact/stroke-plan.ts#StrokePlan.noRoom`, a
`src/interact/stroke-plan.ts#NamedNoRoom`) when no room was found, a scroll view is named
(`src/interact/stroke-plan.ts#nameScrollView`), no read has found the target yet, the round has a gesture box and the
stroke is not one the motion ledger keeps over the screen box (`src/interact/stroke-plan.ts#StrokeAsk.screenBox`).
Without `within`, and once the target is read (its own scroll views the candidates, `within` counting no more), the
fallback is as before. A nested scroll view with room still takes the stroke (D59b): only "none of them" stops. The
stroke is still planned — the plan decides, the round acts — so its memory is kept as before.

(b) Judged EVERY round, where the plan judges room, not once at the read that resolved `within`: a keyboard up after a
swipe inside the list stops the next round, after that swipe. The round (`src/interact/scroll-rounds.ts#round`) stops
`within` after the bound — no stroke would be sent at a bound either — and before the presented hold, as no stroke is
sent either way. `src/interact/scroll-rounds.ts#ScrollOutcome`'s `within` now carries `swipes: number`, said by
`src/interact/scroll-text.ts#stoppedWhen` (`stopped before any swipe`, or `stopped after N swipes, without swiping
further`). A round whose tree did not read (review round 1, MINOR-4, the coordinator's decision) does not stop on the
last read's keyboard line: it holds for a read (`src/interact/scroll-rounds.ts#confirm`), as the presented stop does;
with no confirming read left it stops on the last read that read — still never the stroke over the gesture box whole.

(c) A new refusal kind, `noRoom` (`src/interact/within.ts#WithinRefusal`): the facts the plan's and the refusal's share,
one type (`src/interact/stroke-plan.ts#NoRoomFacts`: the named rect, the stroke's direction, the room — its length along
the stroke on the gesture box, above the keyboard's top for a vertical stroke, 0 when none of it lies there), and
`keyboard` (a `src/interact/target-text.ts#KeyboardUp`: its top and the adapter's remedy) when the keyboard cuts that
part; the plan gives the top (`NamedNoRoom.keyboardTop`), the round adds the remedy. Raised through the same
`src/interact/within.ts#WithinRefusedError`, so a flow sees the kind.

(d) Its words (`src/interact/scroll-text.ts#noRoomText`), one sentence, the whole way out in the caller's form
(`src/interact/scroll-text.ts#WithinRemedy`: `showMore`, `hideKeyboard`, `again`). The MCP tool's: `within <it> names
the scroll view 0,1046 1080x495, which has no room for a swipe down: the keyboard covers it from y 1100, leaving 54 of
its height, under the 80 a swipe needs — swipe the screen so more of the scroll view shows, or hide the keyboard first
(press_key back), then scroll_until it again`. A flow's (code review 2): `… — add a swipe: step before this one so more
of the scroll view shows, or hide the keyboard first (`` `dismissKeyboard: true` `` on the fill before this step), then
run the flow again` — steps, not tool calls, the no-keyboard case too. No keyboard over it: `54 of its height lies on
the screen, under the 80 a swipe needs`, the hide clause dropped. Room of 80 or more cut by what is drawn over it: `what
is drawn over it leaves too little of the N of its height` (`… left` after the keyboard clause). A sideways stroke: `of
its width`. How to hide the keyboard follows the platform's `KeyboardRemedy` (review round 1, MAJOR-1), one source: the
round carries the applied cover's remedy (`lastCover`) into the refusal, and `hideKeyboard` words it by `dismissal`
through the shared helpers — the MCP tool's `src/interact/target-text.ts#hideKeyboardBriefly` (`press_key back`, or a
neutral tap where no key hides it), a flow's `src/interact/target-text.ts#hideKeyboardInFlow` (the fill's
`dismissKeyboard: true`, or a neutral tap in a `tap:` step before this one) — composed by
`src/interact/target-text.ts#hideClause`, which adds the adapter's own advice where no key hides it (`; this adapter
cannot hide it on its own (…)`), as `src/interact/scroll-text.ts#hideToJudgeWholeScreen` does. Each phrase exists once:
`src/interact/target-text.ts#hideKeyboardHow` is built from the two (code review 2), its words byte-identical. No
`within` is offered: the one given is right, only the screen is not.

(e) Inside `optional:` (`src/flow/engine.ts#notSkippable`, unchanged: every kind but `absent`) a `noRoom` fails the
flow, terminal, with its own reason (`src/flow/engine.ts#notSkippedWhy`) — `optional step not skipped: its within names
a scroll view on this screen with no room to swipe it, which an earlier step must make — …`. Why not skip it like
`absent`: `absent` is skipped because the list, like an interstitial, may not be on this screen; here it IS on this
screen (resolved), so a skip would run on as if it had been scrolled. And not "no screen cures" (the other kinds'
authoring error): the keyboard is a screen state an earlier step changes, as a refused tap's cover is — the same
terminal class (a ladder probes `detect` once and does not escalate).

**Residuals.** (1) The keyboard is said only when its line cuts the named view's part on the gesture box; a view cut by
a system band and the keyboard below it is said as "on the screen". (2) The check covers the strokes toward the target
(`planStroke`); the `fully: true` probe never fell back (`src/interact/stroke-plan.ts#planProbe`, `'none'`), and a read
that found the target uses its own scroll views. (3) Not measured on a device.

**Golden.** Golden calls `scroll_until` without `within`: Changed 0, Strike 0, COUNTS 0, Re-pin 0.

**Tests.** tests/interact/stroke-plan.test.ts (over the real `scroll-bounded` dump: the keyboard at 1100 gives `noRoom`
`lower`, 54, 1100; at 1126 (80 above) room, the stroke inside `lower`; none named, the same keyboard over `upper` the
gesture box as before; a keyboard above its top 0; a round that did not read the same; the target found none; off the
gesture box 0; a gesture box cut at 1100 54 and no keyboard said, a keyboard below it or at its very bottom not said;
`screenBox` and no gesture box none; a 60-wide strip stroked sideways 60, one running past the gesture box 30 of 200; a
120-high one cut by a bar `noRoom` 120), tests/interact/scroll-rounds.test.ts (by rect and by selector: no stroke, the
outcome and the exact sentence, a `WithinRefusedError` `noRoom`; no `within`: `upper` stroked; the keyboard up after one
swipe: stopped after it; the spec form's sentence whole, with and without a keyboard; the no-keyboard, cut and sideways
words, at 80 and 120; a cover of dismissal `none`: a neutral tap, then the advice; a round whose tree did not read held
for a read, and with none left stopped on the last one's facts), tests/interact/scroll.test.ts (the driver with the
keyboard oracle's IME frame: no swipe, `press_key back`), tests/flow/engine.test.ts (inside `optional:` a `noRoom` fails
the flow with its own reason, the whole flow sentence, no swipe, nothing after it run).

Hand mutants, 43, 41 killed. First round (22): the plan's gate without its no-room, gesture-box, screen-box,
target-unread conjuncts in turn; off the gesture box 1 for 0; the sideways branch dropped; the keyboard's `>=` as `>`;
`Math.max(0, …)` dropped; the keyboard said when it does not cut, and not said when it does; the round's stop dropped;
its `swipes` 0; `stoppedWhen` as `before any swipe`; `room < MIN_STROKE_BOX` as `<=`; `height` for a sideways stroke;
the hide clause dropped, and always the rect form's; the short clause's keyboard branch, and the cut clause's, dropped;
the direction said `down` always; the engine's `noRoom` reason never and always chosen. Review round 1 (12): the unread
round's hold dropped, and its `mayConfirm` dropped; the remedy a constant `back` in place of `lastCover`'s; `keyboard`
dropped from the refusal; each form's `hideKeyboard` the other's; `hideClause` dropped; the way out keyed on a constant
`back`; `hideKeyboardInFlow`'s branch inverted, its tap's step dropped; the horizontal room `rect.width` for the part on
the gesture box. Code review 2 (9): the flow's `showMore` and `again` each the tool's; the no-keyboard way's `again`
fixed; the short clause always the too-short one; the too-short and the cut clauses' keyboard branches dropped;
`hideKeyboardHow`'s `in a flow` dropped, its tap's `in a flow` as `before this one`, `A_TAP_STEP` changed. Two
equivalents, kept, each guarding a type: the round's `s.rules.within !== undefined` as `true` — the plan names a scroll
view only when `within` was given, so `noRoom` implies it; and its `s.lastCover === undefined` conjunct dropped — a
keyboard line with no cover applied is idb's band alone (src/ui-tree/draw-order.ts, `DrawOrder.ofKeyboardBand`), and
idb's `within` is refused `untold` before any plan (a comment at the conjunct says so, for a band on WDA or Android).
stroke-plan.ts, scroll-rounds.ts, scroll-text.ts, target-text.ts and engine.ts are not in scripts/mutation/scope.json,
hence the hand mutants. Mutation (core): `src/interact/within.ts` 100 % (106 mutants, narrowed cold run), floor 98 — its
change a type and comments.

## Amendment: D86 — a flow step is judged by its one key, its issues said with their path (2026-11-11)

**Context.** D81's review (NIT-3): a flow step was a `z.union` of every kind, and a wrong TYPE inside a step's object
(`within: { id: 5 }`, `within: ~`, `element: { id: 5 }`, `fully: 3`, `wait: { element: { id: 5 } }`) loaded as the
bare `Unrecognized key(s) in object: 'scroll_until'` at the step. When every member fails, zod's union reports the
first member that failed only softly: the platform override, the last member, whose fields are all optional, failed on
the unknown key alone. The member the step's key named was never the one said. A discriminated union needs a literal
field to pick by, which a one-key step lacks.

**Decision.** (a) `src/flow/config.ts#routeStep` finds the step's one key and routes it: the kind's schema
(`src/flow/config.ts#STEP_KINDS`) parses the value under that key, `android` and/or `ios` alone parse as the platform
override, and the issues are said under the step with their path — `flows.f.steps.0.scroll_until.within.id: Expected
string, received number`. `tsc` holds `STEP_KINDS` to Step: a key per kind, each schema yielding its member's value.
D81 (c)'s `within` refusals stay the one issue at `….scroll_until.within`.

(b) A step no schema judges is refused in words of its own, each naming what a step may be (`one of: launch, tap, …,
or a platform override (android and/or ios)`): no mapping — `a step is a mapping of one key, … — received null`; no key
or several — `a step has exactly one key, …; this one has none` / `… has 2: tap, timeout`; an unknown one — `unknown
step 'tapp': a step is …` (no nearest-name guess: the repo has no such helper). The coordinator's decision, beyond the
spec: beside a platform key, the one other key that is no kind is named — `unknown key 'iOS' beside a platform
override: a platform override takes android and/or ios` (a misspelt platform or a misspelt step alike). The override's
`needs android and/or ios` refinement and its noise filter went with the union: no step reaches them.

(c) Valid configs parse to the same value: each member was a strict object of one required key (the override, of two
optional ones), so a step the union accepted is exactly one member's, the very member its key now routes to, and that
member's schema is unchanged. Measured: the 291 distinct configs the suite parsed on main replayed through the new
schema — 253 valid ones deep-equal, 35 refusals word for word, 3 changed as intended (`tapp`, `frobnicate`, `{}`);
`tests/flow/config.test.ts` holds every whole flow example in the docs to the steps it was written as.

(d) A routed step that fails yields `z.NEVER`, and a refine over a step schema or a container of it would still be
handed that value: a check over a whole step belongs in `validateReferences`, after the parse, not on the schema.

## Amendment: A19 — a duration is one schema, checked at load (2026-11-11)

**Context.** Architecture review 2026-11-11, card 1. Every `timeout` — a flow's `tap:`, `scroll_until:` and `wait:`
steps, and the four assert specs (element, rect, color, ocr) the `assert` tool and an `assert:` step share — was
`z.union([z.number(), z.string()])`. `timeout: 5 sec` loaded clean, and `src/util/duration.ts#parseDuration` threw a
plain Error when the step ran: not terminal (`src/flow/engine.ts#isTerminal`), so a reach rung escalated past the typo
(possibly into a clearState login), and under `optional:` the step logged as skipped.

**Decision.** (a) `src/util/duration.ts#durationSchema` is the one schema of a duration, used by every `timeout` field;
a value parseDuration would refuse is refused there with parseDuration's own message, so averi.yaml fails at load on
D86's path (`flows.f.steps.0.wait.timeout: Invalid duration "5 sec" — use e.g. 500ms, 15s, 2m`) and an `assert` call
before any device is bound. The MCP `scroll_until` tool's `timeoutMs` stays a plain number of ms, but under the same
rule as (c): non-negative and finite (`z.number().nonnegative().finite()`), so the tool refuses at parse the budget the
flow step refuses at load. `swipe`'s `durationMs` is left as it is: a gesture's length handed to the device, not a
budget averi waits out — no ladder or `optional:` reads its failure, and what a device makes of an odd one is the
adapter's question.

(b) The schema keeps the value as written, not ms: the spec types stay `string | number` for the code and tests that
build specs directly, every consumer still converts with parseDuration — which a parsed value cannot make throw — and no
reply or trace changes (none quotes the written timeout). `src/util/regex.ts#regexSource`'s shape.

(c) A number is ms, and a negative or non-finite one is no duration: `-5` and `Infinity` are refused with the same
message (`Invalid duration -5 — …`), NaN by zod's number type. `0` stays a duration: one read, no wait.

(d) The engine's optional-tap split (`runOptionalSteps`) stays outside its `try` — the `catch` reads it — but no longer
for the malformed `timeout:` it was put there for: that cannot reach it.

## Amendment: A38b — on idb, a sideways stroke goes over the target's own row (2026-11-12)

**Context.** Gate C on main 8e60cb2b (docs/truth/live-records/a36-gate-c/) filed carousel-in-list's C under idb as
R-direction, and its replay (tests/fixtures/truth/ios-iphone17-ios27/carousel-in-list.idb.json) as a known golden
mismatch. idb lists C at `378,138 354x85` and no carousel; WDA lists the carousel at `24,138 354x85`. With no scroll
view told, and before two reads see C carried (residual 6), the strokes went over the screen box: `idb ui swipe 322
437 80 437`, 256 pt below the carousel. Nothing moved, and the reply said "content exhausted … a layout defect".

**Decision.** On a tree that tells no scroll view of the target (`Clips.drawnIn` untold: idb's flat list), the read
that finds it leaves the plan the target's y band (`interact/stroke-plan.ts#Memory.band`, kept across reads that lose
the target, as the target's scroll views are). A sideways stroke with no room among the plan's candidates (none
before the motion ledger shows a region, or, with a region, a stroke moving content the way it was first seen moving)
goes over the gesture box cut to that band (`bandOf`, clamped to the usable screen by `strokeRoom`'s meet with the
gesture box). Why it is sound: a horizontal scroller holding the target spans the target's band, so a stroke along
that band touches down on it. It changes only where the stroke lands. Every claim is still judged from the reads, and
the motion ledger's region takes over once the target moves. On carousel-in-list C's strokes are `322 181 → 80 181`
twice, then `80 181 → 201 181` back, and the replay is green.

**Scope, stated.** Sideways strokes only: a vertical stroke on idb keeps the screen box, because the target's column
is no evidence of a vertical list's extent. Not before the target is read: a target in no read has no band. A target
listed off the usable screen has no band on it either, so the screen box stays. Android and WDA tell the target's
scroll views (`isUntold` false), never set a band, and plan exactly as before. The golden moved one row,
carousel-in-list.idb C scroll_until, and nothing else. The flush probe (`planProbe`) never takes the band. Like the
region, the band is no node of the tree, so `touchedOn`, `strokedAcross` and `strokedContent` say nothing of it.

**Residual.** The band is the target's own row, not the scroller's: if a horizontal scroller's touch-down region
narrower than the screen excludes the gesture box's 0.8 / 0.2 points, the stroke still touches down beside it. That
holds on the lab's carousel (24..378 holds 322 and 80) but is unmeasured elsewhere. A target listed partly off the
screen vertically is stroked over the part on it.

## Bug note

docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md
