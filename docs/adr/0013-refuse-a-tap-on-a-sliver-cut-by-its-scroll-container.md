# 13. Refuse a tap on a sliver cut by its scroll container

Status: accepted, 2026-10-10 (owner). Refined 2026-10-17 (owner, lab note F2A1). Decided 2026-10-18 (owner): F2A1's
way past kept after the remedy, a fill into the strip refused by design, k7's "fully" a residual (below). Refined
2026-10-19 (orchestrator, round 7 A6, the owner's delegation): k7's residual closed by the eyes (below). Refined
2026-10-20 (round 14, LE2): the eyes look for a clip line under idb (below).
Amended 2026-11-03 (D62: a held reveal after a carried proof is doubted once — see the amendment below).
Amended 2026-11-05 (D68: a reveal this call's own strokes say would most likely overshoot is not sent — see the
amendment below).
Amended 2026-11-06 (T11: a held reveal on a proven cut is doubted once, however far the proving stroke carried the match, and
a second ends in a hedge, never `checked`; D62's carry line is gone — see the amendment below).
Amended 2026-11-11 (D88: a cut by a later node where neither lies in a scroll view takes no scroll; a bar not read as
riding but stacked on the keyboard names hiding it as a way that may move it — see the stacked-button paragraph, and
docs/adr/0015-flat-list-reading-order-break.md's D88 amendment).

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
that misleads. Since D88 (ADR 0015's D88 amendment), where neither the field nor that node lies in a scroll view there is
no scroll to name: with the keyboard up and that node ending within its own height above the line (room for the riding
button beneath it), the remedy says hiding it may move that node, then that no scroll moves it out
(`interact/target-text.ts#cutByPinnedRemedy`) — the same safe direction. A node farther above (a top bar) gets the
no-scroll words alone.

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

**Never for a node in a scroll view — VA1 left to motion** (closed 2026-10-20 by the flush probe, below). The same shape cuts `scroll-sticky-cut`'s `R` at a
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
`Scene.flushNeighbours` being this concept's complement), and VA1 stays open for that probe (round 14 sends it, below).

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
- a row cut at a sticky header in its own list reads whole (VA1, above; since round 14 `fully: true` probes it, below —
  the pixel assert still samples the cut rect);
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

## Refined 2026-10-20 (round 14, VA1): a row flush under a node pinned in its own scroll view is the flush probe's

Round 9 left VA1 to motion (above): on the lab's `scroll-sticky-cut` (Android), `R` and its content are dumped
`128,457 825x110`, cut 66 px at the merged sticky header `0,303 1080x154` pinned at its list's top `0,303 1080x1238`
and listed after it; at rest (offset 0) a first row lies whole and flush under the same header, `128,457 825x176`, the
same tree. Before this, `scroll_until R fully: true` said "fully visible after 0 swipes": the flush probe asked only
about the scroll container's own edge (457 is not 303).

**The concept** (`ui-tree/later-edges.ts#PinnedEdge`, the class `pinnedInScrollView`, split out of `sameScrollView`;
`Scene.pinnedEdges`, the twin of `Scene.flushNeighbours` inside the scroll view): on a tree that cuts at later nodes
(Android's), an edge of a node in a clipping scroll view with a node drawn after it laid flush against it (the same
evidence as every class of `later-edges.ts`) that lies IN the node's nearest scroll view, is pinned there — its outer
edge within a pixel of the scroll view's on that side — and does not overlap the node (its inner edge within a pixel of
the node's). The scroll view shows nothing of its content past that inner edge, so it is where the node may be cut, as
at the scroll view's own edge. At the content's START only, the top or left edge, where a sticky header pins: at the
far edges the same shape is the list's next row cut at the fold (listed after the row, as a footer would be), which
would turn every `fully` stop on the row above it into probes carrying it on (measured on the test's Settings list: 3
swipes where 1 did); at the start the row before is listed before it.

**Its one reader is the `fully` stop's flush probe** (`interact/flush-check.ts#flushWith`): the nearest scroll view's
flush edges along the scroll are its own and the match's pinned ones; one edge is probed toward (the probe planned,
held, budgeted and refused for room or axis exactly as before), two are `fills` (the row spanning from under the pinned
node to the scroll view's far edge: no probe, the reply naming both edges for what they lie on). The stop's `Flush`
carries the pinned node (`pinned`), and the reply names the edge for what it lies on: `its top edge lies on the edge of
container id:lab.scroll-sticky-cut.header (0,303 1080x154), pinned at its scroll container's (0,303 1080x1238) top and
drawn after it, and a probe swipe toward it moved nothing — nothing of it is cut there` (unchecked: `where Android cuts
a node's bounds at a node drawn over it`). Decided in review against the design's "keep the prefix `its top edge lies on
its scroll container's`": that prefix is false here (R's top is 457, the container's 303), and a truthful reply
outranks a harness regex, so the golden harness reply parser (`flushProbedSide`, scripts/truth/replies.ts) reads both
forms.
The tap, the plain stop and the sliver rules are unchanged (`cutByLater` reads any class but `none`, as before).

**Costs, stated:** one probe (a stroke of at most PROBE_MAX_TRAVEL_FRACTION, a settle and a read — ~2.5 s on the
lab AVD for a probe that moves nothing; one that moves the match pays its confirming read too, ~5.1 s a round, unless
it proved the cut: refined 2026-10-23, below) on every `fully: true` stop flush under a sticky header pinned in its
list: a first row at rest pays one probe that moves nothing; VA1's cut row pays two (the first moves the list 66 → 0
and R grows, flush again — the cut proved, so no confirming read since 2026-10-23 — the second, a reveal, moves
nothing). The tap, the plain stop and the pixel assert pay nothing. As between a scroll view's own two edges, a
row whose probe toward the header leaves it flush at the far edge (or the reverse) is probed again from there; every
probe spends one of `maxSwipes`, so at worst the stop says `budget`, unchecked, never a false "nothing of it is cut" —
or, once a probe proved the cut (refined 2026-10-23, below), the bound fails naming it (`FlushCut`).

**Residuals, stated:**
- **the pixel assert has no probe** (residual 3, below): on VA1's tree it samples what the tree lists of R (all
  drawn, its own colour) and passes, whatever lies under the opaque header. Refusing there would fail every first row at rest under a sticky
  header for good (round 9's refusal), and no screenshot sees under an opaque node. Remedy: `scroll_until … fully:
  true` first, which brings the row whole; the golden row `scroll-sticky-cut.xml R colour` stays KNOWN as this
  residual;
- a reversed list (`reverseLayout`) pins its sticky header at the bottom, read as a next row: a row cut there still
  reads whole; and lists the rows above a row after it, so a row under one cut at the list's top costs one needless
  probe; a right-to-left horizontal list likewise lists the card to a card's left after it, so a sideways `fully` stop
  on the card next to the leftmost one shown costs one needless probe;
- the nearest scroll view only: a card in a carousel nested in a list, flush under a sticky header pinned in that
  LIST, has the carousel as its scroll view, so its edge is `outsideScrollView`, never pinned. Compose cuts the
  carousel at the header too, so a card cut there lies on its carousel's cut edge and the container-edge rule asks
  (a probe, or `fills` for a card as tall as its carousel: tested). Only a tree listing the carousel uncut over a card
  it cuts would go unasked; no such tree has been measured;
- remembering a probe's answer for a later pixel assert, a doubt clause on a colour PASS, and failing the colour assert
  closed were rejected: the first is state across calls, the others a false failure or noise on every first row.

Measured: golden over the whole corpus with OCR changes one reply — `scroll-sticky-cut.xml R fully`, red to green,
"fully visible after 1 swipe" with the probe `540 551 → 540 728` from inside the list below the header (the replayed
probe moves nothing) — 1410 checks, 224 → 223 mismatches. Over every uiautomator dump in the fixtures exactly two nodes
have a pinned edge: that `R` and its content `Target R` (and, since the lab cell below, `scroll-sticky-rest`'s); over
Compose's own snapshots of the banking app (tests/fixtures/android-ui-snapshot-compose.json) one: Account Detail's
`date_header_22`, flush under `date_header_21` pinned at the transactions list's top — a sticky date header, so a
`fully: true` stop on it pays the probe too. iOS is untouched (no tree that cuts at later nodes). Live on averi_lab,
twice (docs/truth/live-records/android-vis-r14-va1.json, -2.json): `scroll_until R fully: true` probes toward the header
from inside the list, the list 66 → 0 then 0 → 0, "fully visible after 2 swipes", the tap fires R; on the lab's new
`scroll-sticky-rest` (R whole at rest under the same header — the case that refused round 9's rule) one probe that moves
nothing, "fully visible after 1 swipe", Tapped.

Bug note: docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md

## Refined 2026-10-23 (round 1023, LV2): a probe that revealed more of a still-flush match proved its cut

The flush probe (`interact/flush-check.ts`, its size `interact/course.ts#probeOf`) is a quarter of the
stroke over the flush container — on the lab's `scroll-bounded-flush` `lower` list (495 px) 74 px of finger travel,
under the 177-px cap — and each probe that moves the match pays a settle, a read and a confirming read. Measured over
every committed record holding `scroll-bounded-flush` S.fully (S 176 px tall, 22 showing at rest, cut by 154):

| records | strokes on `lower` (app log) | a probe round | reply |
|---|---|---|---|
| cal12-9c7885e-1/2/3 | 0→60→121→181 · 0→60→120→178 · 0→57→117→178 | 5.05 s | fully visible after 3 swipes |
| android-vis, -e98b87e-run1, -r14-lv1, -r7final, -b71cbbb | 0→59/61→118/122→179/181 | 5.18–5.20 s | after 3 swipes; "still moving at the last read" |
| live-android-2026-10-16 appendix (debc9b2, no record) | 0→21→79 | – | after 2 swipes; "…may be cut there" (75 px cut) |
| #12's run at 9c7885e (no record) | 0→38→83 | – | the same (71 px cut) |

Three probes at 57–61 px reveal S by 17–29 px with about one round to spare in the 15-s budget; a first probe that
moves 21 or 38 px for the same stroke (a loaded host; the cause not measured) leaves it cut, and the stop said
"fully visible … it may be cut there".

**Decision.** A probe after whose read the match MOVED (not held) and lies flush on the SAME edge of its clipping
container (or pinned node) with more than a pixel more of it showing along the axis, its uncut edge moved toward
revealing the flush one by that growth within a pixel (the content carried it — not a container that grew, nor another
match in its place), has proved the cut — content lay past that edge, and part of the match with it (`revealedBy`). Such a read:

1. claims no stop and confirms none (the confirming read exists to keep a stop from being claimed mid-fling; nothing
   is claimed) — one read fewer per such round;
2. sends a REVEAL (`course.ts#Revealing`): the whole stroke over the box the probe plan chooses, its finger travel half
   the room the match leaves on the far side (its uncut edge to the container's opposite edge;
   `REVEAL_ROOM_FRACTION`), so even a stroke that carries 1.25× its travel (the full stroke on `lower` moved it 359–374
   px for 297) cannot carry the uncut edge out; at a content-START edge (top, left) still capped by
   PROBE_MAX_TRAVEL_FRACTION — the pull-to-refresh lies that way after a probe too; a bottom or right edge has no such
   gesture. In every other respect it is a probe: held after it → `checked`; more showing, still flush → another
   reveal, the room taken anew; out of the flush → the ordinary stop; See the D62 amendment below. See the D68
   amendment below.
3. at the bound (no swipe or time for the reveal) is NOT "fully visible": the bound fails, its shortfall the cut the
   probe proved (`FlushCut`) — `element reached the viewport but its bottom edge still lies on its scroll container's
   (…), where Android cuts a node's bounds to the container, and a probe swipe toward it showed N px more of it
   — part of it lay past that edge, so it may still be cut there (last rect …); raise maxSwipes or timeoutMs`. Not
   "it is cut": the probe proved part of it lay past the edge BEFORE it, not after — the last row of a list cut by
   40 px is whole after a 40-px probe that brought the list to its end, and still flush (the next reveal, had there
   been budget, would have moved nothing and said `checked`). `flush.why: 'budget'` stays for a flush stop never
   probed; See the D62 amendment below. See the D68 amendment below.
4. is remembered: the proof is KEPT (`flush-check.ts#ProvenCut`, in the check the round holds, `scroll-rounds.ts#State.flush`) while every later flush check finds the match
   flush on that edge of that container, and let go when one finds it anywhere else. So a read that cannot send the
   reveal — no swipe or time (`budget`), or a tree changed between the probe and its read: no room for a stroke (a
   keyboard or an overlay come up) or only a scroll view across the axis — or that finds a reveal that moved nothing
   drawn too short to tell from a tap (`tap`) is short of the cut (`FlushCut`, its `why`)
   and claims no stop; the strokes go on the caller's way as for any shortfall, and a later read still flush there
   reveals at once, or is short of the cut again. The bound fails naming it, a stuck stop too (`… so no swipe can
   reveal the rest — and swiping down no longer moves it …; check with a screenshot`): "fully visible" is never said
   of a match on a proven cut. Room and axis never measured (golden 0 changed; the lab's S never takes that path); the
   unit tests hand the probe's read a list dumped as a HorizontalScrollView.

Cost: none on a stop the first probe settles (a first row at rest, P, every golden row: a replayed tree never moves,
so every probe holds); on a proven cut one read fewer per round, and on S one stroke fewer. No device call added.
Deterministic in the trees: the reveal's size is a function of the read's rects only. Residuals: a row nearly as long
as its container converges in halving steps; the stroke is never drawn under 2 × TOUCH_SLOP nor 3 % of the box's side
(`swipe.ts#shortenStroke`), so under a room of about 96 px the reveal travels more than half of it, and at a room of a few
tens of px it may carry the uncut edge out — the row then reads flush at both edges (`fills`), said as "may be cut", or the
bound ends it as a failure; never a claim.

Bug note: docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md

## Amendment: D62 — a reveal that moved nothing right after a stroke that carried the match its whole length is doubted once (2026-11-03)

**Cause.** Batch-9 run 0 (the lab's `carousel-recycler-free`, a 440-px pre-drag, then `left fully: true`): C lay at
`573,380 441x234`, flush with its carousel's right edge (`66,380 948x234`). The probe moved it 135 px and C grew by
135 (`438,380 576x234`): the cut was proved. The reveal after it — half the 372-px room — was never taken by the app
(its own log counts the pre-drag and the probe only), so the read after it found C where the reveal left from, held,
and LV2's point 2 said `checked`: "fully visible after 2 swipes … a probe swipe toward it moved nothing". The 2 swipes
were the probe and the reveal. The stroke before the wrong pass DID move the target, so "a pass only when the stroke
before it moved the target" would not have caught it.

**Decision.** A stroke that proves the cut (`revealedBy`) also records whether it CARRIED the match its whole drawn
length: `grown > strokeLength(drawn) − CARRY_LOSS`, `CARRY_LOSS` = 2 × TOUCH_SLOP (`ProvenCut.carry`, gone since the T11 amendment:
`short`, `carried`, `doubted`; `drawn` the stroke the round is handed back after every stroke, the probe's own on a
proving read; none → `short`). Measured carry losses lie within one TOUCH_SLOP (batch-10's RecyclerView strokes 48→24,
54→33, 87→67; batch-9's probe ~142→135; the lab's 74-px probe on S 74→57–61), so the threshold leaves a 24-px margin;
a stroke that stops more than 48 px short of its length means the content ended under it (Settings' 177→100, VA1's R
177→66, formRead's 177→40). Not LV2 point 3's row cut by 40 px under the lab's 74-px probe: 40 > 74 − 48 = 26, so
that probe carried it, and the reveal that then holds is doubted (Cost, below). One slop instead of two would spare
it, and would miss batch-9 had its probe been the 177-px cap (135 < 153).

1. A reveal that moved nothing (held, drawn as a stroke) after a carried stroke (any stroke, since T11) is DOUBTED once: no `checked`. The cut
   stays proven, its doubt spent (`carry` `doubted`), and the same reveal is sent again (it counts as a swipe), at
   once — the read neither waits nor confirms. With none to send, the read is short of the cut (`FlushCut`: `budget`,
   `room` or `axis`), in LV2 point 3's existing words: `… a probe swipe toward it showed N px more of it — part of it
   lay past that edge, so it may still be cut there …`. No new wording.
2. A second held reveal in a row is accepted as `checked` (the hedge, since T11) (today's reply, its swipe count one higher). A retry that
   moves and grows the match is a fresh proof, its `carry` judged anew by the same rule.
3. The doubt is the proof's and is kept with it (`stillProven`): a read between that moved the match without proving
   the cut anew (a stroke that was no reveal, the match still flush on that edge) leaves it owed, so the next held
   reveal is doubted all the same — once per proof, at most one extra stroke.
4. Unchanged (gone since T11): a held reveal after a stroke that ran short (the content ended more than CARRY_LOSS before its end —
   Settings' "Network", VA1's R, formRead), every first probe that held, a reveal too short to tell from a tap
   (`tap`). Every reveal that held is NOT sent again: that rule turned Settings' "Network", VA1's R and formRead from
   "after 2 swipes" to "after 3", about 2.5–2.9 s more on the 2026-10-09 case, on the legitimate path.
5. iOS, idb and WDA unchanged: no clipping container, never a probe.

**Cost (gone since T11).** None on a legitimate pass whose content ended more than CARRY_LOSS short of the stroke (a first probe that
held; a reveal after a stroke the content ended under). A pass of LV2's or S's kind — the content ending within
CARRY_LOSS of the stroke's full length, the main example LV2 point 3's row cut by 40 px, which a 74-px probe brings
whole, or the lab's S, whose 74-px probe carries it 57–61 px — pays one retry (a stroke and a read, ~2.5–2.9 s on
Android, the swipe count one higher) before `checked` whenever a held reveal follows the proof; with no swipe or time
left for that retry, the bound fails hedged ("… may still be cut there …; raise maxSwipes or timeoutMs") where it
said `checked` before: a failure that names the cut, never a false pass. In the doubted case proper (batch-9) the same
one stroke and one read, before it moves (the call goes on) or holds again (`checked`). No device call of another
kind. Golden 0 changed: a replayed tree never moves, so no proof forms.

**Residuals, stated.** (a) A FIRST probe the app did not take still reads `checked`: no stroke before it to doubt by,
and doubting it would cost a second probe on every checked stop (4 golden rows from "after 1 swipe" to "after 2").
(b, gone since T11) A reveal dropped after a stroke that ran short for another reason (a loaded host: a 74-px probe moved 21 or 38
px, LV2's table) still passes. (c, the hedge since T11) Two strokes dropped in a row still pass.

**Live check (batch-12, 2026-11-04).** Main f7ea6e07 against pre-D62 0eab7789 on the averi_lab AVD (API 33),
carousel-recycler-free after the 440-px pre-drag, `left fully: true`, a wrapper dropping the call's 2nd stroke (the
reveal after the probe; the app's own stroke count judged every run); PASS. Pre-D62 reproduced batch-9 3/3: "fully
visible after 2 swipes … a probe swipe toward it moved nothing", while the app's frame of C lay 367–376 px past the
clip's right edge. Main 3/3: the 142-px probe carried C, the dropped reveal (183–184 px) was doubted and sent again as
swipe 3 at the same length, and the call went on to `maxSwipes` after 6 swipes in LV2 point 3's words ("a probe swipe
toward it showed 27 px more of it … may still be cut there …"), C 42–44 px short; never "fully visible". The control
(no drop) ended the same way 3/3, C 17–18 px short — the carousel's convergence below the stroke floor (backlog D68),
not D62. The legitimate pins held, 2 runs a side: sticky R "fully visible after 2 swipes" on both (its 177-px probe
moved R 66 px, short, and the held reveal after it was not doubted: point 4 seen live) and bounded S after 2 swipes on
both (its 74-px probe carried S 59–62 px, but the reveal after it moved S, so nothing was doubted). The retry cost no
time beyond the budget in the doubted case (main's drop runs and the control both 6 swipes, about 16.1 s). Not
exercised live: the Cost case proper (a held reveal after S's carried probe, one retry), and residuals (a)–(c). No
earlier sentence of this amendment is contradicted.

## Amendment: T11 — a held reveal on a proven cut is doubted once, and two end in a hedge (2026-11-06)

**Replaces, in the D62 amendment above:** point 1's "after a carried stroke" (every proof's first held reveal now); point 2's
"accepted as `checked`" and "its `carry` judged anew" (no carry; two held reveals are the hedge below); point 4 whole;
the Cost paragraph (below); residuals (b) and (c) (below). D62's cause, point 3 and point 5 stand. The D62 live check is
history, of the rule then.

**Headline, the final A/B, 2026-11-06 16:23–18:50 (`docs/truth/live-records/t11-carousel-visible/final-ab`; base b3ce0150's `src`, the fix 7a18842e, one harness, ABBA).** `lv-d62-short`, the recorded shape drawn on purpose (probe sent 90 of its 142 px, handed back as drawn, first reveal dropped; carries 0–77 px, 94 or less 40 of 40): **base 20 of 20 false "fully visible" (C 436–526 px past the clip on those 20, 408–526 on all 33 base first-call false claims of the run), the fix 1 of 20 (Wilson 95 %: 0.9–23.6 %).** That one is outside this rule's reach, not outside what matters: its first stroke carried 0 (`406 → 406`), a first probe with no proof, read `checked`, and to an agent the reply is the same lie, "nothing of it is cut there" with C 542 px cut: residual (a), backlog T12, the next correctness item. The other 19: 17 maxSwipes hedged, 2 at the 15-s bound. Group state: fast 0/24 short before, short 18/24 after, marked DISAGREE: probes carried 71–77 for the first three pairs, then 27–66 from about 16:26.

The AVD before it: a guest reboot on a new emulator process, not `-no-snapshot-load` (`boot-history.txt`), start count 1 throughout, no restart. Numbers from before the final A/B stay in the evidence folder, and those after the load experiment (07:37–11:39) are affected by it: its `system_server` restarts, count 11.

Cell by cell, each group's raw state before → after (of 24 at 94 px or less; base / fix):

| group | state | base | fix |
|---|---|---|---|
| `lv-d62-short` ×20 | 0 → 18 DISAGREE | 20 false | 1 false (T12), 17 hedged, 2 at the bound |
| `lv-d62-drop` ×6 | 18 → 13 | 3 false | 0 false, 6 hedged |
| `lv-d62-control` ×6 | 13 → 10 | 0 false, 5 hedged, 1 at the bound | 0 false, same |
| R, S, P ×4 | 10 → 11 | 10 of 10 ok; R `checked` after 2 | 10 of 10 ok; R hedged after 3 |
| `lv-d62-drop-two` ×4 base, ×8 fix | 11 → 8 | first call false 4 of 4 | hedge with C cut 8 of 8, second call moved C 8 of 8 |
| Settings ×4 | 8 → 9 | plain; premise met 0 of 4 | plain; premise met 1 of 4 |
| sticky R, `maxSwipes: 2` ×3 | 9 → 13 | passes, repeat `checked` | fails hedged at the bound 3 of 3, repeat `checked` 3 of 3 |
| whole carousel group ×2 | 13 → 12 | 3 mismatches each, 11 of 20 ok | 0 mismatches, 12 of 20 ok, 8 LOUD |
| whole visibility ×(2 base, 1 fix) | 12 → 12 | 147 ok, 6 LOUD each | 147 ok, 6 LOUD |

The whole-visibility diff, 153 cases, 147 the same on all three. Caused by the fix, on the held path: `scroll-sticky-cut.R.fully`. Differs base-vs-fix, the base runs agreeing, off the held path: `scroll:carousel-in-list.C` (at most 93 % vs 92 %), `blank:tabbar-floating.F` ("fully visible" and tapped vs "PARTLY UNDER … 86 %"). Not the fix: neither call has `fully`, so no flush check (`src/interact/scroll-rounds.ts`, `judgesStop && fully`): the plain stop lands where the carry leaves it, its content position constant (C's x + carousel offset 1014, F's y + list offset 6050, on all three runs), and the reply describes that place. Differs base-vs-base, not attributable: `scroll:scroll-bounded.O`, `scroll:scroll-bounded.F`, `scroll:tabbar-floating.F`.

**Why the carry line went.** D62 read a proving stroke that fell over 48 px short of its length as "the content ended under
it". On 2026-11-06, emulator-5554, before the load experiment, raw `input swipe`s of 142 px over 300 ms carried a card
47–132 px, with the content hundreds of px from its end (94 px or less: 18 of 24 and 16 of 24 before it, 14 of 24 after).
lv-d62-drop (its first reveal dropped) then replied "fully visible … nothing of it is cut there" on c899839d 10 of 16 and
b3ce0150 9 of 16 alternating, 4 of 6 in whole-group runs, all before; 12 of 16 *after the load experiment*. C 429–532 px
past the clip; every claim at a carry of 94 px or less, none above. The reply was the side that was wrong: the last dump
equalled the one before it byte for byte and agreed with the app 800 ms later (`tests/fixtures/t11-lv-d62-drop-*.xml`). No
threshold separates a legitimate short carry (177→66, 177→100) from the device's own loss (142→36).

**Decision.** A held reveal, drawn as a stroke, on a proven cut is sent again once, whatever the proving stroke carried
(`ProvenCut.doubted`; it counts as a swipe). A second one ends the call with `Flush` `{ checked: false, why: 'held', revealed }`,
worded (superseded by the T17 amendment below: the lead is now `visible after 3 swipes, NOT CONFIRMED WHOLE: `, the clause
unchanged): `fully visible after 3 swipes; but its right edge lies on its scroll container's (…), where Android cuts a node's
bounds to the container, and a swipe toward it showed 91 px more of it, then 2 swipes after it moved nothing — the content
ended there or the app did not take them — it may be cut there, a rect assert or screenshot may measure part of it;
calling again tells`. On a proven cut averi never says "nothing of it is cut". Bare `checked` stays for a first probe with no
proof. No swipe left for the retry: the bound names the cut (`FlushCut`). No more retries; not a failure.

**Why this hedge, when `FlushCut` is "never \"fully visible\" with a hedge".** `FlushCut` is a cut with a reveal still owed
that could not be sent: another call or more budget would act on it, so it fails and says so. `held` is a cut whose reveals
were sent and did nothing: no further stroke in the call tells "the content ended" from "the app did not take them", and on a
legitimate pass the element is whole and usable, so a failure would be false in the common case. The clause carries the
unchecked stop's existing `it may be cut there`, so `carouselReply` (scripts/truth/replies.ts) reads `other`, no claim.

**Cost.** Every legitimate pass of this kind (content that did end under the proving stroke, the lab's sticky R, Settings'
"Network", VA1's R, formRead) pays one stroke and one read, about 2.5 s on this AVD, and carries the hedge instead of
`checked`; at the bound it fails hedged. A repeat call resolves it: its first probe holds, `checked`, 1 swipe (sticky R, 4 of
4 live, `final-wording-check/again-*.json`, *after the load experiment*). Golden Changed 0 of 1611 is vacuous for this path: a
replayed tree never moves, so no proof forms.

**What the final A/B cannot show.** No real app reaches the held path: Settings' row comes whole and off the edge on the first probe, and its premise held 1 of 8 runs there. The 20 pairs say the rule held on one lab geometry; `lv-d62-drop` and control carry n=6 a side.

**Exposure, plainly.** No kept record shows a false claim with no stroke injected: `lv-d62-control` 0 of 41 and 0 of 6 + 2 a side in the short state, 0 of 16 fast, ctl-12 0 of 8. A11's two are reported only. So the fix's measured benefit is on injected drops; natural held reveals on a proven cut have an unmeasured rate, though absorbed strokes are measured (below). Its cost is measured on every content-end pass: about +2.6 s, a hedge in place of `checked`, and with no budget left a failure where it passed (sticky R, `maxSwipes: 2`, 3 of 3, a repeat call resolves it). **Corrected by the final A/B:** this amendment said the benefit was against a state "that lasted at least 5 hours" and that a healthy device was the case to reckon with; the short state came up within about 3 minutes of work after a fresh reboot and held for all 2 h 25 of the run, so on 2026-11-06 short was the common state of this AVD under this work (one day, one reboot; earlier records, T7a's, carried 135–136). **The fix stays, by the coordinator's decision: averi doesn't claim what it can't know.**

**Residuals, stated.** (a) stands: a first probe the app did not take reads `checked`, one stroke is enough, and it was seen: `final-ab/short-fix-12.json`, a shortened stroke, C 542 px cut (backlog T12). (b') Two held reveals on a real cut are now the hedge; its "2 swipes" is a true lower bound, as a still swipe behind a read that judges no stop is not counted (reachable by reading, `heldBack`, `refusedAgain`, `!stops(best)`; not seen live). Strokes logged with no motion in the final A/B: 7 of 442, all sent under 100 px (under 60 px 5 of 40, 60–99 px 2 of 133, 100 px and over 0 of 269); the raw 142-px read at 18:47 had one at 0 too, and the earlier series a 233-px one. Whether two come in a row without injection is unmeasured.

**Not known.** Why natural probes carry less. The final A/B narrows it: from a fresh reboot raw strokes read 135–146, frames 17 ms in the lab app and in Settings; within about 3 minutes of runs probes fell, and by 16:36 raw was 18 of 24 short, staying 8–18 of 24 for the rest of the run; frames 85–97 ms at the end in the lab app and Settings, with the host's load 4.4–5.6 in both states and the AVD's own about 1 rising to 2–3.5. So host load average does not separate the states, and a reboot does not cure. Earlier, natural probes ran short from at least 06:59 until at least 12:22, with T7a's figures again from 13:11 until some time after 14:52. Read before
any boot, 14:05 (`frames-recovery.txt`, raw-4): raw strokes 135–146 of 142, 0 of 24 at 94 or less; frames 18 ms in the lab app and
17 ms in Settings against 73 and 81, swap 12 ms against 42, motion events 16 ms apart against about 100; start count 11, the AVD's own
load, the lead, 0.3–0.8 against 1.3–2.0 at raw-1 on the same workload; the host's about 7, above the 4–5 of the short runs. So the slowness was system-wide in
the AVD, and it ended with no boot. Between: `adb install -r` of the same APK at 12:45 to undo the dexopt change, the one device change on record, and not shown to be the cause (the same APK went in at 23:03 the night before, with T7a's figures before it and the short ones
after; a lab-app install explains Settings poorly). **It came back, 2026-11-06:** healthy at 14:52 (AVD load 0.6), load 2.64 at 15:16 after one whole visibility run, raw strokes 0–130 of 142 with 18 of 24 short at 15:42,
frames 70+ ms again, and one raw stroke at 0 with no averi in the path; it held to at least 16:15. On a two-sample `top` at 15:44: 397 % idle; no process in D state over six reads, one to three in R (adbd, `ps`, a kworker). So
the load is not a guest process doing work that `top` shows, and the state is not a one-off. Trigger unknown: a visibility run preceded it this time, and the 12:48 one was followed by the fast state. Evidence:
`docs/truth/live-records/t11-carousel-visible`, `frames.txt`; rates read back by `tests/truth/t11-records.test.ts`.

Since T16 a carousel run labels the state itself: the raw-strokes read and this amendment's 94-px line, short at one
stroke in four, run before and after the group's cases and print as the summary's `Device:` line (ADR 0044's T16
amendment, docs/adr/0044-a-case-declares-its-reads.md).

## Amendment: D68 — a reveal this call's own strokes say would most likely overshoot is not sent (2026-11-05)

**Context.** Points 2 and 3 above send a reveal on a proven cut, or fail at the bound naming it. On the lab's
RecyclerView carousel (C exactly as wide as the carousel, listed cut flush to it) the reveals of half the room met
short drags that carry the card less than their length: batch-10's 10 runs all ended `maxSwipes`, C 15–28 px short,
"… may still be cut there …; raise maxSwipes or timeoutMs" — advice more swipes do not honour.

**Decision.** Before a reveal is sent, and at the bound before the `FlushCut`, the flush check asks
`interact/aim-floor.ts#aimFloor`: when the room left on the match's uncut side is under what a stroke of this call no
longer than that reveal carried it over the same cut (within a pixel), it sends nothing — the verdict `aim`
(`flush-check.ts#FlushAim`), the round's `unaimable` stop, a plain failure that says another swipe would most likely
push the match past rather than show it whole, never "fully visible" and never "raise maxSwipes". Everything else in
points 2–4 and in the D62 amendment stands: the proof, how it is kept, the doubt, the `FlushCut` when no reveal can be
sent. The rule, its evidence, the reply and its residuals: ADR 0021's D68 amendment
(docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md).

## Amendment: T12 — a first probe that held is sent again, and two holds are `checked` (2026-11-09)

**Replaces, in the T11 amendment above:** "Bare `checked` stays for a first probe with no proof" (two first probes now),
and residual (a) (below). In the D62 amendment, residual (a) likewise. Everything else in both stands: the proof, its doubt,
the `held` hedge, the `FlushCut` at the bound.

**Cause.** T11's final A/B, `final-ab/short-fix-12.json`: on `lv-d62-short`'s fix arm a 90-px first probe carried C 0 px
(`406 → 406`), and the read after it found C where the probe left from, held, with no proof: `checked`, "a probe swipe
toward it moved nothing — nothing of it is cut there", with C 542 px past the clip. T11 doubts a held reveal on a proven
cut; a first probe has no proof to doubt by. To an agent the reply is the same lie.

**Decision (the orchestrator's: option 1 of backlog T12).** A first probe that held, drawn as a stroke, with no proof, is
sent again once from where it held (`flush-check.ts#Memory.heldFirst`, its rect and edge; `Came` `doubted`): the same
first probe, not a reveal (`verdictOf` with no proof plans a first probe), at once — the read neither waits nor confirms.
That one holding too is `checked`; the reply counts the two (`CHECKED_AFTER_HOLDS`): `… and 2 probe swipes toward it moved
nothing — nothing of it is cut there`. Moving the match, the paths before T12 take over: a fresh proof (then T11), or a new
candidate whose own first held probe is doubted in turn. No swipe or time left for the second: unchecked `budget`, never
`checked`. A probe drawn too short to tell from a tap: `tap`, as before. A proof and two held reveals stay T11's hedge.
No type change outside `Memory`. iOS, idb and WDA unchanged: only the Android adapter marks a clipping container
(`clipsDescendants`), so they never probe.

**Rejected.** (2) Keep the fact, drop the inference ("a probe swipe toward it moved nothing" without "nothing of it is cut
there"): no strokes, but every checked reply weakens to a fact the agent must interpret, and the one claim `fully: true`
exists for is gone. (3) Doubt only probes under 100 px: favoured by T11's absorption figures (strokes sent under 100 px
logged no motion 7 of 173), but T11's own lesson is that length lines do not hold on this AVD (a 142-px raw stroke read 0,
a 233-px retry `482 → 482`), so a line would leave the long absorbed probe a lie. No signal was found that tells "content ended"
from "stroke not taken" without another stroke: after a stroke the app did not take the dump equalled the one before it
byte for byte (T11, `tests/fixtures/t11-lv-d62-drop-*.xml`), as it does after a stroke at the content's end, and the
stroke the driver hands back is the one drawn either way.

**Cost.** One stroke and one read on every held first probe, the legitimate pass included: a first row at rest (sticky
R), a row whose content ends at the edge. Live, all fast (below): the visibility group's sticky-rest R took 2 swipes where it
took 1, its run +3.25 s (89.75 s base, 93.0 s fix, the mean of 4, whole-second stamps; R the only case that changed; in the whole group also scroll-sticky R and scroll-sticky-view R, 2 → 3 swipes);
bounded S and P unchanged (their first probes move them: no held first probe); Settings' "Network & internet" unchanged
(its first probe moves the row off the edge, 8 of 8, 7.1–7.3 s a first call on both arms). With `maxSwipes: 1` such a stop is the `budget` hedge where it was
`checked` (sticky-rest R, 2 of 2); with a swipe left for the second probe it is `checked`, after 2 (above). Golden: exactly 4 rows from "after 1 swipe" to "after 2
swipes", the reply's clause now counting 2 (scroll-bounded-flush P and S, scroll-collapsing D, scroll-sticky-cut R: a
replayed tree never moves, so every probe holds), Changed 4 of 1611, nothing else; mismatches 120 both sides.

**Live check (2026-11-09, emulator-5554, `docs/truth/live-records/t12-first-probe`).** Base 5f126fdc's `src` against the fix
(78132aba, harness 28e1a0ce), one harness (the fix's checkout), ABBA, 11:06–12:45 (99 min, and 2 min of smoke runs kept in
`smoke/`, not counted); the AVD up about 6 h, `start_count` 1 throughout, no restart. Every group labelled by a raw-strokes
read (6 rounds, 24 strokes of 142 px) before and after it: 0 of 24 at 94 px or less every time, the fast state, never the
short state T11 met. So the rates below are mechanism, the drop injected by the harness, not frequency.

| group | state before → after | base | fix |
|---|---|---|---|
| `lv-t12-drop-first` ×8 (first probe dropped) | 0 → 0 of 24 | 8 of 8 false "fully visible after 1 swipe … nothing of it is cut there", C 505–512 px cut | 0 of 8 false; the dropped probe sent again 8 of 8 (the `no-retry` premise), then maxSwipes hedged 8 of 8, C 42–46 px short (D68's spread, as `lv-d62-control`) |
| `lv-t12-drop-two-first` ×3, fix only (`drop: [1, 2]`) | 0 → 0 | — | 3 of 3 false "fully visible after 2 swipes … 2 probe swipes toward it moved nothing", C 509–513 px cut: the residual |
| visibility cells scroll-sticky-rest, scroll-bounded-flush ×4 | 0 → 0 | 9 of 9 ok each; sticky-rest R `checked` after 1 | 9 of 9 ok each; R `checked` after 2; P, S the same replies; run 93.0 s against 89.75 |
| Settings "Network & internet" ×4 | 0 → 0 | premise met 4 of 4; after 1, then after 0 | the same, 4 of 4 |
| sticky-rest R, `maxSwipes: 1` ×2 | 0 → 0 | `checked` after 1, 2 of 2 | `budget` hedge after 1, 2 of 2 |
| whole visibility, base, fix, base | 0 → 0 | 148 ok, 5 LOUD; then 147 ok, 6 LOUD | 148 ok, 5 LOUD; 0 mismatches on all three |

The whole-visibility diff (`vis-diff.txt`), 153 cases, 147 the same on all three. Caused by the fix, on T12's path, each
one probe more, `checked` with `2 probe swipes`: `rest:scroll-sticky-rest.R.fully` (1 → 2 swipes),
`scroll:scroll-sticky.R.fully` and `scroll:scroll-sticky-view.R.fully` (2 → 3). Base-vs-fix with the base runs agreeing,
off the path: none. Base-vs-base, not attributable: `scroll:carousel-in-list.C`, `scroll:tabbar-floating.F`,
`blank:tabbar-floating.F` (T11's three again; base-2's sixth LOUD is `scroll:tabbar-floating.F`). Read back by
`tests/truth/t12-records.test.ts`.

**Residual, stated.** Two first probes in a row the app did not take still read `checked`, "nothing of it is cut there",
with the element cut: `lv-t12-drop-two-first` (strokes 1 and 2 dropped) did so 3 of 3, C 509–513 px past the clip — the record of the residual,
not a pass. Whether two come in a row without injection is unmeasured; T11's final A/B logged 7 of 442 strokes with no
motion, all under 100 px. Measured benefit is on injected drops only, as T11's was.

## Amendment: T17 — a hedged `fully: true` stop opens with what is not confirmed (2026-11-09)

**Replaces:** the T11 amendment's wording quote (its lead, not its clause), and in every unchecked flush stop the opening
`fully visible after N swipes; but …`. The `unlocated` keyboard's clause (2026-10-08) likewise moves to the lead. The rules
that decide the stops stand: no hedge becomes a failure, none is added, none is removed.

**Context.** Every flush stop no probe checked (`Flush` with `checked: false`: `budget`, `room`, `axis`, `tap`, `held`,
`fills`, `fills` with `pinned`) succeeded worded `fully visible after N swipes; but … it may be cut there …`; the stop with a
soft keyboard nothing could place, `fully visible after N swipes; … — it was not judged and may cover the element`. The
opening claimed what the rest took back. An agent that reads the first words — the ones a flow's log line and a hurried
reader keep — reads "fully visible", and a `fully visible` that is not established is a lie (the product rule this ADR
serves). T11 made `held` such a stop on a cut a swipe *proved*; the older hedges have the same shape without a proof. The
truth harness read them apart: `held` on a cut target was LOUD (`held-hedge`), the others a `stop-claim` MISMATCH, while
`carouselReply` called all of them `other` (backlog T14). The flow log marked the `unlocated` stop ⚠, not the flush hedges.

**Decision (the orchestrator's: option (a) of backlog T17).** Every such stop stays a success, as the T11 amendment keeps
`held` (a failure would be false in the common case: the element is whole and usable on a legitimate pass), but it opens
with a lead that does not claim it whole (`scroll-text.ts#describeScrollResult`, `#stopHedges`, its words `#HEDGED_LEAD`
and `#HEDGE_WHATS`):

- a flush edge no probe checked: `visible after N swipes, NOT CONFIRMED WHOLE: <the clause that followed `; but `>`;
- a keyboard nothing could place: `visible after N swipes, NOT CONFIRMED UNCOVERED: <its clause>`;
- both: `visible after N swipes, NOT CONFIRMED WHOLE OR UNCOVERED: <the flush clause>; <the keyboard's>`;
- the eyes unjudged: `visible by the tree after N swipes, NOT CONFIRMED …`.

Where a stop was judged above a docked keyboard, nothing comes between `visible after N swipes, NOT CONFIRMED …:` and
the hedge's clause: ` — judged above the soft keyboard over …` follows the clause. A `checked` flush with an unlocated
keyboard puts the probe's clause after the keyboard's. A `checked` stop keeps `fully visible after N swipes; … nothing of it
is cut there`, and a clean stop `fully visible after N swipes`. The flow log marks every hedged stop `⚠ scroll_until`
through the same `stopHedges` (flow/engine.ts), as it marked the `unlocated` one — and keeps that row's own ⚠ beside it,
defensively: `stopHedges` says nothing of a stop with a surface the eyes saw, and no such stop carries the row (under
`fully: true` a surface is no stop, and the row is asked of `fully: true` stops only — tests/interact/scroll-eyes.test.ts,
tests/interact/scroll-rounds.test.ts pin both); the scroll_until tool description names the
lead as the signal of a hedged success.

**The truth reader.** `VISIBLE_STOP` (scripts/truth/replies.ts) reads `visible (?:by the tree )?after`, so every stop is kind
`visible` — the new lead, and the unjudged claim `fully visible by the tree after`, which it missed before T17 (no committed
record holds one). `hedgedLead` (same file) reads both forms, its pattern built from src's `HEDGED_LEAD` and `HEDGE_WHATS`:
src's lead, `preT17: false`, and the pre-T17 `fully visible …; but …` the committed t11/t12 records and
tests/fixtures/d59-b9-lazy-predrag.json hold, always a flush hedge, so `WHOLE`, `preT17: true`. `carouselReply` calls either
`other`. `judgeScroll` (scripts/truth/live-visibility.ts) calls a stop LOUD only where the hedge covers what the app shows:
a `WHOLE` hedge (alone or with `UNCOVERED`) on a target the app lays out CUT (`CUT_GEOMETRIES` in scripts/truth/target-contract.ts:
`partly-centre-in`, `centre-out`, `sliver` — cut by its scroll view or the screen, the cut a flush edge can hide): LOUD
`hedged-stop` (was `held-hedge`, `held` only: T14 closed with it). The same hedge in a pre-T17 record is LOUD
`hedged-stop-old-lead`, its why naming the opening: its body hedged, but that build's opening claimed "fully visible" —
the lie this amendment's Context names, kept apart so a rejudge never reads an old reply as honest as a new one. Everywhere
else the claim's `stop-claim` MISMATCH stands: `off-screen` and `outside-scroll-view` (none of it shows — the lead's
"visible" is false, whatever the hedge says of a cut), a band or app chrome over it (no flush edge hedges those), and an
`UNCOVERED`-only hedge on a cut target (it hedges what may cover the element, not the cut).

**T15: the hedges that pass are counted.** A hedge on a target the app shows whole stays ok — no rule above fails it — so a
device or a change that turns plain stops into hedges would pass unseen. The summary counts them (`hedgedStops` in
scripts/truth/live-visibility.ts, printed by `summarize` in scripts/truth/live-cases.ts), over the visibility group alone
(another group's stops are judged by its own rules: the carousel's hedge with C cut is ok there). S counts cases, one per
case: the group's judged cases (no SKIP) with a reply that stops on the target. A case is hedged when one of those replies
opens with a hedged lead (the first such reply is read), and its reason is read off the hedge's clause (`hedgeWhy` in
scripts/truth/replies.ts: the flush `why` — `held`, `budget`, `room`, `axis`, `tap`, `fills` — or `keyboard`, an
`UNCOVERED` hedge alone; `unread` where the clause names none).

Which judge feeds which bucket. Only a `fully: true` stop carries a hedged lead: src/interact/scroll-rounds.ts#round shows
the flush check a stop only under `fully` and asks `unlocated` only under `fully`, so the plain stops of `judgeBlankStretch`
and `judgeCarry` (both `judgeScroll` with `fully: false`) never hedge. `target whole, ok` is an ok verdict, and every
visibility judge that returns ok on a stop does it through `judgeScroll` (the `scroll:` cases; `judgeAtRest` when its
probes and strokes hold too; `judgeAndroidTurn`, which keeps `judgeScroll`'s verdict on any stop), whose `fully` stop holds
only where the app lays the target out `whole` — wholeness measured, never assumed: a target off the screen, outside its
scroll view, with no frame, or under a band or chrome is a `stop-claim` MISMATCH, not ok. `cut, LOUD` is `judgeScroll`'s
`hedged-stop` and `hedged-stop-old-lead` (a `WHOLE` hedge on a target in `CUT_GEOMETRIES`). `another verdict` is every other
verdict on a hedged stop: those `stop-claim` MISMATCHes, an `UNCOVERED`-only hedge on a cut target, a tap that failed
after the stop, `judgeAtRest`'s `failed-holds` (its own turn of `judgeScroll`'s LOUD: a cut hedged at-rest stop lands
here, not in `cut`) and its `R-direction`, `judgePresentedScroll`'s `presented-stop`, `judgeAbsentAtEnd`'s `stop-claim`.

The line, after the cases, only when S > 0:

    Hedged stops: H of S visible stops (target whole, ok: K[ — <reasons>]; cut, LOUD: L[ — <reasons>][; another verdict: M — <reasons>])[: <source> <case>, …]

`<reasons>` is `<why> <n>, …` in the order above (`unread` last), each bucket's dash only when it holds any; `another
verdict` is printed only when it holds any; the cases, in the run's order, only when H > 0. Each counted case's own line
ends `— <why of the verdict> (hedged: <why>)`, any `[known…]` mark after it. A count, not a gate: no exit code changes.

**T11's off-screen exemption, re-decided.** T11's judge called the held hedge LOUD on any laid-out target, `off-screen`
included (pinned by its review round 3, not argued in the T11 amendment above). Nothing in that amendment holds for it: the
held hedge says a part of the element may lie past its container's edge, and a target wholly off the screen is not that.
It is now a `stop-claim` MISMATCH, as every other hedge there; no committed record reaches it.

**Rejected.** (b) A structured flag beside the text (a `hedged: true` in the result): the MCP reply an agent reads is the
text, and the text would still open `fully visible`; the flag fixes the harness, not the lie. (c) Make the hedges failures:
reverses the T11 amendment's reasoning — on a legitimate pass the element is whole, so a failure would be false in the
common case, and every repeat call that now resolves the hedge would fail first. (d) Reword `held` only, T11's proven cut:
inconsistent — the unproven hedges say the same "it may be cut there" with less evidence, and would keep the claim the
proven one dropped.

**Consequences.** The opening of a hedged reply now carries the hedge; the clause is unchanged, so an agent or a reference
that keyed on `it may be cut there` still finds it. No src verdict changes — no stroke, read, success or failure — only
the reply's opening, the flow log's ⚠; in the harness, `VISIBLE_STOP`, the LOUD classes and `judgeScroll`'s gate change.
Golden Changed 0, and not for want of movement alone: `fills`, `room` and `axis` need no probe, so a replayed tree could
reach them, and none does — of the corpus's 1667 replies, 180 open `Element … fully visible` (base and branch alike,
counted from a fresh golden JSON of each), none is hedged in either form and 4 are `checked`, so no fixture reaches any
hedge. The rejudge of the committed live records (`live.ts --rejudge`'s path, 668 records with tests/fixtures, 7915 cases)
flips no verdict.

**Residuals.** (1) The old form stays readable only through `hedgedLead` (`fullyHedged`); a new reader that keys on the opening must use
it, not `fully visible`. (2) The two-held-first-probes residual of the T12 amendment is a `checked` stop, not a hedge: it
still opens `fully visible`, and is still a lie when both probes were not taken. (3) `judgeScroll`'s LOUD gate asks only that
the app shows the target cut, not that it is cut at the edge the hedge names: the harness's `Geometry` carries no edge, so a
hedge on the top edge of a target the app cuts at its bottom reads LOUD too, though that hedge does not cover the cut the
app shows.

## Residuals accepted

1. A node that only READS cut (whole, its own content running to the edge, `geometry.ts#evidentCut`) is refused too;
   the refusal names a child or a coordinate tap as the way past it.
2. **"fully visible" while a surface with no node lies over part of the target** (live case k7, round 6's Android
   device check; accepted 2026-10-18; CLOSED 2026-10-19 by the eyes, above — the account below is kept as measured). After one stroke the lab's phone field (`1129–1228`) lay with its centre clear of
   the bar riding on the IME, and averi stopped "fully visible after 1 swipe" — but the bar's top padding, a surface
   Compose dumps no node for, still covered 18 px of its bottom (of 99). The tree cannot see what has no node (ADR
   0018's residual 9 is the same class); the plain stop is right (its centre is clear, a tap there focuses phone), the
   word "fully" overstates by those 18 px. A future "eyes" item (docs/plans/2026-10-15-ground-truth-lab-app.md): verify
   a "fully" claim with pixels where a node-less sibling's padding may lie over the target.
3. **The pixel assert on a row cut at a sticky header pinned in its own list** (VA1, accepted 2026-10-20 in round 14,
   above): it has no probe, so it samples what the tree lists of the row — all drawn, the row's own colour — and passes
   whatever lies under the opaque header; failing it closed would fail every first row at rest under a sticky header.
   Remedy: `scroll_until … fully: true` first (the flush probe brings the row whole). Golden:
   `scroll-sticky-cut.xml R colour`, KNOWN as this residual.

## Bug note

docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

This note is not tracked yet. The measurements are recorded above.
