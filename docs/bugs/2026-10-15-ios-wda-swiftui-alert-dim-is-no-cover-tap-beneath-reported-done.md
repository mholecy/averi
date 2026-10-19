# BUG: under WDA a SwiftUI alert's dimming view is no cover — a tap on the form beneath it is reported "Tapped", the colour assert measures the dim as the element, and `scroll_until` says "fully visible"

**Measured 2026-10-15 09:22–09:25 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). averi = mobile-verify `arch/round-18` @ `dda435b` (`dist/`, HTTP daemon on port 47933), scratch `treeSource: wda`. The app is mp-native's SWIFT form (logged in).

## Symptom


On the SWIFT form, with a field changed (Payee's country = Uganda), `BackButton` raises the SwiftUI alert "Exit confirmation — Are you sure you want to exit? All entered data will be lost. / Keep editing / Discard" over a dimmed form (`img-84-0.png`, `img-99-0.png`, `img-104-0.png`). The form's fields lie under the dim, outside the alert card (`41,365 320x172`). averi's own tree marks them `hidden` (`swift-exit-alert.txt`: `scrollable 0,0 402x780 hidden`, `message_for_bank_input 24,576 354x52 hidden`), yet:

```
#100 tap id:swift_payment.form.message_for_bank_input
→ Tapped id:swift_payment.form.message_for_bank_input          (shim l.47: idb ui tap 201 602)
#101 assert color { element: { id: "swift_payment.form.message_for_bank_input" }, expected "#FFFFFF", deltaE 8 }
→ FAIL … fill within dE00 8 of #FFFFFF — sampled #CACACA (dominant, 95% of region) vs expected #FFFFFF → dE00 11.63 > 8; scale 3.000
#102 scroll_until id:swift_payment.form.message_for_bank_input
→ Element id:swift_payment.form.message_for_bank_input fully visible after 0 swipes
```

The tap went to the dim: the alert stayed up and the field got no focus (`img-104-0.png`, identical to `img-99-0.png`). The colour assert sampled the dimmed field (`#CACACA`, the white field under the alert's dim) and judged it as the element — it failed only because white was expected; expecting the dimmed grey would PASS. `scroll_until` claims a field nobody can reach is fully visible. The same `Tapped` happened first at #85 (l.36, 09:23:00) before the tree was captured.

## Repro


1. iOS, `treeSource: wda`, mp-native logged in: Home → PAY → `SWIFT payment`.
2. Change any field (here: `scroll_until id:…payee_country_select fully`, tap it, tap `payee_country_sheet.row_7`) — #94–#96.
3. `tap id:BackButton` (#97) → the "Exit confirmation" alert.
4. `ui_snapshot` (#98), then `tap`, colour `assert` and `scroll_until` on `id:swift_payment.form.message_for_bank_input` (#100–#102).
5. Leave with `tap role:button label:Discard` (#105).

## Evidence


- `swift-exit-alert.txt` (averi tree, #98): the form subtree under `SwiftUI.PlatformAlert`/the screen containers is `hidden`; `continue_button 24,780` is not; the alert's window holds `container 0,0 402x874`, `container 0,0 402x874`, then `container 'Exit confirmation' 41,365 320x172` with `Keep editing 57,473 140x48`, `Discard 205,473 140x48`.
- `swift-exit-alert-wda.json` (raw WDA): `Window 0,0 402x874` → child 1 `Other 0,0 402x874 isVisible 0` (the form's tree, every node `isVisible 0`, `message_for_bank_input {x 24, y 576, w 354, h 52} isVisible 0`), child 2 `Other 0,0 402x874 isVisible 1` holding `Other 0,0 402x874 isVisible 1` (no children — the dim), `Other 0,0 402x874 isVisible 0`, `Alert 'Exit confirmation' 41,365 320x172 isVisible 1`.
- `swift-exit-alert-idb.json` (idb): only the alert's texts and two buttons are listed.
- `swift-exit-alert-after.txt` (#103) and `img-104-0.png`: alert still up after #100.
- `session.log` #85 (09:22:58), #97–#105 (09:24:23–09:25:37); `idb-calls.log` l.36, l.47.

## Expected


The alert is a screen presented over the form: a tap on a field beneath refuses (`… a screen is presented over it (an alert …) — close it first; nothing was tapped`), the colour/ocr assert fails closed naming the cover, and `scroll_until` stops before any swipe with the same advice — as round 17/18 do for the sheet's `dismiss popup` region and the RN modal dim.

## Suspected cause


The alert's dim is a bare, unlabelled, childless `Other 0,0 402x874` sibling laid before the `Alert` node in the same Window as the form — the shape ADR 0018 item 8 excuses for "a presented sheet's own bare dimming leaf" (Contacts), so it is not read as a presented screen and nothing covers the form. The `Alert` element type (WDA `XCUIElementTypeAlert`), which identifies the layer unambiguously, is not used; nor is the target's own `isVisible 0` / averi's `hidden` flag, which the tap path apparently ignores for a target on screen. Siblings: `2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md`, `2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md`.
