# 15. A reading-order break in idb's flat list ends what covers a content target

Status: accepted, 2026-10-09 (owner). Amended 2026-10-19 (owner, round 8, L4: the menu row's false refusal accepted as a residual): two
controls overlapping in a reading-order listing are covers of each other whose order is not told — see "Amendment:
covers listed before the target" below. The reading BREAK below still meets idb's flat list only; the amendment's rule
meets WDA's nested tree too (its residual "WDA's nested tree and Android's never meet this rule" holds for the break
alone). Amended again 2026-10-19 (round 9) by docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md:
a screenshot tells the order the listing does not — the amendment's first residual closed, its second narrowed (below).
Amended 2026-10-20 (round 14, LE3): a heading listed before a target it overlaps is drawn over it — see "Amendment: a
heading listed before" below. Amended 2026-10-22 (round 16, LE2's rest): the break no longer excuses a control that overlaps the
target and holds its centre — see "Amendment: a control past the break that holds the centre" below. Amended 2026-11-09 (D75, lab note LR4):
uiautomator's runs of classic Android Views are marked too — see "Amendment: Android Views list children by location" below.

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

1. A menu, sheet or popover listed after the content that starts ABOVE a content target is no cover of it, nor is
   anything listed after it. The result is a false "clear": the tap may press the menu.
2. A floating label listed after its field and above it ends the field's covers; only a pinned bottom bar still counts
   after it.
3. A pinned bottom bar of the content behind a modal still covers the modal's rows where it reaches them. That is a
   false refusal, the safe direction.
4. **idb does not see React Native's covers** (round 9, accepted by the owner 2026-10-25, with the amendment's rules
   applying to every WDA run in reading order, SwiftUI's and UIKit's too; the amendment "React Native's covers listed before
   the target" below): idb lists no bare View, and reads a cover above its flat list's top-bar line as the bar — the lab's
   rn-banner under idb: every tap `Tapped`, every colour assert passing on the cover. Remedy: `treeSource: wda`.
5. **React Native's role-carrying container leaves LR4's lie on Android** (D75 round 1, not narrowed by the owner;
   numbered 2026-11-11, D85; the amendment "Android Views list children by location" below, its React Native role
   residual): a View whose accessibility role React Native dumps as `android.view.View` (`toolbar`, `alert`, `header`,
   `tablist`, …) reads as a node provider's host (android.ts#providesNodes), so the uiautomator parser marks nothing
   under it, and a target with its later-drawn cover inside it keeps the location order as draw order — the lab's
   rn-banner-role (D77, captured live 2026-11-11): every tap `Tapped` at the centre, on the cover, every colour assert
   passing on the cover. A false `Tapped`, the unsafe direction; no remedy (not narrowed).

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
fixtures (111 trees, 5581 nodes, each judged as a target — since the merge with round 16's in-window backdrop, whose
probes added eight; 103 and 5498 on bugs/r16-le2 alone; pinned in tests/ui-tree/draw-order-reading-order.test.ts,
"the untold covers listed after their target") the untold covers listed after a target are eight pairs, six of them
the rule's — the new cell's O; the lab's in-screen menu W in `blur-menu-grouped` and in that round's two probes of it,
`blur-menu-stacked` and `blur-menu-unhidden`, under idb (the L4 shape, ADR 0024's own: its screenshot sees W over C —
tap and plain stop unchanged, one screenshot each where they took none); mp-native's
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

## Amendment: React Native's covers listed before the target (2026-10-25, round 9, LR3)

