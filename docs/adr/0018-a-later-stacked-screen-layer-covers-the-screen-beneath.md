# 18. A later stacked screen layer covers the screen beneath it

Status: accepted, 2026-10-13 (owner decision Q1 (a) on the round-12 device check's triage; accepted on the condition
that the differential harness's diff is clean and explainable; narrowed the same day to option (a) — only surfaces that
draw their whole rect — after the review of the slice found Safari's measured pass-through layer refused). Supersedes, in one part, ADR 0016's note that a
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

A node on a screen PRESENTED over the target's covers the target — through its own surface — when it is a surface that
draws its whole rect (`draw-order.ts#overScreenBeneath`, the owner's option (a) on the review of the slice):

- in `structural`: a structural LEAF (no children) — the RN Modal's dimming root `forgot_overlay`;
- in `screenSizedHost` and `contentFramed`: a SCROLL VIEW (`CONTENT_FRAMED_ROLES`) with its rows — the sheet's form;
- never a bare frame (an unlabelled, unvalued, unidentified `container` with nothing drawable in it), so the refusal
  names the surface the app named or the sheet's scroll view, not an anonymous spacer.

A wrapper or a host WITH children stays excused over another screen too: it may be a pass-through layer drawing only
its content. Measured: Safari lays `container id:CapsuleViewController 0,0 402x874` — its bottom bar with Back and
Tabs — in the app's Window after the web view, and `tap role:text text:"Go to page B"` under it was measured `Tapped`
(round 12, sessions #157/#171, `W-wda-a`, `W-wda-b`, `W1-wda-b-bar-over-scrolled`, `W3-wda-b-scrolled`). The first form of
this decision, which let every frame rule give way, refused every web element there.

"Presented over the target's" (`presentedOver`), each condition measured:

1. **Two stacked screens, inside one window.** Below the nearest node holding both, the node lies in a screen-sized
   layer and the target in another (`stackedScreens`, asked of the node as of a scroller), and that holder is not the
   tree's root. WDA's root is the Application and its children are Windows; the uiautomator parser's several windows
   hang off a 0×0 root; idb's flat list has every node a child of its root. So across Windows nothing changes. A later
   Window may pass touches through: WDA lists the input-host Window after the app's, holding the parked
   input-accessory bar (`Toolbar → … → Button "Done"` at `0,826 402x48`, `wda-source-myport-2fa-keyboard-parked.json`);
   across Windows the first form turned all 18 interactive or labelled nodes of that 2FA fixture into "covered".
2. **Not in scrolled content.** The holder neither scrolls nor lies in anything that scrolls — a scroll view's content
   layers are one screen's. (Found by the differential harness: Finportal's RN `ScrollView` on the login screen with no
   modal lays a full-screen background container, then its `0,0 402x877` content container.)
3. **The layer carries something drawable.** The layer — the child of the holder on the node's branch — has a
   descendant that is neither an empty frame nor an itemless toolbar (`carriesContent`).

Kept excused: WDA's itemless `toolbar 'Toolbar'` hosts — the SwiftUI pushed screen's full-screen host
(docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md) and Finportal's and Contacts' empty
toolbars; the Contacts sheet's own toolbars over its own title (the same screen); a target with no screen-sized layer of
its own below the holder (a bar's button beside the content layer: Back stays tapped); Safari's capsule layer.

**Platform scope.** The rule reads tree shapes, not a platform: WDA's iOS trees, and Android inside one window. On the
round-12 Android dumps it changes one node of two trees (`snapF4`, `snapF5`: Finportal's login under the RN root). The
node is the screen's own full-screen background `other 0,0 1080x2220`, listed first, whose screen-sized parent makes it a
"layer" beneath the login content's: the content's structural leaves (the logo's and the flags' parts, the fields'
wrappers) now cover it as well. It shows 45 % → 43 % and its tap point is unchanged; `scroll_until` to it, stuck as before,
now ends "a screen is presented over it" where it said the pinned-bar layout defect (residual 8). idb's flat list never
meets the rule (its holder is the root).

## What changes

The `target` column is read by the tap (`interact/tap-judgement.ts`), `scroll_until`'s stop (the standing), the pixel
assert's covers (`DrawOrder.paintsOver` filters `exposure`) and the in-tree dismissal picker (ADR 0016). Each now sees a
target of the screen beneath a presented screen as covered by it.

What the agent reads (review of the slice, M2): `DrawOrder.exposure` lists the presented screen's SURFACES among the
covers — the covers a frame row would excuse and the exception takes back (`Exposure.presented`, `presentedSurface`:
the dimming leaf, the sheet's form; never a control, a labelled node or a bar the layer carries, which covered anyway —
Safari's capsule bar) — carried as `StandingFacts.presented`. When a target has any such surface among its covers,
whichever cover is on top at its centre (the modal's card over the dim), its sentences say so
(interact/target-text.ts#PRESENTED_OVER), in place of "scroll_until it first" and of the pinned-bar "layout defect":

- the tap: `lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it; nothing
  of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under
  that screen; nothing was tapped`; `login_title`'s "330x10 part" is gone;
- `scroll_until`, stuck: `… under container id:forgot_overlay … — 0% of it shows — and the content is exhausted: swiping
  down no longer moves it, nor does swiping up. A screen is presented over it (a modal or a sheet) — close it first; no
  scroll moves it out from under that screen. Last rect …`; at a bound, the shortfall ends `— a screen is presented over
  it (…)`;
- a pixel assert on it names the layer as chrome (its wording unchanged);
- the dismissal picker skips such a candidate as `covered by container …` (its wording unchanged).

Every other cover keeps its sentence: a row of the sheet under another of its rows is still "scroll_until it first".

ADR 0016 ("What `shadowing` was measured on", structural roles) says a dimming `other` that is the screen's size and
holds the title whole is excused under the `target` column. That stays true in the title's own screen, across Windows,
and for a dimming node WITH children; it is superseded for a dimming LEAF on a screen presented over the title's —
there it covers (an `other` is no empty frame: an unlabelled `other` may be a control, `itemlessToolbar`'s reason).

`drawnOver` — the container column, `scroll_until`'s stroke box — is unchanged: it never excused a structural node with
children or a screen-sized host. The harness's ROUNDS section cannot see that column; what it sees of this change is
the scroll read judging its target against `exposure`'s covers.

## The differential harness

The owner's condition. OLD = 20307d2, NEW = this change, every section of the round-12 harness (ROUNDS, SEQ, TAP, PIXEL,
PICK, GUARD, KEYPOS) over its 94 trees plus EVERY device tree of the round-11 and round-12 device checks (each WDA or
idb ui_snapshot of run11-ios and run12-ios, each `snap*.txt` of run11-android and run12-android: 91 more, 185 in all).
The counts and every changed case, grouped by cause, are in the slice's diff report (round 13 slice A).

Final run (df5f683 against 20307d2), diffs per section and tree:

| Tree | Cause | ROUNDS | TAP | PIXEL | PICK | GUARD |
|---|---|---|---|---|---|---|
| run12-ios/FP-forgot-wda.json (#248) | the RN modal's dimming leaf `forgot_overlay` | 19 589 | 2 624 | 1 304 | 6 | 372 |
| run12-ios/M1-wda-contacts-sheet.json (#146) | the page sheet's form `scrollable 0,62 402x812` | 17 782 | 2 040 | 238 | 1 | 17 |
| run12-ios/M1-wda-contacts-sheet2.json (#150) | the same, scrolled | 17 784 | 2 052 | 414 | 1 | 48 |
| run12-ios/C23-wda-contacts.json | the same sheet, another capture | 17 782 | 2 040 | 238 | 1 | 17 |
| run12-ios/M1-wda-fees-sheet.json | mp-native's fees sheet form `scrollable 31,456 340x355`: the targets beneath, already refused under the sheet's panel, now told the sheet is presented; 47 nodes' covers gain the form | 5 900 | 920 | 252 | 0 | 72 |
| run12-android/snapF4.txt, snapF5.txt | the screen's own full-screen background (Platform scope above) | 144 + 144 | 0 | 0 | 0 | 0 |
| the 94 round-12 trees, the other 84 device trees — Safari's four (`W-wda-a`, `W-wda-b`, `W1-wda-b-bar-over-scrolled`, `W3-wda-b-scrolled`) among them | — | 0 | 0 | 0 | 0 | 0 |

KEYPOS: 0. SEQ: the two new scroll rows only (OLD's draw order stops them `visible`, the bug itself; compared sorted —
the log's order varies between runs). On the five layered trees every TAP diff is a target of the screen beneath:
"tapped", "moved" or "scroll_until it first" becomes the refusal saying the screen is presented over it (and 12 moved
taps on the scrolled sheet now name the form as the cover at the centre, the piece unchanged). Node by node, no node of
a presented layer changed.

Earlier runs found what this decision now excludes: the RN `ScrollView`'s content layer over its background (the
scrolled-content condition), Safari's capsule layer refusing every web element (TAP 3 186 and PIXEL 2 170 diffs on its
four trees — option (a)), and the capsule bar's buttons and labelled leaves read as "presented" (the frame-excuse check of
`presentedSurface`).

## Residuals accepted

(Numbered as before; 8 added with option (a) and the presented sentences.)

1. **What a layer inside one window still refuses beneath it**: a structural LEAF of the layer that is no bare frame (a
   dimming view the app named, an unlabelled `other`), and a screen-sized scroll view of the layer, wherever they lie
   over the target — when the layer is screen-sized and carries content. So a full-screen pass-through layer that is
   ITSELF a leaf or a scroll view — an RN `ScrollView` with `pointerEvents="box-none"` laid over the screen, a
   full-screen leaf a toast library lays in its host — refuses taps beneath it, and the agent reads "a screen is
   presented over it — close it first". What it no longer refuses (option (a)): a pass-through HOST with children —
   an RN Portal host, a FAB or Snackbar host with `box-none`, Safari's capsule — whose content alone covers, as before.
2. **An RN modal whose dimming view is a wrapper WITH children** (the card inside the tinted view, no separate dim leaf)
   is not seen: its bare surface beside the card reads as no cover, and a tap there is sent to the screen beneath and
   lands on the dim — as at 20307d2. Finportal's modal has a separate leaf; the shape is common elsewhere.
3. **A later Window is still seen only through its content.** An opaque presentation WDA lays in a Window of its own
   (none measured) has its bare surface read as no cover, as before.
4. **The bar-in-a-full-screen-host shape** (`scrolledContent`'s stated residual: a bar nested in a full-screen host of
   its own, beside the content's full-screen layer, reads as two screens) is wider: the content's scroll view now
   covers the bar's button through its frame, not only a row scrolled under it. Whether real bars nest so is
   unmeasured; no fixture does.
5. **Still not seen**, as before: a later layer under 90 % of the screen with no screen-sized wrapper (a medium sheet,
   a popover), a target that is itself a direct child of the node holding both, and an Android in-window overlay
   Compose flattens away. A layer drawn by the root's direct children (one window's top level, on a tree whose root is
   the window) reads as across Windows.
6. **`scroll_until` to a target beneath a presented screen swipes on that screen before it fails.** Before, it stopped
   `visible`, a false success. Now it reads the target covered and strokes until the exhaustion rule stops it — then
   says the screen is presented over it and to close it first. Stopping at once was not done: it needs an outcome of
   its own and a confirming read (a modal being dismissed reads as presented for a frame or two), and the strokes'
   cost is bounded. The stroke box comes from `drawnOver`, which this decision leaves unchanged, so up to `maxSwipes`
   strokes land on the presented screen: they scroll a sheet's own form, or do nothing on a modal. The harness's
   ROUNDS cannot see `drawnOver`.
7. **A layer whose content is only empty frames or itemless toolbars** reads as drawing nothing (a bare dimming view
   with no card), as before.
8. **A full-screen target of a screen whose content layer is laid after its background** (Finportal's Android login:
   the RN root's `other 0,0 1080x2220`) reads as beneath a presented screen: the content's leaves cover it, and its
   `scroll_until` failure says a screen is presented over it. Only the background node itself, which no flow targets;
   every node of the content reads as before.

## Bug notes

docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md
docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md
