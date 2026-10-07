# FINDING (measured): one WebDriverAgent session makes every later launch's idb tree stick, until the simulator reboots

**Measured 2026-10-07 09:33–09:42 CEST**, finportal `sk.finportal.myport` (debug build, Metro up), iOS 26.5, during
the pre-fix measurement for [2026-10-06-wda-read-wakes-stuck-idb-tree.md](2026-10-06-wda-read-wakes-stuck-idb-tree.md)
(its "## Measured 2026-10-07 (pre-fix)", rows I4/I5). Parent:
[2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md](2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md).

## Claim

The stuck-idb notes describe the episode as something the simulator falls into, sometimes rare and sometimes on every
launch. They name "WDA had been used on this simulator just before" as an unverified candidate. The averi side treats
WDA as the cure: a WDA read ends the episode.

## Measured

On a new simulator (`kb-idb-probe`, iPhone 17, iOS 26.5), with the app installed and nothing else done, idb reads
were taken at +1, +5 and +15 s after each launch:

| state of the simulator | launches | stuck reads |
|---|---|---|
| never saw WDA | 10 | 0 / 30 |
| after ONE WDA start → `/status` → stop (no session, no `/source`) | 5 | 15 / 15 |
| same, with `com.apple.Accessibility` `AutomationEnabled` and `ApplicationAccessibilityEnabled` deleted | 3 | 9 / 9 |
| after `simctl shutdown` + `boot` | 3 | 0 / 9 |

On the long-used simulator (`D34212DB-…`):
- writing both keys `-bool true` made 5 of 5 launches healthy (15 of 15 reads);
- restoring them to `0` made it stick again;
- a WDA kept running made 5 of 5 launches healthy.

After the WDA run, both keys read `0` on the probe, the same as on the long-used simulator.

So WDA is both the cause and the cure: it is attached (healthy), its teardown leaves the simulator in a state where every
new app process starts with an empty idb tree, and only another XCTest attach, `AutomationEnabled = 1`, or a reboot
gets out of it. The stuck signature (`launchctl` exit inside `accessibility_info`, 160–205 ms) was identical to
the earlier notes.

## Code says

- finportal sets `treeSource: wda`, so any averi iOS call on that simulator starts WDA. After that session ends,
  every idb reader on the same simulator inherits a stuck tree: averi with `treeSource: idb` in another project, or
  Maestro/idb tooling by hand.
- `IdbEmptyTreeError` (from `1e0501d`) advises `treeSource: wda`, which is right, but it does not say that the
  simulator got this way from an earlier WDA session, or that a reboot or `AutomationEnabled` clears it.

## Suggestion (owner's choice)

