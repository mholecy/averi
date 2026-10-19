# iOS: a colour assert on a row outside its scroll view's clip measures the background beneath and passes

## Symptom


On mp-native's SWIFT form at rest (no sheet), `swift_payment.form.payee_street_input` has the tree rect `24,869 354x52`: by its rect, 5 pt of it lie on the 402×874 screen. But the form's scroll view is `0,0 402x780` and the CONTINUE bar (`24,780 354x44`) is drawn outside it, so nothing of the field is drawn — the strip y 869–874 shows the screen background. The colour assert samples that strip and PASSes:

```
#33 assert color { element: { id: "swift_payment.form.payee_street_input" }, expected "#FFFFFF", deltaE 8 }
→ PASS  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #FFFFFF — sampled #DEE0E6 (dominant, 96% of region) vs expected #FFFFFF → dE00 7.16 ≤ 8; scale 3.000; clipped 90% off-png — the remaining sliver's dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row
#35 … expected "#DEE0E6", deltaE 3 → PASS … sampled #DEE0E6 … dE00 0.00 ≤ 3 …
```

The ocr assert on the same element fails closed (`the recognizer read no text in this element rect …`, #36), and `tap` refuses it (`only 10% of it … is on screen … — scroll_until it with fully: true first`, #38). Only the colour assert reports a result for pixels that do not belong to the element. Round 17's fix (cover region = sampled region, clipped to the screen) does not cover this case: the clip it applies is the screen's, not the scroll view's.

## Repro


1. iOS, `treeSource: wda`, mp-native logged in, Home → PAY → `SWIFT payment`; form at rest, no sheet, keyboard down.
2. `ui_snapshot`: `scrollable 0,0 402x780`, `continue_button 24,780 354x44`, `payee_street_input 24,869 354x52` (no `hidden` flag).
3. `assert` colour on `id:swift_payment.form.payee_street_input` expecting `#FFFFFF` (dE 8), then expecting `#DEE0E6` (dE 3).

## Evidence


- Calls #32–#38 of `run17-ios/session.log` (20:04:17–20:06:20 UTC), averi `arch/round-17` @ `84f51e6`, iPhone 17 iOS 27.0.
- `run17-ios/swift-closed-rest.txt` (averi tree), `swift-closed-rest-wda.json` (raw WDA: `Other swift_payment.form.payee_street_input rect {x 24, y 869, w 354, h 52} isVisible 0`; `ScrollView 0,0 402x780 isVisible 1`; `Button continue_button 24,780 354x44 isVisible 1`), `swift-closed-rest-idb.json` (idb lists the field's text at `42,885`).
- `run17-ios/img-34-0.png`: below the CONTINUE bar (y 824–874) only the background is drawn; no field.

## Expected


The assert reads only pixels the element draws. Its visible region is its rect clipped to the screen **and to every ancestor scroll view (clipping container)**. Here that region is empty, so the reply should be the off-screen sentence — `nothing of the element lies on the screen …` naming the scroll view's bottom (780) — with the scroll advice (`scroll_until it first`), as round 17 now does for an element off the screen.

## Suspected cause


The colour assert clips the sampled region to the screen (round 17), not to the element's scroll-view ancestors; iOS WDA reports unclipped content rects for scroll-view children, so a child below the scroll view's frame looks "partly on screen". WDA's `isVisible 0` on the node, and its rect lying wholly outside its `ScrollView` ancestor's rect, are both in the source but unused. The ocr assert fails only because nothing legible is there (no guard), and `tap` refuses for an unrelated reason (centre off screen) — a row whose centre lies on screen but below its scroll view (e.g. between 780 and 874) would likely be tapped on the background or the bar.


## Device check (2026-10-15 iOS, re-run at dda435b)

Measured 2026-10-15 09:11:37–09:32:30 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-18` @ `dda435b`; `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed `dda435b` (read-only, detached, no git writes, not rebuilt). averi ran through the HTTP daemon on port 47933 (session connected 09:01:34, server `averi 0.9.0`); call numbers are from `session.log` (#1–#3 were the orchestrator's screenshots; #4 was my `select_device` with a wrong argument name, rejected by schema validation). Device pinned with `select_device` (#6). Configs: `cfg-wda.yaml` (= mp-native's `averi.yaml` + `treeSource: wda`) for every WDA call; idb-path calls (`login_pin_ios_here`, B.2) used mp-native's own `averi.yaml`. The tool list as served is saved in `tools.json` (`__list`). **WDA:** started by averi on the first `cfg-wda` call (#7, 09:12:03; xcodebuild pid 94735, WebDriverAgentRunner pid 94738); no restart happened during the run (nothing in `session.log`/`daemon.out`); stopped at 09:32:30 by killing xcodebuild 94735 — both pids gone, `lsof -iTCP:8100 -sTCP:LISTEN` empty. **PIN re-login:** Home showed "That's an error" (`img-9-0.png`) and TRY AGAIN (#10, l.2) did not clear it (`img-11-0.png`); terminate + launch (no clearState, #12–#13) showed "Enter your PIN to log in" (`img-14-0.png`); `login_pin_ios_here` (no `requires:`) ran once (#15, `branch: matched state logged_in`); its PIN-pad lines are shim l.3–6 and are not quoted. No `login` rung, nothing registered, no credentials typed. The shim logged 62 lines to `idb-calls.log`. Keyboard prefs were not read (the `com.apple.iphonesimulator` domain returned no such keys) and not changed; the hardware keyboard stayed connected throughout (no software keyboard ever appeared, see A.4). **Operator error, recorded:** #51 tapped the country sheet's `Uganda` row by mistake (a shell line I meant to skip still ran): Payee's country became Uganda on an unsubmitted form, which was later discarded (#86, #105). No payment was created; CONTINUE / CONFIRM / certify were never pressed; the fee stayed OUR; no payee text was typed. No Android, adb or port 47931 was touched; nothing was written outside `run18-ios`.

**A.1 SWIFT form at rest: holds.** Setup: Home → `accounts.detail.action_pay` (#17, l.7) → `text:"SWIFT payment"` (#18, l.8); form at rest, no sheet, no keyboard (`img-19-0.png`). Tree (#20, `swift-rest.txt`): root `"unclippedFrames": true`; `scrollable 0,0 402x780`; `continue_button 24,780 354x44`; `payee_name_input 24,801 354x52`; `payee_street_input 24,869 354x52`; neither carries `hidden`. Raw WDA in `swift-rest-wda.json`.
- `tap id:swift_payment.form.payee_name_input` (09:14:32, 2.6 s, #21):
  `id:swift_payment.form.payee_name_input is outside its scroll view scrollable (0,0 402x780) at (201,827): nothing of it is drawn (rect 24,801 354x52) — scroll_until it first; nothing was tapped`
  Shim 8 → 8 (no tap). Round 17 would have said `Tapped` at (201,827).
- colour on `payee_street_input` expecting white (#22, 6.6 s):
  `FAIL  element id:"swift_payment.form.payee_street_input" fill within dE00 8 of #FFFFFF — nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780) (element 24,869 354x52, screen 0,0 402x874) — scroll it into view: scroll_until the element first and re-run; failing closed, color unchecked`
  Expecting the background `#DEE0E6` dE 3 (#23): the same sentence, `failing closed, color unchecked` (round 17 #33/#35 PASSed both).
- ocr "Payee’s street" (#24, 6.6 s): `FAIL … renders text "Payee’s street" — nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780) (element 24,869 354x52, screen 0,0 402x874) — scroll it into view: scroll_until the element first and re-run; failing closed, rendered text unchecked`.
- Extra: colour on `payee_name_input` (rect `24,801`, centre on screen) (#25): same `nothing of the element is drawn … outside its scroll view scrollable (0,0 402x780) (element 24,801 354x52 …)` sentence. Shim still 8 after #21–#25.
- `scroll_until id:…payee_name_input direction:down` (09:15:06, 5.7 s, #26): `Element id:swift_payment.form.payee_name_input fully visible after 1 swipe` — one stroke, l.9 `201 699 201 175`. Tree after (#27, `swift-scrolled1.txt`): `payee_name_input 24,100 354x52`, `continue_button 24,780` unchanged. (The form's top bar covers ~0–116, so the field's top 16 pt are under it — `img-28-0.png`; see Gaps.)
- `tap id:…payee_name_input` (#29): `Tapped id:swift_payment.form.payee_name_input`, l.10 `201 126`. The field took the focus: caret and dark border in `img-31-0.png`; tree `payee_name_input 23,99 356x54` (focus ring) in `swift-name-focused.txt` (#30).

**A.3 Partly drawn row: holds.** From the top (`scroll_until id:…debit_select up fully` #32, l.11), a slow nudge `swipe 201,600 → 201,550` (#33, l.12) moved the content 40 pt (`priority_select 24,641`).
- Centre below 780: `payee_name_input 23,760 356x54` (focused; centre y 787), `continue_button 24,780 354x44` (#35, `swift-straddle1.txt`). `tap` (09:16:58, 3.7 s, #36):
  `id:swift_payment.form.payee_name_input is outside its scroll view scrollable (0,0 402x780) at (201,787): only 37% of it (rect 23,760 356x54) is drawn, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped`
  Shim 12 → 12. 37% = 20/54, matches.
  Extra: colour on the same field (#37): `PASS … fill within dE00 8 of #FFFFFF — sampled #FDFDFD (dominant, 100% of region) vs expected #FFFFFF → dE00 0.40 ≤ 8; scale 3.000` — the drawn strip y 760–780 is the field's own white; no CONTINUE cover named.
- Centre above 780: nudge `201,600 → 201,570` (#38, l.13) → `payee_name_input 23,740 356x54` (centre 767, 74% drawn), `payee_street_input 24,809 354x52`, CONTINUE `24,780` (#39, `swift-straddle2.txt`; `img-43-0.png` shows the field cut at the CONTINUE bar's top).
  - colour (09:17:28, 4.2 s, #40): `PASS  element id:"swift_payment.form.payee_name_input" fill within dE00 8 of #FFFFFF — sampled #FDFDFD (dominant, 98% of region) vs expected #FFFFFF → dE00 0.40 ≤ 8; scale 3.000` — measured; CONTINUE (which lies only below 780) not named.
  - ocr "Payee’s name" (#41): `FAIL … renders text "Payee’s name" — read "Payee's name"; vs expected "Payee’s name" ≠` — the region was read; the mismatch is only the apostrophe (NEW note below). With a straight `'` (#44): `PASS … read "Payee's name"; vs expected "Payee's name" =`.
  - colour on `payee_street_input 24,809` (wholly below 780 but on screen) (#42): `FAIL … nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780) (element 24,809 354x52, screen 0,0 402x874) — scroll it into view: scroll_until the element first and re-run; failing closed, color unchecked`.
- Same shape on the country sheet expanded (list `scrollable 24,105 354x711`, `country-after-row7.txt` #58):
  - `row_2 'Kosovo' 24,75 354x44` (cut at the list's top, centre 97 < 105) → `id:swift_payment.form.payee_country_sheet.row_2 is outside its scroll view scrollable (24,105 354x711) at (201,97): only 32% of it (rect 24,75 354x44) is drawn, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped` (#60).
  - `row_17 'Virgin Islands (U.S.)' 24,795 354x44` (cut at the bottom, centre 817 > 816) → `… scrollable (24,105 354x711) at (201,817): only 48% of it (rect 24,795 354x44) is drawn … nothing was tapped` (#61). Colour on it (#62) `PASS … sampled #FFFFFF (dominant, 99% of region) … dE00 0.00 ≤ 8` (drawn part measured).
  - `row_18 24,843` wholly below the list → colour `FAIL … nothing of the element is drawn: it lies outside its scroll view scrollable (24,105 354x711) (element 24,843 354x44, screen 0,0 402x874) — scroll it into view: scroll_until the element first and re-run; failing closed, color unchecked` (#63). Shim 19 → 19 across #60–#63.

**A.2 Country sheet open, row past the list's bottom: holds (reply names the scroll view; advice is scroll, not close).** `scroll_until id:…payee_country_select fully` (#45, l.14), `tap` it (#46, l.15). Tree (#47, `swift-country-sheet.txt`): dismiss region `-402,-874 1206x2622`, grabber `Half screen` `152,411 98x24`, `payee_country_sheet 31,438 340x373`, list `scrollable 31,456 340x355` (bottom 811); `row_7 'Uganda' 31,779 340x43`, `row_8 'Ukraine' 31,825 340x43`, its text `48,836 57x21 hidden`. `img-48-0.png`: Uganda is the last drawn row; nothing below 811.
- `tap role:text label:"Ukraine"` (09:18:47, 2.9 s, #49):
  `role:text label:"Ukraine" is outside its scroll view scrollable (31,456 340x355) at (77,847): nothing of it is drawn (rect 48,836 57x21) — scroll_until it first; nothing was tapped`
- `tap id:…payee_country_sheet.row_8` (#50): `id:swift_payment.form.payee_country_sheet.row_8 is outside its scroll view scrollable (31,456 340x355) at (201,847): nothing of it is drawn (rect 31,825 340x43) — scroll_until it first; nothing was tapped`. Shim 15 → 15.
  The handoff expected `… close it first …` (beneath the sheet). The row belongs to the sheet's own list, not to the screen beneath it, so the scroll advice is the right one (ADR 0018: a row of the presented screen itself is swiped for on its own screen); I record it as holding.
- `scroll_until role:text label:"Ukraine"` from a freshly opened sheet (grabber `"value": "Half screen"` in #78) (09:21:55, 12.0 s, #79): `Element role:text label:"Ukraine" fully visible after 2 swipes` — l.32 `201 699 201 175`, l.33 `201 175 201 437`. **The sheet did not stay at its detent**: after it, grabber `'Expanded' 151,58 100x24`, list `24,105 354x711`, Ukraine `24,343 354x45` (`country-after-ukraine.txt` #80, `img-81-0.png`). The first stroke touched down at (201,699) on the sheet's list and dragged the sheet to its full detent; the reply does not mention it (see Gaps).
- (Before that, #51 `Tapped role:text label:"Uganda"` l.16 `78 801` — the operator error above; it shows a row 74% drawn with its centre (78,801) inside the list (< 811) being tapped normally; Uganda got selected and the sheet closed, `img-54-0.png`.)

**A.5 `fully` at a scroll view's edge: partial — wording not reached.**
- Country sheet, half detent, `row_7 'Uganda' 31,779 340x43` cut by the list's bottom at 811 (74% drawn) (#56 `swift-country-sheet2.txt`). `scroll_until id:…payee_country_sheet.row_7 fully:true` (09:19:46, 12.0 s, #57): `Element id:swift_payment.form.payee_country_sheet.row_7 fully visible after 2 swipes` — l.18 `201 699 201 175`, l.19 `201 175 201 437`. The first stroke expanded the sheet (grabber `Expanded`, list `24,105 354x711`, Uganda `24,315 354x44`, `country-after-row7.txt` #58, `img-59-0.png`), so the list could bring the row whole and the `scrollable (31,456 340x355) … N% of it is drawn` sentence did not arise. `no clearance for an overlay` never appeared.
- The list's end: ten flings (#64–#73, l.20–29) reached `row_248 'Azerbaijan' 24,771 354x45`, flush with the list's bottom (816) (`country-end.txt` #74) — no row is cut at the content's end, so `… its content ends before the element does …` is not reachable on this list.
- Contacts, New Contact sheet (`contacts-new.txt` #142): sheet `scrollable 0,62 402x812`, grabber `Expanded`. A slow swipe `201,700 → 201,340` (#143, l.60) left `textfield 'First name' 36,56 330x22` cut by the scroll view's top at 62 (`contacts-scrolled.txt` #144, `img-145-0.png`). `scroll_until id:"First name" direction:up fully:true` (09:31:04, 19.2 s, #146): `Element id:"First name" fully visible after 1 swipe` (l.61 `201 175 201 699`; field back at `36,406`, `contacts-after-fn.txt` #147). The content can scroll back, so `… begins after the element does …` did not arise; at the top the first content (`Add photo 113,132`) is not cut, so the wording is not reachable here either. The sheet was closed with `close` (#148, l.62); the list shows the 6 stock contacts (`img-149-0.png`), nothing saved.
