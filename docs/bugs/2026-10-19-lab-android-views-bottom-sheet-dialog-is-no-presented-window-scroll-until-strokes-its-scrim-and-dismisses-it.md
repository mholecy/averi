# BUG: a Views `BottomSheetDialog` is no presented window on uiautomator — `scroll_until` for a target beneath it strokes its `touch_outside` scrim, dismisses the sheet and reports the target "fully visible"

> **Status (2026-10-19):** fixed at 25da22d4 (arch/r23-sheet-dialog; f924893e the fix) — the uiautomator parser marks
> the window a `screen` by Material's ids (src/adapters/android.ts#materialSheetDialog: `…:id/touch_outside` followed by
> `…:id/design_bottom_sheet` under `…:id/coordinator`, read against the scrim's edges; ADR 0018's amendment "a Views
> BottomSheetDialog by Material's ids"). Measured: golden 8 rows green, every other row byte-identical; live on
> averi_lab ×3 (docs/truth/live-records/android-vis-sheet-dialog-run{1,2,3}.json), 13/13 ok each — taps refused with
> the presented remedy, scroll_until stopped before any swipe, the sheet not dismissed. The colour 4 stay KNOWN `not in
> the tree` as no note's. The full-screen dialog stays residual 19 (below, "The full-screen dialog").
> Was: open, measured on the lab (round 7, T2), KNOWN as this note — its 8 replayed rows
> (tests/differential/golden/presented.known.ts, `bottom-sheet-dialog.xml` A–D tap and scroll_until) and its four live
> scroll cases (scripts/truth/live-known.ts, `android uiautomator scroll:bottom-sheet-dialog.A`–`D`), struck off at
> the merge into truth/round-7; calibrated in scripts/truth/calibration.json.

Lab note LW1. **Found 2026-10-19** by round 7's lab cells for ADR 0018's residual 19 (docs/plans/2026-10-15-ground-truth-lab-app.md,
"Round 7"): `presented/bottom-sheet-dialog` and `presented/dialog-fullscreen` (fixtures/apps/android/…/Presented.kt
#ViewsBottomSheet, #FullScreenDialog), on the `averi_lab` AVD (API 33, 1080x2220, gesture navigation), averi =
truth/r7-dialogs' src (arch/round-23's, unchanged). Captures: tests/fixtures/truth/android-averi_lab-api33/
bottom-sheet-dialog.{xml,png,truth.json}, dialog-fullscreen.*; live records: docs/truth/live-records/
android-vis-dialogs.json (both cells, 26 cases) and android-vis-dialogs-scroll-run2.json, -run3.json (the 8 scroll
cases twice more). Summary: docs/truth/live-android-2026-10-18-visibility.md, "Round 7: presented windows the parser
does not mark".

## The cell

Material Components 1.13.0's `BottomSheetDialog` (theme `Theme.Material3.Light.BottomSheetDialog`) over the four slot
targets A–D (Base.kt), its content a ComposeView 360 dp tall holding the layer's own target S — shorter than the
sheet's peek height, so the sheet opens whole. A tap on `touch_outside` dismisses it.

## Observed (measured)

The dump (`uiautomator dump`, the sheet up) is the dialog's window ALONE, at 0,0 the screen's size — the targets
beneath are not in it (attributes trimmed):

```
FrameLayout                                   [0,0][1080,2220]      the window's decor
 LinearLayout                                 [0,0][1080,2154]
  FrameLayout                                 [0,0][1080,2154]
   FrameLayout  dev.averi.lab:id/action_bar_root  [0,0][1080,2154]
    FrameLayout  android:id/content           [0,0][1080,2154]
     FrameLayout  dev.averi.lab:id/container  [0,0][1080,2154]
      ViewGroup  dev.averi.lab:id/coordinator [0,66][1080,2154]
       View  NAF="true" dev.averi.lab:id/touch_outside  clickable="true" content-desc=""  [0,66][1080,2154]   (no children)
       FrameLayout  dev.averi.lab:id/design_bottom_sheet  clickable="false"  [0,1164][1080,2154]
        ComposeView … lab.bottom-sheet-dialog.S  [128,1406][953,1582]
 View  android:id/navigationBarBackground     [0,2154][1080,2220]
```

