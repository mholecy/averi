# BUG: under idb, `scroll_until` draws its stroke from y 699 — on the soft keyboard — and the failure says "content exhausted"

**Measured 2026-10-09 21:00–21:08 UTC**, iPhone 17 simulator iOS 27.0, idb (default), averi `5e5a3d1`.

## Observed

1. Contacts New Contact, QWERTY up (idb: keys, band `other 0,590 402x284`): 21:00:18 `scroll_until { selector: 'role:button text:"add url"'
   }` (rect `20,902`, below the fold) → `failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes
   were not taken) — element in tree but never intersected the 402x874 viewport …`; two `idb ui swipe 201 699 201 175` — touch-down on the
   `Z X C V` row. Nothing typed (fields empty), the keyboard stayed.
2. mp-native SWIFT form, number pad up on the amount: 21:08:05 `scroll_until 'text:"Payee’s street"'` (rect `42,975`) → the same
   `failed after 2 swipes … content exhausted …`; two `201 699 201 175` — touch-down on key `5`. No digit typed (amount still `999`).
3. Under WDA the same Contacts call drew its first stroke above the keyboard (`201 459 201 115`) and said so ("The soft keyboard was up over
   [0,573][402,874] …").

## Why (read from the source)

The scroll reads the keyboard through `readKeyboard` (`src/interact/scroll.ts:290` → `src/ui-tree/keyboard-cover.ts:403`) → on the
in-tree model `keyboardInTree` (`src/ui-tree/soft-keyboard.ts:44–49`), which finds only a `role: keyboard` node — WDA's. idb marks none, so
the stroke box is the whole screen. Round 6b's `keyboardOf` (`src/ui-tree/draw-order.ts:972`) now recognises idb's keyboard by its
background for the draw-order questions, but the scroll's keyboard reading does not use it.

## Why it matters

The stroke can never scroll the form; the reply blames the content or a layout. A stroke starting on a key is a key touch: no character
landed in these two runs, but QuickPath swipe-typing is on in this simulator (round 6 found `DidShowContinuousPathIntroduction` written
into the keyboard prefs), so text can land in the focused field. mp-native's flows that `scroll_until` with a field focused hit this.

## Suggested fix

Let `keyboardInTree` (or `readKeyboard`'s in-tree branch) take `keyboardOf`'s idb band as the keyboard, so idb scrolls get WDA's behaviour:
the stroke above the band and the keyboard sentence in the failure.

## Repro

Contacts → Add (keyboard up, software keyboard enabled) → `scroll_until role:button text:"add url"`.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**K — Holds.**
- K.1 SWIFT form, number pad up (keyboard `other 0,589 402x285`, keys from 596, lifted CONTINUE `24,512 354x44`), amount focused:
  06:20:16 `scroll_until text:"Payee’s city"` → `fully visible after 1 swipe; still moving at the last read …`; shim `idb ui swipe 201 472
  201 118 --duration 0.3` — above the keys; the amount stayed empty (`img-45-0.png`).
- K.2 Contacts New Contact, QWERTY up (keys from 597, band `0,590 402x284`): 06:26:00 `scroll_until label:"add date"` → `fully visible
  after 1 swipe`, `201 472 201 118`. Nothing typed.
- K.3 `value_date_select` read at `24,521 354x52` under the lifted CONTINUE, pad up → `… is under button "Continue to summary" (24,512
  354x44) at its centre (201,547), drawn over it; nothing of it shows above the soft keyboard — scroll_until it first; nothing was tapped`
  (round-6b residual "a 354x7 part" gone). No digit typed.
- K.4 `fill text:"Value*" … dismissKeyboard: true` (scratch `keyboardDismiss` configured) → shim only the focus tap `67 282` and `idb ui
  text 3.10`; no dismissal tap or key.
- K.5 Account Detail, no keyboard: `scroll_until id:transactions.list.row_14 fully` → `failed after 2 swipes (… did not move it …)`,
  `201 699 201 175` ×2 — as in round 6b (that list does not scroll on iOS; mp-native).

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**K — Holds.**
- K.2-shape on the SWIFT form with QWERTY up (Payee’s name focused by WDA): `scroll_until text:"Message for the payee" fully` → 2 strokes,
  both `201 472 → 201 118`; nothing typed.
- K.1 number pad up (amount focused): `scroll_until id:swift_payment.form.priority_select` → `201 472 → 201 118`, then `201 175 → 201 324`
  (turn) — no stroke started on the keys; the amount field kept its value.
- K.3 `value_date_select` at `24,545` under the lifted CONTINUE (`24,512`) with the pad up → `… is under button "Continue to summary"
  (24,512 354x44) at its centre (201,571), drawn over it; nothing of it shows above the soft keyboard — scroll_until it first; nothing was
  tapped`.


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

**D2.5 / round-12 smoke 3 — Holds.** No stroke started on the keys:
- SWIFT, number pad up, `priority_select` absent (centre under the band), 17:20:55 plain `scroll_until` → 4 strokes `201 472 → 201 118`
  (l.41–44), then `scroll_until id:swift_payment.form.priority_select failed after 4 swipes (the last 2, swiping down, did not move it:
  content exhausted, or the swipes were not taken) — element in tree but never intersected the 402x589 screen above the soft keyboard
  over [0,589][402,874] (last rect {"x":24,"y":-288,"width":354,"height":52}) — it lay above the viewport, past the edge the swipes push
  it out through: scroll_until it with direction: "up". The soft keyboard was up over [0,589][402,874] in 5 of the 5 rounds read: …`
  (5.8 s). The first stroke flung the row from under the band to y −288; no turn (B1 wording). `direction: "up"` → `fully visible after
  1 swipe` (l.45 `201 175 → 201 472`, row `24,365`). The reply names the band; `keyboard.source: "idb-band"` is in the result object
  only and the MCP text does not print it (`describeScrollResult` renders it as "judged above the soft keyboard over …" only on a
  stop the band changed — not reached).
- Contacts New Contact, QWERTY up (`D2-contacts-kb.json`), 17:26:32 `scroll_until label:"add birthday"` → `fully visible after 1 swipe;
  still moving at the last read …` (l.58 `201 472 → 201 118`).


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

**R-added D2.5 (idb stroke start above the band): holds.** Contacts New Contact after a relaunch under prefs 0, QWERTY up (idb band
`other 0,590 402x284`, `D25-idb-contacts-kb.json`). 22:14:33 `scroll_until role:button label:"add birthday"` → `Element role:button
label:"add birthday" fully visible after 1 swipe; still moving at the last read (a fling not yet over, or an animated element?) — a rect
or screenshot taken now may not match` (3.6 s, #75). The one stroke was l.18 `201 472 → 201 118`, above the band, the same as round
12's l.58. The scroll dismissed Contacts' keyboard (`D25-idb-after.json` has no band node).