Lab note LR3 (docs/bugs/2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md):
WDA lists React Native's views by their tops, in one run it marks `readingOrder`, so a LATER JSX sibling drawn over the
target — a toast, a banner — whose top lies above the target's is listed BEFORE it. Measured on the lab's rn-banner
(the react-native family, `declared: covered`): T.cover "Saved" `31,100 340x52` before T `51,110 300x64`, U.cover (a bare
View, its testID only) `31,280` before U; C.cover `31,480` after C `51,470`. Every tap was `Tapped` and every colour
assert passed on the cover (`#263238`): the reading-order peers were controls only (T is a Pressable, WDA's `Other`),
and a childless NAMED leaf was excused as structural (C.cover, U.cover).

Decided (owner, 2026-10-25, round 9):

1. **Under WDA** (a nested run in reading order, reading-order.ts#listsNestedReadingOrder — not idb's flat list), a
   sibling listed BEFORE the target that draws there by the draw order's `target` column is a peer of any target,
   control or not: a cover whose order is not told, which the eyes tell (ADR 0024) — reading-order.ts#peersOf,
   `ReadingOrderAbout.drawn`. Judged by every row but the own-content one (`onTarget`: a peer listed before overlaps the
   target apart, so it is none of its content — a toast narrower than the row it lies over stays a cover, the review's
   shapes), and the field's OWN floating label excused by ADR 0014's relation seen from the field (draw-order.ts
   #ownLabelOf: a text spanning the height of the text input the target is — rn-field's M label `69,491 175x23` before
   its field's wrapper `69,492 264x20`).
2. **Under WDA, a childless node the app named (an identifier) is drawn** — no structural excuse (placed.ts
   `FRAME_EXCUSES.structural`, `inWdaRun`) — unless it holds a sibling of its own whole: WDA's flattening of an RN View
   lists its content as its siblings (myport's `login_username_field 36,339 330x80` and the field row it wraps).

Golden: rn-banner's six WDA rows green (T and U refused "drawn over it as a screenshot shows", C refused "drawn over
it"); nothing else changed over the corpus; calibrate: LR3 CALIBRATED. Live on the lab simulator, twice: under WDA T, U
and C refused, nothing fired; under idb each `Tapped`, nothing fired (residual 4); rn-field's visibility (6 of 6) and
the RN forms group (12 of 12) unchanged (docs/truth/live-records/ios-rn-*-lr3*.json).

### Residuals accepted

- **idb** (residual 4 above; rn-banner's six idb rows, KNOWN): idb lists no bare View (U.cover, C.cover are not in its list), and T's
  toast, ending at 152 above the flat list's top-bar line, is read as its top bar (ADR 0004). Neither rule above applies
  to idb's flat list: there a modal is listed before the screen beneath it, its frame over form rows measured clear
  (mp-native's value date picker, tests/verify/assert.test.ts), and a transparent field is a named leaf listed after the
  label it lies over (rn-field's M). Remedy: `treeSource: wda`.
- A wrapper WDA flattens that holds no sibling whole (its content laid partly outside it) reads as drawn — a false
  refusal, the safe direction. A cover that holds a small sibling whole (a badge under a banner) reads as a wrapper —
  a false "clear", as before this amendment.
- Every WDA run in reading order is affected, SwiftUI's and UIKit's too, not React Native's alone: a sibling listed
  before a target and drawn there but drawn UNDER it (an earlier sibling wider than the target — RN's earlier JSX
  sibling, a SwiftUI background) is now an untold cover: one screenshot per tap and colour assert, and a refusal when
  the eyes cannot tell. Measured over the repo's 62 WDA trees (the round-9 review's sweep): besides rn-banner, only the
  SwiftUI forms' "Vertical scroll bar, 1 page" indicator as a target of its content container, form-shared-id's field
  titles now kept clear of a moved tap (`aimedClearOf`), rn-banner's C.cover as a target (C, listed before it and drawn
  under it, now an untold cover of it) and the Contacts new-contact sheet's grabber kept clear of a moved tap on the
  sheet's container; no golden row changed.
- A toast held whole by a row wider than it and listed AFTER the row (its top below the row's) is still excused as the
  row's own content (draw-order.ts#NOT_DRAWN `onTarget`) — a `Tapped` on the toast, as before this amendment; outside
  LR3 (the listing tells the order there), a later cell's to measure.
- A named childless host listed AFTER a sibling whose top lies above it (a badge on a pressable host) now covers that
  sibling — a false refusal of the badge, the safe direction; no fixture has the shape.

## Amendment: Android Views list children by location (2026-11-09, D75, LR4)

### Context

Lab note LR4 (docs/bugs/2026-11-09-lab-android-uiautomator-lists-a-react-native-cover-before-its-target-so-it-is-tapped-and-measured.md),
LR3's Android twin: T6's capture of rn-banner on the averi_lab AVD (API 33) lists every cover BEFORE the target it is
drawn over — `T.cover [73,276][1008,419]` before `T [128,303][953,479]`, and `C.cover [73,1321][1008,1464]` before
`C [128,1293][953,1469]` though it starts lower. Read as draw order, each target was drawn over its cover: `tap` T, U
and C `Tapped` at the centre (on the cover; the probe fired nothing), the colour assert passing on the cover
`#263238`. Golden red on all six uiautomator rows.

The cause is AOSP's, not React Native's. A classic ViewGroup hands its children to accessibility SORTED BY LOCATION
(android-36 sources, `ViewGroup.java`): `addChildrenForAccessibility` and `onInitializeAccessibilityNodeInfoInternal`
take `ChildListForAccessibility.obtain(this, true)`, whose `init` sorts the children with `ViewLocationHolder`'s
stripe comparator (`compareBoundsOfTree`, COMPARISON_STRATEGY_STRIPE): a child wholly above another first; in one
STRIPE (their vertical extents overlap) the left edge first (under a right-to-left layout direction the larger right
edge), then the higher top, the taller, the wider, then the children's bounds and the accessibility id. In rn-banner
every cover's left is 73 and every target's 128, so each cover is listed first whatever the JSX draws last. The API 33
dump carries no `drawing-order` attribute; nothing else in it tells the Z order. `addChildrenForAccessibility` returns
early for a view with an `AccessibilityNodeProvider`: Compose's `AndroidComposeView` lists its semantics children in its
own (composition) order, unsorted — scroll-sticky's R `[128,391][953,567]` listed before the header `[0,303][1080,457]`
drawn over it.

### Decision

- The uiautomator parser marks a node `readingOrder` (`UiNode.readingOrder`, as WDA's run) when its two or more
  children are listed in that location order: every consecutive pair compares at or before (≤ 0) under the stripe
  comparator, read off the dumped bounds (adapters/android-accessibility-order.ts#compareByLocation,
  #markLocationSorted, called by android.ts#parseUiautomatorXml before the widening). A SORT CHECK, as WDA's: a run of
  classic Views passes it; a run listed so by chance passes it too.
- LEFT-TO-RIGHT is assumed: the dump names no layout direction, so a right-to-left run (sorted by right edges) reads
  out of order and is not marked — it keeps its order as draw order, as before.
- NOT a node a node provider lists: any node of the class `android.view.View` hosts virtual nodes (a plain View holds no
  child views, so any children it lists are virtual) — Compose's AndroidComposeView, under a `ComposeView` on a screen and under a bare
  ViewGroup in a Compose dialog's window — and nothing under it is marked (android.ts#providesNodes). Compose's order is
  composition order: form-shared-id lists each outlined field (left 55) before its label drawn over its outline (left
  77) — location order by chance; marked, the five labels would gain their fields as untold covers.
- From there LR3's rules apply unchanged, through `listsNestedReadingOrder` (any nested run marked so):
  reading-order.ts#peersOf (a sibling listed before the target that draws there is a peer whose order the eyes tell,
  ADR 0024), placed.ts#FRAME_EXCUSES's `structural` (a childless leaf the app named is drawn unless it wraps a sibling),
  and the eyes. Nothing in ui-tree knows Android.
- `ui_snapshot` prints the mark on Android too ("readingOrder": true — its children are listed by location, not in
  draw order).

Measured: golden over the truth corpus against `7eb998dd` (1667 checks): exactly rn-banner's six uiautomator rows
change, MISMATCH → ok (T and U refused "drawn over it as a screenshot shows", C too; the colour asserts fail closed
naming the cover), struck from react-native.known.ts; calibrate `--note LR4`: CALIBRATED. Over the 66 Android trees
of tests/fixtures (1087 nodes, each judged as a target, marked against unmarked): 36 nodes marked; 13 nodes' exposure
changes, in two trees — rn-banner's seven (T, U and C, their three covers, and the toast's text `Saved`) and
bands-three-button's six (its five screen-sized containers — the window, its wrappers and `android:id/content` — now
partly under the navigation bar's background, and N `[127,2088][952,2220]`); of those only T, U, C and N are lab targets. N is now under the decor's `navigationBarBackground` `[0,2088][1080,2220]` — a childless leaf with an id, listed after the
content, so drawn (the named-leaf rule, below); the truth agrees (N not reached, 0 % drawn) and its golden rows did not
change. The chooser (ResolverActivity, classic Views) gains seven marks and no changed target. Live on the averi_lab AVD
(docs/truth/live-records/d75-reading-order/, base `7eb998dd` and the fix under one harness): the React Native forms and
visibility groups, 24 cases a src — base `Tapped` on rn-banner's T, U and C with nothing fired, the fix refusing all
three, nothing else changed; native visibility on the three cells whose trees the mark changes, 31 cases a src, every
reply identical. The eyes cost one screenshot per tap on those three targets only; the RN arm took 242 s against 251 s (the fix arm rerun at `03d15b19` on a clean tree: 240 s, the same verdicts).

**The named-leaf change.** LR3's rule that a childless node the app named is drawn (`structural`'s exception) now
reaches marked uiautomator runs: a bare View with only a resource id — rn-banner's U.cover and C.cover, the decor's
`navigationBarBackground`, a synthetic classic overlay (tests/adapters/android.test.ts) — counts as drawn where before
it was excused as structural. That change alone runs in the safe direction: a cover where there was none (a refusal
or a widened row). An unnamed bare View stays excused. The mark as a whole is NOT monotone-cautious: a control listed
AFTER the target that the draw order made a cover becomes a peer the eyes may lift (the residual below).

Rejected: a helper APK reading the real drawing order (far too costly to ship and keep); hedging every overlap with no
eyes (falsely refuses a form's label or error text over its field); a React-Native-only rule (the wrong scope: the sort
is AOSP's, every classic ViewGroup's).

### Residuals of the amendment

- **Compose, and anything not location-sorted, stay on draw order.** A Compose sibling drawn over an earlier one with
  `zIndex` (or listed by a provider in another order) is read by its listing, as before. AndroidView interop — classic
  Views hosted inside Compose — sits under the provider's host, so it is never marked either, though AOSP sorts its own
  ViewGroups.
- A provider other than Compose (an `ExploreByTouchHelper` on a custom View) is caught by the same shape (any node of the
  class `android.view.View`); a WebView (`android.webkit.WebView`) is not, and its virtual DOM nodes are marked where they happen to
  be in location order: their overlaps then ask the eyes — a screenshot per tap, a refusal when the eyes cannot tell.
  Unmeasured.
- The dump's bounds are CUT (to a scroll view, to the screen) where AOSP sorted the whole drawing rect: a classic run
  with a child cut so may fail the check and keep its order as draw order — a later-drawn cover listed first stays
  read beneath the target, as before this amendment.
- ViewLocationHolder sorts LAYOUT positions (`getDrawingRect` offset by `offsetDescendantRectToMyCoords`, which
  applies no translation or scale), while the dump's bounds are on-screen, transforms included: a run whose child is
  translated or scaled (an animation, a `translationX` offset) can fail the check and keep its order as draw order.
- AOSP falls back to COMPARISON_STRATEGY_LOCATION (no stripes: top, then left …) when TimSort finds the stripe
  comparator intransitive (`ChildListForAccessibility.sort`, the IllegalArgumentException): such a run fails the
  stripe check and keeps its order as draw order.
- A right-to-left classic run is not marked (above).
- **A later-listed control over the target's centre, refused as drawn before D75, is now lifted when the eyes see the
  target on top** — ADR 0024's judgement on Android frames, unmeasured live in that direction. In a marked run such a
  control (B listed after A, holding A's centre) is an untold peer, no longer the draw order's `drawn` cover: with no
  screenshot it still covers (refused, as before), but a screenshot that sees A over B lifts it and A is `Tapped`
  (tests/ui-tree/draw-order-android-reading-order.test.ts, the review's repro). Where AOSP's listing is location order
  that is right (the listing says nothing of Z); where the eyes misjudge, it is a false `Tapped` that was a refusal.
  Backlog D77 asks for a classic cell whose target is truly drawn over a later-listed control.
- **React Native's roles that dump as `android.view.View`: residual 5 above.** The roles (verified in the lab app's
  react-native 0.88.0, ReactAndroid/…/uimanager/ReactAccessibilityDelegate.kt, `AccessibilityRole.getValue`, set by
  `setRole` only when a role is given): `none` (given explicitly), `link`, `summary`, `header`, `alert`, `combobox`,
  `menu`, `menubar`, `menuitem`, `progressbar`, `radiogroup`, `scrollbar`, `tab`, `tabbar`, `tablist`, `timer`,
  `toolbar`. A view with such a role as a CHILD (a toast with `role="alert"`) does not unmark its parent's run.
- Every marked run pays what WDA's does (this ADR's second residual and the LR3 amendment's third): two overlapping
  siblings that are really drawn in list order — a badge over an avatar, a label laid over its field — ask the eyes,
  and are refused where a screenshot cannot tell them apart. The lab's classic-Views twin of rn-banner is not built
  (backlog D77): the generality of the mark rests on AOSP's source and rn-banner, not on a native capture.

## Amendment: the lab's native twin, built (2026-11-10, D77)

This supersedes the last residual of the amendment "Android Views list children by location": "The lab's classic-Views
twin of rn-banner is not built (backlog D77)". The Android lab app builds the classic-Views cells of the `views` family
(fixtures/apps/cells/views.json, Views.kt) — `views-banner`, rn-banner's twin (T, U and C, each with a later-child cover
20 dp to its left, C's starting below its top), and `views-drawn-over` (A drawn over B by child order, A2 over B2 by
translationZ, each A listed first and each pair holding the other's centre: the direction the mark opened) — and the
React Native lab app `rn-banner-role` (rn-banner with each target and its cover in a slot View of role `toolbar`, which
dumps as `android.view.View`; the slot encloses the cover, so no dumped bound is clipped to it and the role alone keeps
the run unmarked). The views cells are hosted by the activity's setContentView, OUTSIDE Compose: an AndroidView sits
under the provider's host and is never marked (that amendment's first residual), so hosted there they would measure that
residual, not the mark. Their predictions are pinned against synthetic dumps at the cells' geometry
(tests/ui-tree/draw-order-android-views-twin.test.ts); A's side of views-drawn-over — B an untold peer the eyes lift —
only at a generic geometry (draw-order-android-reading-order.test.ts, the review's repro: A `[40,1000][540,1200]`, B
`[200,1050][900,1150]`), not the cell's. Predicted: views-banner's T, U and C refused, with the eyes or without;
views-drawn-over's B and B2 refused, A and A2 `Tapped` where the eyes see them on top; rn-banner-role's T, U and C
`Tapped` at the centre — LR4's lie, residual 5 above, expected red. No src change. Captured 2026-11-11 (merge
c2796759): views-banner and rn-banner-role as predicted; views-drawn-over's B and B2 refused as predicted, but A and A2
refused too, not `Tapped` (backlog D84).
