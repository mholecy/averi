# BUG: on Android a transparent floating-action-button host (`fab_container`) is read as drawn over everything in its band: taps beside the FAB are refused, scrolls and colour asserts treat it as a cover

> **Status (2026-10-13):** open. Found by the round-12 device check (Android, round 9 item F), averi `arch/round-12` @ `20307d2`. Not a
> regression known to round 9's F (that item is about `cutBounds` widening, which holds); whether earlier hashes behaved the same was not
> measured.

## Symptom


Google Clock (`com.google.android.deskclock`), Alarm tab. The dump lists, AFTER the alarm list, a full-width View host holding only the FAB:

```
scrollable id=alarm_recycler_view 0,242 1080x1692
  …the alarm cards…
container id=fab_container 0,1582 1080x352      (child of desk_clock_pager_frame, after the pager)
  button id=fab 'Add alarm' 408,1626 264x264
```

The host is transparent: on screen everything in its band beside the FAB is visible and tappable (`img-125-0.png`: the 9:00 card's chevron,
"9:00 AM" digits and its switch to the left/right of the round FAB). averi treats the whole host rect as drawn over what lies under it:

- `tap label:"Expand 9:00 AM alarm"` (`button 882,1533 110x132`, centre (937,1599), 265 px right of the FAB) → `label:"Expand 9:00 AM alarm"
  is under container id:fab_container (0,1582 1080x352) at its centre (937,1599), drawn over it; only a 110x49 part of it shows, under the 65x65
  a tap may be moved to — scroll_until it first; nothing was tapped`.
- `tap label:"9:00 AM"` (`text 88,1577 360x191`, centre (268,1673), left of the FAB) → `… is under container id:fab_container (0,1582
  1080x352) at its centre (268,1673), drawn over it; only a 360x5 part of it shows …; nothing was tapped`.
- `assert` colour on `id:delete` (`button 88,1768 279x132`, wholly left of the FAB) → `FAIL … container id:fab_container (0,1582 1080x352) is
  drawn over the element (element 88,1768 279x132) — the capture would show it, not the element; scroll_until the element with \`fully:
  true\` first and re-run — or, if no scroll moves it out from under that, assert something in it that lies clear of that; failing closed,
  color unchecked` (13.6 s).
- plain `scroll_until id:delete` with its centre already clear of the FAB → `fully visible after 1 swipe` — one 804-px stroke (`540 1314 540
  510 805`) spent moving it out from under the host.
- The FAB itself is judged right: `tap id:workflow_label` (`text 88,1636 904x132`, centre (540,1702) under the FAB) → `… is under button "Add
  alarm" (408,1626 264x264) …` — but the reply then says `only a 904x2 part of it shows`, where 320x132 to the left of the FAB and 320x132 to
  its right are visible (the host is subtracted too), so the "moved tap" to an uncovered piece that round 9 F.2 allows can never happen.

## Repro


1. Clock → Alarm tab (two default alarms, both off). Tap `Collapse/Expand` so the 8:30 card is expanded and the 9:00 card collapsed: the 9:00
   card lies at `44,1533 992x367`, its chevron at `882,1533`, its switch at `849,1768`, inside `fab_container 0,1582 1080x352`.
2. `tap { selector: 'label:"Expand 9:00 AM alarm"' }` → refused "under container id:fab_container". The chevron is on screen, beside the FAB.
3. `assert [{ element: { id: "delete" }, color: { expected: "#18222A" } }]` with the 9:00 card expanded and its `Delete` at `88,1768` → fails
   closed naming `fab_container`.

## Evidence