The probes (capture-android.ts): A and B — under the scrim — unreached, each probe `dismissed sheet`; C and D under the
sheet unreached; S reached and drawn whole. Screenshot: the scrim dims A and B (#9B2724, #145C9B), the sheet's
surface (#F7F2FA) covers C and D.

**Why the parser does not mark it** (src/adapters/android.ts#presentedWindow): the window lies at 0,0 (no `dialog`),
and the `screen` shape — a clickable, LABELLED, childless scrim from the window's TOP edge at its width, a sibling
under it to the window's BOTTOM edge — fails three ways at once: `touch_outside` has no content description (uiautomator
flags it `NAF="true"`, a clickable node with no text and no label), it starts at the coordinator's top (y 66, below
the status bar; the coordinator fits the system windows), not the window's (0), and the sheet ends at 2154, above the
navigation bar's background view, not at the window's bottom (2220). So residual 19's "a Views `BottomSheetDialog`'s
`touch_outside` holds by the rule only if labelled (unmeasured)" is measured: it does not hold, labelled or not — the
edges fail too.

**What averi does** (live, three runs, the same every run; golden alike):

- `tap` A–D: no tap sent; "Timed out after 5000ms waiting for element id:"lab.bottom-sheet-dialog.A" to appear" with
  the active-window hint beneath it — "(the tree lists only the active window: if a sheet or a dialog is open over the
  screen, close it first)". Honest (ADR 0018 decision 5); ok live, red in the replay as residual 19's/18's class (`not
  in the tree (active-window hint)`: the hint's conditional, not the presented remedy).
- colour assert A–D: "FAIL … not found within 3 s" — no hint (at round 7's base, e856afc, the asserts carried none:
  decision 5); ok live.
- `scroll_until` A, B (asked `up`): ONE stroke, touching down at (540,444) — on
  `touch_outside` — which DISMISSES the sheet; the screen beneath is the active window then, A in it, and the reply is
  `Element id:"lab.bottom-sheet-dialog.A" fully visible after 1 swipe`. The app logs `dismissed sheet`. Nothing in the
  reply says a dialog was closed: the agent is told the target is visible on a screen whose sheet it never asked to
  close — lab finding L1's failure (docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md)
  back, on a window that finding's fix does not mark.
- `scroll_until` C, D (asked `down`): two strokes touching down at (540,1776), on the sheet (already at its full
  height: nothing moves), then "failed after 2 swipes … element never appeared in the tree (the tree lists only the
  active window: if a sheet or a dialog is open over the screen, close it first)". Honest in the end, two strokes on
  the presented layer first.
- The replay (golden, the tree never changes): every target's scroll_until strokes `540 1776 → 540 444` twice and
  fails with the hint.

## Proposal (src; for the orchestrator to schedule — not edited from the truth branch)

The window can be marked from the dump: Material Components lays a `BottomSheetDialog` from its own layout
(`design_bottom_sheet_dialog.xml`), whose view ids reach the dump as `<app package>:id/<entry>`, never localized:

- a node whose resource-id's entry is **`touch_outside`** (`…:id/touch_outside`), `clickable="true"`, childless;
- followed AT ONCE by its sibling whose entry is **`design_bottom_sheet`** (`…:id/design_bottom_sheet`);
- both children of `…:id/coordinator`; the scrim spans the coordinator (`[0,66][1080,2154]`), the sheet shares its
  left, width and bottom (`[0,1164][1080,2154]`), its top inside the scrim — at or below the scrim's top (`>=`: a
  sheet dragged or opened to full height would start where the scrim does; unmeasured).

Proposed rule, beside the scrim shape in `presentedWindow` (it reads the raw dump, as the scrim's `clickable` is
read): a window holding a clickable, childless `…:id/touch_outside` followed at once by `…:id/design_bottom_sheet`
of the same left and width, its bottom the scrim's and its top inside it (at or below the scrim's top, EQUAL
included — a fully expanded sheet), is a `screen`. The geometry is read against
the SCRIM, not the window's edges (the coordinator fits the bars). Matching the entry name, not the full id (the
package is the app's). Not a relaxation of the scrim shape to unlabelled leaves: an unlabelled full-width clickable
leaf over a full-width sibling is common app content (a card's touch layer), and the label was the shape's guard
against it; the ids are Material's own. What it changes: the marks adapter then reads the window as any marked
screen (ADR 0018 decision 3) — `scroll_until` for a target not in the tree stops before any swipe, "close it first";
the tap's wait ends with the presented remedy instead of the hint. Expected golden: the 8 rows of this note green
(tap 4, scroll_until 4 to the presented remedy); the colour 4 stay "not found", KNOWN `not in the tree` as no note's,
as alert-dim's and sheet-medium's colour rows are.
Residual it would state: an app's own bottom sheet built without Material's dialog (a custom Dialog, a Compose
`ModalBottomSheet` fully expanded — residual 18) is still unmarked; a FULLY EXPANDED `BottomSheetDialog` (the sheet's
top at the scrim's, or the scrim covered whole) is unmeasured — the rule's `>=` is written for it, no capture holds
it; and a `BottomSheetDialogFragment` uses the same layout (unmeasured, expected to match).

## The full-screen dialog (dialog-fullscreen): no signal — residual 19 stands

A Compose `Dialog` with `usePlatformDefaultWidth = false` and `decorFitsSystemWindows = false`, its content
`fillMaxSize`, opaque. Compose lays the window ITSELF, between the system bars at full width: `dumpsys window` reads
`(0,0)(1081x2087) gr=CENTER`, frame `[0,66][1081,2153]` — `FLAG_LAYOUT_NO_LIMITS`, no fitted insets and
`setLayout(MATCH_PARENT, MATCH_PARENT)` set on its window after it is shown are overridden by Compose's own size (each
tried and measured). So the plan's "its window at 0,0 the screen's size" is not what a Compose app gets; the cell keeps
Compose's own window. The dump:

```
FrameLayout                       [0,66][1080,2153]   the dialog's window
 FrameLayout                      [0,66][1080,2153]
  FrameLayout  android:id/content [0,66][1080,2153]
   ViewGroup                      [0,66][1080,2153]   Compose's DialogLayout
    View … View                   [0,66][1080,2153]
     TextView "Lab full-screen dialog", View lab.dialog-fullscreen.S [128,528][953,704], View (Close) …
```

The window lies against the screen's left edge (x 0), offset on one axis only — the shape `presentedWindow` reads as
an app's own window (a landscape window beside a cutout, a compat-mode app letterboxed), by design (ADR 0018
"Android's presented window", decision 2). Compared with the activity's own window (open.xml: `FrameLayout →
LinearLayout → FrameLayout android:id/content → ComposeView`, `[0,0][1080,2220]`), what differs is theme- and
toolkit-dependent: the decor's second level (`FrameLayout` here, `LinearLayout` for the activity — an AppCompat
activity lists `action_bar_root`, the sheet dialog above does too), Compose's `DialogLayout` classed `ViewGroup` where
`setContent` lists `ComposeView`, and the window stopping above the navigation bar (as any window fitting the bars
does). None is a fact a dialog has and an app's screen lacks, so no mark is proposed: the hint (decision 5) is the
answer, as accepted.

What averi does there (live, three runs; golden alike): the taps time out with the hint; the colour asserts fail "not
found"; `scroll_until` strokes the dialog twice (touch-downs at (540,444) asked up, (540,1776) asked down — nothing
scrolls, nothing is dismissed: the dialog has no outside) and fails with the hint. KNOWN as residual 19.
