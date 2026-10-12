# 11. No "stuck" clause for an element at the screen's bottom edge

Status: accepted, 2026-10-12 (owner).

## Context

The pixel assert's band remedy adds "or, if no scroll moves it out from under that, assert something in it that lies
clear of that" when a scroll may not cure the miss. For the status band an element laid from the screen's top edge is
such a case: it is where a pinned header sits. At the bottom edge the navigation band could get the same shortcut.

## Decision

The shortcut is not mirrored at the bottom edge. An edge-to-edge list runs its rows down to the navigation bar, and a
scroll moves them up, so an element reaching the screen's bottom gets the scroll advice alone. Two cases still get the
child advice there:

- an element in no scroll view, as far as the tree says (`Clips.inScroller` false or unknown, which includes every idb
  miss);
- an element that is the screen itself (screen-sized).

The rule is at `verify/pixel-poll.ts#judgeOver`.

## Residuals accepted

- An element pinned at the bottom edge that the tree places in a scroll view gets only the scroll advice, even when no
  scroll moves it.

## Bug note

No tracked note.
