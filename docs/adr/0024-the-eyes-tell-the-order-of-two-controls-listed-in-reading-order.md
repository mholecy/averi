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
seen?)`, `look.ts#lookTold(look, seen)`), so the draw order stays synchronous and replayable. ONE cycle asks it
(`ui-tree/eyes.ts#judgedWithOrder`: judge the look, ask the question its standing asks once, judge again on the look
told the answer — the tap and the pixel assert supply only their purpose; `scroll_until`'s pure reducer asks by a step
its driver answers with `orderSeenBy`, the read judged again on `lookTold`). The port is one shape everywhere,
`OrderEyes` (`Pick<Eyes, 'order'>`).

WHEN — asked only of a standing `covered` with remedy `unordered` (`eyes.ts#orderQuestion`; 6 targets over all 153
trees of `tests/fixtures`), once per look, by the three verbs that may act on the answer; a caller without eyes (the
dismissal picker, `ui_snapshot`, a test) keeps today's untold order:
- the tap (`interact/tap-judgement.ts#TapJudge.aim`, through `GuardOptions.eyes` → `TapAsks.eyes`): one screenshot,
  then the standing judged again on a look told the order (tests/flow/engine.test.ts pins that an uncovered target and
  one under an ordinary cover take none);
- `scroll_until` (`interact/scroll-rounds.ts#round`'s `ask order`, after the read's judgement; the driver answers it,
  `RoundSeen.order`, and the read is judged again with it, `RoundRead.seen`): such a stop never strokes, so one
  screenshot ends the question — no refused-again memo is needed;
