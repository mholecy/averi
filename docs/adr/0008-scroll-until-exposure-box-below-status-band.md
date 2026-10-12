# 8. scroll_until's exposure box is cut below the status band (D3)

Status: accepted, 2026-10-12 (owner). The `shows` discontinuity is decided below.

## Context

The tap and the pixel assert judged covers below the status band. `scroll_until`'s stop did not. So a node lying only in
the band, which hides nothing the bar does not, did two things for `scroll_until` alone:

- it blocked a `fully: true` stop;
- it lowered "shows".

## Decision

The stop judges its covers below the status band (`geometry.ts#belowStatusBand`), as the tap and the pixel assert do. The
order is written at `ui-tree/standing.ts#Scene`.

The node's own part in the band still counts in `shows` (`standing.ts#bandShows`). A match seen only in the band
therefore still outranks one off the frame (`scroll-rounds.ts#better`). Where the cut dropped no cover, `shows` is
exactly the whole frame's.

**The `bandShows` edge discontinuity stays.** Take a node with a cover lying only in the band and a cover straddling
the band's edge. It shows slightly more than the same node with the straddling cover alone, because once a cover is
dropped the straddling cover's part in the band is no longer subtracted. `shows` decides two things only:

- which match ranks first (`scroll-rounds.ts#better`);
- the "N% of it shows" figure in a PARTLY UNDER note.

It never decides a kind, so no stop, refusal or turn changes. Making it continuous would cost a third `exposure` for each
such node.

## Residuals accepted

- In the case above, `shows` and its quoted percentage can be higher by the straddling cover's part in the band.

## Bug note

docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
