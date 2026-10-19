# BUG: under WDA, React Native's sibling views are listed by their frames' tops, not in the order they are drawn — a later sibling drawn over an earlier one can be listed BEFORE it, against averi's "listed later is drawn over" premise

> **Status (2026-10-19):** open, no golden row yet: rn-field's own fields do not hit it since 843229f laid M's field
> below its label's top. A cell for it is the next react-native one (below). Calibration.json lists it excluded until
> then. Found while building lab note LR1's cell.

Lab note LR3. **Found 2026-10-19** by round 7's React Native lab app (fixtures/apps/rn, `rn-field`; RN 0.88.0, new
architecture) on the `averi-lab iPhone 17` simulator (iOS 27.0), WDA on port 8120.

## Observed (measured)

M's box holds two siblings in JSX order (src/ReactNative.tsx#LabelledField): the label `Text` first, the multiline
`TextInput` second — React Native draws the second over the first (the field is transparent, the label shows through
it). With the field laid from 4 pt below the box's top (before 843229f) WDA listed them the other way round:

```
Other (wrapper)  69,474 264x56          ← the TextInput, drawn LAST, listed first
  TextView lab.rn-field.M.field 69,474 264x56  (its two scroll indicators)
StaticText lab.rn-field.M 69,491 175x23  ← the label, drawn FIRST, listed after
```

N's box, the same two siblings, the field's top 1 pt BELOW the label's: label first, field after — the draw order.
Laid at 843229f with M's field 1 pt below its label's top, M lists label first too. So the order WDA reports for RN's
views follows their frames' tops (iOS's accessibility ordering of an RN container's children), not their z-order.

## Why it matters

src/ui-tree/draw-order.ts reads a node listed after another, overlapping it, as drawn over it (its covers, the
`ownControl` and indicator excuses all rest on it). On an RN screen a view drawn over a target whose frame starts above
the target's is listed before it: averi would read the target as drawn over the cover — a covered target `Tapped`, a
`fully visible` stop over a banner — the silent direction. Here the excusing rules happened to see the label first only
because of where the field starts.

## A cell to reproduce it

A react-native cell: a coloured target and, as its later JSX sibling, an opaque view drawn over the target's centre
whose frame starts above the target's top (a banner or toast). Truth: not reached, drawn under 95 %. Expected golden
red under WDA (`Tapped`, colour pass on the cover) until a fix — e.g. an RN-tree note that WDA's order is not the
draw order, or a pixel check before claiming a tap on an RN screen.
