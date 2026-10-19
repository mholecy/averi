# BUG: under WDA a full-screen React Native transparent `Modal`'s dim overlay covers nothing, so a tap on the screen beneath it is reported "Tapped" while the overlay swallows the touch

**Measured 2026-10-13 17:57 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port 47883). The app is Finportal
(`sk.finportal.myport`, an Expo dev build on Metro) with its own `averi.yaml` (`treeSource: wda`), on the login screen and NOT logged
in. This is round 9's item M (a later screen-sized layer covers the screen beneath). It is a sibling of
`2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md`.

## Symptom


On the login screen, "Reset account" opens `ForgotPasswordModal`, built on `design-system/components/Modal.tsx`: an RN `Modal` with
`transparent` and `animationType="fade"`, whose root is a full-screen tinted `View testID="forgot_overlay"` holding a card. WDA lists
it after the whole login screen (`run12-ios/FP-forgot-wda.json`):

```
container id=login_screen 0,0 402x874                 ← the screen beneath (language buttons, title, fields …)
  button id=lang_sk 'Slovensky' 268,235 43x32
  text id=login_title 'Login' 36,291 330x24
toolbar 'Toolbar' 0,0 402x874
container id=forgot_overlay 0,0 402x874               ← the modal's dimming root, listed after the screen
container id=forgot_modal 16,301 370x220              ← its card
button id=forgot_close 'Close' 140,776 122x48
```

