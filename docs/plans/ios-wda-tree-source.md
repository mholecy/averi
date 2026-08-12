# iOS tree source: XCTest/WDA fallback for identifiers idb cannot see

Status: **planned** (finding logged 2026-08-12; not started).

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

Two control experiments bound the problem precisely:

1. Native SwiftUI static `Text` + `.accessibilityIdentifier` **does** surface through idb (swiftc
   probe, same simulator, same pipeline) — SwiftUI puts the id on the AX element itself. Not an
   iOS/idb limit in general.
2. Maestro 2.8.0 (XCTest driver) on the exact screen idb sees 6 elements: **all** `testID`s present,
   including static text and the plain container. The id lives on the host view (Maestro shows the
   host/child pair; only the host carries `resource-id`).

This is the case ARCHITECTURE.md §3 pre-planned ("**WebDriverAgent** fallback for cases where idb's
AX output is insufficient") and §10 lists as the idb-risk mitigation ("adapter abstraction keeps WDA
as swap-in").

## Direction

Give `IosAdapter` an XCTest-backed tree source behind the existing `uiTree()` interface. Keep idb
for input and lifecycle (taps, typing, install/launch) — only the *tree read* changes. Nothing above
the adapter layer changes: `identifier` stops being `null`, `id:` selectors start resolving on RN
static text and containers.

Candidate mechanics, to be evaluated in order:

1. **WebDriverAgent** (`/source?format=json`): full view hierarchy with `identifier` per node.
   Cost: building/hosting WDA on the sim (xcodebuild once, then an HTTP session), a heavyweight
   dependency averi has so far avoided. Appium's prebuilt WDA is the low-friction route.
2. **idb `describe-all --nested`** (if available in the pinned idb version): check whether the
   nested form exposes host views rather than flattened AX elements before reaching for WDA.
3. A tiny XCTest runner of our own is out of scope — WDA *is* that runner, maintained.

Decision points to settle during implementation:

- Fallback policy: WDA-first on iOS, or idb-first with WDA only when a selector misses? (Latencies
  differ; describe-all is ~1s, WDA /source on a deep tree can be slower.)
- Tree merge: WDA nodes carry identifiers but different role vocabulary — normalization table needed
  (mirror of the existing `ROLE_MAP`).
- `error` attribute pairing (validation messages) currently exploits idb's flat sibling order —
  re-verify on the WDA tree.

## Acceptance

- The RN reproduction screen: `ui_snapshot(ios)` resolves `id:` on static text AND containers.
- Native SwiftUI apps: no regression on the existing selector suite (skeleton averi.yaml states).
- `verify_both` symmetric for the RN app's `id:`-only flow.
