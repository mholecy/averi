# BUG: under WDA, `scroll_until` for a row far down a short (180-pt) scroll view carries the list past it with momentum, turns once at the last swipe, and fails at maxSwipes with the row 18 % drawn — one run in three

> **Status (2026-10-17):** open, intermittent; measured live only. An honest failure (LOUD: averi says it did not
> reach the row), filed because the case's KNOWN entry (LE4's, R-direction) no longer explains it. KNOWN as this note,
> `intermittent` (scripts/truth/live-known.ts, `ios wda scroll:scroll-bounded.F`, not-reached on `refused`).

Lab note LV5. **Found 2026-10-17** by round 5's device check: the live golden (`scripts/truth/live.ts --udid
<averi-lab iPhone 17> --sources idb,wda --groups visibility,dismissal --record …`, then `--sources wda --cells
scroll-bounded` twice) on the `averi-lab iPhone 17` simulator (iOS 27.0, 402x874), averi = `arch/round-21`'s `src/`
(`b71cbbb`, from truth/phase-3 `2725e76`), WDA on port 8120. Records: docs/truth/live-records/ios-vis.json (the
failing run) and ios-scroll-bounded-wda-2725e76-1.json, -2.json (two ok runs). Summary:
docs/truth/live-ios-2026-10-17-visibility.md.

LE4's fix holds here: every stroke touches down inside `lower` (at debc9b2 they touched down at y 699, below it, and
moved nothing). What is left is the strokes' reach in a scroll view this short.

## Observed (measured, WDA)

`scroll-bounded`: `lower`, clip 0,380 402x180, at offset 0; F at content y 1380 — whole in `lower` only while the
offset lies in 884–1000 (a 116-pt window). One stroke (`201 524 → 416`, a 108-pt drag) moves `lower` about 259 pt
(O's case: 0→258.7); the app logs the strokes sent while it still decelerates as one.

```
run 1 (ios-vis.json)  touches (201,524) ×4, (201,525), (201,416)   strokes lower 0→1052.3 (one)   F 51,327.7 (18 % drawn)
→ ERROR scroll_until id:"lab.scroll-bounded.F" failed after 6 swipes (maxSwipes) — element reached the viewport but
  stayed CLIPPED at top, 18% of it is in the viewport (last rect {"x":51,"y":327,"width":300,"height":65}). It was
  turned round 1 time: a swipe carried it past the viewport (a fling), …, so the next was drawn the other way
→ tap: ERROR … is outside its scroll view scrollable (0,380 402x180) … only 18% of it … is drawn … nothing was tapped
run 2  touches (201,524) ×4, then the tap (201,506)   lower 0→906.3   F 51,473.7 whole   "fully visible after 4 swipes; still moving at the last read"; Tapped, fired
run 3  touches (201,524) ×4, then the tap (201,483)   lower 0→929.3   F 51,450.7 whole   the same
```

Run 1 went past the window (to 1052, F above `lower`'s top), turned once with the sixth and last swipe, and ran out of
swipes with F cut. The reply says so: no false claim.

## Cause (inferred)

Each stroke's momentum carries the list about two and a half times F's window, so where the forward strokes stop is
a matter of the fling's timing; the turn comes at the budget's end, and the halved reach after it has no swipe left.

## Expected (the owner's choice)

Strokes in a short scroll view that can land a row in it — shorter or slower (no fling) once the target is in the
tree and near, or a turn that is not the budget's last swipe; or accept it as scroll dynamics (a residual), the case
staying KNOWN and intermittent.

## Notes

- Live only (a replayed tree never moves). Listed in scripts/truth/calibration.json `excluded`.
- Related: docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md (a fling past the target in a lazy
  list), docs/bugs/2026-10-09-android-scroll-until-default-budget-too-short-at-drag-speed.md (Android's budget).
