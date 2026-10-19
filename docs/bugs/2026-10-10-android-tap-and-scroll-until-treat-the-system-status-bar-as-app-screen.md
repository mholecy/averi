# BUG: on Android a node drawn under the system status bar (an edge-to-edge app) is "Tapped" there and read "fully visible" — averi has no status band on Android

> **Status (2026-10-10):** open. Found by the round-7 device check (Android), averi `fix/round-7` @ `35d5997`. The iOS counterpart is
> handled (`src/adapters/ios-status-band.ts`, round 6's T-1); Android was left out on the premise that "Android's status bar lies outside
> the app's window" (`src/adapters/types.ts:48–51`), which does not hold for an edge-to-edge app.

## Summary

Google Contacts draws edge-to-edge: its list (`scrollable contact_list 0,0 1080x1977`) and its collapsing app bar start at y 0, under the
system status bar (`dumpsys window`: `InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66]`). With the app bar collapsed by a scroll,
uiautomator dumps what is left of it inside the status bar's band: `text 'All contacts' 149,0 213x6`, `button 44,0 423x44`, `other 'View
labels' 805,0 66x11`. averi judges these as on screen:

- `tap { selector: 'text:"All contacts"' }` → `Tapped text:"All contacts"`, shim `input tap 256 3` — y 3 is the status bar; nothing happened
  in the app (screenshot unchanged; the account-filter sheet a tap on "All contacts" opens did not open).
- `scroll_until { selector: 'text:"All contacts"' }` → `Element text:"All contacts" fully visible after 0 swipes` (2.0 s, no stroke) — the
  6-px sliver lies wholly under the status bar, nothing of it shows.
- With `fully: true` the same call strokes once (`input swipe 540 396 540 573 300`, content down) and stops at `149,149 213x55` — correct.

## Repro

1. Google Contacts list; drag the list up once (`input swipe 540 1500 540 700 1500`) so the app bar collapses (`app_bar_layout 0,0 1080x66`).
2. `ui_snapshot` → the app bar's children at y 0 with heights 6–44.
3. `tap text:"All contacts"` → `Tapped`, `input tap 256 3`, no effect. Plain `scroll_until text:"All contacts"` → `fully visible after 0 swipes`.

## Evidence

`run10-android/session.log` #99 (06:32:10, `input tap 256 3`), #145 (06:37:08), #147 (06:37:12); `img-101-0.png` (after the tap: the list,
app bar still collapsed). Status bar frame from `adb shell dumpsys window`.

## Where

- `src/adapters/android.ts:450–458` (`viewportMemo`): returns `{ width, height, windowsBesideSystemBars: true }`, never a `statusBand`.
- `src/adapters/types.ts:46–54` (`DeviceScreen.statusBand`): "Set by the iOS adapter only; Android's status bar lies outside the app's
  window" — false for an app that draws edge-to-edge, as Google Contacts does here on Android 13.
- `src/interact/swipe.ts:535–548` (`belowStatusBand`, `inStatusBand`): already generic; they only need the band.

## Suggestion

Report Android's status band from the window insets (`dumpsys window` `ITYPE_STATUS_BAR frame`, or `InsetsSource type=statusBars`), only
when the foreground app's window starts at y 0 (edge-to-edge); then the tap refusal and the scroll's visibility judgement of round 6's T-1
apply as on iOS. Re-check the `fully` probe and the "turn back from the status band" rule (round 6b S) on Android against this list.

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

N1 (round 8) holds.
- N1.5 record: `dumpsys window displays | grep -E "ITYPE_STATUS_BAR|statusBars"` → `InsetsSource type=ITYPE_STATUS_BAR
  frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false` (also `ITYPE_STATUS_BAR -> Window{… NotificationShade}` on the lock
  screen and the `mSource=`/`mControl=` lines).
