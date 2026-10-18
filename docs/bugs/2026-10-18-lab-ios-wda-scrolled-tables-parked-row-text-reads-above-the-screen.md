# BUG: under WDA, once a UIKit table has scrolled, the text of a row below the fold is parked ABOVE the screen — averi reads the row there, strokes away from it and turns until the budget runs out

> **Status (2026-10-18):** open; measured live only (round 6's iOS device check). KNOWN as this note
> (scripts/truth/live-known.ts, `ios wda carry:sheet-long-list.Row30`). Not a carry-model fault (ADR 0021 decision 4):
> the carry case was built to measure that model, and this defect comes first — averi never sees where the row is.

Lab note LV6. **Found 2026-10-18** by round 6's iOS device check: the live golden's new long-list carry case
(scripts/truth/live-visibility.ts#CARRY: `scroll_until text:"Row 30"`, `down`, on `sheet-long-list`) on the
`averi-lab iPhone 17` simulator (iOS 27.0, 402x874), WDA 16.1.7 on port 8120, averi = truth/round-6's src (`11683c3`).
Summary: docs/truth/live-ios-2026-10-18-visibility.md.

## Observed (measured, WDA)

`sheet-long-list`: a UITableView of 40 rows, 64 pt each, in a large sheet, its clip 0,62 402x812; Row 30 at content y
1920 (whole over offsets 1172–1748). WDA lists every row, those below the fold too — the `Cell` at its true rect, its
`StaticText` (`isVisible "0"`) at a PARKED frame. Three raw reads (`/source`, the table moved by `idb ui swipe 201 712
201 604` between them; tests/fixtures/wda-capture-lab-sheet-long-list-scrolled-273.json and -522.json):

```
offset    Row 30's text           Row 30's Cell        Target F's text (row 20)
0         0,62 402x64    vis 0    0,1982 402x64        0,62    vis 0   (cell 0,1342)
273.3     0,-212 402x65  vis 0    0,1708 402x65        0,-212  vis 0   (cell 0,1068)
522       0,-460 402x64  vis 0    0,1460 402x64        0,820   vis 1   (laid out: on screen)
```

The parked frame is the sheet's origin moved by the table's offset (62 − offset), not the origin: at rest it lies
inside the table's clip, once the table has scrolled it lies above the screen.

The live case (one call, six swipes; the app's touch log and strokes):

```
touches (201,712) (201,224) (201,224) (201,712) (201,224) (201,224)
strokes list 0→0 (the first down stroke and the two turned up after it, merged), 0→241, 241→190.3
→ ERROR scroll_until text:"Row 30" failed after 6 swipes (maxSwipes) — element in tree but never intersected the
  402x874 viewport (last rect {"x":0,"y":-129,"width":402,"height":65}). It was turned round 3 times: a swipe carried
  it past the viewport (a fling), or it lay at the edge the swipes push it out through, so the next was drawn the other
  way
```

The last rect is the parked frame at offset 190 (62 − 190 ≈ −129): the app lays Row 30 out at 0,1792. The first
stroke down moved the table ~1040 pt (F's own case, the same stroke: `list 0→1039.7`); the next read placed Row 30
above the screen, so averi turned up, and kept turning.

## Cause

src/adapters/wda-source.ts#parkedIn (ADR 0019, docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md)
places a parked element at its cell only when the element shares area with the cell's scroll view — the measured
shape at rest (Contacts, the lab table at launch: parked at the origin, inside the viewport). Scrolled, the parked
frame lies above the scroll view, shares no area with it, and is taken at face value: a row below the fold reads as a
row above the screen. Identified elements are parked alike (Target F at −212 after 273 pt): any scroll_until toward
a row more than one stroke below the fold is misled, and a tap or assert on such a row after a scroll reads it above
the screen (refused off screen, the advice pointing up).

## Expected

The parked shape measured as WDA parks scrolled content too: an `isVisible "0"` element of a `Cell` that lies wholly
outside its scroll view, the element itself outside its cell, placed at the cell — whether its parked frame lies inside
the scroll view (at rest) or above it (scrolled: origin − offset). The owner's call whether the scroll view's shape
(which ADR 0019 added against the carousel's chips) keeps a narrower form: e.g. the element's frame at the scroll
view's top moved up by any amount, its x and size the cell's.

## Notes

- Live only so far: the golden captures each cell at launch (offset 0), where the shape holds. The two raw trees above
  are committed for the fix's unit test.
- ADR 0021 decision 4's long-list measurement waits on it: the carry case cannot judge the carry while averi misreads
  where the row is.
