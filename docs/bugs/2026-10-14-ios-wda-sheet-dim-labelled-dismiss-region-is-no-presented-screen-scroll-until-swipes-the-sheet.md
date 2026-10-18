# BUG: under WDA a half-height SwiftUI sheet's dim is a labelled `PopoverDismissRegion` leaf, so it is not read as a presented screen — the tap refusal says "scroll_until it first" and `scroll_until` swipes the sheet (it changed detent)

**Measured 2026-10-14 22:24–22:25 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-13` @ `d407256` (`dist/`, stdio via the HTTP daemon on port 47893), scratch `treeSource: wda`. The
app is mp-native's SWIFT form, Fees picker. This is a sibling of
`2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md`, which round 13 fixed for Contacts' page
sheet.

## Symptom


SWIFT form → `fees_select` opens the fees sheet at its half detent (`Sheet Grabber` value `Half screen`). WDA lists it in a later
Window, after the whole form and the hidden tab bar (`run13-ios/A6-wda-fees-sheet.json`):

```
container  0,0 402x874                                       ← the sheet's Window
  container 'dismiss popup' id=PopoverDismissRegion -402,-874 1206x2622   ← the dim: a LEAF, labelled
  container  8,415 386x451                                   ← the sheet
    button 'Sheet Grabber' v='Half screen' 152,411 98x24
    … container id=swift_payment.form.fees_sheet 31,438 340x373 → scrollable 31,456 340x355 → rows OUR/SHA/BEN
```

`debit_select 42,150 318x89` lies on the form beneath, under the dim only.

```
22:24:56 tap { selector: "id:swift_payment.form.debit_select", configPath: <cfg-wda> }                         (2.5 s)
→ id:swift_payment.form.debit_select is under container "dismiss popup" (-402,-874 1206x2622) at its centre (201,195), drawn over it;
  nothing of it shows — scroll_until it first; nothing was tapped