- the colour and ocr asserts (`verify/pixel-poll.ts`): the round's one capture is taken on first need — for the order
  question before the standing is decided, else after — and the order is judged on that same decoded frame
  (`verify/eyes.ts#orderOfFrame`): ZERO extra captures (tests/verify/eyes-order.test.ts counts two, the settled pair).
  A third question shares that frame (2026-10-20, round 14, LE2): on a tree that tells no drawn frame (idb's), whether
  the colour assert's region reads as the screen beside it (`verify/eyes.ts#apartOfFrame`; ADR 0010's residual 5).
  NOT under the rule below: it is asked on a region-only frame too, since skipping it there would measure — a PASS on
  the background beneath a clip — where `untold` here keeps the element covered; a strip beside still moving is no
  plain strip, and its miss is no final one.
  Only a frame settled over the WHOLE screen is judged: the bands and the strips around the two lie outside the
  element's region, which a region-settled frame does not vouch for — an unsettled or region-only frame reads `untold`.
  The order question never throws, as `eyesOn` never does: a capture that fails is `untold`, said why, the round a
  covered miss and the poll goes on — exactly the poll before the eyes, where a covered element took no capture (a
  refused capture still ends the poll where the round measures). An answer that keeps the element covered (no pair
  `over`: C's `under`, or an `untold` judged on a settled frame) is kept while the tree reads the same
  (`ui-tree/read-tree.ts#treeFingerprint` and the question's pairs), so a covered element captures ONCE per distinct
  tree, not every round; an answer that unlocks is never kept — that round measures the very frame it was judged on,
  so keeping it saves nothing, and each round's unlock rests on its own frame.
- Wired at the composition roots with `verify/eyes.ts#eyesOn` (`mcp/tools.ts#guardOpts`, `flow/engine.ts`'s
  `acting`), as the first question is; interact/ imports no verify/.

WHAT is asked, per `unordered` cover (a peer): where the two overlap (in the standing's frame), each one's CLEAR BANDS
along the overlap's edges (the strips of it beside the overlap, outside the other by construction, each no deeper than
the overlap on that axis, none meeting another cover of the target), what lies AROUND each control beside each band
(the strips just outside it past the edge the band faces and sideways past its side edges on the band's rows, each as
deep as the band: `nodeAround`, `peerAround`), and the screen beside the two on the overlap's rows. Bands, not each control's largest clear rect: mp-native's chooser row's largest clear rect is the 4-pt gap
between the card's rows — a surface of the other layer.

THE JUDGE — asymmetric on purpose: telling the PEER on top only confirms a refusal; telling the TARGET on top unlocks a
tap. Each rule answers `untold` (the listing's untold order, the refusal kept) wherever its evidence is missing; what
one frame cannot tell apart at all is listed under Residuals (7.):
1. each side's bands, landed in the png one pixel in from each edge, at least 4 png px (`FLANK_MIN_PX`) on both sides;
   none — untold;
2. each side ONE colour: every band's dominant at least half of it, all of a side within ΔE00 1.0 (`EYES_SAME_DE`) —
   else untold (a side showing two surfaces, the chooser's shape, is not read);
3. THE OPACITY GUARD: what lies around each control — the strips just outside it beside each band (past the edge the
   band faces, and sideways past its two side edges on the band's rows, each as deep as the band, each read whole and
   as its thin slice against the control — one png pixel skipped for the antialiasing, then 4 px, `FLANK_MIN_PX`), and
   the screen beside the two (`beside`). No screen beside (two rows as wide as the screen), or nothing around a side on
   the screen, untold; a side's colour on a quarter or more of any such strip or slice (`AROUND_SHARE`, within ΔE00
   2.0, `EYES_APART_DE`), untold: that control may draw nothing there, its band showing what lies behind it — a text-only
   button over a coloured row lets the row show through the overlap, which would read as the row on top while a tap
   there hits the button; over an inset card the card runs on past the button's edge, ahead or sideways, though the
   screen beside the two is grey, and a run-on of two png pixels fills a slice (review rounds 1–3,
   tests/verify/eyes-order.test.ts: 11 pt sideways, 3 pt both sides, 2 pt one side, 2 pt ahead). The lab: 0.000 of
   every strip and every slice (W's teal against the grey gap and K above W and the screen beside it, C's blurred green
   against the blurred backdrop below and beside C) — the blur's edge and any antialiasing come nowhere near either
   colour within ΔE00 2;
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
a screenshot shows (the two are listed in reading order)" (`geometry.ts`'s `seenOverText` and `drawnOverSeenText` then; since round 10 the `seenOver` case of
`cover.ts#coverClause`). An
`unordered` remedy a screenshot looked at carries why it could not tell (`why`), and its words drop "see a
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
- The review fixes after it (`85e36215`, `a374227a`, `0f28b4cf`) change no golden reply: 217 mismatches at `0f28b4cf`,
  as at `1ef11b9c`.
- Unit and table tests: tests/verify/eyes-order.test.ts (the judge over both lab pngs and synthetic pngs for every
  untold rule — the inset card ahead of and sideways past the peer, run-ons of 2–3 pt read by the slices, a band of no
  one colour, sides only just apart, residuals 2 and 7 pinned; a horizontal overlap's bands and strips; the question's bands
  and the strips around them on the lab trees and on mp-native's chooser; the colour assert's capture count, its
  answer kept per distinct tree and an unlocking answer never kept (W on top, then C), and its frames unsettled, settled over the region only or failing — untold, the poll
  going on),
  tests/ui-tree/draw-order-reading-order.test.ts (the seen order into the draw order, both ways, and untold = no
  screenshot), tests/interact/remedy-agreement.test.ts (one remedy for C, W reached, by the tap, the colour assert and
  `scroll_until`), tests/flow/engine.test.ts (a flow tap on W, the engine's wiring; no screenshot for an uncovered
  target or one under an ordinary cover).
- Live on the lab simulator: see the bug note's Status and docs/truth/live-ios-2026-10-18-visibility.md (round 9's
  section).

## Residuals

1. **Alike looks** (two white rows, no dim, no shadow): untold, today's refusal — the safe direction. Such menus' rows
   stay refused; the lab's blur and mp-native's dim are what give the signal.
2. **A transparent top control over a surface ending within a pixel of its edges**: the opacity guard reads a band
   against what lies around its control — past the edge the band faces and sideways past its side edges on the band's
   rows, each strip whole and as its thin slice against the control — and against the screen beside the two (review
   round 1 widened it from the screen alone, which an inset card under a text-only button passed; round 2 added the
   sideways strips, which a card running on 11 pt past the button's sides passed; round 3 added the slices, which a
   run-on of 2–5 pt, diluted in a strip as deep as the band, passed). A run-on of two png pixels along an edge fills its
   slice. What still passes: a text-only button over a surface that ends within ONE png pixel of its edges — its own
   frame, or that frame and the antialiased pixel every slice skips — in a colour neither the screen beside nor any
   strip shows; or one whose run-on covers less than a quarter of every strip and slice along each edge. Its band, the
   strips and the screen beside are then pixel for pixel what an opaque control of that colour would show — the class
   of residual 7: no rule of one frame can tell it, and it reads `over`, a `Tapped` that may hit the button. Pinned as
   told (`RESIDUAL`, tests/verify/eyes-order.test.ts: the frame, and the frame and a pixel). Not measured by a lab cell
   (a cell `presented/plain-button-over-row` would measure the common shape).
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
7. **A two-tone peer on top, split at the target's edge** (review round 1): a peer drawn over the target whose part over
   the overlap is the target's own colour (within ΔE00 2) and whose part past the target's edge is another — its colour
   boundary lying exactly on the target's edge — is pixel for pixel the frame of the target drawn on top: the overlap,
   both bands and every strip around read the same, and no seam differs (where the peer's own edge crosses the target,
   the two colours are one). No rule of one frame can tell it; it reads `over`, a `Tapped` that hits the peer. It needs
   three coincidences — a peer drawn in two tones, one matching the target, split on the target's edge — and is pinned
   as told in tests/verify/eyes-order.test.ts (`RESIDUAL`) so a change that closes it is seen. Only another signal
   (a device hit test, Rejected below as the mechanism) could close it.

## Rejected

- A tree tell (traits, WDA attributes, idb fields): none differ.
- A geometric heuristic (a stacked card run): fits ordinary lists; untestable beyond one cell.
- idb `describe-point` / WDA `hittable`: platform-split, live-only, slower, idb's stuck mode, SwiftUI hit-test semantics
  unmeasured — worth one live measurement as corroboration later, not as the mechanism.
- A settled pair for the tap's and the stop's question: doubles the cost of a decision that already fails safe on motion.
- An async draw order, or a screenshot inside the parser: the draw order must stay pure and replayable; the seen order
  is an input.
- A separate order port beside `Eyes`: two ports for one adapter that takes and scales the same screenshot
  (`OrderEyes` is only `Pick<Eyes, 'order'>`, the face of the one port a verb is handed).
- A screenshot on every tap: one capture and decode per tap (an ESTIMATE of a few hundred ms on the simulator — the
  live records, `docs/truth/live-records/ios-vis-r9-l4w-*.json`, keep replies, not timings) for 6 targets in 153 trees.
- Keeping an answer that unlocks across the pixel poll's rounds: that round measures the frame it was judged on, so
  keeping it saves no capture, and it would let an unlock outlive the pixels it rested on.
