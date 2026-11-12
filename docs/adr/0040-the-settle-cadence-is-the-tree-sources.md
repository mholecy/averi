# 40. The settle cadence is the tree source's

Status: accepted 2026-11-02, merged 9b762b4c (performance backlog row D35, docs/plans/2026-10-30-performance-backlog.md;
loop L5, branch `perf/l5-idb-settle-cadence`, f65475c4 + 9e91f826) after the batch-4 device gate (2026-11-02, lab
simulator, L5 at f65475c4 against main 7e6d2d47): `L5 verdict: PASS`. The product-path settle run (`d35-motion
--settle`, M1a/M1b/M2, four alternated halves of 30 trials, 60 a side): 0 wrong settles in 60, every one seen moving
(20 per motion), L5's adapter reporting cadence 300 in every settle, median last-two-reads gap 302 ms against main's
502, median settle 2 460 ms after the trigger, 595 ms earlier than main's 3 055. Each half alone logged INCONCLUSIVE
(exit 1): it holds 10 trials a motion, under the ≥ 15-a-motion rule that gates the combined analysis (20 a motion),
which passed — not a miss. The baseline A/B (idb, 20 runs a side): tap 670 → 474 ms (−196, settle sleep 410 → 208),
fill 1 208 → 1 008 (−200), fill-20 −207, ensure-cold −196; the controls — idb ensure-warm and scroll, WDA tap/fill (7
a side), Android tap/fill (5 a side) — Δ slept ≈ 0 (≤ 3 ms); device calls per run equal everywhere. The fallback (a
wrong settle sets `IDB_SETTLE_CADENCE_MS` to 400) was not needed. ADR 0029's rule (`pauseAfterRead`) is unchanged.
This record adds a fact: which `pollMs` the settle is given.
Amended 2026-11-03 (T5: the batch-11 trace replayed through resolveSettled) — see the amendment below.
Amended 2026-11-12 (A41a: under `treeSource: auto` the cadence is undefined — the default 500 — until the first read
chose a source, then that source's; ADR 0046).
Amended 2026-11-12 (A41b: WDA's `/source` declares 300, `WDA_SETTLE_CADENCE_MS`, measured) — see the amendment below.

## Context

- `interact/resolve.ts#resolveSettled` proves an element holds still by the same rect on two consecutive fresh reads.
  It is a `ui-tree/read-tree.ts#pollTree` predicate, so its reads START about `pollMs` apart (ADR 0029). Until now that
  `pollMs` was the CALLER's, never the device's: the MCP `tap` and `type_text` tools passed none (500,
  `DEFAULT_POLL_MS`), and the flow engine passed its own 500 (`EngineOptions.pollMs`), the cadence of its waits.
- What the proof compares is two SNAPSHOTS. Where a snapshot falls inside a read is the tree source's property. idb's
  `describe-all` snapshots AX at once, in a 20–31 ms read (batch-3 B2 medians). A WDA `/source` snapshot falls
  anywhere inside a 0.3–1.7 s read. An Android dump snapshots after its own idle wait, inside a 2.2–2.5 s read.
- On idb, D1 made the pause after a ~30 ms read about 470 ms of a 500 ms cadence. That is one such pause in every tap
  and fill, and in every keyboard re-look.

## Decision

**`DeviceAdapter.settleCadenceMs?: number` is a fact: the cadence at which two reads of this adapter's tree may prove
an element holds still. `settleCadence(adapter, opts) = opts.pollMs ?? adapter.settleCadenceMs ?? DEFAULT_POLL_MS`
(`interact/resolve.ts`) is the one owner of the choice, and `resolveSettled` is its only caller.**

- A caller's explicit `pollMs` wins. Tests and any caller that pins a cadence stay deterministic.
- The fact belongs to the source. `IosTreeSource.settleCadenceMs` is optional. `IdbTreeSource` declares
  `IDB_SETTLE_CADENCE_MS` = 300. `WdaTreeSource` declares none, and neither does the differential harness's
  `RecordedTreeSource`. `IosAdapter` forwards its source's value through a getter and does not dispatch on `kind`.
  `AndroidAdapter` declares none.
- `ui-tree/read-handoff.ts#ADAPTER_SURFACE.settleCadenceMs = 'fact'`. The proxy returns a non-function as it is, so
  the value reaches the settle through `ReadHandOff.watch`. Classing it `'reads'` would be equivalent for the same
  reason.
- `resolvePresent` (the flow `optional:` probe) does not use it. It makes no stability claim and stays at 500. The
  engine's `wait:`, `branch:` and detect probes, the Verifier and the pixel poll are unchanged.
- The flow engine separates the two meanings its `pollMs` carried. `acting.pollMs` is set only when
  `EngineOptions.pollMs` was given, so in production a flow's tap and fill settle at the adapter's fact. The fill's
  value poll is passed on its own (`FillOptions.valuePollMs: this.pollMs`), so it stays 500. Its five rounds are the
  window a late value has to land in (RN on WDA). `fillField` takes `valuePollMs ?? pollMs ?? DEFAULT_VALUE_POLL_MS`,
  so MCP's 400 and every test that pins both through `pollMs` are unchanged.
- **A value is set only from a measurement of that source.** The measurement is a d35-motion-style run: back-to-back
  reads through real motions, with the settle replayed offline at each cadence using the product's own
  `pauseAfterRead`. A judgement does not set a value.


## The measurement (D35, idb, lab simulator)

d35-motion read back to back for 3 s after each trigger. The settle was replayed at each cadence p. A settle is wrong
when a later read in the window moves the rect.

| | batch-2 B (45 moving trials) | batch-3 B2 (60 moving, 0 unsettled at end) | combined 105 |
|---|---|---|---|
| wrong settles p200 | 0 | 1 (M2 carousel C, 840 ms) | 1 |
| p250 | 1 (M2 carousel, 957 ms) | 0 | 1 |
| **p300** | **0** | **0** | **0** |
| p400 / p500 | 0 / 0 | 0 / 0 | 0 / 0 |
| false-settle pairs g=300 | 3/55 180 | 0/56 514 | 3/111 694 (2.7·10⁻⁵) |
| g=400 | 10/51 213 | 1/51 892 | 11/103 105 (1.1·10⁻⁴) |
| g=500 | 3/51 488 | 4/53 125 | 7/104 613 (6.7·10⁻⁵) |

- 300 is the smallest cadence with 0 wrong settles in both batches. The two wrong settles seen, at p200 and p250,
  come from one mechanism: M2's paging carousel in its last ~100 ms of deceleration.
- The false-equal pairs are not monotone in the gap between 300 and 500. They look like AX repeating a frame, not slow
  motion, and 500 does not remove them.
- The replay is the worst case. It starts the settle at the first read after the trigger. In the product, a settle
  follows an agent round trip or a flow step, which is later in the motion.
- M3 (sheet) and M4 (keyboard) are moot on idb. AX reports the end frame at once (batch-2, 15/15 each).
- Median saving: 205 ms a settle against 500 (batch-3 B2).

## Per source

- **idb**: 300, measured (above).
- **WDA**: none, so 500. It is unmeasured. At most 200 ms is left to gain, because the floor binds for r ≥ 350
  (follow-up D35b).
- **Android**: none, and moot. A 2.2–2.5 s dump makes `pauseAfterRead(p, r)` the 150 ms floor for any p ≤ r + 150.

## Consequences

- Only `resolveSettled`'s pause on iOS idb changes, from 500 − r to 300 − r (r ≈ 20–40 ms). The 150 ms floor binds
  only for r > 150. That pause comes once per settle that needs a second read: once per tap, once per fill plus each
  keyboard re-look, and once per flow tap or fill. Everything else sleeps as before.
- Expected saving: about 200 ms a settle on idb (the measured median, 205 ms). WDA and Android sleep exactly as
  before, and so does every poll that is not a settle: `wait:`, detect, `optional:`, the Verifier, the pixel poll, the
  fill's value poll and `scroll_until`.
- Replies are unchanged. They quote budgets, not cadences. The differential main → L5 shows 0 diffs.
- A test or caller that pins `pollMs` is unaffected. A new tree source that declares no value settles at 500.

## Risks accepted

- (R1) The margin is thin. 300 is one 50 ms step above a cadence that failed once. 0/105 bounds the per-settle rate
  of wrong settles below ≈ 2.9 % (95 %, rule of three), and 500 has the same bound. The data show no difference
  between 300 and 500. They do not show that 300 is as safe as 500.
- (R2) Some motion kinds are unmeasured: navigation pushes, which should be moot by the M3/M4 mechanism but that is
  not proven; JS-driven RN animations; Lottie.
- (R3) A wrong settle is not caught later. A tap lands where the element WAS, and no later step re-checks a tap's
  landing. The product-path run (`d35-motion --settle`) is the check before merge.
- The floor and the run-of-one late read (~150–167 ms back to back, ADR 0029) are unchanged. 300 is still twice the
  gap the proof already accepts there.

## Amendment: T5 — the batch-11 trace replayed through the production settle (2026-11-03)

**What.** `tests/fixtures/d35-b11-settle.json` (253 KB) is batch-11 B2's d35-motion run (2026-11-03, lab simulator,
idb, main a5fefd32), trimmed from a device batch: 60 trials (20 each of sheet-long-list M1a, scroll-bounded M1b,
carousel-in-list M2), every read for 3 s after the trigger (8569, all ok), times at 0.1 ms, each id's rects as per-id
equality classes. A whole-read digest would be unfaithful: the settle compares the resolved target's rect alone, so
one moving id would hold back every other. The host checkout, the device id, the trigger's coordinates and the app's
evidence are dropped. Batch-2's and batch-3's raw traces are not kept, so the measurement above is not replayed.

**The replay.** `tests/interact/settle-trace.test.ts` runs production `resolveSettled` (with `settleCadence`,
`pollTree` and `pauseAfterRead` unmodified) once per (trial, id) through a fake adapter whose `settleCadenceMs` is
`IDB_SETTLE_CADENCE_MS` and no `pollMs`. Only Date is faked: a read asked for at trace time T is the first recorded
read that starts at or after T, and the clock advances by that read's own length. The served read can start up to one
read (~30 ms) after the requested time and the cadence restarts from it, so replayed reads are ~300–330 ms apart: the
pin is slightly optimistic. The settle starts at the first read after the trigger, the worst case named above. A settle is wrong when a later read in the window has the id at another
rect (vanishing later is not wrong in a motion corpus). The test does not re-implement the settle. d35's own replay
re-implemented it.

**The pin.** At the fact: 0 wrong settles in 160 (M1a 0, M1b 100, M2 60). That equals d35's own replay of the same
batch, the same (trial, id, read) settles. Sensitivity: at `pollMs: 100` exactly one is wrong (M2#14, the carousel's C,
in its late deceleration, the mechanism above). So the fixture can fail. M1a is 0 at 300 because its sheet fling
decelerates through nearly the whole window, its rows at rest only in the last ~0.3 s: at the fact M1a pins only that
the fling is never taken as settled (at 100 its rows settle 245 times, none wrong). Hand mutants: 14 of 18 killed. H3
(the check looks at the next read only) is equivalent on this corpus, since the one wrong settle is moved by the very
next read; H5 (the settle started at the trigger's start) too, since every trial's first read starts as the trigger
ends. S4 (`pauseAfterRead` returns `pollMs` whole) and S6 (no rect reset on a miss) survive because the corpus cannot
tell them apart: S4 is killed in read-tree.test.ts, and S6 would need an id that vanishes and returns between two
compared reads.

**The limit.** On this batch no cadence from 125 to 500 shows a wrong settle, so the corpus cannot show 300 is
necessary. A cut of the fact is caught only as a changed settle count, which is change detection and not safety
evidence. A raise to 400 keeps 160 settles and is not caught. R3 stands: a new value is set only by a product-path
run; the fixture pins the shipped one.

**Residuals.**
- The probe kept only `lab.*` ids and the tracked labels, the last node winning on a duplicate key, and no roles. A
  duplicate match in the real tree, which `ambiguous` would judge, is not recorded.
- Date is whole ms, while the probe's clock was fractional. Below 250 ms this moves a few settles against d35's replay.

## Amendment: A41b — WDA's cadence is 300, measured (2026-11-12)

**The measurement.** The A41 probe (`npm run truth:lab:ios:a41`, owner run 2026-11-12 on main 7ca241d5, averi-lab
iPhone 17 simulator, iOS 27.0; docs/truth/live-records/a41-probe/, summary.log.txt) ran this record's rule for WDA:
d35-motion-style trials through WDA's `/source`, read back to back after each trigger, the settle replayed offline
through `resolveSettled` with the product's `pauseAfterRead` at 300 and at 500 ms (scripts/perf/a41-settle.ts).
60 trials, 20 each of M1a (sheet fling), M1b (scroll-bounded) and M2 (carousel-in-list), every one seen moving:

| | settles | of moving ids | censored (< 500 ms of reads after) | wrong |
|---|---|---|---|---|
| 300 ms | 160 (M1a 0, M1b 100, M2 60) | 60 | 0 | **0** |
| 500 ms | 160 (M1a 0, M1b 100, M2 60) | 60 | 0 | 0 |

The rule set before the run: shorten only at 0 wrong in at least 60 moving, uncensored settles. It held. M1a gave 0
settles at either cadence: its sheet fling decelerates through the whole window, as on idb (T5). So the 300 ms
evidence rests on M1b (100 settles) and M2 (60). M1a shows only that the fling is never taken as settled.

**The decision.** `WdaTreeSource.settleCadenceMs = WDA_SETTLE_CADENCE_MS` = 300 (`adapters/wda-tree-source.ts`). Under
`treeSource: auto` the adapter's cadence is still undefined (500) until the first read chose, then the chosen source's:
300 either way now. The recorded source of the differential harness still declares none.

**Consequences.** A settle's pause on WDA drops from 500 − r to 300 − r. WDA's warm read in the same run was 102 ms
(median, 81–119), so the pause falls from about 400 to about 200 ms, above the 150 ms floor: about 200 ms off each
WDA tap and fill and each keyboard re-look, as D35 gave idb. The probe's warm tap was WDA 687 ms against idb 476 (+212):
the expected WDA tap is about 490 ms, within the 100 ms A41b asks; the owner's re-run of the probe is the check.
Replies are unchanged.

**Risks.** R1–R3 above hold for WDA as for idb, with one difference: a WDA snapshot falls anywhere inside a read of
0.03–1.7 s, so two reads 300 ms apart can be closer in snapshot time than in start time. The replay ran on WDA's own
reads, so that is in the measurement, not outside it; 0/60 still bounds the per-settle rate of wrong settles below
≈ 5 % (95 %), and 500 has the same bound.