```
17:57:32 tap { selector: "id:lang_sk", configPath: <fp-cfg> }                                                    (3.3 s)
→ Tapped id:lang_sk
17:57:29 tap { selector: "id:login_title", configPath: <fp-cfg> }                                                (2.8 s)
→ id:login_title is under container id:forgot_modal (16,301 370x220) at its centre (201,303), drawn over it; only a 330x10 part of it
  shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

The shim logged `idb ui tap 290 251`. The screenshot after it (`img-253-0.png`) shows the modal still up and the language still
English: the overlay took the touch, and the reply says the language button was tapped. In the refusal, the "330x10 part" that "shows"
lies under the same overlay. idb lists only the modal's content, so there the screen beneath times out (`FP-forgot-idb.json`).

## Repro


1. Finportal login screen (no login). Tap `id:login_forgot` ("Reset account").
2. With `treeSource: wda`, `tap id:lang_sk` → `Tapped`. The language does not change.

Do not repeat this with a control whose press would matter: the reply would be the same, and only the overlay prevents the press.

## Evidence


- `run12-ios/session.log` #246–#253
- `FP-forgot-wda.json`, `FP-forgot-idb.json`
- `img-247-0.png` (modal up), `img-253-0.png` (after the tap)

## Expected


A control of the screen beneath a full-screen modal layer is refused as covered by that layer, naming `forgot_overlay`, and is never
reported as tapped. Round 9's M: "never tapped through to the page".

## Suspected cause


The overlay is a structural `container` with no label, the size of the screen, and with children. Draw order excuses it, as it excuses
iOS dimming `other`s ("a full-screen `Other` of a later Window holds every point and draws nothing"; ADR 0016 notes the same for a
dimming `other` that holds the target whole). Round 9's M rule covers only scrolled content of a later screen-sized layer, not that
layer's own background. A later screen-sized layer that holds the target's centre, listed after the target's own screen-sized layer,
could cover it as a whole.


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

**A.1 / A.2 (round 13, ADR 0018): holds.** Finportal login → `tap id:login_forgot` (22:06:04, shim l.1 `201 655`). WDA lists the
modal as in round 12 (`A1-forgot-wda.json`): `container id=forgot_overlay 0,0 402x874`, then `forgot_modal 16,301 370x220`, then
`button forgot_close 140,776 122x48`.

- **A.1 `tap id:lang_sk`: refused** (22:06:33, 2.9 s, #8; re-run 22:07:29, #16, identical):
  `id:lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it; nothing of it shows — a screen is
  presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`.
  The shim logged no tap. `lang_cz` was refused the same way (`… at its centre (345,251) …`, #17). Round 12's `login_title` case (under
  the card) now has the presented sentence too: `id:login_title is under container id:forgot_modal (16,301 370x220) at its centre
  (201,303), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; …; nothing was
  tapped` (#10). Round 12 said "only a 330x10 part of it shows … scroll_until it first".
- **A.2 `scroll_until id:lang_sk`: fails with no swipe** (22:06:35, 2.8 s, #9; re-run #18, identical):
  `scroll_until id:lang_sk stopped before any swipe — element is in the viewport but under container id:forgot_overlay (0,0 402x874) at
  its centre (290,251), drawn over it — 0% of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll
  moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect {"x":268,"y":235,"width":43,"height":32}
  in a 402x874 viewport`.
  The same holds for `id:login_support_text` (`… at its centre (201,719) …`, #19). The shim count stayed at 1 across #8–#10, and at 2
  across #16–#19 (l.2 is the LogBox × below). WDA swipes go through idb here, as l.18/27/49 show, so a swipe would have been logged.
  The screenshots before (`img-11-0.png`) and after (`img-20-0.png`) show the modal up, the screen unmoved and the language English.
- **A.1 `tap id:forgot_close`: tapped** (22:07:46, 3.0 s, #21): `Tapped id:forgot_close` (l.3 `201 800`). The modal closed and the
  language is still English (`img-22-0.png`).
  - First attempt (22:07:05, #12): an RN dev **LogBox toast** ("Open debugger to view warnings.", `container 10,787 382x49`) was
    listed last and drawn over the button. The tap was rightly refused: `id:forgot_close is under container "!, Open debugger to view
    warnings." (10,787 382x49) at its centre (201,800), drawn over it; only a 122x10 part of it shows, under the 24x24 a tap may be moved
    to — scroll_until it first; nothing was tapped`.
  - I closed the toast with its × (coordinate tap `369,811`, l.2) and then tapped Close.


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

**A.4 smoke, Finportal forgot-password modal (WDA, `fp-cfg`): holds, verbatim as round 13.**
- I closed the LogBox toast first (coordinate tap `369,811`, #4, l.1). `tap id:login_forgot` → `Tapped` (#5, l.2 `201 655`); the
  modal is up in `img-6-0.png`.
- **`tap id:lang_sk`: refused** (06:56:14, 2.7 s, #7):
  `id:lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it; nothing of it shows — a screen is
  presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- **`scroll_until id:lang_sk`: no swipe** (06:56:17, 2.6 s, #8):
  `scroll_until id:lang_sk stopped before any swipe — element is in the viewport but under container id:forgot_overlay (0,0 402x874) at
  its centre (290,251), drawn over it — 0% of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll
  moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect
  {"x":268,"y":235,"width":43,"height":32} in a 402x874 viewport`
  - The shim count stayed at 2 across #7–#9.
- **A.3 colour under the modal** (#9):
  `FAIL  element id:"login_username" fill within dE00 8 of #FFFFFF — text "Send your password reset request to your manager or your
  company's assistant." (32,389 338x48) is drawn over the element (element 90,383 258x20) — the capture would show it, not the element;
  a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen;
  failing closed, color unchecked`
  - It names the card's text, the first presented node over the field, rather than `forgot_overlay`. The remedy is the presented one.
- **`tap id:forgot_close`: tapped** (#10, l.3 `201 800`). The modal closed.
- **Login with no modal:** `tap id:login_username` → `Tapped id:login_username` (#11, l.4 `219 393`). The caret is in the field and the
  language is English (`img-12-0.png`). Nothing was typed.

**D (dim leaf), `D-finportal-forgot.json`:**
```
[5] Other  name='forgot_overlay'  0,0 402x874     isVisible "1"  isAccessible "0"  kids 0
[5] Other  name='forgot_modal'    16,301 370x220  isVisible "1"  isAccessible "0"  kids 4
[5] Button name='forgot_close'    140,776 122x48  isVisible "1"  isAccessible "1"
```
Beneath:
- `Button 'lang_sk' 268,235 43x32` is `isVisible "0" isAccessible "1"`.
- `TextField 'login_username'` is `isVisible "0" isAccessible "1"`.
- `StaticText 'login_title'` is `isVisible "0" isAccessible "0"`.
- The screen's full-screen `Toolbar` is `isVisible "0" isAccessible "0"`.
