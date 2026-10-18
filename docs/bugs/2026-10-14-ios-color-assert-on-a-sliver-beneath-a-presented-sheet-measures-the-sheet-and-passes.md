# BUG: a colour assert on a field only a sliver of which is on screen, beneath a presented sheet, samples the sheet and can PASS — ocr on the same element fails closed with the presented remedy

**Measured 2026-10-14 17:31 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). averi = mobile-verify `arch/round-16` @ `ebe6822` (HTTP daemon on port 47913), scratch `treeSource: wda` (`run16-ios/cfg-wda.yaml`). Found during the round-16 device check, item A.3.

## Symptom


mp-native SWIFT form, keyboard down, Fees half sheet up. The tree lists `PopoverDismissRegion 'dismiss popup' -402,-874 1206x2622`, the grabber is `Half screen` at y 411, and the sheet covers y 411–874.

`swift_payment.form.payee_street_input` is at `24,869 354x52`: 5 pt of it are on screen, at y 869–874, and the sheet is drawn over that strip. A tap on it is refused with the presented remedy (#49), and so are an ocr assert (#60) and `scroll_until` (#51). The colour assert, however, measures the sheet's pixels:

```
17:31:07 assert color { element: { id: "swift_payment.form.payee_street_input" }, expected "#FFFFFF", deltaE 8 }
→ FAIL … sampled #A6A7AB (dominant, 100% of region) vs expected #FFFFFF → dE00 20.96 > 8; scale 3.000; clipped 90% off-png — the remaining sliver's dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row
17:31:24 assert color { …, expected "#A6A7AB", deltaE 8 }
→ PASS  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #A6A7AB — sampled #A6A7AB (dominant, 100% of region) … clipped 90% off-png — … scroll it fully on-screen and re-run to trust this row
17:31:27 assert ocr { …, text "Payee’s street" }
→ FAIL … container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 24,869 354x52) — … a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, rendered text unchecked
```

- The PASS reports the colour of the presented sheet (`#A6A7AB`, its dimmed grey), not the field's white fill.
- The advice, "scroll it fully on-screen", cannot be followed: `scroll_until` refuses to swipe here (#51).
- The FAIL with expected white is right for the wrong reason, and it gives the same impossible advice.

## Repro


1. mp-native → Account Detail → PAY → SWIFT payment (pristine form, keyboard down), `treeSource: wda`.
2. `tap id:swift_payment.form.fees_select` (half sheet).
3. `assert` colour on `id:swift_payment.form.payee_street_input`, once with `#FFFFFF` and once with `#A6A7AB`, then ocr on it.

## Evidence


- `run16-ios/session.log` #56–#60, #49, #51
- Normalized tree `swift-fees-sheet-wda.txt`, raw `swift-fees-sheet-wda.json`, image `img-55-0.png`
- No shim line was logged (l.24 before and after)

## Expected


The colour assert should fail closed like the ocr assert: `… a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`. It should never PASS on pixels of a presented screen.

## Suspected cause


The colour assert judges covers over the **rect inset 12 % a side**. The ocr assert judges them over the whole rect.
- For `24,869 354x52` the inset rect is y ≈ 875–915, entirely below the 874 pt screen. The cover check over it finds nothing (no point on the screen), so no presented cover is found.
- The sampler then clips the region to the PNG and samples the 5 pt sliver at y 869–874, which shows the sheet ("clipped 90% off-png").
- Fix candidates:
  - Run the presented test on the clipped region the sampler actually reads, or on the whole rect as ocr does.
  - Or use the order-of-presentation predicate suggested in the sibling note `2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md`.


## Device check (2026-10-14 iOS, re-run at 84f51e6)

Measured 2026-10-14 20:00:50–20:12:50 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-17` @ `84f51e6`; `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed `84f51e6` (read-only, detached, no git writes). averi ran through the HTTP daemon on port 47923 (session connected 19:58:53, server `averi 0.9.0`); call numbers are from `session.log`. Device pinned with `select_device` (#2). Configs: `cfg-wda.yaml` copied unchanged from `run16-ios/` (= mp-native's `averi.yaml` + `treeSource: wda`); idb-path calls (`login_pin_ios_here`) used mp-native's own `averi.yaml`. **WDA:** started by averi on the first `cfg-wda` call (#6, 20:01:20; xcodebuild pid 50231, WebDriverAgent pid 50346); no restart happened during the run (nothing in `session.log`/`daemon.out`); stopped at 20:12:50 by killing xcodebuild 50231 — both pids gone, `lsof -iTCP:8100 -sTCP:LISTEN` empty. **Keyboard prefs:** `AutomaticMinimizationEnabled = 1`, `HardwareKeyboardLastSeen = 1` at start and end; not changed. **PIN re-login:** the SWIFT form showed "That's an error" (`img-9-0.png`); terminate + launch (no clearState, #10–#11) showed "Enter your PIN to log in" (`img-12-0.png`); `login_pin_ios_here` (no `requires:`) ran once (#13, `branch: matched state logged_in`); its PIN-pad lines are shim l.3–6 and are not quoted. No `login` rung, nothing registered, no credentials typed. A local web server served `run13-ios/www` on 127.0.0.1:47925 from ~20:08:50 to 20:10:40 (stopped, port closed). The shim logged 32 lines to `idb-calls.log`. No Android, adb or port 47921 was touched.

**B.1 Sliver beneath the Fees sheet: holds (FAIL, never PASS).** Tree rect `swift_payment.form.payee_street_input` = `{"x":24,"y":869,"width":354,"height":52}` (#20) — 5 pt on screen (y 869–874), so the sliver sentence does not apply.
- Expecting the sheet's colour (20:03:40, 6.1 s, #27): `FAIL  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #A6A7AB — container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 24,869 354x52) — the capture would show it, not the element; a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen; failing closed, color unchecked`
- Expecting white (#28): the same reply. Round 16 #59 PASSed on `#A6A7AB`.

**B.2 Sheet closed, same field at the bottom: changed reply shape as designed, but what it measures is not the field** (NEW note below). The field cannot be cut by the screen's bottom edge on this form: the form's scroll view is `0,0 402x780` and the CONTINUE bar `24,780 354x44` sits outside it (#32, `swift-closed-rest.txt`). At rest the field is at `24,869 354x52` — 5 pt inside the screen by its rect, but wholly below its scroll view's bottom (780), so nothing of it is drawn (`img-34-0.png`: plain background below CONTINUE). WDA's raw source marks it `isVisible 0` (`swift-closed-rest-wda.json`); averi's tree carries no `hidden` flag for it.
- colour expecting white (20:04:20, 2.8 s, #33): `PASS  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #FFFFFF — sampled #DEE0E6 (dominant, 96% of region) vs expected #FFFFFF → dE00 7.16 ≤ 8; scale 3.000; clipped 90% off-png — the remaining sliver's dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row`
- colour expecting the background (#35, dE 3): `PASS … fill within dE00 3 of #DEE0E6 — sampled #DEE0E6 (dominant, 96% of region) … dE00 0.00 ≤ 3; … clipped 90% off-png …` — the sampled pixels are the screen background beneath the scroll view.
- ocr "Payee’s street" (#36, 35.5 s): `FAIL … the recognizer read no text in this element rect (likeliest first: the element is off-screen or occluded in this capture, …); failing closed, rendered text unchecked`.
- The ≤ 2 pt case was not reachable: the field's lowest position is its at-rest position (scroll offset 0).
