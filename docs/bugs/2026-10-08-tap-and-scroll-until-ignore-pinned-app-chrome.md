# BUG: `tap` and `scroll_until` treat a row hidden behind the app's own pinned chrome (a bottom CTA bar, the top bar) as visible — "Tapped" lands on the bar, "fully visible" is a row nobody can see

**Measured 2026-10-08 20:09–20:13 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`), SWIFT payment form (branch `feature/swift-payment`), iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509`
built from source (`dist/`, stdio). No keyboard up during any of these calls.

## Observed (measured)

The form pins a CONTINUE bar at the bottom (`button 'Continue to summary' swift_payment.form.continue_button` at
`24,780 354x44`, listed LAST in idb's pre-order), and draws a translucent top bar (status bar + back button + title,
≈ y 0–116) over the scroll view.

### 1. A row under the bottom bar: "fully visible", "Tapped", nothing opens

`priority_select` at `{x:24, y:763, w:354, h:52}` — its centre (201,789) lies on the CONTINUE bar (y 780–824); the
screenshot shows only the "Priority*" caption peeking above the bar.

```
tap { selector: "id:swift_payment.form.priority_select" }               → Tapped id:swift_payment.form.priority_select   (1.4 s)
ui_snapshot { filter: 'id~"priority_sheet"' }                           → 0 matches … in a tree of 45 nodes
scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }
                                                                        → Element id:swift_payment.form.priority_select fully visible after 0 swipes
tap { selector: "id:swift_payment.form.priority_select" }               → Tapped id:swift_payment.form.priority_select
ui_snapshot { filter: 'id~"priority_sheet"' }                           → 0 matches
```

The taps landed on the (disabled) CONTINUE button. After a manual `swipe (380,600) → (380,400)` (row at y 452) the same
`tap` opened the sheet (`priority_sheet.row_0/1` listed). Had CONTINUE been enabled, the "Tapped priority" call would have
submitted the form to its summary.

### 2. A row under the top bar: "fully visible", and a centre tap hits the status bar

After `scroll_until text:"Payee’s street" fully` the IBAN input sat at `{x:42, y:27, w:280, h:20}` — wholly behind the
top bar (screenshot: the bar shows the title; the first visible field is BIC):

```
scroll_until { selector: 'role:textfield value:"BE15964000000130"', direction: "up", fully: true }
→ Element role:textfield value:"BE15964000000130" fully visible after 0 swipes
```

And `priority_select` at `{y:-20, h:52}` (centre y 6, "partly visible" by the off-screen rule) → `tap` → `Tapped
id:swift_payment.form.priority_select`; the point is iOS's status bar, so the tap scrolled the form back to the top
(status-bar scroll-to-top) instead of opening the select.

## Why (read from the source)

- `src/interact/resolve.ts#onScreen` / `refuseOffScreen` (2026-10-08 fix) judge the centre against the screen box only.
- `src/ui-tree/geometry.ts#shadowing` exists — it finds a later, non-structural node over a point — but only
  `interact/keyboard-in-tree.ts` (the dismissal picker) calls it; the tap target itself is never asked (`grep shadowing(
  src` → geometry.ts, keyboard-in-tree.ts). Here the cover IS in the tree: `continue_button` comes after `priority_select`
  in pre-order and contains (201,789).
- `src/interact/scroll.ts` scores visibility against the screen (or the box above the keyboard), not against nodes drawn
  over the target. The top bar is not one node in idb (only `BackButton` 30,70 28x28 and the title 136,74 130x20), so it
  cannot be found by `shadowing`; but the scroll view's first visible content / the title's bottom bound it.

## Why it matters

- "Tapped X" with X's centre under a sticky CTA presses the CTA — in a payment form, the submit button. The tool reports the
  intended target. This is the most common layout in mp-native forms (pinned CONTINUE/CONFIRM bar over a scroll view).
- `scroll_until … fully: true` exists to prove the element is visible before a rect/pixel/screenshot step; here it
  certifies a row covered by the bar, and does not scroll although scrolling would fix it.

## Possible fix directions (owner's choice)

- Before tapping a resolved node, ask `shadowing(tree, node, point)`; when a later interactive node covers the point,
  refuse naming it (`… is covered by button "Continue to summary" at (201,789) — scroll_until it first; nothing was tapped`),
  or pick a point of the node that is not covered (the visible caption strip here).
- In `scroll_until`, subtract the rects of later-in-tree nodes that overlap the target (sticky bars) from its visible area, so
  "fully" fails or keeps scrolling; for the top inset, bound the viewport by the scroll container's top content edge / the
  title's bottom.
- At minimum, flag the case: a target whose tap point lies inside another node's rect that comes later in pre-order.

## Repro

1. iOS, idb, mp-native SWIFT form (`run_flow goto_swift_payment_form`), keyboard down, CZK account (form at rest:
   `priority_select` y 763, CONTINUE bar 780–824 — fill IBAN/BIC so the notice rows push it there, or use any row whose
   centre falls in 780–824).
2. `scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }` → "fully visible after 0 swipes".
3. `tap { selector: "id:swift_payment.form.priority_select" }` → "Tapped …"; `ui_snapshot { filter: 'id~"priority_sheet"' }`
   → 0 matches.
