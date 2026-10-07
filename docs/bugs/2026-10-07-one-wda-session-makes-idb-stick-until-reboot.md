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
