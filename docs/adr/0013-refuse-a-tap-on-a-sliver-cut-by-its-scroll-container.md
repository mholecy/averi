# 13. Refuse a tap on a sliver cut by its scroll container

Status: accepted, 2026-10-10 (owner). Refined 2026-10-17 (owner, lab note F2A1). Decided 2026-10-18 (owner): F2A1's
way past kept after the remedy, a fill into the strip refused by design, k7's "fully" a residual (below).

## Context

uiautomator cuts every rect to its scroll container. On mp-native's SWIFT form (Android) the "Payment details" toggle,
132 px tall, read `66,1924 948x55` at the form's bottom edge (1978). The tap went to (540,1952) and "Tapped" was
reported, but the section did not expand. Hand taps on the strip did nothing either. A target that size beside a COVER
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
3. **"fully visible" with part of the target under a node-less surface is a known residual** (below).

## Residuals accepted

- A node that only READS cut (whole, its own content running to the edge, `geometry.ts#evidentCut`) is refused too;
  the refusal names a child or a coordinate tap as the way past it.
- **"fully visible" while a surface with no node lies over part of the target** (live case k7, round 6's Android
  device check; accepted 2026-10-18). After one stroke the lab's phone field (`1129–1228`) lay with its centre clear of
  the bar riding on the IME, and averi stopped "fully visible after 1 swipe" — but the bar's top padding, a surface
  Compose dumps no node for, still covered 18 px of its bottom (of 99). The tree cannot see what has no node (ADR
  0018's residual 9 is the same class); the plain stop is right (its centre is clear, a tap there focuses phone), the
  word "fully" overstates by those 18 px. A future "eyes" item (docs/plans/2026-10-15-ground-truth-lab-app.md): verify
  a "fully" claim with pixels where a node-less sibling's padding may lie over the target.

## Bug note

docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

This note is not tracked yet. The measurements are recorded above.
