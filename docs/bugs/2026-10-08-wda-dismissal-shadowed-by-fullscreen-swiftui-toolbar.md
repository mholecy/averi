# BUG: through WebDriverAgent a full-screen SwiftUI `Toolbar` "shadows" every point, so a configured `keyboardDismiss` tap on the screen title is refused as "covered"

> **Status (2026-10-08, after the device check):** the first fix (branch `fix/p3-wda-toolbar-shadow`, merged into `fix/keyboard-aware-scroll`) **did not hold on the device** at `e9e6509` ("Device check" below): the screen-sized `toolbar 'Toolbar'` host was excused, but the form's `scrollable 0 0 402 512` after the title (58 % of the screen, its frame under the translucent top bar, no content at the point) then covered the title and the dismissal was refused `covered by scrollable`. Fixed again on branch `fix/r2-b-shadowing`, unmeasured on a device: `shadowing` (`src/ui-tree/geometry.ts`) excuses (1) a later screen-sized HOST — a non-interactive node with children whose area reaches `SCREEN_SIZED_FRACTION` of the root's rect (the largest rect when the root has none) — and now (2) a non-interactive `scrollable` with children of ANY size (`CONTENT_FRAMED_ROLES`): both cover only through their content at the point; a childless or interactive node, a `webview` under the screen size and a smaller card still cover as themselves. Pinned by tests built from the device-check tree (title, container, the form's scrollable with rows from y 150, the 402×874 toolbar, the pad's band `0 572 402 302`), with and without the toolbar, through `shadowing`, the tap guard and the post-fill dismissal. Re-run the repro with `treeSource: wda` to confirm the title is tapped and the keyboard hides. (`SCREEN_SIZED_FRACTION` lives in `adapters/types.ts` beside `STRUCTURAL_ROLES` since the merge into `fix/keyboard-aware-scroll`.)

**Measured 2026-10-08 16:42–16:43 UTC** in `/Users/mholecy/Finshape/mp-native` (SWIFT payment form, branch
`feature/swift-payment`) with a scratch config — mp-native's `averi.yaml` uses idb and was not edited — iPhone 17
simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`), averi = mobile-verify @ `c35388a` built from source (WDA
from `averi-wda`'s `WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun`).

Scratch config:

```yaml
app:
  ios:
    bundleId: com.finshape.dbosbanking
    app: /Users/mholecy/Finshape/mp-native/ios/build/Build/Products/Debug-iphonesimulator/Internal.app
    treeSource: wda
    keyboardDismiss:
      - tap: { id: swift_payment.form.title }
```

## Observed (measured)

With the decimal pad up after `tap { selector: "id:swift_payment.form.amount_input" }` (`role:keyboard` band
`{x:0, y:572, w:402, h:302}`):

```
16:43:01  tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch> }
→ The soft keyboard covers id:swift_payment.form.priority_select: the band it draws over [0,572][402,874] contains the
  tap point (201,707) on two looks 300ms apart; this adapter cannot hide it on its own (…), and none of the configured
  dismissals is usable on this screen (tap id:"swift_payment.form.title": covered by toolbar "Toolbar"). Nothing was
  tapped: …                                                                               (6.6 s)
```

Reproduced at the next call with the same sentence. The title is NOT covered: it is drawn in the top bar at
`{x:135, y:73, w:131, h:22}`, and a plain tap on it (`tap id:swift_payment.form.title`, idb) hid the keyboard at 16:40
on the same screen.

The WDA tree (`ui_snapshot` unfiltered, abridged, pre-order):

```
          text 'SWIFT PAYMENT' swift_payment.form.title 135 73 131 22
       container … 0 0 402 874
         … the form, scrollable 0 0 402 512, the inputs …
           button 'Continue to summary' swift_payment.form.continue_button 24 512 354 44
       toolbar 'Toolbar' id=Toolbar 0 0 402 874          ← after the title, full screen
        container None None None 0 0 402 874
      button 'Home' nav.tab_home 69 711 67 52            ← the (hidden) tab bar of the host
      …
