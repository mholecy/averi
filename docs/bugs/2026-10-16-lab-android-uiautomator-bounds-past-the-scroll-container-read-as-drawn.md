# BUG: on Android a row whose uiautomator bounds run on past its scroll container's edge is judged on the screen alone — `fully: true` calls a cut row "fully visible", and a 22-px sliver is `Tapped` at a centre below its container, where nothing of it is drawn

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the Android lab app's ground truth
(`tests/fixtures/truth/android-averi_lab-api33/scroll-bounded.*`, captured by scripts/truth/capture-android.ts on the
dedicated `averi_lab` AVD, Pixel 3a profile, API 33, 1080x2220, gesture navigation). averi = mobile-verify
`truth/b2-edges` on `arch/round-20`'s `src/` (`debc9b2`). Replayed only; what a tap there does is the capture's own
probe on the emulator.

## The screen

`scroll-bounded` (fixtures/apps/android/…/Edges.kt): two bounded `Column(Modifier.verticalScroll(…))` containers laid
down a column, each target a 300x64-dp clickable box (825x176 px) at a fixed place in its content, scrolled to 0. The
app reports each target's UNCLIPPED frame (position in the window plus size) and each container's frame
(`scroll-bounded.truth.json`):

| node | app frame | container (clip) | what shows | uiautomator `bounds` |
|---|---|---|---|---|
| `P` | `128,798 825x176` | `upper` `0,303 1080x605` (bottom 908) | `128,798 825x110` — cut at 908, its centre 886 inside | `[128,798][953,974]` — the WHOLE frame |
| `S` | `128,1519 825x176` | `lower` `0,1046 1080x495` (bottom 1541) | `128,1519 825x22` — a sliver (the tap minimum is 65 px) | `[128,1519][953,1607]` — cut at 1607, 66 px BELOW the container's bottom |

The screenshot (`scroll-bounded.png`) shows both cut at their container's bottom: below 908 and below 1541 only the
white background. So uiautomator does not cut these rects to their scroll container — `P` not at all, `S` at a line
66 px (the status bar's height) past its edge. The containers are in the dump (`android.widget.ScrollView`,
`scrollable="true"`, `[0,303][1080,908]` and `[0,1046][1080,1541]`), each the parent of its targets.

## Truth

- `P`: `partly-centre-in` (truth.ts#geometryOf). Its probe at the centre fired it; 62.5 % of its frame is drawn.
  rows.ts R-fully: `scroll_until … fully: true` must not answer "fully visible" where it is.
- `S`: `sliver` (22 px across the cut, under ADR 0013's 65-px minimum). The probe at its frame's centre `(541,1607)` —
  outside the container, on the background — did not fire it; one at its piece's centre `(541,1530)` did. R-sliver: the
  tap is refused naming `scroll_until`, nothing tapped; neither stop calls it reached where it is.

## Observed (replayed)

```
scroll_until { selector: 'id:"lab.scroll-bounded.P"', direction: "down", fully: true }
→ Element id:"lab.scroll-bounded.P" fully visible after 0 swipes

tap { selector: 'id:"lab.scroll-bounded.S"' }
→ Tapped id:"lab.scroll-bounded.S"
device: adb shell input tap 541 1563          ← 22 px below the container's bottom (1541): the background
scroll_until { … S, direction: "down" }               → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
scroll_until { … S, direction: "down", fully: true }  → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
```

The tap is the one the note
[2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md](2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md)
describes — `Tapped`, and the app does nothing — reached by another road: there the rect was cut FLUSH with the
container's edge (the shape its fix, ADR 0013, refuses); here it runs past it.

## Expected

The same answers as for an iOS WDA tree of this screen (`scroll-bounded.wda.json`, whose frames are unclipped and
judged by `Clips.drawnIn`): `S` refused — `is outside its scroll view … only 13% of it … is drawn … — scroll_until it
with fully: true first; nothing was tapped` — and neither stop "visible" on `P` or `S`.

## Cause (read from the source, not changed here)

`src/ui-tree/geometry.ts#Clips.drawnIn` is undefined "on Android's trees (uiautomator has cut every rect to its
ancestors already: nothing is left to cut)", and the sliver rule (`cutSliver` → `flushEdges`) and the `fully` stop's
flush probe (interact/scroll-rounds.ts#PROBE_REACH) only suspect a rect FLUSH with its container's edge. A rect that
crosses the edge matches neither, so it is judged on the screen alone: `P`'s rect lies wholly on the screen and nothing
in the tree is drawn over it; `S`'s centre `(541,1563)` is on the screen.

Measured here, the premise does not hold for Compose's `verticalScroll` in an edge-to-edge window (MainActivity's
`enableEdgeToEdge`): the semantics bounds are cut, if at all, at a line offset by the status bar's height, not at the
container. Not established: whether Compose's `LazyColumn`, or a window that is not edge to edge, cuts flush (mp-native's
SWIFT form did, per the 2026-10-09 notes).

## Possible fix directions (owner's choice)

- Judge an Android rect by its scrolling ancestors as WDA's are (`drawnIn` for uiautomator too): a rect past its
  `scrollable` ancestor's frame is drawn only where they overlap. Cheap where uiautomator did cut (it is a no-op then).
- Or, narrower: treat a rect that crosses its scrollable ancestor's edge like one flush with it (the sliver rule and the
  `fully` probe).

## Across a carousel (round 6, 2026-10-18)

`carousel-in-list` (Edges.kt#CarouselInList, captured on `averi_lab` at truth/r6-cells): a Compose
`Row(Modifier.horizontalScroll(…))` carousel `66,380 948x234` inside a `verticalScroll` page, its second card `C`
laid out at `1014,380 948x234` — right of the carousel's clip, its first 66 px on the screen, nothing of it drawn
(`carousel-in-list.png`: the page's `#EEEEEE` there). uiautomator lists it as `[1014,380][1080,614]`: cut to the
SCREEN's right edge, not to its container's — the same premise failing across. averi judges that strip on the screen
alone:

```
tap { selector: 'id:"lab.carousel-in-list.C"' }          → Tapped   (adb shell input tap 1047 497: the background)
assert { element: { id: … C }, color: { expected: "#EEEEEE" } } → PASS (the background measured: #29's shape)
scroll_until { … C, direction: "right" }                  → Element … fully visible after 0 swipes
```

So on Android the card's R-stroke — a sideways stroke inside the carousel, what an axis-aware stroke choice is judged
on — is never asked of averi: it stops at once. The iOS capture of the cell (WDA lists C with its unclipped frame) is
the one that measures the stroke.

## Rows (golden, KNOWN in tests/differential/golden/edges.known.ts)

`android-averi_lab-api33/scroll-bounded.xml P fully`, `S tap`, `S scroll_until`, `S fully`;
`android-averi_lab-api33/carousel-in-list.xml C tap`, `C colour`, `C scroll_until`.
