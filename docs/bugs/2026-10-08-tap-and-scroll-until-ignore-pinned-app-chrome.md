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

## Device check (2026-10-09 Android, re-run at dd50327)

Measured 2026-10-09 15:35–16:01 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47831, cwd mp-native). Strokes and taps from
the `adb` shim; page placement, bar show/hide and Gboard mode by hand with the real `adb`.

Round-5 items C3-4, C3-5, C3-6 (Android part). Account Detail, tab-bar host `66,1840 948x248` (an unlabelled `container`, AFTER the list in
the dump: list container at pre-order 12, host at 104).

- **C3-4.1 — Measured, then Holds.** The app never lists a row CONTAINER under the host: uiautomator clips `transactions.list.row_N` to what
  shows (`row_29 66,1784 948x56` with the bar at 1840; a row wholly under the bar is dropped). So `tap id:transactions.list.row_29` (15:42:28) →
  `Tapped id:transactions.list.row_29`, `input tap 540 1812` — the clipped rect's centre, above 1840; the detail opened. The row's label
  node keeps the full rect (`other 'Loan repayment, 17.12.2025, +493.00 EUR' 66,1784 948x143`, centre (540,1855) under the host): 15:42:58
  `tap { selector: 'label:"Loan repayment, 17.12.2025, +493.00 EUR"' }` → `label:"Loan repayment, 17.12.2025, +493.00 EUR" is under container
  (66,1840 948x248) at its centre (540,1856), drawn over it; only a 948x48 part of it shows, under the 65x65 a tap may be moved to — scroll_until
  it first; nothing was tapped` (5.8 s). Shim: no `input tap`. (The part that shows is 56 px by the tree, 1784–1840; the reply says 48.)
- **C3-4.2 — Holds, with a false annotation.** 15:43:16 plain `scroll_until` on the same label → `Element label:"…" visible after 1 swipe —
  PARTLY UNDER text "LR" (136,999 48x49), drawn over it — 98% of it shows, its centre clear. …` (10.3 s), `540 1553 540 689 865`; label at
  `66,951 948x143` — centre clear of the host ✓. But "LR" is the row's own avatar text (in an avatar wrapper, a sibling of the label node).
- **C3-4.3 — Fails (same cause).** 15:43:39 `fully: true` on the label, wholly on screen at `66,951` → `failed after 15000ms (timeout) — element
  was in the viewport after swipe 2 but did not stay …  turned round 3 times …` (17.5 s), four strokes moving it away and back. Both filed in
  `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md` (item 4).
- **C3-5 — Contacts top bar: the bar comes AFTER the scroll view.** After `scroll_until { selector: 'text:"First name"', direction: "up", fully:
  true }` (15:55:47, `fully visible after 1 swipe`, `540 624 540 1772 1150`): clipping container `0,242 1080x1912` at pre-order 11, `First name`
  at 30; Cancel `other` 63 / `button` 64, title `Create contact` 66, Save 68/69, More options 72/73 — all after. `First name` staged by a slow
  hand drag at `132,115 816x160` (centre (540,195) under the bar, 33 px showing below 242); 15:56:50 `tap { selector: 'text:"First name"' }` →
  `text:"First name" is under container (154,88 407x132) at its centre (540,195), drawn over it; only a 816x33 part of it shows, under the 65x65
  a tap may be moved to — scroll_until it first; nothing was tapped` (5.9 s). No `input tap 540 198`; IME stayed down. **Holds** (the cover
  named is the title's wrapper).
- **C3-6 (Android analogue) — Settings rows.** `tap text:"Battery"` → `input tap 286 540`, `text:"Storage"` → `293 782`, `text:"Security"` (near
  the bottom) → `297 1992`; each `Tapped …`, no "under". View-based rows are not affected. **But every Compose button tapped by its text is
  refused** (LOGIN, SIGN IN, DISCARD, Contacts' "No thanks") — see the new note.

## Device check (2026-10-09 iOS, re-run at dd50327)

Measured 2026-10-09 15:35–16:02 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47833, cwd mp-native, server restarted 15:52:36
for the launch-note items), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim.

**C3-1.1 tap at rest, idb — Holds, exact text.**

```
15:38:04 tap { platform: ios, selector: "id:swift_payment.form.priority_select" }                                 (1.1 s)
→ [isError] id:swift_payment.form.priority_select is under button "Continue to summary" (24,780 354x44) at its centre (201,797),
  drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

No `idb ui tap` in the shim for this call; `ui_snapshot { filter: 'id~"priority_sheet"' }` → no sheet.

**C3-1.2 `scroll_until … fully: true`, idb — Holds.**

```
15:38:12 scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }                           (5.0 s)
→ Element id:swift_payment.form.priority_select fully visible after 2 swipes; still moving at the last read (a fling not yet over,
  or an animated element?) — a rect or screenshot taken now may not match
```

Shim: `idb ui swipe 201 699 201 175 --duration 0.3`, then `201 175 201 437 --duration 0.3` (overshoot, then back). Next
`ui_snapshot`: `priority_select 24,611 354x52` (bottom 663 < 780). A repeat at 15:39:13 the same (2 swipes, row at `24,549`).

**C3-1.3 plain `scroll_until`, then tap, idb — FAILS the handoff's expectation, 2/2, through the out-of-scope top bar.** Form at
rest (row at 771):

```
15:38:28 scroll_until { selector: "id:swift_payment.form.priority_select" }                                         (3.0 s)
→ Element id:swift_payment.form.priority_select visible after 1 swipe — CLIPPED at top, 62% of it is in the viewport. A rect assert
  or screenshot on this element will measure the CLIPPED box
```

One stroke `idb ui swipe 201 699 201 175 --duration 0.3` carried the row 791 pt, from `24,771` to `24,-20` (centre 201,6). Screenshot
(`run7-ios/img-50-0.png`, the repeat at 15:38:52, identical reply and rect): the row is wholly hidden — the first thing below the
opaque top bar is "Payee's name". Then:

```
15:38:40 tap { selector: "id:swift_payment.form.priority_select" }  → Tapped id:swift_payment.form.priority_select     (1.3 s)
```

Shim: `idb ui tap 201 6` — iOS's status bar: the form scrolled back to the top (row at 771 again), no sheet. This is the note's
original §2 shape (the status bar / idb top bar is not a tree node, out of scope by the owner's decision, handoff §4), reached here
by the P3 stop rule: the centre (201,6) is on screen and nothing in the idb tree covers it, so the plain call stops after one
fling. The handoff's "stops only once the centre is above 780" holds literally; "the tap opens the sheet" does not, on idb, from
this rest position. With `fully: true` (C3-1.2) the scroll comes back and the tap opens the sheet:
`15:39:20 tap → Tapped id:swift_payment.form.priority_select`, shim `idb ui tap 201 575`, `priority_sheet.row_0 'Standard'` /
`row_1 'Express'` listed; closed by a grabber swipe, value unchanged.

**C3-1.4 moved tap, idb — Holds (and the 24 pt boundary measured).** Positioned with slow 2.5 s drags:

```
row 24,756 354x52 (24 pt above CONTINUE, centre 201,782)
15:40:06 tap { selector: "id:swift_payment.form.priority_select" }                                                  (1.3 s)
→ Tapped id:swift_payment.form.priority_select at (201,768) — its centre (201,782) is under button "Continue to summary"
  (24,780 354x44), drawn over it; tapped the uncovered part 354x24
