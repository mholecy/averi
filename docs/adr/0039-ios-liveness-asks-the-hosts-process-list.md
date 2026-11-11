# 39. iOS liveness asks the host's process list; a no is launchctl's

Status: accepted 2026-11-02 (backlog row D33, docs/plans/2026-10-30-performance-backlog.md). The `DeviceAdapter`
contract, `appHealth` (in `run/verify.ts` then, `run/app-health.ts#appHealth` since A29) and every reply line are
unchanged. One verdict changes on purpose: launchctl's match is now exact (below). Amended 2026-11-02 (batch-4's device
check: the A/B shown, the agreement before a reinstall — the batch-4 amendment). Amended 2026-11-02 (batch-5: the
agreement after a reinstall measured, PASS — the batch-5 amendment). Amended 2026-11-11 (A29: app health in one module,
one failure policy — the last section).

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
  containers. The comparison ignores case, as APFS does, so a UDID in either case works. A system app's Path is in the runtime root, the same on every simulator of that runtime, so the host
  cannot tell which simulator runs it. Those go to launchctl. averi health-checks only `app.ios.bundleId`, a user app.
- One `simctl appinfo` per bundle per adapter serves both the launch's foreground wait (its names) and this check (its
  path), cached in `IosAdapter`. An answer is cached when it carries a name or a Path. A failed call, or an answer
  with neither (a format drift, or maybe a bundle that is not installed), is asked again. A name-less answer with a
  Path is cached, so the launch's foreground note says "listed neither name" from the cache. `install()` clears the
  cache, the disagreement counts and the bundles given over to launchctl (next bullet): a reinstall can move the
  container. If pgrep says no and
  launchctl says yes, that bundle's entry is dropped.
- If that disagreement happens twice (`DISAGREEMENTS_TO_GIVE_UP`) in a row for one bundle, the second time after a fresh appinfo, the pattern
  misses the app's process. That bundle then asks launchctl alone for the rest of the adapter's life, and one stderr
  line says so. Without this, every check would pay appinfo, pgrep and launchctl. An agreeing check resets the count.
- pgrep's outcome (`pgrepVerdict`): exit 0 means running. Exit 1 means launchctl decides. A timeout (5 s) means
  launchctl decides this check only. Exit 2 or 3, a spawn failure or any non-exec error means the host's process list
  is unreadable. Then launchctl decides for the rest of the adapter's life, and one stderr line says so. The line
  gives pgrep's reason (`exit N:` and stderr's last line), not its long command line. Measured
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
- In a sandboxed host, liveness costs what it did before (launchctl), plus one stderr line per adapter. So does a
  bundle whose process the pattern misses, after its first two checks. The reply does
  not say which source answered: the verdict means the same either way.
- Android is untouched (`pidof`).
- `adapters/ios-liveness.ts` joins the mutation run (ADR 0038) with its direct tests.

## Amendment: the device check (2026-11-02, batch-4)

The A/B (`scripts/perf/baseline.ts --scenarios color,ocr,ensure-cold,ensure-warm --repeat 10`, lab simulator, main
7e6d2d47 against 05e21766, the src before this change): the saving is shown on color and ocr under both sources,
about −200 ms against the ≈ 220 estimated above — idb color 803 → 601 ms (−202), ocr 930 → 732 (−198); WDA color
829 → 613 (−217), ocr 980 → 765 (−215). ensure-cold
and ensure-warm moved ≈ 0 (idb +9 / +3, WDA −62 / +2): the check hides beside the frame there, as above. Main ran
launchctl 0 and pgrep 1 a run where the app was alive, before launchctl 1.

The agreement probe (v2, main's own `IosAdapter.isAppRunning` against exact raw launchctl): 56/56 over S1–S5 (in
front, home, terminated, `kill -9`, Contacts in front) and S8-pre, S1 median 20.6 ms; S1 and S2 fell back to launchctl
0 times, S3–S5 once a check, as designed. The launch race (S6, 0/150/400 ms) and a real crash (S7, `kill -ABRT` at
0/300/1000 ms) agreed too, 5/5 each: the crash window of the residual above did not show at those delays. NOT
measured: the agreement after a hand reinstall (S8). The reinstall moved the container (`…/Application/37588271…/` →
`…/B913B894…/`), the case the exact-path pattern is most exposed to, and the probe's next cell open did not report
ready within 10 s, so no check ran after it. Pending (batch-5).

## Amendment: the agreement after a reinstall (2026-11-02, batch-5)