- N1.1: Contacts, app bar collapsed by a drag (`app_bar_layout 0,0 1080x66`, `text 'All contacts' 149,0 213x6`, `'View labels' 805,0
  66x11`). `tap text:"All contacts"` → `text:"All contacts" is under the status bar at (256,3), in the top 66 of the screen (tree units),
  where a tap goes to the status bar (rect 149,0 213x6) — it lies in a scroll view — scroll_until it first, to move it out from under the
  bar; nothing was tapped` — verbatim. `tap label:"View labels"` → the same wording at `(838,6)`, rect `805,0 66x11`. No shim line.
- N1.2: plain `scroll_until text:"All contacts"` → `fully visible after 1 swipe` (`input swipe 540 396 540 989 594`, content down),
  `All contacts 149,303 213x55`; then `tap` → `Tapped`, `input tap 256 331`, the account-filter sheet opened (closed with Back).
- N1.3: `fully: true` from the collapsed bar → `fully visible after 1 swipe`, same stroke, stops at `149,303`.
- New shape, mp-native: a long-press (staging slip) focused "Message for my bank" and the window panned up (tree root `0,0 1080x1828`,
  `payee_name_input 66,0 948x89`, the top bar at `0,0 0x0`). `tap text:"Payee’s name"` → `… is under the status bar at (244,22), in the
  top 66 … (rect 110,0 268x44) — it lies in a scroll view — scroll_until it first …; nothing was tapped`; `tap id:payee_name_input` → the
  same at `(540,45)`, rect `66,0 948x89`. Correct (the screenshot shows the field behind the status bar).
- N1.4 still tapped: mp-native top-bar back `input tap 77 154` (SWIFT form, `back_to_tab_host`) and `input tap 110 85` (transaction
  detail); Contacts `Contact settings` (`948,88 132x132`), Create contact `More options` → `input tap 1003 154` (menu opened), `Cancel` →
  `input tap 77 154` (back to the list); Settings `Search settings` → `input tap 393 406`, the search view opened. Account Detail rows
  under the tab bar as in round 7 (`row_20 … PARTLY UNDER container id:nav.tab_more … 74% of it shows, its centre clear`).
- N1.5 immersive: Camera (`com.android.camera2`) hides the bar — `InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=false`.
  `tap x:540 y:30` → `Tapped (540, 30)`, `input tap 540 30` (no refusal). Camera showed only its first-run dialog (title at y 77), so no
  selector target lay under y 66; not further measured (its NEXT changes a location-tagging setting).

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**N1 wording on iOS (R-6.2) — Holds.** Platform-neutral wording, iOS band 62:
- SWIFT form, `tap id:swift_payment.form.value_date_select` at `24,30 354x52` → `… is under the status bar at (201,56), in the top 62 of the
  screen (tree units), where a tap goes to the status bar (rect 24,30 354x52) — if it lies in a scroll view, scroll_until it first, to move
  it out from under the bar; if not, no scroll moves it out: it is pinned under the status bar (a layout that does not keep clear of it?) —
  fix the layout, or tap something else; nothing was tapped`. No shim tap.
- Contacts card, `tap text:"Hank M. Zakroff"` at `96,11 209x61` → the same text with `(201,42)`; then plain `scroll_until` → 1 stroke
  (`201 175 → 201 437`, content down), stop. On idb the reply cannot say whether the node lies in a scroll view (it gives both branches).


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

Round 9 §3.4 N1 and round 10 D1/slices item 3 — **Hold, verbatim round 8.** Contacts app bar collapsed by a slow drag (`app_bar_layout 0,0
1080x66`, `All contacts 149,0 213x6`, `View labels 805,0 66x11`):
- #88 `tap text:"All contacts"` → `text:"All contacts" is under the status bar at (256,3), in the top 66 of the screen (tree units), where a tap
  goes to the status bar (rect 149,0 213x6) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was
  tapped`; #89 `label:"View labels"` → the same at `(838,6)`, `rect 805,0 66x11`. No shim line.
- #92 plain `scroll_until text:"All contacts"` → `fully visible after 1 swipe`, `17:24:43 input swipe 540 396 540 989 594` (round 8's stroke);
  #93 `tap` → `Tapped`, `17:24:53 input tap 256 331`, the account sheet opened (closed with Back).