`run12-android/session.log` #105 (17:26:15), #109 (17:27:11), #110 (17:27:24), #124 (17:29:15), #126 (17:29:26); trees `snapK4.txt`,
`snapK5.txt`, `snapK8.txt`; screenshots `img-106-0.png` (the "Google Assistant Routine" row's left and right parts visible beside the FAB),
`img-125-0.png` (the 9:00 card's chevron, digits and switch visible in the host's band). No shim tap for the refusals.

## Expected


A wrapper whose only drawable content is the FAB is no cover outside the FAB: a tap whose centre lies beside the FAB is tapped; a target
whose centre lies under the FAB is refused naming the FAB (or moved to its uncovered piece) and the reply measures the piece beside it; a
colour/OCR assert on an element beside the FAB measures; `scroll_until` does not stroke to clear a node from under the host.

## Suspected cause


`src/ui-tree/draw-order.ts`, `NOT_DRAWN.structural` (the `structural` row's `target` and `drawnOver` columns): a structural node with
children that is only PARTLY over the target is kept as a cover on purpose — "a wrapper only PARTLY over the target is a bar's frame, the
case the tab-bar host measured" (mp-native's Compose tab-bar host `66,1840 948x248`, a Material Surface that swallows touches). The FAB host
is the same shape in the tree (unlabelled `container` after the list, partly over the target, children = one button), but a View-based
`FrameLayout` with an identifier that only positions its FAB and takes no touches. The tree does not say which wrapper takes touches; the
pixel side (`paintsOver`) inherits the same "draws" answer. A rule that could tell them apart: the host is wider than its content and every
child it holds lies elsewhere than the target (the FAB is not over the target), or the uiautomator `clickable=false` attribute of the
wrapper (if the adapter keeps it).


## Device check (2026-10-14 Android, re-run at d407256)

Measured 2026-10-13 22:05–22:12 UTC (2026-10-14 00:05–00:12 local CEST), emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture
navigation — `settings get secure navigation_mode` = 2; Gboard docked, `touchableRegion=SkRegion((0,1332,1080,2022))`), averi = mobile-verify
`arch/round-13` @ `d407256` (detached; `git rev-parse --short HEAD` = `d407256`; `dist/` as built by the coordinator; stdio via the HTTP
daemon on port 47891, server `averi 0.9.0`, cwd mp-native). Every call is in `run13-android/session.log` (`#N` = call number there; images
`img-N-0.png`); averi's inputs from the `adb` shim in `run13-android/adb-input.log` (times UTC); two stagings by hand with the real `adb`
(slow `input swipe` drags on Settings, not in the shim log) and the two C.2 dumps with the real `adb shell uiautomator dump` + `adb pull`
(no adb server commands). Start state: Google Contacts on its Organize tab (`img-3-0.png`); mp-native in the background, logged in, on
"Mandatory data not loaded / TRY AGAIN" (the backend outage of round 12 still on: one TRY AGAIN #29 and one keyboard-test TRY AGAIN #33 did
not load data; no PIN re-login was needed or done). Scratch configs only; mp-native's `averi.yaml` untouched; no `requires:`, no
`ensure_state`/`run_flow`, no `clearState`.

### B.3 — **Holds** (refused naming `fab_container`, as round 13 intends; the trade-off is stated in the `tap` description)

Staging: Clock → Alarm tab, both alarms OFF as found; #6 `tap label:"Expand 8:30 AM alarm"` → `Tapped`, shim `22:06:29 input tap 937 330`.
The tree is round 12's shape exactly (`snapC2.txt`): 9:00 card `44,1533 992x367`, chevron `button id=arrow 'Expand 9:00 AM alarm' 882,1533
110x132`, digits `text '9:00 AM' 88,1577 360x191`, switch `switch id=onoff '9:00 AM alarm' 849,1768 143x132`; `container id=fab_container
0,1582 1080x352` after the pager, holding only `button id=fab 'Add alarm' 408,1626 264x264`. Screenshot `img-8-0.png`: chevron, "9:00" digits
and the switch all visible beside the round FAB.

- #9 `tap label:"Expand 9:00 AM alarm"` (centre (937,1599), right of the FAB) → `label:"Expand 9:00 AM alarm" is under container
  id:fab_container (0,1582 1080x352) at its centre (937,1599), drawn over it; only a 110x49 part of it shows, under the 65x65 a tap may be
  moved to — scroll_until it first; nothing was tapped` (5.8 s). No shim line.
- #10 `tap label:"9:00 AM"` (centre (268,1673), left of the FAB) → `label:"9:00 AM" is under container id:fab_container (0,1582 1080x352)
  at its centre (268,1673), drawn over it; only a 360x5 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first;
  nothing was tapped` (5.9 s). No shim line.
- #11 `tap label:"9:00 AM alarm"` (the switch, centre (921,1834), right of the FAB) → `label:"9:00 AM alarm" is under container
  id:fab_container (0,1582 1080x352) at its centre (921,1834), drawn over it; nothing of it shows — scroll_until it first; nothing was
  tapped` (5.7 s). No shim line.
- Replies are byte-identical to round 12's (#105/#109). Card collapsed again: #12 `tap label:"Collapse 8:30 AM alarm"` → shim `22:07:28 input
  tap 937 330`; both switches `checked="false"` in the dump.

The `tap` tool description (`$R/c __list`, `tools.json` line 35) — the passage explaining the trade-off, verbatim:

> A wrapper with children (a `container` or an `other`) laid after the content counts as drawn over all of its rect, unless, among others,
> it is the screen's size (90 % of it or more), or it has no label and no value and holds the target together with the target's whole
> scroll view, or it has no label, value or identifier and holds only empty frames — since the tree cannot tell a host that swallows
> touches (a tab bar's) from a transparent one that only positions its child (an Android floating action button's full-width host, e.g.
> Clock's fab_container): a target beside or under such a FAB can be refused naming the container — tap the FAB's own button when that is
> the target, or scroll_until the row out of the host's band.

Remark (wording, not judged): the description carries the trade-off, but the refusal itself does not — it still reads "drawn over it …
scroll_until it first", with no pointer that the cover may be a transparent FAB host. An agent reading only the reply would not know.

### C.2 — **Captured** (both raw dumps; evidence for Q2(b)/Q4)

Files: `run13-android/r13-clock-fab.xml` (dumped 22:07:11 UTC, same staging as B.3, FAB showing) and `run13-android/r13-mpnative-tabbar.xml`
(dumped 22:11:01 UTC, mp-native tab host on "Mandatory data not loaded", floating tab bar showing, `img-30-0.png`). Commands: `adb -s
emulator-5554 shell uiautomator dump /sdcard/r13-clock-fab.xml` / `… /sdcard/r13-mpnative-tabbar.xml`, then `adb -s emulator-5554 pull`.

Clock (raw node lines):

```
<node index="1" text="" resource-id="com.google.android.deskclock:id/desk_clock_pager_frame" class="android.view.ViewGroup" package="com.google.android.deskclock" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,242][1080,1934]">
<node index="1" text="" resource-id="com.google.android.deskclock:id/fab_container" class="android.view.ViewGroup" package="com.google.android.deskclock" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1582][1080,1934]">
<node index="0" text="" resource-id="com.google.android.deskclock:id/fab" class="android.widget.Button" package="com.google.android.deskclock" content-desc="Add alarm" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[408,1626][672,1890]" />
```

mp-native (raw node lines — the tab-bar host and its first two tabs; the other two tabs as `nav.tab_transactions`):

```
<node index="1" text="" resource-id="" class="android.view.View" package="com.finshape.skeleton.dev" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[66,1840][1014,2088]">
<node index="0" text="" resource-id="nav.tab_home" class="android.view.View" package="com.finshape.skeleton.dev" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="true" bounds="[102,1876][321,2052]">
<node index="1" text="" resource-id="nav.tab_transactions" class="android.view.View" package="com.finshape.skeleton.dev" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[321,1876][540,2052]">
```

| node | class | clickable | focusable | resource-id | children | ancestors |
|---|---|---|---|---|---|---|
| Clock `fab_container` `[0,1582][1080,1934]` | `android.view.ViewGroup` | **false** | **false** | `…:id/fab_container` | 1 (`fab`, Button, clickable/focusable true) | `desk_clock_pager_frame`'s sibling under `…:id/content` (ViewGroup), all clickable=false |
| mp-native tab host `[66,1840][1014,2088]` | `android.view.View` (Compose) | **false** | **false** | (none) | 4 (`nav.tab_*`) | 3 × `android.view.View` full-screen → `androidx.compose.ui.platform.ComposeView` → `android:id/content`, all clickable=false |

What this says for the bug note's "Suspected cause": **`clickable=false` cannot tell the two apart** — the tab-bar host that swallows touches
(a Compose Material Surface consumes pointer input without setting the semantics `clickable` flag) reports exactly the same
`clickable="false" focusable="false"` as the transparent FAB host. What differs in the raw XML: the class (`ViewGroup` vs Compose's generic
`View` — a toolkit difference, not a touch one), the resource-id (FAB host has one, the Compose host none), and child count/geometry (1 child
covering 264x264 of a 1080x352 host vs 4 tabs tiling 876x176 of 948x248). None of these is a touch attribute. (Side note: in the same dump
`nav.tab_home` — the selected tab — is `clickable="false"` while the other three are `true`.)


## Device check (2026-10-14 Android, re-run at e1384aa)

Measured 2026-10-14 06:54–07:00 UTC (06:54:36 first command, 06:59:48 last; 08:54–09:00 local CEST), emulator-5554 (Pixel_3a AVD,
Android 13 / API 33, 1080x2220, gesture navigation — `settings get secure navigation_mode` = 2), averi = mobile-verify `arch/round-14` @
`e1384aa` (detached; `git rev-parse --short HEAD` in `~/dev/mobile-verify` printed `e1384aa`, read-only; `dist/` as built by the coordinator;
server `averi 0.9.0`, cwd mp-native) via the HTTP daemon on port 47901. **Daemon restart:** my first `$R/c __list` (no args) sent
`{"name":"__list","args":{\}}` — `call.sh`'s `${2:-{\}}` default is not valid JSON — and `daemon.mjs` crashed on `JSON.parse` (no try
around it); I restarted it at 06:55:08 UTC exactly as before (`node daemon.mjs $R`, `AVERI_PORT=47901`, the `$R/shim` adb first on PATH,
`.env.averi` exported as the iOS daemon has it). No device call had been made before the crash; every call is in `session.log` (`#N` = call
number there, images `img-N-0.png`); averi's inputs from the adb shim in `adb-input.log` (times UTC). One read-only `uiautomator dump` to
`/sdcard/r14-clock.xml`, pulled to `$R/r14-clock.xml` and deleted from the device. Apps used: Google Clock (C.1), Settings (smoke),
mp-native `com.finshape.skeleton.dev` (looked at only). **No PIN re-login** — mp-native was on its inactivity "Logged out / LOGIN" screen
when brought forward at 06:58, and the single `tap text:"LOGIN"` I attempted to reach the PIN prompt was denied by the session's permission
classifier before it was sent (no session.log entry, no shim line), so C.2 and the mp-native R-added items are not reached. No
`requires:`, no `ensure_state`/`run_flow`, no `clearState`, no `averi.yaml` edit.

