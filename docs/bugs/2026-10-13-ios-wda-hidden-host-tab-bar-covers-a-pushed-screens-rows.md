# BUG: under WDA the host's hidden tab bar is listed after a pushed SwiftUI screen and read as drawn over its rows — taps are moved off-centre, colour/OCR asserts fail closed naming a tab icon, `fully` scrolls run for nothing

**Measured 2026-10-13 17:34–17:36 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port 47883), scratch `treeSource: wda`, mp-native
SWIFT form (Account Detail → PAY → SWIFT, a screen pushed over the tab host, no tab bar on screen).

## Symptom


Every WDA dump of the SWIFT form lists the Account Detail tab bar AFTER the form, at a hidden position (6 of 6 dumps this session:
`M3-wda-swift-scrolled.json`, `wda-numpad.json`, `wda-C24.json`, `M1-wda-fees-sheet.json`, `wda-more.json`, `NEW-tabbar-wda.json`):

```
      button 'Continue to summary' swift_payment.form.continue_button 24,780 354x44
    toolbar 'Toolbar' 0,0 402x874
  button 'Home'         nav.tab_home         69,711 67x52
  button 'Transactions' nav.tab_transactions 135,711 66x52
  button 'Cards'        nav.tab_cards        201,711 66x52
  button 'More'         nav.tab_more         266,711 67x52
```

(On Account Detail itself the bar is at `37…283,755 82x64`.) The screenshot shows no tab bar (`img-198-0.png`, `img-204-0.png`). idb
does not list it on this screen. With `payee_country_select` at `24,708 354x53` (centre 201,735):

```
17:35:21 tap { selector: "id:swift_payment.form.payee_country_select", configPath: <cfg-wda> }                (3.4 s)
→ Tapped id:swift_payment.form.payee_country_select at (47,736) — its centre (201,735) is under button "Cards" (201,711 66x52), drawn
  over it; tapped the uncovered part 45x50
17:36:22 assert color #FDFDFD on payee_country_select (cfg-wda)                                                 (6.3 s)
→ FAIL … image "Dashboard/icon-browsers" (201,711 66x52) is drawn over the element (element 24,708 354x53) — the capture would show
  it, not the element; scroll_until the element with `fully: true` first and re-run; failing closed, color unchecked
17:36:28 the same assert, idb → PASS … sampled #FDFDFD (dominant, 97% of region) … dE00 0.00
17:36:30 scroll_until … fully: true (cfg-wda) → fully visible after 1 swipe            (a stroke spent moving the row off a phantom)
17:34:37 scroll_until id:swift_payment.form.payee_country_select (cfg-wda), row at 24,668
→ … visible after 0 swipes — PARTLY UNDER button "More" (266,711 67x52), drawn over it — 86% of it shows, its centre clear …
```

The moved tap still hit the row (the country picker opened), so no wrong control was pressed here; but a row whose uncovered part were
too small would be refused as "under button Cards", and the pixel assert fails on pixels idb measures clean.

## Repro


1. mp-native, Account Detail → PAY → SWIFT; `ui_snapshot` with `treeSource: wda`: `nav.tab_*` at y 711 after the form.
2. Drag the form so a row's centre lies in 711–763 at x 69–333 (e.g. `payee_country_select` at `24,708`).
3. WDA `tap` it → moved to the 45x50 strip left of "Home"'s phantom; WDA colour assert → fails closed naming `Dashboard/icon-browsers`.

## Evidence


`run12-ios/session.log` #193–#207; `wda-more.json`, `NEW-tabbar-wda.json`, `NEW-tabbar-wda-2.json`; `img-198-0.png`, `img-204-0.png`;
`idb-calls.log` l.84 (`47 736`), l.88 (the `fully` stroke). Earlier the same nodes were recorded in
`2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md` ("the (hidden) tab bar of the host") but not their effect on taps.

## Expected


A tab bar the pushed screen hides is not drawn and covers nothing: the tap at the row's centre (201,735), the colour measured as on idb,
`fully` stopping with no stroke.

## Suspected cause


WDA keeps the hidden `UITabBar`'s buttons in the tree with on-screen frames (y 711, not the visible 755) and gives no visibility flag
averi reads; draw order sees buttons listed after the form and counts them. A candidate filter: nodes WDA marks `visible: false` /
`isVisible=0` if the source carries it, or tab-bar buttons whose frame differs from the bar's shown frame — needs a look at the raw
`/source` attributes.


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

**C.1 (round 13): captured.** mp-native Account Detail → PAY → SWIFT (the form pushed over the tab host). Raw WDA source at 22:23:32:
`curl -s 'http://localhost:8100/source?format=xml'`, saved as `run13-ios/c1-source.raw` (JSON envelope) and `run13-ios/c1-source.xml`
(the XML, 138 elements).

- **Each `nav.tab_*` has `visible="false"` and `accessible="false"`.** The source has no `isVisible` attribute. Its attribute set is
  `type name label value enabled visible accessible x y width height index traits`.

