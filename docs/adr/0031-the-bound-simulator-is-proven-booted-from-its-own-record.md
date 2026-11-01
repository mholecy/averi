# 31. The bound simulator is proven booted from its own record

Status: accepted 2026-10-31 (performance backlog row D22, docs/plans/2026-10-30-performance-backlog.md, section "iOS
per-call costs"; the orchestrator's decision from the D0 iOS windows). Implemented on `perf/d22-ios-probe-plist` (51bf3d9b, 85f7de99, 70d3b61c), merged 3574d5b2.
Status: amended 2026-11-01 (A3) — where the proof sits only (the bullet on its seam, and two consequences); what is
proof, and why it is safe enough, are unchanged.

## Context

- `mcp/registry.ts#get` runs on every tool call, and on a bound platform it first proves the bound device is still
  booted. That proof was a full listing — on iOS `xcrun simctl list devices --json`
  (`adapters/discovery.ts#listIosDevices`): ~110 ms a call in the D0 windows on the lab iPhone 17 (iOS 27.0), 80 ms
  timed alone on an idle host (5 runs, 2026-10-31). The registry deliberately caches nothing here: a stale "still
  booted" would hand out an adapter for a device that is gone.
- Of the listing, the bound path reads two facts: that the bound id is listed at all — `listIosDevices` drops a
  simulator whose runtime is unavailable (`isAvailable: false`) — and that its entry says `booted`. The name, the OS
  version and the other devices are read only when that is false (to word the refusal) — and by `select()` and
  `listAll()`, which are not per-call. The file proves only the second fact (see the residuals).
- CoreSimulator keeps each simulator's record in the default device set at
  `~/Library/Developer/CoreSimulator/Devices/<udid>/device.plist`. On this machine (CoreSimulator-1174.9.2, Xcode 27)
  it is a 701-byte XML plist, one flat `<dict>`: `UDID`, `name`, `runtime`, `deviceType`, `isDeleted`, … and `state`,
  an integer — 3 while simctl lists the device `Booted`, 1 while it lists it `Shutdown`. Reading and parsing it costs
  0.045 ms median, 0.09 ms p95, ~0.4 ms cold (3 × 200 reads, Node 22, 2026-10-31).

## Decision

**On get()'s bound iOS path, the simulator's own `device.plist` is read first; when it proves the device booted, the
registry hands out the adapter without a listing. Anything short of proof lists through simctl exactly as before.**
- Proof is all of: the file reads; it is XML with exactly one `<dict>`; `UDID` and `state` each appear exactly once; the UDID is the bound one;
  the state is exactly `3`; `isDeleted` is not true, `<true/>` or `<true />` (`adapters/discovery.ts#iosBootedFromDevicePlist`).
- Not proof — and so the listing, with every refusal's wording as before: any other state (Booting, Shutting Down, 1),
  a missing or unreadable file, a binary plist, garbage, another UDID, a reader that throws.
- The unbound path (the auto-pick), `select()` and `listAll()` keep simctl: they need the listing itself. Android is
  untouched.
- The proof is discovery's own first step of the bound device's check, `DeviceDiscovery.check`
  (`adapters/discovery.ts#discoveryOver`; amended 2026-11-01, A3 — until then it was the registry's optional third
  seam, `iosBooted`). The default discovery wires the real reader (`iosBootedFromDevicePlist`,
  `adapters/discovery.ts#defaultDiscoveryDeps`); a discovery built without a proof never proves — its bound iOS checks
  list as before and no host file is read. The registry has two seams, factory and discovery, both or neither without
  exception: a test cannot touch the host by omission.
- The proof is no cache: it is read afresh on every call, as the listing was.

## Why it is safe enough

- The file is CoreSimulator's private, undocumented format. Every way the format could change (a binary plist, a
  renamed key, a second `<dict>`, a new state numbering) lands on "not proof", and the cost is simctl's 110 ms, never a
  wrong answer about a shape the code was not written for — except a format that keeps `state` and reassigns `3`.
- The device set: averi never passes simctl `--set`, and neither simctl nor CoreSimulator reads a device-set override
  from the environment (strings of both, 2026-10-31), so simctl's set is the default one. The path is built on
  `os.homedir()` ($HOME). CoreSimulator's own home can differ (CFFIXED_USER_HOME, or a $HOME that is not the user's);
  then no file, or none for that UDID, is found and simctl decides — harmless, only slower.
- The residuals: the file is the state CoreSimulator last wrote, not a live probe, and it says nothing of the runtime.
  - A CoreSimulatorService that crashed can leave a stale 3 for a device that is not running; simctl, which asks the
    service, would have told the truth.
  - A booted simulator whose runtime became unavailable (the runtime deleted, or an xcode-select / DEVELOPER_DIR
    switch to an Xcode without it) still reads 3, where the listing dropped it and the registry said "no longer
    booted".

  In both, the verb's own simctl or idb call fails with its own error, as when a device dies mid-call today — the
  registry's "no longer booted" wording is not given for it. Accepted: one wording in rare cases for ~110 ms on every
  iOS tool call.

## Consequences

- Every iOS tool call on a bound simulator saves the simctl spawn (~110 ms in D0's windows). Only a device run (D0 on
  iOS) shows the saving in a whole call, and whether a simulator's record ever reads 3 while simctl says otherwise
  outside the two residuals above — not seen, not looked for beyond the lab simulator.
- A shut-down or deleted simulator still gets the listing's wording ("Selected ios device … is no longer booted").
- (A3) The registry's bound path awaits one `check` and makes one select() race check after it, whichever step
  answered; scripts/perf/baseline.ts measures the server's path by building its registry on `defaultDiscovery`, the
  proof included.
