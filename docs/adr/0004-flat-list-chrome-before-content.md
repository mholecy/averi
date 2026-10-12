# 4. Chrome before content in idb's flat list

Status: accepted, 2026-10-09 (owner, device check C3-3).

## Context

idb lists a screen flat. First comes the Application, then the top bar's items (`Back` `30,70 28x28`, the title
`136,74 130x20`), then every form row in reading order, then the pinned CONTINUE. A screenshot shows the bar opaque and
the rows scrolled under it hidden. With no scroll-view ancestry, draw order cannot tell a row from the bar over it.

An interim rule said a later node covers only when its top lies at or below the target's. Over six measured scroll
positions of the SWIFT form (`tests/fixtures/idb-swift-form-scrolled-under-top-bar.json`) it refused Back and the title
three times, all falsely.

## Decision

In a flat list (`UiNode.flatList`), the nodes before the first CONTENT node are the bar's. Content listed after them that
ENDS inside the top bar's band (`FLAT_LIST_TOP_BAR_FRACTION`) is no cover of them.

A menu, sheet or dialog that reaches past the band still covers what it lies on. Between content nodes nothing changes:
the pinned CONTINUE still covers `priority_select`. The row is `draw-order.ts`'s `flatListChrome`, and only the
`target` question asks it.

## Residuals accepted

- Content listed after the bar that is drawn over it and ends inside the band is not seen. Examples are a small
  popover or a tooltip. The result is a false "clear".
- A bar node listed after the first content node meets content as content, so a row scrolled under it reads as a cover.
  That is a false refusal, the safe direction.
- WDA's nested tree and Android's never meet this rule.

## Bug note

docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
