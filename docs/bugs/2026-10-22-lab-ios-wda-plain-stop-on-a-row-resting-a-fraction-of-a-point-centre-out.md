# BUG (intermittent, low harm): under WDA, a plain `scroll_until` stops on a row whose centre rests a fraction of a point past its scroll view's clip, and calls it "visible … CLIPPED"

**Found 2026-10-22** by the live golden on the lab simulator (`averi-lab iPhone 17`, iOS 27.0, 402x874), in round 16's
code review of LE2's rest (bugs/r16-le2), record `docs/truth/live-records/ios-vis-r16-le2-2.json`. Not caused by that
fix: the same stroke and the same kind of stop come out of the src before it (`4ee14f1c`, run through `live.ts --side`).

> **Status (2026-10-22): open, filed KNOWN and intermittent** (`scripts/truth/live-known.ts`,
> `ios wda scroll:scroll-bounded-footer.O`, stop-claim on `visible`). Low harm: the reply says the row is clipped and by
> how much, and the tap that follows fires the row.

## The screen

`scroll-bounded-footer` (fixtures/apps/ios/AveriLab/EdgesFooter.swift): scroll-bounded's `lower` scroll view (clip
`0,380 402x180`), O at `51,620 300x64` in its content, a Continue button under the clip.

## Observed (measured)

`scroll_until id:"lab.scroll-bounded-footer.O" direction: down` under WDA strokes `lower` once; the fling carries its
content far enough that O rests clipped at the top, its centre inside the clip — "visible after 1 swipe — CLIPPED at
top, 54–83 %" in four runs at `cefccf3d`'s src (one committed, ios-vis-r16-le2-3.json; three unrecorded repeats of
the case), 78 % in one unrecorded `--side` run at `4ee14f1c` (whose other run took 2 swipes to "fully visible") — the
live judge's `ok`. Once, in the first run at `cefccf3d` (ios-vis-r16-le2-2.json), the stroke carried it 272.7 pt:

```
app:   O 51,347.3 300x64 — centre y 379.3, the clip's top 380: centre 0.7 pt outside (the truth's `centre-out`)
averi: Element id:"lab.scroll-bounded-footer.O" visible after 1 swipe — CLIPPED at top, 49% of it is in the viewport.
       A rect assert or screenshot on this element will measure the CLIPPED box
       Tapped id:"lab.scroll-bounded-footer.O"   (the app: touch 201,380 → tap O)
```

WDA lists frames in whole points (ADR 0021, "unmoved is within a point"), so a rest a third of a point either side of
the clip's line can read as the centre on it. The stop claims `visible` where the truth's strict centre lies outside;
the tap lands on the clip's top line, which hit-tests inside, and fires O.

## Why it matters

Diagnostics only, as measured: no wrong control fires, and the reply says the row is cut. A row whose centre is
deeper outside is not stopped on (the other runs). Fix only with a reason: the obvious remedy, another stroke when the
centre lies within a point of the clip's line, adds a stroke to a stop that worked.