```

Shim `idb ui tap 201 768`; the priority sheet opened (`row_0`/`row_1`), closed without choosing. At `24,758` (22 pt clear):

```
15:40:27 → [isError] id:swift_payment.form.priority_select is under button "Continue to summary" (24,780 354x44) at its centre
  (201,784), drawn over it; only a 354x22 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

No shim tap.

**C3-2 the same under WDA — Holds (steps 1–3), and 2 holds.** Scratch `cfg-swift-wda` (`treeSource: wda` +
`keyboardDismiss: [tap: { id: swift_payment.form.title }]`). WDA read the same geometry (`priority_select 24,771 354x52`,
`continue_button 24,780 354x44`).
- 1: `15:40:55 tap` → the same refusal text verbatim (`… (201,797) … only a 354x9 part …`), 3.2 s, no shim tap.
- 2: `15:41:04 scroll_until … fully: true` → `Element id:swift_payment.form.priority_select fully visible after 2 swipes` (9.6 s;
  `201 699 201 175`, `201 175 201 437`), row at `24,550 354x53`.
- 3: back at rest (771), plain `15:41:29 scroll_until` → `Element id:swift_payment.form.priority_select fully visible after 2 swipes`
  (9.3 s, the same two strokes) — **unlike idb**, WDA did not stop at y −20 after the first stroke; row at `24,552 354x53`;
  `15:41:41 tap` → `Tapped id:swift_payment.form.priority_select` (shim `idb ui tap 201 579`), the sheet opened, closed without choosing.
- C3-2.2 keyboard up (WDA `keyboard 0,572 402x302`, decimal pad on the amount): `15:44:22 tap id:swift_payment.form.fees_select` →
  `Tapped id:swift_payment.form.fees_select (the soft keyboard covered id:swift_payment.form.fees_select; hidden by tapping
  id:"swift_payment.form.title" before tapping)` (10.1 s; shim `201 84` then `201 639`, fees sheet `row_0..2` opened, closed
  unchanged); `15:44:42 tap id:BackButton` → `Tapped id:BackButton` (3.0 s, shim `44 84`, Account Detail). Both at their centre, no
  "under …" note.
- Also: with the keyboard up, WDA lists `continue_button 24,512 354x44` (the bar rides the keyboard) over `value_date_select
  24,545 354x52` — not exercised.

**C3-3 Back under a scrolled row, idb (interim rule) — measured: refused at 3 of 6 positions, all three false.** Form scrolled
with slow drags. The idb order is always: `container` root, `other 'Skeleton Internal' 0,0 402x874`, `button 'Back' BackButton
30,70 28x28`, `other 'SWIFT PAYMENT' swift_payment.form.title 136,74 130x20`, then the form rows in reading order (so every row is
"after" Back and the title). Rows overlapping 0–116 pt at each position (dumps `run7-ios/c33-pos*.txt`):

| pos | rows overlapping 0–116 (after Back/title in the dump) | `tap id:BackButton` | `tap id:swift_payment.form.title` |
|---|---|---|---|
| 1 (15:46:10) | `button 'CZK' 311,-53 49x44`, `text 'Amount*' 42,-47 51x15`, `textfield v='3.10' 0,0 0x0`, `button 'icon-cross-circle' 254,-41 20x20`, `textfield 42,27 318x20` + `text 'IBAN*' 42,27 46x20`, `textfield 42,95 318x20` + `text 'BIC*' 42,95 34x20` | **Tapped** at (44,84) (exit-confirmation dialog → Keep editing) | — |
| 3 (15:47:05) | IBAN `42,66 318x20` (+ text), `icon-cross-circle 254,-2`, BIC `42,134` | **Tapped** at (44,84) | — |
| 2 (15:46:36) | Amount `42,14 194x20` (+ `text 'Amount*' 42,1`), `icon-cross-circle 254,7`, CZK `311,-5 49x44`, IBAN `42,75 318x20` + `text 'IBAN*' 42,75 46x20` | **Refused:** `id:BackButton is under text "IBAN*" (42,75 46x20) at its centre (44,84), drawn over it; only a 12x20 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped` | — |
| 4 (15:47:28) | IBAN `42,82 318x20` + `text 'IBAN*' 42,82 46x20`, cross `254,14`, BIC `42,150` | **Refused:** `id:BackButton is under text "IBAN*" (42,82 46x20) at its centre (44,84), drawn over it; only a 28x12 part of it shows …; nothing was tapped` | **Refused:** `id:swift_payment.form.title is under textfield id:TextFieldWithComponentStyle (42,82 318x20) at its centre (201,84), drawn over it; only a 130x8 part of it shows …; nothing was tapped` |
| 5 (15:47:47) | IBAN `42,90 318x20` | — | **Tapped** at (201,84) (the tap blurred the amount and the form re-laid out: pos 6) |
| 6 (15:47:48) | CZK `311,25 49x44`, `text 'Amount*' 42,32`, amount `42,45 194x20` (v `3,10`), cross `254,37`, `text '1 117,90 will remain on your account' swift_payment.form.will_remain 42,80 206x15`, IBAN `42,128` | **Refused:** `id:BackButton is under text "1 117,90 will remain on your account" (42,80 206x15) at its centre (44,84), drawn over it; only a 28x10 part of it shows …; nothing was tapped` | — |

