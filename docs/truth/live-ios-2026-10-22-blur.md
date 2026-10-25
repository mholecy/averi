<!-- The live golden on iOS, round 16's in-window backdrop (ADR 0018 residual 9, calibration.json #31; branch
bugs/r16-blur from bugs/round-16 4ee14f1c), 2026-10-22: the averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0,
402x874), WDA on port 8120 from the lab's own derived data (averi-wda-lab), idb's companion of the run's own (gRPC
10894, for the taps and strokes). averi = bugs/r16-blur 7fd1ee57's src; the lab app built from this branch (5f33c100:
Presented.swift's blur-menu-stacked and blur-menu-unhidden, FalseCovers.swift's tap-catcher cells), rebuilt and
installed before each run. Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --wda-port 8120 --sources wda --groups visibility \
    --cells blur-menu-grouped,blur-menu-stacked,blur-menu-unhidden [--record <file>]
Records (docs/truth/live-records, rejudged by tests/truth/live-rejudge.test.ts): ios-vis-r16-blur-1.json, -2.json; at the
merge (§3) ios-vis-r16-merge-1.json, -2.json; the feeler (§4) ios-vis-r16-r6-1.json, -2.json, ios-idb-sheet-r16-r6-1…3.json;
NI1 (§5) ios-vis-r1023-ni1-1.json, ios-vis-r1023-ni1-wda-1.json.
The previous iOS runs: docs/truth/live-ios-2026-10-19-lab-fixes.md, live-ios-2026-10-18-visibility.md. -->

# What round 16's in-window backdrop measured

## 1. The probes: the order WDA lists a backdrop in

Captured raw on the lab simulator (tests/fixtures/truth/ios-iphone17-ios27, commit 5f33c100):

| cell | declared | WDA lists (same top 0,0 402x874) |
|---|---|---|
| blur-menu-grouped | card, backdrop, screen beneath (zIndex 2, 1, 0) | screen beneath, backdrop (`0/0`), card |
| blur-menu-stacked | screen beneath, backdrop, card (no zIndex) | screen beneath, backdrop (`0/0`), card |
| blur-menu-unhidden | as grouped, backdrop not `.accessibilityHidden` | screen beneath (now wholly `isVisible=0`), backdrop (`1/1`), card |
| tap-catcher-beneath | content container, tap-catcher as its `.background` | tap-catcher (`0/0`), content |
| tap-catcher-stacked | tap-catcher, content container (ZStack) | tap-catcher (`0/0`), content |

Siblings of the same top are listed in the order they are drawn, not declared. idb lists no trace of the hidden backdrop
(blur-menu-unhidden: an unlabelled `GenericElement 0,0 402x874` between W and A).

## 2. Live, WDA: the three grouped blur menus, twice

30 cases a run, 30 ok in each (ios-vis-r16-blur-1.json, -2.json):

- A, B, C, D of each cell: `tap` refused — `… is under container (0,0 402x874) at its centre …, drawn over it; nothing
  of it shows — a screen is presented over it (a modal or a sheet) — close it first; … nothing was tapped` (C's names
  the menu row W, drawn over its centre); nothing fired, no `dismissed menu`. `scroll_until` stopped before any swipe,
  nothing stroked or dismissed.
- K and W (the menu's rows): `Tapped`, each alone fired.

Struck off live-known.ts: WDA's tap and scroll cases of blur-menu-grouped's A, B, D, and its C's scroll case (three
strokes on the blur before). Under idb they stand (ADR 0018 residual 9).

## 3. Round 16 merge, 2026-10-22: LE2's rest beside the in-window backdrop

bugs/round-16 at `4f48c642` (the merge `907433f2` of bugs/r16-le2 into the backdrop's branch, its interaction fix
`b1457d38`), run from that worktree; the lab app built from it (xcodegen + xcodebuild) and installed before the runs.
The averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0, 402x874), WDA on 8120 from the lab's own derived data, idb
through a companion of this run's own on gRPC 10961 (`IDB_COMPANION=localhost:10961`), killed by its PID; the
simulator shut down after. Reproduce (outside the sandbox):
`node --import tsx scripts/truth/live.ts --udid <lab simulator> --wda-port 8120 --sources idb,wda --groups visibility
--cells chooser-over-list,blur-menu-grouped,blur-menu-stacked,blur-menu-unhidden,scroll-bounded-footer --record <file>`.

| record (docs/truth/live-records/) | src | cases | ok | loud | mismatches |
|---|---|---|---|---|---|
| ios-vis-r16-merge-1.json | 4f48c642 | 72 | 51 | 1 | 20 (all known) |
| ios-vis-r16-merge-2.json | 4f48c642 | 72 | 51 | 1 | 20 (all known) |

