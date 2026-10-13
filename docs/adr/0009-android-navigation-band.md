# 9. The Android navigation band (D7: N-a, N-b, N-c)

Status: accepted, 2026-10-12 (owner).

## Context

The Android adapter reads a bottom system band beside the status band. It is the visible navigation bar's frame, ending
at the screen's bottom (`adapters/android.ts#parseNavigationBand`). Two measurements on a 2220-px Pixel_3a led to this
decision:

- On mp-native's Account Detail, drawn edge to edge, `row_4` lies wholly in 2154–2220, under the navigation bar. A tap
  went to (540,2186). On three-button navigation that is Back, Home or Recents.
- Settings' title `198,2105 428x49` lies flush with the bar's top, in a list flush with it. Ocr read it as the cut
  "Colnd & vibration". uiautomator left no evidence of the cut. Its colour, sampled on the clean strip, was true.

## Decision

- **N-a.** The tap refuses, and neither stop stops on, a centre inside the band, whatever the navigation mode (gesture or three
  buttons). The tree cannot tell the modes apart without one more device read. The remedy is "scroll_until it first";
  for a node in no scroll view the finding is "pinned under the navigation bar". The order is off screen, then the
  system bands (top, then bottom), then cut, covered and keyboard (`ui-tree/standing.ts#Scene`).
- **N-a, `fully` (amended 2026-10-12, owner, round 10 code review P1).** A `fully: true` stop judges both system bands
  (the status band too) as a REGION, the way the pixel assert does: it stops only when the node overlaps neither band
  past the slack (ADR 0002, the same rule and constant, `standing.ts#systemBandOver`). Otherwise it strokes on, and a
  node pinned there ends stuck naming the bar. The plain stop and the tap stay centre-based. So, for a node a scroll can
  lift out of the bands, a `fully` stop guarantees that a pixel assert on it is not refused for a band. Judged by the centre alone, the pixel remedy
  "scroll_until … `fully: true` first" stopped at once on mp-native accountDetail's `row_30` `66,2088 948x99` (its centre
  (540,2138) clear, its bottom 33 px into the band at 2154), and the agent looped; eight small nodes at the status band
  did the same.
- **N-a, `fully`, content no scroll lifts (amended 2026-10-13, owner, round 10 verification).** The region rule does
  NOT apply to a full-bleed header (laid from the screen's top edge at full width, `standing.ts#fullBleedHeader`) or a
  screen-sized node (`standing.ts#screenSized`). The `fully` stop stops on it as before, so a rect assert after it
  works: an iOS hero `0,0 402x300`, an Android 15+ edge-to-edge app bar `0,0 1080x210`. A pixel assert on it still fails
  closed, with its own advice: assert something in it clear of the bar (its title, say). Without the exemption such a
  node never stopped; reached from a scrolled list, it went to `maxSwipes` with no advice.
- **N-a, `fully`, refined (amended 2026-10-13, owner, round 10 verification 2).** Three decisions:
  - (a) For a `fully` stop the band's region refused at the navigation band, the frames the far edge is judged in are
    cut above the band too (`scroll-rounds.ts#round`): resting across the band's top with the content above it, the
    node is at the far edge, and the first stroke turns and lifts it (`row_30` with `direction: up`: 1 swipe, where it
    turned five times to `maxSwipes`). The plain stop's frames are exactly as before. Whether a read saw the node short
    of the far edge is judged in the uncut frames, so a node a stroke then pushes wholly into the band is turned back,
    not pushed on and lost.
  - (b) The exemption applies only to a node in NO scroll view (`Clips.inScroller` not true, as the pixel assert's
    `pinned`). idb's flat list cannot tell (`inScroller` undefined), and counts as in no scroll view: the owner's
    decision, ratified 2026-10-13 (round 10 verification 3). A list row whose top lies on the screen's top edge
    (`0,0 1080x150` in a list), or a screen-sized page that fits between the bands (`0,160 1080x2000` in a list), is a
    scroll view's content, which a scroll lifts: `fully` strokes on. A screen-sized node in a scroll view stays exempt
    only when it is taller than the room between the bands, which no scroll can clear it into (WDA's 2FA screen
    `0,0 402x826` in its scroll view, against 812 pt between the 62-pt status band and the bottom). This tall-content
    clause is the owner's decision, ratified 2026-10-13 (round 10 verification 3).
  - (c) The exemption is symmetric at the bottom edge: a full-width surface laid to the screen's bottom in no scroll
    view (`standing.ts#fullBleedFooter`; a bottom sheet `0,1100 1080x1120`) stops at once — no strokes over a modal
    sheet. A pixel assert on it fails closed with its own advice: assert something in it clear of the bar (its content
    above the bar, say). The three shapes are `standing.ts#pinnedSurface`.
- **N-b.** The pixel assert fails closed when what it reads overlaps the band past the slack (ADR 0002). There is one
  more case, for OCR ONLY. The element's bottom lies flush (±1) with the band's top, inside a clipping scroller whose
  bottom is flush with it too (`standing.ts#cutAtNavigationBar`). That fails an ocr assert closed as possibly cut. A
  colour assert keeps measuring what shows (D5). A pinned bottom bar outside a scroller still passes.
- **N-c.** The band is judged on a portrait box only.

## Residuals accepted

- A `fully` stop on a full-bleed header, a full-bleed footer or a screen-sized node in no scroll view, or on
  screen-sized scroll content taller than the room between the bars, does not promise a pixel assert: what lies under a
  bar fails it closed, with the child advice.
- A scroll view's content taller than the room between the bands but not screen-sized (a tall narrow node) never stops
  `fully`: it ends stuck naming the bar.
- The band is portrait only. In landscape the navigation bar moves to a side, and nothing reads it there.
- The band fails open, judged as if no band were read, in three cases:
  - a `dumpsys window displays` that lists a second display of a different size;
  - a display not in its natural rotation (r≠0);
  - a display whose natural rotation is landscape, such as a tablet held portrait.
- The flush cut is read by shape. A whole last row resting flush with the bar fails an ocr assert closed too.
- The band is kept until a launch or a fresh read, as the status band is.
- The in-tree keyboard dismissal picker inherits the band's point rule: it asks the tap's standing
  (`docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md`). This is inert: Android never reaches the picker.

## Bug note

docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md

This note is not tracked yet. The measurements are recorded above.
