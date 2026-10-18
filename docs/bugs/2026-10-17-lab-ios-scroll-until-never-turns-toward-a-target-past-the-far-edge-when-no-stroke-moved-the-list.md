# BUG (or a decision to record): on iOS, `scroll_until` asked the wrong way for a row of a scroll view already at its end that way strokes three times, moves nothing, and fails with the right direction as advice — it never turns back toward the target the tree places past the far edge

> **Status (2026-10-18):** fixed under WDA at `b41d311` on `arch/r22-lv4` (from `arch/round-22` `b71cbbb`), the owner's (b)
> as decided on 2026-10-17; unmeasured on a device — the live KNOWN `ios wda turn:scroll-bounded.F` is the device
> check's to judge. The caller's direction is stroked first; the read after the one stroke up finds every match where
> it was and the tree listing `lower`'s content ending at its top (nothing of it above 380), so the content is PROVEN
> exhausted up (interact/scroll-rounds.ts#Observed.ends, stroke-plan.ts#strokedEnd, ui-tree/geometry.ts#Clips.endsAt),
> and F lies past `lower`'s far (bottom) edge inside it: the strokes turn once, down, at full reach, and the reply says
> so (`; 1 swipe up did not move scrollable (0,380 402x180) — the tree lists its content ending at its top — so averi
> turned down, as the tree places the element below it`; scroll-rounds.ts#EndTurn). Replayed over this cell's real WDA
> capture (tests/interact/scroll-end-turn.test.ts): strokes up, down, down … where three ups failed. Under idb nothing
> changes (no scroll view listed, LE2: `ios idb turn:scroll-bounded.F` stays KNOWN); nor on Android, whose tree cannot
> list where a list's content ends. Golden over truth/round-6 unchanged (1137/242/0, every row identical: the replay
> asks no wrong-way scroll).
>
> **Status (2026-10-17):** open; measured live only. The owner's call: averi's rule, or the live case's expectation.
> averi does what its scroll rounds say on purpose (see Cause): no turn without a sighting, and nothing guessed from a
> screen no stroke ever changed. The live golden's turn-back case (scripts/truth/live-visibility.ts#TURN_BACK,
> `scroll-bounded` F: "a stroke up moves nothing — turn back down") asks for the turn. Nothing was loosened: the case
> stays a MISMATCH, KNOWN as this note (scripts/truth/live-known.ts, `ios wda turn:scroll-bounded.F`).

Lab note LV4. **Found 2026-10-17** by round 5's device check: the live golden (`scripts/truth/live.ts --udid
<averi-lab iPhone 17> --sources idb,wda --groups visibility,dismissal --record …`) on the `averi-lab iPhone 17`
simulator (iOS 27.0, 402x874), averi = `arch/round-21`'s `src/` (`b71cbbb`, from truth/phase-3 `2725e76`), WDA on port
8120. Records: docs/truth/live-records/ios-vis.json and ios-scroll-bounded-wda-2725e76-1.json, -2.json (three runs, the
same in each). Summary: docs/truth/live-ios-2026-10-17-visibility.md.

The case was filed under LE4 (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md):
at `debc9b2` its strokes touched down in `upper`, beside F's scroll view. LE4's fix holds — the strokes now touch down
inside `lower` — and the case still fails, by the same rule on the same kind of reply: it was never LE4's.

## Observed (measured, WDA)

`scroll-bounded`: `lower` (clip 0,380 402x180) at offset 0, its top; F at its content y 1380, below the screen.

```
scroll_until { selector: 'id:"lab.scroll-bounded.F"', direction: 'up' }
→ ERROR scroll_until id:"lab.scroll-bounded.F" failed after 3 swipes (the last 2, swiping up, did not move it: content
  exhausted, or the swipes were not taken) — element in tree but never intersected the 402x874 viewport (last rect
  {"x":51,"y":1380,"width":300,"height":65}) — it lay below the viewport, past the edge the swipes push it out through:
  scroll_until it with direction: "down"
app: touches (201,416) ×3; strokes lower 0→0 ×3; F 51,1380 300x64 (off-screen); fired nothing
```

The reply is true and names the direction that reaches F. But no stroke brought F closer and none was turned back:
R-direction (golden-spec/rows.ts; live only).

Under idb the reply is the same; its strokes touch down at (201,175), in `upper` (idb lists no scroll view: LE2,
which files `ios idb turn:scroll-bounded.F`).

## Cause

src/interact/scroll-rounds.ts says it: a scroll that never found its target strokes the caller's way only — "a turn
needs a sighting"; a target read wholly beyond the far edge before any read saw it short is "the caller's direction to
honour" (`beyondFarEdgeIn`, "the owner's call, iOS parity"); and a failure that names where the target lies does so
only while no stroke went that way (`Shortfall`'s `past`). With a screen no stroke ever changed, "nothing is guessed".
So the strokes go up three times and the failure names `down`.

## Expected (the owner's choice)

- (a) The rule stands: record it as a residual, and the live case accepts a refusal that moved nothing and names the
  direction the tree places the target in (live-visibility.ts#TURN_BACK's expectation changes, with this note).
- (b) The case stands: when the strokes moved nothing and the tree places the target past the far edge (in the tree,
  never in the frame), turn once toward it, as the stuck turn does for a target held short in the frame.

## Notes

- Live only (R-direction is not asked by the replay). Listed in scripts/truth/calibration.json `excluded`.
- #17 (docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md) made the
  turn for a target SEEN in the status band (`turn:scroll-top-edge-end.T`, ok in this run); F here is never seen.
