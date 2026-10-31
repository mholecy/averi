# Performance backlog (2026-10-30)

From a ten-reviewer performance review of main at `ff6f28a6` (ui-tree ×2, interact scroll, interact tap/fill/keyboard,
verify pixels, verify text/OCR, Android adapter, iOS adapter, flow/MCP/run, CPU profile of the test suite). The full
write-up is the private artifact <https://claude.ai/artifact/QPEDgRtnV65QydVsDjx9rJ>.

**Verdict:** no Rust anywhere. Tree work costs 0.17 ms per call on average (1.2 ms worst fixture) against 0.3–3 s per
device read; the only CPU that shows is the pixel path (30–150 ms per assert) and it has pure-JS fixes. Wall clock is
device I/O and fixed sleeps.

**Cut (2026-10-30):** P1, P3, P2, P6, P4 in that order; P5 and P7 not worth a loop; T1 after the D rows. D12
needs no device and goes in with the D rows.

**Order:** the P rows first, one implementation loop each: pure CPU, no device needed, behaviour-preserving (golden
`--against <base>` 0 changed). Then D0 (baseline on the lab devices), then the D rows chosen by what D0 measures, each
measured before and after.

## Status

| # | Item | Kind | Status |
|---|---|---|---|
| P1 | `framesOnly` stops at the first non-empty frame | CPU | done (5ea456ff) |
| P2 | draw-order: `bottomPinned` O(N), cheap test first in `lastPresentedSurface`, one node → places index | CPU | done (4c07b631) |
| P3 | `everyNode` as an explicit stack | CPU | done (ff612d57) |
| P4 | PNG decode fast path (native inflate + typed unfilter, pngjs fallback) | CPU | done (1e8a0c50) |
| P5 | `sampleDominant` / `nearCount` on typed arrays | CPU | won't do — real bands cost 0.1 ms |
| P6 | OCR toolchain probe memoised per module, not per `VisionOcr` | spawn | done (5731c309) |
| P7 | Selector regexes compiled once in `parseSelector` | CPU | won't do — cosmetic |
| T1 | Fake the settle/poll timers in the slowest test files | tests | deferred — after the D rows |
| D0 | Baseline on `averi_lab` and the iPhone 17 iOS 27.0 simulator | measure | Android done (0119d76d); iOS run by the owner |
| D1 | Settle sleeps `max(0, pollMs − readDuration)` | device | done (0d551270; with a 150 ms floor, ADR 0029) |
| D2 | `ensure_state`'s second look ends on a held "no" | device | open |
| D3 | Per-call tree snapshot cache, invalidated by every action | device | done (8bdb8004; a one-shot hand-off, not a cache — ADR 0030) |
| D4 | OCR: one persistent Swift helper, per-frame result cache, parallel crops | device | open |
| D5 | Android raw `screencap` (PNG encoded only when stored or returned) | device | open |
| D6 | Android `typeText` / `clearText` as one `adb shell` script, pacing kept | device | done (86505377; pace 250 → 100 ms; the script and clearText not worth it) |
| D7 | iOS: persistent idb gRPC client; WDA `excluded_attributes`; no `/status` before `/source`; parallel `defaults write`; one key-sequence in `clearText` | device | open |
| D8 | Fill re-reads after focus only for secure or unknown fields | device | done (1083523e; Android only, ADR 0028) |
| D9 | The keyboard's pre-action second look takes the earlier sighting as its first sample | device | won't do — the second look guards a re-flow after the keyboard hides; iOS only, 0 in D0 |
| D10 | Scroll: no confirming read after an Android drag stroke (ADR 0021 amendment); keyboard state read beside the tree | device | done (4cd4825a); keyboard beside the tree: won't do (stale IME band → false "fully visible") |
| D11 | One deadline per tool call that every window is clamped to | device | open |
| D12 | `tools/list` is 73 KB (~18k tokens): shorten the tool descriptions | agent context | done (f8b62f5b) |
| D13 | Small ones: `appHealth` ∥ `finalFrame`; `type_pin` key delay in YAML; config cache by mtime+size; Android `viewport()` and discovery `getprop` in parallel; status bands reuse the keyboard's `dumpsys` | device | done (02f78183): probe without getprop, ensure's health beside its frame; the rest won't do or measure later |
| D14 | golden never reaches `framesOnly`: a mutation of it leaves golden at 0 changed (found in P1's review) | harness | open |
| D15 | Two engines compiling the OCR helper at once share the `${binary}.${pid}` staging path (pre-existing; found in P6) | stability | open |
| D16 | `tests/truth/calibration.test.ts` spawns a `git merge-base` per fix and times out (5 s) under load | tests | open |
| D17 | uiautomator cuts a sideways carousel item's bounds at the screen edge, so its true centre is unknown and "CLIPPED 88 %" can name an item whose centre is past the carousel edge (pre-existing; found in D10's live run, `carousel-in-list.C`) | correctness | open |
| D18 | No lab field reformats as it is typed into (IBAN grouping, amount separators): the typing pace and a fill's read-back are unproven there, and `type_text` without a selector, flow `type:` and `type_pin` type blind (found in D6's review) | stability | open |

