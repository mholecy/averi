# BUG: `tap` and `scroll_until` treat a row hidden behind the app's own pinned chrome (a bottom CTA bar, the top bar) as visible — "Tapped" lands on the bar, "fully visible" is a row nobody can see

**Measured 2026-10-08 20:09–20:13 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`), SWIFT payment form (branch `feature/swift-payment`), iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509`
built from source (`dist/`, stdio). No keyboard up during any of these calls.

## Observed (measured)

The form pins a CONTINUE bar at the bottom (`button 'Continue to summary' swift_payment.form.continue_button` at
`24,780 354x44`, listed LAST in idb's pre-order), and draws a translucent top bar (status bar + back button + title,
≈ y 0–116) over the scroll view.

### 1. A row under the bottom bar: "fully visible", "Tapped", nothing opens

`priority_select` at `{x:24, y:763, w:354, h:52}` — its centre (201,789) lies on the CONTINUE bar (y 780–824); the
screenshot shows only the "Priority*" caption peeking above the bar.

```
tap { selector: "id:swift_payment.form.priority_select" }               → Tapped id:swift_payment.form.priority_select   (1.4 s)
ui_snapshot { filter: 'id~"priority_sheet"' }                           → 0 matches … in a tree of 45 nodes
scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }
                                                                        → Element id:swift_payment.form.priority_select fully visible after 0 swipes
tap { selector: "id:swift_payment.form.priority_select" }               → Tapped id:swift_payment.form.priority_select
ui_snapshot { filter: 'id~"priority_sheet"' }                           → 0 matches
```

The taps landed on the (disabled) CONTINUE button. After a manual `swipe (380,600) → (380,400)` (row at y 452) the same
`tap` opened the sheet (`priority_sheet.row_0/1` listed). Had CONTINUE been enabled, the "Tapped priority" call would have
submitted the form to its summary.

### 2. A row under the top bar: "fully visible", and a centre tap hits the status bar

After `scroll_until text:"Payee’s street" fully` the IBAN input sat at `{x:42, y:27, w:280, h:20}` — wholly behind the
top bar (screenshot: the bar shows the title; the first visible field is BIC):

```
scroll_until { selector: 'role:textfield value:"BE15964000000130"', direction: "up", fully: true }
→ Element role:textfield value:"BE15964000000130" fully visible after 0 swipes
```

And `priority_select` at `{y:-20, h:52}` (centre y 6, "partly visible" by the off-screen rule) → `tap` → `Tapped
id:swift_payment.form.priority_select`; the point is iOS's status bar, so the tap scrolled the form back to the top
(status-bar scroll-to-top) instead of opening the select.

## Why (read from the source)

- `src/interact/resolve.ts#onScreen` / `refuseOffScreen` (2026-10-08 fix) judge the centre against the screen box only.
- `src/ui-tree/geometry.ts#shadowing` exists — it finds a later, non-structural node over a point — but only
  `interact/keyboard-in-tree.ts` (the dismissal picker) calls it; the tap target itself is never asked (`grep shadowing(
  src` → geometry.ts, keyboard-in-tree.ts). Here the cover IS in the tree: `continue_button` comes after `priority_select`
  in pre-order and contains (201,789).
- `src/interact/scroll.ts` scores visibility against the screen (or the box above the keyboard), not against nodes drawn
  over the target. The top bar is not one node in idb (only `BackButton` 30,70 28x28 and the title 136,74 130x20), so it
  cannot be found by `shadowing`; but the scroll view's first visible content / the title's bottom bound it.

## Why it matters

- "Tapped X" with X's centre under a sticky CTA presses the CTA — in a payment form, the submit button. The tool reports the
  intended target. This is the most common layout in mp-native forms (pinned CONTINUE/CONFIRM bar over a scroll view).
- `scroll_until … fully: true` exists to prove the element is visible before a rect/pixel/screenshot step; here it
  certifies a row covered by the bar, and does not scroll although scrolling would fix it.

## Possible fix directions (owner's choice)

- Before tapping a resolved node, ask `shadowing(tree, node, point)`; when a later interactive node covers the point,
  refuse naming it (`… is covered by button "Continue to summary" at (201,789) — scroll_until it first; nothing was tapped`),
  or pick a point of the node that is not covered (the visible caption strip here).
- In `scroll_until`, subtract the rects of later-in-tree nodes that overlap the target (sticky bars) from its visible area, so
  "fully" fails or keeps scrolling; for the top inset, bound the viewport by the scroll container's top content edge / the
  title's bottom.
- At minimum, flag the case: a target whose tap point lies inside another node's rect that comes later in pre-order.

## Repro

1. iOS, idb, mp-native SWIFT form (`run_flow goto_swift_payment_form`), keyboard down, CZK account (form at rest:
   `priority_select` y 763, CONTINUE bar 780–824 — fill IBAN/BIC so the notice rows push it there, or use any row whose
   centre falls in 780–824).
2. `scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }` → "fully visible after 0 swipes".
3. `tap { selector: "id:swift_payment.form.priority_select" }` → "Tapped …"; `ui_snapshot { filter: 'id~"priority_sheet"' }`
   → 0 matches.

## Device check (2026-10-09 Android, re-run at 610660f)

Measured 05:05–05:06 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked and up), averi =
mobile-verify `fix/keyboard-aware-scroll` @ `610660f`. Fixture: Google Contacts "Create contact" editor (top app bar with
close, title, Save ≈ y 66–240; the form scrolls under it). **Android has the same symptom, top bar:**

