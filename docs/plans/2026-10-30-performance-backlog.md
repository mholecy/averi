# Performance backlog (2026-10-30)

From a ten-reviewer performance review of main at `ff6f28a6` (ui-tree ×2, interact scroll, interact tap/fill/keyboard,
verify pixels, verify text/OCR, Android adapter, iOS adapter, flow/MCP/run, CPU profile of the test suite). The full
write-up is the private artifact <https://claude.ai/artifact/QPEDgRtnV65QydVsDjx9rJ>.

**Verdict:** no Rust anywhere. Tree work costs 0.17 ms per call on average (1.2 ms worst fixture) against 0.3–3 s per
device read; the only CPU that shows is the pixel path (30–150 ms per assert) and it has pure-JS fixes. Wall clock is
device I/O and fixed sleeps.

**Order:** the P rows first, one implementation loop each: pure CPU, no device needed, behaviour-preserving (golden
`--against <base>` 0 changed). Then D0 (baseline on the lab devices), then the D rows chosen by what D0 measures, each
measured before and after.

## Status

| # | Item | Kind | Status |
|---|---|---|---|
| P1 | `framesOnly` stops at the first non-empty frame | CPU | open |
| P2 | draw-order: `bottomPinned` O(N), cheap test first in `lastPresentedSurface`, one node → places index | CPU | open |
| P3 | `everyNode` as an explicit stack | CPU | open |
| P4 | PNG decode fast path (native inflate + typed unfilter, pngjs fallback) | CPU | open |
| P5 | `sampleDominant` / `nearCount` on typed arrays | CPU | open |
| P6 | OCR toolchain probe memoised per module, not per `VisionOcr` | spawn | open |
| P7 | Selector regexes compiled once in `parseSelector` | CPU | open |
| T1 | Fake the settle/poll timers in the slowest test files | tests | open |
| D0 | Baseline on `averi_lab` and the iPhone 17 iOS 27.0 simulator | measure | open |
| D1 | Settle sleeps `max(0, pollMs − readDuration)` | device | open |
| D2 | `ensure_state`'s second look ends on a held "no" | device | open |
| D3 | Per-call tree snapshot cache, invalidated by every action | device | open |
| D4 | OCR: one persistent Swift helper, per-frame result cache, parallel crops | device | open |
| D5 | Android raw `screencap` (PNG encoded only when stored or returned) | device | open |
| D6 | Android `typeText` / `clearText` as one `adb shell` script, pacing kept | device | open |
| D7 | iOS: persistent idb gRPC client; WDA `excluded_attributes`; no `/status` before `/source`; parallel `defaults write`; one key-sequence in `clearText` | device | open |
| D8 | Fill re-reads after focus only for secure or unknown fields | device | open |
| D9 | The keyboard's pre-action second look takes the earlier sighting as its first sample | device | open |
| D10 | Scroll: no confirming read after an Android drag stroke (ADR 0021 amendment); keyboard state read beside the tree | device | open |
| D11 | One deadline per tool call that every window is clamped to | device | open |
| D12 | `tools/list` is 73 KB (~18k tokens): shorten the tool descriptions | agent context | open |
| D13 | Small ones: `appHealth` ∥ `finalFrame`; `type_pin` key delay in YAML; config cache by mtime+size; Android `viewport()` and discovery `getprop` in parallel; status bands reuse the keyboard's `dumpsys` | device | open |

## Notes

### P1 — `framesOnly` (ui-tree/placed.ts:118)
`[...everyNode(child)].every(emptyFrame)` spreads the whole subtree before testing and never exits early; it runs per
candidate per target through `FRAME_EXCUSES.structural` → `frameExcused` (draw-order.ts:619). 54 % of runtime at
N=1838. Fix: `n.children.every((c) => emptyFrame(c) && framesOnly(c))`; a `WeakMap` memo optional. Measured: judging
every node 12.5 → 7.9 ms at N=242, 682 → 320 ms at N=1838; identical answers on all 1757 nodes of the iOS truth
fixtures.