## Notes

### P1 — `framesOnly` (ui-tree/placed.ts:118)
`[...everyNode(child)].every(emptyFrame)` spreads the whole subtree before testing and never exits early; it runs per
candidate per target through `FRAME_EXCUSES.structural` → `frameExcused` (draw-order.ts:619). 54 % of runtime at
N=1838. Fix: `n.children.every((c) => emptyFrame(c) && framesOnly(c))`; a `WeakMap` memo optional. Measured: judging
every node 12.5 → 7.9 ms at N=242, 682 → 320 ms at N=1838; identical answers on all 1757 nodes of the iOS truth
fixtures.

Done in 5ea456ff: the suggested line, no memo (measured no gain). 223 → 155 ms judging every node at N=1811 (five
copies of the largest capture), 8.2 → 6.0 ms at N=363. Golden is blind to this function (two mutations that change its
answers left it at 0 changed), so the proof is `tests/ui-tree/frames-only.test.ts`'s sweep against the plain definition
over every iOS and Android truth tree; `tests/helpers/android-trees.ts` now sits beside `iosTrees()`.

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

Done in 4c07b631: all three parts; `readingBreak` stays eager — with `asTarget` cached it is built once per target, it
returns at once on nested trees, and on flat lists the `readingBreak` row reads it for nearly every later node (a lazy
getter measured within noise). Tap + pixel standing for every node: N=1803 656 → 194 ms, flat N=3010 5.2 → 2.8 s,
the corpus 215 → 160 ms. Golden 0 changed; the proof is an equivalence run main vs branch over 554 trees / 41,438 nodes
plus `tests/ui-tree/{bottom-pinned,places-by,presented-surface-first,target-facts-once}.test.ts`. What is left on a flat
list is the visit over later nodes, which the rules require.

### P3 — `everyNode` (adapters/types.ts:688)
Recursive `yield*` costs O(N·depth): 145 µs per walk of 363 nodes vs 12 µs for an explicit stack pushing children in
reverse (same pre-order). Safe while nothing mutates `children` during a walk.

Done in ff612d57: still a lazy generator; 65 → 4.6 µs per walk of 363 nodes, all 148 corpus trees 931 → 98 µs; no depth
limit (the recursion threw past ~5000 levels); a hole in `children` still throws. The edge it documents: an array changed
in place after its node was passed is not seen (no caller does that). Golden is blind to sibling order (a reversed walk
left it at 0 changed); `tests/adapters/every-node.test.ts` checks identity per node against a recursive oracle.

### P4 — PNG decode (verify/capture.ts:554, :915; verify/eyes.ts:29; verify/assert.ts:644)
pngjs spends ~90 % of its 25–32 ms (iOS 1206×2622) in its JS unfilter/bitmapper; zlib is 2–3 ms. A prototype of
`zlib.inflateSync` + a typed-array unfilter for 8-bit RGB/RGBA non-interlaced, pngjs for everything else, gave
byte-identical output in 12.2 ms (iOS) and 9.6 ms (Android). Gate: equality with pngjs on every fixture PNG. sharp
(6–7 ms, ~8 MB per-platform binary) and napi-rs/WASM were weighed and rejected for the npx story.

Done in 1e8a0c50: `src/verify/png.ts#decodePng` is the one decoder in src. iOS 1206×2622 24 → 7 ms, Android 1080×2220
20 → 7.5 ms (a word-at-a-time Up filter, which is ~90 % of real rows, beats the prototype). The fast path takes only what
pngjs decodes to the same bytes — every fixture, ~8.6k fuzzed decodes, a seeded 400-case test — and declines tRNS, PLTE,
bad CRCs, trailing bytes after the zlib stream or IEND, and every Node without `zlib.crc32` (< 20.15 / 22.2: there P4
gives no speed-up, pngjs runs). zlib is imported as a namespace so those Nodes still load the server.

### P5 — pixel histograms (verify/color-parity.ts:176, verify/eyes.ts:298, :316, :444)
`sampleDominant` keys a `Map` per pixel: 34.5 ms full screen vs 5.1 ms with a `Uint32Array(4096)` histogram.
`nearCount`/`commonestApart` build a `Map` memo per call. Real bands are small (0.1 ms), so the win is in the tests
and the harness; keep CIEDE2000 as it is (the calibrated 10.19 dE source).

