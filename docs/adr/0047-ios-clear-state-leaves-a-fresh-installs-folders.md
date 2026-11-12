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
  (`CONTAINER_METADATA`). It belongs to the container, not to the app. An entry gone between the listing and its
  removal is no failure (`force`): the system may write beside the wipe (SplashBoard, cfprefsd).
- Then `FRESH_CONTAINER_DIRS` are made again, empty: Documents, Library/Caches, Library/Preferences, SystemData and
  tmp. Library is made with them.
- `IosAdapter.clearAppData` keeps the terminate and the container lookup. Before deleting anything it requires the
  path to be one app data container of this simulator (`isAppDataContainer`):
  `…/<udid>/data/Containers/Data/Application/<GUID>`, the UDID matched without case and literally, no dot segment.
  Any other path is refused with the old error, `Unexpected app container path: …`, and nothing is deleted. Before,
  only a leading `/` was checked. It then calls `resetDataContainer` for the files.

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
- **Residual: NSUserDefaults may survive a wipe.** Removing Library/Preferences/<bundle>.plist does not clear
  cfprefsd's in-memory cache on the simulator, so the app's next launch can still read its old defaults. This gap is
  older than this change: the old wipe removed the same file. A possible later step is `simctl spawn <udid> defaults
  delete <bundle>` before the wipe; it is not added here.
- **Residual: the layout is from documentation, not a device.** FRESH_CONTAINER_DIRS and CONTAINER_METADATA come from
  Apple's sandbox documentation and the known simulator container. The next probe run or Gate C should list a fresh
  install's data container next to a wiped one and compare them. Any difference changes FRESH_CONTAINER_DIRS.
- The lab app now also creates Documents/ before writing (fixtures/apps/ios/AveriLab/Lab.swift), so it works after an
  older averi's `clearState` too.

**Tests.** tests/adapters/ios-data-container.test.ts: Documents/x is emptied and Documents/ stays. Every write goes, at
any depth and in every folder, including app-made top-level folders and stray files, and the fresh layout is left. The
metadata plist is kept untouched, while another dotfile goes. A file named `Library` is replaced by the folder. An
empty container gets the layout. An entry listed but gone before its removal is no failure. `isAppDataContainer`
accepts this simulator's container (either case, trailing slash) and refuses another simulator's, a bundle container,
the folder above, a deeper folder, dot segments, a relative path and a UDID read as a pattern.
tests/adapters/ios.test.ts: the clearState launch expects the fresh layout with Documents/ empty, and a container path
outside the simulator's app data containers is refused, with nothing deleted and no launch. Hand mutants, each killed:
no recreate; the metadata removed; nothing removed; Library/Caches left out of the layout; no `force`; each part of the
path check.

**The probe (A44, part 2; ADR 0046's A44 amendment).** probe-2 also showed that the A41 probe could not tell an
unproven cadence from a measured one. Its cadence child exited 0 with no trials, and the report block said PASS
because no file was missing. That is fixed beside this decision, in scripts/perf and the lab-a41-ios batch, and
recorded in ADR 0046.