### P2 — draw-order (ui-tree/draw-order.ts)
- `bottomPinned` (:1452–1461): `order.slice(placed.end).filter(…)` then `.some(…)` per interactive node, O(I·N), eager
  for flat lists (:1652). 34 ms at N=3202 (idb flat list). Fix: one backward pass keeping, per floor, the largest
  `rect.y` among later area nodes not that floor's keys; same answers.
- `lastPresentedSurface` (~:1775): test `surface(p) !== undefined` (cheap, usually undefined) before
  `drawsOverTarget(p, about)` (the ROWS scan). With P1: 7.9 → 4.6 ms at N=242, 320 → 116 ms at N=1838. Check both
  predicates are pure first.
- `placesOf` (:1721) and `presentation.over` (presentation.ts:176) filter the whole walk per call; build one
  `Map<UiNode, Placed[]>` beside `walkOf`, shared with `presentationOf`; cache `asTarget` per `Placed`, `readingBreak`
  lazy.
- Not wanted: a spatial index over the later nodes — the visit order is part of the rules (ADR 0014, 0015).

### P3 — `everyNode` (adapters/types.ts:688)
Recursive `yield*` costs O(N·depth): 145 µs per walk of 363 nodes vs 12 µs for an explicit stack pushing children in
reverse (same pre-order). Safe while nothing mutates `children` during a walk.

### P4 — PNG decode (verify/capture.ts:554, :915; verify/eyes.ts:29; verify/assert.ts:644)
pngjs spends ~90 % of its 25–32 ms (iOS 1206×2622) in its JS unfilter/bitmapper; zlib is 2–3 ms. A prototype of
`zlib.inflateSync` + a typed-array unfilter for 8-bit RGB/RGBA non-interlaced, pngjs for everything else, gave
byte-identical output in 12.2 ms (iOS) and 9.6 ms (Android). Gate: equality with pngjs on every fixture PNG. sharp
(6–7 ms, ~8 MB per-platform binary) and napi-rs/WASM were weighed and rejected for the npx story.

### P5 — pixel histograms (verify/color-parity.ts:176, verify/eyes.ts:298, :316, :444)
`sampleDominant` keys a `Map` per pixel: 34.5 ms full screen vs 5.1 ms with a `Uint32Array(4096)` histogram.
`nearCount`/`commonestApart` build a `Map` memo per call. Real bands are small (0.1 ms), so the win is in the tests
and the harness; keep CIEDE2000 as it is (the calibrated 10.19 dE source).

### P6 — OCR probe (verify/ocr.ts:286; built per Verifier at flow/engine.ts:1258, run/commands.ts:142)
Every new `Verifier` builds a `VisionOcr` that runs `swiftc --version` (80 ms; 0.1–0.5 s in the repo's notes) and a
filesystem check again. Memoise the binary promise at module level, keeping which failures stick
(`OcrUnavailableError`).

### P7 — selectors (ui-tree/selectors.ts:101)
`new RegExp(cond.value)` per node per condition; compile once on the `Condition`. 0.06 ms per query at N=242 —
cosmetic, take it only alongside other selector work.

### T1 — test timers
75.6 % of the profiled test time is idle; 32 of 59 tests ≥ 500 ms land on whole multiples of 500 ms.
`truth/live-rejudge` 35.5 s (0.2 s CPU), `truth/truth` 30.1 s, `flow/engine` 25.6 s.

### D0 — baseline
Per platform, on the lab apps: a selector tap, a fill of an empty field (and a 20-character value on Android), a
scroll_until over 3 screens, `ensure_state` cold and warm, an ocr assert, a color assert, one screenshot, one tree
read. Record wall clock, device calls and time slept. Then decide which D rows go in and in what order.

### D1–D13
Sources and estimates are in the artifact. Before each: measure on D0's scenario; after: the same run, golden and
calibrate as the loop asks. D2 and D10 change documented policy (engine.ts:732's rule; ADR 0021) — amend the ADR in
the same loop. D5 and D8 change adapter contracts (`screenshot()`, a `secure` flag from the parsers).
