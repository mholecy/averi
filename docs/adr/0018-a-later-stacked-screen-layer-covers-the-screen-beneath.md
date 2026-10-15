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
alert" below; residual 8 amended).

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
takes back, and, since the amendment "a labelled dim" below, a labelled one too, which covered anyway — and the
sheet's form; never a
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
own screen — `scroll_until` asks where the stroke would touch down (`swipe.ts#scrollStroke`'s `from`, the driver's
own point for that stroke: its container's box, above the keyboard line) and whether a surface of a screen presented
over the target's lies there (`draw-order.ts#DrawOrder.presentedAt`: the last node after the target holding the point
that draws over it as a target — the `target` column, as `exposure` asks first — and is a presented surface over its
screen, `presentedSurface`, every condition above and the labelled-dim amendment unchanged). If one does, the round
does what it does for a target judged under such a screen: one more read with no stroke between (when the timeout
leaves one), then the `presented` stop with no stroke; should the surface be gone from the touch-down by then, the
stroke is sent as before. Only the touch-down is asked: it is where the gesture is recognised.

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
decision may mark other presentations there, alerts only now. Draw order reads the mark (`draw-order.ts#markedLayers`):
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
`Keep editing` are tapped as before (no diff).

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
7. **A layer whose content is only empty frames or itemless toolbars** reads as drawing nothing (a bare dimming view
   with no card), as before.
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
10. **An app-drawn strip at a list's bottom with no node is not seen** (round-16 device check, 2026-10-14; residual 9's
   class). mp-native's Account Detail: the raw WDA ancestry is `ScrollView transactions.list.container` from y 180 to
   874 → its content → `row_4` from y 816 to 869, and no node clips at y 839, yet the capture shows an opaque blank
   strip from about y 839 down. `tap id:transactions.list.row_4` is reported `Tapped` (`idb ui tap 201 843`) and a
   colour assert on it measures — the tree gives no evidence of the strip, so averi cannot judge it. iOS reports no
   bottom band to cut; inventing a 34-pt home-indicator band would refuse real taps elsewhere. The same list took no
   swipes there, also app-side. No code change.
11. **An undimmed partial presented surface: the verbs' words agree, their behaviour does not** (the review of the
   amendment "presented judged of the node", 2026-10-14). A later screen-sized layer holding only a sheet's scroll view
   over the screen's lower part (`0,500 402x374`), with no dimming view: for a target the sheet does not lie over —
   wholly above the screen, or at y 20 under the status bar — the tap and the pixel assert say "close it first" (the
   presented fact judged of the node, Q1 (a)), while `scroll_until` strokes: it stops only on a surface over the target
   in its read's frame or at its stroke's touch-down (`presentedAt`), and the touch-down misses the sheet — two strokes,
   then its bound or the stuck sentence. Kept: the stroke lands on the target's own screen, not on the sheet, and no
   measured tree holds this shape (every measured sheet and popover lays a dim over the whole screen). Pinned by a row
   of tests/interact/remedy-agreement.test.ts stating the disagreement.

## Bug notes

docs/bugs/2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md
docs/bugs/2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md
docs/bugs/2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md
docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md
docs/bugs/2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md
docs/bugs/2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md
docs/bugs/2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md