```

A `Toolbar` element labelled "Toolbar" with a full-screen frame follows the title in pre-order (SwiftUI's toolbar host
of the pushed screen; it draws nothing over the title).

## Why (read from the source)

- `src/ui-tree/geometry.ts:560–572` `shadowing`: the last node after the target in pre-order that is not in
  `STRUCTURAL_ROLES`, has area and contains the point. `STRUCTURAL_ROLES` is `['container', 'other']`
  (`src/adapters/types.ts:161`).
- `src/adapters/wda-source.ts:49–62` maps `Toolbar` → `toolbar` ("as `toolbar` it always does [count] — a toolbar on
  screen is rendered UI, labelled or not"). That reasoning was measured on the 48-pt input-accessory toolbar
  (2026-10-07); a screen-sized `Toolbar` is a wrapper, and the size rule that keeps full-screen `other`s out of
  `isBareTree` (`ui-tree/bare-tree.ts#wrapperBySize`) is not applied in `shadowing`.
- So on any SwiftUI screen with a `.toolbar` / navigation toolbar host, every `tap:` dismissal is "covered" and the
  guard refuses the covered target.

## Why it matters

`keyboardDismiss: [tap: { id: <title> }]` is the dismissal the tool description and troubleshooting.md recommend for
iOS; on this (SwiftUI) app it can never be used, so every tap on a field or select under the keyboard is refused with
advice to configure the very dismissal that is configured. (mp-native is on idb today; this blocks the documented
path to `treeSource: wda`, which mp-native's own `averi.yaml` header considers for its container ids.)

## Possible fix directions (owner's choice)

- Apply the wrapper-by-size rule in `shadowing`: a non-structural node whose area reaches `SCREEN_SIZED_FRACTION` of
  the root (taken: only a non-interactive one with children, see Status) does not shadow (a real modal sheet/alert is smaller than the screen, or carries content children that do).
- Or judge cover by the shadowing node's content children (leaf with label/text) rather than the container itself.
- A test with this tree (title, then a 402×874 `Toolbar`) pinning the title as usable.

## Repro

1. A SwiftUI pushed screen with a navigation toolbar, `treeSource: wda`, `keyboardDismiss: [tap: { id: <title id> }]`.
2. Focus a text field (soft keyboard up), `tap` an element under the keyboard → refused, `covered by toolbar "Toolbar"`.
3. `ui_snapshot` → a `toolbar` node with the screen's full frame after the title in pre-order.


## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:06–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
(`feature/swift-payment`), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). **Does not hold**: the toolbar is excused now, but the next node in pre-order, the form's `scrollable`, covers the title.

Scratch config as in the note (`treeSource: wda`, `keyboardDismiss: [tap: { id: swift_payment.form.title }]`), decimal pad up
after `tap id:swift_payment.form.amount_input` (`role:keyboard` `0 572 402 302`), `priority_select` at y 681 (under the pad):

```
20:16  tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch> }       (6.5 s)
→ The soft keyboard covers id:swift_payment.form.priority_select: the band it draws over [0,572][402,874] contains the
  tap point (201,707) on two looks 300ms apart; this adapter cannot hide it on its own (…), and none of the configured
  dismissals is usable on this screen (tap id:"swift_payment.form.title": covered by scrollable). Nothing was tapped: …
```

WDA tree (unfiltered, pre-order, abridged):

```
16:          text 'SWIFT PAYMENT' swift_payment.form.title 135 73 131 22
17:       container None None None 0 0 402 874
 …
22:           scrollable None None None 0 0 402 512          ← after the title; its frame runs under the top bar
 …
138:       toolbar 'Toolbar' Toolbar None 0 0 402 874         ← now excused as a screen-sized host
155:   keyboard None None None 0 572 402 302
```

The form's scroll view (`0 0 402 512`, 58 % of the screen, so not a `SCREEN_SIZED_FRACTION` host) extends behind the
translucent top bar; nothing of its CONTENT is at (201,84) (its first row, `debit_select`, starts at y 150). `shadowing`
(`src/ui-tree/geometry.ts:608–618`) counts the scrollable's own rect as cover. The same scrollable was in the original
tree above ("the form, scrollable 0 0 402 512"); it was shadowed by the later toolbar then, so the test built from the
abridged tree did not pin it.

