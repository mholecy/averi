# 26. A text in a control's touch margin is judged by the eyes

Status: accepted 2026-10-23 (round 1023, open-bugs row 16, the orchestrator's decision on the owner's standing: speed
and stable, truthful results; no false refusal where a cheap, reliable signal exists, never a false "fully visible").
Implemented on `bugs/r1023-phone`. Amends ADR 0024 (a second pair kind for the eyes' order question, and a trigger on a
cover whose order the tree tells). Cites ADR 0013 (one capture), ADR 0014 (the density refused, the allowance
precedent), ADR 0002 (the pixel slack) and ADR 0010 (the keyboard judged first).
Amended 2026-10-24 (round 1023b, open-bugs row 19, on `bugs/r1023b-row19`): rule 6's `under` kept while the two keep
their relation, and rule 8, the cover carried with it ends the call — residual 5 closed.

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
2. **The question** (`ui-tree/eyes.ts`): the eyes' pair question becomes `PairQuestion = OrderQuestion |
   ClearQuestion` (`asks: 'order'`, `OrderPair[]`; `asks: 'clear'`, `ClearPair[]`), picked by `pairQuestion`. A standing `covered` with remedy `scroll` whose EVERY cover is a margin text asks one
   `ClearPair` per cover: `overlap`, the two's intersection in the frame, and `beside`, the target's own rows of the
   overlap left and right of the text. One cover the eyes cannot be asked about keeps the standing, so nothing is asked.
3. **The answer** (`verify/eyes.ts#judgeClear`, `ui-tree/seen-order.ts#PairSeen`'s new `clear`):
   - `clear` — the beside strips are one colour, each held to it as strictly as the overlap (not `oneColour`'s
     LINE_SHARE: a line the target draws across its width, seen beside the text and missing from the overlap, is what
     an opaque text background hides), and every pixel of the overlap lies within EYES_SAME_DE
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
6. **Once per text where it lies** in `scroll_until` (`interact/margin-memo.ts`, held as `scroll-rounds.ts#State.marginKept`): unlike ADR 0024's
   unordered stop, a refused clear question is followed by strokes, and the text moves with the target. What was seen
   is kept by the text's identifier, label and size within a pixel (one entry per text, the latest answer) and told to
   every later read: `under` while the two keep their relation — unmoved, or carried together by the same offset
   (`interact/motion-ledger.ts#movedTogether`: the target's nearest scroll view where it was, the target moved more
   than a pixel, the text by the same offset within a pixel, both at the same size); a changed relation (a text pinned
   over the content, which a stroke moves the target past; the scroll view itself moved, a sheet dragged or an outer
   scroller carrying it, which carries a pinned text with it) is asked again (amended 2026-10-24: kept "for the call" before, on the unchecked belief that every margin text
   is content of the target's scroll view — a pinned one seen over one band would have refused every later band
   unasked); `clear` and `untold`, answers of the frame they were read on (a displaced capture may read `clear`, a
   blended one `untold`), while the target and the text lie where they were seen — moved, asked again. So one
   screenshot per text while the two stay put, one more each time a stroke moves them; a text seen drawn over the
   target and carried with it costs one for the call.
7. **Replies.** After `clear`: `fully visible after 0 swipes — text "Variable symbol" (55,1406 258x56), drawn after it,
   overlaps its bottom 6 px with nothing a screenshot shows (Android dumps a control's touch target, past what it
   draws)` — the prefix unchanged, so scripts/truth/replies.ts still reads it as "fully visible". After `under`, the
   covered failure as before plus `— a screenshot shows it drawn over its bottom 6 px`; after `untold`, plus `— a
   screenshot could not tell whether it draws over it (<why>)`. The ocr assert reads the field after a `clear` of its
   own frame; the colour assert is unchanged (its inset clears the band).

8. **The cover carried with it ends the call** (2026-10-24, `interact/scroll-rounds.ts#coverMovesWith`, `BoundBy`'s
   `movesWith`): on a `fully: true` read whose judged match is `covered` by a margin text whose kept answer is `under`,
   and the two moved since that screenshot by the same offset in a scroll view that stayed where it was (rule 6's
   `movedTogether`; a field in no scroll view the tree marks never fires), no stroke can bring the
   field out from under a node that moves with it — the bound, on that read: no confirming read, no further stroke, no
   screenshot (one dump is one frame; the pair's relation in it is a fact, mid-fling or not). Unmoved (the content at
   its end) keeps the strokes' own failures; `untold` never ends it (the next frame may read `clear`); sizes changed (a
   field cut at a container edge or by the IME line) do not fire. Reply, the covered shortfall's words unchanged:
   `scroll_until id:"lab.form-keyboard.phone" fully: true failed after 1 swipe (the text drawn over it moved with it,
   both by 0,-300 since a screenshot saw it there: it scrolls with the element, so no swipe brings the element out
   from under it) — element reached the viewport but stayed under text "Variable symbol" (55,1106 258x56), drawn over
   it — 99% of it shows — a screenshot shows it drawn over its bottom 6 px (last rect {…})`; no remedy (an app layout
   fact; the tap is unaffected, rule 3). Not a new outcome kind and not `stuck` (it moved): a bound, as `exhausted`,
   the motion-proven early end beside it. At k7's live pace (about 1.9 s a read, 3.4 s a stroke round) about 5–6 s in
   place of the 17.3 s timeout.

This is the first time the eyes may excuse a cover the tree's order TELLS — and only on pixel identity of the overlap
with the target's own rows beside it.

## Measured