Screenshot at pos 2 (`run7-ios/img-126-0.png`): the top bar is opaque, Back and the title are drawn in full, IBAN is invisible
(the first field below the bar is BIC) — so every refusal above is false, and every tap above was right. The interim rule behaves
exactly as stated: a row whose top lies at or below Back's top (70) / the title's top (74) and that contains the centre is a
cover (pos 2, 4, 6); a row whose top lies above it is not (pos 1, 3: top 27 and 66), whatever it overlaps. These are the stated
"short row under a tall bar" residual, measured: a 15–20 pt row (a field's floating label, its textfield, a helper line) with its
top inside Back's 70–98 band refuses Back, ~28 pt of each scroll stroke's travel. No position put a top above 70 AND over the
centre with a real sheet, so the other residual (a sheet missed) was not exercised. None of the refusals sent anything (no shim tap).

**C3-6 Settings (SwiftUI list) — Holds; one correct refusal.** idb: `tap id:com.apple.settings.general` → `Tapped` (shim `201 319`),
`…standBy` (near the bottom, `16,709 370x52`) → `Tapped` (`201 735`), `…appearance` → `Tapped` (`201 475`), each pushed its page;
WDA (`cfg-set-wda`): `…siri` → `Tapped` (`201 203`), Back → `Tapped` (`38 84`). **Screen Time** `16,796 370x52` under the floating
search field `textfield 'Search' 28,808 346x28` (listed after it):

```
15:51:24 tap { selector: "id:com.apple.settings.screenTime" }                                                       (1.0 s)
→ [isError] id:com.apple.settings.screenTime is under textfield "Search" (28,808 346x28) at its centre (201,822), drawn over it;
  only a 370x12 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

Correct (screenshot `run7-ios/img-187-0.png`: "Search Time" — the cell's text shows through the search pill). Then plain
`scroll_until` → `Element id:com.apple.settings.screenTime fully visible after 1 swipe` (row at `16,264`), `tap` → `Tapped`
(`201 290`), Screen Time opened. A C3 true positive on a real app.

## Device check (2026-10-09 Android, re-run at 2f98900)

Measured 2026-10-09 18:09–18:33 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47841, cwd mp-native). Strokes and taps from the
`adb` shim; placement and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's `averi.yaml` untouched.

Round-5 C3-4, C3-5, C3-6 (Android) and round-6 B-2. Account Detail, tab-bar host `66,1840 948x248`.

- **C3-4.1 — Holds, `948x56` as expected.** Row staged by a slow hand drag: `row_3 66,1784 948x56`, its label node `other 'Loan repayment,
  25.06.2026, +162.00 EUR' 66,1784 948x143`. 18:20:02 `tap { selector: 'label:"Loan repayment, 25.06.2026, +162.00 EUR"' }` →
  `label:"…" is under container (66,1840 948x248) at its centre (540,1856), drawn over it; only a 948x56 part of it shows, under the 65x65 a
  tap may be moved to — scroll_until it first; nothing was tapped` (4.5 s). No `input tap`. (dd50327 said `948x48`: the LR avatar.)
- **C3-4.2 — Holds.** 18:20:14 plain `scroll_until` on the label → `Element label:"…" fully visible after 1 swipe` (7.6 s), `input swipe 540
  1616 540 942 675`; label at `66,1045 948x143`. No `PARTLY UNDER text "LR"`.
- **C3-4.3 — Holds.** 18:20:24 `fully: true` on the same, wholly on screen → `fully visible after 0 swipes` (2.1 s), no stroke (dd50327:
  timeout after 4 strokes).
- **C3-5 — Holds, the bar after the scroll view.** "Create contact": clipping container `0,242 1080x1912` at pre-order 11, `First name` 19;
  `other 'Cancel'` 84 / `button` 85, `text 'Create contact'` 87, `Save` 89/90, `More options` 93/94. `First name` staged at `132,122 816x160`
  (centre (540,202)), 18:24:39 `tap { selector: 'text:"First name"' }` → `text:"First name" is under container (154,88 407x132) at its centre
  (540,202), drawn over it; only a 816x40 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped`
  (5.4 s). No `input tap`; IME stayed down.
- **C3-6 (Android) — Holds for View rows and Compose text buttons; Fails for Compose icon buttons.** Settings (force-stopped, `launch_app`
  one line): `text:"Battery"` → `Tapped`, `input tap 286 574`; `text:"Storage"` → `293 816`; `text:"Security"` (near the bottom) → `297
  2026`; each opened its page. Compose text buttons: see the Compose-button note (all tapped). Compose icon buttons (`Cancel`, `Show list
  filters`) still refused — the Compose-button note, B-1.7.
- **B-2 — Holds (C3-4.1 and C3-5 above still refuse, naming the host / the title wrapper).** A labelled pinned CTA over a text in the same
  layout: **Not reached** — none on the screens visited (mp-native Account Detail, Welcome, "Logged out", SWIFT form and its exit dialog;
  Contacts list, sheets and editor; Settings). The Contacts editor's `Save` pill is in the top bar, over no text.

## Device check (2026-10-09 iOS, re-run at 2f98900)

Measured 2026-10-09 18:09–18:45 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native), mp-native's `averi.yaml`
untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim. Comparisons with `dd50327` ran on a scratch worktree
build of that hash on the same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags.

**C3-1.1 tap at rest, idb — Holds, exact text.**

```
18:13:1x tap { platform: ios, selector: "id:swift_payment.form.priority_select" }                                 (1.1 s)
→ [isError] id:swift_payment.form.priority_select is under button "Continue to summary" (24,780 354x44) at its centre (201,797),
  drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

No shim tap; no priority sheet.

**C3-1.2 `fully: true`, idb — Holds.** `18:13:24 scroll_until … fully: true` → `Element id:swift_payment.form.priority_select fully
visible after 2 swipes` (5.0 s), `idb ui swipe 201 699 201 175` then `201 175 201 437`; row `24,563` (bottom 615 < 780).

**T-1.1 (C3-1.3 again) plain `scroll_until`, then tap, idb — Holds (was: Fails as written at dd50327).** From rest (771):

```
18:13:39 scroll_until { selector: "id:swift_payment.form.priority_select" }  → Element … fully visible after 2 swipes  (5.0 s)
18:13:51 tap  → Tapped id:swift_payment.form.priority_select                                                          (1.3 s)
```

Strokes `201 699 201 175`, `201 175 201 437` — the scroll no longer stops with the row at −20 (centre in the status band): it turned back;
row `24,565`. Tap `idb ui tap 201 591`; `priority_sheet.row_0 'Standard'` / `row_1 'Express'` listed; closed by the grabber, unchanged.
No `idb ui tap` with y < 62 in the whole run except the hand probes below.

**T-1 the band refusal, idb (row placed by hand at `24,30 354x52`, centre (201,56)):**

```
18:14:3x tap { selector: "id:swift_payment.form.priority_select" }                                                  (1.2 s)
→ [isError] id:swift_payment.form.priority_select is under iOS's status bar at (201,56), in the top 62 pt of the screen, where a tap
  goes to the status bar (rect 24,30 354x52) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar;
  if not, no scroll moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap
  something else; nothing was tapped
