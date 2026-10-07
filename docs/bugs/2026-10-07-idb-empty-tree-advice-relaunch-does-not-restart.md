# The empty-idb-tree advice says `launch_app` clears it, but `launch_app` does not restart a running app

*Found 2026-10-07 in the device check of `73eea5f` (see
[2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md](2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md),
"Device check of the fix", I5). finportal, iPhone 17 iOS 26.5 (`D34212DB-…`), `treeSource: idb` scratch config.*

## Claim

`IdbEmptyTreeError` (`src/adapters/ios-tree-source.ts`) tells the reader: "averi re-enables accessibility automation
before each launch_app, so relaunching the app through averi (launch_app, or a flow's launch) should clear it". The
case where this error is raised is an app that is already running with a stuck tree. For that case the advice does
not work: `launch_app` and a flow's plain `launch:` leave the stuck process running.

## Measured

1. Hand WDA on 8199 → `/status` → stop (keys now `0`). Then `simctl terminate` + `simctl launch`, and an idb read at +5 s
   gave `1 STUCK(lone 0x0 Application) launchctl=1`. pid 40003.
2. On the idb config, `ui_snapshot` raised `IdbEmptyTreeError` with the advice above.
3. `launch_app sk.finportal.myport`: `ok in 0.8s`, and both keys read `1` afterwards. `launchctl list` still showed
   **pid 40003**. The idb read at +5 s was **still `STUCK`**.
4. `terminate_app` + `launch_app`: new pid 40356, and the read at +5 s was `14 OK … launchctl=0`.
5. For comparison, writing both keys by hand with no relaunch left the running process stuck at +0, +5, +15 and +45 s.
   A WDA attach (start → `/status` → stop) cured the running process at once (as on 2026-10-06), but it also writes
   the keys back to `0` for the next launch.

## Code says

- `IosAdapter.launch` (`src/adapters/ios.ts`) runs `clearAppData` (which terminates) only when `clearState` is set.
  It then calls `enableAccessibilityAutomation` and `simctl launch`. `simctl launch` on a running app foregrounds it
  and does not start a new process.
- The flow engine's `launch` step (`src/flow/engine.ts`, `adapter.launch(appId, { clearState, … })`) and the MCP
  `launch_app` tool (`src/mcp/tools.ts`) go through the same call. So `open_app`, `login`, and any
  `launch: { clearState: false }` step keep a stuck process. Only `clearState: true` flows (e.g. `fresh_launch`) and
  an explicit `terminate_app` first restart it.

## Suggestion

Pick one:
- **The advice:** say "terminate and relaunch the app through averi (`terminate_app` then `launch_app`, or a flow with
  `launch: { clearState: true }`)". This is a one-line change. The current text names the cure that was measured
  only on a cold start.
- **The behaviour:** have `IosAdapter.launch` terminate first (as `simctl launch --terminate-running-process` does).
  This changes the semantics of the warm `open_app` launch for every iOS project, so it is the owner's call.
- **Optionally:** when `uiTree` meets the stuck shape, cure it in place with a bare WDA attach (1.9–2.2 s warm). That was
  deferred in the fix and stays open; note that it rewrites the keys to `0`, so the next launch's write is what keeps
  later launches healthy.

## Fix (2026-10-07, branch `fix/ios-idb-and-keyboard-2026-10-07`)

The advice, not the behaviour (owner's choice). `IdbEmptyTreeError` now says that only a NEW app process picks up the
pre-launch write, and that the way out is to terminate the app and launch it again through averi (`terminate_app`,
then `launch_app`), because a `launch_app` on the running app keeps the same stuck process; then a reboot, then
`treeSource: wda`. The first line (what a trace quotes) is unchanged. `IosAdapter.launch` still does not terminate a
running app: changing the warm `open_app` launch for every iOS project was not wanted. The in-place cure (a bare WDA
attach) stays deferred. Pinned by the exact-message test in `tests/adapters/ios-tree-source.test.ts`; ARCHITECTURE.md
and the parent note's Fix section say the same.
