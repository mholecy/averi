# BUG: on iOS idb a modal listed BEFORE the screen's content reads as covered by that content — `tap` refuses the payment-type sheet's rows, so mp-native's PAY → SWIFT / own-transfer flows fail

**Measured 2026-10-09 18:10–18:35 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native, mp-native's own
`averi.yaml`, default `treeSource: idb`); compared on the same device and screen with `dd50327` (a scratch worktree build on
port 47845, and the round-5 session of 15:35 UTC). `idb` PATH shim logging every `idb ui tap|swipe`. App: mp-native
(`com.finshape.dbosbanking`, "Skeleton Internal"), Account Detail → PAY → the payment-type chooser. Found by the round-6 device
check (before item T-1). **A regression of round 6 (H):** at `dd50327` the same call answered `Tapped
id:accounts.detail.payment_type_sheet.row_swift` (round-5 session log, 15:35:20 / 15:35:48 / 15:36:46 UTC).

## Observed (measured)

The chooser is a card drawn over the dimmed, blurred Account Detail (screenshot `run8-ios/img-8-0.png`: "To my account" and "SWIFT
payment" on a white card from y ≈ 373 to 528; the transaction list under it blurred). idb's flat list puts the card's rows in the
MIDDLE of the screen's content, after the action buttons and BEFORE the transaction list that lies behind it:

```
 10   button accounts.detail.action_pay_me        42,274 89x45
 11   button accounts.detail.action_pay          143,274 116x44
 12   button accounts.detail.action_scan_qr      272,274 89x45
 13   button accounts.detail.payment_type_sheet.row_own    45,397 312x52
 14   button accounts.detail.payment_type_sheet.row_swift  45,453 312x52
 15   button transactions.list.filter_icon        348,358 17x10
 16   other  transactions.list.date_header_0 '17.07.2026'  0,399 402x29
 17   button transactions.list.row_0 'Loan repayment, 17.07.2026, +602,00 EUR'  24,435 354x52
 18   other  transactions.list.date_header_1     0,494 402x29
 …
```

```
18:10:13 tap { platform: ios, selector: "id:accounts.detail.payment_type_sheet.row_swift" }          (1.1 s)
→ id:accounts.detail.payment_type_sheet.row_swift is under button "Loan repayment, 17.07.2026, +602,00 EUR" (24,435 354x52) at its
  centre (201,479), drawn over it; only a 312x7 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
18:10:4x tap { selector: "id:accounts.detail.payment_type_sheet.row_own" }
→ id:accounts.detail.payment_type_sheet.row_own is under other "17.07.2026" (0,399 402x29) at its centre (201,423), drawn over it; only a 312x7 part of it shows … nothing was tapped
18:10:4x tap { selector: 'text:"SWIFT payment"' }                → the same refusal as row_swift
18:10:5x scroll_until { selector: "id:accounts.detail.payment_type_sheet.row_swift" }
→ scroll_until … failed after 2 swipes — element is in the viewport but under button "Loan repayment, 17.07.2026, +602,00 EUR" (24,435 354x52)
  at its centre (201,479), drawn over it — 13% of it shows — and the content is exhausted: swiping down no longer moves it. The app draws that
  over it at the end of the content — a layout defect (no clearance for a pinned bar?), not a scroll that needs more swipes. …
```

No `idb ui tap` for the refusals; the scroll sent two `idb ui swipe 201 699 201 175` that moved nothing. Reproduced after a cold
relaunch and PIN login (18:11:5x, same text). mp-native's own flow, on a chooser just looked at:

```
18:12:0x run_flow { platform: ios, flow: "goto_swift_payment_form" }
state payment_type_chooser: already active
flow goto_swift_payment_form: start
✗ tap id:"accounts.detail.payment_type_sheet.row_swift": failed — … is under button "Loan repayment, 17.07.2026, +602,00 EUR" … nothing was tapped
```

Side by side on the same open chooser, 18:42 UTC: `2f98900` → the refusal above; then the `dd50327` build (scratch worktree, port 47845)
→ `Tapped id:accounts.detail.payment_type_sheet.row_swift`, shim `idb ui tap 201 479`, the SWIFT form opened.

Under WDA (scratch config `treeSource: wda`) the same tap → `Tapped id:accounts.detail.payment_type_sheet.row_swift` (shim `idb ui
tap 201 479`), the SWIFT form opened: WDA's nested tree is not affected.

The same shape on the SWIFT form's value-date picker (`swift_payment.form.value_date_picker 56,291 298x375`, a modal, listed right after
the title and BEFORE every form row): `scroll_until { selector: "id:swift_payment.form.value_date_picker" }` → `visible after 0 swipes —
PARTLY UNDER button "Fees*, OUR – All charges paid by the debtor" (24,613 354x52), drawn over it — 52% of it shows, its centre clear`
(the picker is drawn over Fees, not under it). The picker has no children in idb's tree, so no tap inside it was tried.

