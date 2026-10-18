# 14. A text input is no cover of its own label (overhang up to 2 pt or dp)

Status: accepted, 2026-10-10 (owner); refined 2026-10-19 (round 7, React Native — see Refinement).

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
label's centre, with the label overhanging it by at most the overhang on any side (`ownField`), is the label's own
field, not a cover of it. It is a row of the same table, not one of its own: the same judgement (the label's control,
laid after it, takes the tap the caller means), with a geometry per shape.

The overhang is 2, "up to 1–2 pt", as the owner put it, against the 1 pt measured — first in the tree's units
(pixels on Android, a third as wide there); since 2026-10-19 2 pt or dp (Refinement 3).

## Refinement (2026-10-19): React Native's fields

Round 7's React Native lab app (fixtures/apps/rn, `rn-field`, RN 0.88, new architecture) refused the tap on each
field's floating label on both platforms, as under its own field — two shapes the 2026-10-10 rule did not reach:

- **WDA wraps the input** (docs/bugs/2026-10-19-lab-ios-wda-rn-text-input-wrapped-in-its-component-view-reads-as-a-cover-of-its-own-label.md):
  `text 'Payee’s name' 69,131 94x23`, then `Other 69,132 264x20` (no label, identifier or value) holding
  `TextField 69,132 264x20` — React Native's text input component view hosting the UITextField. The field was the
  label's nephew, so no sibling. mp-native's SWIFT form (an older React Native) lists no such wrapper.
- **Android's overhang is 3 px** (docs/bugs/2026-10-19-lab-android-rn-label-overhanging-its-edittext-by-3-px-reads-as-covered-by-it.md):
  the label laid 1 dp above its EditText, `177,360 255x61` over `177,363 726x55` at density 2.75 — past the 2 tree
  units, which on Android are pixels.

Decided (the orchestrator's, round 7):

1. **The field's outermost self.** A text input and every wrapper that is nothing but it — an unnamed `container`
   whose only child it is, of its rect to a sub-unit — are one node to the label (`draw-order.ts#outermostSelf`,
   `inputOf`): the sibling test asks the outermost, and the wrapper is excused with the input. A wrapper named,
   interactive, of another rect or holding anything else is a node of its own, and the input inside it still covers.
2. **The parent's size is not asked of the field.** React Native lays its fields in the screen's own view (both
   platforms), which `screenSized` read as a scrim's parent. The rule against a screen-sized parent guards the
   width and padded shapes (a backdrop spanning its container); a text input holding a label's centre within the
   overhang is no scrim. The control itself filling the screen still covers.
3. **The overhang is a physical size: 2 pt or dp**, as half a percent of the screen's shorter side
   (`draw-order.ts#labelOverhang`, `LABEL_OVERHANG_FRACTION`), as `minTapPiece` is scaled — 2 pt on every iPhone
   (320–440 pt), 5 px on the 1080-px averi_lab (1.8 dp), 7 px on a 1440-px phone at 3.5, 4 px on a 720-px one at 2.
   Not by the density, weighed: the density is in `dumpsys window displays` (`440dpi`), which the Android adapter
   reads for the system bands at `viewport()`, after the tree — but the draw order is a function of the tree alone
   (memoized per tree, and judged inside the uiautomator parser's widening, before any such read), and no tree
   carries its density. Carrying it would put a device read on every tree read, or make the draw order depend on
   which read came first. A phone's shorter side in pt or dp is narrow enough (320–440) that the share is 2 pt or dp
   to the rounding.

## Residuals accepted

- A label overhanging further, or whose centre lies off the field (a floating label above its outline), is still covered.
- A labelled or valued field still covers. A placeholder label that WDA keeps listing over a filled field is refused.
- Any other control of that shape (a button) still covers.
- On a tablet the overhang is wider in its own units: 4 pt on an 820-pt iPad, 4 dp on an 800-dp tablet.
- A text input in a screen-sized parent is excused like any other (refinement 2); one filling the screen is not.

## Bug notes

docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md
docs/bugs/2026-10-19-lab-ios-wda-rn-text-input-wrapped-in-its-component-view-reads-as-a-cover-of-its-own-label.md
docs/bugs/2026-10-19-lab-android-rn-label-overhanging-its-edittext-by-3-px-reads-as-covered-by-it.md

The first note is not tracked yet; its measurements are recorded above.
