# 26. A text in a control's touch margin is judged by the eyes

Status: accepted 2026-10-23 (round 1023, open-bugs row 16, the orchestrator's decision on the owner's standing: speed
and stable, truthful results; no false refusal where a cheap, reliable signal exists, never a false "fully visible").
Implemented on `bugs/r1023-phone`. Amends ADR 0024 (a second pair kind for the eyes' order question, and a trigger on a
cover whose order the tree tells). Cites ADR 0013 (one capture), ADR 0014 (the density refused, the allowance
precedent), ADR 0002 (the pixel slack) and ADR 0010 (the keyboard judged first).

## Context

- docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md:
  on Android, after `back` hid the IME on the lab's form-keyboard, `scroll_until id:"lab.form-keyboard.phone" fully:
  true` turned twice and timed out after 17.3 s: "stayed under text "Variable symbol" (55,1239 258x56), drawn over it —
  99% of it shows". A false refusal (priority 2), for a field the caller can see whole.
- **Compose dumps a control's touch target, not what it draws.** Its semantics bounds are `touchBoundsInRoot`, grown
  symmetrically to 48 dp. In `form-keyboard.after-back.xml` phone is `[55,1280][1025,1412]` — 132 px, 48 dp at 2.75 —
  while the lab model's drawn frame is `55,1296 970x99`: 16 px of margin above, 17 below.
- **The next field's title lies in that margin, not over the field.** `vs.title` is `55,1406 258x66` in the truth
  (`[55,1406][313,1462]` dumped, cut at vs's own touch target): 11 px below phone's drawn bottom (1395), 6 px above its
  dumped bottom (1412). Compose's uncovered-region pass cuts an earlier node only at a later node spanning its full
  width; the title is 258 px wide, so phone keeps its 132 px.
- **Why the tree reads it as a cover.** The draw order lists the title after phone and no row excuses it; the
  `onTarget` row needs the text's centre on the target, and the title's (1434) lies below 1412. The `fully` stop counts
  any cover, so the stop is `covered`, remedy `scroll`; the title moves with phone, so no stroke helps.
- **It is no cover of anything real.** It overlaps the touch target, not what the field draws; nor does it take
  touches (not clickable), so a press in that strip reaches the field through its touch-target expansion.
- **The pixel assert shares it.** Judged on the same tree: `fully` covered by `vs.title`; the ocr assert (whole rect)
  covered by `vs.title`; the colour assert reachable (its 12 % inset clears the band). A fix in `fully` alone would say
  "fully visible" while the next ocr assert says "covered".
- **It is systemic.** Over all 44 Android trees the tests carry, 78 (control, text) pairs have this shape, in every
  stacked Compose form cell (form-basic, form-prefilled, form-errors — an error text 11 px over its field —,
  form-shared-id, form-keyboard and its floating variant, IME up and after back); each one, against the truth frames,
  lies in the margin, 6–11 px clear of what its field draws. So `fully: true` and the ocr assert were refused on every
  field of a Compose form whose next title sits closer than the touch margin.

## The tree alone cannot tell (rejected rules)

- **An allowance.** The overlaps are 6 and 11 px, past the pixel slack (2, ADR 0002) and the label overhang (5 px on a
  1080-px screen, ADR 0014). An allowance of 11 px (4 dp) would also excuse a text laid over the bottom indicator line
  of a Material 56-dp TextField, whose dump is NOT padded (its bounds are its layout): the overlap would lie over what it
  draws, and the reply would be a false "fully visible" (priority 1).
- **"The dump is exactly 48 dp tall, so it is padded".** That needs the density, which ADR 0014 refused the draw order
  (a device read; the draw order is a function of the tree alone). Even with it the depth of the margin stays unknown:
  (48 dp − drawn) / 2.
- **An accepted residual.** Rejected: a systemic false refusal of two verbs on ordinary Compose forms, and one
  screenshot tells it.

## Decision

**The tree only suspects; the eyes decide** — ADR 0024's mechanism, its answer fed into the pure draw order.

1. **The suspicion, the tree's alone** (`ui-tree/cover.ts#marginText`). A cover of a target is a MARGIN TEXT when all
   hold: (1) the tree's source pads touch targets (`UiNode.paddedTouchTargets`, Compose's dialect); (2) the target is a
   control and the cover a `text` leaf that is no control; (3) the cover crosses exactly one of the target's horizontal
   edges, its far end outside the target, and does not hold the target's centre — so the tap never changes; (4) it lies
   within the target's columns, narrower than it, leaving at least 4 tree units (`MARGIN_BESIDE_MIN`, the judge's
   least readable strip at Android's one px per unit) of the target's own rows beside it — a cover as wide is the cut
   and overlay family (later-edges.ts), not this one; (5) its order is `drawn` and it is the surface of no presented
   screen. Over the 44 Android trees it holds of exactly the 78 pairs above (tests/ui-tree/eyes-margin.test.ts freezes
   the list).
2. **The question** (`ui-tree/eyes.ts`): `OrderQuestion` becomes `{ asks: 'order', pairs: OrderPair[] } | { asks:
   'clear', pairs: ClearPair[] }`. A standing `covered` with remedy `scroll` whose EVERY cover is a margin text asks one
   `ClearPair` per cover: `overlap`, the two's intersection in the frame, and `beside`, the target's own rows of the
   overlap left and right of the text. One cover the eyes cannot be asked about keeps the standing, so nothing is asked.
