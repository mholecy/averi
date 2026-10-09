# BUG: `tap` on an element below the screen's bottom edge sends the tap off screen and reports "Tapped"

> **Status (2026-10-08):** fixed on branch `fix/p2-tap-off-screen` (two commits: the refusal, then the review round); unmeasured on a device: the refusal on the SWIFT form (`tap { selector: 'text:"Payee’s street"' }` should now fail `… is off screen at (94,895) on a 402x874 screen … — scroll_until it first; nothing was tapped`, and `scroll_until` then `tap` should focus the field), the 0×0 hint on a field scrolled above the top, a landscape tap and `scroll_until` (the box is turned from the tree's window; never measured sideways), and a fold/unfold mid-session. The fix: every tap on a resolved node (`tap`, a flow `tap:`, the fill's focus tap) goes through `interact/keyboard.ts#resolveClearOfKeyboard`, which refuses — `resolve.ts#refuseOffScreen`, an `OffScreenRefusal`, nothing sent — a node whose centre lies off the screen (`resolve.ts#onScreen` over `swipe.ts#screenBox`: the device's `viewport()`, turned for landscape; a witnessed box counts as it is, a turn suggested by a window's own sides or a walked width but not witnessed counts either way up, anything else is judged on the panel as built — a landscape idb tree with no window at all among it, a stated loss; the size is read again before any refusal), before the keyboard is asked and again on the node a guard that acted hands back (that refusal leads with what was sent); a partly visible node is tapped at its centre when that is on screen, refused otherwise with `scroll_until … fully: true` as the remedy; no screen box and no root rect → the tap as before. `scroll_until` judges its stop on the same box. The keyboard dismissal picker asks the same `onScreen`. A never-found wait whose last tree matched the selector only at 0×0 adds `(it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first)` beneath the headline. Scrolling the target in automatically was not done (the note's second direction): it scrolls a screen the caller did not ask to scroll. Follow-up, not done: with several matches the resolution policy (`resolveNow`, pure, no screen) does not prefer an on-screen match over an off-screen duplicate (an RN bottom sheet parked below the fold); such a pick is now refused rather than tapped off screen, so the failure is loud, but the on-screen twin is not chosen.

**Measured 2026-10-08 16:38–16:39 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`), SWIFT payment form (branch `feature/swift-payment`), iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify @ `c35388a` built from source.

## Observed (measured)

idb lists the form's lower fields with their real (scroll-content) rects even when they are below the screen:

```
ui_snapshot { filter: 'text:"Payee’s street"' }
→ [{"role":"text","label":"Payee’s street","identifier":"TextFieldWithComponentStyle","value":null,
    "rect":{"x":42,"y":885,"width":103,"height":20}}]          ← y 885 > screen height 874
```

```
16:38:39  tap { selector: 'text:"Payee’s street"' }      → Tapped text:"Payee’s street"        (1.4 s)
16:39:00  tap { selector: 'text:"Payee’s bank city*"' }  → Tapped text:"Payee’s bank city*"    (1.4 s)
          (rect {"x":42,"y":1157,"width":136,"height":20})
```

Both times the screenshot afterwards is unchanged (the amount field kept focus, no field below the fold was focused, the
form did not scroll). The tap point (centre: y 895, y 1167) is outside the 874-pt screen. The numeric keypad was up
during both calls; that does not matter here — the point is below the screen, not on the keypad.

(Nodes scrolled ABOVE the top come back from idb as 0×0 and are skipped by the zero-area rule — then `tap`/`type_text`
time out "waiting for element … to appear" though the node is in the tree. Not filed; noted for the same fix.)

## Why (read from the source)

- `src/interact/tap.ts:35–37`: `tapElement` resolves the node (`resolveClearOfKeyboard`), takes `tapPoint(node)` and
  calls `adapter.tap(point.x, point.y)` — no check that the point lies on the screen.
- `src/interact/resolve.ts` (the one resolution policy, ~:136): zero-area nodes are dropped; rects outside the
  viewport are not.
- The check exists elsewhere: the dismissal picker refuses a strategy `off screen at (x,y)` "inside the root's rect"
  (docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md stage B, `interact/keyboard-in-tree.ts#pickDismissal`), and
  `scroll_until` judges visibility against `adapter.viewport()` (`interact/scroll.ts:119`). The tap target itself is
  not judged.

## Why it matters

The reply "Tapped …" is the only evidence an agent has; a selector that matches a field below the fold reads as a
successful focus, and the next `type_text` without selector types into whatever still has focus (here the amount
field). In a flow the `tap:` step passes and the failure surfaces steps later.

## Possible fix directions (owner's choice)

- Refuse a target whose tap point lies outside `adapter.viewport()` (or the tree root's rect): `id:x is off screen at
  (63,895) on a 402x874 screen — scroll_until it first`; nothing sent.
- Or scroll it into view first (the `scroll_until` machinery exists) and say so in the reply.
- Word the zero-area timeout the same way when the selector matched only zero-area nodes: "found, but 0×0 (scrolled off
  screen)".

## Repro

1. iOS, idb, a scroll view whose content extends below the screen (mp-native SWIFT form).
2. `ui_snapshot { filter: <selector of a node below the fold> }` → rect y + h/2 > screen height.
3. `tap { selector }` → `Tapped …`; screenshot unchanged.

## Device check (2026-10-08, re-run at e9e6509): Android part

Emulator-5554 (Pixel_3a AVD, Android 13), mp-native SWIFT/SEPA form. The off-screen refusal itself is **not measurable on
this Android app**: uiautomator never lists Compose nodes below the fold (the raw `uiautomator dump` holds only the
on-screen fields), so a below-the-fold selector times out before any rect is judged:
`tap { selector: "id:swift_payment.form.payee_street_input" }` → `Timed out after 5000ms waiting for element … to appear`
(no 0×0 hint either: no 0×0 node exists on Android here). Confirmed: a partly visible node (`iban_input` clipped to
`{y:242,height:23}` under the top bar, centre on screen) was tapped at its centre and focused; no visible element was
wrongly refused in any of the ~20 portrait taps of the run nor in landscape (`tap id:nav.tab_home` at ROTATION_90, 2220x1080 → `Tapped`).


## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:06–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
(`feature/swift-payment`), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). **Confirmed fixed** (default idb):

- `tap { selector: 'text:"Payee’s street"' }` → `text:"Payee’s street" is off screen at (94,895) on a 402x874 screen (rect
  42,885 103x20) — scroll_until it first; nothing was tapped`; `tap text:"Payee’s bank city*"` → `… off screen at
  (110,1167) …`. Screenshot unchanged.
- `scroll_until text:"Payee’s street" fully` → `fully visible after 1 swipe`; `type_text` on it then landed (field value
  `Hauptstrasse 1`).
- Above the top: the amount input scrolled off came back `0 0 0 0`; `tap { selector: 'role:textfield value~"000,00"' }` →
  `Timed out after 5000ms waiting for element … to appear` + `(it matched only 0×0 nodes (scrolled off screen, or
  collapsed) — if it is in a scroll view, scroll_until it first)`. Its label (still listed at y -77) → `text:"Amount*" is off
  screen at (68,-69) … nothing was tapped`.
- Partly visible node (`priority_select` at y -20 h 52, centre y 6) was tapped at its centre, as designed. Note: that
  point is iOS's status bar — the tap scrolled the form to the top (status-bar scroll-to-top) instead of opening the
  select. The centre is "on screen" but covered by system/app chrome; see
  [2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md).
- No visible element was wrongly refused in ~45 portrait taps (idb and WDA). Landscape not measured (headless simulator,
  no rotation available).

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

**Holds** (on Contacts — the SWIFT `Payee’s street` repro was not reachable):

- idb, Contacts sheet at the top: `tap { selector: 'role:button label:"add to list"' }` → `role:button label:"add to list" is off
  screen at (201,1656) on a 402x874 screen (rect 20,1630 362x51) — scroll_until it first; nothing was tapped` (1.2 s; idb shim:
  no tap sent).
- WDA: `type_text { selector: "role:textfield label:Notes", text: "x" }` → `role:textfield label:Notes is off screen at
  (201,1424) on a 402x874 screen (rect 36,1412 330x23) — scroll_until it first; nothing was tapped` (7.7 s; nothing typed).
  Then `scroll_until … fully: true` → `fully visible after 1 swipe` (17.5 s; Notes at y 536), and `type_text` on it focused
  and typed (the field then read `Hello`; the case change is a separate wording bug, see the fill note's 2026-10-09 section).
- No visible element was wrongly refused in ~40 portrait taps (bank, Contacts, Settings; idb and WDA).

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

**Holds** on the SWIFT repro (default idb, form at its top, no keyboard):

```
06:06:58  tap { selector: 'text:"Payee’s street"' }
→ text:"Payee’s street" is off screen at (94,985) on a 402x874 screen (rect 42,975 103x20) — scroll_until it first; nothing was
  tapped                                                                                               (1.2 s; no idb tap sent)
06:06:59  scroll_until { selector: 'text:"Payee’s street"', fully: true }  → fully visible after 1 swipe (3.0 s; swipe 699 → 175)
06:07:03  tap { selector: 'text:"Payee’s street"' }                        → Tapped (idb tap 94 194)
06:07:04  type_text { text: "Hauptstrasse 1" }                              → field read `Hauptstrasse 1` at 42,191
```

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default `treeSource: idb`,
`idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder: `scratchpad/averi-repo/run5-ios`.

**Holds.** Bank Account Detail, list at the top; `transactions.list.row_6` in the tree at `24 971 354 52` (below 874):

```
11:41:18 tap { platform: ios, selector: "id:transactions.list.row_6" }                                        (1.2 s)
→ [isError] id:transactions.list.row_6 is off screen at (201,997) on a 402x874 screen (rect 24,971 354x52) — scroll_until it
  first; nothing was tapped
```

No idb tap in the shim log after 11:41:10 (the Discard tap); Account Detail unchanged (`run5-ios/img-121-0.png`).
