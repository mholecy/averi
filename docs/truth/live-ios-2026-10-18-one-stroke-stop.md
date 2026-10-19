<!-- Round 7 task A1 (arch/r23-ios-stop), 2026-10-18: the live golden on the averi-lab iPhone 17 simulator (3AB1E82E,
iOS 27.0, 402x874), WDA on port 8120 in the lab's own derived data, idb through a companion of this run's own on
port 10882 (IDB_COMPANION; the one left from an earlier boot answered every HID event "dtuhidd connection
invalidated"), the iOS lab app as round 6 installed it; harness truth/round-7 e856afc, averi `--side` this branch's
src (e687fe83's, with an uncommitted stderr trace of averi's reads per round that changes no step). A dated section
for docs/truth/live-ios-2026-10-18-visibility.md, kept beside it until the harness branch merges it.
Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources wda --groups visibility --cases turn:scroll-bounded.F,scroll:carousel-in-list.C --side <this checkout> --record <file>
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources idb,wda --groups visibility --side <this checkout> --record <file> -->

# The one-stroke stop and the carousel (round 7, A1)

## Diagnosis (a trace of averi's reads per round, before the fix: 565bcb9's src)

- `turn:scroll-bounded.F`, two runs: F read 51,1380 300x64 at launch; after each stroke up at `lower`'s top
  51,1381 300x64, 51,1380 300x65, 51,1381 300x64, 51,1381 300x64 (run 1: the proof on the 4th, `failed after 6 swipes
  (maxSwipes)`) and 300x65, 300x65 (run 2: the proof on the 2nd). `lower`'s content 0,380 402x1300 read 0,381 402x1300
  or 0,380 402x1301 — WDA rounding a list resting a fraction of a point off its top; never more than a point, ~1.1 s
  after the stroke. "Unmoved" forgave under one unit.
- `scroll:carousel-in-list.C`, two runs: one stroke `307 181 → 95 181`; C at x 7, −47, −68, −76 (at rest −75.7, the
  carousel at 453.7) and −16, −82, −106, −116 (at rest −117, 495) — still moving at the third confirming read, the stop
  claimed `visible … 72% / 60% … still moving at the last read`.

## After (e687fe83): 4 runs of each, records ios-wda-stop-carousel-r23-1…4.json

| run | turn:scroll-bounded.F | scroll:carousel-in-list.C |
|---|---|---|
| 1 | `lower 0→0, 0→943.7`; `fully visible after 5 swipes; 1 swipe up did not move scrollable (0,380 402x180) — …turned down`; Tapped | `307 181 → 181 181`; carousel 0→289; `visible after 1 swipe — CLIPPED at right, 82%`, settled; Tapped |
| 2 | `0→0, 0→974.3`; the same reply; Tapped | 0→317; 90%, settled; Tapped |
| 3 | `0→0, 0→1008.7`; `visible after 5 swipes — CLIPPED at top, 86%; 1 swipe up did not move …`; Tapped (F 8.7 past its window: LV5's spread) | 0→315; 89%, settled; Tapped |
| 4 | `0→0, 0→943.7`; `fully visible after 5 swipes; 1 swipe up …`; Tapped | 0→283.3; 80%, settled; Tapped |

Every turn after exactly ONE unmoved stroke (the read after it within a point: 51,1381 300x64 or 51,1380 300x65).
Every carousel stop on two agreeing reads (C moving e.g. 44, 17, 5, then 0 pt), the first stroke 126 pt (carry
2.25–2.52 a point, as the full stroke's 2.1–2.5). Both KNOWN entries (`ios wda turn:scroll-bounded.F`,
`ios wda scroll:carousel-in-list.C`) read ok in every run: the harness's to strike.

## The visibility group (no regression)

`--sources idb,wda --groups visibility` at e687fe83's src (the first-stroke cut not yet floored; record
ios-vis-r23-ios-stop-e687fe83.json): **287 cases, 219 ok, 5 loud, 63 mismatches (0 not known)** against round 6's
ios-vis.json rejudged with the same groups: 287 / 218 / 5 / 64. One case changed outcome: `wda turn:scroll-bounded.F`
MISMATCH (R-direction) → ok. Replies that changed under WDA, outcomes the same: "still moving at the last read" gone
from scroll-bounded P (fully, 3 → 1 swipe), F, the turn case, carousel B, tabbar-floating R (the slowing fling waited
out); scroll-bounded S 2 → 1 swipe, O and sheet-long-list-short F now "fully visible"; sheet-long-list F now "PARTLY
UNDER Row 21, 98%" (as round 5 read it); carry Row30 unchanged (LV6). One got worse — scroll-bounded S `fully: true`,
2 → 4 swipes: its first stroke, cut to 41 pt by the unmeasured carry, carried `lower` 36 pt (0.9 a point), and the 0.9
then measured sent the next stroke past S's window and back. Fixed at 659fdf00 (UNMEASURED_MIN_DRAG: no unmeasured cut
under 108 pt, the shortest drag measured): S's first stroke is the full one again.

After the floor (659fdf00, 2026-10-19, `--sources wda --groups visibility --cells scroll-bounded,carousel-in-list,
sheet-long-list,sheet-long-list-short,tabbar-floating`, the lab app as truth/round-7's T3 had reinstalled it, record
ios-wda-scroll-cells-659fdf00.json): 32 cases, 30 ok, 2 mismatches (0 not known — sheet-long-list L's two, LV6's
parked rows). `turn:scroll-bounded.F` "fully visible after 5 swipes; 1 swipe up did not move …" (a fifth run, one
stroke); carousel C `visible after 1 swipe — CLIPPED at right, 84%`, settled; S `fully: true` first stroke the full
108 pt again (`lower 0→190.3`, past the window, turned back to 147: 3 swipes — the full stroke's own spread; round 6
read 2 at 0→170); no "still moving" in any reply.

## The keyboard forms (review round 1, MAJOR-1; 2026-10-19, merged src 0eb344b5 against arch/round-23 e0452376)

The first-stroke cut changes the replayed first stroke of every WDA keyboard-form scroll (form-keyboard vs/ks/ss/note
310 → 108–188 pt, toolbar-dismiss -bar/-short 344 → 108–211). Measured live, the lab app built from truth/round-7
5c711585's fixtures, both srcs as `--side`:
- `--sources wda --groups forms` (records ios-wda-forms-r23-ios-stop.json, ios-wda-forms-r23.json): 23 cases, 18 ok,
  5 loud, 0 mismatches at both; every reply the same (b1d, b7 differ in a timestamp only).
- No live case scrolls those cells (k7, the phone scroll, is Android's), so five probes ran from a scratch copy of the
  harness (`scroll_until` vs, ks, ss, note, submit on form-keyboard, the keyboard up; not committed to the harness),
  twice at each src (ios-wda-kbscroll-{r23-ios-stop,r23}-{1,2}.json): `fully visible after 1 swipe` for vs, ks, ss,
  note and `after 0 swipes` for submit, the same at both srcs, every run — no extra stroke, no turn.
- The visibility cells whose replayed first stroke changed (form-keyboard, toolbar-dismiss*, scroll-top-edge*,
  sheet-long-list-short; ios-wda-cut-cells-*.json): 16 cases, 16 ok at both, the same swipe counts.
The prior is kept as it is: no measured case needs more strokes under it.
