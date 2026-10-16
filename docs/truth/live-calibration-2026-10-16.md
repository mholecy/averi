<!-- The live calibration (phase 5), 2026-10-16: scripts/truth/live.ts --side <checkout> runs a note's live cases with an
older averi's src (calibrate.ts's checkouts, /private/tmp/claude-501/averi-calibration/differential-cal-<sha>) against
the REAL lab app — the averi_lab AVD (emulator-5554, API 33, gesture navigation) and the averi-lab iPhone 17 simulator
(iOS 27.0, WDA on 8120) — the app's tap log, offsets, strokes and form model the oracle. Verdicts are recorded by hand
in scripts/truth/calibration.json (`live`) and rendered in docs/truth/calibration.md. The iOS sides ran before
live.ts printed touches, whole replies and app states for ok cases (replies there are cut at 400 characters; #7's
c3ebc62 run prints the focus as "undefined" — the state file's absent focus, no field focused — which live.ts now
prints as "none"); #12's Android runs are every run of it committed, before and after review round 1. -->

# Live calibration

| note | platform, sources | before → after | cases | verdict |
|---|---|---|---|---|
| #12 android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container | Android, uiautomator | d043e65 → 9c7885e | scroll:scroll-bounded-flush.P.fully, .S.fully | CALIBRATED-ON-DEFECT, intermittent — 4 runs before all red; 5 after: 4 ok, 1 with S left 71 px cut (LV2) |
| #17 ios-scroll-until-never-turns-back-… | iOS, wda + idb | 8a55d2b → 21f1deb | turn:scroll-top-edge-end.T, .T.fully | CALIBRATED |
| #7 wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar, first fix | iOS, wda | 5cff2ad → 7542021 | dismiss:toolbar-dismiss.ks, .ss, .note | CALIBRATED |
| #7, second fix | iOS, wda | 7542021 → c3ebc62 | dismiss:toolbar-dismiss-short.vs, .ks, .ss, .note | CALIBRATED-ON-DEFECT — dismissed after, but `Tapped` claimed with no field focused (honest refusal at debc9b2) |
| #19 ios-wda-childless-toolbar-refuses-keyboard-dismissal | iOS, wda | bd06470 → 470dafe | dismiss:toolbar-dismiss-bar.* | CALIBRATED |

#17 on Android (8a55d2b, 21f1deb): both commits stop on T in the status band at once ("fully visible after 0 swipes",
then Tapped with nothing fired) — Android had no status-band rule then (a later note's); the note is iOS's.

Each side's run follows, as live.ts printed it.

## #12 before: d043e65, run 1 (Android)

```
node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups visibility --cells scroll-bounded-flush --side <cal>/differential-cal-d043e65
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
- MISMATCH scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S
- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S


## #12 before: d043e65, run 2

```
(the same)
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
- MISMATCH scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)


## #12 before: d043e65, run 3 (review round 1)

