# 27. A floating keyboard's panel gap is the app's screen

Status: accepted 2026-10-23 (round 1023b, open-bugs row 15, the orchestrator's decision on the owner's standing: speed
and stable, truthful results; no false refusal where the reading already holds the evidence, never a false "visible").
Implemented on `bugs/r1023b-fu1`. Refines the full-width cut recorded in the Status of
docs/bugs/2026-10-05-android-floating-gboard-keyboard.md (`cb77485`), which no ADR held.

## Context

- docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md: on
  Android (API 33, Gboard floating) the IME window's touchable region is the panel `[71,1092][1008,1884]` and the band
  `[0,2088][1080,2220]`. The app's pinned submit `[55,1928][1025,2060]` lies wholly in the 204-px strip between them;
  a raw tap at its centre fired it. `scroll_until` refused it after two swipes that moved nothing: "never intersected
  the 1080x1092 screen above the soft keyboard". A false refusal (priority 2).
- **Why.** `scroll_until` judges a covered read against ONE keyboard line, the top of the highest covered rect, and
  everything below it counts as covered, full width. The tap guard and the pixel poll test the rects themselves, so they
  were right (the golden `submit tap` row: `Tapped`).

## Decision

**A match whose rect lies wholly inside the panel gap, and which stops cleanly there, is judged there.**
- The gap (`ui-tree/keyboard-cover.ts#panelGap`, the one owner of keyboard geometry): for a shown cover with panels,
  the band's width from the lowest panel's bottom down to the band's top; none when it has no height (a panel reaching
  into the band's rows), and none for a docked keyboard, WDA's band or idb's.
- `scroll_until`'s read (`interact/scroll-read.ts#inGap`) judges a match in the gap only when its rect is inside it on
  all four sides, and keeps that judgement only when it is `reachable`, all of it in the gap and nothing clipped.
  Otherwise the judgement above the cover's top edge stands, word for word.
- No new sentence. A clean gap stop is what the whole screen says too, so the witness rule finds the cover moot: no
  witness is asked, and the reply is the no-keyboard one ("fully visible after 0 swipes"). A gap judgement that is not
  clean is dropped, never worded.
- Strokes are unchanged: they stay above the cover's top edge. The gap is no stroke box.

## Why it is safe (priority 1 first)

- A rect in the gap misses every covered rect by construction: it is below every panel and above the band, computed
  from the same reading, in the same round, that every other keyboard question uses. The tap that follows reads the
  keyboard again.
- Rects under or beside a panel's rows are not inside the gap, so they stay refused.

## Risks accepted

- (R1) An IME that DRAWS outside its touchable region, in the gap, would let a target there be called visible. Measured
  false for Gboard on API 33 (the tap fired the submit; the screenshot shows the gap clean but a few pixels of the
  panel's shadow at its top). Other IMEs are unmeasured; `panelsBeyond`'s exact-band admission already refuses odd
  regions. The tap stays guarded by the same rects, so the harm would be a "visible" claim, never a key press.
- (R2) A panel dragged between rounds: the exposure the tap guard and the pixel poll already accept. The gap is read
  fresh each round, and a stop after a stroke is reported only on a settled confirming read.

## Residual

A target BESIDE the panel (x < 71 on the lab's Gboard), or partly in the gap and partly beside or under a panel's rows,
is still refused naming the keyboard, though the tap guard would tap it. It fails closed.
