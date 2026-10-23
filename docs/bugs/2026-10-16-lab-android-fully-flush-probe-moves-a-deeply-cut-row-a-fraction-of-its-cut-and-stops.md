# BUG: on Android `scroll_until … fully: true` probes a row cut flush at its container's edge with strokes that move it 21–61 px; when the budget ends it after two probes, it answers "fully visible" with the row still cut by 71–75 px (intermittent)

Lab note LV2. **Measured 2026-10-16** on the dedicated `averi_lab` AVD (`emulator-5554`, Android 13 / API 33,
1080x2220, gesture navigation), averi = `arch/round-20`'s `src/` (`debc9b2`) and, for the note's fix, the calibration
checkout of `9c7885e`, through the live golden (`scripts/truth/live.ts --serial emulator-5554 --groups visibility
--cells scroll-bounded-flush [--side …]`), the lab app's `scroll-bounded-flush` cell (Edges.kt, round 3: rows whose
identified container is not clickable, so uiautomator cuts their bounds flush with the container's edge). The app's
scroll offset, stroke log and frames (LabState.offsets, .strokes, .frames — round 4) are the oracle. Summaries:
docs/truth/live-android-2026-10-16-visibility.md (the debc9b2 run, appendix), docs/truth/live-calibration-2026-10-16.md
(every #12 run, the 9c7885e one above included).

## Status

**Fixed** at `ae4d988a`, refined by its code review (`c2af22de`, `1126ca60`: the proof kept while the row lies flush on
that edge, so no read claims it fully visible; bugs/r1023-lv2; ADR 0013, refined 2026-10-23), measured live on
`averi_lab` in eight runs of eight — the cell five times and the visibility group once at `ae4d988a`, the cell twice
more at the branch's tip `55b71635` (docs/truth/live-records/android-vis-r1023-lv2-1…7.json, -group.json;
docs/truth/live-android-2026-10-18-visibility.md, its round-1023 LV2 section): a probe after whose read the row moved and lies flush on the same edge with more of it showing has proved the
cut — no confirming read, and the next stroke is a REVEAL, the whole stroke with its travel half the room the row
leaves in its container (capped at a top or left edge, where a pull-to-refresh lies); at the bound the call fails
naming the cut, never "fully visible". S.fully: `fully visible after 2 swipes` every run, `lower` 0→58–61 then
→287–296 (S whole at 1223–1231, Tapped), 12.6 s from the first touch to the tap at `ae4d988a` where the committed runs
before took 17.6–19.6 s; P.fully `after 1 swipe` as before. Correction to the Cause below: the probe's finger travel on `lower` is
74 px (0.25 of the full stroke's 297 over the 495-px container), not 178 — the cap is never reached there; and a
probe round costs ~5.1 s (two reads when it moves the row).

## Observed (measured)

S: a 300x64-dp row (825x176 px) in `lower` (clip 0,1046 1080x495), 22 px of it showing above the clip's bottom
(1519–1541) — its node cut flush there. `fully: true` must scroll it 154 px up.

```
scroll_until { selector: 'id:"lab.scroll-bounded-flush.S"', direction: 'down', fully: true }       (debc9b2)
→ Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes; but its bottom edge lies on its scroll
  container's (0,1046 1080x495), where Android cuts a node's bounds to the container, and no swipe or time was left to
  check it — it may be cut there, a rect assert or screenshot may measure part of it
app: S 128,1440 825x176 (partly-centre-in: its bottom 1616, 75 px — 43 % of it — below the clip's 1541); lower offset 79;
     strokes lower 0→21, 21→79
```

At `9c7885e` (the fix of docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md,
calibration.json #12): the same reply, the strokes `lower 0→38, 38→83` (S at 1436: 71 px below the clip). In the other
committed runs the call went on to a whole row — three probes of 57–61 px, `fully visible after 3 swipes` — so the
outcome depends on how far each probe happens to move the list and how much time each round takes: S.fully ended cut in
one of five committed runs at `9c7885e` and in one of three at `debc9b2`. P (cut by 66 px in `upper`) was revealed by
one probe (79–82 px) in every committed run.

## Cause (src/interact/scroll-rounds.ts#PROBE_REACH; not changed here)

The flush probe is drawn short on purpose — `PROBE_REACH` 0.25 of the stroke reach, at most
`PROBE_MAX_TRAVEL_FRACTION` of the long side (178 px of finger travel on this screen) — "a cut larger than that is left
flush again and probed again". On the device the list moves far less than the finger: Compose's touch slop and a slow
drag's lack of fling leave 21–61 px per probe of S in the committed runs. Each probe round also costs a settle, a confirming read and Android's
keyboard witness; after two probes the budget is gone — inferred, not timed: 2 of the 6 default swipes were spent,
so it is the time budget (`timeoutMs`, 15 s) — and the stop is reported with
`flush.checked: false` — "fully visible … it may be cut there". The row is still cut by 71–75 px.

## Why it matters

`fully: true` exists for the caller who will measure or screenshot the element next; a reply that leads with "fully
visible" on a row still cut by 40–43 % of its height defeats it, and the hedge is easy to miss. The note #12's contract —
"the `fully` stop goes on until the row is whole" — holds only for a cut shallow enough for one or two probes.

## Expected

The round's to choose: a probe sized from the cut it can see (the row's own size is known from an earlier read or from
its flush edge's travel between probes — the first probe's movement measures the list's response), or a probe that
falls back to a normal reach once one probe moved the row and it stayed flush, or a stop at the bound that fails
(`fully` not reached) instead of leading with "fully visible".

## Notes

- Live only: a replayed tree never moves (golden's R-fully accepts the probed flush stop where the truth bears the
  probe's direction out — rows.ts#flushProbe). Listed in scripts/truth/calibration.json `excluded`; #12's `live` entry
  cites it.
