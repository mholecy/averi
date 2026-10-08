# Device check: round 3, phase 1 — discovery in the registry and the three-valued condition (2026-10-08)

> **Status (2026-10-08):** on main.
>
> Shas below are pre-squash branch commits; on main: `c809293` → `820226a`, `1d67ced` → `326503a`, `7ce3ff1` → `882e28f`, `3e248fe` → `4de6a2a`.

**Measured 2026-10-08 12:45–13:05 CEST**, averi `dist/` rebuilt (`npm run build`) from `c809293`, the head of branch
`architecture/round3-2026-10-08` before phase 2's code-review fixups were squashed in (they move swipe code and touch no phase-1 code path), which carries the two phase-1 commits under test: `8413120` refactor(adapters),
device discovery is the registry's own seam, and `d165ce4` refactor(flow), a Condition is one module that can say "this
tree cannot decide it". The four later commits on the branch are in the build but were not under test. Driven through the
stdio MCP driver `run-tools.mts` (with its `sleep` / `sh` pseudo-steps). Server cwd `/Users/mholecy/dev/finportal/app`:
its `averi.yaml` and `.env.averi` were not modified, and every engine case passes `configPath` to a scratch copy.
Devices: `emulator-5554` (sdk_gphone64_arm64, Android 13) and `iPhone 17` (`D34212DB-…`, iOS 26.5, `treeSource: wda`).
App: the finportal `sk.finportal.myport` debug build (expo dev-client). No login was submitted. No `login` flow and no
`ensure_state logged_in` were run, and no credentials were typed. No clearState and no uninstall were used. Every cold
start is `am force-stop` or `simctl terminate`, a 1.5 s pause, then `launch_app` without clearState. Durations are the
tool call's own, timed from the moment `launch_app` returned (0.1–0.2 s on Android, 0.9 s on iOS). Host load average
was 3.8–7.9.

**Metro was not running at the start.** The first Android pass (`b-android-redbox.log`) ran against React Native's red
box "loadJSBundleFromAssets": a rendered, 33-node tree with no login screen. Metro was then started
(`CI=1 npx expo start --dev-client --port 8081` in finportal/app), and the bundle was warmed with one launch on each
platform. All verdict rows below come from after that. The red-box pass is still useful evidence; see Observations 3.

Scratch config `device-round3-p1/r3-averi.yaml` is finportal's file plus the following. Its flows tap only ids that do
not exist, and only inside `optional:`.
- states `no_prompt: { detect: { element: { id: r3_nosuch_prompt }, absent: true }, reach: [r3_harmless] }`,
  `r3_username_gone` (`login_username` absent) and `r3_nosuch_gone` (`r3_nosuch_wait` absent). A flow's `wait:` takes
  `element` or `state` only, with no `absent` key, so a wait on an absence is a wait on a state whose detect is that absence.
- flows `r3_harmless` (`optional: [tap id:r3_nosuch_rung_marker, 1s]`); `r3_wait_absent_login_{05,4,8,30}`, which is
  `wait: { state: r3_username_gone }` with a 500 ms, 4 s, 8 s or 30 s timeout; `r3_wait_absent_nosuch{,_05}`, a wait
  on `r3_nosuch_gone` for 40 s or 500 ms; and `r3_branch`, whose arm 1 is `when` `id: login_username` with
  `do` `optional tap id:r3_arm1_taken_marker`, and whose arm 2 is `when` `id: content` with `do`
  `optional tap id:r3_arm2_taken_marker`. The optional tap is there only so the trace shows which arm ran.

## A — `8413120` discovery in the registry

| # | check | expected | actual | verdict |
|---|---|---|---|---|
| A1 | `list_devices` on a fresh server | both platforms listed | `emulator-5554` (`sdk_gphone64_arm64`, `"osVersion": "13"`, `"state": "booted"`); `D34212DB-2134-43E4-99D8-FA89136C729B` (`iPhone 17`, `26.5`, `booted`); the other simulators `offline`. No `active` key before binding; after the platform tools ran, `"active": true` on exactly those two | PASS |
| A2a | Android `ui_snapshot id:login_screen` + `screenshot` | works as before | 2.6 s, `"identifier": "login_screen"`; screenshot 1.7 s, png | PASS |
| A2b | iOS `ui_snapshot id:login_screen` (`configPath` → copy, WDA) + `screenshot` | works as before | 2.8 s, `"identifier": "login_screen"` (container, WDA ids); screenshot 1.4 s, png | PASS |
| A3 | "booted" / "the default adb device" / "\<udid\>" in tool output | none | across every log of this check, "booted" appears only as `list_devices`' `"state": "booted"` field; "the default adb device" and "\<udid\>" appear nowhere. Every iOS device line names the UDID (e.g. the stderr line `… to true on D34212DB-2134-43E4-99D8-FA89136C729B`) | PASS |

