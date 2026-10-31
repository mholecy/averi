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
| D0 | Baseline on `averi_lab` and the iPhone 17 iOS 27.0 simulator | measure | done — Android (0119d76d), iOS 2026-10-31 ("D0 on iOS") |
| D1 | Settle sleeps `max(0, pollMs − readDuration)` | device | done (0d551270; with a 150 ms floor, ADR 0029) |
| D2 | `ensure_state`'s second look ends on a held "no" | device | open |
| D3 | Per-call tree snapshot cache, invalidated by every action | device | done (8bdb8004; a one-shot hand-off, not a cache — ADR 0030) |
| D4 | OCR: one persistent Swift helper, per-frame result cache, parallel crops | device | won't do — the recognizer is 150–160 ms on iOS (D0 on iOS); a persistent helper saves ≤ 50–80 ms on OCR asserts only |
| D5 | Android raw `screencap` (PNG encoded only when stored or returned) | device | won't do — raw over exec-out is ~610 ms slower (see D19) |
| D6 | Android `typeText` / `clearText` as one `adb shell` script, pacing kept | device | done (86505377; pace 250 → 100 ms; the script and clearText not worth it) |
| D7 | iOS: a persistent idb helper per simulator — measured −90 ms a `describe-all`, −122 ms a `tap` (the CLI's Python start-up). Designed 2026-10-31: a Python helper running fb-idb's own `gen_main(argv)` in one process (same companion resolution, same errors), the CLI as fallback, `AVERI_IDB_HELPER=off`; D7a = the helper + `ui describe-all`, D7b = the HID verbs (no retry after a helper death) | device | D7a done (5fb79290, ADR 0032; device A/B: tree −37 %, fill −9 %, ensure cold −285 ms); D7b done (a4746de9, ADR 0032 §D7b; device A/B: tap −155 ms, fill −322, scroll −751, ensure cold −424 stall-free; RN split holds 5/5) |
| D8 | Fill re-reads after focus only for secure or unknown fields | device | done (1083523e; Android only, ADR 0028) |
| D9 | The keyboard's pre-action second look takes the earlier sighting as its first sample | device | won't do — the second look guards a re-flow after the keyboard hides; iOS only, 0 in D0 |
| D10 | Scroll: no confirming read after an Android drag stroke (ADR 0021 amendment); keyboard state read beside the tree | device | done (4cd4825a); keyboard beside the tree: won't do (stale IME band → false "fully visible") |
| D11 | One deadline per tool call that every window is clamped to | device | open |
| D12 | `tools/list` is 73 KB (~18k tokens): shorten the tool descriptions | agent context | done (f8b62f5b) |
| D13 | Small ones: `appHealth` ∥ `finalFrame`; `type_pin` key delay in YAML; config cache by mtime+size; Android `viewport()` and discovery `getprop` in parallel; status bands reuse the keyboard's `dumpsys` | device | done (02f78183): probe without getprop, ensure's health beside its frame; the rest won't do or measure later |
| D14 | golden never reaches `framesOnly`: a mutation of it leaves golden at 0 changed (found in P1's review) | harness | open |
| D15 | Two engines compiling the OCR helper at once share the `${binary}.${pid}` staging path (pre-existing; found in P6) | stability | done (65900f1f) |
| D16 | `tests/truth/calibration.test.ts` spawns a `git merge-base` per fix and times out (5 s) under load | tests | done (b5b40276) |
| D17 | uiautomator cuts a sideways carousel item's bounds at the screen edge, so its true centre is unknown and "CLIPPED 88 %" can name an item whose centre is past the carousel edge (pre-existing; found in D10's live run, `carousel-in-list.C`) | correctness | open |
| D18 | No lab field reformats as it is typed into (IBAN grouping, amount separators): the typing pace and a fill's read-back are unproven there, and `type_text` without a selector, flow `type:` and `type_pin` type blind (found in D6's review) | stability | open |
| D19 | Android capture by `shell screencap <file>` + `adb pull` (raw RGBA, PNG encoded on the host only when returned/stored): −80…110 ms per capture on lab screens, −1.3 s on photo-heavy ones; changes the `screenshot()` contract | device | open |
| D20 | iOS idb: `scroll_until` on a flinging list stopped "the swipe CHANGED THE SCREEN" after one stroke | stability | done (7e32f1d3; idb full strokes paced at 349 pt/s, ADR 0018 Decision 4; device-checked 5/5, 9.0 s) |
| D21 | iOS idb: right after a simulator boot with a fresh companion every `idb ui describe-all` fails "The simulator's accessibility service named no frontmost application" for the whole call (D20's device check 2026-10-31: 133 reads in 90 s, 5 of 5 repeats); a hand launch + read before the run cured it once. Find the cause and what averi can do (re-front the app? a named recovery in the reply?) — needs the device | stability | open |
| D22 | iOS registry probe: the bound simulator proven booted from its `device.plist` (0.05 ms) before `simctl list devices` (~80–110 ms, every verb); anything else falls back to simctl | device | done (3574d5b2; ADR 0031) — device-checked: tree −32 %, tap −12 % |
| D23 | iOS launch: the two `simctl spawn defaults write` (Accessibility) together, not in series | device | done (fa334d35; not one spawn — the iOS 27 runtime has no shell; 445 → 250 ms a launch on the lab simulator) |
| D24 | iOS RN: a burst from `idb ui text` drops a controlled field's tail — after a repaired drop (ADR 0023's retype landed it), later typings into that app send the first key alone, 150 ms, then the rest | stability | done (ffec743d; ADR 0023 D24 amendment) — device-checked: rn-fill-20 5 925 → 2 346 ms (−60 %) |
| D25 | iOS RN: the D24 split also costs short texts that never dropped (rn-fill "Jan" 2 155 → 2 341 ms, +1 idb call + 150 ms) — measure from what length a burst drops, split only above it | device | open |
| D26 | iOS: `simctl io screenshot` stalls ~+1 000 ms (bimodal ~400 / ~1 400 ms) in ~10 % of calls (D7a A/B: 24/201), with or without the idb helper, never under WDA-only runs' tree reads — every screenshot, colour/OCR assert and ensure_state frame can pay it; find the cause (a frame/IOSurface wait?), try `idb screenshot` through the helper or a timeout-and-retry, and count stalls separately in the D0 report | device | D26a done (aa676f9e: the D0 report and `scripts/perf/stalls.ts` count stalls > 900 ms apart, with a stall-free median); the cause and a capture fix wait on the owner's `scratchpad/d26/d26-diag.sh` run |

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
engine's answer and the next Verifier compiles again, as before. D15 done (see ### D15).

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
outside. The simulator is named `averi-lab iPhone 17` for the lab guards. First iOS probe (2026-10-31, 13bf3ca4): every
idb tree read failed with "The simulator's accessibility service named no frontmost application" (the known idb state
of docs/truth/live-ios-2026-10-18-visibility.md) — reboot the simulator, or run a companion of its own
(`IDB_COMPANION=localhost:<port>`), and check `idb ui describe-all` by hand before a run; not a harness or src fault.
The second probe read every tree but every tap and swipe failed "The dtuhidd connection … has been invalidated" (a
companion registered before the reboot; docs/truth/live-ios-2026-10-19-lab-fixes.md). So before an iOS run: kill every
`idb_companion` and WDA, reboot the simulator, start a companion of the run's own AFTER the boot, export
`IDB_COMPANION`, and check both a read (`idb ui describe-all`) and a stroke (`idb ui swipe`) by hand.

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

