# BUG: on Android `scroll_until … fully: true` on a field whose touch-margin text a screenshot saw drawn over it strokes until its timeout — the text moves with the field, so no stroke can clear it

> **Status (2026-10-24):** fixed at `074b48c3`, review fix `11a5f92a` (a carry only in a scroll view that stayed put) (bugs/r1023b-row19, ADR 0026 amended: rule 6, rule 8), measured by the unit
> tests (tests/interact/scroll-eyes.test.ts, "what was seen of a margin text, kept"; tests/interact/motion-ledger.test.ts,
> "a pair carried together"): seen `under`, then carried with the field by a stroke, the call fails after 1 swipe —
> "failed after 1 swipe (the text drawn over it moved with it, both by 0,-300 since a screenshot saw it there: it
> scrolls with the element, so no swipe brings the element out from under it) — element reached the viewport but stayed
> under text …"; a text pinned off the carry is asked again. Golden 0 changed; live k7 and k7f as before (the clear
> path, docs/truth/live-records/android-forms-r1023b-row19-1.json); no lab cell answers `under`, so the fast fail itself
> is unit only (ADR 0026 residual 5's rest).
>
> **Status (2026-10-23):** open, Priority 2 (a slow honest failure: the reply is right, the wall time is not). Found
> while fixing docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
> (bugs/r1023-phone); recorded as docs/adr/0026-a-text-in-a-controls-touch-margin-is-judged-by-the-eyes.md, residual 5.

## Observed (measured)

- Before ADR 0026, the same shape with no eyes (2026-10-19, averi_lab, emulator-5554, API 33): after `press_key back`
  on form-keyboard, `scroll_until id:"lab.form-keyboard.phone" fully: true` sent five swipes, turned round twice, and
  failed after 17290 ms (timeout 15000 ms) — `element reached the viewport but stayed under text "Variable symbol"
  (55,1239 258x56), drawn over it` (docs/truth/live-records/android-k7-fully-eyes-direct.jsonl).
- Since ADR 0026 the eyes excuse that title when its overlap is clear. When they answer `under` (ink or a background of
  the text's own in the overlap), the cover stands for the call (`scroll-rounds.ts#State.marginKept`: no screenshot
  again) and the round strokes on: tests/interact/scroll-eyes.test.ts, "ink in the band: the cover stands …" — one
  screenshot, swipes sent, the covered failure with "— a screenshot shows it drawn over its bottom 6 px". On the fake the
  content is exhausted at once; on a device the form scrolls and the title moves with the field, so the call runs to its
  timeout as above. Not measured live: the lab's titles draw nothing in the margin, so no lab cell answers `under`.

## Why it matters

The failure is honest and says what the screenshot showed, but an agent waits the whole timeout (about 12 s more than
the first stroke needs) for an answer the first read after a stroke already gives: the cover moved with the element.

## Expected

A covered `fully: true` stop whose cover is a margin text seen drawn over the element (`under`), still over it after a
stroke that moved them both by the same offset (the motion ledger's `Moved`), fails at once: no stroke brings the element
out from under a node that moves with it. The reply keeps today's words and says no swipe can clear it.

## Not fixed here

A src decision on the motion ledger's fast fails (interact/motion-ledger.ts, interact/scroll-rounds.ts), not ADR 0026's.
A lab cell whose next title draws a background over the field's touch margin would let it be measured live.
