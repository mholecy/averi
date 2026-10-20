# 13. Refuse a tap on a sliver cut by its scroll container

Status: accepted, 2026-10-10 (owner). Refined 2026-10-17 (owner, lab note F2A1). Decided 2026-10-18 (owner): F2A1's
way past kept after the remedy, a fill into the strip refused by design, k7's "fully" a residual (below). Refined
2026-10-19 (orchestrator, round 7 A6, the owner's delegation): k7's residual closed by the eyes (below). Refined
2026-10-20 (round 14, LE2): the eyes look for a clip line under idb (below).

## Context

uiautomator cuts most rects to their scroll container (not all: a Compose `verticalScroll` in an edge-to-edge window is
cut, if at all, a status bar's height past it — a rect past its container's edge is judged by the drawn frame, ADR 0010's
amendment of 2026-10-20, not by this rule, which reads only a rect flush with the edge;
docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md). On mp-native's SWIFT
form (Android) the "Payment details" toggle, 132 px tall, read `66,1924 948x55` at the form's bottom edge (1978). The tap
went to (540,1952) and "Tapped" was reported, but the section did not expand. Hand taps on the strip did nothing either. A target that size beside a COVER
was already refused; one cut to that size by a CLIP was tapped and reported done.

## Decision

The tap refuses a target its scroll container cuts to a sliver under the tap minimum
(`ui-tree/draw-order.ts#MIN_TAP_PIECE_FRACTION`), with its own refusal class
(`interact/tap-judgement.ts#ClippedRefusal`), and nothing is tapped. What counts as cut is
`ui-tree/geometry.ts#Clips.cutSliver`'s. The remedy is a plain
`scroll_until` toward the cut edge, whose plain stop does not stop on such a sliver either (`ui-tree/standing.ts#Scene`).

## Refined 2026-10-17 (owner): a sliver cut by a node drawn after it

Compose leaves out of a node's bounds what a node drawn after it covers. On the lab's `form-keyboard` (Android) the
submit bar rides on the IME and has no node; `Continue` (`55,1238 970x132`) is drawn after the form, and the `phone`
field below it — a 132-px touch target from 1280 — is dumped as `55,1370 970x42`. `scroll_until` answered "visible after
0 swipes" though the user sees only the bar's grey. After `back`, `note` is dumped `55,2126 970x14`, 7 px of it below
`Continue`; averi tapped that strip and reached the field only because the lab's bar lets touches through (a tap at the
field's own centre submitted the form).

The same rule now covers that cut: a CONTROL thinner than the tap minimum across an edge that lies flush with a node
drawn after it, that node spanning the edge (`ui-tree/standing.ts#cutByLater`), is a sliver cut by that node
(`geometry.ts#Cut.by`). The tap refuses it (`ClippedRefusal`), naming that node, where the strip lies and how much of it
shows; the remedy is to dismiss the soft keyboard first when it is up (a bar riding on it goes down with it), or to
scroll it out from under that node. `scroll_until`'s plain stop and its `fully: true` stop do not stop on it. Its strokes
go on (the node is outside the field's scroll view, so a scroll may bring the field out from under it), and when they
move nothing the failure names the node and the same remedy. The cut edge never turns a stroke, because the rest of the
field lies under the node, not past the far edge. Android only: WDA reports frames unclipped (the same lab cell lists
`phone` whole under the bar, covered at its centre), and idb's flat list has no subtree to say "drawn after".

Residuals of the refinement: a whole control thinner than the minimum laid flush against a later node that spans it is
refused too, because the dump cannot tell it from a cut. It is handled as the container cut's own residual is: the
sentences say the rest "may" lie under that node, the tap's remedy adds the way past ("if it is whole — a control that
thin laid flush against that container — no scroll shows more: tap by coordinates"), and `scroll_until`'s stuck failure
names the alternative ("or it is only that thin, laid flush against it"). A text that is no control (the field's title,
cut to 14 px at the same bar) is tapped as before. The second residual: a clickable with no role — Compose's
`Modifier.clickable` without one dumps as `android.view.View`, read as a `container` or `other` — cut to such a strip is
still tapped on the strip, and in an app whose bar takes the touch that tap is reported done and reaches nothing (the
owner's "accidentally submitted" risk). Not widened on purpose: the gate is the control roles
(selectors.ts#isInteractive), and a role-less node is as often a layout wrapper as a clickable — refusing those would
refuse wrappers and containers that are no target.
A bar riding on the keyboard whose cutting node (`interact/target-text.ts#ridingKeyboard`) ends more than the tap
minimum above the keyboard's line (buttons stacked in it, the cut one on top) is not read as riding: its remedy is the
scroll alone, without "dismiss the keyboard first" — the safe direction, a remedy that may not suffice rather than one
that misleads.

Bug note: docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md

## Decided 2026-10-18 (owner, on round 6's Android device check)

Three points the device check left open (docs/truth/live-android-2026-10-18-visibility.md):

1. **The way past stays, after the remedy.** "only if a screenshot shows it whole — … no scroll shows more: tap by
   coordinates" is KEPT; in every reply of the family — a control cut by a node drawn after it (with the keyboard up
   or down: `interact/target-text.ts#cutByRemedy`, `#wholeThinWayPast`; `scroll_until`'s stuck failure and its bound,
   scroll-text.ts) and a sliver of its scroll container (`interact/tap-judgement.ts#OWN_CUT_WAY_PAST`,
   `INHERITED_CUT_WAY_PAST`) — every remedy it names (dismiss the keyboard first, scroll) comes BEFORE the coordinate
   escape, which closes its sentence. Every reply already so ordered; pinned over the lab's real form-keyboard captures
   (tests/helpers/escape-order.ts, read by tests/interact/tap-judgement.test.ts and scroll.test.ts). A later
   sentence of its own — `scroll_until`'s note on the rounds judged above the IME ("… hide it first … and scroll
   again") — may follow it.
2. **A fill into such a strip is refused by design.** `fill` taps its field first, so the cut-by refusal holds for it
   as for the tap: note's 14-px strip under the bar after `back` (live case k3) is refused naming the remedy, the field
   untouched — no typing through a strip the dump cannot prove is the field. The live judge reads that as ok
   (scripts/truth/live.ts k3).
3. **"fully visible" with part of the target under a node-less surface is a known residual** (below) — closed
   2026-10-19 by the eyes (next section).

## Refined 2026-10-19 (orchestrator, round 7 A6): the eyes confirm a fully claim

(Extended 2026-10-19, round 9: the eyes answer a second question — which of two controls listed in reading order is
drawn on top — on one screenshot as well, unsettled by the same reasoning for the tap and `scroll_until`, the pixel
assert's own settled frame for it: docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md.
`Eyes` is now an interface of the two questions, `fully` this section's.)

The owner's 2026-10-18 point 5 asked for pixels where the tree cannot see. A stop about to say "fully visible" —
nothing of the target clipped, nothing listed over it (`interact/scroll-read.ts#fullyClaimed`, the round's and the
reply's one predicate) — on a target with a FLUSH NEIGHBOUR (`ui-tree/standing.ts#Scene.flushNeighbours`: a node drawn
after it, outside the clipping scroll view it lies in, laid flush against one of its edges along its whole extent, on a
tree that cuts bounds at a later node — Android's; the shape Compose's cut leaves under a pinned or IME-riding bar),
NARROWER than the screen along that edge, is first checked with ONE screenshot per claimed stop (`ui-tree/eyes.ts`,
the question and answer; `verify/eyes.ts#judgeEyes`, the judge; asked through `interact/scroll-rounds.ts#round`'s
`ask eyes`, wired at `mcp/tools.ts` and `flow/engine.ts`). Every flush edge is judged on that one screenshot; the
deepest band any edge shows is the answer. Per edge, over the target's pixel region (`Scene.pixelRegion`):

1. the SURFACE's colour: the screen beside the neighbour on its own rows (where its surface draws if it draws past its
   node), every such strip one colour, all of them one;
2. the BAND: the target's lines from the edge inward while a line is one colour with the surface's;
3. the target's OWN colour: the dominant of what of the region lies past the band (never the band's rows: a band two
   thirds of a label deep leaves the label's glyphs), at least ΔE00 2.0 from the surface's;
4. its OWN MARGIN: Android dumps a control's touch target, bigger than what it draws, so a band of the colour the
   screen shows around the target may be its margin over that background — the screen beside the target, on the lines
   past the band, must not be one colour with the surface's (and there must be some screen beside it).

"One colour" is counted pixel by pixel, unbucketed: 90 % of the pixels within ΔE00 1.0 of the reference (never the
colour sampler's 4-bit buckets, which put `#FFFFFF` and `#F2F2F7` in one). A band deeper than the pixel slack (ADR
0002) is said:

- the plain stop stops when the band leaves its centre clear, and says `PARTLY UNDER a surface the tree does not list:
  its bottom 28 px show #F2F2F7, the colour beside container id:lab.form-keyboard.submit (55,1238 970x132) drawn after
  it, not its own #FFFFFF (a screenshot), its centre clear` — live k7 ×3, docs/truth/live-android-2026-10-18-visibility.md;
- a band over the centre the next tap presses is no plain stop — as a cover over the centre is none (the pinned-chrome
  rule, docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md) — and `fully: true` never stops on a
  band: the strokes go on as for a cover; a read after a stroke that finds target and neighbours where the eyes refused
  them is refused again with no confirming read and no second screenshot; stuck on strokes that lift it out from under
  that surface, it is not turned back (that only pushes it further under: measured live, the stroke back laid phone
  under the bar again); the failure names the surface and, when the window state reads the keyboard the node rides on,
  "if the soft keyboard is still up … dismiss it first", else a layout defect.

What the screenshot cannot tell is said with the tree's claim — `fully visible by the tree after N swipes; its bottom
edge lies flush with <node>, drawn after it outside its scroll view, whose surface may draw past that node over it —
the tree lists none there, and a screenshot could not tell (<why>)`: no plain surface beside the node, the two colours
within ΔE00 2.0, the screen beside the target that surface's colour too (or no screen beside it), a band to the far
edge, a screenshot that fails or does not decode, a scale the tree refuses.

Measured on k7's stop (tests/fixtures/android-lab-form-keyboard-k7-stop.{xml,png}): the bar's padding rows 1210–1237
are exactly `#F2F2F7` across the screen (ΔE00 0.00 to the colour beside `Continue`), the field's rows and the screen
beside the field `#FFFFFF`, ΔE00 3.64 apart — under the colour assert's own tolerance (8) and in one 4-bit bucket of
its sampler, so a colour ASSERT could not tell them; the pixel-by-pixel reading against the two references can, a
screenshot of a drawn surface being pixel-exact. The threshold pair (1.0 same, 2.0 apart) leaves no line that reads as
both.

ONE UNSETTLED CAPTURE, by design: the eyes take a single screenshot, not `verify/capture.ts`'s settled pair, and only
after the stop was settled by its tree reads (scroll-rounds.ts#SETTLE_CONFIRM_READS) — the cost the owner asked for
(one screenshot, never on every round). ARCHITECTURE.md says the exception where it says a frame is settled.

Cost and bound: one screenshot (adb `screencap`, a PNG decode) per claimed stop the trigger applies to — at most one
per swipe plus one in a `fully: true` call whose refused target moves between claims, none for an unmoved one; every
other stop takes none (tests/interact/scroll-eyes.test.ts counts the adapter's screenshots). Golden byte-identical (no
capture in the corpus meets the trigger at a claim).

Residuals, stated:
- the trigger is Android's dialect only (WDA reports frames unclipped: the same lab cell lists phone whole under the
  bar, covered at its centre — a cover the tree sees; idb's flat list has no "drawn after");
- a neighbour as wide as the screen along its edge (a Scaffold's top app bar or bottom bar flush with a row) is NOT
  asked: no screen beside it to read its surface from, so the eyes could only say "could not tell" — the tree's plain
  claim stands, as before the eyes, and a padding of such a bar is not seen;
- one unsettled capture: an IME or a bar still animating when it is taken could be misread (a band too shallow or too
  deep), though the stop's tree had settled;
- a surface the same colour as the target (within ΔE00 2.0), or the target on a background of the surface's colour, is
  `unjudged`, said;
- a target as wide as the screen has no screen beside it, so step 4 always answers `unjudged`: a full-width list row
  flush with a narrower pinned button costs one screenshot and says "fully visible by the tree … a screenshot could
  not tell (nothing of the screen beside it to tell its own margin from that surface)";
- the band is measured on the dumped node (k7: 28 px of its touch target, of which 18 px are the drawn field's);
- a surface with no flush node at all (a node-less bar over a target no later node touches) is not looked for — no
  trigger, no screenshot.

## Refined 2026-10-20 (round 14, LE2): the eyes look for a CLIP LINE where the tree tells no drawn frame

idb lists no scroll view, so its tree cannot say where a row is drawn (`ui-tree/geometry.ts#DrawnUntold`): the lab's
`scroll-bounded` P (`51,290 300x64`, cut at `upper`'s bottom, 330) and S (`51,552`, cut at `lower`'s, 560 — 8 pt of it
drawn) were "fully visible after 0 swipes" under `fully: true`
(docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md).

WHEN, widened by one case: a `fully: true` claim (`ui-tree/eyes.ts#eyesQuestion`'s `claim`, the round's `fully`) on a
node whose drawn frame is untold is looked at too, ONE screenshot, every one of its four edges asked for a clip line
(`EyesEdge` with `by: 'clip line'`, beside the flush neighbours' `by: <node>`). The plain stop asks nothing: its claim
stays the tree's (ADR 0010's residual 5 — a screenshot per stop is the cost the default tree source cannot carry).

WHAT is a clip line (`verify/eyes.ts#judgeClipLine`), over the target's pixel region, per edge:
1. the BAND: the target's lines from the edge inward while each is one colour with the outermost line's AND the screen
   beside it on that line's own rows (columns) — every strip at least 4 px wide, at least one — is that colour too:
   what lies beneath the clip shows across the target's columns and beside them alike;
2. the target's OWN colour past the band, at least ΔE00 2.0 from the band's;
3. THE LINE: the screen beside the target on the rows past the band is, every strip of it, a plain colour of its own
   told apart from the band's (ΔE00 over 2.0) — the screen changes at the line as the target does, to what a scroll
   view's background is (beside P's drawn rows `upper`'s grey `#EEEEEE`, beside its band the screen's white). Not
   merely "not the band's colour": a keyboard's keys (each rect holding the gap below its cap) and a row of padded
   chips have a band of the gap's colour with the screen beside it that colour, and past it keys and gaps mixed —
   about 100 of the lab's idb keys read cut that way until round 14's review; over every node idb lists in the 32 lab
   captures only P and S now do (tests/verify/eyes-clip-line.test.ts).
Any of them missing is `own` — never `unjudged`: a clip line is looked for, not suspected, so a screenshot that fails
or cannot tell leaves the tree's claim as it was, unremarked (`ui-tree/eyes.ts#unseen`). A band deeper than the pixel
slack is a `surface` finding `by: 'clip line'` and is said as the eyes' finding is, in points: `fully: true` does not
stop; the strokes go on (over the screen's middle — idb names no scroll view), and the failure says `its bottom 24 pt
read as the screen beside them (#FFFFFF), not its own #1E88E5: cut at the edge of a scroll view the tree does not list
(a screenshot)`, then that the strokes may have missed the scroll view that holds it and that `treeSource: wda` lists
it. Measured on `scroll-bounded.png` (iOS 27, 1206x2622): P's band 24 pt (330–354), S's 56 pt (560–616), W (whole in
`upper`) its own colour to every edge; golden: P's and S's `fully` rows green, every other idb `fully` reply unchanged.

Residuals: a target whose own band is transparent over a page whose colour changes exactly at a line across it, the
screen beside changing there too, reads cut (a label straddling a section's edge) — a refused `fully: true` stop, the
safe side. Not seen, the claim standing as the tree's (the stop says "fully visible" as before): a clip at an edge
where the screen beside the target is not plain (another control there), or not one plain colour — a scroll view
inset from the screen's edge, the page's margin beside it in the colour of what lies beneath its clip (a card-style box
with margins: every strip beside must be one colour of its own, or a keyboard's keys would read cut); a target that
spans the screen's width — no screen beside it at all, most list rows — at its top or bottom edge; and a scroll view
drawn in the colour of what lies beneath its clip (a transparent SwiftUI `ScrollView` on the page's background): no
line changes there, on the target's rows past it nor beside them. Each is ADR 0010's residual 5; `treeSource: wda` lists the scroll view and judges them.

## Refined 2026-10-20 (round 9, B4-L1): a node cut at an OVERLAY may run on under it

Compose's cut is also made by an overlay that only TOUCHES the node in the dump. On the lab's `pinned-bar` (Android),
row `P` is dumped `127,1846 825x110`, ending exactly where the pinned `Continue` (`66,1956 948x154`) begins, though its
frame runs 66 px on under the button. Nothing overlaps, so the draw order found no cover: `fully: true` said "fully
visible after 0 swipes" and the colour assert passed on the cut rect.

**The concept** (`ui-tree/later-edges.ts#OverlaidEdge`, decided from the tree alone): on a tree whose source cuts at a node
drawn after it (Android's), for a node in NO scroll view, a top or bottom edge with a node laid flush against it along
its whole width, drawn after it outside its subtree (`ui-tree/later-edges.ts`, the cut's and the flush neighbour's evidence), that
ALSO reaches past the node at both ends of that edge. An overlay has margins of its own (Continue `66..1014` over `P`
`127..952`); a sibling laid beside the
node in a column shares an alignment line with it at one end at least (the next row of a list, a field under its
title, the 48-dp touch target of bands' `N`, exactly as wide as `Q` above it). Top and bottom only: every measured
Compose cut is vertical, and sideways a row's padded overflow icon reaches past its neighbour's ends (Contacts' "Save"
`719,99 218x110` beside its `937,88 132x132` touch target).

**Its three uses**, all inside the standing, the interface unchanged:
1. The `fully` stop names the overlay as its cover when the exposure found none (`covered`, remedy `scroll`; the fact
   `StandingFacts.overlaid` — since 2026-10-20, architecture round 10, a cover of its own, its order `overlaid`:
   `cover.ts#CoverOrder`). `scroll_until … fully: true` never claims `P`: it fails saying "cut at its bottom edge by
   … drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the
   rest of it may lie under that container", with no share said to show (how far it runs on is not told).
2. The pixel assert, with no pixel cover, names it, its rect the reach, and fails closed ("… meets the element's bottom
   edge …, drawn after it — … so the rest of the element may lie under that container"); the remedy is decided as for
   any cover (`pinned` in no scroll view, else `scroll`).
3. `cutByLater`: a node with no control role that is not a text, cut by an overlay to a strip under the tap minimum, is
   the sliver it is (`Cut.by` the overlay, its edge the overlaid edge). text-under-bar's `P`, a role-less clickable
   dumped as the 22-px strip above `Continue`, is no stop for `scroll_until` and is refused by the tap.

The tap and the plain stop are otherwise unchanged: they judge the centre, which the cut leaves clear unless it is a
sliver (`P`'s probe at its dumped centre fired `P`). The words for the cut are one clause in the UI-tree layer
(`geometry.ts`'s then, `cover.ts#mayRunOnUnderText`, `#cutAtLaterText` since round 10), said by the sliver's sentence, `scroll_until`'s `fully` failure
and the pixel assert's covered miss.

**Never for a node in a scroll view — VA1 left open.** The same shape cuts `scroll-sticky-cut`'s `R` at a
merged sticky header (`0,303 1080x154`, pinned at its list's top): `R` and its content are dumped from 457. A first
version read a neighbour in the node's own scroll view as an overlay when pinned at that scroll view's far edge, and
turned VA1's two golden rows green. The device refused it (`docs/truth/live-records/android-vis-r9-b4l1-sticky.json`,
2026-10-20): `scroll_until R fully: true` stroked the list 66→877→439→1→205 and timed out with `R` scrolled under the
header, where before it said "fully visible" — no false claim, but no stop either. The tree cannot settle it: at rest
(offset 0) the first row lies WHOLE and flush under its sticky header, dumped exactly as the row it cuts, so every first
row under a full-bleed sticky header would be refused by `fully` and fail the pixel assert for good — a false failure
an agent cannot get past, on the transaction lists of every banking app. Only motion tells the two (a flush probe
toward the header, as `scroll_until`'s probe at a clipping container's edge), and the pixel assert has none. The review
of the second version (2026-10-20) showed the same holds for a bar OUTSIDE the list, which that version still read: an
edge-to-edge top bar over a list padded to clear it lies flush on the first inset card at rest, and a bottom bar on the
last one at the end of the content (and a list ending flush on a bar laid below it ends there too, where `scroll_until`'s
flush probe answered correctly before) — a whole row, `fully` failing for good with "a layout defect", the pixel assert
failing closed. So a node in a scroll view is never read as overlaid at all (the eyes and the flush probe keep it,
`Scene.flushNeighbours` being this concept's complement), and VA1 stays open for that probe.

**What it narrows:**
- 2026-10-17's second residual: a role-less clickable cut to a strip is refused when the node that cut it is an
  overlay — the evidence a layout wrapper laid beside its siblings does not have. Texts keep their tap (mp-native's
  Account Detail row titles cut 9 px at the floating tab bar stay `reachable`);

Measured: golden, over the whole corpus (Android, iOS, React Native), changes four replies and no other —
`pinned-bar.xml P fully` and `P colour`, `text-under-bar.xml P colour` and `P.id scroll_until`, each red to green
(1410 checks, 217 → 213 mismatches; with OCR 243 → 239). iOS is untouched: neither WDA (frames unclipped) nor idb
(flat) cuts at a later node. Over every Android tree in the fixtures (the banking app's screens, the lab's, React
Native's; tap, plain stop, `fully`, colour and ocr, on the gesture and the three-button screen) the verdicts change on
three nodes only: the two `P`s, and the sheet's drag handle below (a residual). mp-native's Account Detail rows cut at
the floating tab bar lie in their list, so they read as before.

**Residuals, stated:**
- an overlay exactly as wide as the node (equal margins, or full-bleed over full-bleed) is not read as one: the node
  reads whole, as before (in a scroll view with the neighbour outside it, the eyes still look at the node-less padding);
- a row cut at a sticky header in its own list reads whole (VA1, above);
- a node in no scroll view laid flush, with no gap, against a later node that reaches past it at both ends reads as
  running on under it, whether or not it does: `fully` fails and the colour and ocr asserts fail closed naming that
  node. The tree cannot tell an overlay from a section laid below in the same column — a button centred above a
  full-bleed footer, a title centred above a full-width card. Measured once in the fixtures: sheet-medium's drag-handle
  box (`496,1110 88x133`, above the sheet's content `0,1243 1080x977`), which no one asserts. Accepted: the error is the
  fail-closed one ADR 0001 chose over a false pass, the sentences say "may" and name the node, and a rect assert, an
  assert on a node clear of it, or a tap is the way past (the tap judges the centre). A narrower rule (the overlay not
  filling the rest of its parent, say) would fit no measured case and is left until one is measured;
- the overlay's rect may be only touch padding over the node: a 40-dp button padded to 48 dp still counts when it
  reaches past both ends (no density in the tree, so the depth cannot be told);
- side edges are never read: no sideways cut has been measured;
- `fully` on an overlaid node in no scroll view still sends its strokes before failing, as for any cover (a few
  seconds, the same answer). A `pinned` short cut for a stop whose node and cover both lie in no scroll view would be a
  separate speed change;
- the PLAIN stop on an overlaid node whose centre is clear stops, as the next tap's point should, and its reply keeps
  its words ("fully visible after 0 swipes" when no exposure cover lies over it): it does not say the node may run on
  under the overlay. `fully: true` is the way to ask for the whole node.

Bug note: docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md

## Residuals accepted

- A node that only READS cut (whole, its own content running to the edge, `geometry.ts#evidentCut`) is refused too;
  the refusal names a child or a coordinate tap as the way past it.
- **"fully visible" while a surface with no node lies over part of the target** (live case k7, round 6's Android
  device check; accepted 2026-10-18; CLOSED 2026-10-19 by the eyes, above — the account below is kept as measured). After one stroke the lab's phone field (`1129–1228`) lay with its centre clear of
  the bar riding on the IME, and averi stopped "fully visible after 1 swipe" — but the bar's top padding, a surface
  Compose dumps no node for, still covered 18 px of its bottom (of 99). The tree cannot see what has no node (ADR
  0018's residual 9 is the same class); the plain stop is right (its centre is clear, a tap there focuses phone), the
  word "fully" overstates by those 18 px. A future "eyes" item (docs/plans/2026-10-15-ground-truth-lab-app.md): verify
  a "fully" claim with pixels where a node-less sibling's padding may lie over the target.

## Bug note

docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

This note is not tracked yet. The measurements are recorded above.
