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

## Residuals accepted

- A node that only READS cut (whole, its own content running to the edge, `geometry.ts#evidentCut`) is refused too;
  the refusal names a child or a coordinate tap as the way past it.

## Bug note

docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

This note is not tracked yet. The measurements are recorded above.
