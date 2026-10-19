# 15. A reading-order break in idb's flat list ends what covers a content target

Status: accepted, 2026-10-09 (owner). Amended 2026-10-19 (round 8, L4; owner's decision in the round's brief): a
control listed BEFORE a control target in a reading-order listing, overlapping it, covers it — see "Amendment: covers
listed before the target" below; the residual "WDA's nested tree and Android's never meet this rule" dropped.

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

- A listing is in reading order where the source says so: the parsers mark it (`UiNode.readingOrder`) — idb on its
  flat list's root, WDA on every node whose two or more children's tops never decrease in the order listed (a run listed
  otherwise keeps its order as draw order: Contacts' new-contact photo, `Add photo 113,132` listed before
  `Remove photo 235,129`). Android's trees are not marked.
- In such a run, an interactive sibling listed BEFORE a control target that overlaps it past the slack — neither
  holding the other whole nor of its frame — covers it (`draw-order.ts#readingOrderCovers`): in idb's flat list from
  its content on (ADR 0004's top bar stays chrome) and none of its bottom chrome (a tab bar's items are covers by their
  own rule).
- Never for a target PINNED at the screen's bottom (`bottomPinned`'s shape, on either listing): a pinned bar is drawn
  over what scrolls under it, listed before it or not — the pinned-bar cell's Continue (idb and WDA), the text-under-bar
  cell and the SWIFT form's CONTINUE keep their covers as before.
- Such a cover is named `unordered` (`Exposure.unordered`): its order against the target is not told, so the remedy is
  no scroll (`standing.ts#Remedy`'s `unordered`) — the verbs say "overlapped by …, the two listed in reading order:
  which is drawn on top is not told" and "see a screenshot — if the other is drawn over it (a menu, a popover), close
  it first". A stroke beside an in-screen menu lands on its backdrop; a wrong remedy wastes the agent's swipes.

Measured: golden over the truth corpus, 9 replies change (C's tap, colour and `scroll_until` on blur-menu.idb,
blur-menu.wda and blur-menu-grouped.idb, now refused under W), 0 new mismatch; over every tree of `tests/fixtures`,
the one other target that gains such a cover is mp-native's `Loan repayment` row in this ADR's own capture
(`idb-modal-listed-before-content.json`, the chooser), now under `To my account` and `SWIFT payment` listed before it
— which it lies under (correct). Live: C's tap refused under idb and WDA, nothing fired
(docs/truth/live-ios-2026-10-18-visibility.md, round 8's L4 section).
docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md

### Residuals of the amendment

- The menu row listed BEFORE the row it is drawn over is still covered by that row, listed after it, as draw order:
  W is refused under C (a false refusal, the safe direction). The listing does not tell which of the two is on top,
  so each covers the other; W's live tap stays LOUD (`tap:blur-menu.W`, live-known.ts).
- Two overlapping content controls of a reading-order run that are really drawn in list order (a later card over an
  earlier one) both refuse a tap at the overlap: a false refusal.
- A normalized idb capture older than the root's mark (a `ui_snapshot` from before 2026-10-19) is judged without the
  rule by the differential harness (scripts/differential/recorded-source.ts).

## Bug note

docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md

This note is not tracked yet. The measurements are recorded above.