```

No shim tap — the flat-list remedy wording exactly.

**T-1.2 under WDA — Holds (steps 1–3 and the band refusal).** Scratch `cfg-swift-wda`:
- at rest: `tap` → the C3-1.1 refusal verbatim (3.5 s), no shim tap;
- `scroll_until … fully: true` → `fully visible after 2 swipes` (10.3 s, `201 699 201 175`, `201 175 201 437`), row `24,637`;
- from rest (771, the form flung to its top by hand) plain `scroll_until` → `fully visible after 2 swipes` (9.6 s, the same two strokes),
  row `24,621`; `tap` → `Tapped id:swift_payment.form.priority_select` (shim `idb ui tap 201 648`), the sheet opened, closed unchanged;
- row at WDA `24,28 354x53` (centre (201,55)):
  `tap` → `id:swift_payment.form.priority_select is under iOS's status bar at (201,55), in the top 62 pt of the screen, where a tap goes
  to the status bar (rect 24,28 354x53) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing
  was tapped` — the WDA remedy wording exactly. At `24,41 354x53` (centre 68, below the band) → `Tapped …` at `201 68` — that point is the
  top bar's, and it scrolled the form to its top (no sheet): the top bar is out of scope (handoff §4).

**T-1.3 `fully: true` on a short row — Fails from a row resting in the band (NEW bug), holds from rest.** From rest: `fully visible after 2
swipes`, stopping well below the band (above). From the row at `24,20` (idb): `failed after 6 swipes (maxSwipes) — element reached the
viewport but stayed CLIPPED at top, 62% of it is in the viewport (last rect {"x":24,"y":-20,"width":354,"height":52})`, six `201 699 201
175`; plain → `failed after 5 swipes — its centre stays under iOS's status bar at (201,5) … try direction: "up" …`; WDA from `24,28` plain
→ `failed after 6 swipes (maxSwipes) — … its centre stays under iOS's status bar at (201,4) …`. `dd50327` from the same `24,20`:
`fully visible after 0 swipes`. `direction: "up", fully: true` from −20 (both builds) → six `201 175 201 699`, the row at 771 under
CONTINUE, `failed … (maxSwipes)`. Filed: `2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md`.

**T-1.4 the status bar's height against 62 pt — measured.** Screenshot (`img-50-0.png`, 1206×2622 px = 3 px/pt): the clock and the status
icons span y ≈ 24–40 pt; the top bar's Back circle starts at ≈ 62 pt; no drawn line between them. Hand taps at x 330 (beside the title, no
node there), each from the form scrolled by a hand drag, read by whether the form jumped to its top (`priority_select` 481 → 771):
`y 30` → top, `y 50` → top, `y 58` → **no** (2/2), `y 64, 70, 76, 84, 96, 106` → top; `(380,20)` → top (429 → 719, the animation read
mid-way). So the status bar's scroll-to-top takes y ≤ 50 at least; 58 took nothing; and the app's top bar (62–116) scrolls the form to
its top too — a tap there is no harmless tap either. One probe, `(330,116)`, hit IBAN's clear button (the IBAN emptied; no other effect).

**H-1 Back and the title under a scrolled row, idb — Holds at every position (9), no refusal.** idb order as in round 5: `container`,
`other 'Skeleton Internal'`, `button 'Back' BackButton 30,70 28x28`, `other 'SWIFT PAYMENT' swift_payment.form.title 136,74 130x20`,
then the form rows. At each position: `tap id:swift_payment.form.title` then `tap id:BackButton` (the exit dialog → `Tapped role:button
text:"Keep editing"`):

| time | rows overlapping 0–116 (all listed after Back/title) | over Back's centre (44,84) | over the title's centre (201,84) | title | Back |
|---|---|---|---|---|---|
| 18:19:0x | CZK `311,-25`, amount `42,0 194x15`, cross `254,-13`, `will_remain 42,30 213x15`, `text 'IBAN*' 42,72 35x15`, IBAN `42,85 280x20`, cross `340,78` | `IBAN*` (top 72) | — | Tapped `201 84` | Tapped `44 84` |
| 18:19:35 | the same +2: `IBAN*` `42,74`, IBAN `42,87` | `IBAN*` (top 74) | — | Tapped | Tapped |
| 18:19:51 | `Amount*` `42,-4`, amount `42,9`, `will_remain 42,44`, `IBAN*` `42,86`, IBAN `42,99` | — | — | Tapped | Tapped |
| 18:20:02 | `Amount*` `42,8`, amount `42,21`, `will_remain 42,56`, `IBAN*` `42,98`, IBAN `42,111` | — | — | Tapped | Tapped |
| 18:20:13 | `Amount*` `42,20`, amount `42,33`, `will_remain 42,68 213x15`, `IBAN*` `42,110` | — | — | Tapped | Tapped |
| 18:20:35 | `Amount*` `42,32`, amount `42,45 194x20`, `will_remain 42,80 213x15` | `will_remain` (top 80) | — | Tapped | Tapped |
| 18:20:46 | `Amount*` `42,44`, amount `42,57`, `will_remain 42,92` | — | — | Tapped | Tapped |
| 18:20:57 | debit `42,-93 318x104`, `Amount*` `42,56`, amount `42,69 194x20`, `will_remain 42,104` | amount (top 69) | amount (top 69) | Tapped | Tapped |
| 18:21:08 | debit `42,-81`, `Amount*` `42,68`, amount `42,81 194x20` | amount (top 81) | amount (top 81) | Tapped | Tapped |

Every tap at the centre (`201 84`, `44 84`). The three round-5 refusals' shapes (a floating label / helper line / textfield with its top
at 72–82 inside Back's 70–98) all tapped now.

**H-1 the bank-street field under CONTINUE — Holds where it is under CONTINUE's frame; a "Tapped" 3 pt below it PRESSED CONTINUE (NEW
residual, not filed separately).**
- Label at `42,807 186x20` (centre (135,817) inside CONTINUE `24,780 354x44`): `tap text:"Payee’s bank street & no."` → `… is under button
  "Continue to summary" (24,780 354x44) at its centre (135,817), drawn over it; only a 186x3 part of it shows, under the 24x24 a tap may be
  moved to — scroll_until it first; nothing was tapped`. No shim tap.
- Label at `42,817 186x20` (centre (135,827), 3 pt below CONTINUE's bottom 824): `18:21:3x tap text:"Payee’s bank street & no."` →
  **`Tapped text:"Payee’s bank street & no."`**, shim `idb ui tap 135 827` — and the app went to **SUMMARY** (`swift_payment.summary.title`,
  `swift_payment.summary.confirm_button 24,780 354x44` listed): the tap pressed CONTINUE. The screenshot at that position (`img-147-0.png`)
  shows nothing of the form below CONTINUE: the bar's opaque background runs from CONTINUE down to the screen's bottom and the label is
  hidden under it; CONTINUE's hit area reaches below its accessibility frame. idb lists no node for the bar's background, so the label reads
  "uncovered". Left with `tap id:BackButton` at once; CONFIRM never pressed. This is the original note's §2 shape (a tap "on" a row lands
  on the pinned bar), surviving where the bar's host is not a tree node.

**C3-2.2 keyboard up, WDA — Holds.** After keyboard prefs NO and a relaunch, `tap id:swift_payment.form.amount_input` (WDA `keyboard 0,572
402x302`):
- `tap id:swift_payment.form.fees_select` → `Tapped id:swift_payment.form.fees_select (the soft keyboard covered
  id:swift_payment.form.fees_select; hidden by tapping id:"swift_payment.form.title" before tapping)` (10.5 s, shim `201 84` → `201 639`),
  the fees sheet `row_0..2` opened, closed unchanged;
- `tap id:BackButton` with the keyboard up → `Tapped id:BackButton` (3.6 s, shim `44 84`), Account Detail.