Contrast: the flow `fill: { id: swift_payment.form.amount_input, value: "3.10", clear: true, dismissKeyboard: true }` on the
same screen hid the pad (`role:keyboard` → 0 matches after) with no ⚠ (the flow trace does not say what hid it) — so
the post-fill dismiss path apparently does not hit this refusal; only the tap guard's pick does.

Fix direction: treat a `scrollable` (and other containers with children) like a host — cover only through its content at
the point, not its own frame — at least when it is not interactive by itself; or judge cover only by leaf/content nodes.

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

**Partly measured — holds for the screen-sized toolbar host; the form's `scrollable` shape (the e9e6509 failure) could not be
re-run** (the SWIFT form did not load).

- Holds — bank app, account detail (SwiftUI), `treeSource: wda`, scratch config `keyboardDismiss: [tap: { role: text, text:
  "That's an error" }]`, keyboard up on `accounts.detail.search_field` (`role:keyboard` `0 573 402 301`). WDA pre-order: the
  error text `138 318 126 24`, then `toolbar 'Toolbar' 0 0 402 874` with one child (`container 0 0 402 874`), then the tab bar
  under the keyboard:
  ```
  05:41:03  tap { selector: "id:nav.tab_transactions", configPath: <scratch> }                                    (4.4 s)
  → Tapped id:nav.tab_transactions (the soft keyboard covered id:nav.tab_transactions; hidden by tapping
    text:"That's an error" role:"text" before tapping)
  ```
  idb shim: `ui tap 201 330` (the text) then `ui tap 160 787` (the tab); `role:keyboard` → 0 matches after; the Transactions
  tab opened. The screen-sized host with children is excused as designed.
- A refusal still happens (no silent pass) — stock Contacts "New Contact" sheet (UIKit), `keyboardDismiss: [tap: { role: text,
  text: "New Contact" }]`, keyboard `0 573 402 301`, target `role:text text:"add pronouns"` at y 714 under it:
  ```
  05:30:31  tap { selector: 'role:text text:"add pronouns"', configPath: <scratch> }                              (13.3 s)
  → The soft keyboard covers role:text text:"add pronouns": the band it draws over [0,573][402,874] contains the tap point
    (223,703) on two looks 300ms apart; … none of the configured dismissals is usable on this screen (tap text:"New Contact"
    role:"text": covered by toolbar "Toolbar"). Nothing was tapped: …
  ```
  WDA tree after the title `text 'New Contact' 149 89 104 22` (inside `container id:"New Contact" 0 78 402 54`): the form's
  `scrollable 0 62 402 812` WITH children (excused now — it does not appear in the reply), then two CHILDLESS toolbars,
  `toolbar 'Toolbar' 0 83 402 48` and `toolbar 'Toolbar' 0 62 402 812` (93 % of the screen; no children, so no host).
  Either covers (201,100). The screenshot shows the title drawn and nothing over it, so as a statement about the pixels the
  refusal is false (the safe direction, as the Status accepts for `toolbar` under the screen size); a childless screen-sized
  `Toolbar` is a shape the host rule does not excuse. Whether a title tap would even hide the keyboard in a UIKit sheet is
  not known (not tried — no other neutral element there).
- Not measured: the post-fill `dismissKeyboard` path with the pad up — every `fill` types through `idb ui text` (HID), after
  which iOS parks the software keyboard (`role:keyboard` 0 matches right after each fill, bank and Contacts), so the flow's
  dismissal has nothing to hide; `fill: { id: accounts.detail.search_field, value: "Loan", dismissKeyboard: true }` →
  `fill: id:"accounts.detail.search_field" = Loan` / `done`, no ⚠.

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

**Holds** — the e9e6509 repro, on the real form (pad up after the focus tap, `priority_select` at y 681 under the band):

```
05:58:43  tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch wda> }                (11.7 s)
→ Tapped id:swift_payment.form.priority_select (the soft keyboard covered id:swift_payment.form.priority_select; hidden by
  tapping id:"swift_payment.form.title" before tapping)
```

idb shim: `ui tap 201 84` (the title) then `ui tap 201 707` (the row); `role:keyboard` → 0 matches after; the priority sheet
opened (`priority_sheet.row_0/1` at y 456/502). The form's `scrollable 0 0 402 512` no longer shadows the title.