```
<XCUIElementTypeToolbar type="XCUIElementTypeToolbar" name="Toolbar" label="Toolbar" enabled="true" visible="false" accessible="false" x="0" y="0" width="402" height="874" index="2" traits="">
<XCUIElementTypeButton type="XCUIElementTypeButton" name="nav.tab_home" label="Home" enabled="true" visible="false" accessible="false" x="69" y="711" width="67" height="52" index="1" traits="Button">
<XCUIElementTypeButton type="XCUIElementTypeButton" name="nav.tab_transactions" label="Transactions" enabled="true" visible="false" accessible="false" x="135" y="711" width="66" height="52" index="2" traits="Button">
<XCUIElementTypeButton type="XCUIElementTypeButton" name="nav.tab_cards" label="Cards" enabled="true" visible="false" accessible="false" x="201" y="711" width="66" height="52" index="3" traits="Button">
<XCUIElementTypeButton type="XCUIElementTypeButton" name="nav.tab_more" label="More" enabled="true" visible="false" accessible="false" x="266" y="711" width="67" height="52" index="4" traits="Button">
```

  Each tab's child image (`Dashboard/icon-house-chimney`, `…/Group`, `…/icon-browsers`, `…/icon-menu-dots`, same rects) is also
  `visible="false"`.
- **Contrast, Account Detail with the bar shown** (`run13-ios/c1-source-account-detail.xml`): `nav.tab_home … visible="true"
  accessible="true" x="37" y="755" width="82" height="64"`, and the same for the other three tabs (x 119/201/283, y 755).
- **Caution for a filter on `visible`.** Of the 138 elements, 29 lie on screen with `visible="false"`. Besides the tab bar and the
  full-screen `Toolbar`, these include real form rows covered by the pinned CONTINUE bar:
  - `Other swift_payment.form.payee_name_input 24,801 354x52`
  - its `StaticText 'Payee’s name' 42,816` and `TextField 42,817 318x20`
  - `swift_payment.form.payee_street_input 24,869`

  So, as WDA reports it, `visible` means "hit-testable/unobscured", not "rendered". No element is `visible="true"` off screen. Two more
  facts point at the hidden bar: it sits at y 711 instead of 755, and it has `accessible="false"`.
- The same hidden-bar nodes appear in WDA's normalized tree on Account Detail itself while the payment-type menu overlay is up
  (`X-wda-paytype-sheet.json`, `nav.tab_* 69…266,711`).


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

**D captures (no verdict).**
- `D-swift-form.json`: the SWIFT form pushed over the tab host, pristine, 07:05:44.
- `D-swift-fees-sheet.json`: the same with the Fees half sheet, 07:09:15.
- `D-account-detail-contrast.json`: Account Detail with the bar shown, 07:11:33.

The attributes are `isVisible` and `isAccessible`, and their values are **strings** `"0"`/`"1"` in the JSON format.

**SWIFT form pushed (`D-swift-form.json`):**
```
[0] Application 'Skeleton Internal'  0,0 402x874  isVisible "1" isAccessible "0"
[1]  Window                           0,0 402x874  isVisible "1" isAccessible "0"
[2]   Other                           0,0 402x874  isVisible "1" isAccessible "0"
[3]    Other                          0,0 402x874  isVisible "1" isAccessible "0"
[4]     Other                         0,0 402x874  isVisible "1" isAccessible "0"
[5]      Other (tab-bar host)         0,0 402x874  isVisible "0" isAccessible "0"  kids 5
           Other (the content)        0,0 402x874  isVisible "1" isAccessible "0"  kids 3
           Button 'nav.tab_home'         69,711 67x52  isVisible "0" isAccessible "0"
             Image 'Dashboard/icon-house-chimney'      isVisible "0" isAccessible "1"
           Button 'nav.tab_transactions' 135,711 66x52 isVisible "0" isAccessible "0"
             Image 'Dashboard/Group'                   isVisible "0" isAccessible "1"
           Button 'nav.tab_cards'        201,711 66x52 isVisible "0" isAccessible "0"
             Image 'Dashboard/icon-browsers'           isVisible "0" isAccessible "1"
           Button 'nav.tab_more'         266,711 67x52 isVisible "0" isAccessible "0"
             Image 'Dashboard/icon-menu-dots'          isVisible "0" isAccessible "1"
```
- **The tab subtrees are not wholly `isAccessible "0"`.** Each tab's child Image is `isAccessible "1"`. A Q6 rule "isVisible=0 **and**
  isAccessible=0 over the whole subtree" would not match the tab buttons' subtrees as captured here. It would match the buttons alone.
- As in round 13, real form rows lie on screen with `isVisible "0"`:
  - `Other 'swift_payment.form.payee_name_input' 24,801 354x52 isVisible "0" isAccessible "0"`, under CONTINUE.
  - The screen's full-screen `Toolbar` is `isVisible "0" isAccessible "0"`.

**Same with the Fees sheet (`D-swift-fees-sheet.json`):**
- The four tabs are again `isVisible "0" isAccessible "0"` at y 711, this time with no child images.
- The sheet's `[3] Other 'PopoverDismissRegion' 'dismiss popup' -402,-874 1206x2622` is `isVisible "1" isAccessible "0" kids 0`, and
  `Button 'Sheet Grabber' 152,411 98x24` is `isVisible "1" isAccessible "1"`.