- The lab's real captures, judged by `judgeClear` (tests/verify/eyes-clear.test.ts): form-keyboard (IME up) street ←
  city.title, overlap `55,860 175x6`: clear (#FFFFFF, as street's rows beside it); k7's stop, the same pair at
  `55,693 175x6`: clear; form-errors name ← its error text, `55,491 440x11`: clear. The same png with a 1-px dark line
  across the band: under; the band painted #F2F2F7 (a text background): under; the beside rows striped, or one 1-px line drawn across the
  beside rows only (what a text background would hide): untold; a frame
  whose scale the tree refuses: untold.
- The round over the after-back tree (tests/interact/scroll-eyes.test.ts): a white frame — fully visible after 0
  swipes, one screenshot, no stroke; the band inked — the covered failure with what the screenshot showed, still one
  screenshot over every read; no eyes — the failure word for word as before, none taken.
- The ocr assert on phone after back (tests/verify/assert-margin-text.test.ts): reads the field on the settled pair it
  takes anyway (two captures); inked, it fails closed naming the title; a clear answer is not kept for a later round.
- Golden (1569 checks): 0 changed against the base — no row asks `fully: true` or an ocr assert of a field clear of the
  IME in these cells.
- Live: see docs/truth/live-android-2026-10-18-visibility.md, the 2026-10-23 section (case k7f).
- Rules 6 (amended) and 8, unit only (tests/interact/scroll-eyes.test.ts, "what was seen of a margin text, kept";
  tests/interact/motion-ledger.test.ts, "a pair carried together"): seen `under`, then carried 300 px up by a stroke —
  fails after 1 swipe, one screenshot; the text pinned 3 px off the carry — asked again, `clear`, fully visible after 1
  swipe; pinned where it was — fully visible, nothing asked again; inked and unmoved — the strokes' "content is
  exhausted" as before; `untold` then carried — asked again, the strokes go on; the whole screen moved with the two
  (its scroll view too) — asked again, the next stroke leaves the pinned text behind, fully visible after 2 swipes;
  the real eyes on the inked capture, then carried — fails after 1 swipe, one screenshot. Every guard mutation-checked
  (the scroll view kept, the more-than-a-pixel move, the peer's offset, the sizes, `untold` — one guard,
  `interact/margin-memo.ts#carriedSince`, for the kept answer and the bound —, the relation kept, the bound). Golden (1584 checks)
  0 changed: no capture is answered `under`. Live k7 and k7f at `074b48c3`, before `11a5f92a` (the scroll view kept in the pair), which leaves the clear path as it is: the clear path, as before (the 2026-10-24
  section of the live summary).

## Residuals accepted

1. **A frame caught mid-animation** (ADR 0013's one-capture residual): `scroll_until`'s capture is unsettled by design;
   a blend reads `under` or `untold` — the cover kept; a capture displaced from the read's frame may read `clear`,
   which is then kept only while the two lie where that read had them (rule 6). The pixel assert judges only a frame settled over the whole
   screen, as in ADR 0024.
2. **A text box over drawn content of the same plain colour, with no ink in the band**: read `clear`. Nothing visible is
   hidden, so nothing a measurement reads differs.
3. **Ink fainter than ΔE00 1** from the target's colour: unmeasurable, read `clear`.
4. **A `clear` kept across reads in one call** while the target and the text lie where they were seen: a text that gains
   ink with no change to its node in between is not looked at again (its label changing is: the key misses).
5. ~~**When the eyes answer `under`** the text still moves with the target and the round strokes until its timeout.~~
   **Closed** 2026-10-24 by rule 8 (bugs/r1023b-row19),
   docs/bugs/2026-10-23-lab-android-scroll-until-fully-strokes-to-its-timeout-under-a-margin-text-seen-drawn-over-it.md (open-bugs row 19). What it leaves:
   - **One stroke is spent** to see the carry. A tree rule "the text and the field share a scroll view", failing at 0
     swipes, was refused: the dumps' scroll views are not reliable enough to bet a failure on (idb lists none;
     Compose's scroll marking, nested scrollers, a text in an outer scroller over an inner one), and it would be a
     second "moves with" model beside the motion ledger.
   - **A field cut at an edge or by the IME line** (its size changed) does not fire, and is asked again: one more
     screenshot on every read while the cut changes, and on the first whole read after it too (its size differs from
     the cut sighting); the whole read after that fires. A text the swipes move against the field a few pixels a read,
     still over it, is asked on every read too — the cost `clear` and `untold` already pay, at most one screenshot a read.
   - **Measured from the sighting, not over the last stroke**: a read that poses no clear question (the pair not a
     margin pair there) leaves the sighting in place, so a pair back in the sighted relation and offset after such
     reads fires on the carry since the sighting, whatever moved in between — contrived (a pinned text would have to
     move by the content's offset), and accepted.
   - **A scroll view that moves with the content never fires**: a field in a carousel carried by the list around it,
     or in a scroll view the tree does not mark, strokes to the bound as before — a slow honest failure, never a false
     one.
   - **Unit only:** the lab's titles draw nothing in the margin, so no lab cell answers `under` live; a cell whose next
     title draws a background over the field's touch margin would measure it.
6. Measured on one AVD (averi_lab, API 33, Material 3 lab forms). Another app's margin texts are found by the same rule;
   whether its pixels read clear is the eyes' to say.

## Rejected

- A tree allowance of a few dp, or the 48-dp height read with the density: see above.
- Excusing the cover in `fully` alone: the ocr assert would still refuse what `fully` called fully visible.
- A flag on `Cover` or a new verb option: the suspicion is one predicate, the answer one `PairSeen` case.
