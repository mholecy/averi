# 10. The pixel assert judges the soft keyboard first, with K1's reading outside standing

Status: accepted, 2026-10-12 (owner).

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
  is unchanged — and idb lists no scroll view: both are unchanged by construction. A normalized WDA tree saved before
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
  feed the stroke's containers on a WDA tree (`interact/scroll-rounds.ts#targetScrollers`: the clipping chain, else
  `Clips.drawnIn`'s `scrollers`), and what WDA draws over such a scroll view cuts the stroke as on Android
  (`draw-order.ts#DrawOrder.drawnOver` finds its container among the nodes that scroll). Lab notes LE4 and LV3
  (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md). Still so under idb, which
  lists no scroll view.
- **An ocr assert on a text line cut at its scroll view's edge** reads only the drawn part, so its glyphs may be cut (a
  21-pt line with 15 pt drawn is read on clipped glyphs). Android's glyph readers fail closed on a node that may be cut
  at the navigation bar (`ui-tree/standing.ts#cutAtNavigationBar`); there is no counterpart at a scroll view's edge yet.
- **A scroll view that draws past its frame** (SwiftUI's `.scrollClipDisabled()`, a UIKit scroll view with
  `clipsToBounds = NO`) is judged as one that clips: content it draws outside its frame is refused, never measured —
  the safe direction.

## Bug note

docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md
