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
- the cover's role, label and rect, plus its reach for a pinned bar.

The remedy is `scroll_until … fully: true`. It adds "assert something in it that lies clear of that" where a scroll may
not cure the miss. The miss is a finding like any other. The poll goes on, a later round that finds the element clear
withdraws it, and it is the timeout's wording when every round was covered. This is stricter than the tap, which asks
only about the centre.

A full-bleed header still fails closed. This covers iOS's header and Android 15+'s edge-to-edge app bar, measured as
`0,0 1080x220` under the 66-px band. The remedy then leads with something in the header that lies clear of the band
(its title, say). No scroll moves an element laid from the screen's top edge.

## Residuals accepted

- These elements fail closed whatever they show:
  - an element that reaches into a band by design (a full-bleed header);
  - a screen resized above the keyboard (WDA's `login_screen` `0,0 402x566`);
  - a window under an ocr assert.
- A colour assert on idb's Application node fails on the content listed over its sample.
- `scroll_until … fully: true` judges the bands as a region, by this assert's rule and slack (ADR 0009), so it never
  stops on an element reaching into a band by design: such an element ends stuck naming the bar, and only the child
  advice cures the miss.
- What a tree does not list is no cover, as for the tap. One example is a top bar that WDA lists before the scroll view.

## Bug note

docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md

This note is not tracked yet. The measurements are recorded above.

## Where

`verify/pixel-poll.ts#judgeOver` words the miss. `ui-tree/standing.ts#Scene` judges it, with the pixel purpose.