- Put the cures in `IdbEmptyTreeError`'s text: "this simulator ran WebDriverAgent earlier; reboot it (`xcrun simctl
  shutdown/boot`), or a WDA read ends it until the next launch".
- Consider writing `AutomationEnabled`/`ApplicationAccessibilityEnabled = true` on an iOS simulator before an idb
  read (`simctl spawn <udid> defaults write com.apple.Accessibility …`). It cured 15 of 15 here, it has no build
  cost, and it is cheaper than a WDA attach. It changes a simulator-wide setting, so it should be opt-in or at least
  logged. It was not measured on mp-native or with VoiceOver-sensitive apps.
- A bare WDA start and stop (1.9–2.2 s warm, no `/source`) also cures, but only until the next launch.

## Fix (2026-10-07, branch `fix/ios-idb-and-keyboard-2026-10-07`)

**Shipped.**
- **Prevention, in the launch.** `IosAdapter.launch` (`src/adapters/ios.ts`, `enableAccessibilityAutomation`) writes
  `com.apple.Accessibility` `AutomationEnabled` and `ApplicationAccessibilityEnabled` to `true` on the target
  simulator (`xcrun simctl spawn <udid> defaults write … -bool true`, one call per key — `defaults write` takes one)
  right before every `simctl launch`, on the plain and the `clearState` path alike, and before every `simctl openurl`
  (`openDeepLink`), since a deep link can cold-start the app.
  - On every tree source, not only `idb`: a `treeSource: wda` project's teardown is what poisons the simulator, and the
    next reader may be another project's averi on idb, or idb by hand. The write is idempotent and costs ≈0.27 s
    per key (device check I6: median 0.273 s, p90 0.282 s; ≈0.55 s per launch).
  - **On by default, logged, not restored.** The suggestion above asked for the write to be opt-in "or at least
    logged". It is logged: the first successful write per adapter prints one stderr line saying the two keys were set
    to true on that simulator, that the change is simulator-wide and not restored. It is not opt-in, and there is no
    config switch, because the write was measured to cure (15/15) and nothing was measured to mind it; a switch is
    cheap to add once an app is found that does. averi does not restore the keys afterwards: restoring `0` is exactly
    the state that sticks.
  - Before every launch, not once per simulator: a WDA attach cured only until the next launch (I2), and every averi WDA
    teardown was read back writing `0` again (device check I4).
  - A failed write never fails the launch. It is one `averi: could not set com.apple.Accessibility <key> …` line on
    stderr that names the way out (a simulator reboot) (the channel `wda.ts` already uses for a non-fatal note; no adapter-level note channel exists and none
    was added), and the second key is not attempted after the first fails.
  - Pinned in `tests/adapters/ios.test.ts`: the two writes precede the launch in order on both paths, on a WDA-source
    adapter and before a deep link, with the adapter's udid; the announcement is printed once per adapter; a rejected
    write is tried once, leaves the launch running and prints one stderr line and no announcement.
- **The error's advice.** `IdbEmptyTreeError` (`src/adapters/ios-tree-source.ts`) keeps its first line (what a trace
  quotes) and now names, after it, the measured trigger (an earlier WebDriverAgent session on this simulator, e.g.
  `treeSource: wda`; "likely any XCTest-based driver" is stated as unmeasured) and three ways out in order of cost:
  terminate the app and launch it again through averi (`terminate_app`, then `launch_app` — corrected after the device
  check below: a `launch_app` on the running stuck app keeps its pid and stays stuck), a simulator reboot (`xcrun simctl shutdown <udid> && xcrun simctl boot
  <udid>`), and `app.ios.treeSource: wda`.
- ARCHITECTURE.md's iOS launch line and idb bullet say the same.

**Deferred.**
- ~~The device check~~ — done: through averi's own `launch_app` (5/5), a `clearState` launch, a deep-link cold start
  and a wda-then-idb session chain (3/3); see "## Device check of the fix" below.
- Not measured on mp-native, nor on any VoiceOver-sensitive app. The keys are simulator-wide; an app that changes
  behaviour under accessibility automation would see it on every averi launch.
- An app process that is ALREADY running stuck when averi first reads it. Measured in the device check (I5): the
  write does NOT wake it, and neither does a `launch_app` on it (same pid); terminate-then-launch does, so the error's
  advice says that (79b458e). A cure for the running process in place (a bare WDA attach, 1.9–2.2 s warm) stays an
  open option.
- ~~Whether every WDA teardown really rewrites `0`~~ — settled: it does (device check I4).

## Device check of the fix (2026-10-07, `6f41787`)

**12:50–12:58 CEST**, branch `fix/ios-idb-and-keyboard-2026-10-07` at `6f41787`, `npm run build`, driver = the handoff's
`run-tools.mts` (plus `sleep`/`sh` pseudo-steps) on this repo's `dist/`. finportal `sk.finportal.myport`, iPhone 17 iOS 26.5
(`D34212DB-…`). idb scenarios ran on a scratch copy of finportal's `averi.yaml` with `app.ios.treeSource: idb` (no
`.env.averi`). "Poison" = hand-started WDA on 8199 → `/status` → stop (port quiet), as in the measurement handoff §1.1. The
stuck signature was the same as before (lone 0×0 `Application`, `launchctl` exit inside `accessibility_info`, 170–200 ms).

- **I0, before:** `AutomationEnabled=0`, `ApplicationAccessibilityEnabled=0`.
- **I1, precondition:** poison → `simctl terminate` + `simctl launch` → idb at +5 s: `1 STUCK(lone 0x0 Application)
  launchctl=1 … 192ms`. Holds.
- **I2, cure through `launch_app` — PASS 5/5.** One server, 5 × (poison → `launch_app` → idb read + `ui_snapshot
  role:button` at +5 s). Every poison read both keys back as `0`, every `launch_app` left them `1`, every read was
  healthy (`14 OK ["MyPort","Slovensky","Česky","English"] launchctl=0 … 70–80ms`, 6 buttons in `ui_snapshot`). The stderr
  announcement came **once per server**:
  `averi: set com.apple.Accessibility AutomationEnabled and ApplicationAccessibilityEnabled to true on D34212DB-… (simulator-wide, not restored; before every launch, so an earlier WebDriverAgent session cannot leave idb reading an empty tree)`.
  `launch_app` took 0.8–0.9 s.
- **I3, `clearState` path — PASS.** Poison → `run_flow fresh_launch`. Afterwards idb read `14 OK`, and `ui_snapshot
  role:button` returned all 6 buttons (`lang_*`, `login_password_toggle`, `login_submit`, `login_forgot`). The flow itself
  failed (`Timed out after 90000ms waiting for element id:"login_screen"`), as expected: idb cannot see an RN container
  `testID`, which is why finportal is on `wda`. This is not a regression.
- **I4, realistic chain — PASS 3/3.** Each cycle was a server on finportal's real config (`wda`) running `launch_app`
  (0.8 s) + `ui_snapshot id:login_submit` (2.7–3.3 s), closed. Then port 8100–8110 was quiet, no runner was left, and
  **`AutomationEnabled` read `0` again** (averi's own WDA teardown rewrites it). A new server on the idb config then ran
  `launch_app` + read at +5 s: `14 OK … launchctl=0`, 6 buttons.
- **I5, an already-running stuck process.** Poison → hand `simctl launch` (stuck at +5 s) → idb-config `ui_snapshot` with
  no launch: `ERROR in 0.4s`, verbatim:
  ```
  idb returned an empty accessibility tree (only a 0×0 Application)
  The app may still be rendered: idb can stay stuck like this for minutes on a rendered screen. Compare with screenshot; if the screen is rendered, the tree source is stuck, not the app. The measured trigger is an earlier WebDriverAgent session on this simulator (e.g. treeSource: wda; likely any XCTest-based driver): every app launched after it starts with an empty idb tree. averi re-enables accessibility automation before each launch_app, so relaunching the app through averi (launch_app, or a flow's launch) should clear it; if it does not, or the stderr said that write failed, reboot the simulator (`xcrun simctl shutdown <udid> && xcrun simctl boot <udid>`); app.ios.treeSource: wda in averi.yaml reads the tree through WebDriverAgent instead
  ```
  - **The deferred question: the keys written by hand to a running stuck process, with no relaunch, do NOT cure it.**
    Reads at +0, +5, +15 and +45 s were all `STUCK … launchctl=1`.
  - **New defect: the advice's "launch_app … should clear it" is false for this case.** On a fresh stuck process
    (pid 40003), `launch_app` wrote the keys (now `1`) but kept **the same pid 40003**, because `simctl launch` only
    foregrounds a running app. The read at +5 s was still `STUCK`. Only `terminate_app` + `launch_app` (new pid 40356)
    gave `14 OK`. A flow's plain `launch: { clearState: false }` is the same call. See
    [2026-10-07-idb-empty-tree-advice-relaunch-does-not-restart.md](2026-10-07-idb-empty-tree-advice-relaunch-does-not-restart.md).
  - In passing: a WDA start → `/status` → stop also cured that running process at once. That is the 2026-10-06
    finding, and it contaminated a first attempt at this step, which was then redone.
- **I6, timing.** 10 × `simctl spawn … defaults write com.apple.Accessibility AutomationEnabled -bool true`, sorted:
  0.265, 0.272 ×4, 0.274, 0.276, 0.278, 0.282, 0.297 s, so **median 0.273 s, p90 0.282 s**. Two writes cost ≈0.55 s per
  launch. A bare `simctl launch` measured 0.233–0.258 s (5×), and `launch_app` now takes 0.8–0.9 s, so the fix
  adds ≈0.55 s per iOS launch. There is no recorded pre-fix `launch_app` figure, so the bare launch is the baseline.
- **I7, deep link — PASS (with a system prompt).** finportal's scheme is `myport` (app.json / Info.plist). Terminate →
  poison (keys `0`, app not running) → `open_deep_link myport://` (0.8 s, keys → `1`). iOS showed the system prompt
  "Open in “MyPort”?" and the app had not started yet. idb read the prompt (`4 OK [" ","Open in “MyPort”?","Cancel","Open"]`).
  `tap text:"Open"` cold-started the app, and the read at +5 s was `14 OK … launchctl=0`. The write lands before the
  prompt, and the keys were still `1` when the app started.
- **After:** the keys read `1` at the end of Part I. At the very end of the run (after the Part K WDA sessions) they read
  `0`, `0` again: every WDA teardown rewrites `0`, which settles the last deferred bullet (read back after the hand WDA
  in all 7 poisons and after averi's own WDA in I4 ×3).

| scenario | result |
|---|---|
| I1 precondition (poison → stuck) | holds |
| I2 poison → `launch_app` ×5 | **PASS** 5/5 healthy; announcement once per server |
| I3 poison → `fresh_launch` (clearState) | **PASS** healthy tree (flow's wait fails by design on idb) |
| I4 wda session → new idb session ×3 | **PASS** 3/3 |
| I5 running stuck process | error text as shipped; hand key write does **not** cure a running process; **`launch_app` does not either (same pid): new defect** |
| I6 write cost | median 0.273 s, p90 0.282 s per key; ≈+0.55 s per launch |
| I7 deep link | **PASS** after the system "Open" prompt |