```
scroll_until { selector: 'text:"First name"', direction: "up", fully: true }
→ Element text:"First name" fully visible after 1 swipe          (stroke 540 444 → 540 1118)
ui_snapshot → textfield 'First name' 132,118 816x160               (full 160-px rect, not clipped by uiautomator here)
tap { selector: 'text:"First name"' }
→ Tapped text:"First name"                                         (input tap 540 198 — on the app bar, beside the title)
uiautomator dump → First name focused="false"
```

Screenshot after the scroll: only the bottom border of the First name box shows below the bar. The tap hit the bar (here a
neutral area — nothing happened); a bar with a button at that point would have pressed it. The bottom-pinned CTA case
(mp-native CONTINUE) was not measured (form not reachable this session).

## Device check (2026-10-09 iOS, re-run at 610660f)

Measured 05:22–05:46 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`). **The mp-native SWIFT form was
not reachable this session**: the bank app was still logged in on the device, but every Hive read came back
`SUBGRAPH_RESPONSE_BODY_EMPTY` from `gds-business` (app log, 07:22–07:45 local — the no-session signature named in mp-native's
`scripts/hive-probe.mjs`), so the SWIFT form, the own-transfer form, the dashboard list and the Transactions tab all rendered
"That's an error"; logging in again was not permitted to this session. Fixtures instead: the bank app's account-detail screen
(search field + error state), the stock Contacts "New Contact" sheet (UIKit form, ~4 pages) and Settings (SwiftUI list).
Software keyboard raised by toggling `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen`
to false and switching apps (`launch_app` bank → `launch_app` Contacts) — a toggle plus focus change alone did not raise it
after a `fill` this time; both prefs restored to 1 at the end. Strokes recorded with an `idb` PATH shim logging every `idb ui
swipe|tap|text` the server sent.

**Not measured on iOS.** The CONTINUE-bar repro needs the SWIFT form (did not load), and the other pinned chrome in the bank app
— the tab bar over the account-detail transaction list (`Loan repayment, 25.06.2026` at y 721–773 under the tab bar's
755–819 at 05:22 UTC, read from cache) — was gone once the screen re-rendered its error state. Nothing was pressed on any
CTA. Expected to still reproduce (no fix on this branch).

## Device check (2026-10-09 iOS bank form, re-run at 610660f)

Measured 05:56–06:08 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native SWIFT
form (`feature/swift-payment`, logged in by the owner-authorised PIN-only `login_pin_ios_here` after a cold relaunch; data
loaded), averi = mobile-verify `fix/keyboard-aware-scroll` `dist/` built at `610660f` (the branch head has since moved to
`57dd6ac`; `dist/` predates those commits — no `fill-verdict.js` in it), stdio, cwd `/Users/mholecy/Finshape/mp-native`.
Scratch configs only (`treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`; mp-native's `averi.yaml`
untouched). Decimal pad raised the round-1 way: `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled` /
`HardwareKeyboardLastSeen` set to NO before a cold relaunch, then a focus TAP (not a fill) on
`id:swift_payment.form.amount_input` → WDA `role:keyboard` `0 572 402 302`; prefs restored to 1 at the end. Strokes and taps
recorded with an `idb` PATH shim.

**Still reproduces (unfixed, as expected)** — no keyboard; with `iban_notice` shown (IBAN `DE89…` in a CZK payment) the form at
its top puts `priority_select` at `24,771 354x52`, its centre (201,797) on the CONTINUE bar `24,780 354x44` (disabled, grey in the
screenshot; only the row's top 9 pt peek above the bar):

```
06:07:28  scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }       → fully visible after 0 swipes (0.4 s)
06:07:30  tap { selector: "id:swift_payment.form.priority_select" }                             → Tapped … (1.4 s)
06:07:32  (treeSource: wda) scroll_until … fully: true                                          → fully visible after 0 swipes (1.5 s)
06:07:36  (treeSource: wda) tap …                                                               → Tapped … (3.5 s)
```

idb shim: `ui tap 201 797` both times; no `priority_sheet` in either tree after (only the row, still at 771). The taps landed on
the disabled CONTINUE; nothing navigated. Both tree sources agree.

## Device check (2026-10-09 Android bank form, re-run at 610660f)

06:03–06:08 UTC, mp-native (logged in by the owner), emulator-5554, averi `dist/` from `610660f`. Still unfixed; on Android
it shows through uiautomator's clipping rather than as a centre under the chrome.

- SWIFT form, keyboard down: the CONTINUE bar is outside the scroll container (`[0,242][1080,1978]`; CONTINUE `[66,1979][1014,2111]`),
  so no row's tree rect ever reaches under it — the rows are clipped at 1978 (`priority_select` `{y:1846, height:133}`, true
  height 143). A row whose centre sits under CONTINUE cannot be produced from the tree; `tap` therefore never aims at
  CONTINUE (not tapped, nothing confirmed). But `scroll_until … fully: true` certifies the clipped row: `priority_select` →
  `fully visible after 0 swipes` while the screenshot shows its lower edge behind the bar. Same at the top bar: `fees_select`
  `{y:242, height:103}` → `fully visible after 1 swipe` with 40 px of it behind `SWIFT PAYMENT`. Details in
  [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md).
- Account Detail: the floating tab bar (`nav.tab_*`, y 1876–2052) hides when the list scrolls down, so `scroll_until
  transactions.list.row_16 fully` (y 1959–2102) was truthfully visible (screenshot). With the list at the top and the bar shown,
  `transactions.list.row_3` (behind the bar) is absent from every read (rows 0, 1, 2, 4 listed); `scroll_until row_3` swiped
  down 5 times to the end of the list and timed out `element never appeared in the tree` (15.9 s). Not tied down whether the
  app or uiautomator drops that node.
