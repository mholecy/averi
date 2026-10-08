# BUG: `tap` on an element below the screen's bottom edge sends the tap off screen and reports "Tapped"

> **Status (2026-10-08):** fixed on branch `fix/p2-tap-off-screen` (two commits: the refusal, then the review round); unmeasured on a device: the refusal on the SWIFT form (`tap { selector: 'text:"Payee’s street"' }` should now fail `… is off screen at (94,895) on a 402x874 screen … — scroll_until it first; nothing was tapped`, and `scroll_until` then `tap` should focus the field), the 0×0 hint on a field scrolled above the top, a landscape tap and `scroll_until` (the box is turned from the tree's window; never measured sideways), and a fold/unfold mid-session. The fix: every tap on a resolved node (`tap`, a flow `tap:`, the fill's focus tap) goes through `interact/keyboard.ts#resolveClearOfKeyboard`, which refuses — `resolve.ts#refuseOffScreen`, an `OffScreenRefusal`, nothing sent — a node whose centre lies off the screen (`resolve.ts#onScreen` over `swipe.ts#screenBox`: the device's `viewport()`, turned for landscape; a box whose turn is suggested but not witnessed counts either way up, one with no turn suggested only as built; the size is read again before any refusal), before the keyboard is asked and again on the node a guard that acted hands back (that refusal leads with what was sent); a partly visible node is tapped at its centre when that is on screen, refused otherwise with `scroll_until … fully: true` as the remedy; no screen box and no root rect → the tap as before. `scroll_until` judges its stop on the same box. The keyboard dismissal picker asks the same `onScreen`. A never-found wait whose last tree matched the selector only at 0×0 adds `(it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first)` beneath the headline. Scrolling the target in automatically was not done (the note's second direction): it scrolls a screen the caller did not ask to scroll. Follow-up, not done: with several matches the resolution policy (`resolveNow`, pure, no screen) does not prefer an on-screen match over an off-screen duplicate (an RN bottom sheet parked below the fold); such a pick is now refused rather than tapped off screen, so the failure is loud, but the on-screen twin is not chosen.

**Measured 2026-10-08 16:38–16:39 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`), SWIFT payment form (branch `feature/swift-payment`), iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify @ `c35388a` built from source.

## Observed (measured)

idb lists the form's lower fields with their real (scroll-content) rects even when they are below the screen:

```
ui_snapshot { filter: 'text:"Payee’s street"' }
→ [{"role":"text","label":"Payee’s street","identifier":"TextFieldWithComponentStyle","value":null,
    "rect":{"x":42,"y":885,"width":103,"height":20}}]          ← y 885 > screen height 874
```

```
16:38:39  tap { selector: 'text:"Payee’s street"' }      → Tapped text:"Payee’s street"        (1.4 s)
16:39:00  tap { selector: 'text:"Payee’s bank city*"' }  → Tapped text:"Payee’s bank city*"    (1.4 s)
          (rect {"x":42,"y":1157,"width":136,"height":20})
```

Both times the screenshot afterwards is unchanged (the amount field kept focus, no field below the fold was focused, the
form did not scroll). The tap point (centre: y 895, y 1167) is outside the 874-pt screen. The numeric keypad was up
during both calls; that does not matter here — the point is below the screen, not on the keypad.

(Nodes scrolled ABOVE the top come back from idb as 0×0 and are skipped by the zero-area rule — then `tap`/`type_text`
time out "waiting for element … to appear" though the node is in the tree. Not filed; noted for the same fix.)

## Why (read from the source)

- `src/interact/tap.ts:35–37`: `tapElement` resolves the node (`resolveClearOfKeyboard`), takes `tapPoint(node)` and
  calls `adapter.tap(point.x, point.y)` — no check that the point lies on the screen.
- `src/interact/resolve.ts` (the one resolution policy, ~:136): zero-area nodes are dropped; rects outside the
  viewport are not.
- The check exists elsewhere: the dismissal picker refuses a strategy `off screen at (x,y)` "inside the root's rect"
  (docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md stage B, `interact/keyboard-in-tree.ts#pickDismissal`), and
  `scroll_until` judges visibility against `adapter.viewport()` (`interact/scroll.ts:119`). The tap target itself is
  not judged.

## Why it matters

The reply "Tapped …" is the only evidence an agent has; a selector that matches a field below the fold reads as a
successful focus, and the next `type_text` without selector types into whatever still has focus (here the amount
field). In a flow the `tap:` step passes and the failure surfaces steps later.

## Possible fix directions (owner's choice)

- Refuse a target whose tap point lies outside `adapter.viewport()` (or the tree root's rect): `id:x is off screen at
  (63,895) on a 402x874 screen — scroll_until it first`; nothing sent.
- Or scroll it into view first (the `scroll_until` machinery exists) and say so in the reply.
- Word the zero-area timeout the same way when the selector matched only zero-area nodes: "found, but 0×0 (scrolled off
  screen)".

## Repro

1. iOS, idb, a scroll view whose content extends below the screen (mp-native SWIFT form).
2. `ui_snapshot { filter: <selector of a node below the fold> }` → rect y + h/2 > screen height.
3. `tap { selector }` → `Tapped …`; screenshot unchanged.
