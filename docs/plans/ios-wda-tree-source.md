# iOS tree source: XCTest/WDA fallback for identifiers idb cannot see

Status: **implemented 2026-08-12.** Phases 1–4 done; `verify_both` symmetry on a real RN `id:`-only
flow deferred to the RN project session (MyPort has no `averi.yaml` flows yet); latency measured
(idb describe-all median 167 ms vs WDA /source median 322 ms on the deep screen, first call ~2.9 s)
→ `wda` stays opt-in, no `auto` promotion for now.

## Problem

`idb ui describe-all --json` returns the flattened list of **accessibility elements**. React Native
sets `testID` → `accessibilityIdentifier` on the **host view**; the AX element iOS publishes for
static text (and plain containers) is a child that carries no identifier. So on every RN app:

- `ui_snapshot` reports `identifier: null` for all static `Text`; container `View`s are absent
  entirely; only interactive elements (Pressable, TextInput) carry ids.
- Measured scale (RN 0.86 / Expo SDK 57, iPhone 17 sim): idb returned **6 elements** for a screen
  where Maestro's XCTest tree has hundreds.
- `verify_both` silently loses symmetry: Android resolves every `testID` as `resource-id`, iOS
  degrades to locale-fragile `text:` selectors for anything non-interactive.

Control experiments that bound the problem:

1. Native SwiftUI static `Text` + `.accessibilityIdentifier` **does** surface through idb (swiftc
   probe, same simulator, same pipeline) — SwiftUI puts the id on the AX element itself. Not an
   iOS/idb limit in general.
2. Maestro 2.8.0 (XCTest driver) on the exact screen idb sees 6 elements: **all** `testID`s present,
   including static text and the plain container. The id lives on the host view.

This is the case ARCHITECTURE.md §3 pre-planned ("**WebDriverAgent** fallback for cases where idb's
AX output is insufficient") and §10 lists as the idb-risk mitigation ("adapter abstraction keeps WDA
as swap-in").

## Phase 0 — kill-switch experiments (EXECUTED 2026-08-12)

- **`idb ui describe-all --json --nested` on the exact RN repro screen** (MyPort placeholder,
  iPhone 17 / iOS 26.5, idb with `--nested` support): output is the same AX-element set merely
  tree-shaped — 6 nodes, `AXUniqueId: null` on every one, `placeholder_status` absent, ~2.3 KB in
  both forms. **Option eliminated; measured, not assumed.**
- **Local tooling survey**: no Appium install present; Maestro's `~/.maestro/deps/simulator-server`
  (their private prebuilt XCTest runner) works on this machine — evidence the XCTest approach is
  viable here, but it is an undocumented internal binary, not a dependency to consume.

## Decisions (defaults — revisit only with data)

1. **WDA distribution**: npm devDependency `appium-webdriveragent` (ships the WDA Xcode project;
   no Appium server involved). Pin the version. Rejected: vendoring WDA source (maintenance debt),
   Maestro's simulator-server (private/undocumented), writing our own XCTest runner (WDA *is* that
   runner, maintained).
2. **Lifecycle**: build once per Xcode version (`xcodebuild build-for-testing`, cached in
   DerivedData), start per session with `xcodebuild test-without-building` against the target UDID,
   readiness = `GET /status`, port = per-UDID (8100 + offset) so parallel simulators don't collide.
   Lazy start on the first `uiTree()` that needs it; teardown with the server process.
3. **Integration policy**: config-driven, safe default — `app.ios.treeSource: idb (default) | wda`
   in averi.yaml. Native projects (skeleton) see zero change; RN projects opt in with one line.
   `auto` promotion is a later decision, taken only after the Phase 4 latency measurement.
4. **Scope**: only the *tree read* moves to WDA. Taps, typing, install/launch stay on idb/simctl
   (WDA input would drag in session management). Compatible by construction: WDA frames are in
   points, the same units idb rects use, so `tapElement` coordinates keep working.

## Phase 1 — `WdaServer` (new `src/adapters/wda.ts`)

- `class WdaServer { constructor(udid, port, exec); ensureRunning(); source(): Promise<unknown>; stop() }`
- xcodebuild via the existing `exec.ts`; reuse the `DEVELOPER_DIR` detection currently private to
  `IosAdapter.detectEnv()` — factor it out rather than duplicating.
- `GET /source?format=json` → nested `{ type: XCUIElementType*, identifier, label, value, frame,
  children }` (sessionless endpoint — no WebDriver session needed).
- Failure surface: a build/start failure must name the xcodebuild log path and the one-time cost
  ("first WDA build per Xcode version takes minutes") — never a bare timeout.

## Phase 2 — parser + normalization (`parseWdaSource`)

- Map `XCUIElementType*` → the normalized role vocabulary (mirror of `ROLE_MAP`: Button→button,
  StaticText→text, TextField/SecureTextField→textfield, Cell/Other-with-children→container, …).
- Keep host-view nodes: that is the whole point — the RN host view appears as an `Other` node WITH
  the identifier; normalize it to `container` rather than dropping it.
- Re-implement the `error`-attribute pairing (validation text under a same-identifier field) on the
  nested tree — the current logic in `ios.ts` exploits idb's flat sibling order and will not
  transplant as-is.
- Fixtures first: capture real `/source` dumps of (a) the RN repro screen, (b) a skeleton native
  screen, into `tests/fixtures/`; parser unit tests run against those, in the style of the existing
  `parseIdbDescribeAll` tests.

## Phase 3 — `IosAdapter` wiring

- `uiTree()` dispatches on the configured source; everything above the adapter is untouched.
- Plumbing the config to the adapter is the one genuinely open design point: the registry
  constructs adapters config-agnostically today. Recommendation: `registry.get(platform, opts?)`
  where tool handlers that already loaded averi.yaml pass `{ treeSource }`, cache keyed by
  `(platform, deviceId, treeSource)`. Avoid a mutable setter — two concurrent tool calls with
  different configs must not race.
- `select_device` interplay: `WdaServer` is keyed by UDID; a rebind starts a new server and stops
  the orphan.

## Phase 4 — verification, measurement, docs

- Acceptance (unchanged):
  - RN repro screen: `ui_snapshot(ios)` resolves `id:` on static text AND the plain container.
  - Native suite: skeleton `averi.yaml` states pass on-device with `treeSource: idb` (default,
    regression guard) and with `wda` (parity check).
  - `verify_both` symmetric for an RN `id:`-only flow.
- Measure `/source` vs `describe-all` latency on a deep screen (transactions list) → decides
  whether `auto` (WDA-first on iOS) is worth proposing.
- Docs: README known-gap box → resolved note; SKILL rule updated; ARCHITECTURE §3 marks the
  fallback as implemented.

## Risks

- **First WDA build per Xcode version: minutes** (then cached). Must be loud and explained, or it
  reads as a hang.
- **WDA↔Xcode coupling**: appium-webdriveragent tracks new Xcode releases quickly, but a fresh
  Xcode may need a version bump — pin and document the pairing.
- **`/source` latency on deep trees** is the known WDA weakness — hence measure before any
  WDA-by-default talk.
- **CI/headless**: `xcodebuild test-without-building` on simulators works headless; simulator-only
  scope (averi's stated boundary) keeps signing out of the picture.

## Effort

Phases 1–2 ≈ one day (server + parser with fixtures), phase 3 ≈ half a day (wiring + registry
design), phase 4 ≈ half a day on-device. **~2 focused days**, independently landable per phase.
