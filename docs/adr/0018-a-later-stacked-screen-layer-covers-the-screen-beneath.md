# 18. A later stacked screen layer covers the screen beneath it

Status: accepted, 2026-10-13 (owner decision Q1 (a) on the round-12 device check's triage; accepted on the condition
that the differential harness's diff is clean and explainable; narrowed the same day to option (a) — only surfaces that
draw their whole rect — after the review of the slice found Safari's measured pass-through layer refused; the owner
confirmed option (a) and its residual 2, the RN modal whose dimming view is a wrapper with children, 2026-10-13).
Amended 2026-10-14 (owner decision Q5 (a) on the round-13 device check): a screen-filling structural leaf of a presented
layer is its surface labelled or not (see "Amendment: a labelled dim" below). Supersedes, in one part, ADR 0016's note
that a screen-sized dimming node holding the title whole is excused (see "What changes" below).

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
draws its whole rect (`draw-order.ts#givesWay`, the owner's option (a) on the review of the slice):

- in `structural`: a structural LEAF (no children) that FILLS THE SCREEN — the RN Modal's dimming root `forgot_overlay`;
  a smaller leaf stays excused (every unmapped Android leaf is an `other`, every RN View leaf under WDA too: an icon's
  parts or a field's wrapper are no screen's surface);
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

**Platform scope.** The rule reads tree shapes, not a platform: WDA's iOS trees, and Android inside one window. No
Android tree of the round-11 and round-12 checks changes (with the full-screen leaf condition, Finportal's Android
login — its content's small leaves over the RN root's own background — reads as before). idb's flat list never meets
the rule (its holder is the root).

## What changes

The `target` column is read by the tap (`interact/tap-judgement.ts`), `scroll_until`'s stop (the standing), the pixel
assert's covers (`DrawOrder.paintsOver` filters `exposure`) and the in-tree dismissal picker (ADR 0016). Each now sees a
target of the screen beneath a presented screen as covered by it.

What the agent reads (review of the slice, M2): `DrawOrder.exposure` lists the presented screen's SURFACES among the
covers (`Exposure.presented`, `presentedSurface`): the dimming leaf — the one a frame row would excuse and the exception
takes back, and, since the amendment below, a labelled one too, which covered anyway — and the sheet's form; never a
control, a bar the layer carries or any other labelled node, which cover anyway (Safari's capsule bar). Carried as
`StandingFacts.presented`. When a target has any such surface among its covers,
whichever cover is on top at its centre (the modal's card over the dim), its sentences say so
(interact/target-text.ts#PRESENTED_OVER), in place of "scroll_until it first" and of the pinned-bar "layout defect":

- the tap: `lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it; nothing
  of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under
  that screen; nothing was tapped`; `login_title`'s "330x10 part" is gone;
- `scroll_until` STOPS WITHOUT A SWIPE (the `presented` outcome, interact/scroll-rounds.ts): a read whose judged match
  lies under a presented surface is confirmed by one more read with no stroke between (when the timeout leaves one;
  else it stops on that read), then the scroll stops —
  `scroll_until id:lang_sk stopped before any swipe — element is in the viewport but under container id:forgot_overlay
  (0,0 402x874) at its centre (290,251), drawn over it — 0% of it shows — a screen is presented over it (a modal or a
  sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was
  sent. Last rect …` (after strokes: `stopped after N swipes, without swiping further`). A stroke on a presented page
  sheet is a pull: it can dismiss the sheet or raise "Discard Changes?", and a sheet dismissed so would let the next
  read find the target and report success. Should the screen be gone at the confirming read, the scroll stops as any
  other (`visible` at once);
- a pixel assert on it names the layer as chrome, and its remedy is the presented screen's too (2026-10-14): "a screen
  is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that
  screen";
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

Final run (5c7117b against 20307d2), diffs per section and tree:

| Tree | Cause | ROUNDS | TAP | PIXEL | PICK | GUARD |
|---|---|---|---|---|---|---|
| run12-ios/FP-forgot-wda.json (#248) | the RN modal's dimming leaf `forgot_overlay` | 20 024 | 2 624 | 1 304 | 6 | 372 |
| run12-ios/M1-wda-contacts-sheet.json (#146) | the page sheet's form `scrollable 0,62 402x812` | 18 584 | 2 040 | 238 | 1 | 17 |
| run12-ios/M1-wda-contacts-sheet2.json (#150) | the same, scrolled | 18 584 | 2 052 | 414 | 1 | 48 |
| run12-ios/C23-wda-contacts.json | the same sheet, another capture | 18 584 | 2 040 | 238 | 1 | 17 |
| run12-ios/M1-wda-fees-sheet.json | mp-native's fees sheet form `scrollable 31,456 340x355` (targets beneath already refused under its panel, now told the sheet is presented) | 6 408 | 920 | 252 | 0 | 72 |
| every other tree: the 94 round-12 trees and the 86 other device trees — Safari's four and Android's snapF4/F5 among them | — | 0 | 0 | 0 | 0 | 0 |

KEYPOS: 0. SEQ: the new scroll rows only (on OLD's draw order they stop `visible`, the bug itself; compared sorted).
On the five layered trees every TAP diff is a target of the screen beneath: "tapped", "moved" or "scroll_until it
first" becomes the refusal saying the screen is presented over it (12 moved taps on the scrolled sheet name the form as
the centre's cover, the piece unchanged). ROUNDS: 79 568 plays become the `presented` stop with no stroke (from
`visible` or from strokes then `stuck`); 1 968 stay `visible`, only their `covered.shows` changed (a sheet's row over a
list row whose centre is clear); 648 still stroke, as at 20307d2: 616 two-match plays whose judged match is a node of
the presented screen itself (its full-screen container under its own card or fields: 304 on the modal, 104 on each
sheet tree), and 32 whose beneath target lies under the keyboard (residual 6).
Node by node, no node of a presented layer changed.

Earlier runs found what this decision now excludes: the RN `ScrollView`'s content layer over its background (the
scrolled-content condition), Safari's capsule layer refusing every web element (TAP 3 186 and PIXEL 2 170 diffs on its
four trees — option (a)), the capsule bar's buttons and labelled leaves read as "presented" (the frame-excuse check of
`presentedSurface`), Android's small leaves of a content layer read as a screen's surface (the full-screen leaf
condition), and `scroll_until` stroking on a presented page sheet (the `presented` stop).

## Amendment: a labelled dim (2026-10-14)

Owner decision Q5 (a) on the round-13 device check (d407256). Under WDA, UIKit gives the dim of a SwiftUI half-height
sheet and of a popover as a LABELLED leaf, `container 'dismiss popup' id=PopoverDismissRegion`, laid in a later layer
of the app's Window beside what it dims: `-402,-874 1206x2622` under mp-native's SWIFT Fees sheet at its half detent
(`Sheet Grabber` `Half screen`), `0,0 402x874` beside Contacts' "Discard Changes" popover over the New Contact sheet. A
labelled node is no frame row's to excuse, so it covered already, but as an ordinary cover: `Exposure.presented` stayed
empty, the tap refusal said "scroll_until it first", and `scroll_until` stroked — the stroke moved the Fees sheet from
Half to Expanded, and closed the popover and was reported "fully visible after 1 swipe".

Decision: a STRUCTURAL leaf that fills the screen on a presented layer is a presented surface whether or not a frame
row excuses it — labelled, valued or identified (`presentedSurface` asks `structural`'s `givesWay` of every structural
node: a leaf, filling the screen, no bare frame, on a screen presented over the target's). It covered already, so no
tap, pixel or picker verdict changes; only what the sentences say does — the tap refusal says the screen is presented
over it, close it first, and `scroll_until` stops with no stroke. Still no presented surface: a control (a screen-filling
`button` backdrop), a labelled wrapper with children, a labelled leaf smaller than the screen, and any of them in the
target's own screen — each covers, with the ordinary sentence.

The harness (OLD = d407256, NEW = this change; the 185 trees above plus every device tree of the round-13 check, 22
run13-ios ui_snapshots and 6 run13-android `snap*.txt`: 213 trees):

| Tree | Cause | ROUNDS | TAP | PIXEL | PICK | GUARD | KEYPOS |
|---|---|---|---|---|---|---|---|
| run12-ios/M1-wda-fees-sheet.json | the Fees sheet's labelled dim `-402,-874 1206x2622` | 6 864 | 852 | 0 | 0 | 152 | 0 |
| run13-ios/A6-wda-fees-sheet.json (#153) | the same sheet, the device check's capture | 6 224 | 772 | 0 | 0 | 112 | 0 |
| run13-ios/X-wda-discard-popover.json (#93) | the popover's labelled dim `0,0 402x874` | 6 340 | 832 | 0 | 0 | 0 | 0 |
| every other tree (210), A6-wda-fees-sheet-after-swipe (its dim unlabelled) among them | — | 0 | 0 | 0 | 0 | 0 | 0 |

Every TAP and GUARD diff is the refusal's remedy only — "scroll_until it first" becomes "a screen is presented over it
(a modal or a sheet) — close it first; no scroll moves it out from under that screen"; the refusal, its cover and the
rest of the sentence are unchanged, and no tap became a refusal or the reverse. ROUNDS: 19 024 plays that stroked and
ended `stuck` now stop `presented` with no stroke; 404 on the popover tree (rows of the Contacts list beneath both the
sheet and the popover) stopped `presented` already and now name the dim on top at their centre instead of the sheet's
form. SEQ: the two new scroll rows only.

## Residuals accepted

(Numbered as before; 8 replaced by the sheet's bare dim after the full-screen leaf condition removed the Android background case.)

1. **What a layer inside one window still refuses beneath it**: a structural LEAF of the layer that FILLS THE SCREEN
   and is no bare frame (a dimming view the app named or labelled, an unlabelled `other`), and a scroll view of the
   layer, wherever they lie over the target — when the layer is screen-sized and carries content. So a full-screen
   pass-through layer that is ITSELF such a leaf or a scroll view — an RN `ScrollView` with `pointerEvents="box-none"`
   laid over the screen, a full-screen leaf a toast library lays in its host, labelled or not — refuses taps beneath
   it, the agent reads "a screen is presented over it — close it first", and `scroll_until` to a target beneath it
   stops without a swipe (a labelled one refused already, with "scroll_until it first"). What it does not refuse: a
   pass-through HOST with children — an RN Portal host, a FAB or Snackbar host with `box-none`, Safari's capsule — or a
   small leaf of one (an icon's View), whose content covers only where it lies, as before.
2. **An RN modal whose dimming view is a wrapper WITH children** (the card inside the tinted view, no separate dim leaf)
   is not seen: its bare surface beside the card reads as no cover, and a tap there is sent to the screen beneath and
   lands on the dim — as at 20307d2. Finportal's modal has a separate leaf; the shape is common elsewhere. Confirmed by
   the owner, 2026-10-13.
3. **A later Window is still seen only through its content.** An opaque presentation WDA lays in a Window of its own
   (none measured) has its bare surface read as no cover, as before.
4. **The bar-in-a-full-screen-host shape** (`scrolledContent`'s stated residual: a bar nested in a full-screen host of
   its own, beside the content's full-screen layer, reads as two screens) is wider: the content's scroll view now
   covers the bar's button through its frame, not only a row scrolled under it. Whether real bars nest so is
   unmeasured; no fixture does.
5. **Still not seen**, as before: a later layer under 90 % of the screen with no screen-sized wrapper (a medium sheet,
   a popover — unless its dim is a screen-filling leaf of its layer, as UIKit's `PopoverDismissRegion` is), a target
   that is itself a direct child of the node holding both, and an Android in-window overlay Compose flattens away. A
   layer drawn by the root's direct children (one window's top level, on a tree whose root is the window) reads as
   across Windows.
6. **`scroll_until` stops at a presented screen on its own reads**: two reads with no stroke between (or one, when no
   confirming read is left), and only of a target JUDGED IN THE VIEWPORT under a presented surface. A target beneath
   the screen that is off screen, under the keyboard, or not yet in the tree is still stroked for, as at 20307d2, and
   those strokes land on the presented screen (the harness: `login_support_email` under the keyboard on Finportal's
   modal, 32 plays ending at the bound). So is one whose presented screen the tree does not show as one (residuals 2,
   3, 5). The stroke box (`drawnOver`) is unchanged; the harness's ROUNDS cannot see it.
7. **A layer whose content is only empty frames or itemless toolbars** reads as drawing nothing (a bare dimming view
   with no card), as before.
8. **A presented sheet's own bare dimming leaf stays excused** (Contacts' `container -402,-874 1206x2622`: an
   unidentified, unlabelled frame). Above a large-detent sheet (its form `scrollable 0,62 402x812`) the list beneath
   shows only under the status bar, where no tap goes: with the device's 62-pt status band a target of the list there
   is refused — under the status bar, or, its centre under the form, as under a presented screen (the harness:
   Contacts' `container 0,0 402x156`, centre (201,78)). Only with no status band known (a screen read without one, or
   no screen) is that tap moved above the form, to (201,26) on its uncovered 402x52 — under the status bar. On a
   medium-detent sheet the area above it is that dim, and a tap there may dismiss the sheet.
9. **An in-window overlay with no node is not seen** (owner decision Q7 (a), 2026-10-14). mp-native's Account Detail
   `PAY` menu: a SwiftUI card inserted in the screen's own container over a blurred, dimmed Account Detail. Neither WDA
   nor idb lists a node for the blur/dim backdrop, so the rows beneath read uncovered: `tap
   id:transactions.list.row_2` was reported `Tapped` under both tree sources (shim `idb ui tap 201 652`), while the
   backdrop took the touch and only closed the menu. The tree carries no evidence of the layer, so averi cannot judge
   it; indirect signs (WDA moving the host's tab bar to its hidden frame, idb dropping it from its list) are not taken
   as one. The fix is app-side: `.accessibilityAddTraits(.isModal)` on the menu, which hides the screen beneath from
   the tree (a tap there then finds no target), or an accessibility element on the backdrop. A backdrop element covers
   the rows only when it is no excused frame — LABELLED (or a button), since a structural leaf with only an identifier
   in the target's own screen is excused — and it reads as a presented screen only when laid in a screen-sized layer
   of its own after the screen's, as a sheet's dim is (inserted in the screen's own container, as this menu is, it is
   an ordinary cover: refused, with "scroll_until it first").
   docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md

## Bug notes

docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md
docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md
docs/bugs/2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md
docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md