22:24:59 scroll_until { selector: "id:swift_payment.form.debit_select", configPath: <cfg-wda> }                (4.5 s)
→ scroll_until id:swift_payment.form.debit_select stopped after 1 swipe, without swiping further — element is in the viewport but under
  button "SHA – Shared charges" (24,153 354x45) at its centre (201,195), drawn over it — 0% of it shows — a screen is presented over it
  (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so no further
  swipe was sent. …
```

The shim logged `idb ui swipe 201 699 201 175 --duration 0.3` (l.49). The stroke started on the sheet and moved it from `Half screen`
to `Expanded`: `fees_sheet 24,86 354x730`, grabber `151,58`, value `Expanded` (`A6-wda-fees-sheet-after-swipe.json`,
`img-157-0.png`). Only then did the target lie under a sheet node that ADR 0018 reads as presented, and the tool stopped. The
selection was unchanged (OUR). A stroke the other way, or one the sheet takes as a drag-down, would dismiss the sheet; that is the
very risk the reply names.

The tap was refused, which is right, but its advice says `scroll_until it first`, and that call is the one that swiped.

## Repro


1. mp-native, Account Detail → PAY → SWIFT payment. Tap `id:swift_payment.form.fees_select` (keyboard down) to open the fees sheet at
   half height.
2. With `treeSource: wda`, `ui_snapshot`: `container 'dismiss popup' id=PopoverDismissRegion -402,-874 1206x2622` with no children,
   after the form.
3. `tap id:swift_payment.form.debit_select` → refused with `… scroll_until it first`.
4. `scroll_until id:swift_payment.form.debit_select` → one swipe is sent, and the sheet changes detent.

## Evidence


- `run13-ios/session.log` #153–#159
- `A6-wda-fees-sheet.json`, `A6-wda-fees-sheet-after-swipe.json`
- `img-152-0.png` (half sheet), `img-157-0.png` (expanded after the swipe)
- `idb-calls.log` l.49

## Expected


ADR 0018 / round 13 A.3: a screen presented over the target, here a sheet with a screen-filling dimming view, makes the tap refusal
say `a screen is presented over it … close it first`. `scroll_until` must fail `stopped before any swipe … so none was sent`, and the
sheet must stay as it was.

## Suspected cause


`draw-order.ts` `presentedSurface`/`givesWay` are asked only of nodes a FRAME row excuses. A labelled node is never excused ("never a
control, a labelled node … which cover anyway"), so UIKit's `PopoverDismissRegion` counts as an ordinary cover and gets the ordinary
`scroll_until it first` sentence. `scroll_until` treats an ordinary cover as something to scroll out from under, so it swipes. The
leaf is also 3× the screen (`1206x2622` from `-402,-874`). If a size check only accepts a node of about the screen's size, it may
reject this one as well; that needs checking. A candidate rule: a leaf that holds the whole screen and is listed after the target's
screen counts as a presented surface whether or not it carries a label, or at least `id=PopoverDismissRegion` / `'dismiss popup'`
does. The Contacts discard popover's `PopoverDismissRegion 0,0 402x874` has the popover as children, which falls under round 13's
stated residual (a dimming wrapper with children). Its `scroll_until` swiped too and closed the popover (Gaps).


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

**A.1 mp-native SWIFT form, Fees half sheet (WDA): holds.** I opened the sheet with `tap id:swift_payment.form.fees_select` (#86, l.47
`201 639`). The grabber read `value "Half screen"` at y 411 (`A1-wda-fees-sheet.txt`). The normalized tree lists `container 'dismiss
popup' id=PopoverDismissRegion -402,-874 1206x2622, children []` after the form.

- **`tap id:swift_payment.form.debit_select`: refused** (07:09:35, 2.6 s, #89):
  `id:swift_payment.form.debit_select is under container "dismiss popup" (-402,-874 1206x2622) at its centre (201,195), drawn over it;
  nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that
  screen; nothing was tapped`
- **`scroll_until id:swift_payment.form.debit_select`: fails with no swipe** (07:09:37, 2.4 s, #90):
  `scroll_until id:swift_payment.form.debit_select stopped before any swipe — element is in the viewport but under container "dismiss
  popup" (-402,-874 1206x2622) at its centre (201,195), drawn over it — 0% of it shows — a screen is presented over it (a modal or a
  sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect
  {"x":42,"y":150,"width":318,"height":89} in a 402x874 viewport`
  - The shim count was 47 before and 47 after #89–#90.
  - The grabber still read `"value": "Half screen"`, `"y": 411` (#91), and the sheet is at its half detent in `img-92-0.png`. Round 13
    swiped here, moved the sheet to `Expanded`, and its reply said `scroll_until it first`.
- **Same, target just touching the bottom edge: no swipe.** `scroll_until id:swift_payment.form.payee_street_input` (rect `24,869
  354x52`, 5 pt in the viewport): `… stopped before any swipe — element is in the viewport but under container "dismiss popup"
  (-402,-874 1206x2622), drawn over it — 0% of it shows — … so none was sent. Last rect {"x":24,"y":869,"width":354,"height":52} …` (#95).
  The shim count stayed at 47, and the sheet stayed at `Half screen`.
- **But a target wholly below the fold swipes the sheet.** `scroll_until id:swift_payment.form.payee_city_input` (`24,937`, #98)
  sent two swipes (l.48, l.49 `201 699 → 201 175`). The sheet went to `Expanded` (grabber y 58, `img-100-0.png`). The reply blames
  the content (see NEW `2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md`). OUR
  stayed selected.
- **Tap on a sheet row: tapped** (07:11:13, 2.9 s, #101): `Tapped id:swift_payment.form.fees_sheet.row_0` (l.50 `201 128`, the row of
  the now-expanded sheet). This was the row already selected (OUR). The sheet closed. The field reads `"label": "Fees*, OUR – All
  charges paid by the debtor"` (#102), and the form is unchanged (`img-103-0.png`).

**A.2 Contacts, New Contact sheet with the discard popover up (WDA): holds for a field in the viewport. A field below the fold →
`scroll_until` swiped and closed the popover (NEW note).**

Setup:
- `tap role:button label:Add` (#15, l.5) opened the sheet.
- `type_text id:"First name" "Zz"` → `Filled id:"First name" (2 characters)` (#21).
- `tap role:button label:close` → `Tapped` (#22, l.8 `38 100`). The popover "Are you sure you want to discard this new contact? /
  Discard Changes" is up in `img-23-0.png`.

With the keyboard down, "add instant message" lies below the fold: cell `20,1306 362x52` (#30). So I also used the in-viewport sheet
field "Insert add phone" (`39,577 26x26`).

- **Tap on a sheet field beneath: refused** (06:59:47, 5.4 s, #24):
  `role:button label:"Insert add phone" is under container "dismiss popup" (0,0 402x874) at its centre (52,590), drawn over it; nothing of
  it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing
  was tapped`
  - Round 13 (#94) said `… above the soft keyboard — scroll_until it first`.
  - `tap role:button label:"Insert add instant message"` → `Timed out after 5000ms waiting for element … to appear` (#25). WDA lists that
    cell's text and container but no button while it is off screen.
  - `tap role:text label:"add instant message"` → refused, `… is under container "dismiss popup" (0,0 402x874) at its centre (143,73) …
    close it first; …` (#33). That centre is the WDA parked rect (see the parked-text section below).
- **`scroll_until` to the in-viewport field: fails with no swipe, popover still up** (06:59:58, 5.3 s, #26):
  `scroll_until role:button label:"Insert add phone" stopped before any swipe — element is in the viewport but under container "dismiss
  popup" (0,0 402x874) at its centre (52,590), drawn over it — 0% of it shows — a screen is presented over it (a modal or a sheet) —
  close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect
  {"x":39,"y":577,"width":26,"height":26} in a 402x874 viewport`
  - The shim count stayed at 8 across #24–#34.
  - The popover is still up in `img-28-0.png`.
- **`scroll_until` to "add instant message" (below the fold): fails the item.** The reply was `Element role:container label:"add instant
  message" fully visible after 1 swipe` (07:01:45, 17.0 s, #35). One stroke was sent, l.9 `201 699 → 201 175`.
  - The popover is gone, and the sheet scrolled to "add instant message" (`img-36-0.png`). The reply does not say that a presented layer
    was swiped away.
  - See NEW `2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md`.
- **End:** `tap role:button label:close` (#38, l.10) raised the popover again, and `tap role:button label:"Discard Changes"` → `Tapped`
  (#39, l.11 `130 207`). The list shows the 6 stock contacts (`img-40-0.png`). Nothing was saved.

**A.3 colour/ocr on an element beneath (WDA): holds, never the `fully: true` advice.**
- **Discard popover, field beneath** (07:00:27, 13.1 s, #29):
  `FAIL  element label:"Insert add phone" fill within dE00 8 of #34C759 — container "dismiss popup" (0,0 402x874) is drawn over the
  element (element 39,577 26x26) — the capture would show it, not the element; a screen is presented over the element (a modal or a
  sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`
  - My first selector (`role:"cell"`) matched nothing (#27, `not found within 12 s`), so I reran it on the button.
- **Element reaching under the status bar, beneath the popover:** the sheet's `Sheet Grabber` (`151,58 100x24`).
  - colour (07:00:58, 13.3 s, #31): `FAIL  element label:"Sheet Grabber" fill within dE00 8 of #C7C7CC — container "dismiss popup"
    (0,0 402x874) is drawn over the element (element 151,58 100x24) — … a screen is presented over the element (a modal or a sheet) —
    close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`
  - ocr (07:01:11, 13.1 s, #32): `FAIL  element label:"Sheet Grabber" renders text "x" — the status bar is drawn over the element (element
    151,58 100x24, status bar 0,0 402x62) — the capture would show it, not the element; a screen is presented over the element (a modal
    or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, rendered text unchecked`
  - The ocr reply names the status bar, then gives the presented remedy in place of the bar's advice.
- **SWIFT Fees sheet**:
  - `debit_select` colour (#93): `… container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 42,150 318x89) — …
    a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that
    screen; failing closed, color unchecked`
  - `swift_payment.form.title` ocr (#94): the same ending (`element 135,73 131x22`).
  - No labelled element on the form reaches under y 62. The back button is `30,70 28x28`.


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

**R16 A.1 Fees sheet: payee_street holds. bank_country_select fails** (NEW note 1).
- `tap id:swift_payment.form.payee_street_input` (rect `24,869 354x52`, 5 pt on screen, 17:30:24, 2.7 s, #49):
  `id:swift_payment.form.payee_street_input is off screen at (201,895) on a 402x874 screen — only 10% of it (rect 24,869 354x52) is on screen, and a tap goes to its centre — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- `tap id:swift_payment.form.bank_country_select` (rect `24,1209`, wholly below the screen, 17:30:27, #50):
  `id:swift_payment.form.bank_country_select is off screen at (201,1235) on a 402x874 screen (rect 24,1209 354x52) — scroll_until it first; nothing was tapped`
  - That is not "close it first", although the next call, `scroll_until` on the same field, refuses to swipe because of the presented sheet.
- `scroll_until id:swift_payment.form.payee_street_input` (#51):
  `… stopped before any swipe — element is in the viewport but under container "dismiss popup" (-402,-874 1206x2622), drawn over it — 0% of it shows — a screen is presented over it … so none was sent. Last rect {"x":24,"y":869,…}`
- `scroll_until id:swift_payment.form.bank_country_select` (#52):
  `… stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on scrollable (31,456 340x355) — a screen is presented over it …`
- The shim stayed at 24 lines. The sheet stayed at `Half screen` (#54, `img-55-0.png`).
- The same wholly-off-screen case under the Contacts discard popover: `tap role:text label:"add instant message"` → `… is off screen at (201,1332) … (rect 20,1306 362x52) — scroll_until it first; nothing was tapped` (17:38:41, #114), right after `scroll_until` on it said `close it first` (#111).

**R16 A.2 Status bar beneath a presented screen: fails** (NEW note 1).
- Finportal's forgot modal has nothing addressable under the status bar (`finportal-forgot-wda.txt`). The topmost nodes are the scroll bars at `369,62`. The Fees sheet opens only with the form at rest, where nothing lies above y 70.
- So I scrolled the SWIFT form (#71) and opened the Payee's country half sheet: `tap id:swift_payment.form.payee_country_select` (#76, l.29). The tree (#77, `swift-country-sheet-wda.txt`) lists `PopoverDismissRegion 'dismiss popup' -402,-874 1206x2622` and the `Sheet Grabber` `Half screen` at y 411. `priority_select` is at `24,-20 354x52`, marked hidden (beneath the sheet), with its centre under the status bar.
- `tap id:swift_payment.form.priority_select` (17:33:53, 3.1 s, #79):
  `id:swift_payment.form.priority_select is under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 24,-20 354x52) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped`
  - The handoff expects `— a screen is presented over it (a modal or a sheet) — close it first; …`.
- `tap id:swift_payment.form.fees_select` (`24,-88`, wholly above the screen, #80) → `… is off screen at (201,-62) … — scroll_until it first; nothing was tapped`.
- `scroll_until id:swift_payment.form.priority_select direction up` (#81) does name the sheet:
  `… stopped before any swipe — element is in the viewport but its centre stays under the status bar at (201,6) … and the next swipe would touch down at (201,175) on container "dismiss popup" (-402,-874 1206x2622) — a screen is presented over it (a modal or a sheet) — close it first; … so none was sent.`
- The sheet was closed by a coordinate tap on its dim (#84, l.30). Payee's country stayed empty (`img-85-0.png`).

**R16 A.3 Smoke: holds for the no-presented cases. The colour/ocr presented remedy holds where part of the element shows below the bar, and fails under the status bar** (NEW notes 1 and 2).
- **No presented screen, partly off screen:** `tap id:swift_payment.form.payee_street_input` → `… is off screen at (201,895) … only 10% of it (rect 24,869 354x52) is on screen, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped` (#63).
- **No presented screen, under the status bar:** `tap id:swift_payment.form.priority_select` (form scrolled) → `… is under the status bar at (201,6), in the top 62 … — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped` (#67).
- **Colour/ocr beneath the Fees sheet:**
  - `debit_select` colour (#56): `FAIL … — container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 42,150 318x89) — the capture would show it, not the element; a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`.
  - `swift_payment.form.title` ocr (#57): the same ending.
  - `payee_street_input` ocr (#60): the same ending.
- **Colour beneath the Contacts popover:** `Sheet Grabber` (151,58, partly under the status bar) colour (#115): the same presented ending.
- **But the colour assert on the 5 pt sliver of `payee_street_input` beneath the Fees sheet measured the sheet** (NEW note 2):
  - Expected white (#58): `FAIL … sampled #A6A7AB (dominant, 100% of region) vs expected #FFFFFF → dE00 20.96 > 8; scale 3.000; clipped 90% off-png — the remaining sliver's dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row`.
  - Expected the sheet's colour (17:31:24, #59): `PASS  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #A6A7AB — sampled #A6A7AB … clipped 90% off-png …`.
- **Under the status bar beneath the country sheet**, colour (#82) and ocr (#83) on `priority_select`:
  `FAIL … — the status bar is drawn over the element (element 24,-20 354x52, status bar 0,0 402x62) — the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run — or, if no scroll moves it out from under that, assert something in it that lies clear of that; failing closed, …`
  - That is the bar's advice, not the presented remedy. In round 14 the grabber ocr named the bar and then gave the presented remedy, but the grabber had a part below the bar.
