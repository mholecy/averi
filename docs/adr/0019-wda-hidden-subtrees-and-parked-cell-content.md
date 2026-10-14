# 19. A WDA hidden subtree is no cover, and a cell's parked content lies at its cell

Status: accepted, 2026-10-14 (owner decisions on the round-14 device check's triage: Q-C (b), the hidden-subtree rule
in the form the captures support, with the presented-surface guard and the `hidden` flag printed by `ui_snapshot`; Q-E
(a), the parked off-screen cell content fixed alongside it).

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

## Decision 1: the hidden subtree (Q-C (b))

> In a WDA tree, a node roots a **hidden subtree** when it is `isVisible="0"` and `isAccessible="0"` and every node of
> its subtree is `isVisible="0"`. A descendant's `isAccessible` is not consulted. Every node of a hidden subtree is no
> cover in draw order's `target` column (the tap, `scroll_until`'s standing, the pixel assert's covers, the dismissal
> picker), **except** a node that is the surface of a screen presented over the target's (`presentedSurface`, ADR
> 0018), which covers as before. A target's own flags are never read.

- The parser (`wda-source.ts#hiddenRoots`, one bottom-up pass beside `keyboardMarks`) finds the roots, and `toUiNode`
  sets `UiNode.hidden: true` on every node of each such subtree. idb and Android trees never carry it.
- Draw order (`draw-order.ts#NOT_DRAWN`, the `hidden` row) excuses such a node in the `target` column unless
  `presentedSurface` names it — the mirror of `givesWay`. It is also left out of `Exposure.centreExcused`: what is not
  drawn takes no touch, so the dismissal picker does not refuse a candidate whose centre a hidden button holds. The
  `drawnOver` column (the stroke box) is unchanged: no measurement asked it.
- `ui_snapshot` prints the flag (`"hidden": true`) on every node of the subtree, so later device trees carry it and the
  differential harness, whose corpus is `ui_snapshot` output, can sweep the rule; a filtered snapshot shows it on each
  match.

Why this form and not the owner's first one, "a subtree wholly `0/0` is no cover" (Q-C (a)): the tab buttons' icon
Images are `isAccessible "1"`, so the literal rule drops nothing on the SWIFT form and the Image goes on covering the
row beneath. Asking `isAccessible` of the root only fixes that. Why every descendant's `isVisible` and not the root's
alone: the tab host is `0/0` in both states, with visible content — the root alone would drop the whole Account
Detail screen. Why `isAccessible` on the root at all (Q-C (c), `isVisible` alone, gives the same drops as this rule
for the labelled targets the triage measured): WDA's `isVisible` is 0 for nodes really drawn but occluded too (the
SWIFT form's `payee_name_input` under CONTINUE), and an occluded control is still accessible. Over every node, the two
differ: on Account Detail with the bar shown `isVisible` alone calls 114 of 203 nodes hidden where this rule calls
102 (no cover there changes either way).

Why the guard: with the discard popover up, WDA marks the whole New Contact sheet layer `0/0`, its form `Table`
included. That Table is the presented sheet over the contacts list (ADR 0018). Unguarded, the rule would stop it
covering the list's rows; on that capture the popover's own dim still covers them, but a sheet so marked over a list
with no second dim would let a tap through (pinned on a synthetic tree in tests/ui-tree/draw-order-hidden.test.ts).

## Decision 2: parked cell content (Q-E (a))

> In a WDA tree, an element with `isVisible="0"` whose rect (of area) shares no area with its nearest `Cell`
> ancestor's rect is PARKED, and is placed at that cell's rect.

- Implemented in the parser (`wda-source.ts#parkedIn`), before the role map, so every reader above sees the placed
  rect: a tap on Contacts' `add instant message` below the fold is refused off screen with "scroll_until it first",
  `scroll_until` strokes toward it (and stops once the cell shows: the next read has the content laid out at its real
  rect), a pixel assert reads "element rect is outside the screenshot", and a visibility assert reads it where its row
  is.
- **Placed at the cell, not marked off screen.** A zero rect (what idb gives an unlaid node) would read "no area": the
  wait's zero-area hint, and a `scroll_until` that never finds it on screen. A flag would need every reader taught it.
  The cell's rect is where the content will be, to within the cell.
