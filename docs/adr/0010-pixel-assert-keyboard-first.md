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
   region its motion showed (residual 6, refined 2026-10-21). Why not more: a screenshot per tap or plain stop would
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
along the stroke that the swipes did not go over (no swipe touched down in them) (`stroke-plan.ts#strokedBeside`, carried as
`scroll-rounds.ts#BoundBy`'s `beside`, said by `scroll-text.ts#boundText`). They are asked of the whole tree
(`Clips.toldOn`, as the across clause asks it: the usable screen, no text input, none of the keyboard's own), less
any that holds the last stroke's touch-down (the one stroked, and an outer one the finger also landed in), largest
first; the 3 largest are named, the rest counted (`and 2 more`). The order touched → across → beside is the
sentence's, not a precedence: under a node named at the touch-down the clause is said inside its `else:` (`… which
may have taken them (else: <beside>; else: content exhausted, still loading)`). It never comes with the across
clause: `strokedBeside` is undefined when the last stroke went across its scroll view. An end the tree proves
outranks it, as it outranks both. At maxSwipes and the timeout the bound's own way out follows it: `after 1 swipe
(maxSwipes: <beside>; else: raise maxSwipes or timeoutMs)`, `after 16000ms (timeout 15000ms; 1 swipe sent; 2 tree
reads took 900ms, the last 450ms: <beside>; else: raise maxSwipes or timeoutMs)` — told only to raise the bound, a
caller strokes the same list again (review round 1). The exhausted wording:

`failed after 2 swipes (the last 2, swiping down, did not change the screen: the swipes went over the scroll view
0,303 1080x605 only; the tree shows another scroll view that scrolls vertically, which the swipes did not go over:
scrollable (0,1046 1080x495) — if the element lies in it, swipe inside it (swipe, its coordinates) until the element
shows, then scroll_until it; else: content exhausted, still loading, or the swipes were not taken)`

Several are counted (`2 other scroll views that scroll vertically, …: A, B — if the element lies in one of them, …`).
Over the screen box (WDA marks no node clipping, so before the target is read it strokes the screen whole) the first
clause reads `the swipes were drawn over the screen whole, aimed at no scroll view, touching down at x,y in the scroll
view <rect>` (the smallest one told along the stroke holding the touch-down; the point alone where none does), and
`a scroll view` replaces `another`. On the WDA capture of the same cell a target not in the tree now names `lower`
(0,380 402x180), touching down at 201,175 in the scroll view 0,110 402x220, the list above it.

(b) **Rejected:** trying the candidates in turn, as D59b's nested ones are tried. It spends device time. It moves
lists the caller never named. On `scroll-bounded` it still cannot reach F within the defaults (6 swipes, 15 s).

(c) **Filed, not built:** a `within` option on `scroll_until` that names the scroll view to stroke (backlog D78).
Once it exists, this reply should cite it as the remedy, in place of the manual swipe.

**Residuals.** (1) The remedy is manual: a swipe inside the named list, then `scroll_until` again. (2) idb lists no
scroll view (`Clips.toldOn` answers none on a flat tree), so nothing is named there. The reply is the generic one, as
before. (3) A scroll view of unknown axis (a RecyclerView or a LazyColumn dumped as `android.view.View`) is not named,
as residual (c) of D59b. (4) A bound before any swipe was sent (maxSwipes 0, a timeout spent on the first read) says
nothing of it: no swipe went anywhere.

**Golden.** Against a `git archive 6b7e49b5` base: Changed exactly 2, android `scroll-bounded` O and F `scroll_until`,
the reply only; Strike 0, COUNTS 0, Re-pin 0 (the same after review round 1: no capture's maxSwipes or timeout stop
holds an untried list). The R-stroke row of a framed target that the tree does not list, in a
scroll view the replayed tree lists, now holds a touch-down beside that scroll view only when the reply quotes its
rect inside the reply's `which the swipes did not go over:` clause (StrokeOptions' `namedSuffices` in
scripts/differential/golden-spec/rows.ts, set by `edgeRows` in golden-spec/edges.ts). It is red at 6b7e49b5's src
(`--side` at the extract: 2 new) and green here. Holding the strokes inside `lower` outright stays out: T6 tried that,
and averi cannot know which list holds a row it never saw.

**Tests.** tests/interact/stroke-plan.test.ts (`strokedBeside`: the sibling named; the touch-down's list left out; one
across the axis left out; undefined once found and when across; largest first; text inputs and the keyboard left
out; none when no other list), tests/interact/scroll-rounds.test.ts (`boundText` with one and several, the screen box,
the clause order; the round over the real `scroll-bounded` dump), tests/interact/scroll-end-turn.test.ts (the WDA
"nope" stop re-pinned: it names `lower`), tests/differential/golden-rows.test.ts (`namedSuffices`). Hand mutants,
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
`movesWith` stop has found a match).

## Bug note

docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md
