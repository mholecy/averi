# 7. idb's own keys are read by how they tile the band

Status: accepted, 2026-10-12 (owner, with the slice-4 device check).

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

Keys TILE the band in rows: the number pad's `1 2 3` at 596, QWERTY's letters, neighbours overlapping by 1 pt at most.
An app node stands alone on its row, or shares the row only with a node laid OVER it (a field and its placeholder).

This rule was chosen over two others:

- a key's size: a space bar is half the screen wide, and an app button may be small;
- the list's order alone: the app node is listed inside the run.

## Residuals accepted

- A key alone on its row reads as content under the line, so a tap on it is refused. A lone QuickType suggestion such
  as "Passwords" is an example.
- Two app nodes side by side behind the keyboard, not overlapping, read as keys. No idb dump has them.

## Bug note

No tracked note. The shapes are recorded on `draw-order.ts#sharesRow`.
