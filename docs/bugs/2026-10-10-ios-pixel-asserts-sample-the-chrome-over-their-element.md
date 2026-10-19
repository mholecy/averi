# BUG: color and ocr asserts measure whatever is drawn over their element — the status bar or a pinned CONTINUE — without saying so; a color assert under the status bar PASSES

**Measured 2026-10-10 06:38 UTC**, iPhone 17 simulator iOS 27.0 (402×874 pt), mp-native SWIFT form, averi = mobile-verify `fix/round-7` @
`35d5997` (idb, mp-native's own `averi.yaml`). Found during the round-7 device check (exploration, not a checklist item).

## Observed

The tap path refuses both shapes below (T-1 and P-1 of the pinned-chrome note). The pixel asserts on the same elements, a few seconds
later, on the same screen:

1. `swift_payment.form.value_date_select` at `24,30 354x52` — its centre in the 62-pt status band (`tap` → `… is under iOS's status bar at
   (201,56) … nothing was tapped`):
   ```
   assert [{element:{id:"swift_payment.form.value_date_select"}, ocr:{text:"Value date"}, timeout:"4s"},
           {element:{id:"swift_payment.form.value_date_select"}, color:{expected:"#FDFDFD", deltaE:8, sample:"dominant"}, timeout:"4s"}]
   FAIL  … renders text "Value date" — read "Contacts"; vs expected "Value date" ≠
   PASS  … fill within dE00 8 of #FDFDFD — sampled #EFF1F4 (dominant, 96% of region) vs expected #FDFDFD → dE00 2.97 ≤ 8; scale 3.000
   ```
   "Contacts" is the status bar's back-to-app breadcrumb (◀ Contacts); `#EFF1F4` is the bar's background. The color assert passes on
   pixels that are not the element's.
2. `text:"Message for my bank"` at `42,778 160x20`, under CONTINUE `24,780 354x44` (`tap` of such a label → `… is under button "Continue
   to summary" … nothing of it shows`):
   ```
   FAIL  … renders text "Message for my bank" — the recognizer read no text in this element rect (likeliest first: the element is
         off-screen or occluded in this capture, …); failing closed, rendered text unchecked
   FAIL  … fill within dE00 8 of #FDFDFD — sampled #91919A (dominant, 100% of region) vs expected #FDFDFD → dE00 27.38 > 8; scale 3.000
   ```
   `#91919A` is CONTINUE's grey (`img-223-0.png`); the failure reads as the element's colour being wrong.

## Why (read from the source)

`pollPixels` (`src/verify/pixel-poll.ts:449–466`) checks one cover before sampling: `keyboardOverElement` (l. 409), the soft keyboard
(`covered`, l. 306–345, the 2026-10-06 fix). The draw-order covers the tap uses (`drawOrder`, `src/ui-tree/draw-order.ts:1237`; pinned
bars, CONTINUE's reach, the floating tab bar's strip) and the status band (`inStatusBand`, `src/interact/swipe.ts:548`) are not asked.

## Why it matters

A color assert can pass on the status bar's colour (a false PASS for an element scrolled under it), and a colour or OCR failure on a row
under CONTINUE or the tab bar blames the element's rendering, sending the author to the design tokens instead of to the scroll position.

## Suggested fix (owner's choice)

Before sampling, ask the same cover question the tap asks (draw-order covers + the status band, both platforms) and, when the sampled
region is covered, fail closed with the cover's name and rect as the keyboard case does ("… is under button "Continue to summary" (…) —
scroll_until it fully first and re-run"); sample only the uncovered part when it is large enough, if wanted.

## Repro

SWIFT form; scroll `value_date_select` to y ≈ 30; `assert` color/ocr on it. Or scroll a field label to y ≈ 778–800; `assert` color on it.

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

Android parts of N2 (round 8).
- N2.5, Contacts (app bar expanded, `app_bar_layout 0,0 1080x418`): colour → `FAIL … — the status bar is drawn over the element (element
  0,0 1080x418, status bar 0,0 1080x66) — the capture would show it, not the element — assert something in it that lies clear of that (its
  title, say); no scroll moves an element laid from the screen's top edge out from under it; failing closed, color unchecked`; OCR → the
  same, `… failing closed, rendered text unchecked`. The title inside it → measured: `text:"All contacts"` colour `sampled #E8EFF6 …
  dE00 1.80`, OCR `read "All contacts"`; `open_search_bar` colour measured (`#DCE3E9`), `Abdulla` OCR measured. (37.6 s for the six.)
- R-6.3, mp-native Account Detail: `row_7 66,2034 948x143` (behind the tab-bar host) colour → `FAIL … — container (66,1840 948x248) is
  drawn over the element (element 66,2034 948x143) — … scroll_until the element with fully: true first and re-run; failing closed, color
  unchecked` (13.8 s) — the cover is named only as an unnamed `container` (the tab-bar host has no id), not as the tab bar. `row_5
  66,1710 948x143` (`cutBounds … 948x130`, cut 13 px at the host's top 1840) → measured `#F1F1F2` (its visible part). `row_1` → measured.
- R-6.4 must not fail: Account Detail `text:"1,121"` colour `#EEEEEF` and OCR `read "1,121"`, `available_balance` OCR `read "1,121.00
  CZK"`, `text:"LR"` colour `#FDFDFD`; Settings `Storage` colour/OCR, `search_bar` colour — all measured and passed.
- R-6.3 keyboard (note `2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md`): see that section.
- New: a text the app draws under the gesture navigation bar → see `## NEW 2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md`.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**N2 (iOS) — Holds, idb and WDA.**
- N2.1 SWIFT form, `swift_payment.form.value_date_select` staged at `24,30 354x52` (the note's exact shape), 09:56:30, idb:
  ```
  FAIL  … renders text "Value date" — the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — the capture
        would show it, not the element; scroll_until the element with `fully: true` first and re-run — or, if no scroll moves it out from
        under that, assert something in it that lies clear of that; failing closed, rendered text unchecked
  FAIL  … fill within dE00 8 of #FDFDFD — the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — …;
        failing closed, color unchecked
  ```
  No PASS on the bar's `#EFF1F4`, no "Contacts" read (round 7: PASS / read "Contacts"). WDA: the same two failures; its advice ends at
  "… with `fully: true` first and re-run;" (no "— or, if no scroll moves it out …" clause, which idb's reply has).
- N2.2 `text:"Message for my bank"` at `42,778 160x20` under CONTINUE, idb: colour and OCR both `button "Continue to summary" (24,780 354x44,
  reaching 24,780 354x94) is drawn over the element (element 42,778 160x20) — …; failing closed, color unchecked` / `… rendered text
  unchecked`. WDA: `button "Continue to summary" (24,780 354x44) is drawn over the element (element 42,777 160x22)` — no "reaching" part
  (WDA's tree gives CONTINUE no reach), same verdict.
- N2.3 scrolled clear: `scroll_until value_date_select fully` → 1 stroke; colour `sampled #FDFDFD (dominant, 94% of region) … dE00 0.00 ≤ 8`
  PASS, OCR read `Value date* As soon as possible` (its own text, measured). `Message for my bank` `fully` → 1 stroke, at y 592: colour PASS
  `#FDFDFD`, OCR PASS `read "Message for my bank"`.
- N2.4 must-not-fail, all measured: Account Detail `accounts.detail.available_balance` OCR `read "1 121,00 CZK"` PASS and colour PASS
  (`#EDEFF2`), `action_pay` colour PASS `#3F3F50`, `accounting_balance` OCR read its own `Accounting Balance 2 000,00 CZK` — idb and WDA
  alike; the payment-type chooser card `row_swift` OCR `read "SWIFT payment"` and colour `#FFFFFF` PASS; `"Value*"` (the 2-pt overlap)
  OCR and colour PASS on idb and WDA; a row avatar is inside `row_1`, whose colour PASS `#EDEFF2` (`92% of region`). The RN login field and
  language switcher were not reachable: the only RN app on the simulator (`sk.finportal.myport`) is a debug build and showed the red box
  "No script URL provided" (no Metro). On that red box, under WDA, `redbox-reload`'s own text was measured (OCR read `Reload (HR)`, colour
  PASS `#191919`) — a button's own label is not a cover.
- R-6.3 mp-native's own chrome: Account Detail `transactions.list.row_3` (`24,721 354x52`, centre in the tab-bar strip) → colour and OCR
  `button "Cards" (201,755 82x64, reaching 201,742 82x77) is drawn over the element (element 24,721 354x52) — …; failing closed`, idb and
  WDA (WDA again without the "or, if no scroll …" clause); `row_1` scrolled clear → measured. Under the soft keyboard (number pad up,
  CONTINUE lifted to `24,512`): idb `value_date_select` colour → `button "Continue to summary" (24,512 354x44, reaching 24,512 354x77) is
  drawn over …; failing closed`; idb lists `fees_select` no longer (under the keys) → `not found within 3 s`; WDA `fees_select` colour and
  `value_date_select` OCR → `the soft keyboard covers the element (element 24,613 354x52, keyboard 0,572 402x302) — hide it first …;
  failing closed` (the first WDA call, on a cold WDA, timed out at 3 s: `the slowest round — a tree read and its captures — took 6.01 s
  here — raise this assert timeout`; 10 s → the keyboard failure).
- Contacts (R-6.2 shape): `text:"Hank M. Zakroff"` scrolled to `96,11 209x61` → OCR and colour `the status bar is drawn over the element
  (element 96,11 209x61, status bar 0,0 402x62) — …; failing closed`. Settings: `com.apple.settings.general` OCR/colour PASS;
  `com.apple.settings.screenTime` (`16,796`, under the root list's bottom Search field) → `textfield "Search" (28,808 346x28, reaching
  28,808 346x66) is drawn over the element …; failing closed, color unchecked`.
- Residuals seen (out of scope per §5): behind the payment-type chooser (a blurred dim not in idb's tree) `accounts.detail.accounting_balance`
  colour PASSes on the blurred pixels (`#F5F6F8`, dE00 1.41) while OCR fails with the generic "recognizer read no text … occluded" — the
  dim is not a pixel cover. Timing: a 4-assert call with two fail-closed asserts and two measured took 50.8 s on the first call of the
  session; single asserts took 4.5–4.8 s each afterwards (a fail-closed assert waits out its own timeout).


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

Round 10 §2.2 / round 11 smoke 4 / round 12 smoke 6 (one `assert_color` on Android) — **Holds.** #35 `row_36` colour PASS `#F1F1F2 dE00 0.00`
(2.7 s); Contacts `id:contacts` PASS `#DCE3E9`; Settings `Sound & vibration` measured `#F0F0F3`. Fail-closed asserts still poll to their
deadline: 13.6–16.5 s each (#31, #77, #80, #109, #143) against 2.7–3.0 s for a pass.


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

**P1.3 iOS (round 10) — partly reached.** No full-bleed iOS hero image laid from y 0 exists on the simulator's apps (Contacts card:
plain header `16,116 370x286`; Settings, Safari: none). Measured instead, idb, Contacts card (John Appleseed):
- the screen-sized root `role:other label:"Contacts" 0,0 402x874`, `fully: true` (17:28:13) → `scroll_until … failed after 3 swipes —
  element is in the viewport but under button "work, John-Appleseed@mac.com" (16,409 370x68) at its centre (201,437), drawn over it —
  33% of it shows — and the content is exhausted: … — a layout defect (no clearance for a pinned bar?), not a scroll that needs more
  swipes` (4.1 s; l.64–66, three strokes). Not "stops at once": the bar exemption is not what fails — the root is judged covered by its
  own content (see Gaps).
- `id:Toolbar 0,21 402x48` (not laid from y 0), `fully: true` → `failed after 3 swipes — its centre stays under the status bar at
  (201,45) … it is pinned under the status bar …` (l.67–69).
- pixel asserts on the root: OCR → `the status bar is drawn over the element (element 0,0 402x874, status bar 0,0 402x62) — … — assert
  something in it that lies clear of that; no scroll moves the screen itself out from under it; failing closed`; colour → `button "work,
  3494 Kuhl Avenue…" (16,403 370x112) is drawn over the element (element 0,0 402x874) — that is content drawn over the root's background
  …; no scroll moves it — assert something in it that lies clear of that; failing closed` (9.3 s for both).
- **Round-12 smoke 6 (assert_color iOS):** idb `available_balance` PASS `#EDEFF2`; WDA `action_pay` PASS `#3F3F50`; idb
  `payee_country_select` PASS `#FDFDFD` (17:36:28).
