# BUG: under WDA a tap on the screen beneath a page sheet is reported "Tapped" where only the sheet's own background lies over it — the tap lands on the sheet and does nothing

**Measured 2026-10-13 17:28–17:30 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port 47883), scratch `treeSource: wda`. Found by
the round-9 item M (a scroller in a later layer covers the screen beneath) on Contacts' New Contact sheet.

## Symptom


Contacts list, `+` → the New Contact page sheet (large detent, from y 58 to the bottom, opaque). WDA lists the contact list beneath it
first, then the sheet (`run12-ios/M1-wda-contacts-sheet.json`, `M1-wda-contacts-sheet2.json`):

```
scrollable 0,0 402x874                                   ← the contact list (beneath)
  button 'Contact photo for Kate Bell'        18,267 45x45
  button 'Contact photo for Hank M. Zakroff'  18,641 45x45
toolbar 'Toolbar' 0,0 402x874  (×3)
button 'Sheet Grabber' 151,58 100x24
container id=New Contact 0,78 402x54
scrollable 0,62 402x812                                  ← the sheet's form
  button 'Add photo' 113,132 176x175
  textfield First name 36,406 330x22 …
  container 'add phone' 20,565 362x52, container 'add email' 20,633 362x52 …
toolbar 'Toolbar' 0,62 402x812
```

```
17:29:25 tap { selector: 'role:button label:"Contact photo for Kate Bell"', configPath: <cfg-wda> }          (7.2 s)
→ Tapped role:button label:"Contact photo for Kate Bell"
```

Shim: `idb ui tap 41 290`. The point lies on the sheet's bare background (left of the Add-photo circle); the screenshot after it
(`img-149-0.png`) shows the sheet unchanged — nothing beneath was pressed, nothing on the sheet either, and the reply says it was done.

Where sheet CONTENT holds the point the cover is seen:

```
17:30:16 tap { selector: 'role:button label:"Contact photo for Hank M. Zakroff"' }  (sheet scrolled 10 pt, keyboard down)
→ role:button label:"Contact photo for Hank M. Zakroff" is under container "add email" (20,622 362x52) at its centre (41,664), drawn
  over it; only a 45x12 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
```

— and even there the "45x12 part" that "shows" is the gap between two sheet rows, i.e. the sheet's background again.

Contrast: mp-native's fees sheet gives its panel an identified container (`container id=swift_payment.form.fees_sheet 31,438 340x373`),
and a control beneath it is refused (`… is under container id:swift_payment.form.fees_sheet … nothing of it shows …`, 17:33:55).

## Repro


1. Contacts, `+` (New Contact sheet). Scroll the sheet a few points (or dismiss the keyboard) so the list rows beneath are not under the
   keyboard.
2. `ui_snapshot` with `treeSource: wda`: the list's rows are listed before the sheet.
3. `tap role:button label:"Contact photo for Kate Bell"` → `Tapped`, the tap lands on the sheet's empty background.

## Evidence


`run12-ios/session.log` #147–#151; `M1-wda-contacts-sheet.json`, `M1-wda-contacts-sheet2.json`; `img-149-0.png`; `idb-calls.log` l.72.

## Expected


Round 9 item M: a control of the screen beneath a sheet is refused as covered (or aimed at a part clear of it), never tapped through.
The sheet is opaque from y 58 down; nothing of the list shows there.

## Suspected cause


The sheet has no node that draws its panel: WDA gives it a `scrollable 0,62 402x812` and a `toolbar 0,62 402x812` (structural / not
drawn), and its rows only where they are. Round 9's M rule keys on a scroller in a later SCREEN-SIZED layer; this sheet's layer starts
at y 62 (812 tall), so it is not screen-sized and its scroll view is not taken as covering what lies beneath. A later layer that holds
the target's centre and is nearly the screen's size (full width, reaching the bottom edge) could count as an opaque cover.


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

**A.3 / A.4 (round 13, ADR 0018): holds.** Contacts list → `tap role:button label:Add` (WDA, l.14). The New Contact page sheet is up
with the keyboard down (Contacts not yet relaunched under the prefs). The tree is as in round 12 (`A3-wda-sheet.json`): the list's
`scrollable 0,0 402x874` with `Contact photo for Kate Bell 18,267` / `Hank M. Zakroff 18,641`, then the sheet's `scrollable 0,62 402x812`.

