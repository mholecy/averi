# 19. A WDA hidden subtree is no cover, and a cell's parked content lies at its cell

Status: accepted, 2026-10-14 (owner decisions on the round-14 device check's triage: Q-C (b), the hidden-subtree rule
in the form the captures support, with the presented-surface guard and the `hidden` flag printed by `ui_snapshot`; Q-E
(a), the parked off-screen cell content fixed alongside it). Narrowed the same day on the slice's review: a hidden
subtree's root is no structural wrapper (owner decision); a parked element needs the measured scroll-view shape; a
hidden node excused at a target's centre is still listed in `Exposure.centreExcused`.

## Context

Two WDA bugs had the same root: WebDriverAgent keeps nodes in `/source` that are not where it says they are, and until
now the parser read `isVisible` for one purpose only (is a `Keyboard` on screen, `adapters/wda-source.ts#keyboardMarks`).

- docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md: on mp-native's SWIFT form, a
  SwiftUI screen pushed over the tab host, WDA lists the host's tab bar AFTER the form at `69…266,711` (the shown bar
  is at y 755), and no tab bar is on screen. Draw order read the four `nav.tab_*` buttons and their icons as drawn
  over the rows beneath: a tap on `payee_country_select` was moved to a 45x50 strip, a colour assert failed closed
  naming `Dashboard/icon-browsers` on pixels idb measures clean, and `fully: true` spent a stroke moving a row off a
  phantom.
- docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md: on Contacts' New Contact sheet
  (UIKit), every cell below the fold lists its content at a PARKED frame inside the viewport — `StaticText 'add
  instant message' 0,62 286x22`, its `Insert` button `0,62 26x26` — while the cell itself lies at `20,1306 362x52`.
  `scroll_until … fully: true` on such a label answered "fully visible after 0 swipes", and a tap was reported
  `Tapped` at (143,73), the sheet's grabber strip, with the row still below the fold.

The round-14 device check captured six raw `/source?format=json` trees (`run14-ios/D-*.json`, WDA 16.1.7, iPhone 17
simulator, iOS 27.0) with `isVisible` and `isAccessible` on every node, as the strings `"0"`/`"1"`. Four are committed
unedited as `tests/fixtures/wda-capture-*.json`:

| node | isVisible | isAccessible | subtree |
|---|---|---|---|
| `nav.tab_*` buttons, SWIFT form pushed, y 711 | 0 | 0 | each holds an `Image` (same rect), `isVisible 0`, **`isAccessible 1`** |
| `nav.tab_*` buttons, Account Detail, bar shown, y 755 | 1 | 1 | — |
| the tab-bar host `Other 0,0 402x874` | 0 | 0 in **both** states | its content child is `isVisible 1` |
| `forgot_overlay` (RN modal dim, an ADR 0018 surface) | 1 | 0 | leaf |
| the New Contact sheet layer and its `Table 0,62 402x812`, discard popover up | **0** | **0** | its cells `isAccessible 1` |
| a cell below the fold, `add instant message` | 0 | 1 | its content parked at `0,62 …`, `isVisible 0` |

## Decision 1: the hidden subtree (Q-C (b), narrowed to non-wrapper roots)

> In a WDA tree, a node roots a **hidden subtree** when it is of no structural role (not a wrapper: WDA's `Other`,
> `Cell`, `Window`, `Application` and every unmapped type are `container`/`other`, `STRUCTURAL_ROLES`), is
> `isVisible="0"` and `isAccessible="0"`, and every node of its subtree is `isVisible="0"`. A descendant's
> `isAccessible` is not consulted. Every node of a hidden subtree is no cover in draw order's `target` column (the tap,
> `scroll_until`'s standing, the pixel assert's covers, the dismissal picker), **except** a node that is the surface of
> a screen presented over the target's (`presentedSurface`, ADR 0018), which covers as before. A target's own flags
> are never read.

