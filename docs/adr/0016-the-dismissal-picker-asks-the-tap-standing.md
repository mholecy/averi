# 16. The in-tree dismissal picker asks the tap's standing

Status: accepted, 2026-10-13 (owner decision: the sweep's list of every changed pick approved; residual 1 decided as
the explicit refusal).

## Context

Under WDA the keyboard guard taps a configured dismissal (`tap: id:login_title`) to hide the keyboard
(`interact/keyboard-in-tree.ts#pickDismissal`). The picker had its own precedence for "can a tap land here":

1. the reading's `ofKeyboard` ("the keyboard's own control");
2. the band's `frameOver` ("under the keyboard");
3. an on-screen point rule of its own (`onScreen` in `ui-tree/standing.ts`, "off screen at (x,y)");
4. `DrawOrder.shadowing` ("covered by …"), the last node after the candidate that draws and holds its centre.

`shadowing` had no other production caller. It read its own column of draw order's `NOT_DRAWN` table, which five rows
answered (`noArea`, `structural`, `screenSizedHost`, `contentFramed`, `itemlessToolbar`). The tap reads the `target`
column, which every row answers, through its standing (`ui-tree/standing.ts#Scene`, `{ of: 'tap' }`). So a
configured dismissal could be skipped as covered by something a `tap` on the same node would not count, and picked
where a `tap` would count a cover.

## Decision

The picker keeps its two keyboard checks first (`ofKeyboard`, then `frameOver`). It then asks the tap's standing of the
candidate, with one scene per call (one draw-order walk) and the tap's own lazy keyboard line
(`keyboardEdge(await readingLine(reading), scene.order, node)`). It picks the candidate only when the standing is
`reachable` with no `moved` point and no interactive node there that the tap would press.

**The explicit refusal (owner decision, 2026-10-13).** The `target` column excuses a node for where a touch lands on
the target — its own content, a node of its frame, its own unlabelled control, a row of a scroll view it is not in —
not for what else the touch presses. So the picker also refuses a candidate whose centre is held by an INTERACTIVE
node listed after it that the `target` column excused: skipped as `covered by <role> "<label>"`, naming the last such
node (drawn on top). A silently pressed control is worse than a skipped title: on the post-fill `dismiss()` path a
pressed button would be reported as `hiddenBy: tapping <title>`, a wrong action said as the dismissal, and nothing
would say otherwise; a skipped title says why, and the next configured dismissal (or the refusal) follows. The node is
read off the standing, not found by another walk: draw order's `exposure` judges every node listed after the target
that meets it once, as a cover or excused, and reports the excused ones holding the centre beside the covers
(`Exposure.centreExcused`, carried as `StandingFacts.centreExcused`); nothing else reads it, and the tap's standing is
unchanged.

The skip lines:

| Standing | Skip line |
|---|---|
| `offScreen`, `systemBar` | `off screen at (x,y)`, as before |
| `covered` | `covered by <role> "<label>"`, the standing's cover |
| `reachable` with `moved` | `covered by <role> "<label>"`, the cover over the centre: the dismissal is never aimed off its centre |
| `reachable`, an excused interactive node at the centre | `covered by <role> "<label>"`, that node (the last listed) |
| `cut` | the tap's own clause (`interact/resolve.ts#cutSliverText`) |
| `underKeyboard` | `under the keyboard` |

`cut` and `underKeyboard` are not reached in production today: the picker runs only under WDA, and iOS has no clipping
container and no idb band. Under WDA the reading's line is witnessed, so standing refuses nothing for it; `frameOver`
already did.

`DrawOrder.shadowing`, its `Question` and its predicates in the five rows are deleted, and so is `onScreen`. Its rule
lives on as the tap standing's place of a point.

## Before and after

The candidate is a configured `tap` dismissal's non-interactive match, with area, on a WDA tree whose band covers the
guarded target. P is a node listed after the candidate that holds its centre.

| # | Shape of P (`NOT_DRAWN` row) | Before (`shadowing`) | After (tap standing) |
|---|---|---|---|
| 1 | a later sibling drawn on the candidate, narrower and inside it (`onTarget`/`drawnOn`); measured: `wda-source-rn-myport` `placeholder_screen` under `text "Scaffold is running."` | skipped: covered by P | picked; skipped as covered by P when P is interactive and holds the centre |
| 2 | content of a leaf candidate's drawn-on sibling (`onTarget`/`ownContent`) | skipped | picked; skipped when that content is interactive and holds the centre |
| 3 | exactly the candidate's rect (`sameFrame`), whatever its role — a labelled control included | skipped (unless structural): `covered by button "Delete account"` | skipped when P is interactive (it holds the centre): `covered by button "Delete account"`, as before; picked when it is not (an underline image) |
| 4 | its own unlabelled control, a sibling spanning or padded, or a text field over a label (`ownControl`, ADR 0014) | skipped: covered by button/textfield | skipped, as before: the control holds the centre and is interactive (`covered by textfield`, `covered by button`) |
| 5 | content of a scroll view the candidate is not in, listed after it (`scrolledContent`; WDA lists a top bar before the scroll view it is drawn over), an interactive row included, whether or not the candidate lies in a bar | skipped: covered by the row | picked under a non-interactive row; skipped, `covered by <the row>`, when an interactive row holds the centre (residual 1) |
| 6 | a keyboard-owned node outside the band frame (`keyboard`) | skipped | picked (residual 2); skipped when a keyboard-owned control holds the centre |
| 7 | a scroll indicator (`scrollIndicator`) | picked (structural, already excused) | picked: unchanged |
| 8 | a structural node with a label, a value or children, partly over it, neither holding it whole nor frames only (`structural`); measured: the login and 2FA field wrappers under their own inner `container 36,367 330x52` | picked | skipped: covered by container (residual 3) |
| 9 | the centre covered but a large enough free piece (the tap would move) | skipped: covered by the last such node | skipped: covered by the centre's cover; it may name a different node |
| 10 | centre off screen or in a system band | `off screen at (x,y)` | unchanged |
| 11 | cut to a sliver (Android) / under idb's band | not reached | the `cutSliverText` clause / `under the keyboard` (not reached) |
| 12 | idb flat-list rows (`flatListChrome`, `flatListReadingOrder`, tab-bar items listed before, pinned reach) | not reached | not reached: idb's reading is `unknown`, so the picker never runs |