3. **The answer** (`verify/eyes.ts#judgeClear`, `ui-tree/seen-order.ts#PairSeen`'s new `clear`):
   - `clear` — the beside strips are one colour (`oneColour`), and every pixel of the overlap lies within EYES_SAME_DE
     of it, at most OWN_PIXELS_MAX points' worth of strays (the strict count `apartOfFrame` uses, not LINE_SHARE, which
     would pass a 1-px line of ink across a 6-px band): the text paints nothing a screenshot, an OCR crop or a colour
     sample of the target reads;
   - `under` — the beside strips are one colour and the overlap is not: the text draws ink or a background over it;
   - `untold` — no readable beside strip, not one colour, the frame off-scale or undecoded, no screenshot.
   Read from the other side a `clear` says nothing (`seenOrderOf` flips it to no answer): it would otherwise excuse the
   target as a cover of the text.
4. **One row** (`draw-order.ts`'s NOT_DRAWN `seenClear`, the `target` column): a node the order seen calls `clear` of
   the target draws nothing over it. So `exposure`, `paintsOver` and their readers — the `fully` stop, the plain stop,
   the pixel assert — agree. Beside the reading-order `seenUnder` filter, not instead of it. What it excused is reported
   (`Exposure.seenClear`), and the standing carries what the eyes saw of margin texts (`StandingFacts.marginSeen`).
5. **Who asks**, by ADR 0024's cycle: `scroll_until`'s round (`ask order`) and the pixel assert (on the frame it
   captures anyway: zero extra captures; a `clear` answer, like `over`, is never kept across poll rounds — each round's
   unlock rests on its own frame). The tap never asks (rule 3: no tap standing is covered by a margin text). A caller
   with no eyes (`ui_snapshot`, the dismissal picker, tree-only tests) behaves as before.
6. **Once per text per call** in `scroll_until` (`scroll-rounds.ts#State.marginSeen`): unlike ADR 0024's unordered
   stop, a refused clear question is followed by strokes, and the text moves with the target. What was seen is kept by
   the text's identifier, label and size within a pixel and told to every later read: `under`/`untold` for the call
   (the cover stands, no screenshot again), `clear` while the target and the text lie where they were seen (moved, the
   pixels moved: asked again).
7. **Replies.** After `clear`: `fully visible after 0 swipes — text "Variable symbol" (55,1406 258x56), drawn after it,
   overlaps its bottom 6 px with nothing a screenshot shows (Android dumps a control's touch target, past what it
   draws)` — the prefix unchanged, so scripts/truth/replies.ts still reads it as "fully visible". After `under`, the
   covered failure as before plus `— a screenshot shows it drawn over its bottom 6 px`; after `untold`, plus `— a
   screenshot could not tell whether it draws over it (<why>)`. The ocr assert reads the field after a `clear` of its
   own frame; the colour assert is unchanged (its inset clears the band).

This is the first time the eyes may excuse a cover the tree's order TELLS — and only on pixel identity of the overlap
with the target's own rows beside it.

## Measured

- The lab's real captures, judged by `judgeClear` (tests/verify/eyes-clear.test.ts): form-keyboard (IME up) street ←
  city.title, overlap `55,860 175x6`: clear (#FFFFFF, as street's rows beside it); k7's stop, the same pair at
  `55,693 175x6`: clear; form-errors name ← its error text, `55,491 440x11`: clear. The same png with a 1-px dark line
  across the band: under; the band painted #F2F2F7 (a text background): under; the beside rows striped: untold; a frame
  whose scale the tree refuses: untold.
- The round over the after-back tree (tests/interact/scroll-eyes.test.ts): a white frame — fully visible after 0
  swipes, one screenshot, no stroke; the band inked — the covered failure with what the screenshot showed, still one
  screenshot over every read; no eyes — the failure word for word as before, none taken.
- The ocr assert on phone after back (tests/verify/assert-margin-text.test.ts): reads the field on the settled pair it
  takes anyway (two captures); inked, it fails closed naming the title; a clear answer is not kept for a later round.
- Golden (1569 checks): 0 changed against the base — no row asks `fully: true` or an ocr assert of a field clear of the
  IME in these cells.
- Live: see docs/truth/live-android-2026-10-18-visibility.md, the 2026-10-23 section (case k7f).

## Residuals accepted

1. **A frame caught mid-animation** (ADR 0013's one-capture residual): `scroll_until`'s capture is unsettled by design;
   a blend reads `under` or `untold` — the cover kept. The pixel assert judges only a frame settled over the whole
   screen, as in ADR 0024.
2. **A text box over drawn content of the same plain colour, with no ink in the band**: read `clear`. Nothing visible is
   hidden, so nothing a measurement reads differs.
3. **Ink fainter than ΔE00 1** from the target's colour: unmeasurable, read `clear`.
4. **A `clear` kept across reads in one call** while the target and the text lie where they were seen: a text that gains
   ink with no change to its node in between is not looked at again (its label changing is: the key misses).
5. **When the eyes answer `under`** the text still moves with the target and the round strokes until its timeout. A
   "the cover moved with it over a stroke" fast-fail from the motion ledger would save about 12 s; it needs its own
   note.
6. Measured on one AVD (averi_lab, API 33, Material 3 lab forms). Another app's margin texts are found by the same rule;
   whether its pixels read clear is the eyes' to say.

## Rejected

- A tree allowance of a few dp, or the 48-dp height read with the density: see above.
- Excusing the cover in `fully` alone: the ocr assert would still refuse what `fully` called fully visible.
- A flag on `Cover` or a new verb option: the suspicion is one predicate, the answer one `PairSeen` case.
