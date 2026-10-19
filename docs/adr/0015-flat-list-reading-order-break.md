# 15. A reading-order break in idb's flat list ends what covers a content target

Status: accepted, 2026-10-09 (owner). Amended 2026-10-19 (round 8, L4; owner's decision in the round's brief): two
controls overlapping in a reading-order listing are covers of each other whose order is not told — see "Amendment:
covers listed before the target" below. The reading BREAK below still meets idb's flat list only; the amendment's rule
meets WDA's nested tree too (its residual "WDA's nested tree and Android's never meet this rule" holds for the break
alone).

## Context

idb lists in reading order WITHIN a container, not in draw order. On mp-native's Account Detail it lists the
payment-type chooser — a card drawn over the dimmed screen, with no node of its own for the card or the backdrop — in
the MIDDLE of the screen's content: after the action buttons come its rows `row_own 45,397 312x52` and
`row_swift 45,453 312x52`, then the transaction list it is drawn over (`filter_icon 348,358`, `date_header_0 0,399`,
…). Read as draw order, the list behind covered the chooser, and `tap` refused `row_swift`. It was a regression of the
chrome-before-content rule (ADR 0004), which only excuses content ending inside the top bar's band.

A top-at-or-below rule (a later node covers only when its top lies at or below the target's) is not enough:
`date_header_0`'s top 399 lies below `row_own`'s 397.

## Decision

In a flat list (`UiNode.flatList`), the first node listed after a CONTENT target whose top lies ABOVE the target's top
is where idb resumes listing another container (`readingBreak`). Nothing from there on covers the target, unless it is
the list's bottom chrome: pinned at its bottom, idb's keyboard, or a floating tab bar's item. Between the target and the
break nothing changes: the pinned CONTINUE, listed last, still covers `priority_select`. Nodes of no area never break.
The row is `ui-tree/draw-order.ts`'s `flatListReadingOrder`, and only the `target` question asks it.

## Residuals accepted

- A menu, sheet or popover listed after the content that starts ABOVE a content target is no cover of it, nor is
  anything listed after it. The result is a false "clear": the tap may press the menu.
- A floating label listed after its field and above it ends the field's covers; only a pinned bottom bar still counts
  after it.
- A pinned bottom bar of the content behind a modal still covers the modal's rows where it reaches them. That is a
  false refusal, the safe direction.

## Amendment: covers listed before the target (2026-10-19, round 8)

### Context

The premise "later in the list = drawn later" is false where iOS lists siblings in READING order: the lab's
`presented/blur-menu` lists its six buttons `A 110, B 290, K 380, W 448, C 470, D 650` — flat under idb and as the
siblings of one `Other` under WDA — while the menu row W is drawn over C by `zIndex`. No reading break follows C (D
starts below it), so W, listed before, was no cover of C: C's centre (201,502), on W, read clear, `tap` answered
`Tapped` and the tap fired W (the unsafe direction); the colour assert passed on W's colour. And C, listed after W,
still covers W as draw order — W is refused (a false refusal). WDA's tree meets this rule's shape after all: SwiftUI's
container lists flat there too.

### Decision

- A listing is taken as in reading order where the parsers mark it (`UiNode.readingOrder`): idb on its flat list's
  root (`ios-tree-source.ts#markIdbDialect` — idb lists in reading order, this ADR); WDA on every node whose two or
  more children's tops never decrease in the order listed (`wda-source.ts#markWdaDialect`). On WDA that is a SORT
  CHECK, not a fact WDA states: most top-to-bottom layouts pass it, UIKit's (which lists in draw order) among them; a
  run listed out of top order is surely no reading order and keeps its order as draw order (Contacts' new-contact
  form, whose run lists an image at y 62 after a button at y 319). Android's trees are not marked.
- In such a run, the interactive siblings of a control target that overlap it past the slack — neither holding the
  other whole nor of its frame — in idb's flat list from its content on (ADR 0004's top bar stays chrome) and none of
  its bottom chrome (a tab bar's items are covers by their own rule), on a nested tree none pinned at the screen's
  bottom (`bottomPinned`'s shape), are its covers whose ORDER is not told (`draw-order.ts#readingOrderPeers`):
  - those listed BEFORE it are covers of it when one of them holds its centre (the draw order alone gives them not):
    C, under W. Only then: siblings that only overlap the target's edges by a few points (a card's shadow, an avatar
    stack, a badge) would else fail its colour assert and every `fully` stop on a cover that may lie beneath it;
  - those listed AFTER it are covers by the draw order already, and are named so too: W, under C.
- Never for a target PINNED at the screen's bottom (`bottomPinned`'s shape, on either listing): a pinned bar is drawn
  over what scrolls under it, listed before it or not — the pinned-bar cell's Continue (idb and WDA), the text-under-bar
  cell and the SWIFT form's CONTINUE keep their covers as before.
- Such a cover is named `unordered` (`Exposure.unordered`), and where it is the one a verb names, the remedy is no
  scroll (`standing.ts#Remedy`'s `unordered`, second in the precedence, after a presented screen): the verbs say
  "overlapped by …, the two listed in reading order: which is drawn on top is not told" and "no scroll tells which is
  on top: see a screenshot — if the other is drawn over it (a menu, a popover), close it first; if it is the one on
  top, tap it by coordinates" (the pixel assert: "… assert something in it that lies clear of the other"), and
  `scroll_until` stops before any swipe (or without swiping further). A stroke beside an in-screen menu lands on its
  backdrop; a wrong remedy wastes the agent's swipes.

Measured: golden over the truth corpus, 15 replies change against `fix/round-8` (`e0c2587e`): C's tap, colour and
`scroll_until` on blur-menu.idb, blur-menu.wda and blur-menu-grouped.idb (Tapped / PASS / fully visible → refused /
FAIL / stopped before any swipe), and W's tap, colour and `scroll_until` on blur-menu.idb and blur-menu.wda (refused,
now worded as overlapped, the order not told; `scroll_until` stopped before any swipe, where it swiped three times);
0 new mismatch. Over every tree of `tests/fixtures`, the one other target that gains such a cover is mp-native's
`Loan repayment` row in this ADR's own capture (`idb-modal-listed-before-content.json`, the chooser), now under
`To my account` and `SWIFT payment` listed before it — which it lies under (correct). Live: C's tap refused under idb
and WDA, nothing fired (docs/truth/live-ios-2026-10-18-visibility.md, round 8's L4 section).
docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md

### Residuals of the amendment

- The menu row listed BEFORE the row it is drawn over is still covered by that row, listed after it: W is refused
  under C (a false refusal, the safe direction), its reply saying the order is not told and to look at a screenshot;
  W's live tap stays LOUD (`tap:blur-menu.W`, live-known.ts).
- Two overlapping controls of a reading-order run that are really drawn in list order (a later card over an earlier
  one) both refuse a tap at the overlap where it holds the centre: a false refusal. Since the WDA mark is a sort
  check, this reaches UIKit screens too — a row's accessory or a badge poking out of its control with its centre on
  that control reads as covered (a refusal, a failed colour assert, no `fully` stop), never as a wrong tap.
- A row under an in-screen menu whose centre lies clear of the menu's rows is still `Tapped` at its centre, on the
  backdrop that has no node (ADR 0018 residual 9): the amendment closes C's direction only where a menu row holds the
  centre. Nor is a sibling listed before a target and overlapping only its edge a cover of it: a colour assert there
  may sample it.
