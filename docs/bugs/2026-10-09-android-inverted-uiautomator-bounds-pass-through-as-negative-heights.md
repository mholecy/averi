# BUG: on Android uiautomator's inverted bounds (bottom above top) reach averi as negative heights — `ui_snapshot` shows them raw, the tap's hint calls them "0×0", and `scroll_until` neither sees them at its far edge nor reaches them by default

> **Status (2026-10-09):** open. Found by the round-6b device check (Android), averi `fix/round-6b` @ `5e5a3d1`.

> **Lab (2026-10-18):** reproduced on the lab's `averi_lab` AVD by `edges/scroll-collapsing` (Edges.kt#CollapsingList,
> truth/r6-cells): Settings' shape in Views, a NestedScrollView laid below a collapsed CollapsingToolbarLayout app bar,
> neither it nor its CoordinatorLayout clipping children. Row A, scrolled wholly above the list's top (frame
> `127,-11 825x176`, the list `0,220 1080x2000`), is dumped `[127,220][952,165]`: View#getBoundsOnScreen clamps each
> side to each parent apart (its top to the list's, its bottom where it lies), and a group's bounds clip a child's
> visibility only where the group's parent clips children — so the row stays visible to the accessibility framework,
> and is dumped. Calibrated in scripts/truth/calibration.json #10: DOES-NOT-FAIL on the replayed rows (toward A,
> `up`: both 10fb02b and d2b7744 refuse the tap naming scroll_until and stroke inside the list; the fix changes the
> wording, `0×0 nodes` → clipped out above, `height -55` → 0); the default-direction turn is the live case
> `turn:scroll-collapsing.A`, not yet run.

## Summary

Android Settings homepage, scrolled so the first rows pass under the collapsing app bar. uiautomator itself emits inverted bounds for
those nodes: raw dump `text="Settings" bounds="[66,66][428,44]"`; `ui_snapshot` relays them unchanged: `homepage_title 66,66 362x-22`,
`text 'Apps' 198,297 126x-239` (later `x-114`, `x-132`), `summary 198,297 621x-186`. Consequences:

1. **`ui_snapshot`** prints negative heights with no note.
2. **`tap text:"Apps"`** → `Timed out after 5000ms waiting for element text:"Apps" to appear (it matched only 0×0 nodes (scrolled off screen,
   or collapsed) — …)` — correct to refuse, but the node is `126x-239`, not 0×0.
3. **`scroll_until text:"Apps"`** (default direction) does not read the row as resting at the top edge (S's far-edge turn needs
   `visible > 0`): the first stroke goes the wrong way (`540 1783 540 669 1116`), then the turns are half-reach `540 669 540 1226 558`,
   which the collapsing toolbar absorbs (its nested scroll expands first). 21:12:36 → `failed after 15000ms (timeout) — element in tree but
   never intersected the 1080x2220 viewport (last rect {"x":198,"y":297,"width":126,"height":-132}). It was turned round 1 time …`; the
   same call earlier (21:09:14) needed 4 strokes. `direction: "up"` reaches it in 1 (`540 669 540 1783 1116`).

## Repro

1. `launch_app com.android.settings`, `scroll_until text:"Display", fully: true` (1 swipe), or drag by hand ~320 px so `Apps` goes under
   the app bar.
2. `ui_snapshot` → `text id=title lab='Apps' 198,297 126x-114`; `adb shell uiautomator dump` → inverted `bounds`.
3. `tap { selector: 'text:"Apps"' }` → the 0×0 hint. `scroll_until { selector: 'text:"Apps"' }` → timeout as above.

## Evidence

`run9-android/session.log` #160–#165, #187–#192; shim 21:09:17–21:09:29, 21:12:10, 21:12:38–21:12:47.

## Where

- `src/adapters/android.ts:1034` `parseBounds`: `{ height: b - t }` with no check for `b < t` / `r < l`.
- `src/interact/resolve.ts:324` `ZERO_AREA_HINT` (says 0×0 for any non-positive area).
- `src/interact/scroll-rounds.ts:1025` `beyondFarEdge` and `:1189` `atFarEdge` (`best.visible > 0`): a node with negative height is
  neither beyond the far edge (its `y` 297 is inside the frame) nor in it.

## Suggestion

Normalize in the parser: an inverted rect means the node is clipped out entirely on the side its bounds were clamped to — e.g. `[66,66][428,44]`
lies ABOVE the visible area: store a zero-height rect at `y = bottom` (44) and keep the inversion as a fact (`clippedOut: 'top'`), so the
scroll reads it as beyond the top edge and turns at once with full reach; say "clipped out above the screen" in the tap's hint and in
`ui_snapshot` instead of a negative height.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**B1 — Holds (1–3); one wording gap in `scroll_until`'s failure.** Settings (force-stopped, then `scroll_until text:"Display" fully` →
`input swipe 540 1736 540 484 1254`, 1 swipe).

