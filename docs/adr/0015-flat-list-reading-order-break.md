# 15. A reading-order break in idb's flat list ends what covers a content target

Status: accepted, 2026-10-09 (owner). Amended 2026-10-19 (owner, round 8, L4: the menu row's false refusal accepted as a residual): two
controls overlapping in a reading-order listing are covers of each other whose order is not told — see "Amendment:
covers listed before the target" below. The reading BREAK below still meets idb's flat list only; the amendment's rule
meets WDA's nested tree too (its residual "WDA's nested tree and Android's never meet this rule" holds for the break
alone). Amended again 2026-10-19 (round 9) by docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md:
a screenshot tells the order the listing does not — the amendment's first residual closed, its second narrowed (below).
Amended 2026-10-20 (round 14, LE3): a heading listed before a target it overlaps is drawn over it — see "Amendment: a
heading listed before" below. Amended 2026-10-22 (round 16, LE2's rest): the break no longer excuses a control that overlaps the
target and holds its centre — see "Amendment: a control past the break that holds the centre" below.

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
  bottom (`bottomPinned`'s shape), are its covers whose ORDER is not told (`reading-order.ts#readingOrderOf`):
  - those listed BEFORE it are covers of it when one of them holds its centre (the draw order alone gives them not):
    C, under W. Only then: siblings that only overlap the target's edges by a few points (a card's shadow, an avatar
    stack, a badge) would else fail its colour assert and every `fully` stop on a cover that may lie beneath it;
  - those listed AFTER it are covers by the draw order already, and are named so too where they hold its centre: W,
    under C. One that only pokes over its edge (a floating button in idb's flat list, not pinned by shape) keeps the
    draw order's remedy, a scroll;
  - and a tap moved off a covered centre is never aimed at one listed before it, cover or not (`Exposure.tapAt`,
    `largest`): W `51,690 300x40` listed before C `51,700 300x120` under a pinned Continue had C's tap moved to
    (201,720), on W — now refused, only a 300x10 part of C clear of both.
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

- ~~The menu row listed BEFORE the row it is drawn over is still covered by that row, listed after it: W is refused
  under C (a false refusal, the safe direction), its reply saying the order is not told and to look at a screenshot;
  W's live tap stays LOUD (`tap:blur-menu.W`, live-known.ts).~~ Closed by ADR 0024 (round 9, `1ef11b9c`): the eyes see W
  drawn over C on one screenshot — W is tapped, C refused as under W, seen so; live ok under idb and WDA.
- Two overlapping controls of a reading-order run that are really drawn in list order (a later card over an earlier
  one) both refuse a tap at the overlap where it holds the centre: a false refusal — since ADR 0024 only where a
  screenshot cannot tell them apart (they look alike, a side shows the screen's own colour, a frame mid-animation, rows
  as wide as the screen); where it can, the one on top is tapped and the other refused naming it. Since the WDA mark is a sort
  check, this reaches UIKit screens too — a row's accessory or a badge poking out of its control with its centre on
  that control reads as covered (a refusal, a failed colour assert, no `fully` stop), never as a wrong tap.
- A row under an in-screen menu whose centre lies clear of the menu's rows is still `Tapped` at its centre, on the
  backdrop that has no node (ADR 0018 residual 9): the amendment closes C's direction only where a menu row holds the
  centre. Nor is a sibling listed before a target and overlapping only its edge a cover of it: a colour assert there
  may sample it.
- Same-top siblings (2026-10-22, round 16): in a reading-order run WDA lists siblings of the same top in draw order
  (measured on four SwiftUI probes, ADR 0018's "Amendment: an in-window backdrop"). Only WDA's backdrop rule
  (adapters/wda-source.ts#inWindowBackdrops) reads that tie as draw order; the cover rule here keeps it untold, the
  safe direction (a refusal, never a wrong tap).

## Amendment: a heading listed before (2026-10-20, round 14, LE3)

### Context

SwiftUI lists a section's header FIRST and pins it (`LazyVStack(pinnedViews: [.sectionHeaders])`) over the rows
scrolled under it, drawn on top. The lab's `scroll-sticky` (`tests/fixtures/truth/ios-iphone17-ios27/scroll-sticky.*`):
the header `0,110 402x56` is listed before the row R `51,142 300x64`, scrolled 24 pt under it — 62.5 % of R drawn, its
centre `(201,174)` clear. Read as draw order the header was beneath R, and neither rule above gave it as a cover: it is
no control, it does not hold R's centre, and on idb it lies before the content (ADR 0004's bar). So the colour assert
passed on a sample a third of which is the header's grey, and `fully: true` called R "fully visible" where it is — on
idb and WDA alike. Both sources mark the header with the Header trait (idb `traits` `["StaticText", "Header",
"Scrollable"]`, type `Heading`; WDA `traits` `"Header, StaticText"`); SwiftUI gives it to a `Section`'s header itself.

### Decision

- The parsers keep the trait as `UiNode.heading` (`ios-tree-source.ts#idbTree`, `wda-source.ts#toUiNode`). The TRAIT,
  not idb's type `Heading`: the trimmed mp-native fixtures (`idb-modal-listed-before-content.json`,
  `idb-swift-form-*.json`) give that type to nodes whose traits were not recorded, and reading it would make covers of
  their date headers and value-date picker.
- In a listing given in reading order (`UiNode.readingOrder`), a sibling that is a heading, listed BEFORE a target and
  overlapping it past the slack — neither holding the other whole nor of its frame — is drawn over it: a cover whose
  order is TOLD (`drawn`; `reading-order.ts#headingsOver`, joined to `before` by `readingOrderOf`). A row is never drawn
  over its section's header, so nothing is left untold and no screenshot is asked; the remedy is the draw order's,
  a scroll (`scroll_until … fully: true`) — on idb's flat list, which lists no scroll view, with its added clause for a
  cover no scroll moves the target out from under.
- No gate on where it overlaps (not only over the centre: a pinned header hides a row's top, what the colour assert
  samples and `fully` claims), on the target's kind (any target, not only a control), nor on ADR 0004's bar (on idb the
  header at the list's top reads as bar chrome). A target pinned at the screen's bottom keeps its place on top, as for
  the controls above. A heading listed AFTER the target is a cover by the draw order already. A heading listed before
  is judged by this rule, not as a control peer, even when interactive.
- `ui_snapshot` prints the mark: an iOS node carrying the trait carries `"heading": true` (an added key; its tool
  description names it).
- `reading-order.ts` is the one owner of "listed before, but drawn over" in a reading-order listing (moved out of
  `draw-order.ts`, 003edf31); `exposure` asks it once per target.

Measured: golden over the truth corpus against `a922fec4`, 6 checks change, all scroll-sticky's R: colour and `fully`
green on idb and WDA (`FAIL … "Sticky header" (0,110 402x56) is drawn over the element`; `fully: true` refused under the
header, 63 % of it shows, the replay's three strokes then the exhausted reply), and the plain `scroll_until` still ok,
now worded "visible after 0 swipes — PARTLY UNDER … 63% of it shows, its centre clear"; R's tap unchanged (`Tapped`
at its clear centre); 0 new mismatch. Over every iOS tree of `tests/fixtures`, R is the one target that gains a cover
(`tests/ui-tree/heading-listed-before.test.ts`); the 64 native iOS trees of the truth corpus
(`tests/fixtures/truth/ios-iphone17-ios27`, idb and WDA) hold 20 headings, and only scroll-sticky's overlaps a sibling
listed after it. The golden's replay of `fully: true` on R ends in the exhausted reply ("… at the end of the content — a
layout defect"): the replay is one static tree, which no stroke moves; on the lab simulator R scrolls out from under the
header (live 6 of 6 ok). The rejected alternatives: every overlapping earlier node a cover (golden turned two green rows red —
form-keyboard's submit tap on idb, and a `scroll_until` read under the phone field), a header pinned at its scroll view's top by
geometry (idb lists no scroll view), and the eyes per tap (a capture each; a header as wide as the screen leaves no
side to compare).
docs/bugs/2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md

### Residuals of the amendment

- An overlay pinned over rows listed after it that carries no Header trait (a custom sticky bar, a banner) is still
  beneath them by the listing: a false "clear".
- UIKit's floating section headers are not measured. They do carry the trait (Contacts' collection view, in
  `tests/fixtures/wda-capture-contacts-*.json`: section header cells "a", "b", "h", … traited `Header`), but WDA's sort
  check marks such a run as reading order only when its tops never decrease, and those runs fail it (their order is
  kept as draw order), so a UIKit header floating over a row listed after it is judged by no capture.
- idb names the header `other "Sticky header"` (its `Heading` type maps to no role), WDA `text "Sticky header"`: the
  cover clause words the same node two ways per source. Cosmetic; accepted, not changed (mapping the type would change
  snapshot replies).
- A target held whole by a heading listed before it (a row shorter than the pinned header, scrolled wholly under it)
  gains no cover: the rule keeps the own-content exclusion (a heading holding the target whole may be its section
  title band around its own button), so such a row reads clear where it is hidden — a false "clear", unmeasured (R,
  64 pt, is taller than the 56 pt header).
- A menu, toast or popover listed after a heading it lies over is now still covered by the heading where they overlap
  apart: a false refusal, the safe direction.

## Amendment: a control past the break that holds the centre (2026-10-22, round 16, LE2's rest)

### Context

The break's last residual ("a menu, sheet or popover listed after the content that starts ABOVE a content target is no
cover of it … a false clear: the tap may press the menu") had a harmful shape under idb, which lists no scroll view
(docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md, ADR 0010's residual 5):
the lab's `scroll-bounded-footer` O `51,620 300x64`, a row past its scroll view's clip, is listed BEFORE a `Continue
16,600 370x56` under the clip whose top (600) lies above the row's (620) and which holds its centre (201,652). The
break excused Continue — and everything after it — as a cover, so `tap O` was `reachable` at (201,652), on Continue,
and `Tapped O` FIRED Continue (the lab probe: `button footer.continue`); the colour assert passed on Continue's colour;
the plain stop said visible. The listing cannot tell this shape from a modal's row listed before the list row it is drawn
over: mp-native's chooser `row_swift`, whose centre the transaction row `row_0` (listed after, drawn UNDER the chooser)
holds, is the same pair of facts.

### Decision

A reading-order break excuses the later nodes as covers EXCEPT a control that overlaps the target and holds its centre
(reading-order.ts#ReadingOrder's `coversAfter`: `peersOf`'s `unordered` or `seenOver` listed after the target, read by
the break's own row, draw-order.ts#NOT_DRAWN's `flatListReadingOrder` — every other row's excuse stands): such a
control is a cover whose order is not told (cover.ts#CoverOrder's `untold`), as an overlapping control listed before it
already was. A target that is itself a flat list's bottom chrome (a floating tab bar's item) has no reading-order peers at all
(`peersOf` answers none — before, after or to keep a moved tap clear of): the bar is drawn over the rows (tabbar-dense's items, `Row 8` listed after them over their centres). Whether it is drawn over the target (a menu) or the target is cut by a clip beneath it (a row past its
scroll view) is the order question ADR 0024's eyes answer — that question is reused as is; there is no new interface.
The cost lies on that shape only — one screenshot per plain stop where a control listed after the target holds its
centre, and per tap only where no tappable piece is left clear of it (O's tap moves clear to (201,670) and asks
nothing; W's and `row_swift`'s ask); the colour assert asks on the frame it measures, none added. This amendment owns
that measurement (ADR 0010's residual 5 and ADR 0024's third trigger cite it): over every iOS tree of the committed
fixtures (103 trees, 5498 nodes, each judged as a target; pinned in tests/ui-tree/draw-order-reading-order.test.ts,
"the untold covers listed after their target") the untold covers listed after a target are six pairs, four of them
the rule's — the new cell's O; the lab's in-screen menu W in `blur-menu-grouped` (the L4 shape, ADR 0024's own: its
screenshot sees W over C — tap and plain stop unchanged, one screenshot each where they took none); mp-native's
chooser `row_swift`; and S of `chooser-over-list`, the chooser rebuilt in the lab (refused: the eyes cannot tell it,
below) — and blur-menu's W under C (idb and WDA), untold before the rule.

Measured (golden against `4ee14f1c`, 1425 checks): 0 checks changed on the existing corpus; the new cell's colour row
fails closed, its plain stop refuses before any swipe, its tap moves clear of Continue to (201,670), nothing fires
(live, idb: `ios-vis-r16-le2-1.json`). Six existing tests move with mp-native's `row_swift` (untold under `row_0`;
reachable at (201,479) when the screenshot sees `row_0` under).

### Residuals of the amendment

- ~~A control listed after the target and above it, holding its centre, is excused as a cover (the break's residual).~~
  Closed for controls over the centre. A control over the target's edge only (not its centre), a non-control (text), and a
  menu or sheet that lies clear of the centre stay excused, as before.
- The tap still says `Tapped` for a row past a clip with nothing listed beneath it, and for this one moved clear of
  Continue — on the background (ADR 0010's residual 5, narrowed).
- **A false refusal, accepted** (2026-10-22, round 16's orchestrator for the owner; docs/truth/open-bugs.md,
  Priority 3): under idb a modal or sheet row listed before the content drawn under it, where a content control holds
  its centre — mp-native's chooser `row_swift` under `row_0`, the pattern this ADR was written for — is an untold pair:
  it costs one screenshot per tap and plain stop, and where the eyes cannot tell it is refused (tap, plain stop and
  colour assert: "which is drawn on top is not told"; nothing tapped, no swipe). `row_swift` was `Tapped` at its
  centre before (correctly: this ADR's founding capture). MEASURED on real pixels (round 16's code review), on the
  lab's rebuild of the chooser at its geometry — `presented/chooser-over-list`: a white card `24,381 354x140` of white
  option rows O `45,397 312x52` and S `45,453 312x52` over a list dimmed 40 %, its date headers `0,y 402x29` and white
  rows `24,y 354x52`, R (`row_0`) `24,435` holding S's centre; idb lists the card's rows first, exactly as the founding
  capture (tests/fixtures/truth/ios-iphone17-ios27/chooser-over-list.*): the eyes CANNOT tell. S's band below the
  overlap (487–505), the overlap, and R's bands — above it (435–453, on O and the card between) and beside it (24–45,
  357–378, on the card's padding) — all read the card's white: "it shows the colour around it #FFFFFF beside the
  overlap: it may draw nothing there" (tests/verify/eyes-order.test.ts). Live under idb, `tap S` refused and nothing
  fired, in two runs of two (docs/truth/live-records/ios-vis-r16-le2-2.json, -3.json; the live golden's LOUD, a target a
  tap reaches refused); O `Tapped`; R refused. Under WDA the card is listed over the list: S `Tapped`. Why accepted: the
  refusal is the safe direction against a measured tap that fired the wrong control (scroll-bounded-footer's
  Continue), and no tree-level rule separates the two (the review tried two: a break more than the target's height
  above it refuses the chooser's `row_own` and the picker's `Value date`; "the break node itself holds the centre"
  lets a footer label listed before Continue bring the harm back). Remedy: `treeSource: wda`. Not measured: a card no
  wider than its rows (45–357), whose row's side strips would show the dimmed list — the eyes may tell it there. The
  way out not taken: teach ADR 0024's question to read a peer's bands that show something else — a design change.