### P6 — OCR probe (verify/ocr.ts:286; built per Verifier at flow/engine.ts:1258, run/commands.ts:142)
Every new `Verifier` builds a `VisionOcr` that runs `swiftc --version` (80 ms; 0.1–0.5 s in the repo's notes) and a
filesystem check again. Memoise the binary promise at module level, keeping which failures stick
(`OcrUnavailableError`).

Done in 5731c309: the probe (not the binary) is memoized per exec, as `adapters/xcode-env.ts` does; the per-engine
`existsSync` stays so a swept temp dir rebuilds. 20 Verifiers 1.7 s → 0.2 ms. A missing or refusing `swiftc` now sticks
for the process (the error says to restart averi); a probe timeout or EAGAIN is forgotten; a failed compile stays the
engine's answer and the next Verifier compiles again, as before. Left: D15.

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

Harness (0119d76d): `node --import tsx scripts/perf/baseline.ts --platform android|ios --device <id> --repeat 5
[--app react-native] [--tree-source wda]` — averi's real MCP tools, per scenario wall, device calls, device busy time,
averi's sleeps by caller (header of `scripts/perf/baseline.ts`). iOS needs idb/WDA, which this sandbox blocks: run it
outside. The simulator is named `averi-lab iPhone 17` for the lab guards.

Android, averi_lab API 33, native AveriLab, 5 repeats, medians, with P1–P6 (load 2.5–2.8):

| scenario | wall ms | device calls | device ms | slept ms |
|---|---|---|---|---|
| tree | 2426 | 3 | 2424 | 0 |
| screenshot | 1080 | 4 | 776 | 302 |
| tap | 5336 | 6 | 4830 | 502 |
| color assert | 3591 | 7 | 3226 | 302 |
| fill, 3 chars | 11627 | 13 | 9854 | 1761 |
| fill, 20 chars | 17330 | 30 | 11266 | 6044 |
| scroll_until, content ~3 screens (4 swipes) | 21226 | 19 | 19197 | 2010 |
| ensure_state cold | 14280 | 14 | 13458 | 804 |
| ensure_state warm | 3390 | 6 | 3081 | 302 |

The React Native app has the same shape (tree 2.3 s, fill 10.9 s, fill-20 17.0 s). OCR could not run here (Vision is
unavailable in the sandbox). One `uiautomator dump` costs 2.2–2.5 s and is 87 % of a tap, 80 % of a fill, 86 % of a
cold ensure and 65 % of the scroll: every read a D row removes is worth ~2.3 s on Android. The scroll over ~3 screens
takes 21 s, past the 15 s default budget. CPU is ≤ 133 ms per call. Order from these numbers: D10, D8, D9, D3, D1, D6,
D5; D2 did not trigger (the lab app renders fast); D13's discovery probe is ~55 ms.

### D13 — per-call overhead
Done in 02f78183. Figures (averi_lab API 33, 2026-10-31; cited from the code): `getprop ro.build.version.release` ≈30–35 ms
per device per call, up to ~70 ms (30–33 ms in D13's run); `pidof` 44–48 ms in D3's run, 32–60 ms in D13's;
`adb exec-out screencap` 312–352 ms per call in D3's live baseline, 347–365 ms in D13's.
- `registry.get()` probes with `adb devices -l` only (`ListOpts.versions: false`); `listAll`/`select` keep versions;
  `adb devices` is never cached (a stale "booted" would hand out a dead adapter). −1 device call on every tool call.
- `ensure_state` asks the app's health beside its final frame (pidof hidden under the screencaps); a `verify` leg still
  asks after its frame, so an app that dies while the frame settles reads dead.
- Won't do: a config cache (`parseConfig` 0.2–8 ms), sharing the bands' and keyboard's `dumpsys` (once per launch), the
  capture stability pair (its 300 ms spacing keeps a blinking caret from reading as motion). Measure with D18: fill's
  350 ms focus sleep, `type_pin`'s 300 ms key delay.

### D6 — typing pace
Done in 86505377: measured first (2026-10-31, averi_lab API 33; scripts and per-trial records kept outside the repo):
~9,600 characters typed per character at 250/150/100/50/0 ms, per call and as one script, on the Compose form-basic
name field and the React Native field, idle and under host load (yes ×4, ×14) and device load (yes ×4) — 0 dropped,
garbled or added. One script per chunk saves only 10–25 ms a character, so not done; clearText (per call, one script,
one batched keyevent) left nothing in 60 trials and is unchanged. `TYPING_PACE_MS` = 100 doubles the 50 ms floor that the
2026-08-05 drops after long uptime leave. fill-20 15.2 → 12.0 s, fill 9.0 → 8.7 s; live forms 32/32 identical.
Untested: fields that reformat as typed (D18), long uptime.

### D3 — read hand-off
Done in 8bdb8004 (ADR 0030): not a transparent cache — a one-shot hand-off of the last read (a watched adapter whose
exhaustive typed record says which methods act; any action empties it; ≤ 1 s since the read ended; never across tool
calls), taken only as a first sample or a positive verdict: the ladder's re-detect (yes only, never for an absence),
element asserts (pass only), a flow tap/fill's first sample. Detect probes produce it too. Cold ensure_state
14.6 → 12.3 s (one dump fewer), every other D0 scenario unchanged; live forms 32/32 identical. Residuals: a handed yes
can be ~3.3 s older than the fresh read it replaces; concurrent tool calls on one device are not seen.

### D1 — poll cadence
Done in 0d551270 (ADR 0029): `pollTree` sleeps `min(pollMs, max(150, pollMs − read))` — reads start ≥ pollMs apart and
the settle proof's two snapshots are never back to back (the floor covers WDA's slow-then-fast pair). Android tap
5.2 → 5.0 s, fill and cold ensure −0.25…0.31 s; live forms 32/32 identical. Accepted R2: the last read before a
deadline is no longer pushed past it by chance. 17 tests that pinned the pause on a real clock now fake Date.

### Next (decided 2026-10-31 from an analysis of D3, D5, D6)
- D3 as an explicit one-shot hand-off of the last read, never a transparent cache: used only as a first sample or a
  positive verdict (the ladder's post-rung detect, element asserts after an assert, a tap's first sample after a
  wait/assert step), never as a stability proof, pixel locator, absence or across tool calls; age ≤ 1 s; every
  non-read adapter method invalidates it. Saves 2.3 s per redundant Android read (cold ensure 14.0 → ~11.8 s).
- D6: measure the 250 ms typing pacing first (M6: delays 250/150/100/50 ms, 0 drops in 400+ chars to accept);
  the one-script part alone is ~4 % of fill-20.
- D5: measure raw `screencap` first (M5), emulator only; ~0.4 s per frame if confirmed.
- New candidates: the capture stability pair (300 ms + a second screencap per frame); fill's 350 ms focus sleep.

### D8 — fill re-read
Done in 1083523e (ADR 0028): parsers report `UiNode.secure`; the post-focus re-read is skipped only for an empty plain
field named by a sole `id` on Android (iOS keeps it: a tail retype needs the after-focus inputs); a bullets read-back of
another length on that path fails loudly. fill 11.7 → 9.3 s, fill-20 17.4 → 15.2 s; live forms 32/32 identical. Golden:
verdicts unchanged, 45 ui_snapshot replies gain `"secure": true` (new golden base taken at 1083523e). Residual R1: a
field wrongly said plain + autofill on focus + exactly as many dropped keys passes silently.

### D10 — Android settled read
Done in 4cd4825a (ADR 0021 decision 7): `DeviceAdapter.treeReadSettles` on Android — a `uiautomator dump` snapshots only after
a 1 s idle wait (AOSP DumpCommand), 35/35 post-stroke dumps equalled the next one — so the read after a stroke is the
settled read, with no confirming read and no 400 ms pause. Scroll over ~3 screens 19.3 → 15.1 s (−22 %); live.ts
forms + visibility 184/185 verdicts unchanged (the carousel one is run-to-run carry over D17's pre-existing gap). The
keyboard read beside the dump was rejected: it would read the IME ~2 s before the snapshot. A snapping pager/LazyRow is
unmeasured. D9 won't do: the keyboard's second look guards a layout re-flowing after the keyboard hides; iOS only.

### D12 — tool descriptions
Done in f8b62f5b: instructions + tools/list 73,447 → 29,513 B (~18.4k → ~7.4k tokens). Shared vocabulary is said once in the
server `instructions`; each description keeps its tool's contract and the rules an agent must not break (pinned phrase
by phrase in `tests/mcp/tool-descriptions.test.ts`), units and selector quoting are repeated where the agent acts on
them; the full former text is `skill/references/tools.md` (linked by version from the instructions), pinned to its
owners. A budget test holds the total ≤ 31,000 B and each description ≤ 4,096 chars (Claude Code's default cut, which
had been truncating the old tap, scroll_until, ui_snapshot and assert).

### D1–D13
Sources and estimates are in the artifact. Before each: measure on D0's scenario; after: the same run, golden and
calibrate as the loop asks. D2 and D10 change documented policy (engine.ts:732's rule; ADR 0021) — amend the ADR in
the same loop. D5 and D8 change adapter contracts (`screenshot()`, a `secure` flag from the parsers).
