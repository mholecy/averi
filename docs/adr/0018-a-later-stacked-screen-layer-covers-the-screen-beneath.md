# 18. A later stacked screen layer covers the screen beneath it

Status: accepted, 2026-10-13 (owner decision Q1 (a) on the round-12 device check's triage; accepted on the condition
that the differential harness's diff is clean and explainable). Supersedes, in one part, ADR 0016's note that a
screen-sized dimming node holding the title whole is excused (see "What changes" below).

## Context

The round-12 device check (iPhone 17 simulator, iOS 27.0, WDA, at 20307d2) found two taps reported `Tapped` that landed
on a layer drawn over the target, and nothing beneath was pressed:

- docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md: Finportal's
  `ForgotPasswordModal`, a React Native `Modal` with `transparent`. WDA lays it in the app's Window after the login
  screen: a leaf `container id:forgot_overlay 0,0 402x874` (the tinted root), empty frames, the card `forgot_modal
  16,301 370x220`, `forgot_close`, all in frames of the screen's size. `tap id:lang_sk` → `Tapped` (shim `290 251`),
  the language unchanged. `tap id:login_title` was refused under the card, but said a 330x10 strip of it "shows" —
  the overlay's.
- docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md: Contacts' New
  Contact page sheet, laid in the app's Window after the list: the dimming leaf `-402,-874 1206x2622`, the sheet
  `0,62 402x812` and its form `scrollable 0,62 402x812` (0.929 of the screen). `tap role:button label:"Contact photo
  for Kate Bell"` → `Tapped` (shim `41 290`), on the sheet's bare background.

The `target` column of draw order's `NOT_DRAWN` (`ui-tree/draw-order.ts`) excused every node over those points by its
frame: `structural` (an unlabelled wrapper holding the target whole that is the screen's size, or a leaf),
`screenSizedHost` (a non-interactive node with children of at least 90 % of the screen — its comment called a
transparent modal's host read as no cover an "accepted trade-off") and `contentFramed` (a scroll view covers only
through its content). Only round 9's rule for two STACKED SCREENS (`stackedScreens`) knew that a later screen-sized
layer is drawn over the screen beneath, and it was asked only of a scroller's CONTENT (`scrolledContent`), never of the
layer's own surface.

## Decision

A node one of those three rules would excuse still covers a target when all of these hold
(`draw-order.ts#overScreenBeneath`):

1. **Two stacked screens, inside one window.** Below the nearest node holding both, the node lies in a screen-sized
   layer and the target in another (`stackedScreens`, asked of the node as of a scroller), and that holder is not the
   tree's root. WDA's root is the Application and its children are Windows; the uiautomator parser's several windows
   hang off a 0×0 root; idb's flat list has every node a child of its root. So across Windows nothing changes.
2. **The layer carries something drawable.** The layer — the child of the holder on the node's branch — has a
   descendant that is neither an empty frame (an unlabelled, unvalued, unidentified `container`) nor an itemless
   toolbar (`carriesContent`).
3. **The node is no bare frame.** An empty frame with nothing drawable in it stays excused, so the refusal names the
   layer's surface the app gave a name (`forgot_overlay`) or the node that carries the content (the sheet's form), not
   an anonymous spacer.

Why one window: the measured layers are presentations inside the app's Window (an RN `Modal` and a UIKit page sheet
both present a view controller there). A later WINDOW may pass touches through: WDA lists the input-host Window after
the app's, holding the parked input-accessory bar (`Toolbar → … → Button "Done"` at `0,826 402x48`,
`wda-source-myport-2fa-keyboard-parked.json`). Across Windows the rule turned every node of the 2FA screen into
"covered" — 18 interactive or labelled nodes of that fixture, measured tappable. The owner named a full-screen
pass-through window as an accepted risk; the measured one is not accepted, and no measured layer needs Windows.

Kept excused: WDA's itemless `toolbar 'Toolbar'` hosts — the SwiftUI pushed screen's full-screen host
(docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md) and Finportal's and Contacts' empty
toolbars — which carry nothing and lie in the target's own screen; the Contacts sheet's own toolbars over its own title
(the same screen); a target with no screen-sized layer of its own below the holder (a bar's button beside the content
layer: Back stays tapped).

## What changes

The `target` column is read by the tap (`interact/tap-judgement.ts`), `scroll_until`'s stop (the standing), the pixel
assert's covers (`DrawOrder.paintsOver` filters `exposure`) and the in-tree dismissal picker (ADR 0016). Each now sees a
target of the screen beneath a stacked layer as covered by the layer:

- the tap refuses it: `lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over
  it; nothing of it shows — scroll_until it first; nothing was tapped`; `Contact photo for Kate Bell is under
  scrollable (0,62 402x812) …`; `login_title`'s "330x10 part" is gone;
- `scroll_until`'s stop reads such a target covered, never `fully` visible;
- a pixel assert on it names the layer as chrome;
- the dismissal picker skips such a candidate as `covered by container …`.

ADR 0016 ("What `shadowing` was measured on", structural roles) says a dimming `other` that is the screen's size and
holds the title whole is excused under the `target` column. That stays true in the title's own screen and across
Windows; it is superseded where the dimming node is, or lies in, a later screen-sized layer stacked over the title's
screen inside one window whose layer carries content — there it covers (an `other` is no empty frame: an unlabelled
`other` may be a control, `itemlessToolbar`'s reason).

`drawnOver` — the container column, `scroll_until`'s stroke box — is unchanged: it never excused a structural node with
children or a screen-sized host. The harness's ROUNDS section cannot see that column; what it sees of this change is
the scroll read judging its target against `exposure`'s covers.

## The differential harness

The owner's condition. OLD = 20307d2, NEW = this change, every section of the round-12 harness (ROUNDS, SEQ, TAP, PIXEL,
PICK, GUARD, KEYPOS) over its 94 trees. The counts and every changed case, grouped by cause, are in the slice's diff
report; the summary is below.

<!-- harness summary -->

## Residuals accepted

1. **A pass-through layer INSIDE one window now refuses taps beneath it**, when it is screen-sized and carries content:
   a full-screen host with `pointerEvents="box-none"` holding a toast or a banner, an in-window LogBox-like overlay.
   This is the owner's named risk, narrowed to one window: the tree gives no touch handling.
2. **A later Window is still seen only through its content.** An opaque presentation WDA lays in a Window of its own
   (none measured) has its bare surface read as no cover, as before.
3. **The bar-in-a-full-screen-host shape** (`scrolledContent`'s stated residual: a bar nested in a full-screen host of
   its own, beside the content's full-screen layer, reads as two screens) is wider: the content layer's own frame now
   covers the bar's button, not only a row scrolled under it. Whether real bars nest so is unmeasured; no fixture does.
4. **Still not seen**, as before: a later layer under 90 % of the screen with no screen-sized wrapper (a medium sheet,
   a popover), a target that is itself a direct child of the node holding both, and an Android in-window overlay
   Compose flattens away. A layer drawn by the root's direct children (one window's top level, on a tree whose root is
   the window) reads as across Windows.
5. **A layer whose content is only empty frames or itemless toolbars** reads as drawing nothing (a bare dimming view
   with no card), as before.

## Bug notes

docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md
docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md
