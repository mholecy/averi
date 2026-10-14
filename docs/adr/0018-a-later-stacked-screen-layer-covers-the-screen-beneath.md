# 18. A later stacked screen layer covers the screen beneath it

Status: accepted, 2026-10-13 (owner decision Q1 (a) on the round-12 device check's triage; accepted on the condition
that the differential harness's diff is clean and explainable; narrowed the same day to option (a) — only surfaces that
draw their whole rect — after the review of the slice found Safari's measured pass-through layer refused; the owner
confirmed option (a) and its residual 2, the RN modal whose dimming view is a wrapper with children, 2026-10-13).
Amended 2026-10-14 (owner decision Q5 (a) on the round-13 device check): a screen-filling structural leaf of a presented
layer is its surface labelled or not (see "Amendment: a labelled dim" below). Amended again 2026-10-14 (owner
decision Q-A (a) on the round-14 device check): no stroke is sent that would touch down on a presented screen, for a
target in the tree wherever it lies (see "Amendment: no stroke onto a presented screen" below; residual 6 narrowed to
a target not yet in the tree). Supersedes, in one part, ADR 0016's note
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
`presentedSurface`; since the amendment below its labelled leaves are kept out by the screen-filling-leaf condition
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
docs/bugs/2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md