- **The one device call the merge changed — chooser-over-list's R under WDA**: `scroll_until R` refused before any
  swipe, "under button "SWIFT payment" (45,453 312x52) at its centre (201,461), drawn over it — 0% of it shows — a
  menu's backdrop is presented over it … close it first"; the app logged no stroke, nothing fired, nothing dismissed —
  in both runs (bugs/r16-le2 alone stroked the dim three times, 175, 175, 699: ios-vis-r16-le2-2.json, -3.json). Its
  `tap R` refused the same way. Struck off live-known.ts: `ios wda scroll:chooser-over-list.R`.
- **WDA, the rest**: the three grouped blur menus as in §2 (A–D refused "close it first", nothing fired or stroked; K,
  W Tapped, each alone fired); chooser-over-list's O and S Tapped, each alone fired; scroll-bounded-footer's tap of O
  refused outside its scroll view, its `scroll_until` reached O after 2 swipes (lower 0→233, O whole, "fully
  visible"; 0→240.7, O partly-centre-in, "visible") and Tapped O — the intermittent entry not hit.
- **idb**: blur-menu-grouped, -stacked and -unhidden's A, B, D each `Tapped` and the menu dismissed, their
  `scroll_until` "fully visible after 0 swipes" — ADR 0018 residual 9 (idb lists no trace of the backdrop). The
  stacked and unhidden cells ran under idb live for the first time here; their six cases each are filed with the
  grouped one's as that residual (live-known.ts; golden-known alike, presented.known.ts). C refused under W, seen so; K
  and W Tapped. chooser-over-list: S refused (LOUD, ADR 0015's 2026-10-22 residual), O Tapped, R refused, nothing
  stroked. scroll-bounded-footer's O as LE2's records: the tap moved clear of Continue to (201,670), no button logged;
  `scroll_until` refused before any swipe; both Tapped on the background by the taps that follow (ADR 0010 residual 5).

## 4. Round 16, the feeler (open-bugs #9, ADR 0018 residual 6), 2026-10-22

bugs/r16-r6 at `4ad446f5`'s src (from bugs/round-16 `da68586f`; ADR 0018, "idb's presented layer", Decision 3), run
from that worktree; the lab app built from it and installed before the runs; the averi-lab iPhone 17 simulator
(3AB1E82E, iOS 27.0), idb through a companion of this run's own on gRPC 10971 (`IDB_COMPANION=localhost:10971`),
killed by its PID; the simulator shut down after. (A first attempt read every tree as "The simulator's accessibility
service named no frontmost application" and was discarded, its record not kept: knowing no tree, its `scroll_until`
calls stroked FULL and blind — six strokes in sheet-background's A and B — and dismissed the sheet. The simulator
rebooted, every later read read. That attempt is the evidence for the code review's fix, `CallEvidence`'s `unread`: no
stroke before a read of the call has read — tests only, not run live.) Reproduce
(outside the sandbox):
`node --import tsx scripts/truth/live.ts --udid <lab simulator> --wda-port 8120 --sources idb --groups visibility
--cells sheet-background,alert-dim,dim-cover,scroll-top-edge,tabbar-dense,tabbar-floating,carousel-in-list --record <file>`.

| record (docs/truth/live-records/) | src | cases | ok | loud | mismatches |
|---|---|---|---|---|---|
| ios-vis-r16-r6-1.json | 4ad446f5 | 47 | 34 | 0 | 13 (all known) |
| ios-vis-r16-r6-2.json | 4ad446f5 | 47 | 34 | 0 | 13 (all known) |
| ios-idb-sheet-r16-r6-1…3.json (`--cases scroll:sheet-background.A,scroll:sheet-background.B`) | 4ad446f5 | 2 each | 0 | 0 | 2 (known) |

- **The threshold, measured first** (`idb ui swipe 201 175 201 175+t --duration d` on sheet-background, two strokes
  400 ms apart, three tries each, the app's own log): the large sheet sprang back from 120–350 pt at 600 and 900 ms,
  120–300 pt at 300 ms and 160 pt at 200 ms, every try; dismissed by 400 pt at 900 ms, 200 pt at 150 ms and the full
  524 pt at 300 ms, every try. The feeler: 160 pt over 600 ms.
- **sheet-background's A and B** (content above): two feelers from (201,175), the app logging two touches and nothing
  dismissed — in all five runs (the two cell runs and the three alone); the reply the unmoved stop, "… or the swipes were
  not taken — idb lists only what a presented sheet, alert or cover leaves to accessibility, nothing beneath it: if one
  is up, close it first) — element never appeared in the tree …". (The note's words since changed, after these runs, to "…leaves to accessibility: if the element lies beneath
  one, close it first" — the words only; the strokes and the stop the same.) `presented-stroke` on `not found` (residual 6, known;
  live-known.ts re-filed them with C, D and the alert's and cover's, no longer the loud `presented-changed` after a
  dismissal). Before (round 7 to `da68586f`): the full stroke dismissed the sheet every run.
- **alert-dim, dim-cover (A–D), sheet-background C and D**: two strokes on the layer, nothing dismissed, as before (A
  and B as feelers now), each unmoved stop with the note. Their taps refused (timed out), S Tapped.
- **The cost on the content-up cases** (scroll-top-edge, tabbar-dense, tabbar-floating, carousel-in-list: 21 cases,
  timed runs of the four cells alternating base `da68586f` and this branch, two each; timed from the run logs, those four records not kept): wall time 197 s and 195 s
  against 199 s and 198 s — within run-to-run noise; the swipes per case the same spread (scroll-top-edge T 5 and 2 at
  the base, 5 and 5 here; tabbar-floating R 4 and 5 at the base, 5 and 5 here; every other case equal). No feeler is
  sent there: idb lists every node of the app's hierarchy, on the screen or not (scroll-top-edge's A at y −282,
  carousel-in-list's U at −200), so the target is seen at the first read. A feeler costs a call one short stroke
  (160 pt, 300 ms slower) only where idb has not listed the target before the first stroke.

## 5. Round 1023, NI1: an idb read that lists no identifier (ADR 0018's amendment, residual 20), 2026-10-23

bugs/r1023-ni1 at `2c2f566`'s src (from bugs/round-1023 `a0463c6b`), run from that worktree; the lab app as installed
on 2026-10-22 (no app source changed since `907433f2`); the averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0), idb
through a companion of this run's own on gRPC 10991 (`IDB_COMPANION=localhost:10991`), killed by its PID; WDA on 8120
for the control; the simulator shut down after. Reproduce (outside the sandbox):
`node --import tsx scripts/truth/live.ts --udid <lab simulator> --wda-port 8120 --sources idb --groups visibility
--cells sheet-long-list,sheet-long-list-short --record <file>` (and `--sources wda` for the control).

