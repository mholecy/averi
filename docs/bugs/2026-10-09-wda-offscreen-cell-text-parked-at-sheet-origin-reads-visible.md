# BUG: under WDA, the text of an off-screen UIKit cell is listed at a parked frame (`0,62 286x22`) inside the viewport — `scroll_until … fully: true` answers "fully visible after 0 swipes" for a row 300 pt below the screen

**Measured 2026-10-09 11:34 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-3` @ `347e70d` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch config
`treeSource: wda` (+ `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`), stock Contacts "New Contact" sheet (UIKit,
~4 pages), software keyboard up (`keyboard 0 573 402 301`). Found during the round-3 iOS device check (handoff item j, iOS WDA
scroll with the keyboard up). Not a round-3 regression: the 610660f-era capture of the same sheet
(`scratchpad/averi-repo/run3-ios/wda-contact1.txt`, 07:27 UTC) has the same parked nodes.

## Observed (measured)

```
ui_snapshot { filter: 'text:"add related name"' }   (WDA)
  container 'add related name'   20 1171 362 52        ← the cell, its real place (below the 874-pt screen)
  text 'add related name'         0   62 286 22        ← its label, parked at the sheet's origin
11:34:15 scroll_until { selector: 'role:text text:"add related name"', fully: true, configPath: <scratch wda> }      (3.4 s)
→ Element role:text text:"add related name" fully visible after 0 swipes
```

No swipe in the `idb` shim log; the screenshot (`run5-ios/img-72-0.png`) shows the sheet's top (photo, names, Company) and the
keyboard — no "add related name" anywhere. The same scroll on the CELL (`role:container label:"add related name"`) swiped once
(`201 459 → 201 115`) and stopped right at `20 342 362 52`; the text then read `80 357 286 22`.

Raw WDA `/source?format=json` (11:34, `run5-ios/wda-src3.json`):

```
Cell 'add phone'          rect {20,565 362x52}   vis 0      StaticText 'add phone'          rect {80,580 286x22}  vis 0
Cell 'add pronouns'       rect {20,699 362x53}   vis 0      StaticText 'add pronouns'       rect {80,714 286x23}  vis 0
Cell 'add related name'   rect {20,1171 362x52}  vis 0      StaticText 'add related name'   rect {0,62 286x22}    vis 0
```

Every cell from `add address` (y 969) down has its StaticText (and the `Notes` cell its `text 'Notes'` + `textfield 'Notes'`) at
`0,62 …` — the label's frame relative to its cell, offset by the sheet's origin, for cells UIKit has not laid out on screen.
In the averi tree at 11:33 (`run5-ios/wda-c2.txt`), 11 nodes sit at `0 62 286/330 21–22`: add address, add birthday, add date,
add related name, add social profile, add instant message, Notes (text + textfield), add verification code, add field,
add to list.

## Why (read from the source at 347e70d)

`src/adapters/wda-source.ts` (comment l. 66–80, and `parseWdaSourceValue`): invisible nodes are KEPT with their `rect`
("iOS keeps off-screen nodes in its tree and the assert layer relies on that"); `isVisible` is read for one purpose only (is
a `Keyboard` on screen). So a parked rect is taken at face value: the scroll's stop test sees a node wholly inside the viewport
(and above the keyboard band) and stops at round 0. The `visibleFraction`/off-screen checks cannot catch it — the rect IS on
screen; only the parent cell's rect (`20,1171`) or `isVisible=0` says otherwise.

## Why it matters

- `scroll_until` reports success with nothing scrolled; the next `tap`/`type_text` on that selector would act at the parked
  point (here (143,73), the sheet's header) — not tried (the P2 off-screen refusal does not fire, the point is on screen). The
  610660f `Notes` fill (`role:textfield label:Notes`) may have hit or missed the same way depending on whether Notes had been
  laid out.
- `role:text` / `text:` selectors are the natural way to name UIKit rows (the cells carry no ids), so this shape is common
  on any long UIKit form or table under WDA.
- An `absent:` / visibility assert on such a label reads "visible".

## Possible fix directions (owner's choice)

- In the WDA parser, when a node with `isVisible=0` has a rect that lies outside its nearest ancestor's rect (a child outside
  its cell), give it the ancestor's rect clipped (or a zero rect, as idb does for unlaid nodes), so "off screen" is judged on the
  cell.
- Or carry `isVisible` and make scroll/tap/visibility verdicts treat `isVisible=0` + rect not within the parent as "not laid
  out", i.e. still to scroll to.
- At least: in `scroll_until`, distrust a round-0 stop whose node is not contained in its parent's rect.

## Repro

1. iOS 27 simulator, Contacts → + (New Contact), scratch `treeSource: wda`.
2. `ui_snapshot { filter: 'text:"add related name"' }` → the text at `0 62 286 22`, its cell at `20 1171 362 52`.
3. `scroll_until { selector: 'role:text text:"add related name"', fully: true }` → `fully visible after 0 swipes`; screenshot
   shows the row is not on screen.
