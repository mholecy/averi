# BUG: under WDA, a React Native text input is listed inside an unnamed wrapper of its own size — averi reads it as a cover of its own floating label: the tap on the label refused, `scroll_until` fails

> **Status (2026-10-19):** open. KNOWN as this note (tests/differential/golden/react-native.known.ts: rn-field's N and
> M, tap, scroll_until and ocr under WDA); live LOUD (the tap refused, nothing fired:
> docs/truth/live-rn-2026-10-19.md). Calibration.json LR1.

Lab note LR1. **Found 2026-10-19** by round 7's React Native lab app (fixtures/apps/rn, `rn-field`; RN 0.88.0, new
architecture) on the `averi-lab iPhone 17` simulator (iOS 27.0, 402x874), WDA on port 8120, averi = truth/r7-rn's src
(truth/round-7 e856afc's).

## Observed (measured)

WDA's tree (tests/fixtures/truth/ios-rn-iphone17-ios27/rn-field.wda.json), each target on its box:

```
StaticText lab.rn-field.N 'Payee’s name'               69,131 94x23
Other (no name, no label)                              69,132 264x20
  TextField lab.rn-field.N.field (label '')            69,132 264x20
StaticText lab.rn-field.M 'Message for the recipient'  69,491 175x23
Other (no name, no label)                              69,492 264x38
  TextView lab.rn-field.M.field                        69,492 264x38
    Other 'Horizontal scroll bar, 1 page' '0 %'         69,508 264x19   (one bare thumb 72,524 258x3)
    Other 'Vertical scroll bar, 1 page' '0 %'           300,492 30x38
```

A raw `idb ui tap` at each label's centre focuses its field (the app's model: `focus` N, M; the probe in
rn-field.truth.json). averi (golden, and live under WDA):

```
tap text:"Payee’s name"           → ERROR text:"Payee’s name" is under textfield id:lab.rn-field.N.field (69,132 264x20)
                                    at its centre (116,143), drawn over it; only a 94x2 part of it shows … nothing was tapped
scroll_until text:"Payee’s name"  → failed after 3 swipes — element is in the viewport but under textfield … 13% of it
tap text:"Message for the recipient" → … under textfield id:lab.rn-field.M.field (69,492 264x38) … nothing was tapped
```

The ocr rows fail closed naming the field too. idb lists the same fields flat (no wrapper): all green there.

## Why (read from the source)

`ownControl` (src/ui-tree/draw-order.ts; docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md) excuses a text
input over its own label only as the label's SIBLING (`siblingOf`). React Native's text input component view
(RCTTextInputComponentView) hosts the UITextField / UITextView as its child, and WDA lists both: the input is the
label's nephew, behind an unnamed `Other` of exactly its rect. The overhang is within `LABEL_OVERHANG` (1 pt above, 1.3
below on N); the field holds the label's centre. The indicator half of #18 is not what covers here: the text view's
`Horizontal scroll bar` lies over M's label's centre and is excused (`scrollIndicator`, its parent a text input) — the
reply names the field, not the bar.

## Suggested fix (owner's choice)

Let `ownControl` see through a single unnamed, unlabelled, childless-but-for-the-input wrapper of the input's own rect
(the input as the label's sibling's only child), on WDA trees.

## Repro

`node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only ios-rn-iphone17-ios27/rn-field`.
