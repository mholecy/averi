# BUG: under WDA a childless screen-sized `toolbar` still covers a dismissal target the screenshot shows uncovered — the keyboard-covered tap is refused

**Measured 2026-10-09 05:30:31 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt),
averi = mobile-verify `fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio), scratch config `treeSource: wda` +
`keyboardDismiss: [tap: { role: text, text: "New Contact" }]`, stock Contacts "New Contact" sheet (UIKit). Follow-up of
[2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md](2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md),
whose round-2 fix holds on the mp-native SWIFT form (that note's 2026-10-09 sections); noted there and filed on its own here.

## Observed (measured)

Keyboard up (`role:keyboard` `0 573 402 301`), target `role:text text:"add pronouns"` at y 714, under it:

```
05:30:31  tap { selector: 'role:text text:"add pronouns"', configPath: <scratch> }                              (13.3 s)
→ The soft keyboard covers role:text text:"add pronouns": the band it draws over [0,573][402,874] contains the tap point
  (223,703) on two looks 300ms apart; … none of the configured dismissals is usable on this screen (tap text:"New Contact"
  role:"text": covered by toolbar "Toolbar"). Nothing was tapped: …
```

WDA pre-order after the title `text 'New Contact' 149 89 104 22` (inside `container id:"New Contact" 0 78 402 54`):

- `scrollable 0 62 402 812` WITH children (excused since round 2, absent from the reply),
- `toolbar 'Toolbar' 0 83 402 48`, no children,
- `toolbar 'Toolbar' 0 62 402 812`, no children (93 % of the screen).

Either toolbar contains the title's point (201,100). The screenshot shows the title drawn with nothing over it. As a
statement about the pixels the refusal is false (the safe direction: nothing was tapped, and the reply says how to hide the
keyboard otherwise). Whether a title tap would have hidden the keyboard in a UIKit sheet was not tried.

## Why (read from the source)

`src/ui-tree/geometry.ts#shadowing` (l. 683–690) excuses a later node only through `coversOnlyThroughContent`:
`n.children.length > 0 && !isInteractive(n) && (CONTENT_FRAMED_ROLES.has(n.role) || area >= screen × SCREEN_SIZED_FRACTION)`.
A WDA `toolbar` with no children is neither a host (no children) nor a content-framed role, so it covers as itself, with
its full frame. On this UIKit sheet WDA reported both toolbars as empty, frame-only nodes, one over the bar area and one
over the whole sheet (one screen measured; other UIKit screens not checked).

## Why it matters

- The first fix's premise ("a screen-sized node covers only through its content") is shown on SwiftUI hosts; this UIKit sheet
  gives the same full-screen toolbar WITHOUT children, so a configured title-tap dismissal on it is refused, and every
  keyboard-covered tap there fails.
- The 402×48 toolbar shows the same shape at bar size: a childless, non-interactive bar frame over a title it does not paint over.

## Possible fix directions (owner's choice)

- Treat a childless, non-interactive, unlabelled `toolbar` (and other structural roles) as not covering, or as covering only
  where it does not contain the node being tested's ancestors' rects (the title's container `0 78 402 54` lies inside the
  402×48 toolbar's band).
- Excuse a screen-sized node regardless of children when it is non-interactive and has no label/value, i.e. extend the
  host rule to childless frames (the trade-off: a genuinely opaque empty overlay would pass silently; the doc's "silent pass"
  trade-off applies).
- At minimum keep refusing but say which kind: `covered by an empty toolbar frame (no children) — may not be drawn over it`.

## Repro

1. iOS 27 simulator, Contacts → + (New Contact), `treeSource: wda`, config `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`.
2. Focus a field so the software keyboard is up (the hardware-keyboard prefs off, as in the parent note's device checks).
3. `tap { selector: 'role:text text:"add pronouns"' }` (a row under the keyboard) → refused, `covered by toolbar "Toolbar"`.
