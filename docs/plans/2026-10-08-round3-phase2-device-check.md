# Device check: round 3, phase 2 — the swipe box, derived descriptions, OCR decided once, the reboot hint (2026-10-08)

> **Status (2026-10-08):** on main.
>
> The build sha below is a pre-squash branch commit; on main: `2a4fc84` → `49d4bae`.

**Measured 2026-10-08 13:04–13:13 CEST**, averi `dist/` rebuilt (`npm run build`) from `2a4fc84`, the head of branch
`architecture/round3-2026-10-08` at the time (the shas below are the commits as squashed after this check), which carries the four phase-2 commits under test: `326503a` (the simulator reboot hint
has one owner and names the bound UDID), `882e28f` (tool descriptions derive their numbers from the owning constants),
`4de6a2a` (a verify run decides OCR once; one OCR measurement owner; an unavailable engine fails closed after one read)
and `820226a` (the screen swipe uses the device's screen box; MCP `swipe` takes `direction` or four coordinates).
Driven through the stdio MCP driver `run-tools.mts` (with its `sleep` / `sh` pseudo-steps), plus a copy
`run-tools-p.mts` that overrides only the server's `PATH`. Server cwd `/Users/mholecy/dev/finportal/app`. Its
`averi.yaml` and `.env.averi` were not modified, and every call that reads config passes `configPath` to a scratch copy.
Devices: `emulator-5554` (Android 13, **`wm size` 1080x2220**, not the 1080x2400 the brief assumed) and `iPhone 17`
(`D34212DB-2134-43E4-99D8-FA89136C729B`, iOS 26.5, `idb describe`: 402x874 points). App: `sk.finportal.myport`
debug build (expo dev-client, Metro on :8081), on its login screen throughout. No login was submitted. No `login` flow
and no `ensure_state logged_in` were run. Nothing was typed, so no credentials were entered. No clearState, logout or
uninstall was used, and no login-screen control was tapped.

Every scratch file is in the session scratchpad, `device-round3-p2/`:
- configs: `r3p2-averi.yaml` (round-3 phase-1's copy, `treeSource: wda`, plus the flows `r3p2_swipe_up`,
  `r3p2_swipe_down`, `r3p2_swipe_left2` (`swipe: { direction: left, times: 2 }`) and `r3p2_scroll_nosuch`
  (`scroll_until` to a missing id, `maxSwipes: 2`)), `r3p2-idb.yaml` (the same file without `treeSource`), and
  `r3p2-contract.json` (a scratch contract, see O3)
- `PATH` wrappers: `bin/adb` and `bin/idb` log every `input swipe`, `wm size` and idb call to `gestures.log` and then run
  the real binary. `bin-swiftlog/swiftc` logs and runs `/usr/bin/swiftc`. `bin-swiftfail/swiftc` exits 1.
  `bin-noswift/` has only the adb and idb wrappers plus `xcrun` and `xcodebuild` symlinks; the server `PATH` there is
  `bin-noswift:/bin`, so `swiftc` is ENOENT.

## S — `820226a` the swipe gesture

Expected strokes, from `swipeVector` (centre ± 0.3 × the side): Android 1080x2220 gives up (540,1776)→(540,444) and
left (864,1110)→(216,1110). iOS 402x874 gives up (201,699)→(201,175) and left (322,437)→(80,437).

| # | check | expected | actual | verdict |
|---|---|---|---|---|
| S1 | MCP `swipe` `direction` up/down/left/right, Android | stroke over the `wm size` box | `Swiped up (540,1776) → (540,444)`, `Swiped down (540,444) → (540,1776)`, `Swiped left (864,1110) → (216,1110)`, `Swiped right (216,1110) → (864,1110)`, about 2.4 s each. `gestures.log` shows exactly `shell input swipe 540 1776 540 444 300` and so on, after one `wm size`. `durationMs: 600` reached adb as `… 540 444 600` | PASS |
| S1 | same, iOS (WDA config) | stroke over the 402x874 box | `Swiped up (201,699) → (201,175)`, `Swiped down (201,175) → (201,699)`, `Swiped left (322,437) → (80,437)`, `Swiped right (80,437) → (322,437)`, 1.4–3.7 s (the first call starts WDA). idb got `ui swipe 201 699 201 175 --duration 0.3 …` after one `idb describe --json`. `durationMs: 600` was sent as `--duration 0.6` | PASS |
| S2 | coordinates | sent as given | Android `Swiped (540,1200) → (540,1500)` in 0.4 s. iOS `Swiped (201,500) → (201,600)` in 1.0 s, as `idb ui swipe 201 500 201 600 --duration 0.3` with no `describe` and no tree read | PASS |
| S2 | refusals, before a device is bound (fresh server, both platforms) | three distinct refusals, nothing sent | both: `Provide either direction or fromX/fromY/toX/toY, not both`; neither: `Provide either direction (up/down/left/right) or all four of fromX, fromY, toX, toY`; partial: `Coordinates need all four of fromX, fromY, toX, toY (or use direction instead)`. All six took 0.0 s. `gestures.log` was empty afterwards, and `list_devices` straight after showed no `"active"` key on any device (nothing bound) | PASS |
| S3 | flow `swipe:` step | trace line and the same stroke | Android: `swipe: up` → `input swipe 540 1776 540 444 300`; `swipe: left ×2` → two `864 1110 216 1110`; `swipe: down` → `540 444 540 1776`. iOS: `swipe: up` → `201 699 201 175`; `swipe: left ×2` → two `322 437 80 437`; `swipe: down` → `201 175 201 699`. Each run ended `flow …: done` / `appAlive: true`, with no ⚠ note (a device size and a read tree, the ordinary path) | PASS |
| S4 | `scroll_until` to a missing id, `direction: down`, `maxSwipes: 2` | the same stroke as `swipe up` | Android ERROR 7.6 s, `scroll_until id:r3p2_nosuch_scroll failed after 2 swipes (maxSwipes) — element never appeared in the tree`, with two `input swipe 540 1776 540 444 300`. iOS ERROR 4.2 s, the same message, with two `idb ui swipe 201 699 201 175 --duration 0.3`. `direction: up`, `maxSwipes: 1` on Android drew `540 444 540 1776` (= `swipe down`). The flow `scroll_until:` step drew the same two strokes, and its trace was `✗ scroll_until id:"r3p2_nosuch_scroll": failed — …` | PASS |
| S4 | `scroll_until` to an existing id (`login_support_email`) | stops | `Element id:login_support_email fully visible after 0 swipes` on both platforms, no stroke sent. The login screen fits the viewport, so "found after N>0 swipes" could not be exercised | PASS (0-swipe path only) |
| S4 | `durationMs` | — | `scroll_until` does not expose `durationMs`. Its strokes went out at the adapter's default 300 ms, the same as the swipe tool's default | n/a |
| S5 | landscape, Android | the box turned: 2220x1080 → up (1110,864)→(1110,216) | **The app is portrait-locked** (`app.json` `"orientation": "portrait"`, manifest `screenOrientation="portrait"`). (a) With the app in front, `user_rotation 1` left the display at `ROTATION_0`, 1080x2220, and `swipe up` gave `(540,1776) → (540,444)`: the box was correctly not turned. (b) In the Settings app (`am start -a android.settings.SETTINGS`), `user_rotation 1` gave `cur=2220x1080`, and the tree root read 2220x1080. Then `swipe up` returned `Swiped up (1110,864) → (1110,216)`, `swipe left` returned `Swiped left (1776,540) → (444,540)`, and `scroll_until … direction: up, maxSwipes: 1` drew `1110 216 1110 864`. All of these lie inside the landscape panel. After that, portrait was restored, and the app was brought back with `launch_app` (no clearState), landing on its login screen | PASS |
| S6 | iOS tree source of a direction swipe | WDA under the wda config, idb under the idb config, no config read for coordinates | With the wda config, the idb calls were only `describe --json` + `ui swipe` (no `ui describe-all`): the tree was read through WDA. With the idb config, the calls were `ui describe-all --json`, `describe --json`, `ui swipe`. Coordinates with `configPath` pointing at round 2's syntactically broken YAML succeeded on iOS (`Swiped (201,500) → (201,600)`). A direction with the same file was refused at load: `Invalid …/broken-yaml.yaml: Block collections are not allowed within flow collections at line 99, column 5`. On Android a direction with the broken file succeeded, as `TOOL_CONFIG.swipe` specifies (`onIos` for a direction, `NO_CONFIG` otherwise) | PASS |

## D — `882e28f` descriptions

`listTools` on a fresh server (`tools.json`):

| tool | expected | found | verdict |
|---|---|---|---|
| ui_snapshot | brief: "5 s" | **"3 s"**: `assert polls (3 s by default; set "timeout" in the spec)`. No "5 s" appears in it. The commit names "3 s" for ui_snapshot, built from `ASSERT_TIMEOUT_MS = 3_000`. The brief's "5 s" does not match the code or the spec | PASS (against the commit) |
| assert | "3 s", "12 s" | `waits up to 3 s (tree asserts) or 12 s (color/ocr — …` | PASS |
| ensure_state | "~20 s" | `for the whole ~20 s second look` | PASS |
| scroll_until | maxSwipes "Default 6" | `"maxSwipes":{…,"description":"Default 6"}` | PASS |
| get_logs | "default 400" | `"default":400,"description":"Keep only the last N matching lines (default 400)…"` | PASS |
| swipe | "30%" | `a stroke through the screen centre, 30% of the screen either side` | PASS |
| verify | "default 8", "1.5x", "default 10%" | `tolerance_de, default 8; vs-contract at 1.5x`, `tolerance_size_pct, default 10%` | PASS |
| get_logs, no maxLines | ≤ 400 lines | Android: `[truncated: showing last 400 of 550 lines]` + 400 lines (0.1 s). iOS: `[truncated: showing last 400 of 3048 lines]` + 400 lines (1.1 s) | PASS |

## O — `4de6a2a` OCR

| # | check | expected | actual | verdict |
|---|---|---|---|---|
| O1 | `assert` ocr, Android: `login_title` text "Login" and `maintenance_text` match `rozsirenie docker` (read from a snapshot first) | pass | `All 2 asserts passed` / `PASS  element id:"login_title" renders text "Login" — read "Login"; vs expected "Login" =` / `PASS  element id:"maintenance_text" renders matching /rozsirenie docker/ — read "Infra - rozsirenie docker o dalsi node"; vs /rozsirenie docker/ matches`, 6.1 s | PASS |
| O1 | same, iOS (WDA) | pass | the same two PASS lines, 6.8 s | PASS |
| O1 | wrong match `/Prihlasenie/` | fails and polls out the ~12 s budget | Android **14.4 s**, iOS **12.9 s**: `FAIL  element id:"login_title" renders matching /Prihlasenie/ — read "Login"; vs /Prihlasenie/ NO MATCH` | PASS |
| O2 | no `swiftc` (ENOENT, `PATH=bin-noswift:/bin`): `[ocr login_title, element login_username]` | fails closed after one read, well under 12 s; the next assert is still judged | Android **4.9 s**, iOS **5.7 s** (both include the tree read for the element): `FAIL  element id:"login_title" renders text "Login" — OCR failed: OCR needs the Swift compiler: \`swiftc --version\` failed — install the Xcode Command Line Tools (xcode-select --install). Underlying error: Command failed (exit null): swiftc --version`⏎`spawn swiftc ENOENT; failing closed, rendered text unchecked`, then `PASS  element id:"login_username" exists` | PASS |
| O2 | `swiftc` that exits 1 (`bin-swiftfail`) | the same | Android 5.0 s, iOS 5.2 s: `… Underlying error: Command failed (exit 1): swiftc --version`⏎`scratch shim: swiftc unavailable; failing closed, rendered text unchecked`, then the element PASS. One `swiftc --version` probe per assert call (one Verifier per call) | PASS |
| O2 | the binary cache | — | The probe (`swiftc --version`) runs before the `$TMPDIR/averi-ocr-bin/recognizer-<key>` cache lookup, so the cached `recognizer-f55247f49e407346` did not shield the probe, and nothing was deleted. `tmpdir()` is the only cache-dir input; no averi env var | n/a |
| O3 | `verify` with an OCR text contract | OCR decided once | **finportal has no layout contract** (no contract file under `finportal/app`, and none referenced in `averi.yaml`), so a scratch contract was used: `r3p2-contract.json`, anchors `login_title` text "Login" and `maintenance_text` text "Infra - rozsirenie docker o dalsi node". The verify was both legs, plus the two ocr asserts, no state or flow. The `swiftc` call log is the per-run witness: **exactly one `swiftc --version` per verify run** with the logging shim (13:12:31), and exactly one with the failing shim (13:12:01). That one choice served 2 legs × 2 ocr asserts and the text table. Working OCR (8.4 s): all four asserts PASS, `## text parity` `src ocr` `Login`/`Login` Δsize 6.38% OK, `maintenance_text` 7.73% OK, `MATCHES`. Failing shim (7.9 s): all four asserts fail closed with the same reason, and the table says `(android: OCR failed — … — that platform compared from the tree.)` and the same for ios. ENOENT (7.9 s): the same | PASS |

## R — `326503a` the reboot hint

| # | check | expected | actual | verdict |
|---|---|---|---|---|
| R1 | the iOS idb tree (`r3p2-idb.yaml`, default treeSource) right after `simctl terminate` + `launch_app` | if `IdbEmptyTreeError` shows, the advice names the bound UDID and has no "stderr" | **Provoked, twice** (two cold launches, 0.4–0.5 s after the launch returned): `idb returned an empty accessibility tree (only a 0×0 Application)` / `… if that does not clear it, reboot the simulator (\`xcrun simctl shutdown D34212DB-2134-43E4-99D8-FA89136C729B && xcrun simctl boot D34212DB-2134-43E4-99D8-FA89136C729B\`); app.ios.treeSource: wda in averi.yaml reads the tree through WebDriverAgent instead`. Across the log, `<udid>` and "stderr" occur 0 times. The launch's stderr line also names the UDID: `averi: set com.apple.Accessibility AutomationEnabled and ApplicationAccessibilityEnabled to true on D34212DB-…`. The simulator was not rebooted | PASS |

## Observations / could not verify

1. **The landscape panel was checked in the Settings app, not in finportal.** The app is portrait-locked, so with the app
   in front, `user_rotation 1` does not rotate the display. In that state the box correctly stays 1080x2220. The turned
   box (2220x1080 → `(1110,864) → (1110,216)`) was measured in `com.android.settings`. The finportal app was then
   relaunched without clearState. A left-nav-bar landscape inset (`126,0 2274x1080`) did not occur on this emulator
   (`app=2220x1014`, a bottom bar), so that branch of `windowTurnsScreen` was not exercised on a device.
2. **Device sizes differ from the brief.** `emulator-5554` reports `Physical size: 1080x2220`, so the expected portrait
   up-stroke is `(540,1776) → (540,444)`, not `(540,1920) → (540,480)`. Every stroke matched `swipeVector` on the real size.
3. **The ENOENT reason spans two lines (cosmetic).** The exec error's message carries a newline and `exit null`:
   `Underlying error: Command failed (exit null): swiftc --version`⏎`spawn swiftc ENOENT; failing closed, …`. So the
   FAIL line of an assert, and the text table's parenthetical, break mid-sentence. This was the case before `4de6a2a`
   (the wording comes from `ExecError` and ocr.ts's probe message). Not a phase-2 defect. Fixed after this check in `4de6a2a`: the probe folds the cause onto one line (`… swiftc --version — spawn swiftc ENOENT`), pinned by tests/verify/ocr.test.ts.
4. **The iOS text table's tree fallback reads "Login Login" (pre-existing).** With OCR unavailable, the ios column of
   `## text parity` reads the WDA tree as `Login Login` and the maintenance text doubled. So the fallback reports 4 TEXT
   FINDINGS that working OCR does not. This predates phase 2. The cause, found in round 4 (2026-10-08), is not the
   tree fallback's join over a labelled container (that case was already read once): WebDriverAgent reports every
   React Native `<Text>` as a `StaticText` carrying the `testID` that holds exactly ONE unidentified `StaticText` with
   the identical label, value and rect (`login_title` → child `Prihlásenie`, both 36,291 330x24, in
   `tests/fixtures/wda-source-myport-login-no-keyboard.json`; every text in the MyPort fixtures, none in the SwiftUI
   skeleton). `renderedTextFromTree` walked into the echo and joined both strings. The same echo made a
   `text:"Prihlásenie"` selector match two nodes and `ui_snapshot` print each text twice. Android (one TextView) was
   never affected. Fixed in the round-4 commit `fix(ios): a React Native <Text> read through WebDriverAgent is one
   element, not two — …`: `wda-source.ts#isTextEcho` drops the echo when the WDA tree is parsed, and keeps the outer
   element, the one that carries the `testID` when there is one.
5. **`IdbEmptyTreeError` on a just-launched app.** The error was raised by a single `ui_snapshot` 0.4 s after
   `launch_app` returned. A read 0.3 s later was a bare 2-node tree, and the rendered tree came within about 4 s. So
   the error, with its reboot advice, also fires on a transient pre-render 0×0 Application, not only on the stuck tree
   it describes. `ui_snapshot` does not wait, as documented, and `assert` polls past it (`PASS element role:"button"`
   1.1 s later). This behaviour predates phase 2. Only the wording was under test. Addressed after this check by `fix(ios): ui_snapshot's settle read
   re-reads an idb empty tree once a second later …` (not device-checked): `ui_snapshot`'s `settle` read now re-reads an
   idb empty tree once after 1 s (`IosAdapter.uiTree`, `IDB_EMPTY_RETRY_MS`), and a second empty tree fails with the same
   first line and advice opening `The read was retried once after 1 s and was still empty`; pollers and the stuck path
   are unchanged. Closed later: device-checked in round 4 ([2026-10-08-round4-device-check.md](2026-10-08-round4-device-check.md)
   §I: 12 of 13 cold-launch snapshots returned a rendered tree; the retried error was not provoked on device).
6. **`scroll_until` "found after N>0 swipes" was not exercised.** The login screen fits the viewport on both platforms,
   and no scrollable screen is reachable without logging in.
7. **The iOS rotate path was not exercised.** No iOS rotation was done.
8. **Device state left:** both devices are in portrait. Android `user_rotation 0`, `accelerometer_rotation 1` (its value at the
   start; it was set to 0 only for the rotation tests). Display `cur=1080x2220`, focus `sk.finportal.myport/.MainActivity`.
   Both apps are on the login screen, and the username field is empty on both (`"value": null`, never typed into).
   WebDriverAgent is stopped when each server exits; the iOS app was last launched under the idb config.