## Why (read from the source at 2f98900)

- Round 6 replaced round 5's interim rule `flatListAbove` (`dd50327:src/ui-tree/draw-order.ts:443–445`: a later node covers only when
  its top lies at or below the target's) with `flatListChrome` (`src/ui-tree/draw-order.ts:500–502`): content listed after the top
  bar's items is no cover of THEM, but "between content nodes nothing changes". `firstContent` (l. 797) ends the bar at the first
  node outside the top 20 % (`FLAT_LIST_TOP_BAR_FRACTION`, l. 774) — here the search field and the account card — so the chooser's
  rows are content, and every content node listed after them that meets them covers them.
- idb's flat list orders nodes by the app's accessibility order, not by drawing: a modal that the app's view tree places before the
  list (RN/SwiftUI overlay inserted in the screen's hierarchy) is listed before what it is drawn over. The interim rule happened to
  excuse `row_0` (top 435 < 453); under it `row_own` would have been refused by the date header (top 399 ≥ 397) — the shape was there
  before, round 6 widened it to every row.
- The handoff states the residual in the other direction only ("a small popover listed after the content … is not seen").

## Why it matters

- mp-native's iOS default tree source is idb, and `goto_payment_form` / `goto_swift_payment_form` (`averi.yaml` l. 722 and 749) tap
  exactly these rows: every flow that `requires: payment_form` or `swift_payment_form` now fails on iOS — the payment summary probe and
  `certify_own_transfer` included. The failure is loud (nothing tapped), not a wrong tap.
- The refusal's advice (`scroll_until it first`) and the S1 sentence ("a layout defect … no clearance for a pinned bar") send the author
  to the wrong cause: nothing is wrong with the layout, the chooser is on top.

## Possible fix directions (owner's choice)

- Treat a node that the screenshot-free tree can tell is a modal as drawn over everything listed outside it: in idb's list, a run of
  nodes whose rects lie wholly inside one card, or whose identifiers share the chooser's prefix, preceded by a dimming/dismiss node
  (`PopoverDismissRegion`, the sheet grabber) — or simply the run of nodes listed between two content nodes that overlap them.
- Restore the interim rule's excuse for content BELOW the bar band only (a later node whose top lies above the target's is no cover),
  keeping `flatListChrome` for the bar: the two cover different shapes.
- At minimum, on a flat list do not word a cover listed after the target as "drawn over it" with "a layout defect"; say the order is idb's
  accessibility order and suggest `treeSource: wda` for the screen.

## Repro

1. iOS, mp-native logged in on Account Detail (default `treeSource: idb`).
2. `tap { selector: "id:accounts.detail.action_pay" }` → the chooser opens.
3. `tap { selector: "id:accounts.detail.payment_type_sheet.row_swift" }` → `… is under button "Loan repayment, …" … nothing was tapped`; at
   `dd50327`: `Tapped …`, the SWIFT form opens.

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**M-1.1 — Holds (fixed).** Account Detail → `tap id:accounts.detail.action_pay` → the chooser, idb order: header nodes, `PAY ME/PAY/SCAN
QR`, `payment_type_sheet.row_own 45,397 312x52`, `row_swift 45,453 312x52`, THEN `filter_icon`, `date_header_0`, `row_0 24,435` …:

```
20:43:18 tap { platform: ios, selector: "id:accounts.detail.payment_type_sheet.row_own" }   → Tapped …row_own     (1.3 s)  idb ui tap 201 423
20:43:32 tap { …, selector: "id:accounts.detail.payment_type_sheet.row_swift" }             → Tapped …row_swift   (1.3 s)  idb ui tap 201 479
```

