# 24. The eyes tell the order of two controls listed in reading order

Status: accepted 2026-10-19 (orchestrator's decision for round 9, L4's remaining half, on the owner's standing: speed
and stability of results; the agent's hands must not be stuck on a false refusal where a cheap, reliable signal
exists). Implemented on `fix/r9-l4w`. Amends ADR 0015 (its 2026-10-19 amendment's first residual closed, its second
narrowed) and extends ADR 0013 (the eyes get a second question).

## Context

- docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md: SwiftUI
  lists a container's elements in READING order, by their tops — the lab's menu row W (`51,448 300x64`, drawn on top by
  `zIndex`) is listed before the row C (`51,470 300x64`) it is drawn over, under idb and WDA alike. ADR 0015's
  amendment (round 8) made the two covers of each other whose order is not told: C's unsafe `Tapped` (which fired W)
  became a refusal, and W stayed refused too — a false refusal that blocks any flow tapping such a menu row (mp-native's
  payment-type chooser is the same shape).
- The tree has no tell. idb gives K, W and C identical roles, traits and flags; WDA's six Buttons are siblings of one
  `Other`, every one `isVisible`, `isAccessible`, `isEnabled`, its `nativeFrame` its frame; neither lists a z-order, an
  index or `hittable` (WDA's `/source` never includes it). A geometric rule ("a stacked run of rows is a card, so on
  top") also fits mp-native's chooser rows and any list of equally spaced rows: rejected as speculation.
- The screenshot has a large, clean signal. On the committed `blur-menu.png` (1206x2622, scale 3), measured with the
  colour assert's sampler (`color-parity.ts#sampleDominant`) and CIEDE2000: the overlap W∩C (`51,470 300x42`) is
  `#00897B` (share 1.00), W's band above it (`51,448 300x22`) `#00897B` (1.00), C's band below it (`51,512 300x22`)
  `#347937` (the blurred green, 0.57), the screen beside them (`0,470 51x42`) `#BEBEBE` (0.86). ΔE00 overlap↔W 0.00,
  overlap↔C 17.69, C↔screen 36.55, W↔screen 31.49. The grouped capture reads the same.
- Device hit tests (idb `ui describe-point`, WDA's per-element `hittable`) were weighed and rejected as the mechanism:
  one source each, live only (golden records none), a spawn or two XCTest snapshots per peer, idb's stuck mode
  answering nothing, and SwiftUI's hit-test honouring `zIndex` unmeasured.

## Decision

The eyes (ADR 0013, `ui-tree/eyes.ts`) get a second question, **which of two controls listed in reading order is drawn
on top** (`Eyes.order`, `OrderQuestion`), answered from ONE screenshot by a pure judge (`verify/eyes.ts#judgeOrder`),
and the answer enters the pure draw order as an input — **the order seen** (`ui-tree/seen-order.ts`: `OrderSeen`,
`PairSeen`, `SeenOrder`, `seenOrderOf`; `draw-order.ts#drawOrder(tree, orderSeen?)`, `standing.ts#sceneOf(tree,
seen?)`, `look.ts#lookAt(tree, reading, seen?)`), so the draw order stays synchronous and replayable.

WHEN — asked only of a standing `covered` with remedy `unordered` (`eyes.ts#orderQuestion`; 6 targets over all 153
trees of `tests/fixtures`), once per look, by the three verbs that may act on the answer; a caller without eyes (the
dismissal picker, `ui_snapshot`, a test) keeps today's untold order:
- the tap (`interact/tap-judgement.ts#TapJudge.aim`, through `GuardOptions.eyes` → `TapAsks.eyes`): one screenshot,
  then the standing judged again on a look told the order;
- `scroll_until` (`interact/scroll-rounds.ts#round`'s `ask order`, after the read's judgement; the driver answers it,
  `RoundSeen.order`, and the read is judged again with it, `RoundRead.seen`): such a stop never strokes, so one
  screenshot ends the question — no refused-again memo is needed;
- the colour and ocr asserts (`verify/pixel-poll.ts`): the round's one capture is taken on first need — for the order
  question before the standing is decided, else after — and the order is judged on that same settled, decoded frame
  (`verify/eyes.ts#orderOfFrame`): ZERO extra captures (tests/verify/eyes-order.test.ts counts two, the settled pair).
  A frame that did not settle reads `untold`. The cost moves instead: an element still covered after the eyes looked
  (C) now captures each round of its poll before missing, as any element that is measured and fails does — where a
  covered miss took none before.
- Wired at the composition roots with `verify/eyes.ts#eyesOn` (`mcp/tools.ts#guardOpts`, `flow/engine.ts`'s
  `acting`), as the first question is; interact/ imports no verify/.

WHAT is asked, per `unordered` cover (a peer): where the two overlap (in the standing's frame), each one's CLEAR BANDS
along the overlap's edges (the strips of it beside the overlap, outside the other by construction, each no deeper than
the overlap on that axis, none meeting another cover of the target), and the screen beside the two on the overlap's
rows. Bands, not each control's largest clear rect: mp-native's chooser row's largest clear rect is the 4-pt gap
between the card's rows — a surface of the other layer.

THE JUDGE — asymmetric on purpose: telling the PEER on top only confirms a refusal; telling the TARGET on top unlocks a
tap. Every rule can only answer `untold` (the listing's untold order, the refusal kept), never guess:
1. each side's bands, landed in the png one pixel in from each edge, at least 4 png px (`FLANK_MIN_PX`) on both sides;
   none — untold;
2. each side ONE colour: every band's dominant at least half of it, all of a side within ΔE00 1.0 (`EYES_SAME_DE`) —
   else untold (a side showing two surfaces, the chooser's shape, is not read);
3. THE OPACITY GUARD: the screen beside the two (its dominants) — none, untold (two rows as wide as the screen); either
   side's colour within ΔE00 2.0 (`EYES_APART_DE`) of it — untold: that control may draw nothing there (a text-only
   button over a coloured row lets the row show through the overlap, which would read as the row on top while a tap
   there hits the button);
4. the two sides farther apart than the colour assert's tolerance, ΔE00 8 (`DEFAULT_TOLERANCE_DE`) — else untold, the
   two look alike (the lab: 17.69);
5. the overlap's dominant (at least half of it) within ΔE00 2.0 of exactly one side and farther than 8 from the other —
   that side is drawn on top; else untold (a frame mid-fade reads a blend; the lab: 0.00 and 17.69).

WHAT the answer does (`draw-order.ts#readingOrderPeers`): a peer seen UNDER the target is no peer — not a cover listed
before it, not one whose order is untold, not a part a moved tap keeps clear of, and, listed after it, no cover by
the draw order either (the screenshot overrides the listing for exactly that pair). A peer seen OVER it stays the cover
the listing made it, named `Exposure.seenOver` instead of `unordered`. An untold pair is as with no screenshot.

THE REMEDY (`standing.ts#Remedy`, second in the precedence beside `unordered`): `seenOver` — no scroll; "if it is a menu
or a popover, close it first; no scroll moves it out from under it" (the pixel assert: "… else assert something in the
element that lies clear of it", after "the capture would show it, not the element"); the cover named "drawn over it as
a screenshot shows (the two are listed in reading order)" (`geometry.ts#seenOverText`, `#drawnOverSeenText`). An
`unordered` remedy a screenshot looked at carries why it could not tell (`untold`), and its words drop "see a
screenshot": "no scroll tells which is on top: a screenshot could not tell either (the two look alike (ΔE 3.10)) — …".

## Measured

- Golden over the truth corpus, `fix/round-9` (`e52d1797`) → this fix: 1410 checks, 223 → 217 mismatches, 0 broken,
  92 skipped (no OCR in the sandbox); 15 replies change, every one on blur-menu:
  - W's six rows (blur-menu.idb and .wda: tap, colour, scroll_until) turn green — `Tapped id:"lab.blur-menu.W"`
    (`idb ui tap 201 480`), `PASS … sampled #00897B (dominant, 100% of region)`, `fully visible after 0 swipes`;
  - C's nine rows (blur-menu.idb, .wda, blur-menu-grouped.idb) stay refused / FAIL / stopped before any swipe, no tap
    and no stroke sent, now worded `under button "Target W" (51,448 300x64) at its centre (201,502), drawn over it as a
    screenshot shows (the two are listed in reading order)` with the `seenOver` remedy — still red as ADR 0018's
    residual 9 (#31: the backdrop has no node, so no "close it first" of a presented layer).
- Unit and table tests: tests/verify/eyes-order.test.ts (the judge over both lab pngs and synthetic pngs for every
  untold rule; the question's bands on the lab trees and on mp-native's chooser; the colour assert's capture count),
  tests/ui-tree/draw-order-reading-order.test.ts (the seen order into the draw order, both ways, and untold = no
  screenshot), tests/interact/remedy-agreement.test.ts (one remedy for C, W reached, by the tap, the colour assert and
  `scroll_until`), tests/flow/engine.test.ts (a flow tap on W, the engine's wiring).
- Live on the lab simulator: see the bug note's Status and docs/truth/live-ios-2026-10-18-visibility.md (round 9's
  section).

## Residuals

1. **Alike looks** (two white rows, no dim, no shadow): untold, today's refusal — the safe direction. Such menus' rows
   stay refused; the lab's blur and mp-native's dim are what give the signal.
2. **A transparent top control over a non-screen surface**: the opacity guard compares a band with the SCREEN beside
   the overlap; a text-only button whose clear band lies over another coloured surface (not the screen's colour)
   passes it and could read the row beneath as on top — a `Tapped` that may hit the button. Narrow; not measured by a
   lab cell (a cell `presented/plain-button-over-row` would measure the common shape).
3. **One unsettled capture** for the tap and `scroll_until` (the pixel assert's is settled): a frame mid-transition
   reads a blend — untold; a frame of another screen than the tree's (read before a navigation, shot after) could in
   principle mis-tell, the gap being one screenshot's latency — ADR 0013's residual for the first question.
4. A peer seen under is dropped from what a moved tap keeps clear of too: a moved tap may then land on that peer's
   region of the target — right by the same evidence, but it widens the unlock to moved taps.
5. Controls as wide as the screen leave no screen beside them: untold, the refusal kept (ADR 0013's screen-spanning
   residual, for this question).
6. mp-native's chooser (`idb-modal-listed-before-content.json`) has no png: its `Loan repayment` row stays refused in
   the tests; live, its bands beside the SWIFT overlap are its own dimmed sides and SWIFT's white below — told or untold,
   never unlocked unless the overlap reads its own colour.

## Rejected

- A tree tell (traits, WDA attributes, idb fields): none differ.
- A geometric heuristic (a stacked card run): fits ordinary lists; untestable beyond one cell.
- idb `describe-point` / WDA `hittable`: platform-split, live-only, slower, idb's stuck mode, SwiftUI hit-test semantics
  unmeasured — worth one live measurement as corroboration later, not as the mechanism.
- A settled pair for the tap's and the stop's question: doubles the cost of a decision that already fails safe on motion.
- An async draw order, or a screenshot inside the parser: the draw order must stay pure and replayable; the seen order
  is an input.
- A separate `OrderEyes` port beside `Eyes`: two ports for one adapter that takes and scales the same screenshot.
- A screenshot on every tap: ~0.4 s per tap for 6 targets in 153 trees.