- Post-fill dismissal still not measurable: the flow `fill: { id: swift_payment.form.amount_input, value: "3.10", clear: true,
  dismissKeyboard: true }` (06:03:53) typed via `idb ui text 3.10`, which parks the pad, so nothing was left to hide (no ⚠ about
  a dismissal; the two known container ⚠ lines as at e9e6509).
- Odd, once: the very first WDA `tap id:swift_payment.form.amount_input` after the form opened (05:58:07) failed `Timed out after
  5000ms waiting for element … to hold still (found, but never at the same position in two consecutive reads)`; three reads
  right after gave the same rect `24 273 354 52`, and the retry at 05:58:31 tapped (3.1 s). Not reproduced.

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder:
`scratchpad/averi-repo/run5-ios`. Bank app: cold relaunch at 11:36:52 (with the hardware-keyboard prefs off), PIN-only
`login_pin_ios_here` (11:37:11, `branch: matched state logged_in`), Account Detail → PAY → SWIFT payment.

**Holds.** Scratch `treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`. Focus TAP
`id:swift_payment.form.amount_input` (11:37:59, 3.0 s) → `keyboard 0 572 402 302`; `priority_select` at `24 681 354 52`:

```
11:38:11 tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch wda> }                 (10.5 s)
→ Tapped id:swift_payment.form.priority_select (the soft keyboard covered id:swift_payment.form.priority_select; hidden by
  tapping id:"swift_payment.form.title" before tapping)
```

Shim: `11:38:18 ui tap 201 84` (title), `11:38:21 ui tap 201 707` (row). After: `0 matches for role:keyboard`; the sheet
`swift_payment.form.priority_sheet` with `row_0 'Standard'` / `row_1 'Express'` opened (closed again with `row_0`); screenshot
`run5-ios/img-94-0.png`. The dcd089b silent-wrong-action shape is absent here: the form's only `toolbar` is `toolbar 'Toolbar'
0 0 402 874` with a child (`container 0 0 402 874`), screen-sized, excused as a host; nothing itemless is drawn over the title.
(The UIKit Contacts sheet still refuses its title dismissal — see
[2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md](2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md), 347e70d section.)

## Device check (2026-10-09 iOS, re-run at 86eb42d)

Measured 13:13–13:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim, hardware-keyboard prefs off. Run folder: `scratchpad/averi-repo/run6-ios`.
The SWIFT form first showed "That's an error / We could not display the page you requested" (twice, also after TRY AGAIN):
the bank session had gone stale. Cold relaunch through averi → PIN screen → `login_pin_ios_here` (13:13:52, 7.8 s,
`branch: matched state logged_in`) → PAY → SWIFT payment loaded.

**Holds.** Scratch `treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`. Focus TAP
`id:swift_payment.form.amount_input` (13:14:23, 3.1 s; shim `13:14:26 ui tap 201 299`) → WDA `keyboard 0 572 402 302`;
`priority_select` at `24 681 354 52` (WDA dump `run6-ios/wda-swift1.txt`):

```
13:14:33 tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch wda> }                 (10.3 s)
→ Tapped id:swift_payment.form.priority_select (the soft keyboard covered id:swift_payment.form.priority_select; hidden by
  tapping id:"swift_payment.form.title" before tapping)
```

Shim: `13:14:40 ui tap 201 84` (title), `13:14:43 ui tap 201 707` (row) — the 347e70d numbers exactly. After: `0 matches for
role:keyboard`, `swift_payment.form.priority_sheet 31 438 340 373` open (closed with `row_0 'Standard'`); screenshot
`run6-ios/img-80-0.png`. Left with Back (the form was untouched, no Discard prompt); no payment created.

On the handoff's caveat ("the SwiftUI toolbars there hold labelled items"): at 86eb42d the form's only `toolbar` is still
`toolbar 'Toolbar' 0 0 402 874` with ONE child `container 0 0 402 874` and no label/value/id below it — so the new content rule
reads it as itemless too, on top of the screen-sized-host excuse it already had. The tab buttons (`nav.tab_*`, labelled) are its
siblings, not its descendants. Nothing that covers the title is newly excused here, and the outcome is unchanged; but this screen
does not exercise "a toolbar WITH labelled items still covers" — that case stays unit-test evidence only.
