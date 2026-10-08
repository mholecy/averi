# BUG (diagnostics): a `wait` on an id idb never surfaces times out after 30 s with no hint why

> **Status (2026-10-08):** fixed on main in `c5dd5eb` (2026-10-06) — an id-only `wait:` on iOS idb times out naming the cause (`no tree read contained id:…`, `flow/engine.ts#idbContainerIdHint`); since `d165ce4` (2026-10-08) a timeout whose last tree read was bare quotes the bare-tree note (`ui-tree/verdict.ts#bareTimeoutNote`) instead.

**Measured 2026-10-05 21:26 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS default idb tree
source), iPhone 17 simulator iOS 26.5. Filed from the SWIFT-payment journey-developer run
(`debug-ai-logger/2026-10-05-1304-swift-payment/`, iteration 6).

## Observed (measured)

`run_flow { platform: ios, flow: goto_swift_payment_form }`:

```
flow goto_swift_payment_form: start
tap: id:"accounts.detail.payment_type_sheet.row_swift"
✗ wait id:"swift_payment.form.amount_input": failed — Timed out after 30000ms waiting for element id:"swift_payment.form.amount_input"
```

The SWIFT form WAS on screen (same flow, same step, passed on Android 0.4 s earlier; Maestro's XCTest tree sees the id on
iOS). The id sits on a SwiftUI container (`StyledTextField` with `.accessibilityElement(children: .contain)` +
`.accessibilityIdentifier`), and the idb accessibility tree does not surface container identifiers. The element was
not "late": it would never have appeared. The flow was fixed on the config side (detect on
`swift_payment.form.debit_select`, a button that idb does show).

## Why it matters

- The failure is indistinguishable from a slow screen or a wrong navigation step. Diagnosing it took a device
  inspection plus reading the averi.yaml header trap ("DETECT STATES ON BUTTONS / ROWS — iOS idb never surfaces
  container ids").
- The wait costs the full timeout (30 s here) every time.
- The `ui_snapshot` tool description already carries the hint ("if `id:` finds nothing … that is the default idb tree
  source — set `app.ios.treeSource: wda`"), but only for React Native and only on `ui_snapshot`, not on the `wait`
  that actually fails in a flow.

## Possible fix directions (owner's choice)

- On a `wait`/`tap` timeout for an `id:` selector, take one final tree and report whether the id occurs ANYWHERE in it
  (including zero-area / non-visible nodes). "id never present in the tree" vs "present but not visible/settled" are
  different failures and deserve different messages.
- When the platform is iOS with `treeSource: idb` and the id is never present, append the treeSource hint (as the
  `ui_snapshot` description does), and name container identifiers as the usual cause, not just React Native.
- Optionally fail fast: an id absent from N consecutive full trees while the screen is otherwise settled is not going
  to appear.

## Repro

A SwiftUI view whose identifier is set on a container (`VStack { … }.accessibilityElement(children: .contain)
.accessibilityIdentifier("x")`), averi iOS with the default idb tree source, a flow step `wait: { element: { id: x } }`.
It times out at the configured timeout with only "Timed out … waiting for element".
