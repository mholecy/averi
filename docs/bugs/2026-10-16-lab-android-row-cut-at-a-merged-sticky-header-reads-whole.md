# BUG: on Android a row Compose cuts at a sticky header — its content cut with it — reads whole: `fully: true` calls it "fully visible" and the colour assert passes on the cut rect

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the Android lab app's ground truth
(`tests/fixtures/truth/android-averi_lab-api33/scroll-sticky-cut.*`, captured by scripts/truth/capture-android.ts on the
`averi_lab` AVD, Android 13 (API 33), 1080x2220, gesture navigation). averi = mobile-verify `truth/r3-variants` on
`arch/round-20`'s `src/` (`debc9b2`). Replayed only. A shape of
[2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md](2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md)
that its fix (`d2b7744`, a node cut at a header read by its descendants' extent) cannot see: here the descendants are
cut too.

## The screen

`scroll-sticky-cut` (fixtures/apps/android/src/main/java/dev/averi/lab/Edges.kt): `scroll-sticky`'s LazyColumn
(`0,303 1080x1238`) with its sticky header (`0,303 1080x154`, "Sticky header") made one accessibility element
(`semantics(mergeDescendants = true)`, as a header with a title and an action is), and its row `R` an app's row with an
identified container — a `testTag` Box, not clickable, holding a clickable box `Target R` that fills it. Scrolled 24 dp,
`R` (`128,391 825x176`, `#00897B`) lies 66 px under the header. The screenshot shows the header drawn over `R`'s top
(`drawn` 62.5 %).

## Truth

`R` is `chrome-overlap:stickyHeader` (truth.ts#geometryOf): its centre `(541,479)` is clear of the header (its bottom
457) — the probe there fired `R` — but its top 66 px are under it. bars.ts' R-overlap rows: the tap lands (ok), the
plain stop reaches it at once (ok), the colour assert fails closed because what it samples (the 12 %-inset rect of what
shows) is overlapped by the header (ADR 0001, ADR 0002), and `fully: true` never stops on it where it is (ADR 0009 N-a,
`fully`).

## Observed (replayed)

```
assert [{ element: { id: "lab.scroll-sticky-cut.R" }, color: { expected: "#00897B" } }]
→ PASS … sampled #00897B (dominant, 100% of region) vs expected #00897B → dE00 0.00 ≤ 8
scroll_until { selector: 'id:"lab.scroll-sticky-cut.R"', direction: "down", fully: true }
→ Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes
```

The uiautomator dump, in its order:

```
lab.scroll-sticky-cut.R       [128,457][953,567]   (the container: frame 128,391 825x176)
  "Target R"                  [128,457][953,567]   (its clickable content, cut alike)
lab.scroll-sticky-cut.header  [0,303][1080,457]
  (the header's text)         [400,347][681,413]
```

Red at `10fb02b` and at `d2b7744` alike (calibration.json #9): the fix widens a cut node to its descendants' extent, and
here no descendant reaches past the cut.

## Cause (inferred from the dump and Compose's source; src not changed here)

Compose's accessibility bounds are each node's bounds less what the nodes drawn after it, that are accessibility
elements, cover (`getAllUncoveredSemanticsNodesToIntRect`): with the header one element, it takes its rect out of the
row AND of the row's content, which are visited after it. Without it (the lab's `scroll-sticky`, the header a plain
container) nothing is cut and averi already refuses (`under text "Sticky header" … drawn over it`). mp-native's Account
Detail cut the row's container while its children kept their whole rect — the shape `d2b7744` reads; which Compose
setup gives that was not found here. What the tree still says: the header, listed after `R`, ends EXACTLY where `R`'s
rect begins (457), across `R`'s whole width — a node abutting the target's cut edge, drawn after it.

## Possible fix directions (owner's choice)

- Treat a node listed after the target whose edge coincides with the target's edge, across its width, as a possible cut
  there (as a flush edge with a scroll container is): probe toward it before `fully` stops, and fail the colour assert
  closed or say the doubt.
- At least say it in the `fully` stop: "its top edge meets <header>, drawn after it — it may be cut there".

## Rows (golden, KNOWN in tests/differential/golden/edges.known.ts)

`android-averi_lab-api33/scroll-sticky-cut.xml R colour`, `R fully`.
