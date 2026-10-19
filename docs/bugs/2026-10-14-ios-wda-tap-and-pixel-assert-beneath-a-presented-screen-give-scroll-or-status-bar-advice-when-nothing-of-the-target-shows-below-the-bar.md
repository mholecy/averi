# BUG: beneath a presented screen, a tap on a target wholly off screen or wholly under the status bar says "scroll_until it first", and a colour/ocr assert under the status bar gives the bar's advice — `scroll_until` on the same target refuses because of the presented screen

**Measured 2026-10-14 17:30–17:38 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). averi = mobile-verify `arch/round-16` @ `ebe6822` (HTTP daemon on port 47913), scratch `treeSource: wda` (`run16-ios/cfg-wda.yaml`). Found during the round-16 device check, items A.1 and A.2. This is a residual of the round-16 change "one remedy for a target the agent cannot reach (ADR 0018 residual 8 amended)".

## Symptom


Round 16 gives the tap the presented remedy when the target is partly off screen beneath a presented screen. That works when some of the target lies on screen below the status bar:
`id:swift_payment.form.payee_street_input is off screen at (201,895) … only 10% of it (rect 24,869 354x52) is on screen … — a screen is presented over it (a modal or a sheet) — close it first; …` (#49).

It does not work when nothing of the target lies on screen below the status bar. The reply then gives the advice a non-presented screen would get. That advice cannot be followed: `scroll_until` on the same target refuses to swipe, because of the presented screen.

**1. Wholly below the screen, mp-native SWIFT form, Fees half sheet up** (`PopoverDismissRegion 'dismiss popup' -402,-874 1206x2622`, grabber `Half screen` y 411):
```
17:30:27 tap { selector: "id:swift_payment.form.bank_country_select" }        (rect 24,1209 354x52)
→ id:swift_payment.form.bank_country_select is off screen at (201,1235) on a 402x874 screen (rect 24,1209 354x52) — scroll_until it first; nothing was tapped
17:30:32 scroll_until { selector: "id:swift_payment.form.bank_country_select" }
→ … stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on scrollable (31,456 340x355) — a screen is presented over it (a modal or a sheet) — close it first; … so none was sent.
```

**2. Wholly below the screen, Contacts New Contact sheet, discard popover up** (`PopoverDismissRegion 0,0 402x874`):
```
17:38:22 scroll_until { selector: 'text:"add instant message"' }  → stopped before any swipe … on container "dismiss popup" … close it first …
17:38:41 tap { selector: 'role:text label:"add instant message"' } → … is off screen at (201,1332) on a 402x874 screen (rect 20,1306 362x52) — scroll_until it first; nothing was tapped
```

**3. Wholly under the status bar, SWIFT form scrolled, Payee's country half sheet up** (`PopoverDismissRegion -402,-874 1206x2622`, grabber `Half screen` y 411). `priority_select` is at `24,-20 354x52`, marked `hidden` (beneath the sheet). Its on-screen part, y 0–32, is entirely under the 62 pt status bar.
```
17:33:53 tap { selector: "id:swift_payment.form.priority_select" }
→ … is under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 24,-20 354x52) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped
17:33:56 tap { selector: "id:swift_payment.form.fees_select" }         (rect 24,-88, wholly above)
→ … is off screen at (201,-62) … — scroll_until it first; nothing was tapped
17:33:59 scroll_until { selector: "id:swift_payment.form.priority_select", direction: "up" }
→ … its centre stays under the status bar at (201,6) … and the next swipe would touch down at (201,175) on container "dismiss popup" (-402,-874 1206x2622) — a screen is presented over it (a modal or a sheet) — close it first; … so none was sent.
17:34:02 assert color { element: { id: "swift_payment.form.priority_select" }, expected #FFFFFF }
→ FAIL … — the status bar is drawn over the element (element 24,-20 354x52, status bar 0,0 402x62) — the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run — or, if no scroll moves it out from under that, assert something in it that lies clear of that; failing closed, color unchecked
17:34:08 assert ocr  { … "Standard" }  → the same status-bar advice, rendered text unchecked
```

The tap's description says the presented remedy applies "whatever else keeps the target from a tap — its centre under that screen, off the screen or under the status bar". The assert's description says it applies "whatever else lies over it — the status bar …".

## Repro


1. mp-native → Account Detail → PAY → SWIFT payment, keyboard down, `treeSource: wda`. `tap id:swift_payment.form.fees_select` opens the half sheet. Then `tap id:swift_payment.form.bank_country_select` and `scroll_until` it.
2. Close the sheet. `scroll_until id:swift_payment.form.payee_city_input` scrolls the form, putting `priority_select` at `24,-20`. `tap id:swift_payment.form.payee_country_select` opens the country half sheet. Then `tap id:swift_payment.form.priority_select` and colour/ocr assert on it. Close the sheet by tapping its dim, with no selection.
3. Contacts → + → type in First name → `close` (discard popover) → `tap role:text label:"add instant message"`.

## Evidence


- `run16-ios/session.log` #50, #52, #79–#83, #111, #114
- `idb-calls.log`: no line was logged for any of these calls (l.24 before, l.25 after on the Fees sheet; l.29–30 around the country sheet; l.42 under the popover)
- Normalized trees: `swift-fees-sheet-wda.txt`, `swift-country-sheet-wda.txt`, `contacts-popover-wda.txt`. Raw: `swift-fees-sheet-wda.json`, `swift-country-sheet-wda.json`, `contacts-popover-wda.json`
- Images: `img-55-0.png` (Fees sheet), `img-78-0.png` (country sheet), `img-113-0.png` (popover)

## Expected


One remedy, presented first, for tap, colour/ocr and `scroll_until`. For each target above, the reply should end `— a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped` (for an assert, `… failing closed, … unchecked`). It should not say `scroll_until it first`, which `scroll_until` then refuses.

## Suspected cause


The presented test is asked of a cover found over the target's **on-screen part below the status bar**: its centre, or its clipped rect. A target with no such part produces no cover, so the decision falls through to "off screen" or "under the status bar".

`scroll_until` already answers the same question differently. It tests where the next stroke would touch down, and for a target in the tree it also tests the order of presentation (the presented branch listed after the target's window). The tap and the assert could use the same predicate:
- the target lies in a branch listed before a presented surface (a `PopoverDismissRegion`, a dim leaf or a sheet scroll view) in the same window; or
- the target is `hidden` and such a surface exists.

Either predicate holds independently of how much of the target lies on screen.


## Device check (2026-10-14 iOS, re-run at 84f51e6)

Measured 2026-10-14 20:00:50–20:12:50 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-17` @ `84f51e6`; `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed `84f51e6` (read-only, detached, no git writes). averi ran through the HTTP daemon on port 47923 (session connected 19:58:53, server `averi 0.9.0`); call numbers are from `session.log`. Device pinned with `select_device` (#2). Configs: `cfg-wda.yaml` copied unchanged from `run16-ios/` (= mp-native's `averi.yaml` + `treeSource: wda`); idb-path calls (`login_pin_ios_here`) used mp-native's own `averi.yaml`. **WDA:** started by averi on the first `cfg-wda` call (#6, 20:01:20; xcodebuild pid 50231, WebDriverAgent pid 50346); no restart happened during the run (nothing in `session.log`/`daemon.out`); stopped at 20:12:50 by killing xcodebuild 50231 — both pids gone, `lsof -iTCP:8100 -sTCP:LISTEN` empty. **Keyboard prefs:** `AutomaticMinimizationEnabled = 1`, `HardwareKeyboardLastSeen = 1` at start and end; not changed. **PIN re-login:** the SWIFT form showed "That's an error" (`img-9-0.png`); terminate + launch (no clearState, #10–#11) showed "Enter your PIN to log in" (`img-12-0.png`); `login_pin_ios_here` (no `requires:`) ran once (#13, `branch: matched state logged_in`); its PIN-pad lines are shim l.3–6 and are not quoted. No `login` rung, nothing registered, no credentials typed. A local web server served `run13-ios/www` on 127.0.0.1:47925 from ~20:08:50 to 20:10:40 (stopped, port closed). The shim logged 32 lines to `idb-calls.log`. No Android, adb or port 47921 was touched.

**A.1 Fees half sheet, wholly off-screen field: holds.** Setup: SWIFT form at rest, `tap id:swift_payment.form.fees_select` (#19, l.9). Tree (#20, `swift-fees-sheet.txt`): `PopoverDismissRegion 'dismiss popup' -402,-874 1206x2622`, `Sheet Grabber` `Half screen` `152,411 98x24`, sheet `scrollable 31,456 340x355`; `bank_country_select 24,1209 354x52 hidden`, `payee_street_input 24,869 354x52 hidden`.
- `tap id:swift_payment.form.bank_country_select` (20:03:09, 2.8 s, #21):
  `id:swift_payment.form.bank_country_select is off screen at (201,1235) on a 402x874 screen (rect 24,1209 354x52) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- `tap id:swift_payment.form.payee_street_input` (#22):
  `id:swift_payment.form.payee_street_input is off screen at (201,895) on a 402x874 screen — only 10% of it (rect 24,869 354x52) is on screen, and a tap goes to its centre — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- colour on `bank_country_select` (#23): `FAIL  element id:"swift_payment.form.bank_country_select" fill within dE00 8 of #FFFFFF — nothing of the element lies on the screen (element 24,1209 354x52, screen 0,0 402x874) — a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`
- ocr on it (#24): `FAIL  element id:"swift_payment.form.bank_country_select" renders text "Payee’s bank country*" — nothing of the element lies on the screen (element 24,1209 354x52, screen 0,0 402x874) — a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, rendered text unchecked`
- `scroll_until id:…bank_country_select` (#25): `… stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on scrollable (31,456 340x355) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect {"x":24,"y":1209,"width":354,"height":52} in a 402x874 viewport`
- `scroll_until id:…payee_street_input` (#26): `… stopped before any swipe — element is in the viewport but under container "dismiss popup" (-402,-874 1206x2622), drawn over it — 0% of it shows — a screen is presented over it … so none was sent. Last rect {"x":24,"y":869,"width":354,"height":52} …`
- Shim stayed at 9 lines through #21–#30. Grabber still `"value": "Half screen"`, `"y": 411` (#29); sheet at its half detent in `img-30-0.png`. Sheet closed with `fees_sheet.row_0` (OUR, already selected; #31, l.10); `fees_select` still reads `Fees*, OUR – All charges paid by the debtor` (#32, `swift-closed-rest.txt`).

**A.2 Contacts New Contact sheet, discard popover: holds.** `tap role:button label:Add` (#83, l.27), `type_text id:"First name" "Zz"` → `Filled id:"First name" (2 characters)` (#84, l.28–29), title tap (#85, l.30), `tap role:button label:close` (#86, l.31). Popover up (`img-87-0.png`); tree (#88, `contacts-popover.txt`): `PopoverDismissRegion 'dismiss popup' 0,0 402x874`, `text 'add instant message' 20,1306 362x52 hidden`, `keyboard 0,573 402x301`.
- `tap role:text label:"add instant message"` (20:11:55, 5.4 s, #89):
  `role:text label:"add instant message" is off screen at (201,1332) on a 402x874 screen (rect 20,1306 362x52) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
  No shim line (31 → 31). Round 16 #114 said `scroll_until it first`.
- End: `Discard Changes` (#90, l.32). The list shows the 6 stock contacts (`img-91-0.png`); nothing saved, nobody called.

**A.3 Status bar beneath the Payee's country sheet: holds.** Form scrolled with `scroll_until id:…payee_city_input` → `fully visible after 1 swipe` (#39, l.11); `priority_select 24,-20 354x52` (#40, `swift-scrolled.txt`). `tap id:…payee_country_select` (#44, l.12); tree (#45, `swift-country-sheet.txt`): dismiss region `-402,-874 1206x2622`, grabber `Half screen` y 411, `priority_select 24,-20 354x52 hidden`.
- `tap id:swift_payment.form.priority_select` (20:07:20, 3.0 s, #47):
  `id:swift_payment.form.priority_select is under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 24,-20 354x52) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- colour (#48): `FAIL  element id:"swift_payment.form.priority_select" fill within dE00 8 of #FFFFFF — the status bar is drawn over the element (element 24,-20 354x52, status bar 0,0 402x62) — the capture would show it, not the element; a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`
- ocr (#49): the same, ending `… close it first; no scroll moves the element out from under that screen; failing closed, rendered text unchecked`.
- Extra, wholly above the screen beneath the sheet: `tap id:…fees_select` (`24,-88`, #52) → `… is off screen at (201,-62) on a 402x874 screen (rect 24,-88 354x52) — a screen is presented over it (a modal or a sheet) — close it first; …; nothing was tapped` (round 16 #80: `scroll_until it first`).
- Shim 12 → 12 through #45–#52. Sheet closed by a coordinate tap on its dim (#53, l.13 `201 330`); Payee's country still empty (`img-54-0.png`).

**A.4 Smoke: holds.**
- No sheet, partly off screen: `tap id:…payee_street_input` (form at rest) → `id:swift_payment.form.payee_street_input is off screen at (201,895) on a 402x874 screen — only 10% of it (rect 24,869 354x52) is on screen, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped` (#38).
- No sheet, under the status bar: `tap id:…priority_select` (form scrolled) → `… is under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 24,-20 354x52) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped` (#42). Colour on it (#43): `… the status bar is drawn over the element (element 24,-20 354x52, status bar 0,0 402x62) — … scroll_until the element with `fully: true` first and re-run — or, if no scroll moves it out from under that, assert something in it that lies clear of that; failing closed, color unchecked`.
- Colour/ocr on an element partly visible beneath the sheet: `bank_street_input 24,372 354x52` (straddles the country sheet's top edge, its upper part over the dim) — colour (#50) `FAIL … — container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 24,372 354x52) — the capture would show it, not the element; a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`; ocr (#51) the same ending.