- A **second** `PopoverDismissRegion` (`[4] … -402,-874 1206x2622 isVisible "0" isAccessible "0" kids 0`) sits inside the form's own
  window, before the tab-host branch. averi's normalized tree lists it too (`A1-wda-fees-sheet.txt` l.52). It did not affect any verdict
  here.

**Contrast, Account Detail with the bar shown (`D-account-detail-contrast.json`):**
- `nav.tab_home 37,755 82x64`, `nav.tab_transactions 119,755`, `nav.tab_cards 201,755` and `nav.tab_more 283,755` are each `isVisible
  "1" isAccessible "1"`.
- **Their host `[5] Other 0,0 402x874` is still `isVisible "0" isAccessible "0"`.** The host's own flags are the same whether the bar is
  shown or hidden, so only the buttons' flags (and the y 711 vs 755 frame) tell the two states apart.


## Device check (2026-10-14 iOS, re-run at ebe6822)

Measured 2026-10-14 17:24:17–17:47:35 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-16` @ `ebe6822`; `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed `ebe6822` (read-only, detached, no git writes). averi ran through the HTTP daemon on port 47913 (`daemon.mjs`, pid 86016, session connected 17:07:13, server `averi 0.9.0`). Call numbers below come from that session (`session.log`). I pinned the device with `select_device` (#2). Configs in `run16-ios`:
- `cfg-wda.yaml`: copied from `run14-ios`. `diff` with mp-native's `averi.yaml` shows only `treeSource: wda`.
- `fp-cfg.yaml`: copied from `run14-ios`. `diff` with `~/dev/finportal/app/averi.yaml` is empty.
- idb calls used mp-native's own `averi.yaml` (default `treeSource: idb`).

**WDA.** averi started WDA (port 8100) on the first `cfg-wda` call (#6, 17:24:41, WebDriver pid 30539). During #168 (Safari, 17:45:54) averi logged `WDA on port 8100 … stopped answering (The operation was aborted due to timeout) — restarting it once` (`server-stderr.log`). The new xcodebuild started at 17:46:27 (pid 87509, WDA pid 87510). I stopped it at 17:47:3x by killing xcodebuild 87509. Both pids exited, and `lsof -iTCP:8100 -sTCP:LISTEN` was empty.

**Keyboard prefs.** Both were 1 at the start.
- I set `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to 0 at 17:39:50. The read-back at 17:41 showed both at 1 again: the `idb ui text` HID typing at l.52 flips them back. I set them to 0 again at 17:41:52 and relaunched Contacts.
- I restored both to 1 at 17:44:50. They read back as 1 at 17:47:35.

**PIN re-login.** At 17:27 the SWIFT form showed "That's an error" (`img-21-0.png`). I saved its trees, then terminated and launched mp-native without clearState. The screenshot showed "Enter your PIN to log in" (`img-26-0.png`). `login_pin_ios_here` has no `requires:`. I ran it once (#27, `branch: matched state logged_in`). Its PIN-pad lines are shim l.9–12 and are not quoted. I never used the `login` rung, and nothing was registered.

**Metro and the rest.** Metro on :8081 (listener node pid 86170, `metro.pid` 86151) was left running, and Finportal showed no redbox or LogBox toast. A local web server ran on 127.0.0.1:47915 from 17:45:4x and was stopped at 17:47. The shim logged 66 lines to `idb-calls.log`. No Android, adb or port 47911 was touched.

**R15 C.1 SWIFT form over the hidden tab bar: holds.**
- The `ui_snapshot` (#31) shows `nav.tab_home 69,711 67x52`, `nav.tab_transactions 135,711`, `nav.tab_cards 201,711` and `nav.tab_more 266,711`, each with `"hidden": true`.
- `tap text:Standard` (`42,704 71x21`, under the phantom bar at y 711) → `Tapped text:Standard` (17:28:39, 2.9 s, #33, l.15 `78 715`). The Priority sheet opened (`img-34-0.png`). Nothing was refused under `nav.tab_*`.
- Undo: `tap id:swift_payment.form.priority_sheet.row_0` (Standard, the row already selected) (#36, l.16). The field still reads `Priority*, Standard` (#37).

**R15 C.2 Bar shown: holds.** On the Transactions tab (#89, `transactions-wda.txt`) the tabs sit at `…,755 82x64` with no `hidden` flag.
- `tap id:transactions.list.row_7` (`24,776 354x52`, 17:35:12, 3.3 s, #90):
  `id:transactions.list.row_7 is under button "Cards" (201,755 82x64) at its centre (201,802), drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`
  - No shim line was logged (l.32 is the #88 tab tap).
- On Account Detail, a wide date header under the bar was tapped on its uncovered part, as designed: `Tapped id:transactions.list.date_header_4 at (19,795) — its centre (201,795) is under button "Cards" (201,755 82x64), drawn over it; tapped the uncovered part 37x30` (#7, l.1).
  - I could not move a row there: Account Detail's list did not scroll (see Gaps).