Measured over the fixtures (`inTreeModel(fake).dismiss()`, every non-interactive node with area as a candidate, a
synthetic WDA band on trees without one), the WDA fixtures changed in 9 of 898 candidates: rows 8 (8 field wrappers
over three login dumps and two 2FA dumps) and 1 (`placeholder_screen`). No title changed. No WDA fixture has a
candidate in row 3 or 5, so the explicit refusal changes none of them. On trees that cannot reach the picker (idb,
Compose, uiautomator, synthetic slivers), 18 of 893 changed: slivers (row 11, 16), one idb flat-list row (row 12) and
one Compose wrapper (row 8). Without the explicit refusal it was 95: the 77 more were Compose and uiautomator labels
and icons under their own clickable control (row 4, 74 — 9 of them under a control of exactly their frame, row 3 too)
and idb's SWIFT title over the form's textfield (row 12, 3), each refused by it with the words it had before.

## Residuals accepted

1. **An excused control at the centre is refused, not pressed** (the owner's decision, 2026-10-13). The `target`
   column excuses controls the tap would press: a title's own unlabelled control or a text field over its label
   (`ownControl`, row 4), a control of exactly the title's frame, which reads as the title listed again (`sameFrame`,
   row 3 — a title followed by `button "Delete account"` with the same rect), and an interactive row of a scroll view
   the title is not in (`scrolledContent`, row 5), excused whether or not the title lies in a bar drawn over the rows.
   Picked, each would be pressed, and on the post-fill `dismiss()` path reported as `hiddenBy: tapping <title>`. The
   picker refuses all of them, as the option put to the owner defined it — any excused interactive node at the centre, row 4
   included, though a field's label only focuses the field — naming the node as `covered by <role> "<label>"`. Pinned:
   `tests/interact/keyboard-in-tree.test.ts` (the same-frame button, the title's own control, the interactive scrolled
   row, the keyboard-owned control; and the non-interactive shapes of each still picked).

   What it leaves: a title whose excused control is listed BEFORE it is picked (only nodes listed after the candidate
   are asked, as for a cover), and a candidate's own interactive descendant at its centre is not asked (it is the
   candidate's subtree, never draw order's). A tap that lands on a non-interactive excused node and still triggers
   something (a gesture recogniser the tree does not mark) is not seen. The picker's interactive-match filter has the
   same hazard for a text that is a button's own child, as before.
2. **A keyboard-owned node outside the band frame** no longer skips the candidate. WDA's band includes the AutoFill bar
   and the accessory slot, so `frameOver` still refuses those points. Measured: the 2FA input-accessory bar (`Toolbar →
   Other → Button "Done"` at `0,518 402x48`, in a keyboard Window, wda-source-myport-2fa-keyboard-toolbar.json) is an
   opaque 48-pt bar; under `shadowing` it covered the app's support text `16,547 370x40` beneath it, with the keyboard's
   band taken out of the tree. With the band in, the bar's slot is the band's.
3. **Stricter.** A later structural node with a label, a value or children, partly over the title and neither holding
   it whole nor frames only, now skips it. The `shadowing` column excused every structural role.

## What `shadowing` was measured on

Moved here from the deleted column's prose, so the measurements are not lost.

- **Structural roles.** Any structural node was excused at a point: a full-screen `Other` of a later Window holds every
  point and draws nothing, and what it carries is walked and judged by itself (an alert's text inside WDA's
  `Alert → container`). iOS dimming views come through as `other`. Under the `target` column a dimming `other` that is
  the screen's size and holds the title whole is excused the same; one only partly over it covers (row 8).
- **The keyboard's nodes counted** (review 2026-10-07): the band and a key over a point were covers, so a
  keyboard-owned node the band missed refused a dismissal. Now the band is judged first and the rest is residual 2.
- **A row scrolled under a translucent bar** was after the bar's title in WDA's pre-order and read as a cover — a false
  refusal, accepted then as the safe direction for a dismissal. It is row 5 now.
- **The on-screen point rule** (`onScreen`) is now the tap standing's place of a point. Its rule, why it fails open,
  the rounding it judges and its measurements are stated beside it: `ui-tree/standing.ts#placeOf`.

## Bug notes

docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md
docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md
