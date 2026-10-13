# 16. The in-tree dismissal picker asks the tap's standing

Status: proposed, 2026-10-13. The owner approves it, with the sweep's list of every changed pick, before it merges.

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
`reachable` with no `moved` point.

The skip lines:

| Standing | Skip line |
|---|---|
| `offScreen`, `systemBar` | `off screen at (x,y)`, as before |
| `covered` | `covered by <role> "<label>"`, the standing's cover |
| `reachable` with `moved` | `covered by <role> "<label>"`, the cover over the centre: the dismissal is never aimed off its centre |
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
| 1 | a later sibling drawn on the candidate, narrower and inside it (`onTarget`/`drawnOn`); measured: `wda-source-rn-myport` `placeholder_screen` under `text "Scaffold is running."` | skipped: covered by P | picked |
| 2 | content of a leaf candidate's drawn-on sibling (`onTarget`/`ownContent`) | skipped | picked |
| 3 | exactly the candidate's rect (`sameFrame`), whatever its role — a labelled control included | skipped (unless structural): `covered by button "Delete account"` | picked; the tap lands on P, a button pressed (residual 1) |
| 4 | its own unlabelled control, a sibling spanning or padded, or a text field over a label (`ownControl`, ADR 0014) | skipped: covered by button/textfield | picked; the tap lands on the control (residual 1) |
| 5 | content of a scroll view the candidate is not in, listed after it (`scrolledContent`; WDA lists a top bar before the scroll view it is drawn over), an interactive row included, whether or not the candidate lies in a bar | skipped: covered by the row | picked; where the row is really drawn over the candidate, the tap lands on the row (residual 1) |
| 6 | a keyboard-owned node outside the band frame (`keyboard`) | skipped | picked (residual 2) |
| 7 | a scroll indicator (`scrollIndicator`) | picked (structural, already excused) | picked: unchanged |
| 8 | a structural node with a label, a value or children, partly over it, neither holding it whole nor frames only (`structural`); measured: the login and 2FA field wrappers under their own inner `container 36,367 330x52` | picked | skipped: covered by container (residual 3) |
| 9 | the centre covered but a large enough free piece (the tap would move) | skipped: covered by the last such node | skipped: covered by the centre's cover; it may name a different node |
| 10 | centre off screen or in a system band | `off screen at (x,y)` | unchanged |
| 11 | cut to a sliver (Android) / under idb's band | not reached | the `cutSliverText` clause / `under the keyboard` (not reached) |
| 12 | idb flat-list rows (`flatListChrome`, `flatListReadingOrder`, tab-bar items listed before, pinned reach) | not reached | not reached: idb's reading is `unknown`, so the picker never runs |

Measured over the fixtures (`inTreeModel(fake).dismiss()`, every non-interactive node with area as a candidate, a
synthetic WDA band on trees without one), the WDA fixtures changed in 9 of 898 candidates: rows 8 (8 field wrappers
over three login dumps and two 2FA dumps) and 1 (`placeholder_screen`). No title changed. On trees that cannot reach
the picker (idb, Compose, uiautomator, synthetic slivers), 95 of 893 changed: Compose labels under their own control
(row 4, 74), slivers (row 11, 16), idb's flat-list rows (row 12, 4) and one Compose wrapper (row 8).

## Residuals accepted

1. **The title's own control.** A title whose unlabelled interactive sibling holds it, or a label inside a text field,
   is now picked, and the dismissal tap lands on that control. A field's label focuses the field, so the confirming
   looks end in `AfterDismissalTap`. A button's label presses the button. The picker's interactive-match filter already
   had the same hazard for a text that is a button's own child, so this widens a stated hazard and does not create one.

   It is wider than the title's own control. The `target` column excuses some labelled controls too, and the picker
   then taps them: a control of exactly the title's frame (`sameFrame`, row 3), which reads as the title listed again —
   a title followed by `button "Delete account"` with the same rect, skipped before as `covered by button "Delete
   account"`, is now picked and the button pressed — and an interactive row of a scroll view the title is not in
   (`scrolledContent`, row 5), which the row excuses whether or not the title lies in a bar that is drawn over the
   rows. On the guard's path, a tap that hides the keyboard and does something of its own passes as `hidden by tapping
   … before tapping`. On the post-fill `dismiss()` path it is reported as `hiddenBy: tapping <title>`: a wrong action,
   reported as the dismissal, and nothing says otherwise. The owner decides between keeping this and an explicit
   refusal (a candidate whose excused node at its centre is interactive skipped as `covered by …`). A picker test pins
   today's behaviour (`tests/interact/keyboard-in-tree.test.ts`, the same-frame labelled button: picked, the tap at its
   centre).
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
