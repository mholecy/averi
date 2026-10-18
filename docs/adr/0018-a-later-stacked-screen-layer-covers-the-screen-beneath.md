# 18. A later stacked screen layer covers the screen beneath it

Status: accepted, 2026-10-13 (owner decision Q1 (a) on the round-12 device check's triage; accepted on the condition
that the differential harness's diff is clean and explainable; narrowed the same day to option (a) — only surfaces that
draw their whole rect — after the review of the slice found Safari's measured pass-through layer refused; the owner
confirmed option (a) and its residual 2, the RN modal whose dimming view is a wrapper with children, 2026-10-13).
Amended 2026-10-14 (owner decision Q5 (a) on the round-13 device check): a screen-filling structural leaf of a presented
layer is its surface labelled or not (see "Amendment: a labelled dim" below). Amended again 2026-10-14 (owner decision
Q-A (a) on the round-14 device check): no stroke is sent that would touch down on a presented screen, for a target in
the tree wherever it lies (see "Amendment: no stroke onto a presented screen" below; residual 6 narrowed to a target not
yet in the tree). Amended again 2026-10-14 (owner decision on the architecture review of rounds 13–15): the tap under
the status bar beneath a presented screen gives the presented screen's remedy (residual 8). Amended again 2026-10-14
(owner decisions Q1 (a) and Q2 (a) on the round-16 device check): the presented fact is judged of the target node
itself, geometry-free, so a target wholly off the screen or wholly inside the status band beneath a presented screen is
told "close it first" by every verb (see "Amendment: presented judged of the node" below); the pixel assert judges an
element nothing of which it reads lies on the screen off the screen, and a colour assert's region is clipped to the
screen before it is inset (the same amendment); an app-drawn strip with no node at a list's bottom is residual 10; an
undimmed partial sheet, where `scroll_until` strokes while the tap says close it first, residual 11. Supersedes, in one
part, ADR 0016's note that a screen-sized dimming node holding the title whole is excused (see "What changes" below).
Amended again 2026-10-15 (owner decisions Q1 (D), Q2 and Q3 on the round-18 device check): a layer holding an alert is
presented over the whole screen beneath it by the adapter's mark, not by shape (see "Amendment: a layer holding an
alert" below; residual 8 amended). Amended again 2026-10-15 (owner decisions Q1–Q6 on the round-20 architecture
review): the presented layer is the tree source's fact — the WDA parser marks it, by type or by its visibility flags,
and a marked layer covers what lies outside it through the whole screen; the Decision's conditions and the amendment
"a labelled dim" are the fallback for a tree whose source did not judge presented layers; residuals 1, 2, 5 (iOS),
6, 8 and 11 closed for WDA, 7 partly (a layer of only empty frames stands), 3, 4, 9 and 10 stand, 12–16 added (see
"Amendment: the presented layer is the source's fact" below). Amended again 2026-10-16 (round 5 of phase 3, the lab
finding L3): in the app's Window, a layer of only empty frames whose frames show on the screen, after the wholly
invisible screen beneath, is the presented one when no content layer follows — residual 7 closed for WDA for that
shape, standing for a bare frame and the rest (see "Amendment: a presented layer of only empty frames" below).
Amended again 2026-10-16 (round 5 of phase 3, architecture step A2): where the rules live — the one reader of the
marks and the shape fallback are adapters of one presentation module, `ui-tree/presentation.ts`; no decision changes
(see "Amendment: one presentation module" below; the code pointers of the earlier sections name the new places).
Amended again 2026-10-18 (round 6, the lab finding L1): uiautomator's tree carries a root mark of its own, "the dump
lists the active window only" (`UiNode.activeWindowOnly`), which picks the uiautomator adapter; its parser marks that
one window presented when the dump shows it is (`dialog`, `screen`), and a target the tree cannot list beneath it gets
"close it first" from the tap's wait and `scroll_until`'s stop, no gesture sent — residual 6 closed on Android for such a
window (see "Amendment: Android's presented window" below).

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

(Since 2026-10-15 this Decision, its three conditions and the amendment "a labelled dim" are the FALLBACK, asked only
of a tree whose source did not judge presented layers: since 2026-10-16 the presentation module's shape adapter,
`ui-tree/presentation.ts#byShape` (until then `ui-tree/presented-by-shape.ts`). On a judged tree the
presented layers are the ones the source marks — "Amendment: the presented layer is the source's fact".)

A node on a screen PRESENTED over the target's covers the target — through its own surface — when it is a surface that
draws its whole rect (`givesWay`, in `presentation.ts#byShape`; the owner's option (a) on the review of the slice):

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
takes back, and, since the amendment "a labelled dim" below, a labelled one too, which covered anyway — and the
sheet's form; never a
control, a bar the layer carries or any other labelled node, which cover anyway (Safari's capsule bar). Carried as
`StandingFacts.presented`. When a target has any such surface among its covers,
whichever cover is on top at its centre (the modal's card over the dim), its sentences say so
(ui-tree/standing.ts#presentedRemedy), in place of "scroll_until it first" and of the pinned-bar "layout defect":

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
`presentedSurface`; since the amendment "a labelled dim" below its labelled leaves are kept out by the
screen-filling-leaf condition
instead), Android's small leaves of a content layer read as a screen's surface (the full-screen leaf
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

The PIXEL 0 above is measured against d407256, before the colour/ocr assert's presented remedy of the same day. With
that remedy, a pixel assert's refusal under a presented screen — on these three trees and on every other tree with
one — reads "… — the capture would show it, not the element; a screen is presented over the element (a modal or a
sheet) — close it first; no scroll moves the element out from under that screen", under the status bar too (the bar
named, its own advice replaced). Measured with the PIXEL section (OLD = d407256, NEW = the round's code-review fixes,
the same 213 trees): every changed sentence (13 753 cases, on ten trees, each with a presented screen) keeps its
text before " — " — what is drawn over the element — and changes only its remedy, and no verdict changed (no
refusal became a measurement or the reverse).

## Amendment: no stroke onto a presented screen (2026-10-14)

Owner decision Q-A (a) on the round-14 device check (iPhone 17 simulator, iOS 27.0, WDA, at e1384aa). Residual 6 below
accepted that `scroll_until` stops at a presented screen only for a target JUDGED IN THE VIEWPORT under it; a target
beneath it that lies off screen or under the keyboard was still stroked for, and the strokes landed on the presented
screen. The device check measured what that costs:

- Contacts' New Contact sheet with its "Discard Changes" popover up, the keyboard down: `scroll_until role:container
  label:"add instant message"` (the sheet's cell at `20,1306 362x52`, below the fold) sent one stroke from (201,699) —
  on the popover's dim `container 'dismiss popup' id=PopoverDismissRegion 0,0 402x874` — which closed the popover and
  let the sheet scroll, and replied `fully visible after 1 swipe`: a false success that hides a state change.
- The SWIFT form under the Fees half sheet: `scroll_until id:swift_payment.form.payee_city_input` (`24,937`, below the
  fold) sent two strokes from (201,699) — on the sheet's form `scrollable 31,456 340x355` — which moved the sheet from
  Half to Expanded, and blamed "content exhausted, or the swipes were not taken".

docs/bugs/2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md

The fact was there: `exposure` judges only what of a target shows, so one below the fold has no covers and no
presented surface; but the point the stroke would touch down at lies on the presented screen, and the presented-surface
predicate answers for it unchanged.

Decision: before EVERY stroke, for a target the read holds and has not judged in the viewport — wholly off it, under
the soft keyboard, clipped or cut to a sliver, its centre under a system bar, or short of the stop under a node of its
own screen — `scroll_until` asks where the stroke would touch down (`stroke-plan.ts#planStroke`'s points' `from`, the
driver's own point for that stroke — since 2026-10-16 the very points it sends: its container's box, above the keyboard
line) and whether a surface of a screen presented over the target's lies there (`draw-order.ts#DrawOrder.presentedAt`:
the last node after the target holding the point that draws over it as a target — the `target` column, as `exposure`
asks first — and is a presented surface over its screen, `presentedSurface`, every condition above and the labelled-dim
amendment unchanged). If one does, the round does what it does for a target judged under such a screen: one more read
with no stroke between (when the timeout leaves one), then the `presented` stop with no stroke; should the surface be
gone from the touch-down by then, the stroke is sent as before. Only the touch-down is asked: it is where the gesture is
recognised.

The sentence keeps the presented stop's remedy and gives one clause per reason the target was not in the viewport,
then where the swipe would have landed (interact/scroll-text.ts):

