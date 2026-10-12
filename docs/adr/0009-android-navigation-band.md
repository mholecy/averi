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
  for a node in no scroll view the finding is "pinned under the navigation bar". `fully:` is blocked too, because both
  stops use one centre rule, as for the status band. The order is off screen, then the system bands (top, then bottom),
  then cut, covered and keyboard (`ui-tree/standing.ts#Scene`).
- **N-b.** The pixel assert fails closed when what it reads overlaps the band past the slack (ADR 0002). There is one
  more case, for OCR ONLY. The element's bottom lies flush (±1) with the band's top, inside a clipping scroller whose
  bottom is flush with it too (`standing.ts#cutAtNavigationBar`). That fails an ocr assert closed as possibly cut. A
  colour assert keeps measuring what shows (D5). A pinned bottom bar outside a scroller still passes.
- **N-c.** The band is judged on a portrait box only.

## Residuals accepted

- The band is portrait only. In landscape the navigation bar moves to a side, and nothing reads it there.
- The band fails open, judged as if no band were read, in three cases:
  - a `dumpsys window displays` that lists a second display of a different size;
  - a display not in its natural rotation (r≠0);
  - a display whose natural rotation is landscape, such as a tablet held portrait.
- The flush cut is read by shape. A whole last row resting flush with the bar fails an ocr assert closed too.
- The band is kept until a launch or a fresh read, as the status band is.
- The in-tree keyboard dismissal picker inherits the band's point rule (`ui-tree/standing.ts#onScreen`). This is inert:
  Android never reaches the picker.

## Bug note

docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md

This note is not tracked yet. The measurements are recorded above.
