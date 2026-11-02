# 39. iOS liveness asks the host's process list; a no is launchctl's

Status: accepted 2026-11-02 (backlog row D33, docs/plans/2026-10-30-performance-backlog.md). The `DeviceAdapter`
contract, `run/verify.ts#appHealth` and every reply line are unchanged. One verdict changes on purpose: launchctl's
match is now exact (below).

## Context

- `IosAdapter.isAppRunning` is the iOS half of the `appAlive:` health line (ARCHITECTURE.md §8). That line ends every
  `assert`, `run_flow`, `ensure_state` and `verify` leg. It asked `xcrun simctl spawn <udid> launchctl list` and looked
  for `UIKitApplication:<bundle>`. That took about 240 ms each time (D33 on the lab simulator: median 240.6 ms, p90 252,
  max 310). It was the largest fixed cost of a colour or OCR `assert`.
- A simulator app is a macOS process on the host. The D33 probe asked `pgrep -f` for the app's executable path. It
  agreed with launchctl 55 times out of 55 over five states (in front, home-backgrounded, terminated, `kill -9`,
  another app in front) and 15 out of 15 in a launch race. Its median was 19 ms.
- The probe's pattern had two gaps. `[^/]+` stood for the bundle container, so any bundle with the same executable
  name matched. Executable names are not unique: every Flutter app's is `Runner`, and an app's flavours share one. The
  pattern also had no end anchor, so `Foo` matched `/Foo.app/FooHelper`.
- launchctl's own test, `includes('UIKitApplication:' + bundle)`, was a prefix match. `com.x.app` read as running
  when only `com.x.app.dev` ran.
- A false "not running" is the costly error. SKILL.md tells the agent that `appAlive: false` is a crash: report it and
  do not retry blindly.

## Decision

**`isAppRunning` asks `/usr/bin/pgrep -f` for the bundle's exact executable path first. A match means running. A no
is never trusted alone: launchctl, now matched exactly, gives the final answer.**

- The pattern (`adapters/ios-liveness.ts#hostProcessPattern`) is the top-level `Path` from `simctl appinfo`, then `/`,
  then `CFBundleExecutable`, then `( |$)`. Path and executable are escaped for POSIX ERE, and only ERE's specials are
  escaped. The Path holds the simulator's UDID and the bundle container's GUID. So the same app on another simulator,
  another bundle with the same executable name, an executable the name prefixes, and an extension or XPC service inside
  the bundle all fail to match. The start is not anchored, so an argv[0] that differs from Path in a prefix still
  matches. The pattern never matches its own text: it holds `\.app` where the path has `.app`. So a concurrent pgrep
  never reads as the app.
- No pattern unless the Path lies under `/<udid>/data/Containers/Bundle/Application/`, the simulator's user-app
  containers. A system app's Path is in the runtime root, the same on every simulator of that runtime, so the host
  cannot tell which simulator runs it. Those go to launchctl. averi health-checks only `app.ios.bundleId`, a user app.
- One `simctl appinfo` per bundle per adapter serves both the launch's foreground wait (its names) and this check (its
  path), cached in `IosAdapter`. Only an answer that listed names is cached, as before, so a failed or name-less answer
  is asked again. `install()` clears the cache: a reinstall can move the container. If pgrep says no and launchctl
  says yes, that bundle's entry is dropped.
- pgrep's outcome (`pgrepVerdict`): exit 0 means running. Exit 1 means launchctl decides. A timeout (5 s) means
  launchctl decides this check only. Exit 2 or 3, a spawn failure or any non-exec error means the host's process list
  is unreadable. Then launchctl decides for the rest of the adapter's life, and one stderr line says so. Measured
  2026-11-02: inside the Claude Code sandbox `pgrep` exits 3 ("sysmond service not found").
- The binary is `/usr/bin/pgrep`, by absolute path. A Homebrew procps `pgrep` earlier on PATH has other exit codes and
  another regex flavour.
- launchctl matches `UIKitApplication:<bundle>[` (labels read `UIKitApplication:<bundle>[0x…][…]`). **This is a
  verdict change:** `com.x.app` no longer reads as running when only `com.x.app.dev` runs. Since every no now comes
  from launchctl, that no has to be exact too.

## Consequences

- When the app is alive, every iOS `assert`, `run_flow` and `verify` leg saves about 220 ms. `ensure_state` saves
  about nothing: its check already hides beside its frame (D13). When the app is not running, a check costs about
  19 ms more, on a path that already pays `log show`. On the WDA source, or for an app launched by hand, the first
  check per bundle pays one `simctl appinfo` (about 80 ms).
- The new path cannot produce a false "not running": every no is launchctl's. If launchctl cannot be asked, the check
  still throws, and the line still reads `appAlive: unknown`.
- Residual false "running": a process other than the app whose argv holds the exact executable path on this
  simulator while the app is dead. Examples are lldb or debugserver on a dead target, or `codesign` or `otool` run on
  the binary. A process being reported as crashed (ReportCrash holds it) may also still match for a short window.
  This is not measured yet. The device check for the next batch adds a real crash (`kill -ABRT`) and a hand
  reinstall.
- In a sandboxed host, liveness costs what it did before (launchctl), plus one stderr line per adapter. The reply does
  not say which source answered: the verdict means the same either way.
- Android is untouched (`pidof`).
- `adapters/ios-liveness.ts` joins the mutation run (ADR 0038) with its direct tests.
