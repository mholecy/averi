# BUG: an in-screen SwiftUI menu's row, listed in reading order just before a row of the screen it is drawn over, reads as covered by that row — `tap` refuses it ("under button Target C"), the colour assert fails and `scroll_until` swipes, under idb AND WDA, while a raw tap on it fires it; and the row beneath reads as drawn over the menu row — `Tapped` at its centre, which fires the menu row

> **Status (2026-10-19, round 9):** W's half (the false refusal) fixed on `fix/r9-l4w` at `1ef11b9c` (from `fix/round-9`
> `e52d1797`; docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md): the eyes are asked, once,
> which of two controls listed in reading order is drawn on top, and judge it on ONE screenshot — the overlap's colour
> against each control's clear band beside it, what lies around each control past its edge and the screen beside the
> two guarded, each rule answering "untold" where its evidence is missing (ADR 0024's residuals name what one frame
> cannot tell)
> (`verify/eyes.ts#judgeOrder`; on `blur-menu.png` the overlap `#00897B`, W's band `#00897B`, C's `#347937`: ΔE00 0.00 and
> 17.69). The answer is an input of the pure draw order (`ui-tree/seen-order.ts`): C, seen under W, is no cover of W;
> W, seen over C, stays C's cover, named so (`Remedy`'s `seenOver`: close a menu first, no scroll). Measured by the
> golden (1410 checks, 223 → 217 mismatches, 0 new; W's six rows green — `Tapped` at (201,480), colour PASS on
> `#00897B`, `fully visible after 0 swipes`; C's nine reworded "under button "Target W" … drawn over it as a screenshot
> shows (the two are listed in reading order)", still red as ADR 0018's residual 9), by
> tests/verify/eyes-order.test.ts, tests/ui-tree/draw-order-reading-order.test.ts, tests/interact/remedy-agreement.test.ts
> and tests/flow/engine.test.ts over these captures, by calibrate (CALIBRATED, the note's second pair), and live on the lab
> simulator at `1ef11b9c` (`docs/truth/live-records/ios-vis-r9-l4w-1.json`, `-2.json`): W's tap `Tapped`, W alone fired,
> under idb and WDA, both runs; C's tap and `scroll_until` refused as under W, seen so, nothing fired or stroked.
> Review round 1's fixes at `85e36215`: the opacity guard also reads what lies around each control past its edge (a
> text-only button over an inset card is untold), the pixel assert judges the order only on a frame settled over the
> whole screen, keeps a covered answer per distinct tree and never ends its poll on the order question's capture, and
> one cycle (`ui-tree/eyes.ts#judgedWithOrder`) asks the eyes; the golden unchanged (1410 checks, 217 mismatches, every
> reply identical), so the live records and calibration stand. A two-tone peer split exactly at the target's edge stays
> a named residual (ADR 0024, 7.). Review round 2 (APPROVED), fixed at `a374227a`: the strips around each control also
> run sideways past its side edges on each band's rows (a card flush with a text-only peer's far edge and running on
> past its sides is untold). Review round 3 (APPROVED), fixed at `0f28b4cf`: each strip is also read as its thin slice
> against the control, so a run-on of two png pixels is untold; residual 2 (of 7's class) is now a surface ending
> within one png pixel of a text-only control's edges. The review-fix commits: `85e36215`, `8c738ecc` (docs),
> `a374227a`, `0f28b4cf`. The live records stay those taken at `1ef11b9c`; no device re-run was done: the review fixes
> only add untold / covered paths, every lab strip and slice measures 0.000 share (W stays told), and the golden
> replies are identical (1410 checks, 217 mismatches, every reply, kind and call list unchanged). Calibrate re-run
> with the second pair's `after` at `0f28b4c`.

> **Status (2026-10-19, round 8):** C's half (the unsafe direction) fixed on `fix/r8-l4` at `37bf5a15`, `f5a28b38` and `bea9769c`
> (its review's fixes; from `fix/round-8` `e0c2587e`); W's half (the false refusal) stays open as ADR 0015's residual, now
> worded as the Expected's fallback. In a listing given in reading order — idb's flat list, a WDA run of siblings sorted
> by top (`UiNode.readingOrder`, the parsers' mark; on WDA a sort check) — the controls listed BEFORE a control target
> that overlap it cover it when one of them holds its centre, every control overlapping it over its centre, listed
> before or after, is a cover whose order is not told, and a tap moved off a covered centre is never aimed at a control
> listed before it; never for a target pinned at the screen's bottom
> (`draw-order.ts#readingOrderPeers`, `Exposure.unordered`; ADR 0015, amended). So C is refused as overlapped by W —
> "overlapped by button "Target W" (51,448 300x64) at its centre (201,502), the two listed in reading order: which is
> drawn on top is not told" — and W as overlapped by C, each with no scroll advised (`standing.ts#Remedy`'s
> `unordered`: "no scroll tells which is on top: see a screenshot — if the other is drawn over it (a menu, a popover),
> close it first; if it is the one on top, tap it by coordinates"), and `scroll_until` stops before any swipe. Measured
> by the golden (15 replies change: C's nine rows on blur-menu.idb, blur-menu.wda and blur-menu-grouped.idb: Tapped /
> PASS / fully visible → refused / FAIL / stopped before any swipe, still red as ADR 0018's residual 9 — no "close it
> first" of the presented kind, the backdrop has no node; W's six rows on blur-menu.idb and .wda still red, reworded,
> its `scroll_until` no longer swiping; 0 new mismatch), by `tests/ui-tree/draw-order-reading-order.test.ts` and
> `tests/interact/remedy-agreement.test.ts` over these captures, by calibrate (`CALIBRATED-ON-DEFECT`, partial), and
> live on the lab simulator at `37bf5a15` (`docs/truth/live-records/ios-vis-r8-l4-before.json` — C's tap fired W under
> idb and WDA at `e0c2587e` —, and `ios-vis-r8-l4-1.json`, `-2.json`: C's tap refused, nothing fired, under both
> sources and on the grouped variant under idb; C's `scroll_until` then still stroked three times on the blur, which
> did not close the menu), and again at the final src `94fc318b` (`ios-vis-r8-l4-3.json`, `-4.json`): C's tap refused,
> the order not told, nothing fired; C's `scroll_until` stopped before any swipe, nothing stroked; W's tap refused as
> overlapped by C, the order not told, nothing fired; nothing closed the menu.
> Left out, on purpose: the grouped variant's WDA tree, where the card and the screen beneath are two containers — W and
> C children of different parents, W listed after C — so no run lists them in reading order: C stays refused under W by
> draw order with "scroll_until it first", and its `scroll_until` still strokes three times beneath the blur
> (presented.known.ts, #31's residual — the backdrop has no node — not this note's).

**Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/blur-menu.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402×874 pt). averi = `truth/b3-presented` on `arch/round-20`'s `src/`
(`debc9b2`). Phase 3, batch B3 (presented), building the cell for calibration.json #15 and #31.

## The cell

`presented/blur-menu` (fixtures/apps/ios/AveriLab/Presented.swift#BlurMenuScreen): the four slot targets A–D
(Base.swift) blurred and dimmed under a menu card of two rows, K (`51,380 300x64`) and W (`51,448 300x64`), drawn on top
(`zIndex`), in the screen's own container — mp-native's payment-type chooser over Account Detail (#15, #31). W's bottom
overlaps the top of slot 2's target C (`51,470 300x64`) beneath: W's centre (201,480) lies inside C's frame, and W is
drawn there. The backdrop has no accessibility element.

SwiftUI lists the container's elements in READING order (by their frames), not in declaration or drawing order. Both
trees list, flat: `A 110, B 290, K 380, W 448, C 470, D 650` (idb's `describe-all`; WDA's six `Button`s are siblings in
one `Other`).

## Observed (replayed at debc9b2)

Tap and `scroll_until` are green at 16ae6bb and red from 13d68a2 (the cover judgement; calibration.json #6's
regressions) at every commit swept to debc9b2; the colour assert is red from 596a379 (#22's regressions) at 7566443 and
from 753b560 on, green at 20053ae and 8a55d2b.

Truth: W's probe at (201,480) fired W (`tap W`); 100 % of W is drawn in its own colour; C's probe at (201,502) fired W.

```
tap W (idb and WDA) → ERROR id:"lab.blur-menu.W" is under button "Target C" (51,470 300x64) at its centre (201,480), drawn over it;
                      only a 300x22 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped
colour W            → FAIL … button "Target C" (51,470 300x64) is drawn over the element (element 51,448 300x64) …
scroll_until W      → failed after 3 swipes — element is in the viewport but under button "Target C" … — 34% of it shows
                      (idb ui swipe 201 699 201 175 ×2, 201 175 → 201 437)
```

C, listed after W, is read as drawn over it. On the device the strokes would land on the backdrop, which closes the
menu.

The same misreading the other way round, for C — the UNSAFE direction. C's centre (201,502) lies under W, and C's probe
there fired W; the screenshot shows W's colour (#00897B) over most of C. Read as drawn over W, C is open:

```
tap C (idb and WDA)  → Tapped id:"lab.blur-menu.C"                          (idb ui tap 201 502 — on the device it fires W)
colour C, asked #00897B → PASS … sampled #00897B …                             (W's colour measured as C's)
scroll_until C       → Element id:"lab.blur-menu.C" fully visible after 0 swipes
```

So on the grouped variant's idb list (`K, W, A, B, C, D`): W's rows are right there (ADR 0015's break at A), but C,
listed after W, still reads as uncovered — `Tapped` at a point that fires the menu row. Only the grouped variant's WDA
tree refuses C under W (without "close it first": #31's residual, the backdrop has no node).

## Why (ADR 0015)

ADR 0015 ends a content target's covers at a READING BREAK in idb's flat list: the first node listed after the target
whose top lies ABOVE the target's top. mp-native's chooser rows are followed by the transaction list's `filter_icon`
(top 358, above `row_swift`'s 453), so the break comes at once. Here every node after W starts below W's top (C at 470,
D at 650): there is no break, and C covers W as draw order. The lab's grouped variant, `presented/blur-menu-grouped`
(the card and the screen beneath each an accessibility container, the card's first), lists `K, W, A, B, C, D` — A's top
110 is a break — and W is `Tapped` there from 8a55d2b on (calibration.json #15 calibrates on it).

ADR 0015 says "WDA's nested tree and Android's never meet this rule"; SwiftUI's WDA tree is as flat here as idb's
list, and WDA refuses W the same way.

## Expected

The menu row is drawn on top: `tap` → `Tapped` (its centre), the colour assert passes on its own colour, `scroll_until`
reaches it with no swipe — or, if a flat reading-order list cannot tell what is drawn over what, refuse saying so, not
"scroll_until it first" (no scroll moves C off W).

## Notes

- Kept in tests/differential/golden/presented.known.ts as `bug:` this note: W's tap, colour and `scroll_until` on idb
  and WDA — a false refusal, the safe direction, but it blocks a flow that taps the menu, as #15 did — and C's on idb
  and WDA, and on the grouped variant's idb list — a false `Tapped` that fires the menu row, the unsafe direction.
- A, B and D beneath the backdrop answer `Tapped` / colour PASS / `fully visible`: no tree lists anything over them —
  #31's residual (ADR 0018 residual 9; calibration.json #31), pinned as such.