| record (docs/truth/live-records/) | src | source | cases | ok | loud | mismatches |
|---|---|---|---|---|---|---|
| ios-vis-r1023-ni1-1.json | 2c2f566 | idb | 8 | 5 | 3 (known: residual 20) | 0 |
| ios-vis-r1023-ni1-wda-1.json | 2c2f566 | wda | 9 | 9 | 0 | 0 |

- **R's taps under idb** (`tap:sheet-long-list.R`, `tap:sheet-long-list-short.R`): refused, nothing fired, the reply
  `Timed out after 5000ms waiting for element id:"lab.sheet-long-list.R" to appear` with, beneath it, `(no tree read
  contained id:"lab.sheet-long-list.R", and idb lists no accessibility identifier on any element of the screen — it
  drops some, a UIKit table cell label's among them. If the screen is showing, ask for it by text: or label:, or set
  app.ios.treeSource: wda in averi.yaml)` (the note's words at `2c2f566`; reworded at `1cecfaf` to name every reason
  idb gives and shortened at `75d6c07`, ADR 0018's amendment — the replay measures the words, live judges none). ok because the live judge no
  longer asks a target its source does not list to fire — a change of the judge, which rejudges every earlier record's
  same refusal ok too (before: LOUD `tap-refused`, filed under NI1); what the src changed live is the note beneath.
- **F, L and short F under idb**: not reached, honest, the strokes the same as before (F 6 swipes, L 5, short F 3,
  every touch-down at (201,699), nothing fired), each stop's "element never appeared in the tree" now with the new
  note; LOUD `not-reached`, known (ADR 0018 residual 20: `scroll_until` still strokes for a target idb never lists).
  Their taps refused with the note too.
- **WDA, the control**: every case ok — R Tapped in both cells, F, L and short F reached and then Tapped, L's carry
  case reached; WDA lists the identifiers, so nothing of the new note is said there.


## 6. Round 9, a list's end that rebounds (ADR 0021 decision 6), 2026-10-25

The new case `absent:scroll-top-edge-end` (live-visibility.ts#ABSENT_AT_END): `scroll_until` for a row the cell does
not have, `down` into scroll-top-edge-end's page, which rests at its end — docs/bugs/2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md.

- **Before, main's src (265a2bb4 through `--side`)**: under idb "failed after 3 swipes … — if it lies above, try
  direction: "up"" (the first stroke's read put A at -283 where it rested at -282: the exact fingerprint read the point
  as motion), under WDA "failed after 6 swipes (maxSwipes)" — both `end-unread`
  (docs/truth/live-records/ios-vis-r9-absent-before.json).
- **After, fix/round-9**: under idb and WDA "failed after 2 swipes (the last 2, swiping down, did not change the screen
  …)", nothing fired, the app's page unmoved at 382 — three runs (ios-vis-r9-absent-1.json, -2.json, -3.json, the last
  after the review's fixes).
- **Settings › General, traced by hand under idb** (the note's own screen, at the end): "failed after 2 swipes", each
  read ~1.2 s after its stroke, `About` 247 → 246 → 246. No read was caught inside the bounce in any run: the settled
  read of decision 6 is proven by the tests alone; what made today's runs green is the tree's within-a-point test.