**C3-6 Settings (SwiftUI list) — Holds.** idb: `tap id:com.apple.settings.general` → `Tapped` (`201 319`), `…standBy` (`16,709`, near the
bottom) → `Tapped` (`201 735`), `…appearance` → `Tapped` (`201 475`), each pushed its page (back by `Tapped role:button text:"Settings"`).
`…screenTime` under the floating search field → `id:com.apple.settings.screenTime is under textfield "Search" (28,808 346x28) at its centre
(201,822), drawn over it; only a 370x12 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`
(correct, as at dd50327). WDA (`cfg-set-wda`): `…siri` → `Tapped` (`201 684`), `BackButton` → `Tapped` (`38 84`).

**C3-6 idb on modals — Fails (NEW bug).** The payment-type chooser's rows are refused under idb (`… is under button "Loan repayment, …" …
nothing was tapped`), and `scroll_until` on the open value-date picker reads it `PARTLY UNDER button "Fees*, …" — 52% of it shows`. Filed:
`2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md`.

## Device check (2026-10-09 Android, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:19 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/`, stdio via the HTTP daemon on port 47851, cwd mp-native). Strokes and taps from the
`adb` shim (`run9-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only
(`cfg-opt-bank`, `cfg-opt-contacts`, `cfg-optional`, new `cfg-fill`, `cfg-fill-bank`); mp-native's `averi.yaml` untouched.

Round-5 C3-4, C3-5, C3-6 (Android), round-6 B-2, and round-6b R-3.1 / S-1.4 (Android). Account Detail, tab-bar host `66,1840 948x248`.

- **C3-4.1 — Holds.** Row staged by slow hand drags: `row_3 66,1793 948x47`, label `66,1793 948x143`. 20:48:20 `tap { selector:
  'label:"Loan repayment, 25.06.2026, +162.00 EUR"' }` → `… is under container (66,1840 948x248) at its centre (540,1865), drawn over it;
  only a 948x47 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped` (6.0 s). No `input tap`.
- **C3-4.2 / S-1.4 — Holds, 1 stroke as in round 6.** 20:48:53 plain `scroll_until` on the label → `fully visible after 1 swipe` (10.3 s),
  `input swipe 540 1617 540 949 669`; label after `66,1201 948x143`. No new turn.
- **C3-4.3 — Holds.** 20:49:04 `fully: true`, wholly on screen → `fully visible after 0 swipes` (2.8 s), no stroke.
- **C3-5 — Holds.** "Create contact", IME up (phone field focused), `First name` staged at `132,135 816x160`. 21:05:03 `tap text:"First
  name"` → `text:"First name" is under container (154,88 407x132) at its centre (540,215), drawn over it; only a 816x53 part of it shows
  above the soft keyboard, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped` (6.2 s). No `input tap`.
  (The 53 = 242 − 295: the app bar's own 0..242 background counts too.)
- **C3-6 (Android) — Holds.** Settings (`terminate_app` + `launch_app`, one line): `text:"Battery"` → `input tap 286 870`, `text:"Storage"` →
  `293 1112`, `text:"Security"` (near the bottom, after `scroll_until` 1 swipe `540 1736 540 484 1254`) → `297 1192`; each page opened
  (`collapsing_toolbar` labelled so). (Rows sit 296 px lower than in round 6: the homepage was scrolled differently.)
- **B-2 — Holds** (C3-4.1, C3-5 still refuse, naming the host / the title wrapper). Pinned labelled CTA over a text: Not reached.
- **R-3.1 — Holds.** SWIFT form, nothing entered: 20:45:03 `run_flow back_to_tab_host` → `tap: id:"common.top_bar.back"` / `wait: element
  id:"nav.tab_transactions"` / `done` / `appAlive: true` (11.1 s), `input tap 77 154`, Account Detail. On the tab root, 20:45:22 → `optional:
  skipped id:"common.top_bar.back" (not present)` / `wait …` / `done` (5.2 s), no tap.
- **New, Android — a tap on a sliver at the scroll container's edge is "Tapped" and does nothing:** SWIFT form at rest,
  `details_toggle` reads `66,1924 948x55` (cut by the container's bottom 1978, its button `66,1936 948x42`). `tap
  id:swift_payment.form.details_toggle` → `Tapped …` (20:51:20 and 20:52:50), `input tap 540 1952` — the section did not expand; the same
  tap with the toggle wholly on screen (`66,1793 948x132`) → `540 1859`, expanded. Hand taps at `540 1930`, `540 1940`, `970 1970` also did
  nothing. **New note: `2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md`.**

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**P-1.1/1.2 — Holds (fixed).** `Payee’s name` label at `42,825 103x20` (centre (94,835), 11 pt below CONTINUE's bottom 824):

```
20:47:02 tap { platform: ios, selector: 'text:"Payee’s name"' }                                                       (1.2 s)
→ [isError] text:"Payee’s name" is under button "Continue to summary" (24,780 354x44) at its centre (94,835), drawn over it; nothing of it
  shows — scroll_until it first; nothing was tapped
```

No shim tap, no SUMMARY (round 6 at 817: `Tapped`, SUMMARY opened). The reply quotes CONTINUE's frame with the centre below it (known).
`scroll_until` the same label → `fully visible after 1 swipe` (`201 699 201 175`), label at `42,116`. Under WDA the same label at
`42,837` is refused too, but naming the field's own `container "Horizontal scroll bar, 1 page" (42,844 318x10)` — see the NEW WDA note.

**P-1.3 the strip below a lifted bar — measured: it PRESSES CONTINUE (the inference holds).** CONTINUE enabled (form valid), QWERTY up on
BIC, CONTINUE `24,513 354x44` (bottom 557), keyboard band `other 0,590 402x284` (drawn top ≈572 pt in `img-185-0.png`). Hand tap
`idb ui tap 201 566` (20:54:14, `manual.log`) → **SUMMARY opened** (`swift_payment.summary.title`, `confirm_button 24,780 354x44`); left at
once with `tap id:BackButton` (20:54:20, form back). So the lifted bar's hit area reaches below its frame, as `bottomPinned` infers.

**H-1 (round-6 checklist) — Holds, 5 positions.** Rows overlapping Back (30,70 28x28)/title, all listed after them: `IBAN*` top 39/64/89,
IBAN textfield `42,52/77/102`, `will_remain 42,22/47/72/97`, amount textfield `42,0 194x7`/`42,12`/`42,37`/`42,62`, `currency_select
311,-33/-8/17/42`, `debit_select 42,-100 318x104`: every `tap id:swift_payment.form.title` → `Tapped` (`201 84`), every `tap id:BackButton`
→ `Tapped` (`44 84`) → the exit dialog → `Keep editing`.

**C3-6 Settings (idb) — Holds.** `…screenTime` → `under textfield "Search" (28,808 346x28) … only a 370x12 part …` (as round 6);
`…standBy` → `Tapped` (`201 735`); `role:button text:"Settings"` → `Tapped` (`38 84`); `…general` → `Tapped` (`201 319`);
`…general.languageAndRegion 16,790 370x52` (near the bottom, nothing pinned) → `Tapped` (`201 816`). Under WDA Settings' sub-page rows are
falsely refused — NEW WDA note.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**C3-4 and O-2 on the floating tab bar's host — Hold.** mp-native Account Detail, one slow drag (`input swipe 540 1500 540 1370 3000`).

- At rest the row behind the bar (`row_3`, ~1892) is absent from the dump; staged, `row_3 66,1784 948x143 cutBounds=66,1784 948x56` (A1's
  widening; its texts dumped 8–9 px tall). `tap id:row_3` → `id:"transactions.list.row_3" is under container (66,1840 948x248) at its centre
  (540,1856), drawn over it; only a 948x56 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was
  tapped` (round 6b quoted `948x47`, the dump's own cut). No shim tap.
- `row_4 66,2044 948x143 cutBounds=66,2088 948x99` (cut at its top by the host's bottom) → `Tapped`, `input tap 540 2116`, the right
  transaction opened.
- `scroll_until row_3 fully` → `fully visible after 1 swipe`, `input swipe 540 1616 540 942 675` (round 6b `540 1617 540 949 669`).
- O-2 (`cfg-opt-bank` `o2_row_under_bar`, optional `tap label:"Loan repayment, 25.06.2026, +162.00 EUR"`) → `optional step not skipped:
  its element is present, but the tap was refused — … under container (66,1840 948x248) … only a 948x56 part of it shows …; nothing was
  tapped`, the wait did not run; `ensure_state o_never` (`reach: [rung_refused, rung_harmless]`) → fails at rung 1 with the same text, only
  `flow rung_refused` ran.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**P-1, H-1, T-1 (re-run) — Hold.**
- P-1 `Payee’s street` label `42,833 103x20` (between CONTINUE's bottom 824 and 874) → `text:"Payee’s street" is under button "Continue
  to summary" (24,780 354x44) at its centre (94,843), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped`
  (06:22:09); no SUMMARY. `My note` `42,785` under CONTINUE: the same under WDA and idb.
- H-1 fees row at `24,27`, priority at `24,95`: `tap id:swift_payment.form.title` → Tapped `201 84`; `tap id:BackButton` → Tapped `44 84`.
- T-1 `value_date_select` at `24,30` → `… is under iOS's status bar at (201,56), in the top 62 pt of the screen, where a tap goes to the
  status bar (rect 24,30 354x52) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, no scroll
  moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap something else; nothing
  was tapped` (06:38:03).
- Pixel asserts do not share these covers — NEW note `2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md`.


## Device check (2026-10-13 Android, re-run at 20307d2)

Measured 2026-10-13 17:10–17:58 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation — `settings get secure
navigation_mode` = 2, `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true`; Gboard docked unless stated), averi = mobile-verify
`arch/round-12` @ `20307d2` (detached; `dist/` built 17:07 UTC after the commit; stdio via the HTTP daemon on port 47881, cwd mp-native).
Strokes, taps and keys from the `adb` shim (`run12-android/adb-input.log`, times UTC); stagings by hand with the real `adb` (slow `input
swipe` drags, not in the shim log). Every call is in `run12-android/session.log` (`#N` below = call number there; images `img-N-0.png`).
At start mp-native showed the inactivity "Logged out" screen: LOGIN → Welcome → SIGN IN → `run_flow login_pin_android_here` (approved rung,
no `requires:`), done at 17:11. Scratch configs only; mp-native's `averi.yaml` untouched. Round 9's §3–4, round 10's §2–3, round 11's §3
and round 12's §3 were all run at this one hash. **Environment break at 17:33 UTC:** mp-native's backend began answering every GraphQL read
with `{"data":null,"errors":[{"message":"Received empty response body from subgraph \"gds-business\"","extensions":{"code":
"SUBGRAPH_RESPONSE_BODY_EMPTY"}}]}` (HTTP 200, `get_logs` #161, #180) — "Mandatory data not loaded / TRY AGAIN" on every tab, also after a
fresh PIN login (#223, 17:43). Not averi, not the VPN (no 403). The mp-native items not run before 17:33 (SWIFT form: A2, D1.2, smoke 1's
SWIFT field, D7.3) are Not reached on mp-native; on the owner's instruction (17:51) they were re-run on Google Contacts and on Finportal
(`sk.finportal.myport`, Expo dev build on Metro; its `~/dev/finportal/app/averi.yaml` passed as `configPath`; never logged in, nothing
submitted) where an equivalent shape exists — see `## Re-runs on Contacts / Finportal` below. The data also changed since round 8:
Account Detail now lists `row_0`…`row_36` (37 rows, was 31), so the handoffs' `row_29/30` / `row_30` shapes were measured on the rows that
now sit there (`row_35/36`).

Round 9 §3.2 (floating tab bar) — **Holds.** With the bar shown (slow drags; it hides on a fling) and the list at its end: `row_35 66,1765
948x143 cutBounds 66,1765 948x75` (cut at the host's top 1840) and `row_36 66,2025 948x143 cutBounds 66,2088 948x80` (cut at the host's
bottom 2088) — the only rows at the bar carrying `cutBounds`; `row_31`…`row_34` none; `row_30 66,465 cutBounds 66,480 948x128` is the sticky
header's (expected). At rest at the top `row_5 cutBounds 66,1725 948x115` and `row_7 cutBounds 66,2088 948x104` likewise. #38 `tap
id:transactions.list.row_36` (visible part 2088–2154 between host and navigation bar) → `Tapped`, `17:16:21 input tap 540 2097`, the right
detail opened. (`row_36 cutBounds` runs 14 px into the navigation bar — `cutBounds` cuts at the host only; the tap point is clear of the bar.)


## Device check (2026-10-13 iOS, re-run at 20307d2)

Measured 2026-10-13 17:10–17:37 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless, the only booted simulator), averi = mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port
47883, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`); scratch configs in `run12-ios`: `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy), plus `keyboardDismiss` variants `cfg-wda-title.yaml` (`tap: {id: swift_payment.form.title}`),
`cfg-wda-payee.yaml` (`label: "Payee’s name"`), `cfg-wda-iban.yaml` (`label: "IBAN*"`), `cfg-wda-iban-title.yaml` (IBAN*, then the
title), `cfg-wda-contacts.yaml` (`text: "New Contact"`). `idb` PATH shim logging every `idb ui tap|swipe|text|key` (`idb-calls.log`;
PIN-pad lines 7–10 and 34–37 are the two `login_pin_ios_here` runs, not quoted). Positions set by hand with slow `idb ui swipe …
--duration 2.5` drags at x 380 (`manual.log`). The software keyboard was raised by setting `com.apple.keyboard.preferences`
`AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching mp-native (17:18:37); both restored to 1 at
17:36:59. mp-native logged in twice by the owner-approved `login_pin_ios_here` (17:12:19 after Account Detail showed "That's an
error" on every reload; 17:18:49 after the prefs relaunch), never the `login` rung. WDA started by averi on the first `cfg-wda` call
(17:13:44, port 8100) and stopped at 17:37 (xcodebuild killed, port 8100 closed). Local web pages `www/a.html` (link to B) and
`www/b.html` (60 links) served on 127.0.0.1:47891, stopped 17:33:05. Note: the SWIFT form's layout differs from round 8 (at rest
`priority_select 24,681` — clear of CONTINUE — not `24,771`), so the "`priority_select` under CONTINUE" shape was rebuilt with
`payee_country_select` dragged to `24,775`; the handoff's status-band shape `24,-20` was reached by `priority_select` itself.

