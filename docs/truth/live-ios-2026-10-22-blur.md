<!-- The live golden on iOS, round 16's in-window backdrop (ADR 0018 residual 9, calibration.json #31; branch
bugs/r16-blur from bugs/round-16 4ee14f1c), 2026-10-22: the averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0,
402x874), WDA on port 8120 from the lab's own derived data (averi-wda-lab), idb's companion of the run's own (gRPC
10894, for the taps and strokes). averi = bugs/r16-blur 7fd1ee57's src; the lab app built from this branch (5f33c100:
Presented.swift's blur-menu-stacked and blur-menu-unhidden, FalseCovers.swift's tap-catcher cells), rebuilt and
installed before each run. Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --wda-port 8120 --sources wda --groups visibility \
    --cells blur-menu-grouped,blur-menu-stacked,blur-menu-unhidden [--record <file>]
Records (docs/truth/live-records, rejudged by tests/truth/live-rejudge.test.ts): ios-vis-r16-blur-1.json, -2.json.
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
