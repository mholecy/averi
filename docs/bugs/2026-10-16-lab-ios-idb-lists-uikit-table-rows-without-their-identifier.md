# BUG (tree source, diagnostics): under idb, a UIKit table row's label is listed without its accessibility identifier — `tap` and `scroll_until` by that id time out "to appear" on a row idb lists by its text, and the reply never says why

**Found 2026-10-16** by the live golden (scripts/truth/live.ts, phase 5) and the golden mode over the iOS lab app's
ground truth (`tests/fixtures/truth/ios-iphone17-ios27/sheet-long-list*.idb.json`, captured by scripts/truth/capture.ts
on the dedicated `averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `src/` at `debc9b2`.
Measured on the device (the live run of review round 1, `docs/truth/live-records/ios-vis.json` as a51ab1b committed
it; round 5's re-record at `b71cbbb`, which replaced it — kept as `ios-vis-2725e76.json` since round 6's iOS check
replaced it in turn — reads the same) and in the committed
captures; no averi code changed here.

## The screen

`sheet-long-list` and `sheet-long-list-short` (fixtures/apps/ios/AveriLab/Presented.swift#LongListController): a large
sheet holding a `UITableViewController`, 40 rows of 64 pt; the target rows' `UILabel` fills its cell and carries
`label.accessibilityIdentifier = "lab.<cell>.<tag>"` and the text `Target <tag>`. R is row 1 (`0,126 402x64`, on the
screen and drawn); F lies below the fold (sheet-long-list) or below the table's clip (sheet-long-list-short).

## Observed (measured)

The two tree sources of the same screen, at the same moment (the capture reads both):

```
sheet-long-list-short.wda.json  StaticText label "Target R"  name/rawIdentifier "lab.sheet-long-list-short.R"  rect 0,126 402x64
sheet-long-list-short.idb.json  StaticText AXLabel "Target R"  AXUniqueId null                                frame 0,126 402x64
```

Every row of the table under idb has `AXUniqueId: null` (`Row 0` … `Row 12`, `Target R`), while WDA lists the targets'
identifiers. The app sets the identifier (WDA reads it from the same process); idb's accessibility listing drops it.
The live golden, under idb (`live-records/ios-vis.json` as a51ab1b committed it, review round 1's run):

```
idb  tap { selector: 'id:"lab.sheet-long-list.R"' }
→ ERROR Timed out after 5000ms waiting for element id:"lab.sheet-long-list.R" to appear
idb  tap { selector: 'id:"lab.sheet-long-list-short.R"' }
→ ERROR Timed out after 5000ms waiting for element id:"lab.sheet-long-list-short.R" to appear
idb  scroll_until { selector: 'id:"lab.sheet-long-list-short.F"', direction: "down" }
→ ERROR scroll_until id:"lab.sheet-long-list-short.F" failed after 3 swipes (the last 2, swiping down, did not change
  the screen: …) — element never appeared in the tree — if it lies above, try direction: "up"
  (the app logged three touches at (201,699), on the footer below the table — the WDA stroke of LE4)
```

R is on the screen, drawn, and listed by idb under its text: nothing averi does can find it by its id under idb. The
replies are honest (nothing was tapped, nothing claimed), but they say only that the element did not appear — the same
words as a slow screen or a wrong navigation step. The static golden pins the same rows
(tests/differential/golden/presented.known.ts: sheet-long-list(-short).idb.json R tap, colour, scroll_until).

## Expected

idb lists no identifier on these rows, so `id:` cannot find them there: a reply that says so, as a `wait` on an id idb
never lists does since `c5dd5eb` (docs/bugs/2026-10-06-wait-timeout-no-hint-for-ids-idb-cannot-see.md: `no tree read
contained id:… iOS treeSource: idb never exposes an identifier set on a container … set app.ios.treeSource: wda …`) —
here an identifier set on a UIKit table cell's label, not a container.

## Possible fix directions (owner's choice)

- Give `tap`, `scroll_until` and `assert` the hint `wait` has: under idb, an id no tree read contained is named as
  idb's limit, with `treeSource: wda` or a `text:` selector as the remedy.
- Or record it as a residual of the idb tree source (an ADR), the hint left to the docs.

The live golden keeps asking these targets by their id (a `text:` selector would test another thing): the cases stay
KNOWN under this note (scripts/truth/live-known.ts `NO_ID`) — `idb tap:sheet-long-list.R`,
`idb tap:sheet-long-list-short.R` (`tap-refused`) and `idb scroll:sheet-long-list-short.F` (`not-reached`).
