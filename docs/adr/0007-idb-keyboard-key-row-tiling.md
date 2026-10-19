# 7. idb's own keys are read by how they tile the band

Status: accepted, 2026-10-12 (owner, with the slice-4 device check). Residuals amended 2026-10-13 (owner, with the
round-12 device check): the QuickType bar lies above the band, not inside it.

## Context

idb's keyboard band lists its keys right after the app's nodes, with no mark on either. Before ADR 0006 a key was just a
cover. Under a keyboard line it must be the keyboard's OWN UI: the line covers no key, as no reading covers a WDA key.
An app node listed right before the keys, wholly inside the band, must still lie under the line.

## Decision

A node of the band's run is the keyboard's own when it shares its ROW (the same top and height) with another node of the
run that it does not overlap past the slack (ADR 0002). The rule is `draw-order.ts#sharesRow`, and
`draw-order.ts#DrawOrder.ofKeyboardBand` answers it. These also count as the keyboard's own:

- the band's background;
- what is listed after the background (Dictate).

A node is of the band's run when its part ON THE SCREEN lies inside the background (amended 2026-10-19, round 8): the
band's bottom is the screen's, so a key overhanging the screen's edge by a rounded point (`Next keyboard` ending at 875
of 874) is still the keyboard's
(docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md).

Keys TILE the band in rows: the number pad's `1 2 3` at 596, QWERTY's letters, neighbours overlapping by 1 pt at most.
An app node stands alone on its row, or shares the row only with a node laid OVER it (a field and its placeholder).

This rule was chosen over two others:

- a key's size: a space bar is half the screen wide, and an app button may be small;
- the list's order alone: the app node is listed inside the run.

## Residuals accepted

- A key alone on its row INSIDE the band reads as content under the line, so a tap on it is refused. No idb dump has
  one: the lone suggestion this residual first named lies outside the band (next item).
- The QuickType bar is not of the band. On iOS 27 idb lists it ABOVE the band's background, as a plain button
  (Finportal's login, 2026-10-13: `button 'Passwords' 30,546 342x44` over `other 0,590 402x284`; WDA's keyboard frame for
  the same keyboard is `0,546 402x328` and includes it). It does not lie inside the background, so it is not of the run
  (`soft-keyboard.ts#flatListKeyboardBand`), and the line stays at the background's top, 590. The bar reads as app
  content above the keyboard, and a tap on it is sent and presses it. That is what was asked: the keyboard's own
  controls are tappable (the `tap` tool's description says so). Not a defect (owner decision, 2026-10-13).
- What that leaves is small. idb leaves out of its tree an app node whose centre lies in the bar's strip, 546–590, as it
  does one under the band (Finportal's `login_submit 36,547 109x48` was dropped), so a tap on it times out waiting for it
  to appear; it is not refused. A node idb did keep there would be judged against the bar as an ordinary cover listed after
  it (idb lists the bar after the app's nodes), not against the line: refused naming `button "Passwords"`, or moved to a
  piece beside it. No dump has one. The bar showed only on the first focus after a launch.
- Two app nodes side by side behind the keyboard, not overlapping, read as keys. No idb dump has them.

## Bug note

No tracked note. The shapes are recorded on `draw-order.ts#sharesRow`. The round-12 device check's note on the
QuickType bar is not tracked yet.