### C.1 — **holds** (refused naming `container id:fab_container`; the new wrapper hint ends every refusal, verbatim as the handoff asks)

Staging as round 13: Clock → Alarm tab (#5 `launch_app` with `activity: com.android.deskclock.DeskClock`), both alarms OFF; #8 `tap
label:"Expand 8:30 AM alarm"` → `Tapped`, shim `06:56:06 … input tap 937 330`. Tree `snapC2.txt`: 9:00 card `alarm_card_layout 44,1533
992x367`, chevron `button id=arrow 'Expand 9:00 AM alarm' 882,1533 110x132`, digits `text id=digital_clock '9:00 AM' 88,1577 360x191`,
switch `switch id=onoff '9:00 AM alarm' 849,1768 143x132`, `text id=days_of_week 'Sunday, Saturday' 88,1806 163x57`; `container
id=fab_container 0,1582 1080x352` after the pager holding only `button id=fab 'Add alarm' 408,1626 264x264`. Screenshot `img-10-0.png`:
chevron, "9:00" digits, "Sun, Sat" and the switch visible beside the round FAB. (Since round 13 the expanded 8:30 card gained a `Pause alarm`
row, so `workflow_label` now lies at `88,1247`, above the host — see Gaps.)

- #11 `tap label:"Expand 9:00 AM alarm"` (centre (937,1599), right of the FAB) — 5.6 s:
  > `label:"Expand 9:00 AM alarm" is under container id:fab_container (0,1582 1080x352) at its centre (937,1599), drawn over it; only a 110x49 part of it shows, under the 65x65 a tap may be moved to — the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`
- #14 `tap label:"9:00 AM"` (the digits, centre (268,1673), left of the FAB; the label carries U+200A as at round 13 — my #12 with a
  plain space timed out `Timed out after 5000ms waiting for element label:"9:00 AM" to appear`, a selector slip, not averi) — 5.8 s:
  > `label:"9:00 AM" is under container id:fab_container (0,1582 1080x352) at its centre (268,1673), drawn over it; only a 360x5 part of it shows, under the 65x65 a tap may be moved to — the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`
- #13 `tap label:"9:00 AM alarm"` (the switch, centre (921,1834), right of the FAB) — 5.8 s:
  > `label:"9:00 AM alarm" is under container id:fab_container (0,1582 1080x352) at its centre (921,1834), drawn over it; nothing of it shows — the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`
- #15 `tap id:days_of_week` ("Sun, Sat", centre (170,1835), left of the FAB) — 5.6 s:
  > `id:days_of_week is under container id:fab_container (0,1582 1080x352) at its centre (170,1835), drawn over it; nothing of it shows — the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`

The cover clause before the dash is byte-identical to round 13 (#9–#11 there); only the remedy changed, from `— scroll_until it first;
nothing was tapped` to the wrapper sentence. The `(…)` the handoff leaves open is the FAB's rect, `(408,1626 264x264)`. Shim: no line
between `06:56:06` (staging) and `06:57:10` (#16, below) — none of #11, #13, #14, #15 tapped. Card collapsed again #23 `tap
label:"Collapse 8:30 AM alarm"` → shim `06:58:04 … input tap 937 330`; dump `r14-clock.xml`: `content-desc="8:30 AM alarm" checked="false"`,
`content-desc="9:00 AM alarm" checked="false"` — both alarms OFF as found.


## Device check (2026-10-14 Android, re-run at ebe6822)

Round 16 Android device check, 2026-10-14 17:07:57–17:21:08 UTC, emulator-5554 (Pixel_3a AVD, Android 13 / API 33, 1080x2220, gesture navigation, `navigation_mode` = 2 before and after). averi built from `~/dev/mobile-verify` `arch/round-16` at `ebe6822`, checked with `git rev-parse --short HEAD` → `ebe6822` (read-only, detached), daemon on port 47911 via `$R/c`. Apps: mp-native `com.finshape.skeleton.dev` (first, already logged in by the owner, on Account Detail), Google Clock `com.google.android.deskclock`, Settings `com.android.settings`. **No PIN re-login was needed:** mp-native stayed logged in for the whole run. No `ensure_state`/`run_flow`, no `login` rung, no registration, no credentials typed, no `clearState`. **Backend: working.** Account Detail loaded balances (1,121.00 CZK / 2,000.00 CZK, "Account 1 of 4") and a full transaction list. Two transaction details opened with data. The SWIFT form loaded the debit account. No "Mandatory data not loaded" screen appeared. Calls #2–#92 are in `session.log`. The shim log `adb-input.log` has 66 lines, and every line cited below is quoted from it.

**R15 D.3 Clock FAB hint. Holds, as round 14.** In Clock (Alarm tab), I expanded the 8:30 card (#86) so that the 9:00 card lay in the FAB host's band (`clock3.txt` #87: `days_of_week 'Sunday, Saturday' 88,1806 163x57`, `fab_container 0,1582 1080x352`). #88 `tap text:"Sunday, Saturday"` →
`text:"Sunday, Saturday" is under container id:fab_container (0,1582 1080x352) at its centre (170,1835), drawn over it; nothing of it shows — the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`
No shim tap. The cards were collapsed again (#89), and both `onoff` switches were `checked="false"` before and after (raw dump, `clock1.xml`). Alarms were OFF as found.
