# BUG: under WDA, the text of an off-screen UIKit cell is listed at a parked frame (`0,62 286x22`) inside the viewport — `scroll_until … fully: true` answers "fully visible after 0 swipes" for a row 300 pt below the screen

**Measured 2026-10-09 11:34 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-3` @ `347e70d` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch config
`treeSource: wda` (+ `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`), stock Contacts "New Contact" sheet (UIKit,
~4 pages), software keyboard up (`keyboard 0 573 402 301`). Found during the round-3 iOS device check (handoff item j, iOS WDA
scroll with the keyboard up). Not a round-3 regression: the 610660f-era capture of the same sheet
(`scratchpad/averi-repo/run3-ios/wda-contact1.txt`, 07:27 UTC) has the same parked nodes.

## Observed (measured)

```
ui_snapshot { filter: 'text:"add related name"' }   (WDA)
  container 'add related name'   20 1171 362 52        ← the cell, its real place (below the 874-pt screen)
  text 'add related name'         0   62 286 22        ← its label, parked at the sheet's origin
11:34:15 scroll_until { selector: 'role:text text:"add related name"', fully: true, configPath: <scratch wda> }      (3.4 s)
→ Element role:text text:"add related name" fully visible after 0 swipes
```

No swipe in the `idb` shim log; the screenshot (`run5-ios/img-72-0.png`) shows the sheet's top (photo, names, Company) and the
keyboard — no "add related name" anywhere. The same scroll on the CELL (`role:container label:"add related name"`) swiped once
(`201 459 → 201 115`) and stopped right at `20 342 362 52`; the text then read `80 357 286 22`.

Raw WDA `/source?format=json` (11:34, `run5-ios/wda-src3.json`):

```
Cell 'add phone'          rect {20,565 362x52}   vis 0      StaticText 'add phone'          rect {80,580 286x22}  vis 0
Cell 'add pronouns'       rect {20,699 362x53}   vis 0      StaticText 'add pronouns'       rect {80,714 286x23}  vis 0
Cell 'add related name'   rect {20,1171 362x52}  vis 0      StaticText 'add related name'   rect {0,62 286x22}    vis 0
```

Every cell from `add address` (y 969) down has its StaticText (and the `Notes` cell its `text 'Notes'` + `textfield 'Notes'`) at
`0,62 …` — the label's frame relative to its cell, offset by the sheet's origin, for cells UIKit has not laid out on screen.
In the averi tree at 11:33 (`run5-ios/wda-c2.txt`), 11 nodes sit at `0 62 286/330 21–22`: add address, add birthday, add date,
add related name, add social profile, add instant message, Notes (text + textfield), add verification code, add field,
add to list.

## Why (read from the source at 347e70d)

`src/adapters/wda-source.ts` (comment l. 66–80, and `parseWdaSourceValue`): invisible nodes are KEPT with their `rect`
("iOS keeps off-screen nodes in its tree and the assert layer relies on that"); `isVisible` is read for one purpose only (is
a `Keyboard` on screen). So a parked rect is taken at face value: the scroll's stop test sees a node wholly inside the viewport
(and above the keyboard band) and stops at round 0. The `visibleFraction`/off-screen checks cannot catch it — the rect IS on
screen; only the parent cell's rect (`20,1171`) or `isVisible=0` says otherwise.

## Why it matters

- `scroll_until` reports success with nothing scrolled; the next `tap`/`type_text` on that selector would act at the parked
  point (here (143,73), the sheet's header) — not tried (the P2 off-screen refusal does not fire, the point is on screen). The
  610660f `Notes` fill (`role:textfield label:Notes`) may have hit or missed the same way depending on whether Notes had been
  laid out.
- `role:text` / `text:` selectors are the natural way to name UIKit rows (the cells carry no ids), so this shape is common
  on any long UIKit form or table under WDA.
- An `absent:` / visibility assert on such a label reads "visible".

## Possible fix directions (owner's choice)

- In the WDA parser, when a node with `isVisible=0` has a rect that lies outside its nearest ancestor's rect (a child outside
  its cell), give it the ancestor's rect clipped (or a zero rect, as idb does for unlaid nodes), so "off screen" is judged on the
  cell.
- Or carry `isVisible` and make scroll/tap/visibility verdicts treat `isVisible=0` + rect not within the parent as "not laid
  out", i.e. still to scroll to.
- At least: in `scroll_until`, distrust a round-0 stop whose node is not contained in its parent's rect.

## Repro

1. iOS 27 simulator, Contacts → + (New Contact), scratch `treeSource: wda`.
2. `ui_snapshot { filter: 'text:"add related name"' }` → the text at `0 62 286 22`, its cell at `20 1171 362 52`.
3. `scroll_until { selector: 'role:text text:"add related name"', fully: true }` → `fully visible after 0 swipes`; screenshot
   shows the row is not on screen.


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

**Out of round-14 scope, still reproduces (fails); the untried tap case is now measured.** Contacts New Contact, unedited, keyboard down,
`cfg-wda`:
- `ui_snapshot` (#42) lists `container 'add instant message' 20,1306 362x52` and `text 'add instant message' 0,62 286x22`. The same holds
  for `add birthday` (cell `20,1036`, text `0,62`).
- `tap role:text label:"add instant message"` → `Tapped role:text label:"add instant message"` (07:03:21, 9.4 s, #43). The shim logged
  l.13 `idb ui tap 143 73`, which is the sheet's grabber strip. Nothing happened (`img-45-0.png`: the sheet is unchanged and the row is
  still below the fold).
- An exists assert on it passes (#44).
- With the discard popover up, the same tap was refused at the parked centre (`… at its centre (143,73) …`, #33), refused for the wrong
  reason.
- The raw source has the same parked rect: `StaticText 'add instant message' rect 0,62 286x22 isVisible "0" isAccessible "0"`, and its
  cell `20,1306 362x52 isVisible "0" isAccessible "1"` (`D-contacts-discard-popover.json`).
- Contacts was left unchanged; the sheet was closed with `close` (#46, no edits, no popover).


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

**R15 C.3 Contacts New Contact sheet: holds.** The tree (#99, `contacts-sheet-wda.txt`) gives both nodes the cell's rect: `container 'add instant message' 20,1306 362x52` and `text 'add instant message' 20,1306 362x52 hidden` (round 14 placed the text at `0,62 286x22`).
- `tap text:"add instant message"` (the handoff's selector) → `Selector matches 2 elements: … container … text … Narrow it` (#100). Nothing was tapped.
- `tap role:text label:"add instant message"` (17:36:31, 9.6 s, #101):
  `role:text label:"add instant message" is off screen at (201,1332) on a 402x874 screen (rect 20,1306 362x52) — scroll_until it first; nothing was tapped`
  - No shim line was logged. Round 14 said `Tapped` at `143 73`.
- `scroll_until text:"add instant message"` with no popover → `Element text:"add instant message" fully visible after 1 swipe` (17:36:40, 19.6 s, #102, l.36). The row is on screen in `img-103-0.png`.

**R15 C.4 Discard popover over the sheet: holds.** `tap role:button label:"Contact photo for Kate Bell"` (17:38:27, 5.3 s, #112):
`role:button label:"Contact photo for Kate Bell" is under container "dismiss popup" (0,0 402x874) at its centre (41,290), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
- The tree (#110) marks the row `hidden` (`button 'Contact photo for Kate Bell' 18,267 45x45 hidden`). It is still refused, so the hidden flag does not lift a presented surface.
