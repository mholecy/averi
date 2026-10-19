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
StaticText lab.rn-field.M 'Message for the recipient'  69,491 175x23   (the state: 174.3x22.3, centre y 502.2)
Other (no name, no label)                              69,492 264x20
  TextView lab.rn-field.M.field                        69,492 264x20
    Other 'Vertical scroll bar, 1 page' '0 %'           300,492 30x20   (its bare thumb 327,475 3x34)
    Other 'Horizontal scroll bar, 1 page' '0 %'         69,499 264x10   (its bare thumb 72,506 258x3)
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
below); the field holds the label's centre. #18's indicator is not what covers here: M's `Horizontal scroll bar`
(499–509) holds its label's centre (502.2), as mp-native's (454–464 over its label's 457), and is excused
(`scrollIndicator`, its parent a text input) — the reply names the field, not the bar.

## The bank app (mp-native) does not hit it today

mp-native's SWIFT form (tests/fixtures/wda-capture-swift-form-pushed.json, `swift_payment.form.payee_name_input`) lists
its `TextField 42,817 318x20` as the label's DIRECT sibling — no wrapper — and its single-line field lists the
`Horizontal scroll bar` (`52,824 298x10`); the lab's RN 0.88 single-line field lists no bar and sits in a wrapper. Both
differences are most likely RN 0.88's new architecture (Fabric's component view hosting the native input; mp-native's
build is older or on the legacy architecture — not measured). So LR1 is a defect on RN's new architecture, which the
bank app will meet when it moves to it, not one it meets now. Reproducing mp-native's own shape would take a lab app on the bank app's RN version and architecture — an older RN
(RN 0.82 dropped the legacy architecture, so 0.88 cannot switch back), pinned beside this one — round 7 did not try it.

## Suggested fix (owner's choice)

Let `ownControl` see through a single unnamed, unlabelled, childless-but-for-the-input wrapper of the input's own rect
(the input as the label's sibling's only child), on WDA trees.

## Repro

`node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only ios-rn-iphone17-ios27/rn-field`.
