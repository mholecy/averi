# 13. Refuse a tap on a sliver cut by its scroll container

Status: accepted, 2026-10-10 (owner).

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
names the alternative ("or it is only that thin, laid flush against it"). A text that is no control (the field's title, cut to 14 px at
the same bar) is tapped as before.

Bug note: docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md

## Residuals accepted

- A node that only READS cut (whole, its own content running to the edge, `geometry.ts#evidentCut`) is refused too;
  the refusal names a child or a coordinate tap as the way past it.

## Bug note

docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

This note is not tracked yet. The measurements are recorded above.
