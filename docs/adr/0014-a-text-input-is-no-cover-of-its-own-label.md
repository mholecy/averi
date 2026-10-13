# 14. A text input is no cover of its own label (overhang up to 2 units)

Status: accepted, 2026-10-10 (owner).

## Context

Under WDA, the SWIFT form lists each unlabelled field as `container swift_payment.form.payee_name_input 24,431 354x52`,
then its label `text 'Payee’s name' 42,446 103x22`, then the field `textfield 42,447 318x20`. The field is laid after
the label and over it, so draw order read it as a cover, and `tap text:"Payee’s name"` — the natural selector for an
unlabelled field — was refused on every such row. A tap at the label's centre lands in the field.

The label is 1 pt taller than the field above and below, so the field does not hold it whole, and the field is inset
18 pt from its wrapper, so it neither spans its parent nor is padded in it. The two shapes `ownControl` already excused
did not fit.

## Decision

A third shape of the `ownControl` row (`ui-tree/draw-order.ts`): an unlabelled, unvalued text input that holds the
label's centre, with the label overhanging it by at most `LABEL_OVERHANG` on any side (`fieldOf`), is the label's own
field, not a cover of it. It is a row of the same table, not one of its own: the same judgement (the label's control,
laid after it, takes the tap the caller means), with a geometry per shape.

`LABEL_OVERHANG` is 2, in the tree's units: "up to 1–2 pt", as the owner put it, against the 1 pt measured. On Android
the units are pixels, so there it is a third as wide — stricter, the safe direction.

## Residuals accepted

- A label overhanging further, or whose centre lies off the field (a floating label above its outline), is still covered.
- A labelled or valued field still covers. A placeholder label that WDA keeps listing over a filled field is refused.
- Any other control of that shape (a button) still covers.

## Bug note

docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md

This note is not tracked yet. The measurements are recorded above.
