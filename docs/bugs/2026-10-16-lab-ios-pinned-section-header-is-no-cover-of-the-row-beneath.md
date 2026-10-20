# BUG: on iOS a SwiftUI pinned section header is no cover of the row it lies over — the tree lists the header BEFORE the rows, so the colour assert passes on a sample the header covers and `fully: true` calls the row "fully visible"

> **Status (2026-10-20, round 14): fixed** at `40b4856` (bugs/r14-le3, after the prep move `003edf31` that gave
> "listed before, but drawn over" one owner, `ui-tree/reading-order.ts`), measured by the golden mode (against
> `a922fec4`: the four rows below green, the two plain `scroll_until` rows still ok and worded "PARTLY UNDER … 63% of it
> shows, its centre clear", nothing else changed), calibrate (CALIBRATED, `003edf3` → `40b4856`) and the lab simulator
> (docs/truth/live-records/ios-vis-r14-le3-1.json, -2.json: six of six ok under idb and WDA, twice — R's `fully: true`
> strokes once, list 24 → 0, and stops on R whole at `51,166`). The parsers keep the Header trait as `UiNode.heading`
> (the trait, not idb's `Heading` type), and in a reading-order listing a heading listed before a target it overlaps is
> drawn over it (`reading-order.ts#headingsOver`, order `drawn`; docs/adr/0015-flat-list-reading-order-break.md,
> amendment "a heading listed before"; ADR 0004 one line). The colour assert now fails closed — `"Sticky header"
> (0,110 402x56) is drawn over the element` — and `fully: true` does not stop on R under it. Since R is covered first,
> idb's clip-line question (below) is no longer what judges R's `fully` stop.

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/scroll-sticky.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `truth/b2-edges` on `arch/round-20`'s
`src/` (`debc9b2`). Replayed only. The iOS sibling of
docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md; on Android the lab's same cell is judged
as the truth says (uiautomator lists the header after the rows).

## The screen

`scroll-sticky` (fixtures/apps/ios/AveriLab/Edges.swift): a `ScrollView` `0,110 402x450` holding a
`LazyVStack(pinnedViews: [.sectionHeaders])`; the section's header (a `Text` "Sticky header" on `#455A64`, 402x56) is
pinned at the list's top; the first row `R` (a 300x64 button, `#00897B`), scrolled 24 pt, slides 24 pt under it. The
app's own frames (`scroll-sticky.truth.json`): header `0,110 402x56` (reported as the state's `chrome.stickyHeader`), `R`
`51,142 300x64`. The screenshot shows the header drawn over `R`'s top 24 pt (`drawn` 62.5 %).

## Truth

`R` is `chrome-overlap:stickyHeader` (truth.ts#geometryOf): its centre `(201,174)` is clear of the header (its bottom
166) — the probe there fired `R` — but its top 24 pt are under it, past ADR 0002's 2-pt slack. bars.ts' R-overlap rows:
the tap lands (ok), the plain stop reaches it at once (ok), the colour assert fails closed because what it samples (the
12 %-inset rect, `y 149.7–198.3`) is overlapped by the header (ADR 0001, ADR 0002), and `fully: true` never stops on it
where it is (ADR 0009 N-a, `fully`; ui-tree/standing.ts#fullyStanding).

## Observed (replayed; WDA and idb alike)

```
assert [{ element: { id: "lab.scroll-sticky.R" }, color: { expected: "#00897B" } }]
→ All 1 asserts passed — PASS … sampled #00897B (dominant, 66% of region) vs expected #00897B → dE00 0.00 ≤ 8
scroll_until { selector: 'id:"lab.scroll-sticky.R"', direction: "down", fully: true }
→ Element id:"lab.scroll-sticky.R" fully visible after 0 swipes
```

The tree, as each source lists it:

```
wda  ScrollView 0,110 402x450
       Other 0,86 402x1072
         Other 0,110 402x96
           StaticText lab.scroll-sticky.header "Sticky header" 0,110 402x56
           Button     lab.scroll-sticky.R      "Target R"       51,142 300x64
idb  Heading lab.scroll-sticky.header 0,110 402x56,  Button lab.scroll-sticky.R 51,142 300x64   (flat, in that order)
```

## Expected

The header covers `R`'s top: the colour assert fails closed naming it (as the Android capture's reply does —
`under text "Sticky header" … drawn over it — 63% of it shows`), and `fully: true` does not stop on `R` where it is.

## Cause (inferred from the trees; src not changed here)

averi's draw order (ui-tree/draw-order.ts) takes a later sibling as drawn over an earlier one. SwiftUI lists a pinned
section header FIRST, before the rows it is pinned over, though it draws it on top. So the header reads as drawn
beneath `R`, and nothing covers `R`. The 66 % "dominant" in the PASS line is the sample's teal share: a third of the
sample is the header's grey.

## Possible fix directions (owner's choice)

- Treat a header pinned at its scroll view's top (its frame at the scroll view's top edge while its section's content
  starts above it) as drawn over the rows it overlaps, whatever its place in the listing.
- Or a narrower rule for WDA's `pinnedViews` shape: a section header sibling whose frame overlaps a later row's is
  over it.

## Rows (golden, KNOWN in tests/differential/golden/edges.known.ts)

`ios-iphone17-ios27/scroll-sticky.wda.json R colour`, `R fully`; `ios-iphone17-ios27/scroll-sticky.idb.json R colour`,
`R fully`.

Since round 14's LE2 fix (docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md, ADR
0013's clip line), idb's `R fully` asks the eyes once for a clip line (its tree lists no scroll view) and they answer
`own`: the header's label crosses R's top line (y 142: 85 % `#455A64`, the label's white and its antialiasing the rest,
under the line test's 90 %), so no band begins at that edge. The row stays red, this note's — the clip line is no cover
rule.
