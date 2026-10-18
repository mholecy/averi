# BUG: on iOS idb the QuickType bar lies above idb's keyboard band, so a tap on a suggestion ("Passwords") is sent to the keyboard and reported "Tapped"; ADR 0007's "a lone QuickType suggestion is refused" does not hold

**Measured 2026-10-13 17:54 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port 47883), default `treeSource: idb`. The
app is Finportal (`sk.finportal.myport`) on its login screen, with `login_username` focused and the software keyboard up (prefs
`HardwareKeyboardLastSeen` set to 0). Found by round 10's D2.4.

## Symptom


On the first focus after a launch, iOS shows a QuickType bar with a single "Passwords" suggestion above the letters (`img-222-0.png`).
idb's tree (`run12-ios/FP-idb-kb.json`):

```
button 'Passwords'           30,546 342x44     ← QuickType suggestion
button 'shift' / 'delete' / 'numbers' / 'space' / 'next' / 'q'…   597–813
other ''                      0,590 402x284    ← the band node averi reads as the keyboard line
button 'Dictate'            325,805 68x69
```

WDA's keyboard frame for the same keyboard is `0,546 402x328`, which includes the bar.

```
17:54:45 tap { selector: 'role:button text:"Passwords"' }                                                         (1.4 s)
→ Tapped role:button text:"Passwords"
```

The shim logged `idb ui tap 201 568`, a press on the keyboard's own control. The keyboard then closed and no AutoFill sheet appeared
(`img-226-0.png`). With the bar up, idb also drops the app's `login_submit` (`36,547 109x48`, under the bar) from its tree, the way it
drops nodes under the band.

## Repro


1. Simulator with `HardwareKeyboardLastSeen`/`AutomaticMinimizationEnabled` set to 0. Launch an app with a username/password form
   (iOS offers "Passwords" on such a field) and focus the username field.
2. Under idb, `ui_snapshot`: `button 'Passwords' 30,546 342x44` lies above `other 0,590 402x284`.
3. `tap role:button text:"Passwords"` → `Tapped`.

The bar showed only on the first focus after a launch. Later focuses showed no bar.

## Evidence


- `run12-ios/session.log` #222–#226
- `FP-idb-kb.json`, `FP-wda-kb.json`
- `img-222-0.png`, `img-226-0.png`

## Expected


Per ADR 0006/0007 and round 10's D2.4: "a lone QuickType suggestion inside the band (e.g. "Passwords") → now refused". No averi tap is
sent to the keyboard.

## Suspected cause


`DrawOrder.keyboardBandTop` reads the band from idb's background node at 590. The QuickType bar sits 44 pt above it, and idb lists it
before the band, so it is neither under the line nor part of the band's run. The tap judges it as ordinary app content and sends it.
ADR 0007's residual assumed the suggestion lies inside the band. A bar of keyboard-run nodes ending flush at the band top (546 + 44 =
590) could raise the line to 546.


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

**B.1 (round 13, ADR 0007 amended): holds, the press is expected now.** Finportal relaunched (22:09) under prefs 0, then `tap
id:login_username` (idb, l.4). The QuickType bar shows as in round 12 (`B1-idb-kb.json`): `button 'Passwords' 30,546 342x44` above the
band `other 0,590 402x284`, and `login_submit` is dropped. 22:09:48 `tap role:button text:"Passwords"` → `Tapped role:button
text:"Passwords"` (1.4 s, #36, l.5 `201 568`). This time the keyboard stayed up and no AutoFill sheet appeared (`img-37-0.png`); in
round 12 the keyboard closed.