- The parser (`wda-source.ts#hiddenRoots`, one bottom-up pass beside `keyboardMarks`) finds the roots, and `toUiNode`
  sets `UiNode.hidden: true` on every node of each such subtree. idb and Android trees never carry it.
- Draw order (`draw-order.ts#NOT_DRAWN`, the `hidden` row) excuses such a node in the `target` column unless
  `presentedSurface` names it — the mirror of `givesWay`. Excused, it is listed in `Exposure.centreExcused` when it
  holds the target's centre, as every excused node is, so the dismissal picker still refuses a candidate whose centre
  a hidden control holds: WDA's `isVisible="0"` is no proof a node takes no touch. The `drawnOver` column (the stroke
  box) is unchanged: no measurement asked it.
- `ui_snapshot` prints the flag (`"hidden": true`) on every node of the subtree, so later device trees carry it and the
  differential harness, whose corpus is `ui_snapshot` output, can sweep the rule; a filtered snapshot shows it on each
  match.

Why this form and not the owner's first one, "a subtree wholly `0/0` is no cover" (Q-C (a)): the tab buttons' icon
Images are `isAccessible "1"`, so the literal rule drops nothing on the SWIFT form and the Image goes on covering the
row beneath. Asking `isAccessible` of the root only fixes that. Why every descendant's `isVisible` and not the root's
alone: the tab host is `0/0` in both states, with visible content.

Why no wrapper root (the review's finding, the owner's decision): WDA's flags do not say what is drawn. The SWIFT
form's `payee_name_input` row, `Other 24,801 354x52`, is drawn — under CONTINUE — and WDA reports it `0/0` with an
all-invisible subtree. As a root (the rule as first written) it took its label and its text field (each
`isAccessible "1"`) with it; with the `centreExcused` filter first shipped beside it, the label "Payee’s name" became a
dismissal candidate whose tap would focus the field. `isAccessible` on the root does not tell drawn from undrawn — the
payee row is `0/0` — so the narrowing asks what the node is: a control, an image or a text is one thing on screen,
which WDA either shows or not; a wrapper is a region whose flags say nothing of what it holds. The measured motivating
case keeps working: the tab buttons are `Button`s.

Why the guard: with the discard popover up, WDA marks the New Contact sheet layer `0/0`, its form `Table` included —
the Table (a scroll view, no wrapper) roots a hidden subtree. That Table is the presented sheet over the contacts list
(ADR 0018). Unguarded, the rule would stop it covering the list's rows; on that capture the popover's own dim still
covers them, but a sheet so marked over a list with no second dim would let a tap through (pinned on a synthetic tree
in tests/ui-tree/draw-order-hidden.test.ts).

## Decision 2: parked cell content (Q-E (a), narrowed to the measured shape)

> In a WDA tree, an element with `isVisible="0"` is PARKED, and placed at its nearest `Cell` ancestor's rect, when its
> rect shares no area with that cell's, shares area with the scroll view the cell lies in (the cell's nearest `Table`,
> `CollectionView` or `ScrollView` ancestor), and the cell shares no area with that scroll view. (Each rect of area;
> an edge in common is no shared area.)

- Implemented in the parser (`wda-source.ts#parkedIn`), before the role map, so every reader above sees the placed
  rect: a tap on Contacts' `add instant message` below the fold is refused off screen with "scroll_until it first",
  `scroll_until` strokes toward it (and stops once the cell shows: the next read has the content laid out at its real
  rect), a pixel assert reads "element rect is outside the screenshot", and a visibility assert reads it where its row
  is. (Since 2026-10-14 the pixel assert's own standing says it first, "nothing of the element lies on the screen …",
  and beneath a presented screen — Contacts' discard popover — the tap and the pixel assert say "close it first": ADR
  0018, residual 8's amendment "presented judged of the node".)
- **The scroll view's shape** (the review's finding): the cell is not laid out — wholly outside the scroll view it lies
  in — and the element sits inside that scroll view, at its parked frame. As first written ("outside its cell" alone),
  content scrolled out SIDEWAYS read as parked: a carousel row's third chip at x 410, past its own horizontal
  scroller, was moved onto the row's cell at `0,300`, tapped there, and covered the two chips beside it. Every one of
  the 82 parked elements of the two Contacts captures (41 each) has the shape. The scroll view is the CELL's — the one
  that decides whether the cell is laid out — not the element's own nearest: a below-the-fold cell holding a scroller
  of its own (a row of chips) parks that scroller's content all the same. Pinned as negatives: the carousel's chip,
  a collection view's card past its edge (a cell nested in a row's cell), and an on-screen cell's badge hung off its
  edge — each keeps its rect.
