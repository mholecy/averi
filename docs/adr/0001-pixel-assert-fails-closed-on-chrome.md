# 1. The pixel assert fails closed on what is drawn over its element

Status: accepted, 2026-10-12 (owner).

## Context

A colour sample or an ocr crop reads every pixel of what it reads. It does not read the element's centre alone. Before
this decision the pixel assert measured whatever lay over its element. Measured on the iPhone 17: a colour assert on
`value_date_select` at 24,30, under the 62-pt status band, passed on the status bar's `#EFF1F4`, and its ocr read the
bar's "Contacts". A label under the pinned CONTINUE bar sampled CONTINUE's `#91919A`, reported as the element's colour.

## Decision

A round fails closed and measures nothing when one of these lies over what the measurement reads:

- a system band, overlapping past the slack (ADR 0002);
- a pixel cover (ADR 0003).

What the measurement reads is the colour sampler's 12 %-inset rect (`color-parity.ts#colorSampleRect`) or the ocr
crop's whole rect. The miss names what lies over the element:

- `the status bar …` or `the navigation bar …`, with the band's rect;
- the cover's role, label and rect, plus its reach for a pinned bar. On Android the cover may be one the tree shows only
  by the cut: a node drawn after the element, outside its scroll view, whose own node begins exactly where the element's
  top or bottom edge ends, reaching past it at both ends (`ui-tree/standing.ts#OverlaidEdge`, since 2026-10-20: Compose leaves out of a node's
  bounds what a later node covers). The miss says the element "meets" it and may run on under it, its rect the reach
  (docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md, refined 2026-10-20).

The remedy is `scroll_until … fully: true`. It adds "assert something in it that lies clear of that" where a scroll may
not cure the miss. The miss is a finding like any other. The poll goes on, a later round that finds the element clear
withdraws it, and it is the timeout's wording when every round was covered. This is stricter than the tap, which asks
only about the centre.

A full-bleed header still fails closed. This covers iOS's header and Android 15+'s edge-to-edge app bar, measured as
`0,0 1080x220` under the 66-px band. The remedy then leads with something in the header that lies clear of the band
(its title, say). No scroll moves an element laid from the screen's top edge. A full-bleed footer (a surface laid to
the screen's bottom edge at full width, such as a bottom sheet) likewise, under the navigation bar: its remedy leads with
its content above the bar.

**Amended 2026-10-13 (round 10 verification 2, ADR 0009 (b)).** Under a system bar, the header, footer and screen
advice is given only to content no scroll lifts out of the band (`ui-tree/standing.ts#pinnedSurface`): in no scroll
view, or screen-sized scroll content taller than the room between the bars. The same shape inside a scroll view is a
scroll view's content, which `scroll_until … fully: true` lifts, so it gets the scroll advice (with the child clause
when a scroll may not cure it). The covered sentences keep their own screen and header advice.

## Residuals accepted

- These elements fail closed whatever they show:
  - an element that reaches into a band by design (a full-bleed header);
  - a screen resized above the keyboard (WDA's `login_screen` `0,0 402x566`);
  - a window under an ocr assert.
- A colour assert on idb's Application node fails on the content listed over its sample.
- `scroll_until … fully: true` judges the bands as a region, by this assert's rule and slack, only where a scroll can
  lift the element out (ADR 0009). A full-bleed header or footer, or a screen-sized element, in no scroll view
  (`pinnedSurface`) still stops `fully`, and only the child advice cures the pixel miss.
- What a tree does not list is no cover, as for the tap. One example is a top bar that WDA lists before the scroll view.

## Bug note

docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md

This note is not tracked yet. The measurements are recorded above.

## Where

`verify/pixel-poll.ts#judgeOver` words the miss. `ui-tree/standing.ts#Scene` judges it, with the pixel purpose.