### After the loops (7a05e9fb, 2026-10-31)
The same D0 run on main after P1–P6, D1, D3, D6, D8, D10, D12, D13 (5 repeats, medians, one session — the emulator's own
spread between sessions is several hundred ms, so compare per item in its own note, not across sessions):

| scenario | D0 (2026-10-30) | now | |
|---|---|---|---|
| tap | 5336 | 4997 | −6 % |
| fill, 3 chars | 11627 | 8808 | −24 % |
| fill, 20 chars | 17330 | 11951 | −31 % |
| scroll_until, ~3 screens | 21226 | 17616 | −17 % |
| ensure_state cold | 14280 | 13838 | −3 % (D3's own A/B: −2.4 s) |
| ensure_state warm | 3390 | 3368 | 0 |
| color assert | 3591 | 3520 | −2 % |
| screenshot | 1080 | 1050 | −3 % |
| tree | 2426 | 2336 | −4 % |

What is left on Android is the `uiautomator dump` itself (~2.3 s per read) and the capture pair; iOS: see "D0 on iOS" below.

### D0 on iOS (2026-10-31, 9c8ef1f2 / aaa12374)

The averi-lab iPhone 17 simulator, iOS 27.0, 5 repeats, medians, run by the owner outside the sandbox with a fresh idb
companion (see D0's pre-run recipe); load 2.5–5. Records: the session scratchpad's `d0-results/ios-*.json`.

| scenario | native · idb | native · wda | RN · wda | Android (13bf3ca4) |
| --- | ---: | ---: | ---: | ---: |
| tree | 263 | 194 | 276 | 2 336 |
| screenshot | 1 161 | 1 164 | — | 1 050 |
| tap | 954 | 894 | — | 5 000 |
| color assert | 1 580 | 1 544 | — | 3 520 |
| ocr assert | 1 764 | 1 708 | — | unavailable |
| fill (3) | 1 662 | 2 324 | 2 155 | 8 808 |
| fill (20) | 1 680 | 2 370 | 5 925 | 11 951 |
| scroll_until, 3 screens | failed ×5 (D20) | 6 908 | — | 17 616 |
| ensure_state cold | 4 438 | 7 110 | — | 13 838 |
| ensure_state warm | 1 285 | 1 199 | — | 3 368 |

iOS is 2–7× faster than Android per verb (the screenshot is the exception): an idb read is ~150 ms, a WDA `/source` 35–90 ms warm. Where the time goes:
- every call pays `simctl list devices` (~110 ms, the registry's probe) — on iOS that is 10–40 % of a verb (D13's
  probe trim was Android-only);
- a screenshot is two `simctl io screenshot` (~370 ms each) plus a 300 ms sleep (capture.ts:801, the stability pair):
  ~1 s of every screenshot, colour and OCR assert, and of ensure_state's final frame;
- `simctl spawn launchctl` (~235 ms, appHealth) in every assert and ensure_state;
- WDA: ensure_state cold spends 4.9 s in five `/source` reads (the first after a launch is slow), RN fill-20 sleeps
  2 s in fill-type.ts:304 (5 × 400 ms, the per-chunk pace) and its first tree read waits up to 23 s on WDA's start;
- OCR's recognizer itself is 150–160 ms: D4's persistent helper would save little of that.

### D20 — iOS idb scroll_until on a list that flings (diagnosed 2026-10-31)

D0 on iOS: `scroll_until id:"lab.form-picker.country.GB" direction:down` on the lab's 45-row picker sheet failed in all
5 repeats under idb, "the swipe CHANGED THE SCREEN: none of the 15 elements the read before it listed by id …" after 1
(once 2) strokes; under WDA the same call passes (2 strokes, 6.9 s). The owner's diagnostic outside the sandbox
(scratchpad `d0-results/ios-scroll-diag.sh`, screenshots 0.4 s and 2.4 s after one stroke from (201,699), 3 runs each,
rows 52 pt): the sheet stays up in every run; the full stroke 524 pt / 300 ms carried the list ~20 rows (~1 040 pt,
Albania → Italy at the top, still moving at 0.4 s) — past every row of the read before it, so idb's flat tree keeps no
anchor and `screenChangedUnder` names a dismissal that did not happen; 524 pt / 1.5 s carried ~11 rows (~570 pt, the
stroke plus a little) and kept two rows of the read before; 160 pt / 600 ms (the feeler) ~3 rows. So on idb a full
stroke flings about twice its length on a SwiftUI List and loses the overlap the changed-screen judgement relies on.

Fixed in 7e32f1d3 (perf/d20-idb-paced-strokes): on a tree idb read, every full `scroll_until` stroke takes
`max(300, ceil(travel / 349 pt/s))` ms (`interact/stroke-plan.ts#PACED`, gated on `CallEvidence.source === 'idb'`; the
feeler first; no `IosAdapter.dragSpeed`, so WDA and Android are unchanged). Golden: 63 idb scroll checks changed, the
`--duration` alone (0.3 → 1.502 for 524 pt). Estimated cost ~1.2 s a stroke; the limits (6 swipes, 15 s) unchanged and
named in ADR 0018 Decision 4 as what the device run decides. Device check (outside the sandbox, the pre-run recipe of D0):
`node --import tsx scripts/perf/baseline.ts --platform ios --device <udid> --scenarios scroll --repeat 5`.
Device-checked 2026-10-31 at a2a938bb (the owner, outside the sandbox, through the scratchpad's `d0-results/ios-run.sh`
wrapper): the picker's GB `scroll_until` under idb 5/5 ok, median 9 038 ms [9 000–9 137], 3 strokes of ~2.17 s each
(`idb ui swipe` ×3 6 521 ms: 1.5 s of stroke plus idb's own ~0.67 s), 5 reads 776 ms, settles 1 600 ms; no row selected
(every reply claims the target). Before: 0/5. WDA on the same call: 6 908 ms. A faster pace (between 300 ms and 1.5 s)
stays unmeasured — the next saving, if this scroll matters.

### iOS per-call costs (analysed 2026-10-31, from D0 on iOS)

Decided from an analysis of the D0 windows (and simctl timed on the lab simulator): D22 (probe from device.plist), D23
(the `defaults write`s together — done in fa334d35, two concurrent spawns: the simulator has no shell), D7 narrowed to the idb client (measure first), D24 (RN dropped tail, stability). Won't do:
dropping the capture pair or its 300 ms spacing on iOS — docs/bugs/2026-10-06-whole-screen-stability-aliases-a-blinking-
caret.md measured the iOS caret blinking too, and without the sleep an equal pair on a caret screen falls from ~38 % to
~22 % of tries (estimate), so a settled verdict would cost more captures or come back `moving`; PNG vs TIFF/BMP (no gain);
D7's `/status` (2–7 ms) and WDA `excluded_attributes` (averi parses isVisible/isAccessible). Deferred: appHealth from the
host's process list (−200 ms an assert) — it moves D13's "health after the frame" rule. D4 won't do.

### iOS after D20, D22, D23 (a44b3189, 2026-10-31)

The owner's run through `ios-run.sh`, native · idb, 5 repeats, medians (ms), against "D0 on iOS" (9c8ef1f2):

| scenario | D0 | now | change |
| --- | ---: | ---: | ---: |
| tree | 263 | 179 | −84 (−32 %) |
| screenshot | 1 161 | 1 120 | −41 |
| tap | 954 | 840 | −114 (−12 %) |
| color assert | 1 580 | 1 515 | −65 |
| ocr assert | 1 764 | 1 709 | −55 |
| fill (3) | 1 662 | 1 563 | −99 |
| fill (20) | 1 680 | 1 567 | −113 |
| scroll_until, 3 screens | failed ×5 | 8 945 | works (D20) |
| ensure_state cold | 4 438 | 4 103 | −335 (−8 %) |
| ensure_state warm | 1 285 | 1 214 | −71 |

`simctl list devices` is gone from every window (D22); ensure-cold's two `defaults write` overlap (device busy 459 ms
under the summed call time, D23). What is left per verb is idb itself (`describe-all` 140–180 ms, `ui tap` ~185 ms,
`ui text` ~220 ms — about 90 ms of each the CLI's Python start-up: D7), the capture pair (kept) and appHealth (deferred).

### D7 and D24 measured (2026-10-31, the owner outside the sandbox)

D7 (`scratchpad/d7/d7-measure.py`, n = 20, the lab simulator, a fresh companion): a persistent fb-idb client in one
process against averi's exact CLI argv — `describe-all` 114.3 → 24.7 ms (−90), `ui tap` 219.0 → 96.5 ms (−122); a
fresh `Client.build` per call costs the same as the persistent one (connect 8.5 ms), so the saving is the CLI's Python
start-up (`idb --help` alone 91.6 ms). `ui text` not measured (idb refuses an empty string). Decision: a persistent idb
helper per simulator is worth building (≥ 60 ms on every verb) — the next loop after D24, analysis first (process
lifecycle, a companion that dies, D21).

D24 (`scratchpad/d24/rn-typing-diag.sh`, 15 runs a mode, "Jan Novak Bratislava" into AveriLabRN's rn-field via raw idb,
read back from the app's state file): one burst (averi today) kept all 20 characters 5/15; the first character alone,
150 ms, then the rest in one burst 15/15 (614 ms); one call with 10 ms after each key 15/15 (705 ms); chunks of 5 15/15
(784 ms); chunks of 1 15/15 (3.8 s). ADR 0023's chunks-of-3 losing mid-text (14–15/25) did not reproduce here.
Decision: after a fill on an app has seen its tail dropped, later iOS fills on that app send the first character alone,
wait 150 ms, then the rest (sticky per app; native fills never pay); ADR 0023's tail retype stays the safety net.

### D24 device check (322bc127, 2026-10-31)

The owner's `ios-run.sh ios-rn-after-d24 --app react-native --repeat 5` (AveriLabRN, tree via WDA, one server across
the repeats): repeat 1's rn-fill-20 learned the drop (5 383 ms, the poll and the retype); repeats 2–5 split and landed
whole first time — rn-fill-20 median 2 346 ms [2 326–5 383] against 5 925 in D0 on iOS (−60 %), `idb ui text` ×2 and
one 400 ms poll, no retype. The cost: rn-fill ("Jan", which never dropped) 2 155 → 2 341 ms — the split applies to
every typing into a learned app (D25). rn-tree 276 → 166 ms (D22).

### D7a device A/B (f2498c4a, 2026-10-31)

The owner's `ios-run.sh` native · idb, 5 repeats, `AVERI_IDB_HELPER=off` then on (medians, ms): tree 175 → 111
(−37 %), tap 842 → 779, fill 1 559 → 1 415, fill-20 1 578 → 1 452, scroll 8 977 → 8 577, color 1 531 → 1 480, ocr
1 712 → 1 628, ensure-warm 1 225 → 1 155; ensure-cold 4 131 → 4 863. A describe-all through the helper is ~70–110 ms
against ~170 ms (128 of 129 calls served by the helper; it started once, outside ensure-cold). Part of the read saving
moves into D1's pause (`pauseAfterRead(500, readMs)`: the cadence stays ~500 ms). ensure-cold's +732 is
`simctl io screenshot` stalling ~+1 000 ms (bimodal: ~400 or ~1 400 ms) in 4 of its 5 ON repeats against 1 of 5 OFF;
the stall-free ON repeat took 3 872 ms (every OFF 4 053–4 140). Stalls across whole runs: ON 9/50 screenshots, OFF
2/50, earlier CLI runs 7/100, WDA 0/50 (Fisher ON vs pooled CLI p ≈ 0.02 — weak). The second A/B (ON first, then OFF; 10 repeats of
screenshot, color, ocr, ensure-warm, ensure-cold) settles it: stalls ON 12/101, OFF 12/100 — the helper does not raise
the stall rate (both sessions pooled 21/151 vs 14/150); ensure-cold ON 3 858 against OFF 4 143 ms (−285). The stall is
simctl's own (D26). D7a confirmed; D7b next.

D7b merged 2026-10-31 (a4746de9): the helper serves averi's HID verbs (tap, swipe, text, key, key-sequence, button
HOME — exactly the argv IosAdapter sends); each request is acked before `gen_main`, a death after the ack is reported
(`INPUT_LOST`, never retried), a death before it runs the input once on the CLI. Waits for the owner's A/B
(`AVERI_IDB_HELPER=off` vs on, `--repeat 5`) and the RN rn-fill-20 re-check that the D24 split still holds.

### D7b device A/B (106cfde6, 2026-10-31)
Owner's runs on the native lab app through `ios-run.sh` (fresh companion, 5 repeats each), `AVERI_IDB_HELPER=off` first,
then on. Wall medians off → on: tree 190 → 114, tap 840 → 685 (−155), fill 1 571 → 1 249 (−322), fill-20 1 527 → 1 238,
scroll 8 856 → 8 105 (−751), ocr 1 785 → 1 501, ensure-warm 1 204 → 1 043, ensure-cold 4 261 → 3 974 (stall-free
4 208 → 3 784); screenshot and color unchanged (simctl). Per call: `idb ui tap` 205 → 111 ms, `ui text` 211 → 111,
`ui swipe` ×3 6 430 → 6 025, `describe-all` ~150 → ~70. All 50 + 50 runs ok; screenshot stalls 2/52 off, 2/50 on (D26a
counts). Part of the read saving again moves into D1's pause (`read-tree.ts:414` 346 → 435 ms in fill), as in D7a.
React Native (`ios-rn-d7b`, WDA tree, input through the helper): rn-fill 2 000 ms and rn-fill-20 2 031 ms medians, 5/5
ok each; the first rn-fill-20 (5 041 ms) is D24's learning run (the drop repaired, the app then split), the next four
1 962–2 045 ms (D24 after: 2 346). The D24 split holds through the helper. D7 done.

### D26 diag (owner's run 2026-10-31, `scratchpad/d26/d26-diag.sh`, 120 interleaved rounds)
Per capture, p50 / p90 / stalls: `simctl io screenshot` png 398 / 417 / 8 of 120 (jpeg 6.7 %, tiff 4.2 %, `--mask=ignored`
10 %, `--display=internal` 2.5 % — no variant avoids it); `idb screenshot` CLI 168 / 179 / 0; a persistent fb-idb gRPC
client (what the D7 helper would do) 77 / 88 / 0 of 120. Conditions for simctl: beside a `simctl spawn launchctl`
38 % stall (appHealth beside ensure_state's frame), after 1.5 s idle 0 %, 300 ms after a capture 7.5 %, after a
describe-all 2.5 %, two at once 7.5 % and +230 ms; a 1 s wait inside CoreSimulator, not encoding. Kill at 800 ms and
retry: 8 of 180 killed, no retry stalled — but the kill costs 800 ms, so it saves ~600 ms on 4 % of calls only.
`recordVideo` alongside: no effect worth having. Pixels: same size (1206×2622), same sRGB; idb draws the Dynamic Island
(a black pill, 378×112 px at the top centre) where simctl shows the app's background, and 16 corner pixels differ.
Decision: D26b = screenshots through idb on the idb tree source (helper first, the `idb screenshot` CLI as its fallback,
so the image never mixes sources within a capture pair); simctl stays for WDA and when idb is unusable.

### D26b (implemented on `perf/d26b-idb-screenshot`, 2026-10-31; waits for the owner's device check)
On the idb tree source `IosAdapter.screenshot` is `idb screenshot - --udid U` through runIdb (the helper, the CLI as
its fallback; `screenshot -` a helper read, 15 s, retried on the CLI after a death); WDA keeps `simctl io screenshot`;
`AVERI_IOS_SCREENSHOT=simctl` forces simctl (read once per adapter). No simctl fallback at run time (a mixed capture
pair reads as moving). The iOS baseline diff leaves the status band out of both images (the Dynamic Island: 1.219 % >
1 %), iOS and the band only. D0 counts both captures (`SCREENSHOT_LABELS`, `stalls.byLabel`, a line per capture).
ADR 0032 "D26b". Device check: `ios-run.sh` native (idb), `--repeat 5`, `AVERI_IOS_SCREENSHOT=simctl` vs unset —
screenshot/color/ocr/ensure-warm/ensure-cold walls and the idb screenshot stall line; one stored simctl baseline
re-diffed under idb.

### D5 — raw screencap (measured, won't do)
Measured 2026-10-31 on averi_lab API 33 (30 interleaved runs): `exec-out screencap -p` 368 ms median (device ~350 ms, of
which ~230 ms PNG encode); raw `exec-out screencap` 979 ms — `exec-out` moves only ~11 MB/s here and a raw frame is
9.6 MB. The raw format on API 33: a 16-byte header (w, h, format 1 RGBA_8888, colour space 1 sRGB), rows unpadded; its
pixels equal `decodePng` of the PNG byte for byte on 6 lab screens. Faster ways to the same bytes: `shell screencap
<file>` + `adb pull` (280–286 ms on every screen; pull ~170–195 MB/s) and `exec-out 'screencap | gzip -1'` (226 ms
on a lab cell, grows with content). On a photo-heavy screen `-p` costs 1.57 s. That is D19. Host PNG encode when bytes
are still needed: zlib filter None level 1, 8–40 ms per frame.

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

### D15 — OCR compile staging
Done in c0e38019: concurrent builds of one recognizer binary in a process share ONE compile, through a module-level
in-flight map (`compilesInFlight`, verify/ocr.ts) keyed by the binary path and dropped when the build settles. A failed
shared compile is the sticky answer of every engine that joined it, as if each had compiled itself (same source, same
toolchain), and the next engine compiles afresh. The cost: an engine that joins late inherits the compile's remaining
time, and on a compile timeout it gets that timeout as its own answer; the next Verifier retries. A missing swiftc still
sticks process-wide and transient errors are still forgotten (P6). Source and staging paths are
`${binary}.${pid}.${uuid}`, so they are unique per build, also when a pid is reused across sandboxes. A failed compile
now removes its staging binary, which it did not before (a red run left `recognizer-*.<pid>` files behind). Rename stays
the only publishing step. Review round 1: the source write sits inside the cleanup's try (a half-written source on
ENOSPC is removed; the error stays plain and forgotten), a failing cleanup never replaces the compile's answer, the
harness's `scripts/differential/ocr-probe.ts` stages the same way, and the per-engine `existsSync` (P6) is pinned by a
test.

### D16 — calibration test's git spawns
`tests/truth/calibration.test.ts` asked git once per commit: `cat-file -e` per named commit, `merge-base --is-ancestor`
per fix, two `rev-parse` per derived side, and a fresh `gitParentOf` per test — 497 git processes per run, the ancestor
test 3.0 s cold and 5.06–5.17 s (timed out, 8 of 8) with 8 copies in parallel. Now every name is resolved to a full SHA
in one `cat-file --batch-check` (`<name>^{commit}`, so a missing or ambiguous name or a non-commit is none, as
`cat-file -e` said), HEAD's history is read once by `rev-list HEAD` into a Set, and a fix is in HEAD when its SHA is in
it (`notInHead`, pure; a fix that names no commit is reported as not in HEAD, as before). A shallow clone behaves as
before: a commit beyond the boundary is no object, so it resolves to none. One `gitParentOf` serves the three tests.
Decided: it stays one spawn per distinct commit (57, once per run, through the shared cache), because the withSides and
report tests check calibrate's production derivation itself; accepted as is. 66 processes per run; cold 6.6 → 1.5 s
for the file; under 8× load the ancestor test takes 66–73 ms and the withSides test 0.71 s (was 3.05 s), 8 of 8 green.
Tested on a throwaway repo with a side branch (its commit exists, is not in HEAD), so `rev-list --all` fails a test.
Review round 1: a derived side no lookup resolved no longer passes as equal to an unresolved parent (both undefined);
`rev-list HEAD` throws rather than read as an empty history (64 MB buffer); the throwaway repo is built by a throwing
git; a name with a newline resolves to none.

### D1–D13
Sources and estimates are in the artifact. Before each: measure on D0's scenario; after: the same run, golden and
calibrate as the loop asks. D2 and D10 change documented policy (engine.ts:732's rule; ADR 0021) — amend the ADR in
the same loop. D5 and D8 change adapter contracts (`screenshot()`, a `secure` flag from the parsers).
