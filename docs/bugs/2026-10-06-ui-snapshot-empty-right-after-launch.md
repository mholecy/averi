# BUG: `ui_snapshot` right after `launch_app` returns `[]` — indistinguishable from "no such element"

> **Status (2026-10-08):** fixed on main in `1ebd539` (2026-10-06) — `ui_snapshot` says why beside the `[]` (the bare-tree ⚠); for idb an empty tree is `IdbEmptyTreeError` since `1e0501d`, and since `b546c98` (2026-10-08) `ui_snapshot`'s settle read re-reads it once after `IDB_EMPTY_RETRY_MS` (1 s) before failing.

**Measured 2026-10-05/06** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS default idb tree source),
iPhone 17 simulator iOS 26.5, app `com.finshape.dbosbanking`. Filed from the SWIFT / SEPA journey-developer runs
(`debug-ai-logger/2026-10-05-1304-swift-payment/`, `debug-ai-logger/2026-10-06-1009-sepa-payment/`).

## Observed (measured, UTC timestamps from the session transcript)

The pattern every time was `install_app` → `launch_app` → `ui_snapshot { filter }` to classify the login screen (PIN =
device registered, Welcome = not — the project's registration guard).

| launch_app returned | ui_snapshot (started → returned) | filter | result | what was on screen |
|---|---|---|---|---|
| 2026-10-06 05:45:41 | 05:45:43 → 05:45:45 | `role:button` | `[]` | PIN login: 10 digit buttons, "Forgot PIN?", "Password login" (simctl screenshot seconds later) |
| 2026-10-06 05:45:41 | 05:45:39 → 05:45:42 (issued in parallel with launch) | `label~"PIN\|Welcome\|Log in"` | `[]` | same PIN screen |
| 2026-10-06 06:28:03 | 06:28:01 → 06:28:03 (parallel) | `label~"Forgot PIN\|Welcome"` | `[]` | PIN screen (simctl screenshot after `sleep 3`) |
| 2026-10-05 21:21:02 | 21:21:04 → 21:21:06 | `label~"(Enter your PIN\|REGISTER\|Welcome)"` | `[]` | PIN screen |
| 2026-10-06 11:53:37 | 11:53:35 → 11:53:40 (parallel) | `label~"Forgot PIN"` | `[{role: button, label: "Forgot PIN?"}]` | PIN screen |

The first row is the clean case: the snapshot started 2 s AFTER `launch_app` returned, with no other call in flight,
and a filter that the very same screen satisfies (11:53:40 shows `Forgot PIN?` as `role: button`). It still came back
empty. Rows 2, 3 and 5 were issued in parallel with `launch_app` by the caller, so they only show that the outcome is
timing-dependent (sometimes `[]`, sometimes the element), not a clean ordering.

In every empty case a plain `xcrun simctl io booted screenshot` a few seconds later showed the PIN screen.

## Why it matters

- A filtered `ui_snapshot` that returns `[]` means two different things: "the screen has no such element", or "the
  tree was not there yet / app not in the foreground". The response does not say which.
- On this project the question being asked is "is the device registered?" (PIN vs Welcome). An empty answer to
  "is Welcome on screen?" reads as "not Welcome → registered". That is the wrong way to fail for a guard whose purpose
  is to avoid burning a device registration.
- `screenshot` already waits for two identical consecutive captures ("Waits for the screen to be stable"); `ui_snapshot`
  is the cheaper call the tool description steers agents toward, and it has no such wait.

## Possible fix directions (owner's choice)

- Give `ui_snapshot` the same settle policy as `screenshot` (two identical consecutive trees, bounded), at least when
  called within N seconds of `launch_app`.
- Or, with a filter, return a small envelope next to the matches: total node count of the unfiltered tree, the
  foreground bundle id / package, and `settled: true|false`. `[]` with `nodes: 0` or `foreground: SpringBoard` is then
  self-evidently "not ready", never "absent".
- Or let `launch_app` optionally wait for the app's first non-empty tree before returning.

## Repro

`install_app ios` → `launch_app ios <bundle>` → immediately `ui_snapshot { platform: ios, filter: "role:button" }` on an
app whose first screen has buttons. Repeat a few times; some runs return `[]`.
