# 3. Three pixel-cover exemptions past the slack

Status: accepted, 2026-10-12 (owner).

## Context

`exposure` answers where a TOUCH goes, so it counts covers that take the touch but draw nothing. The pixel assert asks
which covers hide PIXELS. A sweep of every node of every fixture found three kinds of `exposure` cover that hide no
pixels. The owner's first ruling covered only the 2-unit edge (ADR 0002). These three exemptions go past that ruling.

## Decision

`draw-order.ts#DrawOrder.paintsOver` is `exposure`'s covers less three kinds of node.

1. **The element's own content listed beside it.** The cover's reach lies wholly inside the element's rect, and the
   cover hangs off one of the element's own branches (`ownBranch`). An own branch is the nearest shared ancestor, at
   most half the screen (`OWN_BRANCH_SCREEN_FRACTION`). In idb's flat list there are no branches. There the cover must
   say something, and nothing the element does not say (`wordsOf`).
2. **A clickable layer.** This is an unlabelled, unvalued interactive node holding the element whole, on its own
   branch. Compose's ripple targets are an example. This exemption never applies in a flat list.
3. **An overlap within the slack** (ADR 0002).

Covers that stay: CONTINUE over a row, the floating tab bar and its strip, a title over a scrolled row, a sheet or a
dialog over anything.

## Residuals accepted

Each residual is a cover read as none, so a colour or ocr assert measures the cover's pixels as the element's.

- In idb's flat list, a real overlay whose words are all words of the element's label reads as the element's own
  content. Example: a toast "Saved" over a card labelled "Saved payments".
- A dialog's bare background is not seen when the element is bigger than its panel. A container with children covers
  only through its content (`exposure`'s `contentFramed` row).
- A childless, labelled panel laid inside the element reads as on it. Example: a panel over a `0,225 1080x1995`
  container.

## Bug note

docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md

This note is not tracked yet. The measured shapes are kept on `draw-order.ts#DrawOrder.paintsOver`.
