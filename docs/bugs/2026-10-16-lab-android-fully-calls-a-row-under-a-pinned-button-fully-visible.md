# BUG: on Android `scroll_until … fully: true` answers "fully visible after 0 swipes" for a row whose bottom third lies under a pinned button — Compose's uiautomator bounds leave out what a later clickable sibling covers, so the tree shows no cover and no cut

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the Android lab app's ground truth
(`tests/fixtures/truth/android-averi_lab-api33/pinned-bar.*`, captured by scripts/truth/capture-android.ts on the
dedicated `averi_lab` AVD, Pixel 3a profile, Android 13 / API 33, 1080x2220, gesture navigation). averi = mobile-verify
`truth/b4-bars` on `arch/round-20`'s `src/` (`debc9b2`; no `src/` change on the branch).

## The cell

`pinned-bar` (fixtures/apps/cells/bars.json, dev/averi/lab/Bars.kt#PinnedBar): edge to edge, a `Continue` button
(`lab.pinned-bar.continue`, clickable, 56 dp) pinned 16 dp above the navigation band, composed after target P, whose
bottom 24 dp it is drawn over. The app's frames (the state file, screen pixels):

| what | frame | |
|---|---|---|
| P | `127,1846 825x176` | its bottom 66 px under Continue; its centre (540,1934) clear |
| Continue (chrome `pinned`) | `66,1956 948x154` | |

Truth (`pinned-bar.truth.json`): P `chrome-overlap:pinned`; the probe at its centre fired P; 62.5 % of its frame is
drawn in its own colour (the rest is Continue's grey).

## What the tree says

```
lab.pinned-bar.P         [127,1846][952,1956]     ← 825x110: its frame minus what Continue covers
lab.pinned-bar.continue  [66,1956][1014,2110]
```

Compose reports a node's accessibility bounds with what a later clickable sibling covers taken out, so P's rect ends
where Continue begins. The same in `bands.xml`: Q (`127,1989 825x176`) is dumped to 2121, cut at N's 48-dp touch target
(N's own rect grown from `2165–2209` to `2121–2220`). Nothing in the dump says that P runs on under the button: the two
rects only touch.

## Observed (replayed)

```
scroll_until { selector: 'id:"lab.pinned-bar.P"', direction: "down", fully: true }
→ Element id:"lab.pinned-bar.P" fully visible after 0 swipes                     (no stroke)
assert [{ element: { id: "lab.pinned-bar.P" }, color: { expected: "#E53935" } }]
→ PASS … sampled #E53935 (dominant, 100% of region) … dE00 0.00
```

On iOS the same cell (`pinned-bar.wda.json`, `.idb.json`) lists P at its whole frame under Continue: `fully: true`
does not stop on it, and the colour assert fails closed naming the button — both rows green.

## Expected

`fully: true` promises a pixel assert on the element is not refused for a cover (ADR 0009 N-a, `fully`): P is not
fully visible — 66 px of it lie under Continue — so the stop must not be taken where it is (R-fully,
golden-spec/rows.ts#fullyRow). The tree gives no direct evidence; a rect that ends flush against a later clickable
sibling's top edge is the only trace.

## The colour row beside it

The colour assert's PASS is filed with it, not as this bug: averi samples the dumped rect, which is P's uncovered part,
all of it P's colour — the verdict is right about what the user sees there. The row (R-overlap's colour,
golden-spec/rows.ts#overlapColour) expects it to fail closed because it samples the APP's frame inset 12 %, which the
button overlaps; the tree's rect and the app's frame disagree (ADR 0020, decision 1: a finding about the tree).

## Notes

- Kept in the bars family's KNOWN list (tests/differential/golden/bars.known.ts), the `fully` row `as: bug:` this
  note, the colour row with no class; scripts/truth/calibration.json `B4-L1` (open) links the note to its row.
- Related: docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md (a Compose row's bounds cut
  by a sticky header, fixed in d2b7744 for a header inside the row's scroll view); here the cutter is a sibling outside
  any scroll view.