- `scroll_until role:container label:"add instant message" stopped before any swipe — element lies below the viewport,
  and the next swipe would touch down at (201,699) on container "dismiss popup" (0,0 402x874) — a screen is
  presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe
  on it may dismiss it, so none was sent. Last rect {"x":20,"y":1306,"width":362,"height":52} in a 402x874 viewport`;
- in the tree but past no side of the viewport — a rect with no area, as the SWIFT form's `TextFieldWithComponentStyle`
  texts are read at 0,0 0x0: `… — element lies outside the viewport, …` (not "above": a rect with no area lies past
  no side);
- under the keyboard: `… — element lies under the soft keyboard: its centre (201,661) lies below the keyboard's top
  edge at y 573, and the next swipe would touch down at (201,459) on container "dismiss popup" (0,0 402x874) — …`
  (the tap refusal's words for the same point, one helper: interact/target-text.ts#underKeyboardText);
- in the viewport but short of the stop: `… — element is in the viewport but <the stuck and bound sentences' words for
  that shortfall: CLIPPED at …, cut at its scroll container's … edge …, its centre stays under the status bar …, under
  <node> … — N% of it shows>, and the next swipe would touch down at …`;
- after strokes: `stopped after N swipes, without swiping further — …, so no further swipe was sent`;
- "the next swipe", not "the swipe toward it": the stroke asked about is the one the round would draw next, which a
  turn, or a caller's direction away from the target, draws the other way;
- at a bound (maxSwipes, the timeout, content exhausted) whose held-back swipe would have touched down on such a
  surface, the bound's failure ends `. The next swipe would have touched down at (x,y) on <surface> — a screen is
  presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen`.

Not changed: a target judged in the viewport under a presented surface stops as before (its sentence unchanged); a
target of the presented screen itself — a row of a sheet below the sheet's fold — is stroked for on its own screen
(the touch-down lies on its own screen's form: no screen is presented over it there); a stroke whose touch-down lies
off every presented surface is sent.

The rule is platform-blind: `presentedAt` and the round ask no platform, so a tree from any source that shows a screen
presented over the target's — by `presentedSurface`'s shapes — stops the same way (the scroll-rounds row "platform-blind,
a synthetic shape on ANDROID" pins it on a cut-sliver toggle under a presented scroll view). Android is unchanged only
on the measured trees, because no Android device tree measured has a presented screen; the one Android shape that came
close (`snapF5`'s RN background leaf under its `login_screen` scroll view of the same frame) is not one, as below.

No blind stroke after a hold (review of the slice, M2): while either presented stop is held for its confirming read,
a read that does not read is confirmed again while the budget allows, and when none is left the scroll stops as the
last read that read left it (`presentedHold`) — never a stroke, which would be drawn blind onto the screen that read
saw presented. At e1384aa the in-viewport stop had the same hole: a hold, then three failed reads, then a stroke.
Stopping, not waiting to the deadline: the reads are failing, and the last one that read is the evidence there is.

One fix the amendment needed: the stuck turn (`round`'s stroke back after two unmoved strokes) is decided before the
stroke is drawn, so it can now be held for the confirming read; that read — no stroke between — read the target
unmoved and took it as the answer to the stroke back, failing `stuck` "… nor does swiping down" for a stroke down never
sent. Only a read after a stroke actually sent answers it now (`backPending`); unchanged before, where a stroke back was
always sent in the round that decided it.

The harness (OLD = e1384aa, NEW = this change, every section over 233 trees: the 213 above, the round-14 device
check's run14-ios ui_snapshots `A1`/`A2`/`B1`/`B2` (not `B1-wda-dummy.txt`, a match list), its run14-android snaps,
and its six raw WDA `/source` captures `D-*.json` parsed by `parseWdaSource`):

| Section | Diffs |
|---|---|
| ROUNDS (3 478 000 plays, 11 209 126 `round` calls one side) | 68 008, all on the 16 iOS trees with a presented screen |
| TAP, PIXEL, PICK, GUARD, KEYPOS | 0 |
| SEQ (304 tests, 1 531 `round` calls) | the 13 new scroll-rounds rows only (compared sorted; OLD fails them) |

| Tree | Presented surface at the touch-down | ROUNDS |
|---|---|---|
| run13-ios/X-wda-discard-popover.json | the popover's dim `0,0 402x874`, its scroll view `10,166 240x81` | 11 952 |
| run13-ios/A6-wda-fees-sheet-after-swipe.json | the expanded sheet's form `24,105 354x711` | 8 024 |
| run12-ios/M1-wda-fees-sheet.json | the half sheet's dim `-402,-874 1206x2622`, its form `31,456 340x355` | 7 704 |
| run13-ios/A6-wda-fees-sheet.json | the same | 7 384 |
| run14-ios/A1-wda-fees-sheet.txt, run14-ios/D-swift-fees-sheet.json | the same | 7 376 each |
| run14-ios/D-contacts-discard-popover.json | the popover's dim and scroll view | 6 880 |
| the six Contacts page-sheet trees (run12 M1 ×2, C23; run13 A3; run14 A2, D-contacts-sheet) | the sheet's form `0,62 402x812` | 1 360 each |
| run13-ios/A1-forgot-wda.json; run12-ios/FP-forgot-wda.json, run14-ios/D-finportal-forgot.json | `forgot_overlay 0,0 402x874` | 1 232; 960 each |
| every other tree (217), Android and Safari's included | — | 0 |

Every changed play ends `presented` after exactly one confirming read; none ended `visible` before, none sends more
strokes than before, and none is on an Android tree. 65 984 plays went from strokes and the bound ("content
exhausted" or "never intersected") to the stop before any swipe; 1 880 from three strokes and `stuck` to the stop
before any swipe; 144 from three strokes and `stuck` to "stopped after 2 swipes, without swiping further". Those 144
are all on the four Fees half-sheet trees, all judged either way up with `direction: "up"`. Their target (alone, or
the judged one of a pair with a full-screen container) is the tree's FIRST `container 'dismiss popup'
id=PopoverDismissRegion -402,-874 1206x2622`: a hidden twin of the sheet's dim, listed in the SWIFT form's own layer
(pre-order #4; the sheet's real dim is #143, in the presented layer). The two strokes up touch down at (201,175) on
the real dim — a presented surface — and are SENT: the twin has the dim's exact frame, and the target column excuses
a node of the target's own frame (`sameFrame`), so `presentedAt` names nothing there (residual 6). The stroke back down
would touch down at (201,699) on the sheet's form and is held. Exempting such a node from `sameFrame` in
`presentedAt` alone was measured (OLD = this change, the 233 trees): it held those 144 strokes, but also stopped 5 040
plays that end `stuck` today — 160 on Android's `run12-android/snapF5.txt` (the RN background leaf under the
`login_screen` scroll view of the same frame, no screen presented: a false stop), 3 680 on `run13-ios/A1-forgot-wda.json`
and 400 on each of three Contacts page-sheet trees — so it was not taken. Reasons said: the
target below or above the viewport (45 552), under the soft keyboard (20 432), its centre under the status bar (820),
under a node of its own screen (648), clipped (556).

ROUNDS cannot see a stroke's path, only its steps; it shows the touch-downs asked: (201,175) for strokes up, (201,385)
above the harness's keyboard band at 481, (201,699) for strokes down.

## Amendment: presented judged of the node, geometry-free (2026-10-14)

Owner decisions Q1 (a) and Q2 (a) on the round-16 device check. "Presented first" held only where the presented surface
lay over the part of the target the verb judged — its covers in the frame (`Exposure.presented`), and a frame holds
nothing of a target wholly below the fold or wholly inside the status band. Measured on the raw run16 WDA payloads,
replayed through the tools: on the Fees half sheet `tap id:…bank_country_select` (`24,1209 354x52`, wholly below) said
"scroll_until it first"; beneath Contacts' discard popover `tap role:text label:"add instant message"` (`20,1306`) the
same; on the country sheet `tap priority_select` flung to `24,-20 354x52`, wholly in the band, gave the bar's advice,
and so did its colour and ocr asserts — while `scroll_until` on each stopped on the presented screen, since it asks
`presentedAt` at its stroke's touch-down, wherever the target lies. Now
`ui-tree/draw-order.ts#DrawOrder.presentedOver(node)` — `presentedAt`'s rule less the point: the last node drawn after
the target that draws for it and is a presented screen's surface — is what the remedy (`ui-tree/standing.ts#remedied`)
asks when the frame named none, for EVERY non-reachable kind (Q1 (a): off the screen, under a bar, cut, covered, under
idb's band). Kinds do not change, only remedies. `scroll_until`'s own hold is unchanged: it stops on the standing's
presented remedy only when the surface lies over it in its read's frame, and otherwise asks its touch-down, as before —
so a stroke that misses the presented screen is still sent, and no `scroll_until` reply changes. The pixel assert's
standing gains an `offScreen` kind (Q2 (a)): nothing of what it reads lies on the screen; its remedy is the same
decision, presented first, else "scroll it on-screen", so no sampler sentence ("element rect is outside the screenshot")
decides a remedy any more. And the colour assert's region is ONE region for the judge and the sampler
(`verify/capture.ts#clipThenInset`): clipped to the screen, then inset — measured, `payee_street_input 24,869 354x52`
beneath the Fees dim was judged on the inset of its unclipped rect (y 875–915, off the screen, nothing over it) while
the sampler read its 5-pt sliver, the sheet's grey, and a colour assert expecting that grey PASSED; it now fails closed
naming the dim, "close it first" (since ADR 0010's "Amendment: the drawn frame", the same day: naming its form's
`ScrollView 0,0 402x780`, which draws none of it, still "close it first"). The review of that change found the same false PASS a little lower: moved to y
872–873.7 the field's sliver on the screen (2 pt or less) lies within the 2-unit slack, so the dim's overlap was not
counted and the sampler read ~6 px rows of the dim. So a sliver of the element on the screen no thicker than
PIXEL_OVERLAP_SLACK, on a side the screen's edge cuts, is the off-screen kind's case too ("only a sliver of the element
lies on the screen, too thin to measure"), with the same remedy decision; the slack between neighbours is unchanged, and
a whole element thinner than it on the screen (a divider) is measured; idb's keyboard band is judged before the thin
sliver, as before the system bands (ADR 0010), so an element under it is a keyboard miss as under WDA's and Android's
reading. The sampler's own sentences state the fact only, with no advice: the standing decides the remedy before any
capture. The standing leaves a rect of NO AREA to the sampler (judged by its place) — the main way the sampler meets
nothing to sample, measured by the harness on 432 calls over 72 trees: Android's inverted bounds clamped flat
(`[198,297][324,58]`), idb's node listed as 0x0 once scrolled off — and the colour assert now says so ("the element has
no area (rect …): collapsed, or a node listed as 0x0 once scrolled off the screen"); else it meets an off-png rect
("element rect is outside the screenshot") only when the png's rows round a sliver to nothing or the element moved
between the read and the capture. Wider by design: a full-screen pass-through layer (residual 1) over an off-screen
target now gives "close it first" too; `scroll_until` stops there only when its stroke's touch-down lies on that layer's
surface — on a dim filling the screen it does; on an undimmed partial sheet it may not (residual 11).

docs/bugs/2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md
docs/bugs/2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md

## Amendment: a layer holding an alert (2026-10-15)

Owner decisions Q1 (D), Q2 and Q3 on the round-18 device check (iPhone 17 simulator, iOS 27.0, WDA, at dda435b).
mp-native's SWIFT form with its SwiftUI exit alert up (`run18-ios/swift-exit-alert-wda.json`): in the app's Window, the
form's layer, then a later layer `Other 0,0 402x874` holding a BARE dimming leaf `Other 0,0 402x874` (no label, value or
identifier, no children), an empty frame and `Alert 'Exit confirmation' 41,365 320x172` — whose own backdrop views WDA
lists inside it as two bare leaves `41,365 402x874`. Every condition of `presentedOver` held; the dim was excused by the
bare-frame clause (residual 8's shape), and the parser mapped `Alert` to a plain `container`. `tap
id:swift_payment.form.message_for_bank_input` → `Tapped` (shim `201 602`), a colour assert expecting the field's grey
measured the dim's `#808080`, `scroll_until` → "fully visible after 0 swipes"; the alert's buttons were tapped right.

docs/bugs/2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md

The bare dim cannot be the fact: its shape is also a live sheet's dim (the country sheet's, `vis 1`), a live page sheet's
(Contacts', `vis 0`) and a dismissed sheet's leftover (`run17-ios/swift-closed-rest.snapshot.json`, `-402,-874
1206x2622`) — dropping the bare-frame clause was measured (option A: 8 604 diffs on 47 trees, a whole live form falsely
refused on `swift-closed-rest`) and rejected.

Decision (Q1 (D)): a layer that holds a WDA `Alert` is a PRESENTED LAYER that covers the WHOLE screen beneath it,
regardless of node frames — bare dim leaf or not, a same-frame `Toolbar` of the form included. The fact is the
ADAPTER'S, not a shape's: `adapters/wda-source.ts#PRESENTATIONS` marks the `Alert` element (`UiNode.presentation:
"alert"`; its role stays `container`) — the one place a source says a layer is presented, built so that a later
decision may mark other presentations there, alerts only now. Draw order reads the mark (since 2026-10-16 through the
presentation module's marks adapter, `presentation.ts#byMarks`):
the marked element covers every node drawn before it — not its ancestors, nor its own subtree — with its reach the
whole screen, drawn whatever the rows say; it is the layer's ONE cover (what else its layer holds — the dim, the empty
frame, the alert's texts and backdrop leaves — is drawn on it and no cover of its own), and that screen's surface
(`Exposure.presented`, `presentedAt` at any point, `presentedOver`). No stacked-screens, window or bare-frame condition:
an alert is modal (UIKit's `UIAlertController` and SwiftUI's `.alert` alike), so an alert laid in a later Window covers
the Window before it too (a residual 3 shape, closed for alerts). The alert's own buttons and texts are judged as before.
`drawnOver` (the stroke box) does not read the mark.
Only an alert ON THE SCREEN counts (owner decision, 2026-10-15, on the slice's review): one whose rect shares no area
with the screen — 0x0, or wholly off it, as WDA may keep a dismissed alert in its tree — presents nothing, and the
screen beneath is judged as before. Judged by the rect only, never by WDA's `isVisible`/`UiNode.hidden`: an alert
mid-animation may read hidden while it already takes every touch, and reading the flag would turn it into a false
`Tapped` on the screen beneath. The keyboard's own nodes are never beneath an alert, wherever WDA lists the keyboard's
Window: the keyboard is drawn over the app's windows (a key of an alert's text field stays tappable).
Residual (accepted on the slice's review): with the soft keyboard up beneath an alert, a target of the screen beneath
whose centre lies under the keyboard gets the keyboard's refusal first, not the alert's — nothing is tapped either way.

Wording (Q2): the presented remedy names the alert by its label (`ui-tree/standing.ts#presentedRemedy`, the remedy's
`layer`) — the tap `… is under container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874) at its centre
(201,602), drawn over it;
nothing of it shows — an alert is presented over it ("Exit confirmation") — close it first; nothing was tapped`; the
colour and ocr asserts `container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874) is drawn over the element
(…) — the capture would show it, not the element; an alert is presented over the element ("Exit confirmation") — close
it first`; `scroll_until` `stopped before any swipe — … — an alert is presented over it ("Exit confirmation") — close it
first, and a swipe would land on the alert, so none was sent`. Not "a modal or a sheet" and no "no scroll moves it out"
clause (an alert is no screen a scroll could move anything out from under), and never the alert's internal backdrop
leaf `41,365 402x874`, a rect that runs off the screen. The alert is named with its REACH, the whole screen
(`geometry.ts#coverText`, one spelling for the tap, `scroll_until` and the pixel assert, which said it already): the
point a sentence names — a centre at (44,84), a touch-down at (201,699) — lies on the reach, not on the card; so does
every cover whose reach is not its rect (idb's pinned CONTINUE, run down to the screen's bottom or the keyboard's top,
and a floating tab bar's item raised by its lift, now `button "Continue to summary" (24,780 354x44, reaching 24,780
354x94)` in the tap's and `scroll_until`'s sentences too). What holds of residual 11 under an alert: the tap,
the pixel assert and `scroll_until` agree — its reach is the whole screen, so every touch-down `presentedAt` asks for a
target beneath it lies on it, where every verb's `presentedOver` names it. And — owner decision on the slice's review,
2026-10-15, "stop before the swipe" — for a target NOT in the tree too (residual 6's first case, closed for alerts):
a stroke whose touch-down lies beneath an alert the tree marks (`DrawOrder.markedAt`; not on a scroll view of the
alert's own) is not sent, with the same confirming read — `scroll_until text:"Nothing like this" stopped before any
swipe — element is not in the tree, and the next swipe would touch down at (201,699) on container "Exit confirmation"
(41,365 320x172, reaching 0,0 402x874) — an alert is presented over it ("Exit confirmation") — close it first, and a
swipe would land on the alert, so none was sent.` (a plain failure, not "not present": the alert, not the selector, is
what stops it).

`ui_snapshot` prints the mark (Q3), as it prints `hidden`, so later device trees carry it into the corpus (the
normalized twin of the capture, `swift-exit-alert-after.snapshot.json`, predates it and reads as before).

The harness (OLD = dda435b, NEW = this change, the whole corpus of 648 trees): 385 712 calls, **518 differing, all on
`run18-ios/swift-exit-alert-after-wda.json`** (the raw capture; 0 on every other tree — Contacts' bare page-sheet dim, the
country sheet's dim, the Fees sheet, `run17-ios/swift-closed-rest` — and 0 on Android and idb). tap 120: 58 `Tapped` →
refused, 2 moved → refused (`id:"Toolbar"`, the dim's frame, had been moved to a 402x337 strip above the card), 13 refusals
renaming their cover (the alert's button row `container (41,457 320x80)` or its title text → the alert), 47 refusals whose
remedy alone changed; scroll_until 171: 73 "fully visible after 0 swipes" and 77 bound or stuck failures → the stop before
any swipe, 21 stops renaming their cover; assert 226: 57 colour asserts measured and PASSED (the harness paints each target its own colour) → failed closed, 51 failed closed
newly naming the alert, 23 renaming their cover, 95 whose remedy alone changed; ui_snapshot 1 (the mark printed). No reply
became `Tapped`, visible or PASS; on NEW no tap, swipe or screenshot is sent under the alert. The alert's `Discard` and
`Keep editing` are tapped as before (no diff). With the review's fixes, the same harness (NEW = this change merged with the round's other slices, 385 738
calls): the alert tree's 518 unchanged but for the reach the cover is now named with; 1 072 more on 170 iOS trees,
wording only — each reply equal to OLD's once `, reaching …` is taken out of the cover named (`scroll_until` 702, tap
370, 38 of them moved taps to the same point; idb's pinned and lifted `Continue to summary`, a floating tab bar's
items, a few bottom-pinned controls); and Android's 60 on its two raw trees holding numeric character references (the
round's entity decode, not this change).

## Amendment: the presented layer is the source's fact (2026-10-15)

Owner decisions Q1–Q6 on the round-20 architecture review (the architecture review of 2026-10-15, candidates 1 and 5;
the owner's plan allowed this ADR and ADR 0019 to be reopened, on one condition: the target's own visibility is never
evidence alone).

**What the sources already say.** WDA tells, in every raw `/source` with a presented screen, which screen is beneath:
EVERY node of the layer beneath reads `isVisible="0"`, while a later screen-sized layer of the same Window shows. That
is UIKit's modal presentation, which hides the presenting screen from accessibility: idb lists only the presented
screen (the Fees sheet's grabber, dims and rows; the alert's texts and buttons — never the form beneath), uiautomator
dumps a dialog's window alone, and WDA lists the hidden screen whole, invisible — the Contacts list's top 62 pt show
above its page sheet and still read `0`, so it is no geometric flag. Over the 59 raw WDA payloads of the differential
corpus the rule "a screen-sized layer wholly `0` under a later one that shows" holds on all 28 with a presented screen
(Contacts' page sheet and its discard popover, SwiftUI half and expanded sheets, Finportal's RN transparent modal, the
SwiftUI alert) and on none of the 31 without (Safari with its capsule layer over a visible web layer, Settings, the
pushed SWIFT form, Account Detail, MyPort, the Contacts list, a dismissed country sheet). Element types say little:
`Alert` on one tree, `Popover` → `Sheet` (an action sheet) on the five discard-popover trees; page sheets, SwiftUI
sheets and RN modals carry no type. With the layers marked, the shape rule of the Decision above changed no reply on
any raw WDA tree (the same harness diff with and without it).

**Decision (Q2, Q3): the source marks the presented LAYER.** The WDA parser (`adapters/wda-source.ts#presentedLayers`,
once per payload; the keyboard's and the input host's Windows are never searched) marks a Window's direct child —
one mark a layer, one closed kind set (`adapters/types.ts#PresentationKind`):

- by TYPE — `alert`, `actionSheet`, `popover`: the layer holds an `Alert`, a `Sheet` (UIKit's action sheet, labelled
  by its message) or a `Popover` whose rect shares area with its Window, in that precedence (Contacts' discard prompt,
  `Popover` → `Sheet "Are you sure…"`, is an action sheet). That element carries `UiNode.presentationElement` and
  names the layer; one parked off the screen (a dismissed alert WDA keeps) types nothing. The mark moved from the
  `Alert` element (the amendment "a layer holding an alert") to its layer.
- by the FLAGS — `screen` (`wda-source.ts#presentedScreen`), only in a payload that carries them: walking the Window's
  layers in order, past those under `SCREEN_SIZED_FRACTION` of the Window and those with no content (no element of a
  non-structural role: a bare dimming leaf, the input host's placeholder), the first with VISIBLE CONTENT ON THE SCREEN
  (a non-structural element `isVisible="1"` sharing area with the Window), when a layer walked past before it reads
  every element `isVisible="0"`; none when a content layer is neither — a beneath only partly `0`, or visible content
  parked off the screen (a dismissed sheet's leftover). A layer typed is not also `screen`.
- the ROOT of a payload carrying the flags is marked `UiNode.presentationsJudged`: its source judged presented layers.

What the flags rule reads (Q3): a whole LAYER's flags AND a visible later layer beside it — corroboration, never one
flag alone; never one node's flag (ADR 0019's residual 2: `isVisible` alone is no geometric truth) and never the
target's own. No shape corroboration is asked. `ui_snapshot` prints all three fields, as it prints `hidden`.

**Draw order reads the marks** (the one reader, then `draw-order.ts`'s `markOf`; since 2026-10-16
`presentation.ts#markOf`, in the marks adapter `byMarks`, which draw order asks): a marked layer covers what
lies OUTSIDE it and is drawn before it — never a layer holding the target, nor one inside it, nor the keyboard's own
nodes — through the whole screen, whatever the frames around it, for every question but `drawnOver`. So a layer's own
nodes are never beneath it: `tap id:"PopoverDismissRegion"`, the popover's own dim and the way to close it, stays
`Tapped`, and so do the action sheet's and the alert's buttons (marking the `Popover` element instead refused it, 10
false refusals on the five popover trees). How each kind covers:

- a TYPED layer as the alert before: its element is the layer's ONE cover, reaching the whole screen, named by its
  label — `… an action sheet is presented over it ("Are you sure you want to discard this new contact?") — close it
  first`, and `scroll_until`'s stop `… and a swipe would land on the action sheet`; a popover holding no action sheet
  reads `a popover is presented over it`. The alert's tree reads as before.
- a `screen` layer (Q6): the layer reaches the whole screen and is that screen's surface of last resort; its own nodes
  STAY covers, judged by the rows as before, each one over the target a presented surface (`Exposure.presented`), so
  the cover named is what of the layer lies at the point — the sheet's container, its title bar, a row, the RN modal's
  card — and the anonymous layer (`container (0,0 402x874)`) only where nothing of it draws there. The remedy is the
  presented screen's, unchanged: `ERROR id:"login_screen" is under container id:forgot_modal (16,301 370x220) at its
  centre (201,437), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it
  first; no scroll moves it out from under that screen; nothing was tapped` (it had been tapped on a 402x255 part
  below the card). Not taken: N3, no frame excuse inside a marked layer (the layer's bare full-screen wrappers win the
  point: 5 554 replies naming an anonymous container), and naming the layer itself everywhere (~9 000 covers renamed to
  it).

**The shape rule is the fallback (Q1).** The Decision's three conditions and the amendment "a labelled dim" —
`presentedOver`, `givesWay`, `presentedSurface`, the frame rows' `overPresented` / `surfaceCandidate`, and the `hidden`
row's guard (ADR 0019) — live in ONE module (then `ui-tree/presented-by-shape.ts`; since 2026-10-16 the shape adapter
of the presentation module, `presentation.ts#byShape`), which is built only for a tree whose root is not
`presentationsJudged`: Android's uiautomator tree, idb's flat list (where it never
holds), a WDA payload with no flags, and every snapshot printed before the marks — the normalized trees in the tests'
fixtures and in the corpus. A judged tree never reaches it: there the marked layers are the presented ones, and a later
screen-sized layer the source did not mark presents nothing. What both read of a node's place (`Placed`, `holderOf`,
`stackedScreens`, the frame predicates) is `ui-tree/placed.ts`. Kept, not deleted, because the old snapshots have no
other presented fact: switching the shape off everywhere was measured at 18 529 harness diffs on 42 normalized WDA
snapshots, idb 0, and on Android one tree (`run11-android/session-6.json`, SystemUI's notification shade, whose
notification stack it reads as a screen presented over the shade's own quick settings — a misreading). Deleting it is
a later pure step, once the corpus holds snapshots printed with the marks.

**`scroll_until` (Q4 and the fold of candidate 5).** The round asks ONE question for its stroke's touch-down,
`ui-tree/standing.ts#Scene.presentedAt(point, target?)`, in place of three draw-order reads. With a target, a marked
layer's cover reaches the whole screen, so `presentedAt` holds at every touch-down beneath a marked layer, wherever
the target lies — the tap and `scroll_until` agree (residual 11, closed for WDA). With NO target — one not in the tree
— `DrawOrder.markedAt(point)` asks the marked layers, the TOPMOST alone: it takes the touch (its reach is the whole
screen), and on a scroll view of its own the stroke is sent (a search inside the sheet's own list), no layer beneath
it asked; else no stroke is sent, with the same confirming read, and the stop names the layer's cover — for a `screen`
layer the last node of it at the point that draws by the column needing no target (`drawnOver`'s), else the layer
itself; a node WDA reports hidden (`UiNode.hidden`) is neither its scroll view nor named. Measured by playing
`scroll_until text:"absent"` up and down over the 59 raw WDA trees (the harness plays only targets from the tree, so
none reaches this path): 15 plays on 12 `screen`-marked trees go from two strokes and a bound to the stop before any
swipe, none the other way — `scroll_until text:"absent" stopped before any swipe — element is not in the tree, and the
next swipe would touch down at (201,175) on container "dismiss popup" (-402,-874 1206x2622) — a screen is presented
over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may
dismiss it, so none was sent.` (the Fees half sheet, stroke up, onto the sheet's labelled dim); down on the half
sheets, both ways on the Contacts sheet and the country list, the strokes land on the layer's own scroll view and are
sent, as before. As under the alert, `optional: true` does not make it a pass: the layer, not the selector, stops it.

**The harness** (the whole corpus, 648 trees, 385 712 calls, per slice against the previous): the fold, 0 diffs; the
marks, 6 555 replies on 58 trees — Android 0, idb 0, every normalized snapshot 0, on 30 unmarked raw WDA trees only the
root's mark in `ui_snapshot`, on the alert's tree only the moved mark in `ui_snapshot`; 63 verdicts flipped, all toward
refusal and all on targets of the occluded screen: 42 moved taps refused (`ContactsListView` beneath the page sheet,
moved to the status strip — residual 8's tap; the form's SwiftUI host beneath the expanded country sheet; `Toolbar`, the
occluded screen's full-screen toolbar — residual 6's same-frame shape; Finportal's `login_screen` beneath the modal —
residual 2's), 18 `scroll_until` failures (a bound, or a "layout defect") turned into the stop before any swipe
(`Toolbar`, `login_screen`), one `Tapped` refused (`priority_select` beneath the expanded country sheet, its centre
under the status bar), one colour assert PASS → failed closed beneath the same sheet, one fail-closed assert that no
longer samples; no reply became `Tapped`, PASS or a stroke. The rest is wording: the cover named moves from the shape's
surface to what of the layer lies at the point, and on the five discard-popover trees to the action sheet, with its
remedy (3 693 replies). The fallback's move, 0 diffs; the no-target stop, 0 (no play reaches it; measured as above).

The round's device check carries the probes this rests on but could not measure (Q5): a raw `/source` with the PAY
blur menu up (residual 9), a `/source` polled every 50 ms across a sheet's present and dismiss, a system permission
alert, and a non-modal sheet.

### What each residual becomes

| residual | on a judged (live WDA) tree | elsewhere |
|---|---|---|
| 1 full-screen pass-through leaf or scroll view refuses beneath | **closed**: no shape is asked; nothing is presented unless the source marks it (Safari's capsule layer: unmarked) | stands (the fallback) |
| 2 RN modal whose dim is a wrapper with children | **closed**: the screen beneath reads `0` whatever the dim's shape | stands |
| 3 a presentation in a later Window | stands for `screen` (the flags rule is per Window; none measured); a typed layer in any Window covers what is drawn before it | stands |
| 4 a bar nested in a full-screen host reads as two screens | stands (`scrolledContent`'s draw question) | stands |
| 5 a later layer under 90 % (a medium sheet, a popover) | **closed for iOS**: UIKit lays a half sheet and a popover in a full-screen layer, marked by the flags or the type | stands (Android) |
| 6 `scroll_until` strokes onto a presented screen | **(a) closed** for a target not in the tree (`markedAt`, the topmost layer, but on its own scroll view — residual 13); **(b) closed**: a marked layer's cover is no row's to excuse, `sameFrame` included | stands; (a) **closed on Android** (2026-10-18) for a window its parser marks presented (the amendment "Android's presented window") |
| 7 a layer of only empty frames | **closed** for a layer of itemless toolbars and for a dim inside a typed or content-carrying layer (the alert's bare dim, by the typed mark); **closed** (2026-10-16) in the app's Window for a layer of only empty frames with shown frames below it on the screen, after the wholly `0` beneath, no content layer after it (the amendment "a presented layer of only empty frames"); **stands** for a bare frame (a shown layer with no children), a layer whose shown frames all lie off the Window, an empty layer followed by a content leftover parked off the screen, and one in a later Window | stands |
| 8 a sheet's bare dim excused; the status strip above a large sheet | **closed**: the strip's taps are refused, "close it first" | stands |
| 9 an in-window overlay with no node (the PAY blur menu) | stands — decided by the PAY probe: if Account Detail reads `0` under the menu, the flags rule covers it | stands |
| 10 a strip with no node at a list's bottom | stands (no presentation) | stands |
| 11 an undimmed partial sheet: the tap says close, `scroll_until` strokes | **closed**: a marked layer reaches the whole screen, so every touch-down beneath it is on it | stands |

### New residuals and risks

Residuals 12–17 below are this amendment's. Risks, none measured (the device probes above are for them):

- **Mid-animation.** While a sheet presents, the screen beneath may still read `1`: no mark, nothing presented, a tap
  beneath is `Tapped`. While it dismisses, the beneath may still read `0` with the sheet sliding out: a false refusal
  for a few hundred milliseconds, which the tap's own settle and retry may cover.
- **Non-modal sheets** (a detent with background interaction): the screen beneath stays accessible, so WDA should
  report it visible — no mark, the sheet covering only where it lies. That is the right answer; unmeasured.
- **iPad-style passthrough popovers.** A typed layer over a screen WDA reports VISIBLE is still marked, and now refuses
  what lies beneath it (toward refusal), where a passthrough view would take the touch.
- **System alerts.** A permission alert is SpringBoard's, not the app's: if the app's tree reads wholly `0` with no
  visible later layer, nothing is marked and targets read clear (as before).
- **A lingering dismissed layer**: guarded by "visible content ON the screen" (a leftover parked at y 874 marks
  nothing; pinned on a synthetic tree); a leftover WDA kept visible on the screen over a beneath still `0` would be
  marked.

## Amendment: a presented layer of only empty frames (2026-10-16)

The lab's ground truth (phase 3, `presented/sheet-medium-edges`, fixtures/apps/ios/AveriLab/Presented.swift#ScrolledHost)
found residual 7's standing part as a regression: a SwiftUI medium sheet with no content of its own, presented over a
`ScrollView` scrolled 200 pt down. WDA lists the host's layer wholly `isVisible="0"` and the sheet's layer after it
shown — `dismiss popup` (`-402,-874 1206x2622`) and the card (`8,415 386x451`) as nested `Other`s, every one `1`, no
element of a non-structural role. The flags rule walked past that layer as one with no content, so nothing was marked;
the root is `presentationsJudged`, so the shape rule, which had read the labelled dim as the sheet's surface (the
amendment "a labelled dim"), was not asked either, and the five targets beneath — above the screen, under the status
bar, a 5-pt sliver at the bottom, wholly off it below, whole under the dim — got scroll or status-bar advice and
`scroll_until` stroked onto the sheet (15 golden rows red from the amendment "the presented layer is the source's fact",
41c394a; green from 753b560 to 20b800a). Adding one visible `Button` to the sheet's card in a copy of the tree marks the
layer and turns them back: the scrolled host is not the cause, the empty sheet is.

**Decision: the hidden layer beneath is the fact; content only picks which later layer is presented.** In
`wda-source.ts#presentedScreen`, in the APP's Window (the payload's first — measured: the first Window in every corpus
payload, 89 of 89 shown, holding every mark), when a layer wholly `0` was walked past and NO content layer follows it in
the Window, the first screen-sized layer after it that has no content and SHOWS — some element BELOW it, a child or
deeper, never the layer itself, `isVisible="1"` and sharing area with the Window — is marked `screen`. A bare shown leaf
presents nothing: Contacts' sheet with the keyboard up (corpus run16-ios/contacts-sheet-keyboard-wda.json) ends its
Window with `Other 0,0 402x874`, shown, no children, after its marked sheet — read as the layer itself it would be
marked wherever no content layer came first, a false "close it first" on every tap. Nor does a layer whose shown frames
all lie off the Window. Everything else is as decided: a content layer after the beneath is still the one marked, even
with an empty layer between them; a content layer neither hidden nor shown (a leftover parked off the screen) still
marks nothing; an empty layer with no wholly `0` layer before it, or one nothing of which shows, marks nothing. The rule
still reads a whole layer's flags and a visible later layer beside it — the corroboration Q3 asked for — never one
node's flag; what changed is only that the later layer need not hold a button. Draw order is unchanged: a `screen`
layer's own nodes stay covers judged by the rows, so the labelled `dismiss popup` is named over the whole target (`M`),
and the anonymous layer where nothing of it draws.

Not taken: asking the shape rule on a judged tree whose layers the source marked none of (the suspect first named:
`presentationsJudged` switching the fallback off wholesale). It would ask the shape again of every judged tree on which
the source marked nothing — Safari's capsule layer, the pass-through shapes of residual 1 — where the source's silence
is the answer, and here the source already holds the fact: the beneath reads wholly `0`.

New risk, beside "a lingering dismissed layer": an EMPTY layer WDA keeps shown on the screen after a dismissal, over a
beneath still `0`, is now marked — a false refusal while the beneath reads hidden, as for a content leftover.

Why the app's Window only: the keyboard's and the input host's Windows read wholly `0` while the keyboard is down, and
are then not the keyboard's Windows the search skips (`keyboardMarks`' roots). Over corpus-r19's 58 raw WDA payloads,
57 later Windows (on 44 payloads) read their first layer wholly `0`; 56 hold that layer alone, and the one with a layer
after it (contacts-sheet-keyboard's input host) has a hidden layer of `Other`s only, no beneath. So none was marked by
the rule even unlimited, but a shown empty layer appearing there during a keyboard transition would be marked a
presented screen in a Window drawn over the app's whole screen. Limiting the rule to the first Window costs nothing on
the corpus and the lab (every `screen` mark of the corpus is in the first Window), and leaves residual 3 — a
presentation in a later Window — as it stood.

**The harness** (corpus-r19, 648 trees, 309 raw, 385 712 calls, against debc9b2): 0 diffs — no recorded device tree
lays a presented layer of only empty frames, so the rule changes nothing the corpus holds. Golden (the lab truth, 1131
checks): the 15 WDA rows of `sheet-medium-edges` turn green, no other row changes (260 → 245 mismatches).

## Amendment: one presentation module (2026-10-16)

The architecture review of 2026-10-16 (candidate A2, round 5 of phase 3) found "what is presented over what" answered
in pieces: draw order read the marks (`markOf`, `markedOnScreen`, `markedLayers`, `laterFor`, `presentedPress`, the
no-target `markedAt`), built the shape fallback with its own frame rows handed in as a callback (`FRAME_EXCUSES`, so
the fallback's `givesWay` could name a surface from the rows that excuse it), and asked the fallback's
`presentedSurface` from three places (`Exposure.presented`, `lastPresentedSurface`, the `hidden` row) — while Android,
whose uiautomator dump lists only the presented window (the lab note L1, 2026-10-15, on truth/phase-3), had no place a
fix could land but beside the WDA shapes.

**Decision: only where the rules live changes.** `ui-tree/presentation.ts` is the one module; its interface is the
test surface (tests/ui-tree/presentation.test.ts):

- `presentationOf(tree, walk)` — built by draw order over its own walk (`placed.ts#walkOf`, moved there from
  `drawOrder`), once per tree;
- `over(node)` — what is presented over a target (`PresentedOver`): which later node a typed layer leaves undrawn
  (`drawn`), which is a marked layer's cover reaching the whole screen (`wholeScreen`), which is the surface of a screen
  presented over it and on what evidence (`surface`: `fact` for a node of a marked `screen` layer, `inferred` for the
  shape's — the `hidden` row lets only an inference outvote WDA's hidden flag, as ADR 0019 decided), and which frame
  excuse gives way (`givesWay`);
- `topmostAt(point)` — the marked layer a stroke for no target lands on (`markedAt`'s fact; draw order still names
  what of a `screen` layer draws there, by its no-target column);
- `press(surface)` — the `MarkedLayer` and reach a sentence quotes (was `DrawOrder.presentedPress`; `DrawOrder`
  now hands the module on as `presentation`, and `standing.ts#Scene.presentedAt` keeps its signature);
- `fallback` — which adapter infers what the source did not judge.

Behind it, three adapters, composed per tree: BY MARKS (`byMarks`, holding `markOf` — **the one reader of
`UiNode.presentation` / `presentationElement` is now `presentation.ts#markOf`**; read on every tree), BY SHAPE
(`byShape`, the former `presented-by-shape.ts` whole: `presentedOver`, `givesWay`, `presentedSurface`,
`OVER_PRESENTED`), asked only of an unjudged tree that is not Android's, and BY UIAUTOMATOR (`byUiautomator`), asked of
Android's tree (the uiautomator root's `paddedTouchTargets` mark). The frame excuses moved to `placed.ts#FRAME_EXCUSES`
beside the other frame predicates, so the shape adapter asks them directly and draw order hands it no callback. The
WDA parser's marking (`wda-source.ts#presentedLayers`, `presentedScreen`) stays in the parser: it reads WDA's raw
elements and flags, which ui-tree never sees; the module reads what it marks.

The uiautomator adapter knows no fact of its own yet and answers as the shape adapter — what Android got before: a
pure move. Its doc says how L1 lands there: read the dump's window facts (a window smaller than the screen — a dialog;
a screen-wide clickable scrim before the content — a sheet) into a layer, answer `topmostAt` and `press` with it, and
`scroll_until` for a target not in the tree stops "close it first" through the same `Scene.presentedAt` the WDA marks
already use. That fix is a later step with its own golden rows.

Everything decided above stands: the source's marks first, the shape only as the fallback, the target's own
visibility never evidence alone; every residual reads as before. **The harness:** golden row by row identical to
`468dc1b`, the differential over corpus-r19 against `468dc1b` 0 diffs. The code pointers of the earlier sections were
moved to the new places (`presented-by-shape.ts` → `presentation.ts#byShape`, draw order's `markOf` / `markedLayers`
→ `presentation.ts#markOf` / `byMarks`); their text is otherwise unchanged.

## Amendment: Android's presented window (2026-10-18)

The lab finding L1 (docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md,
golden over the Android lab app): `uiautomator dump` lists the ACTIVE window only. With a Compose `AlertDialog` up the
dump is the dialog's window (`[155,851][925,1368]` of 1080x2220), with a half-expanded `ModalBottomSheet` the sheet's
full-screen window, its scrim (`content-desc="Close sheet"`, clickable, `[0,0][1080,1110]`) laid before the sheet
(`[0,1110][1080,2220]`). The targets beneath are not in the tree at all, so nothing was "covered": `scroll_until`
stroked `540 1776 → 540 444` twice — on the device the first stroke dismissed the dialog (it touched down on its dim)
or dragged the sheet to full height — and the tap waited 5 s "to appear". The uiautomator adapter of the presentation
module (`presentation.ts#byUiautomator`) had been chosen by the root's `paddedTouchTargets`, a mark meaning something
else, and knew no fact of its own.

**Decision.**

1. **A root mark of the source's dialect: `UiNode.activeWindowOnly`** — set by the uiautomator parser on every tree's
   root (`android.ts#parseUiautomatorXml`), in the dialect of `flatList` and `unclippedFrames`: the tree lists the window
   that has focus, nothing beneath it. `presentation.ts#presentationOf` picks the uiautomator adapter by it;
   `paddedTouchTargets` keeps its one meaning (Compose's padded touch targets, draw order's `ownControl` row).
2. **The parser marks the window presented, as the WDA parser marks WDA's layers** (`android.ts#presentedWindow`,
   `UiNode.presentation` on the root), since it reads what ui-tree never sees — the scrim's `clickable`:
   - `dialog` — a new `PresentationKind`, typed by the window's own shape (the window is its own cover, no element):
     a window of some area NOT ANCHORED AT THE SCREEN'S ORIGIN. An app's full-screen window starts at 0,0 whatever its
     bars; one floating over what it was opened from does not. Named "a dialog is presented over it — close it first";
     `scroll_until`'s stop adds "a swipe would land on the dialog".
   - `screen` — a full-screen window whose content lays a SCRIM above a SHEET: some node's child clickable, labelled
     and childless, spanning the window's width from its top edge, followed at once by a sibling spanning the width
     to the window's bottom edge from no lower than the scrim's bottom. Named as a presented screen.
3. **The marks adapter reads that mark as any other** (`byMarks`): the window is the tree's first layer, so it is over
   no target in the tree (every node is its own — the dialog's Keep, the sheet's S are judged as before), and for NO
   target its cover takes every touch-down — outside the dialog's window too, where the touch dismisses it — but on a
   scroll view of its own (a search inside the sheet's list). `scroll_until` for a target not in the tree stops before
   any stroke, "close it first", through the same `Scene.presentedAt` / `markedAt` the WDA marks use.
4. **The uiautomator adapter answers one question of its own, `Presentation.alone`**: the root's mark on a tree that
   lists the active window only — the presented layer listed ALONE, the screen beneath unlisted. The wait for a target
   (interact/resolve.ts: the tap's, fill's and the optional tap's) asks it of its last read when the target was never
   found and ends "Timed out after …: element … is not in the tree, which lists only the window presented on top (the
   tree source lists the active window alone) — <the presented remedy>" instead of "… to appear" — a plain failure, not
   absence (nobody saw the screen beneath), as `scroll_until`'s stop. The wait is kept: a dialog that closes itself
   (a progress dialog) lets the target appear within it. On WDA's tree, which lists every window, a target missing
   beside a marked alert is missing, and `alone` is undefined.

**iOS unchanged.** idb lists only the presented layer too (the lab's SwiftUI alert and sheets), but its tree carries
neither mark: its rows stay KNOWN as residual 6 (a target not yet in the tree is stroked for).

**Measured.** Golden over the lab captures (truth/round-6, `--side` this branch): 242 → 226 mismatches, the 16 rows of
`alert-dim.xml` and `sheet-medium.xml` A–D `tap` (refused, "close it first", nothing tapped) and `scroll_until`
(stopped before any swipe, "close it first") turned green; no other row changed, on either platform. The colour
asserts there still fail "not found" (vacuous, KNOWN): the pixel assert's wait is not this amendment's.

**Residuals** 18 and 19 ("Residuals accepted" below): a fully expanded sheet is no presented window; the shapes
are measured on one AVD and Material 3 only.

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
   **Closed for WDA** (2026-10-15): on a judged tree no shape is asked, and a layer presents only when the source
   marks it (Safari's capsule layer is not). Stands on a tree whose source did not judge.
2. **An RN modal whose dimming view is a wrapper WITH children** (the card inside the tinted view, no separate dim leaf)
   is not seen: its bare surface beside the card reads as no cover, and a tap there is sent to the screen beneath and
   lands on the dim — as at 20307d2. Finportal's modal has a separate leaf; the shape is common elsewhere. Confirmed by
   the owner, 2026-10-13.
   **Closed for WDA** (2026-10-15): the screen beneath the modal reads wholly `isVisible="0"` whatever the dim's
   shape, and the modal's layer is marked. Stands on a tree whose source did not judge.
3. **A later Window is still seen only through its content.** An opaque presentation WDA lays in a Window of its own
   (none measured) has its bare surface read as no cover, as before.
   Stands (2026-10-15): the flags rule is per Window, so a presented screen in a later Window is not marked by its
   flags; a typed layer (an alert, an action sheet, a popover) in any Window covers what is drawn before it.
4. **The bar-in-a-full-screen-host shape** (`scrolledContent`'s stated residual: a bar nested in a full-screen host of
   its own, beside the content's full-screen layer, reads as two screens) is wider: the content's scroll view now
   covers the bar's button through its frame, not only a row scrolled under it. Whether real bars nest so is
   unmeasured; no fixture does.
   Stands (2026-10-15): a draw question of `scrolledContent`, not of presentation.
5. **Still not seen**, as before: a later layer under 90 % of the screen with no screen-sized wrapper (a medium sheet,
   a popover — unless its dim is a screen-filling leaf of its layer, as UIKit's `PopoverDismissRegion` is), a target
   that is itself a direct child of the node holding both, and an Android in-window overlay Compose flattens away. A
   layer drawn by the root's direct children (one window's top level, on a tree whose root is the window) reads as
   across Windows.
   **Closed for iOS under WDA** (2026-10-15): UIKit lays a half sheet and a popover in a layer of the screen's size,
   marked by the flags or by the `Popover`. The Android shapes stand, and so do they all on a tree whose source did
   not judge.
6. **`scroll_until` stops at a presented screen on its own reads**: two reads with no stroke between (or one, when no
   confirming read is left; a read that fails meanwhile is confirmed again, never answered with a stroke), of a target
   judged in the viewport under a presented surface, or — since the amendment "No stroke onto a presented screen" —
   of a target in the tree whose next stroke would touch down on one. Closed for the target off screen or under the
   keyboard that this residual first named (the device check: a stroke for a cell below the fold closed Contacts'
   discard popover and read "fully visible"). Still stroked for:
   - a target NOT YET IN THE TREE — there is nothing to ask on behalf of; its strokes may land on a presented screen
     (but not on an alert the tree marks: see "Amendment: a layer holding an alert")
     (Q-A option (b), judging the touch-down against surfaces presented over the stroked container's screen, was not
     taken: a search whose target lies in the presented sheet itself, stroked over a container picked from the screen
     beneath, would stop); a bound that ends such a scroll says nothing of it either;
   - a target with the EXACT FRAME of the presented surface at the touch-down: the target column excuses a node of the
     target's own frame (`sameFrame`), so `presentedAt` does not name it. Measured: the Fees half-sheet trees list a
     hidden twin `PopoverDismissRegion` of the sheet's dim in the form's own layer; scroll_until to it, judged either
     way up, strokes up twice onto the real dim before the stroke back would touch down on the sheet's form (the
     harness's 144 plays). Exempting such a node in `presentedAt` alone stopped 5 040 more plays, 160 of them a false
     stop on Android's RN login (`snapF5`, a background leaf under a scroll view of the same frame), so it was not
     taken;
   - a target whose presented screen the tree does not show as one (residuals 2, 3, 5); a stroke whose touch-down lies
     off every presented surface, wherever its path goes; a row of the presented screen itself, on its own screen; and
     the flush probe of a `fully: true` stop (scroll-rounds.ts#PROBE_REACH, Android's cut bounds), which is not asked.
   The stroke box (`drawnOver`) is unchanged.
   **Closed for WDA** (2026-10-15): the first case, a target not in the tree, is not stroked for beneath a marked
   layer — the topmost one, unless the touch-down lies on a scroll view of its own (residuals 13 and 14); the second,
   the same-frame twin, by construction: a marked layer's cover is no row's to excuse, `sameFrame` included. Both
   stand on a tree whose source did not judge.
7. **A layer whose content is only empty frames or itemless toolbars** reads as drawing nothing (a bare dimming view
   with no card), as before.
   Partly closed for WDA (2026-10-15), when the screen beneath reads wholly `0`: a layer of itemless toolbars is
   marked (a toolbar is content to the flags rule), and a bare dim inside a typed layer or a content-carrying one is
   covered through that layer's mark (the alert's bare dim, by the typed mark). Stands for a layer of ONLY empty frames
   (`container`/`other`, no non-structural element): `wda-source.ts#presentedScreen` skips a layer with no content, so
   it is not marked, and the screen beneath reads as before.
   **Closed for WDA** (2026-10-16) for a shown layer with shown frames below it: in the app's Window, when no content
   layer follows the wholly `0` beneath, the first screen-sized layer after it with no content whose children or
   deeper frames show on the screen is marked `screen` (the amendment "a presented layer of only empty frames"; the
   lab's medium sheet over a scrolled host, docs/bugs/2026-10-16-lab-ios-wda-scrolled-host-beneath-a-medium-sheet-loses-the-presented-remedy.md).
   Stands for a bare frame (a shown layer with no children), a layer whose shown frames all lie off the Window, an
   empty sheet followed by a content leftover parked off the screen (that layer, neither hidden nor shown, ends the
   walk with no mark), a layer in a later Window, and on a tree whose source did not judge, as before.
8. **A presented sheet's own bare dimming leaf stays excused** (Contacts' `container -402,-874 1206x2622`: an
   unidentified, unlabelled frame) — except in a layer holding an alert, which covers the whole screen by the adapter's
   mark whatever its dim is (see "Amendment: a layer holding an alert"). Above a large-detent sheet (its form `scrollable 0,62 402x812`) the list beneath
   shows only under the status bar, where no tap goes: with the device's 62-pt status band a target of the list there
   is refused as under a presented screen — its centre under the form (the harness: Contacts' `container 0,0
   402x156`, centre (201,78)), or its centre under the status bar: the refusal still names the bar, and its remedy
   is the presented screen's, "close it first", in place of the bar's (amended 2026-10-14, owner decision on the
   architecture review of rounds 13–15: presented wins over the bar in every verb — the tap had said "it lies in a
   scroll view — scroll_until it first" there while the pixel assert said "close it first" and `scroll_until`
   stopped `presented`; one precedence, presented first, is decided once in `ui-tree/standing.ts#Remedy`, so the tap
   off the screen beneath a presented screen says it too, in place of "scroll_until it with fully: true first", and so
   does whatever else keeps a target beneath such a screen from reach — a tap on a sliver its scroll container cuts,
   or with its centre under idb's keyboard band, and a pixel assert on an element that may be cut at the navigation
   bar or that idb's band meets: the cut or the keyboard is still named, the presented screen's remedy replaces its
   own. A keyboard the device reports over a pixel assert's element is still named first, with its own advice (ADR
   0010): that reading is asked before any standing). Only
   with no status band known (a screen read without one, or no screen) is that tap moved above the form, to (201,26)
   on its uncovered 402x52 — under the status bar. On a medium-detent sheet the area above it is that dim, and a tap
   there may dismiss the sheet.

   The presented fact is judged of the node itself, wherever it lies: see "Amendment: presented judged of the node,
   geometry-free" above.
   **Closed for WDA** (2026-10-15): the page sheet's layer is marked, so its bare dim no longer matters, and a target
   of the list in the status strip above the sheet is refused, "close it first" (`ContactsListView`, moved there
   before: 12 taps). Stands on a tree whose source did not judge.
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
   Stands (2026-10-15), undecided: the PAY menu was captured only as a normalized snapshot, without flags. A raw
   `/source` with the menu up decides it — if WDA reports Account Detail wholly `0` there, the flags rule marks the
   menu's layer; if not (the menu inserted in the screen, no `.isModal`), it stays.
10. **An app-drawn strip at a list's bottom with no node is not seen** (round-16 device check, 2026-10-14; residual 9's
   class). mp-native's Account Detail: the raw WDA ancestry is `ScrollView transactions.list.container` from y 180 to
   874 → its content → `row_4` from y 816 to 869, and no node clips at y 839, yet the capture shows an opaque blank
   strip from about y 839 down. `tap id:transactions.list.row_4` is reported `Tapped` (`idb ui tap 201 843`) and a
   colour assert on it measures — the tree gives no evidence of the strip, so averi cannot judge it. iOS reports no
   bottom band to cut; inventing a 34-pt home-indicator band would refuse real taps elsewhere. The same list took no
   swipes there, also app-side. No code change.
   Stands (2026-10-15): no presentation.
11. **An undimmed partial presented surface: the verbs' words agree, their behaviour does not** (the review of the
   amendment "presented judged of the node", 2026-10-14). A later screen-sized layer holding only a sheet's scroll view
   over the screen's lower part (`0,500 402x374`), with no dimming view: for a target the sheet does not lie over —
   wholly above the screen, or at y 20 under the status bar — the tap and the pixel assert say "close it first" (the
   presented fact judged of the node, Q1 (a)), while `scroll_until` strokes: it stops only on a surface over the target
   in its read's frame or at its stroke's touch-down (`presentedAt`), and the touch-down misses the sheet — two strokes,
   then its bound or the stuck sentence. Kept: the stroke lands on the target's own screen, not on the sheet, and no
   measured tree holds this shape (every measured sheet and popover lays a dim over the whole screen). Pinned by a row
   of tests/interact/remedy-agreement.test.ts stating the disagreement.

   **Closed for WDA** (2026-10-15): a marked layer reaches the whole screen, so `presentedAt` holds at every
   touch-down beneath it and `scroll_until` stops where the tap says close it first. Stands on a tree whose source
   did not judge, where the remedy-agreement row (a tree with no judged root) still pins the disagreement.
12. **A typed element inside the target's own layer no longer covers it** (2026-10-15, the review of the marks). A
   marked layer covers only what lies outside it, so an alert, an action sheet or a popover nested in the layer of
   the screen it is presented over (an over-current-context shape) covers nothing of that screen. Synthetic only —
   no measured tree lays one so — and toward `Tapped` against the element mark it replaced.
13. **A search up inside a half sheet's own list stops** (2026-10-15, the review of the no-target stop). With no
   target, the stroke's box is the scroll view beneath the half sheet (the form's), so a stroke up touches down at
   (201,175), above the sheet, on its dim, and is not sent, while a search down, touching down on the sheet's own
   list, is. The rule is as decided (Q4); the gap is the stroke box's choice of container, which reads no marks.
14. **Stacked marked layers, no target: only the topmost is asked** (2026-10-15). A touch-down on a scroll view of
   the topmost marked layer's own strokes it, and no layer beneath is asked — the discard popover's buttons list over
   the Contacts sheet, stroked up, as before. So a typed layer stacked beneath another marked layer whose own scroll
   view holds the point no longer stops a stroke there (synthetic only; two stacked typed layers were never measured).
15. **With no target a `screen` layer may be named by a frames-only wrapper** (2026-10-15) where a target's path
   names the form: the no-target column (`drawnOver`'s) excuses fewer frames. Wording only.
16. **A hidden node of a marked layer is never named** (2026-10-15): on a judged tree the `hidden` row still excuses
   every node WDA reports hidden, inside a marked `screen` layer too — the verdicts hold by the layer's cover, but a
   naming rule is needed before such a node may be named (ADR 0019's residual 6).
17. **No target: a later, unmarked layer over a marked one does not take the touch** (2026-10-15, the final review).
   With any marked layer on the screen, a touch-down is asked of the topmost marked layer alone (`markedAt`): only a
   scroll view of that layer's own lets the stroke go. A scroll view of a LATER layer or Window the source did not
   mark, drawn above the marked one, holds the point all the same and is not asked, so the stroke stops there
   (toward refusal). No tree of the corpus lays one so.
18. **A fully expanded sheet is no presented window** (2026-10-18, the amendment "Android's presented window"). Its dump
   carries no scrim — `form-picker`'s country picker lists the sheet and its drag handle only — so it is not marked: the
   form beneath times out "to appear" and `scroll_until` strokes (on the sheet's own list, which the rule would let
   through anyway). Its rows stay KNOWN (tests/differential/golden/forms.known.ts). The tree has no fact for it but
   Material's localized "Drag handle".
19. **Android's presented window: the shapes are measured on one AVD and Material 3 only** (2026-10-18). A floating
   window anchored at the origin (a popup at the top-left corner) and a full-screen dialog are not marked; a window in a
   split screen's lower half reads as a `dialog`; an app's own clickable, labelled leaf laid from its window's top edge
   at full width, with a full-width sibling under it to the bottom, reads as a scrim; a Views `BottomSheetDialog`'s
   `touch_outside` holds by the rule only if labelled (unmeasured). What a mark changes is asked only for a target the
   tree does not hold, so a misreading costs a refusal or a stop, never a false `Tapped`.

## Bug notes

docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md
docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md
docs/bugs/2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md
docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md
docs/bugs/2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md
docs/bugs/2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md
docs/bugs/2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md
docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md