- **B1.1:** `ui_snapshot` → `text 'Apps' 198,297 126x0 clippedOut=top`, its row's `container 0,297 1080x0`, `icon_frame`, `icon`,
  `text_frame`, `summary` and `Notifications` all `…x0 clippedOut=top`; at the bottom `container 0,2154 1080x0 clippedOut=bottom`; the
  collapsed `homepage_title 'Settings' 66,66 362x0 clippedOut=top`. No negative height anywhere.
- **B1.2:** 06:38:23 `tap text:"Apps"` → `Timed out after 5000ms waiting for element text:"Apps" to appear` / `(it matched only nodes clipped
  out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)`, no shim tap.
- **B1.3:** `scroll_until { selector: 'text:"Apps"', direction: "up" }` → `fully visible after 1 swipe`, `input swipe 540 669 540 1783 1116`.
  Plain (`down`) from `Apps 198,297 126x0 clippedOut=top` (06:40:08) → **4 strokes** `540 1783 540 669 1116`, all the wrong way (the owner's
  default), then `failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes
  were not taken) — element was in the tree before the first swipe (off the viewport, or under the soft keyboard), never in the viewport,
  and is no longer in the tree — a swipe carried it out (a fling?) and a lazy list drops what scrolls away` (16.4 s).
- **Gap (not a regression, worth fixing with B1):** that cause clause is wrong for this shape — the node was `clippedOut: "top"` before the
  first stroke, i.e. averi KNEW it lay above; the sentence guesses "off the viewport, or under the soft keyboard" and "a fling?" and does not
  carry the wait's `clipped out above its scroll container … scroll_until it with direction: "up"` hint (`src/interact/scroll-text.ts`,
  `absenceError`/the `sighted` branch near l. 340; `src/interact/resolve.ts:374–382` has the hint). Same family, without B1: a target scrolled
  wholly past the top (absent from the tree) gives `failed after N swipes (…) — element never appeared in the tree` with no "try direction:
  up" (Settings `Apps` 06:39:06, SWIFT `amount_input` 06:23:51).

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

B1 (round 8) holds in Settings.
- Staged `Apps` clipped out above: `text id=title 'Apps' 198,297 126x0 {clippedOut: top}` (also `Notifications`), no negative heights.
- Plain `scroll_until text:"Apps"` → `scroll_until text:"Apps" failed after 4 swipes (the last 2, swiping down, did not change the screen:
  content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its
  scroll container, past the edge the swipes push it out through, never in the viewport, and is no longer in the tree (a lazy list drops
  what scrolls away) — scroll_until it with direction: "up"` — no "(a fling?)". 4 strokes `input swipe 540 1783 540 669 1116`, no turn
  (owner's default).
- `scroll_until text:"Apps" direction: "up"` → `fully visible after 3 swipes` (`input swipe 540 669 540 1783 1116` ×3); `Apps
  198,1170 126x74`.
- **Gap (by design, not in the handoff's §5):** the "if it lies above" hint needs a stroke that changed the screen first. Started already
  at the end of the list (a hand fling to the bottom of Settings), plain `scroll_until text:"Battery"` → `failed after 2 swipes (the last
  2, swiping down, did not change the screen: …) — element never appeared in the tree` — no hint, though this is the case where the
  target can only lie above. `src/interact/scroll-rounds.ts:1862` (`ranToEnd = s.treeMoved && …`), its doc at `:446–452`.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**B1 on iOS (R-6.6) — the round-8 hint is not reachable on iOS; see the new note.**
- Settings › Language & Region, `id:en-US` at `20,-57` (above the viewport): plain `scroll_until` → turns at once, 1 stroke
  (`201 175 → 201 437`), reached. (Its reply adds `— PARTLY UNDER button "Reorder English (US)" (335,171 27x62), drawn over it — 94% of it
  shows, its centre clear` — the row's own reorder handle, a sibling inside the same cell.)
- A never-found target in a list already at its end (Settings › General, `text:"No Such Row"`): 6 strokes, `failed after 6 swipes
  (maxSwipes) — element never appeared in the tree`; with `maxSwipes: 15` → 15 strokes, the same. No "content exhausted", so no
  `if it lies above, try direction: "up"` — new note below.
- mp-native Account Detail (its list does not move at all): `failed after 2 swipes (the last 2, swiping down, did not change the screen:
  content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree` — no hint either (no stroke
  ever changed the screen, as designed).


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

Round 9 §3.4 B1 — **Holds, verbatim round 8.** Settings, `Apps` staged clipped out above (`text id=title 'Apps' 198,297 126x0 {clippedOut:
top}`): #149 plain `scroll_until text:"Apps"` → `failed after 4 swipes (the last 2, swiping down, did not change the screen: content
exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its scroll
container, past the edge the swipes push it out through, never in the viewport, and is no longer in the tree (a lazy list drops what scrolls
away) — scroll_until it with direction: "up"` (16.5 s), `input swipe 540 1783 540 669 1116` ×4 (round 8's stroke, no turn). #150
`direction: "up"` → `fully visible after 3 swipes` (`540 669 540 1783 1116` ×3), `Apps 198,1278 126x74`.