- **Every element of the cell, not its text only.** The `Insert` button and its image sit at the same parked `0,62`;
  a tap on them would press the same strip.
- **A `Cell` only** (WDA's type: the role map makes it a `container`, like every `Other`). The shape was measured in a
  UIKit table's cells. An RN or SwiftUI view whose child lies outside it — an absolutely positioned badge, an
  overflowing label — is no cell, and its child stays where WDA reports it.
- **`isVisible="0"` too.** A child drawn outside its cell is drawn where it says; on screen, a laid-out cell's content
  lies inside it (`add phone` and its button).
- **No "the cell is off screen" condition** (the triage's draft named one): whether a cell is laid out depends on its
  scroll view's bounds, not the screen's (a medium sheet's cell below the sheet but inside the screen is not laid out
  either), and the parser knows neither reliably; the parked frame itself is the evidence.

## Measured

Tests (red first, each mutation-checked; 13 mutants, all killed — among them the rule without the guard, the literal
rule, `isVisible` alone, the root alone, the hidden flag on the root only, the parked rule on text only, on any
parent, with a zero rect):
`tests/adapters/wda-source-visibility.test.ts`, `tests/ui-tree/draw-order-hidden.test.ts`,
`tests/interact/parked-cell-content.test.ts`.

- SWIFT form pushed: the "Standard" value under the phantom Home icon is clear (tap at its centre, unmoved; before,
  refused: "only a 71x7 part of it shows"), and no row is covered by a tab button or icon.
- Contacts New Contact under the discard popover: the sheet's `Table` stays a cover, and a presented surface, of the
  list's rows.
- Account Detail with the bar shown: nothing is dropped — every node's covers, presented surfaces and tap equal those
  of the same tree with the flag stripped (102 of its 203 nodes are hidden: the second account card off to the
  right, the scroll bars).

**The sweep's limit.** The differential harness's corpus is normalized `ui_snapshot` output, built through the old
parser; it carries no visibility flags, so it shows 0 diffs by construction for both rules and proves nothing about
them. Only eight raw trees carry the flags: the six D captures and two older fixtures (`wda-source-rn-myport`,
`wda-source-skeleton-login`; the five MyPort fixtures carry `isVisible` only). A raw-tree differential over those
eight, each parsed by each side's own parser, tap and pixel on every node, two status bands, with and without a
keyboard band (5 572 taps, 5 572 pixel judgements), changed:

- verdicts the rules mean to change: the SWIFT form's "Standard" (refused → tapped, 4 taps; 4 pixel), the
  Priority row, "PAYMENT DETAILS" (pixel refused → measured); the parked content of 41 Contacts nodes per tree
  (refused under another parked text or tapped at `0,62` → refused off screen; pixel → "outside the screenshot");
  the sheet's `Poster` image at `0,62`, no longer covered by parked texts;
- covers named, with the same verdict: screen-sized wrappers as targets (the popover tree's list and sheet
  layers, Finportal's and the Fees sheet's full-screen frames, the form's scroll container), whose moved tap or named
  cover changes as hidden nodes listed after them drop — under the popover, the named cover becomes the guarded
  `Table`;
- nothing on Account Detail, `wda-source-rn-myport` or `wda-source-skeleton-login`.

The full report: the round's `c-diff-report.md` (scratch).

## Residuals accepted

1. **Only eight raw trees.** Every claim above rests on them; the flag in `ui_snapshot` is how later device checks
   grow the evidence. Unmeasured: a pushed screen scrolled so a row lies in the phantom tab band, a medium sheet, a
   SwiftUI menu.
2. **A drawn node WDA reports `0/0` with an invisible subtree** reads as no cover (a false "clear"). None was seen;
   the occluded-but-drawn nodes measured are accessible.
3. **A presented screen's surface that `presentedSurface` does not name** (a medium sheet under 90 % of the screen,
   ADR 0018 residual 2) loses its cover if WDA marks it hidden.
4. **A parked element that meets its cell's rect** (a cell parked near the sheet's origin) keeps its parked frame.
5. **Content parked in a container that is not a `Cell`** (a SwiftUI `List` row was not measured) is not placed.

## Bug notes

- docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md
- docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md