- **Tap on a row beneath: refused** (22:12:02, 9.9 s, #57), no shim tap:
  `role:button label:"Contact photo for Kate Bell" is under scrollable (0,62 402x812) at its centre (41,290), drawn over it; nothing of it
  shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing
  was tapped`.
  `role:text text:"Kate Bell"` gives the same (`… at its centre (107,279) …`, #59). Round 12 said `Tapped` here (l.72 `41 290`).
- **R-added, round-12 M shape (a sheet ROW over the target): still refused** (22:12:12, 9.5 s, #58):
  `role:button label:"Contact photo for Hank M. Zakroff" is under image "add" (39,645 26x26) at its centre (41,664), drawn over it;
  nothing of it shows — a screen is presented over it …; nothing was tapped`.
  It now names the row's `+` icon, not round 12's `container "add email"`, and the "45x12 part shows" clause is gone.
- **`scroll_until` to a list row: no swipe, sheet still up** (22:12:44, #61; Hank #62):
  `scroll_until role:button label:"Contact photo for Kate Bell" stopped before any swipe — element is in the viewport but under scrollable
  (0,62 402x812) at its centre (41,290), drawn over it — 0% of it shows — a screen is presented over it (a modal or a sheet) — close it
  first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. Last rect {"x":18,"y":267,
  "width":45,"height":45} in a 402x874 viewport`.
  The shim count was 14 before and after #61–#63. The sheet is up in `img-64-0.png`.
- **A.4 `assert_color` on the row beneath: fails closed naming the sheet's scroll view** (22:13:03, 14.6 s, #63):
  `FAIL … — scrollable (0,62 402x812) is drawn over the element (element 18,267 45x45) — the capture would show it, not the element;
  scroll_until the element with `fully: true` first and re-run — or, if no scroll moves it out from under that, assert something in it
  that lies clear of that; failing closed, color unchecked`.
  It holds, but see Gaps: the advice still offers `scroll_until`, which this tool now refuses here.
- **Tap on a sheet field: tapped** (22:13:27, 10.0 s, #65): `Tapped id:"Last name"` (l.15 `201 470`). The caret moved to Last name and
  the sheet stayed up (`img-66-0.png`).
- Timings: every WDA call on this sheet took 9.4–10.0 s. Contacts' WDA tree is large.


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

**A.4 smoke, Contacts page sheet (WDA): holds, verbatim as round 13.** The sheet was raised by `tap role:button label:Add` (#15).
- **Tap on a row beneath: refused.** `tap role:button label:"Contact photo for Kate Bell"` (06:57:36, 9.9 s, #17):
  `role:button label:"Contact photo for Kate Bell" is under scrollable (0,62 402x812) at its centre (41,290), drawn over it; nothing of it
  shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing
  was tapped`
- **`scroll_until` on the same row: no swipe** (#18). `… stopped before any swipe — element is in the viewport but under scrollable
  (0,62 402x812) at its centre (41,290) … so none was sent. Last rect {"x":18,"y":267,"width":45,"height":45} …`. The shim count stayed
  at 5.
- **A.3 colour on the row** (06:58:08, 14.7 s, #20): `FAIL … — scrollable (0,62 402x812) is drawn over the element (element 18,267
  45x45) — the capture would show it, not the element; a screen is presented over the element (a modal or a sheet) — close it first; no
  scroll moves the element out from under that screen; failing closed, color unchecked`.
  - Round 13's `scroll_until the element with fully: true first` advice is gone.
  - The same assert with `"timeout": 3000` (#19) said `element found, but no time was left within 3 s to capture a settled frame (the
    slowest round — a tree read and its captures — took 4.432 s here) — raise this assert timeout`.

**D (dim leaf), `D-contacts-sheet.json`:** the sheet's dim is an unlabelled leaf in the presented branch:
```
[2] Other  0,0 402x874              isVisible "1" isAccessible "0"  kids 2   ← presented branch
  [3] Other  -402,-874 1206x2622    isVisible "0" isAccessible "0"  kids 0   ← the sheet's unlabelled dim
  [3] Other  0,62 402x812           isVisible "1" isAccessible "0"  kids 2   ← the sheet
```
- The list's own branch has the same kind of leaf (`[4] Other -402,-874 1206x2622 isVisible "0" isAccessible "0"`).
- Every node of the list under the sheet is `isVisible "0"`, e.g. `Button 'Contact photo for Kate Bell' 18,267 45x45 isVisible "0"
  isAccessible "0"` and `StaticText 'Kate Bell' isVisible "0" isAccessible "0"`. The list's `BackButton` is `isVisible "0" isAccessible
  "1"`.

**D (dim leaf), discard popover (`D-contacts-discard-popover.json`):** `[3] Other name='PopoverDismissRegion' label='dismiss popup'
0,0 402x874 isVisible "1" isAccessible "0" kids 0`.
- In the raw source it is a leaf. Its `[2]` parent (`0,0 402x874 isVisible "1"`) holds it and the popover branch, where `Button
  'Discard Changes' 26,182 208x49` is `isVisible "1" isAccessible "1"`.
- After the popover rose, the sheet's own branch (`[2] … 0,0 402x874`) went to `isVisible "0"`, with the sheet fields `isVisible "0"`
  (e.g. `Cell 'add phone' 20,565 362x52 isVisible "0" isAccessible "1"`).