- **Placed at the cell, not marked off screen.** A zero rect (what idb gives an unlaid node) would read "no area": the
  wait's zero-area hint, and a `scroll_until` that never finds it on screen. A flag would need every reader taught it.
  The cell's rect is where the content will be, to within the cell.
- **Every element of the cell, not its text only.** The `Insert` button and its image sit at the same parked `0,62`;
  a tap on them would press the same strip.
- **A `Cell` only** (WDA's type: the role map makes it a `container`, like every `Other`). The shape was measured in a
  UIKit table's cells. An RN or SwiftUI view whose child lies outside it is no cell, and its child stays where WDA
  reports it.
- **`isVisible="0"` too.** A child drawn outside its cell is drawn where it says; on screen, a laid-out cell's content
  lies inside it (`add phone` and its button).

## Measured

Tests (red first, each mutation-checked; 18 mutants, all killed — among them the rule without the guard, the literal
rule, `isVisible` alone, a wrapper allowed to root (the rule as first shipped), only `Other` excluded, the
`centreExcused` filter, the parked rule without the scroll-view shape (as first shipped), with the element's own
scroll view, on text only, on any parent, with a zero rect): `tests/adapters/wda-source-visibility.test.ts`,
`tests/ui-tree/draw-order-hidden.test.ts`, `tests/interact/parked-cell-content.test.ts`.

- SWIFT form pushed: the "Standard" value under the phantom Home icon is clear (tap at its centre, unmoved; before,
  refused: "only a 71x7 part of it shows"), and no row is covered by a tab button or icon. `payee_name_input`, its
  label and its text field are not hidden, and the label stays no dismissal candidate (its text field holds its
  centre).
- Contacts New Contact under the discard popover: the sheet's `Table` stays a cover, and a presented surface, of the
  list's rows; the sheet's own accessible controls (close, Done) are not hidden and cover as before.
- Account Detail with the bar shown: nothing is dropped — every node's covers, presented surfaces and tap equal those
  of the same tree with the flag stripped. 98 of its 203 nodes are hidden: 94 off screen or of no area (the second
  account card off to the right, the transaction rows below the fold, each a `Button` root), and on screen the search
  field's icon `34,81 20x20`, the second card's header button at `378,138` (a 24-pt sliver), the screen's full-screen
  `Toolbar` and the frame inside it.
- Hidden nodes per raw capture (of all nodes): Account Detail 98/203, SWIFT form 26/138, Fees sheet 128/185,
  Finportal forgot 137/179, Contacts sheet 144/321, discard popover 236/363. The large counts are whole screens beneath
  a presented one, each rooted at that screen's scroll view (residual 3).

**The sweep's limit.** The differential harness's corpus is normalized `ui_snapshot` output, built through the old
parser; it carries no visibility flags, so it shows 0 diffs by construction for both rules and proves nothing about
them. Only eight raw trees carry the flags: the six D captures and two older fixtures (`wda-source-rn-myport`,
`wda-source-skeleton-login`; the five MyPort fixtures carry `isVisible` only). A raw-tree differential over those
eight — each parsed by each side's own parser, tap (`judgeTap(…).aim()`) and pixel (`overElement`) on every node,
with and without the 62-pt status band and a keyboard band (5 572 taps, 5 572 pixel judgements) — against e1384aa:

| tree | taps changed | pixel changed | what |
|---|---|---|---|
| SWIFT form pushed | 6 | 34 | "Standard" refused → tapped (4); the Priority row, "PAYMENT DETAILS", "Standard" and screen frames: pixel refused → measured; the form's scroll container: moved tap, larger piece (2) |
| Contacts sheet | 172 | 127 | 41 parked nodes: refused under a parked text or tapped at `0,62` → refused off screen (164 taps), pixel → off screen (120); the sheet's `Poster` image at `0,62`, no longer under parked texts: refused → tapped (4 taps, 4 pixel); the frame `0,0 402x156` and one above the screen: same verdict, another cover named (4 taps, 3 pixel) |
| discard popover | 256 | 193 | 41 parked nodes as above (164 taps, 124 pixel); screen-sized frames as targets: same verdict, the named cover becomes the guarded `Table` (92 taps, 69 pixel) |
| Finportal forgot | 8 | 0 | two full-screen frames as targets: same verdict (moved), a larger uncovered piece |
| Fees sheet, Account Detail, `wda-source-rn-myport`, `wda-source-skeleton-login` | 0 | 0 | — |

No target that was tapped is refused now but the parked ones (refused off screen), and no presented surface of a
target on screen was lost.

## Residuals accepted

1. **Only eight raw trees.** Every claim above rests on them; the flag in `ui_snapshot` is how later device checks
   grow the evidence. Unmeasured: a pushed screen scrolled so a row lies in the phantom tab band, a medium sheet, a
   SwiftUI menu.
2. **A drawn node WDA reports `0/0` with an invisible subtree.** Measured: the SWIFT form's `payee_name_input` row,
   drawn under CONTINUE, is reported so — `isVisible="0"` there means occluded, not undrawn. As a wrapper it roots
   nothing now, and its accessible label and text field stay as they were. A CONTROL, image or text so reported
   while drawn would still read as no cover (a false "clear"); none was seen among the D captures' on-screen
   controls, and the four on Account Detail (the search icon, a card's sliver, the screen's `Toolbar`) cover nothing
   there either way. The search icon (`Image Dashboard/icon-search 34,81 20x20`, `0/0`, no children) is most likely a
   drawn image WDA reports hidden — the one shape of this residual the captures show — and it covers nothing.
3. **The screen beneath a presented one.** WDA reports a screen occluded by a modal or a sheet `0/0` from its scroll
   view down — Finportal's login `ScrollView` under the RN modal (135 nodes), the SWIFT form's under the Fees sheet
   (122), the Contacts list under the New Contact sheet (95), and, under the discard popover, the sheet's form `Table`
   too (121) — and the scroll view, no wrapper, roots a hidden subtree; so does a full-screen `Toolbar`, no wrapper
   either, that holds part of the occluded screen's chrome (on `D-contacts-sheet` a `Toolbar 0,0 402x874`, `0/0`,
   wraps the Contacts list's search bar, `SearchField 'Search' 28,808 286x28`): the occluded screen's own content and
   chrome cover none of its targets. A target there is still covered by the presented screen's surface (kept by the
   guard), so the measured verdicts hold; but a presented screen whose surface `presentedSurface` does not name (a
   medium sheet under 90 % of the screen, an RN modal whose dimming view is a wrapper with children — ADR 0018
   residual 2) leaves such a target read as clear where its own screen's chrome lay over it. Measured on the payee
   row's lesson: WDA's flags say "occluded", which the rule takes for "not drawn".
4. **A parked element that meets its cell's rect** (a cell parked near the sheet's origin) keeps its parked frame.
5. **Content parked in a container that is not a `Cell`, or in a cell no scroll view holds** (a SwiftUI `List` row
   was not measured) is not placed.

## Bug notes

- docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md
- docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md