## B — `d165ce4` the three-valued condition on a bare tree

The timings fix what the cold launch looks like here. On Android, `uiautomator` reports a null root to about +3 s. After
that, the decor is bare: `6 nodes (roles: container ×5, other ×1)`, later `11 nodes (roles: container ×8, other ×3)`.
The rendered login screen (147 nodes) was read at **+10.3 s** after launch in the sampling run (`and-probe.log`); reads
at +0.2 s and +7.3 s were bare. That is earlier than the +18.3 s measured on 2026-10-06. On iOS (WDA), the 7-node splash
(`container ×6, image ×1`) is read at about +0.7 s. In the dev build it is followed by a **13-node tree, the splash plus
expo dev-client's `"Downloading 100%…"` text banner**, which is *not* bare (Observations 1). The full login screen
(175 nodes) comes about 1–3 s after launch.

| # | case | platform | expected | actual (duration from launch_app's return) | verdict |
|---|---|---|---|---|---|
| B1a | `wait r3_username_gone` (absence of `login_username`), timeout 8 s, right after a cold launch | Android | not passed on the bare read; times out with the bare note | ERROR 8.8 s: `Timed out after 8000ms waiting for state r3_username_gone` / `  (the last UI tree read was bare, 6 nodes (roles: container ×5, other ×1) of only wrappers and unlabeled decoration, so it could not decide this — the screen had not rendered by the deadline; compare with screenshot, and a longer timeout may be all it needs)`. The snapshot right after holds `login_username` | PASS |
| B1a′ | same with 500 ms (`r3_wait_absent_nosuch_05`, the absence of an id that never exists), twice | iOS | times out on the splash with the bare note | ERROR 0.7 s, both times: `Timed out after 500ms waiting for state r3_nosuch_gone` + the same note with `7 nodes (roles: container ×6, image ×1)` | PASS |
| B1a″ | `wait r3_username_gone`, 4 s | iOS | times out | ERROR 4.6 s: `Timed out after 4000ms waiting for state r3_username_gone`, with no note (the last tree was the rendered login screen) | PASS |
| B1b | `wait r3_username_gone`, 30 s | Android | times out with the plain message once rendered | ERROR 30.7 s: `Timed out after 30000ms waiting for state r3_username_gone` and no bare note. The trace is `✗ wait state:"r3_username_gone": failed — Timed out after 30000ms …` (the message is the same plain one as before the change; there is no "still visible" wording) | PASS |
| B1b | same | iOS | times out | **passed in 1.6 s in 3 of 5 cold launches** (`wait: state r3_username_gone` / `flow …: done`); timed out at 30.9 s and 30.4 s in the other 2. The pass is the dev-client banner tree (Observations 1), not a bare tree | PASS against the rule, a finding against the intent: see Obs. 1 |
| B1c | `wait r3_nosuch_gone` (the absence of an id that never exists), 40 s | Android | passes only once rendered, not at t≈0 | ok **14.0 s**; the snapshot right after shows `login_screen`. The reads at +0.2 s and +7.3 s of the same launch shape were bare (`and-probe`), and the rendered tree was first read at about +10 s. So the pass came at the first rendered read (the poll interval plus a 2–3 s `uiautomator dump`), inside the measured decor-to-render window | PASS |
| B1c | same | iOS | passes once rendered | ok 1.6 s, on the banner tree (Obs. 1); the snapshot right after shows `login_screen` | PASS (see Obs. 1) |
| B2 | `r3_branch` (arm 1 `id: login_username`, arm 2 `id: content`) right after a cold launch | Android | arm 2 is not taken on the decor; arm 1 is taken once rendered | ok 16.2 s: `branch: matched element id:"login_username"` / `optional: skipped id:"r3_arm1_taken_marker" (not present)`. **A decor-matching selector was available**: `ui_snapshot id:content` on the decor returns `"identifier": "content"` (container 1080×2154, from `android:id/content`), so arm 2 was `yes` on every decor read and was held back by arm 1's `unknown` | PASS |
| B2 | same | iOS | arm 1 once rendered | ok 4.5 s: `branch: matched element id:"login_username"`. The WDA splash has no `content` node (its only id is `SplashScreenLogo`), so arm 2 is not a decor match on iOS | PASS (arm-2 half N/A on iOS) |
| B3 | `ensure_state no_prompt` right after a cold launch | Android | `⚠ detect … bare`, then `already active`, and no rung | **at +0 s (run twice): the entry probe read the null root, not the decor**. `⚠ detect: element id:"r3_nosuch_prompt" treated as not detected — last UI tree read failed: device emulator-5554 is still settling: uiautomator has no window to dump yet …`, then `flow r3_harmless: start` / `optional: skipped id:"r3_nosuch_rung_marker" (not present)` / `flow r3_harmless: done` / `⚠ detect: … every UI tree read was bare, the last one 6 nodes …` / `state no_prompt: reached`, in 13.1 s and 14.0 s. This is the documented `unknown`-probe path (every read failed, so the cheap rung runs at once), not the bare path | PASS (unknown path, as designed) |
| B3′ | same, but 4 s and 6 s after launch, so that the entry probe reads the decor | Android | as B3 | ok 8.9 s (+4 s): `⚠ detect: element id:"r3_nosuch_prompt" treated as not detected — every UI tree read was bare, the last one 6 nodes (roles: container ×5, other ×1) of only wrappers and unlabeled decoration` / `state no_prompt: already active`, and no rung. Ok 8.7 s (+6 s): the same with `11 nodes (roles: container ×8, other ×3)`. Launch to verdict is 12.9 s and 14.7 s | PASS |
| B3 | same, at +0 s | iOS | as B3 | ok 2.8 s: `⚠ detect: element id:"r3_nosuch_prompt" treated as not detected — every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) …` / `state no_prompt: already active`, and no rung | PASS |
| B4a | MCP `assert` `{element:{id:r3_nosuch_assert}, absent:true}` with a timeout shorter than the decor | Android, 6000 ms | fails "could not verify … bare" | FAIL result in 8.2 s: `FAIL  element id:"r3_nosuch_assert" is absent — could not verify within 6000ms (the last UI tree read was bare, 6 nodes (roles: container ×5, other ×1) of only wrappers and unlabeled decoration, so it could not decide this — the screen had not rendered by the deadline; compare with screenshot, and a longer timeout may be all it needs)` | PASS |
| B4a | same | iOS, 300 ms | as above | first try passed in 3.8 s (the first WDA read of the server took long enough that the app had drawn). Second try: FAIL in 1.0 s, `could not verify within 300ms (the last UI tree read was bare, 7 nodes (roles: container ×6, image ×1) …)`. At 3000 ms it passed in 1.3 s on the banner tree | PASS |
| B4b | same, 30 s | Android | polls through bare, passes once rendered | `PASS  element id:"r3_nosuch_assert" is absent` in 8.2 s, which is about +10 s after launch: the first rendered read | PASS |
| B4b | same | iOS | as above | PASS in 1.3 s (the banner tree) | PASS (see Obs. 1) |
| B5 | rendered login screen, no cold start: `wait r3_username_gone` 8 s / 4 s | both | immediate verdict, as before | Android ERROR 10.8 s, iOS ERROR 4.3 s: `Timed out after 8000ms` / `Timed out after 4000ms waiting for state r3_username_gone`, no note. These waits run their whole budget because the element really is visible | PASS |
| B5 | rendered: `wait r3_nosuch_gone` | both | at once | ok 3.0 s Android / 1.1 s iOS (one read plus the flow's health line) | PASS |
| B5 | rendered: `r3_branch` | both | arm 1 at once | `branch: matched element id:"login_username"`, 5.2 s / 2.9 s (the 1 s optional marker tap included) | PASS |
| B5 | rendered: `ensure_state no_prompt` | both | `already active` at once, no ⚠ | `state no_prompt: already active`, 3.9 s / 2.4 s, including the settled final screenshot | PASS |
| B5 | rendered: `assert` absent, default timeout | both | at once | `PASS  element id:"r3_nosuch_assert" is absent`, 2.4 s / 1.1 s | PASS |

The leaf rule was cross-checked offline on the captured trees, using `dist/ui-tree/verdict.js` and `bare-tree.js` with
the device viewport:

| tree | `isBareTree` | absent `login_username` | present `login_username` |
|---|---|---|---|
| Android decor, 6 nodes (+0.2 s, +7.3 s) | true | `unknown` | `unknown` |
| Android login, 147 nodes (+10.3 s on) | false | — | `yes` |
| iOS splash, 7 nodes | true | `unknown` | — |
| iOS splash + `Downloading 100%…`, 13 nodes | **false** | **`yes`** | — |

## Observations

1. **On the iOS dev build, an absent condition can still pass before the login screen exists. The cause is the
   expo dev-client's "Downloading 100%…" banner, not a bare tree.** About 0.9–1.1 s after a cold launch, WDA reads 13
   nodes: the 7-node splash plus a 402×93 container holding one `text` node, `label: "Downloading 100%…"`. By
   `bare-tree.ts`'s rule, any non-structural role is content, so the tree is rendered and the absence of
   `login_username` is `yes`. That is how B1b (iOS) passed in 1.6 s in 3 of 5 runs, and why B1c, B3 and B4b on iOS
   settled in 1.3–2.8 s instead of after the login screen drew. The code follows its spec here. ARCHITECTURE.md lists
   "a small labelled overlay during load reads as content" as the *safe* direction of the heuristic's error. That was
   true when `bare` only guarded misses. Since `d165ce4`, an overlay that reads as content turns an absence into `yes`,
   which is the unsafe direction for `absent:`. The impact is limited to development: the banner is shown only by a
   debug/dev-client build loading its bundle from Metro, and a release build shows only the splash. An absent detect
   (`no_prompt`) could still read "already active" on it right after a debug cold launch. Reproduction: start Metro, then
   `xcrun simctl terminate <udid> sk.finportal.myport`, `launch_app ios`, then `run_flow r3_wait_absent_login_30`
   (`configPath` → `r3-averi.yaml`). It passes in about 1.6 s on most runs; `ui_snapshot` at the same moment shows the
   13-node tree (`ios-probe2.log`, L1–L4 snap1/snap2). I rate this not a defect of the commit: it is the
   heuristic's documented miss, newly consequential. It is worth a line in ARCHITECTURE.md's "accepted costs", or a
   known-banner exception in `bare-tree.ts`. Android's dev build shows no such view: decor only, then the login screen.
2. **Android `ensure_state` at +0 s takes the `unknown` path, not the bare path.** Right after `launch_app` returns,
   `uiautomator` still reports `null root node`. The single-read entry probe therefore *failed*, and the cheap rung ran
   at once, by design ("an `unknown` probe — every read failed — still runs a cheap rung at once"). The ⚠ / already-active
   path the brief expects needs the entry read to land on the decor; from +4 s it did (B3′). With a harmless rung, the
   end state is the same either way (`state no_prompt: reached` after a final wait that polled through the bare decor).
   With a real cheap rung, such as a dismiss tap, the rung would run on an unrendered app in the first ~3 s after launch.
   That is pre-existing behaviour for a probe that cannot read the tree, and phase 1 leaves it unchanged.
3. **On a rendered non-app screen, the rule behaves as specified.** With Metro down, the red box is a rendered tree of
   33 nodes (`text ×16 …`). On it, every absence passed at once (B1a, B1b and B1c in 2.7–3.2 s), the absent assert
   passed, and `r3_branch` took **arm 2** (`branch: matched element id:"content"`), because arm 1 was a real `no`.
   This is correct three-valued behaviour; a bare-tree guard cannot be expected to catch an error screen.
4. A flow's `wait:` has no `absent` key. The brief's `wait: { element: …, absent: true }` is refused by the schema
   (`flows.<f>.steps.0.wait: Unrecognized key(s) in object: 'absent'`), so absences are waited on through a state, as
   the commit message phrases it ("a `wait:` on a state detected by it"). A timed-out wait on a rendered tree says
   `Timed out after Nms waiting for state <s>` and has no "still visible" wording. That message is the same as before
   the change.
5. The first Android `launch_app` of the session, made while `r3-averi.yaml` was still schema-invalid, was correctly
   refused before launching. The `ui_snapshot` that followed read an unrelated `com.android.camera2` "Remember photo
   locations?" dialog left beneath the app; nothing was tapped there.

## Not provoked / not verified

- **The Android bare note on a `wait` that outlives the decor.** On a cold launch, the decor always ended inside a 30 s
  wait, so B1b's note-free timeout reflects a rendered last read. The bare note on Android was provoked with shorter
  timeouts (B1a 8 s, B4a 6 s).
- **A `branch` that times out with arm 2 held by an `unknown` arm 1 on the decor.** This would need the decor to outlast
  the branch's wait budget. That did not happen here: the decor lasted about 10 s and the budget was not reached. B2
  shows arm 2 being held and arm 1 then winning.
- **The never-wipes-blind refusal and N × ensureTimeoutMs for multi-rung ladders.** Not exercised: the rules forbid
  destructive rungs, and finportal has no multi-rung cheap ladder.
- **A "still visible" message.** No such wording exists; see Obs. 4.
- The four later commits on the branch (`1d67ced`, `7ce3ff1`, `3e248fe`, `c809293`) were in the build but not under test.

Logs and screenshots are in the session scratchpad `device-round3-p1/`: `a.log`, `b-android-redbox.log`,
`warm.log`, `b-android.log`, `b3-android.log`, `b-ios.log`, `ios-probe.log`, `ios-probe2.log`, `ios-extra.log`,
`ios-confirm.log`, `and-probe.log`, the `tree-*.json` / `and-snap*.json` captures, and `out-*/`.
