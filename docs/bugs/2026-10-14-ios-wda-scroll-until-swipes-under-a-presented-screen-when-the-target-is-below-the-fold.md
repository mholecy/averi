# BUG: `scroll_until` swipes under a presented screen when its target lies below the fold — the swipe closes a popover / moves a sheet to another detent, and the reply says "fully visible" or blames the content

**Measured 2026-10-14 07:01 and 07:10 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-14` @ `e1384aa` (`dist/`, stdio via the HTTP daemon on port 47903), scratch `treeSource: wda`
(`run14-ios/cfg-wda.yaml`). Found during the round-14 device check, item A.2. This is the sibling of the round-14 fix in
`2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md`.

## Symptom


The ADR 0018 stop ("stopped before any swipe … a screen is presented over it … so none was sent") fires only once a read finds the target
**in the viewport** under the presented screen. A target that lies wholly below the fold, under the same presented screen, gets ordinary
swipes. The swipe lands on the presented layer.

**1. Contacts, New Contact sheet, discard popover up.** The draft has First name "Zz", then `close`. WDA lists `container 'dismiss
popup' id=PopoverDismissRegion 0,0 402x874` after the sheet, and the cell `container 'add instant message' 20,1306 362x52` lies below the
fold.

```
06:59:58 scroll_until { selector: 'role:button label:"Insert add phone"', configPath: <cfg-wda> }      (in the viewport, 39,577)
→ … stopped before any swipe — element is in the viewport but under container "dismiss popup" (0,0 402x874) … so none was sent.   ✔
07:01:45 scroll_until { selector: 'role:container label:"add instant message"', configPath: <cfg-wda> }   (17.0 s)
→ Element role:container label:"add instant message" fully visible after 1 swipe
```

- The shim logged `idb ui swipe 201 699 201 175 --duration 0.3` (`idb-calls.log` l.9).
- The popover was **closed** by the stroke, and the sheet scrolled (`img-36-0.png`: no popover, "add instant message" on screen).
- The reply does not mention the popover. A later step that expected the popover (e.g. `tap "Discard Changes"`) would fail with no
  explanation.

**2. mp-native SWIFT form, Fees half sheet up.** The dim is `container 'dismiss popup' id=PopoverDismissRegion -402,-874 1206x2622`, and
the grabber reads `Half screen` at y 411.

```
07:10:36 scroll_until { selector: "id:swift_payment.form.payee_street_input", configPath: <cfg-wda> }   (24,869 — 5 pt in the viewport)
→ … stopped before any swipe — element is in the viewport but under container "dismiss popup" … so none was sent.   ✔ (shim 47 → 47)
07:10:54 scroll_until { selector: "id:swift_payment.form.payee_city_input", configPath: <cfg-wda> }     (24,937 — below the fold, 5.2 s)
→ scroll_until id:swift_payment.form.payee_city_input failed after 2 swipes (the last 2, swiping down, did not move it: content
  exhausted, or the swipes were not taken) — element in tree but never intersected the 402x874 viewport (last rect
  {"x":24,"y":937,"width":354,"height":52})
```

- Two strokes were logged at l.48 and l.49 (`201 699 → 201 175`).
- The sheet went from `Half screen` to `Expanded` (grabber `"value": "Expanded"`, `"y": 58`, #99; `img-100-0.png`). The form beneath
  did not move.
- The reply blames "content exhausted, or the swipes were not taken". The real cause was a presented sheet that took the strokes.
- The fee selection was unchanged (OUR). A stroke the other way could have dismissed the sheet.

## Repro


1. mp-native, Account Detail → PAY → SWIFT payment. `tap id:swift_payment.form.fees_select` (keyboard down) opens the half sheet.
2. With `treeSource: wda`: `scroll_until id:swift_payment.form.payee_city_input` (or any field below y 874). Two swipes are sent and the
   sheet expands.
3. Or: Contacts → + → type in First name → `close` (discard popover). Then `scroll_until role:container label:"add instant message"`.
   One swipe is sent and the popover closes.

## Evidence


- `run14-ios/session.log` #35, #95, #98, #99
- `idb-calls.log` l.9, l.48, l.49
- `img-28-0.png` (popover up before), `img-36-0.png` (after); `img-92-0.png` (half), `img-100-0.png` (expanded)
- Raw trees: `D-contacts-discard-popover.json`, `D-swift-fees-sheet.json`
- Normalized tree: `A1-wda-fees-sheet.txt`

## Expected


The presented screen covers the whole viewport, so no swipe can reach the target's screen beneath. `scroll_until` should fail before any
swipe: `stopped before any swipe — … a screen is presented over the screen that holds it … close it first; … a swipe may dismiss it, so
none was sent`. This must hold whether or not the target already intersects the viewport. At the least, the reply after a swipe must not
say "fully visible" or "content exhausted" when a presented layer changed under the stroke.

## Suspected cause


The presented check is asked of the cover **at the target's rect**. While the target is off screen there is no in-viewport point to
judge, so the scroll loop runs as usual. Its stroke starts at (201,699), which is on the dim/sheet, not on the target's scroll view.
- A candidate: before the first swipe, test the stroke's start point (or the target's scroll container) for a presented surface listed
  after the target's screen. That is the same `presentedSurface` predicate, applied to where the swipe would land.
