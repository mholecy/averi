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

The tap and the plain stop judge in one order: off the screen, then the system bands (top, then bottom), then cut,
then covered, then under the keyboard. The order is written once at `ui-tree/standing.ts#Scene`. A covered sliver is
reported as a cut at a named edge, with the direction of the scroll that reveals it. The tap and `scroll_until` share
the sentence (`interact/target-text.ts#cutSliverText`).

The other purposes share that order but judge less or more in it:

- **The `fully` stop judges no sliver.** A stop flush with a clipping container is the flush probe's to check
  (`scroll-rounds.ts#PROBE_REACH`), so the cut step never applies to it. Since 2026-10-20 (round 14, VA1; ADR 0013) so
  is a stop flush under a node pinned at its scroll view's top or left inside that scroll view — a merged sticky header
  (`ui-tree/later-edges.ts#PinnedEdge`): the probe goes toward the pinned node's inner edge.
- **The pixel assert judges the keyboard first** (ADR 0010). It never judges off the screen, and its only cut is at the
  navigation bar, for the ocr reader (ADR 0009, N-b).

## Residuals accepted

- The cover over a covered sliver is not named. The cut is the finding, and its remedy is the scroll.

## Bug note

docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md

The second note is not tracked yet.
