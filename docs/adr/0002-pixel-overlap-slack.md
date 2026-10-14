# 2. A 2-unit overlap slack for what hides a pixel assert's element

Status: accepted, 2026-10-12 (owner).

## Context

Tree frames come in whole units: points on iOS, pixels on Android. A neighbour laid flush with an element can share an
edge's antialiasing with it and nothing more. Measured examples:

- idb's `text "Amount*"` (`42,283 51x15`) under `text "Value*"` at y 296;
- a `Payee's country` row ending 2 pt into CONTINUE.

Both overlap by 2 pt and neither hides the element. Counting such overlaps would fail asserts on elements that are
plainly visible.

## Decision

An overlap counts against a pixel assert only when it is thicker than `PIXEL_OVERLAP_SLACK` on its thin side. The slack
is 2 tree units (`ui-tree/geometry.ts#PIXEL_OVERLAP_SLACK`, asked through `geometry.ts#overlapsPastSlack`). It applies
to:

- the pixel covers (`draw-order.ts#DrawOrder.paintsOver`);
- the system bands under the pixel assert (`ui-tree/standing.ts#Scene`);
- the keys that tile idb's keyboard band (ADR 0007);
- since 2026-10-14, the thin sliver (`ui-tree/standing.ts#thinSliver`): an element the screen's edge leaves no thicker
  than the slack on the screen is judged off the screen, never measured — a cover over so thin a sliver is never
  counted, so the sampler would read the cover (ADR 0018, "Amendment: presented judged of the node").

It does not apply to the keyboard's own region. Any overlap there fails the assert (ADR 0010).

## Residuals accepted

- A cover no thicker than 2 units over an element's edge is not seen.
- On Android the slack is 2 px, a third of 2 pt. That is stricter, the safe direction.

## Bug note

docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md

This note is not tracked yet. The measurements are recorded above.
