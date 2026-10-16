# BUG: an in-screen SwiftUI menu's row, listed in reading order just before a row of the screen it is drawn over, reads as covered by that row — `tap` refuses it ("under button Target C"), the colour assert fails and `scroll_until` swipes, under idb AND WDA, while a raw tap on it fires it; and the row beneath reads as drawn over the menu row — `Tapped` at its centre, which fires the menu row

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