Batch-4's pending S8 (`d33-probe-v3.ts`, lab simulator, main 28c1d37d): main's `IosAdapter.isAppRunning` (f)
agrees 40/40 with exact raw launchctl — S1 5 checks, and 7 reinstall cycles × 5 states, each counted: `simctl install` moved the bundle container every cycle, and the relaunched pid's `ps -o command=` started
with appinfo's new `Path/executable`. One adapter ran the whole probe, so each install left its cached Path stale, and
f's calls (pgrep / launchctl / appinfo) prove the path the decision above describes: not running on the stale path
1/1/0 (pgrep misses, launchctl's no, the cache kept), running on the stale path 1/1/0 (launchctl's yes, the cache
dropped), the next check 1/0/1 (appinfo re-read, the new path matches). f's medians: S1 19.7 ms, before the install
19.3, stale-off 248.3, stale-on 244.9, re-learnt 108, off 241.9 — the stale window costs one launchctl, once per
install, as above.

Batch-4's relaunch miss did not recur: the cell opened after the install was ready at the first attempt 7/7, in about
2.5 s (2.3–2.8), with no settle pause (4 cycles, relaunched about 2 s after the install returned, batch-4's condition)
or a 3 s one (3 cycles). It was a one-off, not a property of the reinstall. D33 / L4 is done.

## Amendment: app health in one module, one failure policy (2026-11-11, A29)

Backlog row A29 (docs/plans/2026-10-30-performance-backlog.md), card 11 of the 2026-11-11 architecture review. This
ADR's liveness answer is read by one function, `appHealth`, and the review found the health line spread over three
modules with three failure policies.

**Context.** The crash signatures and their scan (`CRASH_PATTERNS`, `scanForCrashes`) sat in `verify/assert.ts`, which
never read them. The line (`appHealth`) and `get_logs`' excerpt (`formatLogExcerpt`, `LOG_GREP_FLAGS`,
`LOG_MAX_LINES`) sat in `run/verify.ts`, the `verify` tool's orchestration, beside the reply pieces the single-platform
tools borrowed from it. A health check that threw was handled three ways: `assert` swallowed it and dropped the line
(`run/commands.ts#runAsserts`'s catch), `ensure_state` and `run_flow` rejected, and a `verify` leg became `FAILED:`
and lost its asserts. But `appHealth` already words both device failures itself — a question that cannot be asked
is `appAlive: unknown`, a log read that rejects costs the excerpt — so the only throws left are an adapter breaking
its contract: a `platform` that throws on read, or `logs` resolving to no array. Neither real adapter can: `platform`
is a readonly field on `AndroidAdapter` and `IosAdapter`, and both `logs` return a `split`. The catch in `runAsserts`
was dead for every real adapter, and the three policies differed only for a fake.

**Decision.** One module, `src/run/app-health.ts`: the crash signatures and their scan (now private: the line is
their one reader), `appHealth`, and the log excerpt with its flags and budget. One policy, stated in its header:
**`appHealth` words every device failure into the line, and catches nothing else.** Its four callers await it bare.
A broken adapter's throw is a bug and fails each call as any other throw in it does: `ensure_state`, `run_flow` and
`assert` reject, and a `verify` leg is its `FAILED:` section (the leg's containment of any throw, not a health
policy). `runAsserts`' catch is deleted. That is the one change of behaviour, and it is reachable only by a fake
(`tests/run/commands.test.ts` pins it with a `logs` that resolves to `null`, as the ensure_state and verify-leg tests
already did). No reply a real adapter can produce changed: the truth corpus' golden shows Changed 0.

The place is run/, by A24's order (`mcp → run → flow → interact → verify → ui-tree → adapters`,
`tests/architecture/layering.test.ts`). The line asks about averi.yaml's app (`app.<platform>`, `flow/config.ts`), so
verify/ would import flow/ upward. It is not a device command, so not adapters/. Its readers are run/'s compositions
and mcp/'s `get_logs`, both at or above run/. The reply pieces the legs and the single-platform tools share
(`finalFrame`, `screenshotFailedLine`, `formatAsserts`, `assertSummary`) moved to `src/run/leg-reply.ts` beside it,
and the `formatTrace` re-export is gone: `run/commands.ts` imports it from `flow/engine.ts`, its owner.

**Rejected.** Making `appHealth` total, with a catch-all that turns any throw into a line. A contract breach would
then read as a health verdict (which one: `unknown` would send the caller to `adb devices` for a bug in averi), and
the four callers would still agree only by convention. Keeping `assert`'s catch as the "verdict stands" policy for
all four: a `verify` leg cannot keep its asserts without a per-leg catch of its own, and it would hide the same bug.