TO MY ACCOUNT and SWIFT PAYMENT opened (backed out, nothing entered). mp-native's own flows on idb: 20:48:44 `run_flow goto_swift_payment_form`
(device just read: Account Detail) → `state account_detail: already active` / `flow goto_payment_type_chooser` … / `tap:
id:"accounts.detail.payment_type_sheet.row_swift"` / `wait: element id:"swift_payment.form.debit_select"` / `done` / `appAlive: true`
(4.0 s; taps `201 296`, `201 479`); run three more times in the session, each `done`. At 2f98900 these taps were refused.

**M-1.2 value-date picker — Holds.** Open picker: idb lists `other 'Value date' swift_payment.form.value_date_picker 56,291 298x375` right
after the title, before the form (no day cells exposed). `scroll_until … value_date_picker, fully: true` → `fully visible after 0 swipes`
(round 6: `PARTLY UNDER button "Fees*, …" — 52%`); `tap id:swift_payment.form.value_date_picker` → `Tapped` (`idb ui tap 205 479`), the
picker closed, value unchanged.

**M-1.3 — Holds.** At rest: `tap id:swift_payment.form.priority_select` → `… is under button "Continue to summary" (24,780 354x44) at its
centre (201,797), drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was
tapped` (20:44:23, no shim tap). The same text under WDA (20:56:33).

**M-1.4 keyboard on idb — Holds (no key pressed); one wording residual.** Number pad up on `Value*` (keys `1 5,596 132x54` … `Delete`,
band `other 0,589 402x285`), CONTINUE lifted to `24,512 354x44`. Rows under the keys are ABSENT from idb's tree (fees, priority, PAYMENT
DETAILS gone; `value_date_select 24,545 354x52` kept). 20:49:02 `tap id:swift_payment.form.value_date_select` → `… is under button
"Continue to summary" (24,512 354x44) at its centre (201,571), drawn over it; only a 354x7 part of it shows … nothing was tapped` — the cover
named is the LIFTED CONTINUE (its reach to the keyboard's top); no shim tap, no digit typed (amount unchanged). Residual: the "354x7 part"
that "shows" is 589–596, inside the keyboard band (the screenshot shows the keyboard there, its drawn top at ≈572 pt) — nothing of the row
shows. 20:14:47 `tap id:swift_payment.form.fees_select` (under the keys) → `Timed out after 5000ms waiting for … to appear`, no tap (R-1).
QWERTY on Contacts' New Contact: the rows between 534 and 902 (`add phone` … `add pronouns`) are absent too; `tap 'add url' (20,902)` →
`off screen at (201,928)`, no tap.

**M-1.5 — Holds.** Account Detail, rows `row_3 24,721` / `row_4 24,817` under the floating bar, the tabs listed FIRST (idb order: tabs,
search, header, actions, rows): `tap id:nav.tab_home` → `Tapped` (`78 787`), `tap id:nav.tab_cards` → `Tapped` (`242 787`), Cards opened.
**But** a ROW's tap in the strip above the tab buttons lands on the bar — NEW note (floating tab bar).

**R-3.5 non-bank sheets/modals on idb — Holds.** Contacts New Contact (idb lists only the sheet + `Toolbar 0,83 402x48` last): `tap 'add
address' (20,93)` → `… is under other "Toolbar" (0,83 402x48) at its centre (201,119) … only a 362x13 part … nothing was tapped`;
`'add related name' (20,295)` → `Tapped` (`201 321`). Settings › Language & Region › Add Language… sheet (idb lists only the sheet):
`tap role:button text:"close"` → `Tapped` (`38 100`), closed. No content-behind-the-sheet row was listed by idb in either, so "a row behind
the sheet is still refused" could not be measured on these screens.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**M-1 re-run — Holds.** PAY → `row_swift` → Tapped `201 479` (06:19:41), `row_own` → Tapped `201 423` (06:35:02), the right forms
opened. Value-date picker `56,291 298x375` (listed before the form): `scroll_until … fully` → `0 swipes`; `tap` → Tapped `205 479`, the
picker closed, value unchanged. Keyboard (M-1.4): see the soft-keyboard-stroke note's K.3 — the reply now says `nothing of it shows above
the soft keyboard`. Tabs (M-1.5) tapped. R-3.5: the New Contact sheet's own controls (`Add`, `Don’t Allow Paste` on an iOS paste alert)
tapped.
