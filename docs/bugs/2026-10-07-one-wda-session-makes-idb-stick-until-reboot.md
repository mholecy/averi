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
    next reader may be another project's averi on idb, or idb by hand. The write is idempotent and expected to be
    sub-second (not yet timed; the device check should time it).
  - **On by default, logged, not restored.** The suggestion above asked for the write to be opt-in "or at least
    logged". It is logged: the first successful write per adapter prints one stderr line saying the two keys were set
    to true on that simulator, that the change is simulator-wide and not restored. It is not opt-in, and there is no
    config switch, because the write was measured to cure (15/15) and nothing was measured to mind it; a switch is
    cheap to add once an app is found that does. averi does not restore the keys afterwards: restoring `0` is exactly
    the state that sticks.
  - Before every launch, not once per simulator: a WDA attach cured only until the next launch (I2), so each later
    teardown presumably writes `0` again. Measured per launch, inferred per teardown.
  - A failed write never fails the launch. It is one `averi: could not set com.apple.Accessibility <key> …` line on
    stderr that names the way out (a simulator reboot) (the channel `wda.ts` already uses for a non-fatal note; no adapter-level note channel exists and none
    was added), and the second key is not attempted after the first fails.
  - Pinned in `tests/adapters/ios.test.ts`: the two writes precede the launch in order on both paths, on a WDA-source
    adapter and before a deep link, with the adapter's udid; the announcement is printed once per adapter; a rejected
    write is tried once, leaves the launch running and prints one stderr line and no announcement.
- **The error's advice.** `IdbEmptyTreeError` (`src/adapters/ios-tree-source.ts`) keeps its first line (what a trace
  quotes) and now names, after it, the measured trigger (an earlier WebDriverAgent session on this simulator, e.g.
  `treeSource: wda`; "likely any XCTest-based driver" is stated as unmeasured) and three ways out in order of cost: a
  relaunch through averi (`launch_app`, or a flow's launch — the write above runs; "should clear it" until the device
  check), a simulator reboot (`xcrun simctl shutdown <udid> && xcrun simctl boot
  <udid>`), and `app.ios.treeSource: wda`.
- ARCHITECTURE.md's iOS launch line and idb bullet say the same.

**Deferred.**
- The device check: the write cured 15 of 15 launches when made by hand; it has not yet been measured through
  averi's own `launch_app`, nor through a `clearState` launch, nor with the `treeSource: wda` teardown and a later
  idb launch in one averi session.
- Not measured on mp-native, nor on any VoiceOver-sensitive app. The keys are simulator-wide; an app that changes
  behaviour under accessibility automation would see it on every averi launch.
- An app process that is ALREADY running stuck when averi first reads it. The write was only measured before a
  launch; it is assumed not to wake a running process (the WDA attach does, until the next launch), so the error's
  advice says to relaunch. A cure for the running process (a bare WDA attach, 1.9–2.2 s warm) stays an open option.
- Whether every WDA teardown really rewrites `0` (inferred from I2, not read back per teardown).