```
(the same) --record <file>
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches (1 not known), 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- MISMATCH scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible [known: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    scroll_until → Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible [known: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)


## #12 before: d043e65, run 4 (review round 1)

```
(the same) --record <file>
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches (1 not known), 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- MISMATCH scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible [known: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    scroll_until → Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible [known: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)


## #12 after: 9c7885e, run 1 — S.fully left cut (LV2)

```
… --side <cal>/differential-cal-9c7885e
```

# Live golden: 7 cases, 5 ok, 0 loud, 2 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P"
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S
- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes; but its bottom edge lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there, a  — the app lays it out partly-centre-in, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes; but its bottom edge lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there, a rect assert or screenshot may measure part of it
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1436 825x176 (partly-centre-in); lower clip 0,1046 1080x495 offset 83 (launched 0); strokes lower 0→38, lower 38→83; fired tap S


## #12 after: 9c7885e, run 2

```
(the same)
```

# Live golden: 7 cases, 6 ok, 0 loud, 1 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P"
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match; then Tapped id:"lab.scroll-bounded-flush.S"


## #12 after: 9c7885e, run 3 (review round 1)

```
(the same) --record <file>
```

# Live golden: 7 cases, 6 ok, 0 loud, 1 mismatches (1 not known), 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: P 128,719 825x176 (whole); upper clip 0,303 1080x605 offset 79 (launched 0); strokes upper 0→79; fired tap P; touches (540,788) (541,807)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; then Tapped id:"lab.scroll-bounded-flush.S" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: S 128,1338 825x176 (whole); lower clip 0,1046 1080x495 offset 181 (launched 0); strokes lower 0→60, lower 60→121, lower 121→181; fired tap S; touches (540,1443) (540,1443) (540,1443) (541,1426)

Known but ok this run: uiautomator scroll:scroll-bounded-flush.P.fully, uiautomator scroll:scroll-bounded-flush.S.fully


## #12 after: 9c7885e, run 4 (review round 1)

```
(the same) --record <file>
```

# Live golden: 7 cases, 6 ok, 0 loud, 1 mismatches (1 not known), 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: P 128,719 825x176 (whole); upper clip 0,303 1080x605 offset 79 (launched 0); strokes upper 0→79; fired tap P; touches (540,788) (541,807)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; then Tapped id:"lab.scroll-bounded-flush.S" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: S 128,1341 825x176 (whole); lower clip 0,1046 1080x495 offset 178 (launched 0); strokes lower 0→60, lower 60→120, lower 120→178; fired tap S; touches (540,1443) (540,1443) (540,1443) (541,1429)

Known but ok this run: uiautomator scroll:scroll-bounded-flush.P.fully, uiautomator scroll:scroll-bounded-flush.S.fully


## #12 after: 9c7885e, run 5 (review round 1)

```
(the same) --record <file>
```

# Live golden: 7 cases, 6 ok, 0 loud, 1 mismatches (1 not known), 0 skipped

## uiautomator
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: P 128,716 825x176 (whole); upper clip 0,303 1080x605 offset 82 (launched 0); strokes upper 0→82; fired tap P; touches (540,788) (541,804)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — Tapped id:"lab.scroll-bounded-flush.S" (fired, where the probe at its centre did not reach it)
- MISMATCH scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes — the app lays it out sliver, not visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired tap S; touches (541,1530)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; then Tapped id:"lab.scroll-bounded-flush.S" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: S 128,1341 825x176 (whole); lower clip 0,1046 1080x495 offset 178 (launched 0); strokes lower 0→57, lower 57→117, lower 117→178; fired tap S; touches (540,1443) (540,1443) (540,1443) (541,1429)

Known but ok this run: uiautomator scroll:scroll-bounded-flush.P.fully, uiautomator scroll:scroll-bounded-flush.S.fully


## #17 before: 8a55d2b (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups visibility --cells scroll-top-edge-end --side <cal>/differential-cal-8a55d2b
```

# Live golden: 14 cases, 10 ok, 0 loud, 4 mismatches, 0 skipped

## idb
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.A" is off screen at (201,-250) on a 402x874 screen (rect 51,-282 300x64) — scroll_until it first; nothing was tapped
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, 
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — R-direction: no turn back: stroke 1 (382→382, still) and stroke 2 (382→382, still) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 3 swipes — its centre stays under iOS's status bar at (201,29), in the top 62 pt of the screen, where a tap goes to the status bar, and the content is exhausted: swiping down no longer moves it out
    scroll_until → ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 3 swipes — its centre stays under iOS's status bar at (201,29), in the top 62 pt of the screen, where a tap goes to the status bar, and the content is exhausted: swiping down no longer moves it out from under the status bar — try direction: "up"; if no direction moves it, it is pinned under the status bar (a layout that ignores the saf
    tap → ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, no scroll moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap something else; no
    app: T 51,-2 300x64 (status-band); page clip 0,0 402x874 offset 382 (launched 382); strokes page 382→382, page 382→382, page 382→382; fired nothing
- MISMATCH turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — R-direction: no turn back: stroke 1 (382→382, still) and stroke 2 (382→382, still) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 5 swipes — element is in the viewport but CLIPPED at top, 95% of it is in the viewport, and the content is exhausted: swiping down no longer moves it. The element cannot be fully revealed — that is
    scroll_until → ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 5 swipes — element is in the viewport but CLIPPED at top, 95% of it is in the viewport, and the content is exhausted: swiping down no longer moves it. The element cannot be fully revealed — that is a layout defect (no clearance for an overlay?), not a scroll that needs more swipes. Last rect {"x":51,"y":-3,"width":300,"height":64} in a
    tap → ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, no scroll moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap something else; no
    app: T 51,-2 300x64 (status-band); page clip 0,0 402x874 offset 382 (launched 382); strokes page 382→382, page 382→382, page 382→382, page 382→382, page 382→382; fired nothing

## wda
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.A" is off screen at (201,-250) on a 402x874 screen (rect 51,-282 300x64) — scroll_until it first; nothing was tapped
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing wa
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — R-direction: no turn back: stroke 1 (382→382.7, still) and stroke 2 (382.7→382, still) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 5 swipes — its centre stays under iOS's status bar at (201,28), in the top 62 pt of the screen, where a tap goes to the status bar, and the content is exhausted: swiping down no longer moves it out
    scroll_until → ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 5 swipes — its centre stays under iOS's status bar at (201,28), in the top 62 pt of the screen, where a tap goes to the status bar, and the content is exhausted: swiping down no longer moves it out from under the status bar — try direction: "up"; if no direction moves it, it is pinned under the status bar (a layout that ignores the saf
    tap → ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped
    app: T 51,-2 300x64 (status-band); page clip 0,0 402x874 offset 382 (launched 382); strokes page 382→382.7, page 382.7→382, page 382→382, page 382→382, page 382→382; fired nothing
- MISMATCH turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — R-direction: no turn back: stroke 1 (382→382, still) and stroke 2 (382→382, still) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 3 swipes — element is in the viewport but CLIPPED at top, 92% of it is in the viewport, and the content is exhausted: swiping down no longer moves it. The element cannot be fully revealed — that is
    scroll_until → ERROR scroll_until id:"lab.scroll-top-edge-end.T" failed after 3 swipes — element is in the viewport but CLIPPED at top, 92% of it is in the viewport, and the content is exhausted: swiping down no longer moves it. The element cannot be fully revealed — that is a layout defect (no clearance for an overlay?), not a scroll that needs more swipes. Last rect {"x":51,"y":-5,"width":300,"height":65} in a
    tap → ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped
    app: T 51,-2 300x64 (status-band); page clip 0,0 402x874 offset 382 (launched 382); strokes page 382→382, page 382→382, page 382→382; fired nothing


## #17 after: 21f1deb (iOS)

```
… --side <cal>/differential-cal-21f1deb
```

# Live golden: 14 cases, 14 ok, 0 loud, 0 mismatches, 0 skipped

## idb
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.A" is off screen at (201,-250) on a 402x874 screen (rect 51,-282 300x64) — scroll_until it first; nothing was tapped
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, 
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"

## wda
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.A" is off screen at (201,-250) on a 402x874 screen (rect 51,-282 300x64) — scroll_until it first; nothing was tapped
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under iOS's status bar at (201,30), in the top 62 pt of the screen, where a tap goes to the status bar (rect 51,-2 300x64) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing wa
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"


## #17 on Android: 8a55d2b

```
node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups visibility --cells scroll-top-edge-end --side <cal>/differential-cal-8a55d2b
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge-end.A" to appear
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- MISMATCH tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    tap → Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes — the app lays it out status-band, not visible; then the tap: averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    scroll_until → Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,-55 825x176 (status-band); page clip 0,0 1080x2220 offset 1100 (launched 1100); strokes none; fired nothing
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — averi says Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes — the app lays it out status-band, not visible; then the tap: averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    scroll_until → Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,-55 825x176 (status-band); page clip 0,0 1080x2220 offset 1100 (launched 1100); strokes none; fired nothing
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"


## #17 on Android: 21f1deb

```
… --side <cal>/differential-cal-21f1deb
```

# Live golden: 7 cases, 4 ok, 0 loud, 3 mismatches, 0 skipped

## uiautomator
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge-end.A" to appear
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
- MISMATCH tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    tap → Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes — the app lays it out status-band, not visible; then the tap: averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    scroll_until → Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,-55 825x176 (status-band); page clip 0,0 1080x2220 offset 1100 (launched 1100); strokes none; fired nothing
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
- MISMATCH turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — averi says Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes — the app lays it out status-band, not visible; then the tap: averi says Tapped id:"lab.scroll-top-edge-end.T" — the app logged nothing
    scroll_until → Element id:"lab.scroll-top-edge-end.T" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,-55 825x176 (status-band); page clip 0,0 1080x2220 offset 1100 (launched 1100); strokes none; fired nothing
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"


## #7: 5cff2ad (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups dismissal --sources wda --cells toolbar-dismiss,toolbar-dismiss-short --side <cal>/differential-cal-5cff2ad
```

# Live golden: 8 cases, 0 ok, 8 loud, 0 mismatches, 0 skipped

## wda
- LOUD dismiss:toolbar-dismiss.vs toolbar-dismiss: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
- LOUD dismiss:toolbar-dismiss.ks toolbar-dismiss: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part 
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swip
- LOUD dismiss:toolbar-dismiss.ss toolbar-dismiss: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part 
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swip
- LOUD dismiss:toolbar-dismiss.note toolbar-dismiss: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is par
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a sw
- LOUD dismiss:toolbar-dismiss-short.vs toolbar-dismiss-short: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.vs": the band it draws over [0,573][402,874] contains the tap point (201,621) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.vs": the band it draws over [0,573][402,874] contains the tap point (201,621) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.ks toolbar-dismiss-short: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.ss toolbar-dismiss-short: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.note toolbar-dismiss-short: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard 
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails an


## #7: 7542021 (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups dismissal --sources wda --cells toolbar-dismiss,toolbar-dismiss-short --side <cal>/differential-cal-7542021
```

# Live golden: 8 cases, 3 ok, 5 loud, 0 mismatches, 0 skipped

## wda
- LOUD dismiss:toolbar-dismiss.vs toolbar-dismiss: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
- ok dismiss:toolbar-dismiss.ks toolbar-dismiss: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — Tapped id:"lab.toolbar-dismiss.ks" (the soft keyboard covered id:"lab.toolbar-dismiss.ks"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- ok dismiss:toolbar-dismiss.ss toolbar-dismiss: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — Tapped id:"lab.toolbar-dismiss.ss" (the soft keyboard covered id:"lab.toolbar-dismiss.ss"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- ok dismiss:toolbar-dismiss.note toolbar-dismiss: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — Tapped id:"lab.toolbar-dismiss.note" (the soft keyboard covered id:"lab.toolbar-dismiss.note"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- LOUD dismiss:toolbar-dismiss-short.vs toolbar-dismiss-short: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.vs": the band it draws over [0,573][402,874] contains the tap point (201,621) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.vs": the band it draws over [0,573][402,874] contains the tap point (201,621) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.ks toolbar-dismiss-short: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.ss toolbar-dismiss-short: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 
- LOUD dismiss:toolbar-dismiss-short.note toolbar-dismiss-short: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard 
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-short.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails an


## #7: c3ebc62 (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups dismissal --sources wda --cells toolbar-dismiss,toolbar-dismiss-short --side <cal>/differential-cal-c3ebc62
```

# Live golden: 8 cases, 3 ok, 1 loud, 4 mismatches, 0 skipped

## wda
- LOUD dismiss:toolbar-dismiss.vs toolbar-dismiss: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss.vs" to hold still (found, but never at the same position in two consecutive reads)
- ok dismiss:toolbar-dismiss.ks toolbar-dismiss: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — Tapped id:"lab.toolbar-dismiss.ks" (the soft keyboard covered id:"lab.toolbar-dismiss.ks"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- ok dismiss:toolbar-dismiss.ss toolbar-dismiss: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — Tapped id:"lab.toolbar-dismiss.ss" (the soft keyboard covered id:"lab.toolbar-dismiss.ss"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- ok dismiss:toolbar-dismiss.note toolbar-dismiss: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — Tapped id:"lab.toolbar-dismiss.note" (the soft keyboard covered id:"lab.toolbar-dismiss.note"; hidden by tapping id:"lab.toolbar-dismiss.title" before tapping)
- MISMATCH dismiss:toolbar-dismiss-short.vs toolbar-dismiss-short: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — averi says Tapped id:"lab.toolbar-dismiss-short.vs" (the soft keyboard covered id:"lab.toolbar-dismiss-short.vs"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping) — the focus is on undefined
    tap → Tapped id:"lab.toolbar-dismiss-short.vs" (the soft keyboard covered id:"lab.toolbar-dismiss-short.vs"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping)
- MISMATCH dismiss:toolbar-dismiss-short.ks toolbar-dismiss-short: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — averi says Tapped id:"lab.toolbar-dismiss-short.ks" (the soft keyboard covered id:"lab.toolbar-dismiss-short.ks"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping) — the focus is on undefined
    tap → Tapped id:"lab.toolbar-dismiss-short.ks" (the soft keyboard covered id:"lab.toolbar-dismiss-short.ks"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping)
- MISMATCH dismiss:toolbar-dismiss-short.ss toolbar-dismiss-short: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — averi says Tapped id:"lab.toolbar-dismiss-short.ss" (the soft keyboard covered id:"lab.toolbar-dismiss-short.ss"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping) — the focus is on undefined
    tap → Tapped id:"lab.toolbar-dismiss-short.ss" (the soft keyboard covered id:"lab.toolbar-dismiss-short.ss"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping)
- MISMATCH dismiss:toolbar-dismiss-short.note toolbar-dismiss-short: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — averi says Tapped id:"lab.toolbar-dismiss-short.note" (the soft keyboard covered id:"lab.toolbar-dismiss-short.note"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping) — the focus is on undefined
    tap → Tapped id:"lab.toolbar-dismiss-short.note" (the soft keyboard covered id:"lab.toolbar-dismiss-short.note"; hidden by tapping id:"lab.toolbar-dismiss-short.title" before tapping)


## #19: bd06470 (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups dismissal --sources wda --cells toolbar-dismiss-bar --side <cal>/differential-cal-bd06470
```

# Live golden: 4 cases, 0 ok, 4 loud, 0 mismatches, 0 skipped

## wda
- LOUD dismiss:toolbar-dismiss-bar.vs toolbar-dismiss-bar: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss-bar.vs" to hold still (found, but never at the same position in two consecutive reads)
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.toolbar-dismiss-bar.vs" to hold still (found, but never at the same position in two consecutive reads)
- LOUD dismiss:toolbar-dismiss-bar.ks toolbar-dismiss-bar: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is p
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.ks": the band it draws over [0,573][402,874] contains the tap point (201,695) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a 
- LOUD dismiss:toolbar-dismiss-bar.ss toolbar-dismiss-bar: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is p
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.ss": the band it draws over [0,573][402,874] contains the tap point (201,769) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a 
- LOUD dismiss:toolbar-dismiss-bar.note toolbar-dismiss-bar: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — not tapped, the focus on postcode, though a dismissal is configured: ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is
    tap → ERROR The soft keyboard covers id:"lab.toolbar-dismiss-bar.note": the band it draws over [0,573][402,874] contains the tap point (201,843) on two looks 300ms apart; this adapter cannot hide it on its own (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and 


## #19: 470dafe (iOS)

```
node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups dismissal --sources wda --cells toolbar-dismiss-bar --side <cal>/differential-cal-470dafe
```

# Live golden: 4 cases, 4 ok, 0 loud, 0 mismatches, 0 skipped

## wda
- ok dismiss:toolbar-dismiss-bar.vs toolbar-dismiss-bar: a tap on vs under the keyboard, keyboardDismiss on the title: the keyboard dismissed, vs focused, nothing typed — Tapped id:"lab.toolbar-dismiss-bar.vs" (the soft keyboard covered id:"lab.toolbar-dismiss-bar.vs"; hidden by tapping id:"lab.toolbar-dismiss-bar.title" before tapping)
- ok dismiss:toolbar-dismiss-bar.ks toolbar-dismiss-bar: a tap on ks under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ks focused, nothing typed — Tapped id:"lab.toolbar-dismiss-bar.ks" (the soft keyboard covered id:"lab.toolbar-dismiss-bar.ks"; hidden by tapping id:"lab.toolbar-dismiss-bar.title" before tapping)
- ok dismiss:toolbar-dismiss-bar.ss toolbar-dismiss-bar: a tap on ss under the keyboard, keyboardDismiss on the title: the keyboard dismissed, ss focused, nothing typed — Tapped id:"lab.toolbar-dismiss-bar.ss" (the soft keyboard covered id:"lab.toolbar-dismiss-bar.ss"; hidden by tapping id:"lab.toolbar-dismiss-bar.title" before tapping)
- ok dismiss:toolbar-dismiss-bar.note toolbar-dismiss-bar: a tap on note under the keyboard, keyboardDismiss on the title: the keyboard dismissed, note focused, nothing typed — Tapped id:"lab.toolbar-dismiss-bar.note" (the soft keyboard covered id:"lab.toolbar-dismiss-bar.note"; hidden by tapping id:"lab.toolbar-dismiss-bar.title" before tapping)