- A cheaper guard: refuse to swipe when a screen-filling presented leaf (a dim with no children, `PopoverDismissRegion`, a sheet scroll
  view) is listed after the target's window or branch.


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

**R15 A.1 Contacts, discard popover, keyboard down: holds.** Setup:
- `tap role:button label:Add` (#105).
- `type_text id:"First name" "Zz"` → `Filled id:"First name" (2 characters)` (#106).
- Title tap (#107), then `tap role:button label:close` (#108, l.42).
- The tree (#110, `contacts-popover-wda.txt`) lists `container 'dismiss popup' id=PopoverDismissRegion 0,0 402x874` and the cell `'add instant message' 20,1306 362x52 hidden`.

`scroll_until text:"add instant message"` (17:38:22, 5.3 s, #111):
`scroll_until text:"add instant message" stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on container "dismiss popup" (0,0 402x874) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect {"x":20,"y":1306,"width":362,"height":52} in a 402x874 viewport`
- The shim stayed at 42 lines through #111–#115.
- The popover is still up in `img-113-0.png`. Round 14 swiped here (l.9) and closed the popover.

**R15 A.2 Same, keyboard up: holds (no swipe). The keyboard is named only for a target in its band.**
- Setup: I set the prefs to 0 and relaunched Contacts. I focused First name with no HID typing (#144); `role:keyboard 0,573 402x301` was listed (#145). I typed one character with the soft key `tap role:other label:Z` (#149, l.59), then tapped `close` (#150, l.60).
- The popover and the keyboard were both up (`img-151-0.png`), and the tree (#152) lists `keyboard 0,573 402x301` and `PopoverDismissRegion 0,0 402x874`.
- `scroll_until text:"add instant message"` (17:44:18, #153):
  `… stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,459) on container "dismiss popup" (0,0 402x874) — a screen is presented over it … so none was sent. Last rect {"x":20,"y":1306,…}`
  - The touchdown moved above the keyboard (459, not 699).
  - The handoff expected `… lies below the keyboard's top edge …`. For a target this far below the fold the reply says `lies below the viewport`.
- A target in the keyboard band: `scroll_until role:button label:"Insert add phone"` (#154):
  `… stopped before any swipe — element lies under the soft keyboard: its centre (52,590) lies below the keyboard's top edge at y 573, and the next swipe would touch down at (201,459) on container "dismiss popup" (0,0 402x874) — a screen is presented over it … so none was sent.`
- The shim stayed at 60 lines through #152–#154. The popover and the keyboard are still up in `img-155-0.png`.
- End: `Discard Changes` (#156, l.61). The list shows the 6 stock contacts (`img-157-0.png`).

**R15 A.3 SWIFT Fees half sheet: holds.** `tap id:swift_payment.form.fees_select` (#47, l.24). The grabber reads `Half screen` at y 411 (`swift-fees-sheet-wda.txt`).
- `scroll_until id:swift_payment.form.payee_city_input` (rect `24,937`, 17:30:35, 2.4 s, #53):
  `… stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on scrollable (31,456 340x355) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect {"x":24,"y":937,"width":354,"height":52} in a 402x874 viewport`
- The same for `bank_country_select` (`24,1209`, #52).
- The shim stayed at 24 lines through #48–#60.
- The grabber still read `"value": "Half screen"`, `"y": 411` (#54), and the sheet is at its half detent in `img-55-0.png`. Round 14 swiped twice here (l.48–49), and the sheet went to `Expanded`.
- The sheet was closed with `fees_sheet.row_0` (#61, l.25). The field still reads `Fees*, OUR – All charges paid by the debtor` (#62).

**R15 A.4 smoke: holds.**
- **SWIFT form, no sheet:** `scroll_until id:swift_payment.form.payee_city_input` → `Element … fully visible after 1 swipe` (#65, l.26). Again at #71 (l.28).
- **Transactions tab:** `scroll_until id:transactions.list.row_12` → `fully visible after 1 swipe` (#91, l.33).
- **Contacts list:** `scroll_until … "Contact photo for Hank M. Zakroff"` → `fully visible after 0 swipes` (#97). The 6 contacts fit on one screen, so no swipe was needed.
- **Contacts sheet:** see C.3.
- **Safari b.html:** the second try found the link: `scroll_until role:text label:"Link number 30"` (`timeoutMs` 40000) → `fully visible after 3 swipes` (#171, l.64–66; the third stroke swiped back). The first try failed with no swipe after a WDA restart (see Gaps).