**D1 / slices 1, 3, 4 (round 10) and smoke 2 (round 11) / smoke 3 (round 12), iOS.**
- **Slice 1 (CONTINUE), idb — Holds.** `payee_country_select 24,775 354x52` (stand-in for `priority_select`, see header): 17:14:49 `tap`
  → `… is under button "Continue to summary" (24,780 354x44) at its centre (201,801), drawn over it; only a 354x5 part of it shows, under
  the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`; 17:14:51 `scroll_until` → `fully visible after 1 swipe`
  (l.20 `201 699 → 201 175`, row `24,304` — round 6 S-1.4's numbers).
- **Slice 1, WDA — Holds.** Same row at `24,776`: 17:15:41 `tap` → `… at its centre (201,802), drawn over it; only a 354x4 part of it
  shows …; nothing was tapped` (2.9 s); 17:15:43 `scroll_until` → `fully visible after 1 swipe` (6.0 s; l.22, row `24,304`).
- **Slice 3 (status bar) — Holds.** `priority_select 24,-20 354x52`, idb, 17:15:20 `tap` → `id:swift_payment.form.priority_select is
  under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 24,-20 354x52) — if
  it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, no scroll moves it out: …; nothing was
  tapped`. WDA web link `32,27 133x28` (Safari): `… under the status bar at (99,41) … — it lies in a scroll view — scroll_until it first,
  to move it out from under the bar; nothing was tapped`.
- **Slice 4 (row at `24,-20`) — Holds.** 17:15:21 plain `scroll_until` → `fully visible after 1 swipe` (l.21 `201 175 → 201 437`, row
  `24,530`) — round 6/5e5a3d1 shape (`after 1 swipe`, row `24,570`).
- **Smoke 4 (round 11) off-screen tap, idb — Holds.** 17:34:25 `tap label:"My note"` → `label:"My note" is off screen at (72,1102) on a
  402x874 screen (rect 42,1092 60x20) — scroll_until it first; nothing was tapped`.
- **Round-10 smoke idb (Account Detail).** `tap id:transactions.list.row_3 (24,721)` → `… is under button "Cards" (201,755 82x64) at its
  centre (201,747), drawn over it; only a 354x21 part of it shows, …; nothing was tapped` (round 8 C1.1 verbatim); `nav.tab_transactions`
  → `Tapped` (l.1 `160 787`), `nav.tab_home` → `Tapped` (l.2 `78 787`); colour `available_balance` → `PASS … sampled #EDEFF2 (dominant,
  69% of region) … dE00 0.00`. `scroll_until id:transactions.list.row_3` (17:12:38) → `failed after 5 swipes (the last 2, swiping up, did
  not move it: content exhausted, or the swipes were not taken) — element was in the viewport before the first swipe but did not stay
  (a fling?) — in tree, off the 402x874 viewport at the last read (last rect {"x":24,"y":-503,…}). It was turned round 1 time …` — see
  Gaps (the list scrolls now; round 8 measured it static).
- **Round-10 smoke WDA.** `row_3` → same refusal, centre `(201,748)` (10.5 s, cold WDA); `nav.tab_cards` → `Tapped` (l.16 `242 787`);
  colour `action_pay` → `PASS … sampled #3F3F50 (dominant, 96% of region) … dE00 0.00` (3.5 s); `scroll_until` = slice 1 above.


## Device check (2026-10-14 iOS, re-run at d407256)

Measured 2026-10-14 22:05–22:27 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; the only
booted simulator), averi = mobile-verify `arch/round-13` @ `d407256` (`dist/`, stdio via the HTTP daemon on port 47893, cwd
mp-native; `git rev-parse --short HEAD` printed `d407256`). mp-native's `averi.yaml` untouched (default `treeSource: idb`). Scratch
configs in `run13-ios`: `cfg-wda.yaml` (`treeSource: wda`), `cfg-wda-title.yaml` and `cfg-wda-iban.yaml` (copied from round 12:
`keyboardDismiss` `tap {id: swift_payment.form.title}` / `label "IBAN*"`), and Finportal's `fp-cfg.yaml` (= `~/dev/finportal/app/averi.yaml`,
`treeSource: wda`) with the round-12 variants `fp-title`, `fp-wrappers`, `fp-wrappers-title`, `fp-label`. The `idb` PATH shim logged
every `idb ui tap|swipe` to `idb-calls.log` (53 lines). Lines 34–37 are the `login_pin_ios_here` PIN pad and are not quoted. WDA
(port 8100) was started by averi on the first `cfg-wda`/`fp-cfg` call (xcodebuild pid 59210, 22:06:04). It was stopped at 22:27:12
(xcodebuild killed, 8100 closed). The software keyboard was raised by setting `com.apple.keyboard.preferences`
`AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false at 22:08 and relaunching Finportal, then Contacts, then mp-native.
Both prefs were restored to 1 at 22:26:50. Local pages `www/a.html`/`b.html` were served on 127.0.0.1:47895, not 47891, which is the
Android agent's port; the server was stopped at 22:19:24. One manual slow drag (`idb ui swipe 380 600 380 440 --duration 2.5`, shim
l.32, `manual.log`) set up W.2. mp-native showed "That's an error" on Home/Account Detail at 22:19, and TRY AGAIN (l.33) did not
help. I terminated and launched it, saw the PIN prompt ("Enter your PIN to log in", `img-122-0.png`), and ran `login_pin_ios_here`
once (22:20:36, `branch: matched state logged_in`). That was its only login; the `login` rung was never run. Finportal was never
logged in, nothing was submitted, and its language stayed English. Metro on :8081 was left alone.

**R-added W.2 (web link under the status band): holds, verbatim as round 12.** Safari, local page B dragged by hand so that `Link
number 1` lies at `32,37 133x28` (`W2-wda-b-scrolled.json`). 22:19:12 `tap role:text label:"Link number 1"` (`cfg-wda`) → `role:text
label:"Link number 1" is under the status bar at (99,51), in the top 62 of the screen (tree units), where a tap goes to the status bar
(rect 32,37 133x28) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped` (2.4 s,
#112). The shim count was 32 before and after.


## Device check (2026-10-14 iOS, re-run at e1384aa)

Measured 2026-10-14 06:55–07:12 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It
was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-14` @
`e1384aa` (`dist/`, stdio via the HTTP daemon on port 47903, cwd mp-native); `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed
`e1384aa` (read-only). **Daemon restart:** my first call (`c __list` with no second argument) crashed the provided daemon. `call.sh`'s
default `${2:-{\}}` sends the body `{"name":"__list","args":{\}}`, and `daemon.mjs` has no guard around `JSON.parse` (`daemon.out`). I
restarted it the way the Android daemon had been restarted at 06:55:08: `node daemon.mjs run14-ios` from `averi-repo`, `AVERI_PORT=47903`,
`run14-ios/shim` first on `PATH`. The new session connected at 06:55:29. Every later call passed explicit JSON args. Call numbers below
are from that session, and the whole log is in `session.log`. I pinned the device with `select_device` (#2).

mp-native's `averi.yaml` was not touched (default `treeSource: idb`). The scratch configs are in `run14-ios`:
- `cfg-wda.yaml`: copied from `run13-ios`; it differs from mp-native's `averi.yaml` only by `treeSource: wda`.
- `fp-cfg.yaml`: copied from `run13-ios`; `diff` with `~/dev/finportal/app/averi.yaml` is empty (`treeSource: wda`).

The idb shim logged 53 lines to `idb-calls.log`. Lines 17–20 are the `login_pin_ios_here` PIN pad and are not quoted. Lines 7, 24, 28,
32, 36 and 41 are `ui text` from my dummy typing. WDA (port 8100) was started by averi on the first `fp-cfg` call (#5, 06:55:57,
xcodebuild pid 95058). I stopped it at 07:12:23 by killing the xcodebuild; WDA pid 95061 exited and 8100 closed. The keyboard prefs were
**not changed**: `AutomaticMinimizationEnabled = 1` and `HardwareKeyboardLastSeen = 1` before and after, and no item needed the software
keyboard. **One PIN re-login:** the SWIFT form showed "That's an error" at 07:04:37 (`img-52-0.png`). I terminated and launched the app
(no clearState) and saw the PIN prompt ("Enter your PIN to log in", `img-56-0.png`, #57). I read `login_pin_ios_here` in `averi.yaml`: it
has no `requires:`. I ran it once (#58, 07:05:09, `branch: matched state logged_in`). The `login` rung was never run, and nothing
registered. Raw WDA trees were captured session-less with `curl http://127.0.0.1:8100/source?format=json`; `/status` showed `"sessionId" :
null`, WDA 16.1.7. Local pages were served on 127.0.0.1:47905 from 07:11:5x and stopped at 07:12:14. Metro on :8081 (pid 88312) was
left running. I did not touch the Android emulator, adb or port 47901.

**A.4 smoke, Safari local page (WDA): holds.**
- `open_deep_link http://127.0.0.1:47905/a.html` (#106).
- `tap role:other label:"Go to page B"` → `Tapped role:other label:"Go to page B"` (#107, l.52 `94 219`). Page B loaded.
- `tap role:text label:"Link number 11"` → `Tapped role:text label:"Link number 11"` (#108, l.53 `104 761`). The link shows as visited,
  and the page did not move under the capsule bar (`img-109-0.png`). Nothing was refused under `CapsuleViewController`.


## Device check (2026-10-14 Android, re-run at ebe6822)

Round 16 Android device check, 2026-10-14 17:07:57–17:21:08 UTC, emulator-5554 (Pixel_3a AVD, Android 13 / API 33, 1080x2220, gesture navigation, `navigation_mode` = 2 before and after). averi built from `~/dev/mobile-verify` `arch/round-16` at `ebe6822`, checked with `git rev-parse --short HEAD` → `ebe6822` (read-only, detached), daemon on port 47911 via `$R/c`. Apps: mp-native `com.finshape.skeleton.dev` (first, already logged in by the owner, on Account Detail), Google Clock `com.google.android.deskclock`, Settings `com.android.settings`. **No PIN re-login was needed:** mp-native stayed logged in for the whole run. No `ensure_state`/`run_flow`, no `login` rung, no registration, no credentials typed, no `clearState`. **Backend: working.** Account Detail loaded balances (1,121.00 CZK / 2,000.00 CZK, "Account 1 of 4") and a full transaction list. Two transaction details opened with data. The SWIFT form loaded the debit account. No "Mandatory data not loaded" screen appeared. Calls #2–#92 are in `session.log`. The shim log `adb-input.log` has 66 lines, and every line cited below is quoted from it.

**R15 D.1: row under the floating tab bar. Holds.** Account Detail was nudged with slow coordinate swipes (shim `17:08:57 input swipe 540 1500 540 1440 800`, `17:09:26 … 540 1415 800`, `17:09:40 input swipe 540 1400 540 1452 800`) until `transactions.list.row_3` was at `66,1819 948x143`, its centre (540,1890) under `nav.tab_cards` (tab bar top 1876) (`acct4.txt`, #12). #13 `tap id:transactions.list.row_3` →
`id:transactions.list.row_3 is under container id:nav.tab_cards (540,1876 219x176) at its centre (540,1891), drawn over it; only a 948x21 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped`
The reply has no "wrapper may only position" FAB hint. No shim `input tap` came between `17:09:40` and the next call. (The visible part is 21, not the 57 between 1819 and the bar: the list clips its content from y 1840. `sticky1.txt` carries `cutBounds` ending at 1840 (`66,1802 948x38`) and starting at 2088 (`66,2088 948x19`) around the bar's host.)
- When the row lay wholly in that clip band (acct1 #4, acct2 #8), `row_3` was **absent from the tree**: `tap id:transactions.list.row_3` (#5) timed out with `Timed out after 5000ms waiting for element id:transactions.list.row_3 to appear`. The app does not dump the node, so averi has nothing to judge (see Gaps).

**R15 D.2 sticky header (round 8 §3.1 / round 9 §3.1). Holds, identical to round 8.**
- After one long swipe (shim `17:10:56 input swipe 540 1700 540 1000 1500`), `row_0` was at `66,401 948x82` with `cutBounds 66,480 948x3` under sticky `date_header_0 (0,401 1080x79)` (`sticky1.txt` #23). #25 →
  `id:transactions.list.row_0 is under container id:transactions.list.date_header_0 (0,401 1080x79) at its centre (540,442), drawn over it; only a 948x3 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped` (no shim tap).
- A nudge down (shim `17:11:34 input swipe 540 1000 540 1106 1000`) produced the round-8 shape: `row_0 66,425 948x143`, `cutBounds 66,480 948x88` (`sticky2.txt` #27). #28 `tap id:transactions.list.row_0` → `Tapped id:transactions.list.row_0`, shim `17:11:49 input tap 540 497`. That is the row's centre (496.5), 17 px below the header's bottom edge, so the tap was not moved. This is the same coordinate round 9 recorded (`input tap 540 497`), and the transaction detail (+602.00 EUR) opened (`sticky_tapped.txt` #30). Back: shim `17:12:06 input keyevent 4`.
- #33 `scroll_until id:transactions.list.row_0 fully:true` → `Element id:transactions.list.row_0 fully visible after 1 swipe` (7.6 s), one stroke `17:12:09 input swipe 540 765 540 1311 547`. Afterwards the row was at `66,1040 948x143` under `date_header_0 0,942` (`sticky3.txt` #34).
