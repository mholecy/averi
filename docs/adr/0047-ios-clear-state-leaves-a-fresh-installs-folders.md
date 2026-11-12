# 47. iOS `clearState` leaves a fresh install's folders

Status: accepted 2026-11-12 (backlog row A44, docs/plans/2026-10-30-performance-backlog.md). Golden unchanged: no
recording launches with `clearState`. Reply words unchanged.

No earlier ADR covers `clearState`. Its contract is ARCHITECTURE.md §6's `launch_app` row: wipe first, count the wipe.
This ADR records how iOS wipes.

## Context

- simctl has no `pm clear`. `IosAdapter.clearAppData` terminates the app, asks `simctl get_app_container <udid>
  <bundle> data` for the data container, and wiped it in place by removing every top-level entry. That removed
  Documents/, Library/, SystemData/ and tmp/ themselves, and the container manager's metadata plist with them.
- A fresh install's data container is not empty. Apple's sandbox layout (File System Programming Guide) names
  Documents/, Library/ (with Library/Caches/ and Library/Preferences/) and tmp/. A simulator's data container also
  holds SystemData/ and `.com.apple.mobile_container_manager.metadata.plist`, the container manager's own record of the
  container. The layout here is taken from those sources. This change did not re-check it on a device (no device use
  in the implementation); the owner's next probe run launches with `clearState` and would show a difference.
- An app that writes into Documents/ without creating it then fails. The lab app writes `Documents/lab-state.json` with
  `try? data.write(…, .atomic)`, so it failed silently. In the owner's A41 probe-2 (2026-11-12, on 6f80d529), the
  `auto-tap` child's foreground leg launched the lab app with `clearState`. The `cadence` child ran after it. Its lab
  launches waited for a state file that never came, and all 60 trials timed out: "did not report ready".
- Android needs no change. `pm clear` removes the package's data. On Android, `Context.getFilesDir()` and its siblings
  create their folder on first use, so an app does not expect them to exist already.

## Decision

**`clearState` on iOS removes everything the app wrote and leaves the container as a fresh install has it:
`adapters/ios-data-container.ts#resetDataContainer`.**

- Every top-level entry of the data container goes, recursively, except the container manager's metadata plist
  (`CONTAINER_METADATA`). It belongs to the container, not to the app.
- Then `FRESH_CONTAINER_DIRS` are made again, empty: Documents, Library/Caches, Library/Preferences, SystemData and
  tmp. Library is made with them.
- `IosAdapter.clearAppData` keeps the terminate, the container lookup and the absolute-path check. It calls
  `resetDataContainer` for the files.

**Why remove and recreate, not empty each top-level folder.** Emptying Library/ would also remove Library/Caches/ and
Library/Preferences/, which a fresh install has. An app-made folder at the top level would have to be special-cased.
One rule does both: remove everything the app could have written, then make the fresh layout. The result does not
depend on what the app did to the container.

## Consequences

- An app that writes into Documents/, Library/Caches/ or tmp/ without creating the folder works after `clearState`, as
  it does after a fresh install.
- The metadata plist survives a wipe. The old code removed it, and launches still worked (probe-2: foreground ok 5/5,
  one of them `clearState`). Keeping it is closer to a fresh install, and nothing is known to depend on its absence.
- A folder the system adds on the first launch (for example Library/SplashBoard/) is removed, like anything else the
  app's runs left. The system makes it again when it needs it.
- The lab app now also creates Documents/ before writing (fixtures/apps/ios/AveriLab/Lab.swift), so it works after an
  older averi's `clearState` too.

**Tests.** tests/adapters/ios-data-container.test.ts: Documents/x is emptied and Documents/ stays. Every write goes, at
any depth and in every folder, including app-made top-level folders and stray files, and the fresh layout is left. The
metadata plist is kept untouched, while another dotfile goes. A file named `Library` is replaced by the folder. An
empty container gets the layout. tests/adapters/ios.test.ts's clearState launch now expects the fresh layout with
Documents/ empty. Hand mutants, each killed: no recreate; the metadata removed; nothing removed; Library/Caches left out
of the layout.

**The probe (A44, part 2; ADR 0046's A44 amendment).** probe-2 also showed that the A41 probe could not tell an
unproven cadence from a measured one. Its cadence child exited 0 with no trials, and the report block said PASS
because no file was missing. That is fixed beside this decision, in scripts/perf and the lab-a41-ios batch, and
recorded in ADR 0046.
