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
  pixel, the `fully` stop read it `clipped` where its flush probe is the rule (ADR 0013). `flushEdges` and `endsAt`
  read "past" as more than a pixel already.
- **The carry model stays WDA's** (`ui-tree/geometry.ts#Drawn.listedWhereItLies`, true only where
  `draw-order.ts#listsUnclippedFrames`; the standing hands it on as `StandingFacts.listedWhereItLies`, which
  `interact/scroll-rounds.ts#stillNeeds` asks): the drawn frame no longer tells the dialect, and on Android a row's
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

- When the reading cannot see the keyboard, the old behaviour returns silently. Examples: a floating or split IME that
  supplies no insets frame, and the transient read right after the focus tap.
- The API 34+ `type=ime` line comes from AOSP and has not been captured on a device.
- A multi-display device reads unknown.
- A stale `shown` costs covered rounds until the window state catches up. Under a short timeout it fails closed with the
  covered wording, never a false pass.
- **idb lists no scroll view** (a flat list): an element below a short scroll view (the SWIFT form's text field at
  `42,817` under idb) is judged on the screen alone, so the drawn frame cannot refuse it there: it is refused only
  where something the flat list pins over it says so (a bar's reach to the screen's bottom, `draw-order.ts#bottomPinned`),
  and otherwise tapped, stopped on and measured on what shows.
- **Strokes over the screen's middle, not the target's scroll view** (iOS) — **closed 2026-10-16**: the scrollers now
  feed the stroke's containers on a WDA tree (`interact/stroke-plan.ts#targetScrollers`: the clipping chain, else
  `Clips.drawnIn`'s `scrollers`), and what WDA draws over such a scroll view cuts the stroke as on Android
  (`draw-order.ts#DrawOrder.drawnOver` finds its container among the nodes that scroll). Lab notes LE4 and LV3
  (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md). Still so under idb, which
  lists no scroll view.
- **A stroke across a scroll view's axis** (LE4's residual) — **refined 2026-10-18** (round 22, `arch/r22-axis`): the
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
  axis on Android.
- **An ocr assert on a text line cut at its scroll view's edge** reads only the drawn part, so its glyphs may be cut (a
  21-pt line with 15 pt drawn is read on clipped glyphs). Android's glyph readers fail closed on a node that may be cut
  at the navigation bar (`ui-tree/standing.ts#cutAtNavigationBar`); there is no counterpart at a scroll view's edge yet.
- **A scroll view that draws past its frame** (SwiftUI's `.scrollClipDisabled()`, a UIKit scroll view with
  `clipsToBounds = NO`) is judged as one that clips: content it draws outside its frame is refused, never measured —
  the safe direction.

## Bug note

docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md
