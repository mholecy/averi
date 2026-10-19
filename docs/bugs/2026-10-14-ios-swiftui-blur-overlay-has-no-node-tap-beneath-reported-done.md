# BUG: an in-screen SwiftUI overlay menu with a blurred, dimmed backdrop has no node in either iOS tree, so a tap on the screen beneath it is reported "Tapped" while the backdrop takes it and only closes the menu

**Measured 2026-10-14 22:21–22:23 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-13` @ `d407256` (`dist/`, stdio via the HTTP daemon on port 47893), both `treeSource: wda`
(scratch) and the default idb. The app is mp-native, Account Detail, logged in.

## Symptom


Account Detail → `PAY` (`accounts.detail.action_pay`) shows the payment-type menu: a white card "To my account / SWIFT payment" over
a blurred, dimmed Account Detail. The tab bar is hidden (`img-132-0.png`, `img-136-0.png`). In WDA's tree the menu is a child of the
screen's own container. **No node** stands for the blur/dim backdrop (`run13-ios/X-wda-paytype-sheet.json`):

```
container id=accounts.detail.container 0,0 402x874
  … scrollable id=transactions.list.container 0,180 402x694   (rows row_0 … row_7, e.g. row_2 24,626 354x52)
  button PAY ME / PAY / SCAN QR
  container id=accounts.detail.payment_type_sheet 45,397 312x108
    button id=…payment_type_sheet.row_own 45,397 312x52
    button id=…payment_type_sheet.row_swift 45,453 312x52
(then the host's hidden tab bar: nav.tab_* 69…266,711 66x52)
```

idb's flat list is the same: rows `transactions.list.row_0…7`, the two menu rows, and no backdrop.

```
22:21:48 tap { selector: "id:transactions.list.row_2", configPath: <cfg-wda> }   (4.2 s)  → Tapped id:transactions.list.row_2
22:22:29 tap { selector: "id:transactions.list.row_2" }   (idb)                  (1.3 s)  → Tapped id:transactions.list.row_2
```

The shim logged `idb ui tap 201 652` both times (l.39, l.41). Both times the menu closed and Account Detail stayed. No transaction
detail opened (`img-134-0.png`, `X-after-idb-row2.json`). With the menu closed, the same tap opens the transaction detail
(22:23:03, l.42, `X-row2-detail.json`: `common.top_bar.back`, "Loan repayment"). The reply says the row was tapped, but the backdrop
swallowed the touch.

## Repro


1. mp-native logged in, Account Detail. `tap id:accounts.detail.action_pay`.
2. `tap id:transactions.list.row_2` (idb or WDA) → `Tapped`. The menu closes and no detail opens.

Harmless here, because the backdrop only closes the menu. With a control whose press matters, the reply would be equally wrong.

## Evidence


- `run13-ios/session.log` #129–#142
- `X-wda-paytype-sheet.json`, `pay-menu.json` (idb), `X-after-idb-row2.json`, `X-row2-detail.json`
- `img-132-0.png`, `img-134-0.png`, `img-136-0.png`, `img-142-0.png`
- `idb-calls.log` l.39, 41, 42

## Expected


Round 9's M / ADR 0018: a control beneath a screen-covering layer is refused (`… close it first; nothing was tapped`), never reported
tapped. If the tree carries no evidence of the layer, averi cannot judge it. In that case the note is a request for a stated residual,
or for an app-side fix: give the backdrop an accessibility element (`.accessibilityElement()` with an identifier, or
`accessibilityAddTraits(.isModal)` on the menu, which hides the screen beneath from the tree).

## Suspected cause


SwiftUI's `.blur`/`.overlay` backdrop is not an accessibility element, and the card is inserted inside the same container as the
screen. Neither tree source exposes anything over the rows. Indirect signals exist: WDA moves the host's tab bar to its hidden frame
(y 711, `visible="false"` in raw `/source`, see the hidden-tab-bar note's C.1 capture), and idb drops the tab bar from its list
(`pay-menu.json` has no `nav.tab_*`, while Account Detail without the menu lists them at 755). A cheap app-side fix is likely better
than an averi heuristic.
