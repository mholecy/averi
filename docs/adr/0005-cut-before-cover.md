# 5. Cut before cover, for every verb (D1)

Status: accepted, 2026-10-12 (owner).

## Context

A node can be both cut to a sliver at its scroll container's edge and covered by app chrome. Before this decision the
verbs judged the two in different orders:

- the tap judged the cut first;
- `scroll_until` judged the cover first.

So a covered sliver that was stuck got a failure ending "…would only push it out through that edge", which named no
edge.

## Decision

Every verb judges in one order: off the screen, then the system bands (top, then bottom), then cut, then covered, then
under the keyboard. The verbs are the tap, both stops and the pixel assert, and the order is written once at
`ui-tree/standing.ts#Scene`. A covered sliver is reported as a cut at a named edge, with the direction of the scroll
that reveals it. The tap and `scroll_until` share the sentence (`interact/resolve.ts#cutSliverText`).

## Residuals accepted

- The cover over a covered sliver is not named. The cut is the finding, and its remedy is the scroll.

## Bug note

docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
