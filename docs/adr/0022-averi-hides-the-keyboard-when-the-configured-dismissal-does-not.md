# 22. Averi hides the keyboard itself when the configured dismissal does not

Status: accepted, 2026-10-18 (round 7, task A4; the owner's decision "averi is the agent's hands").

## Context

Under WDA the keyboard guard taps a configured dismissal (`app.ios.keyboardDismiss`, ADR 0016) before a target the
soft keyboard covers. Until now it tapped the FIRST usable entry once and, if the keyboard stayed up, refused
(`AfterDismissalTap`, "never a second strategy": a tap that did not hide the keyboard has changed the screen in a way
the guard cannot judge).

The live golden measured where that leaves the agent (docs/truth/live-ios-2026-10-18-visibility.md, "Forms", k2 and
k3 on WDA): the lab's form-keyboard cell is configured with a tap on its navigation title "Transfer details", which —
like most navigation titles — has no gesture of its own. The tap lands, the keyboard stays up, averi says so honestly
and taps nothing else. LOUD, so the agent's hand is stuck: from the MCP tools there is no verb that hides an iOS
keyboard.

## Decision

The in-tree model's dismissal is ONE ordered list of named strategies (`interact/keyboard-dismissal.ts`), walked one
move at a time: the first strategy that chooses a move on the current look is performed, the keyboard read again
(`KEYBOARD_HIDE_CONFIRM_LOOKS` looks, as before), and only when it is still up is the NEXT strategy judged — on the
look that found it still up, never the one before the move. The list:

1. **Every configured entry, in the config's order** — judged exactly as ADR 0016's picker judged them. New: a second
   configured entry is tried when the first, tapped, left the keyboard up (both the guard and the post-fill
   `dismissKeyboard`).
2. **Averi's own two fallbacks** — only after the configured ones, only when some are configured (the author's
   opt-in that averi may touch the screen to hide the keyboard on this app), and only in the guard, which has the
   target to anchor them (the post-fill dismissal has none):
   - **a blank point** — a tap on a point of the target's nearest scroll view, below the status band and above the
     keyboard's top, where every node in an 8-pt square around it (`BLANK_MARGIN`) is a bare wrapper (a structural
     role with no label, identifier or value) that has children or lies inside that scroll view, an ancestor of the
     scroll view, a hidden subtree's, or the keyboard's own; sought row by row from the top, from the middle of a row
     outward; and only when the target's own tap standing is `reachable` (nothing but the keyboard over it — so the
     scroll view is the top layer's, never a scrim or a sheet's backdrop beneath one). An app that ends editing on a
     tap outside the field hides the keyboard there; one that does not is left as it was.
   - **a drag** — the target's scroll view dragged UP by `DRAG_LENGTH` (120 pt) — or, when the target's centre lies
     deeper under the keyboard, by what lifts that centre to `BLANK_MARGIN` above the keyboard's top — over `DRAG_MS`
     (500 ms, slow enough not to fling), from its blank point nearest the keyboard (the same rule, rows from the
     bottom), never past the status band. Two ways it gets the target clear: a scroll view whose
     `keyboardDismissMode` is `onDrag` or `interactive` (SwiftUI `scrollDismissesKeyboard`) hides the keyboard on
     it; one that does not is scrolled toward its end, the target with it, out from under the keyboard (the note
     then says the keyboard is still up but no longer over it) — or it does not move. The guard resolves the target
     again where it now is, as after every move. This is the one place averi scrolls a screen to clear the keyboard
     — rejected as a FIRST move (interact/keyboard.ts), kept as the last, after the dismissals the author opted
     into. **Never down**: at the top of a sheet's scroll view a downward drag pulls the sheet itself down — the
     swipe that dismisses a sheet.

   Both keep `SCREEN_EDGE` (24 pt) from the screen's sides, clear of where iOS starts its edge gestures.

Every move is irreversible and none is repeated. The target not coming back after a move ends the walk at once
(`AfterDismissalTap`, naming every move so far): a screen the target has left is no screen to judge another strategy
on. Every strategy spent with the keyboard still up is today's honest refusal, extended: `AfterDismissalTap` naming
each move in order and why each later strategy was passed over. No dismissal configured is today's refusal unchanged
(`KeyboardWithoutDismissal`, nothing moved) — the live case k1 pins it.

The reply says which move hid the keyboard and which left it up:
`the soft keyboard covered id:lab.form-keyboard.vs; tapped text:"Transfer details", the keyboard stayed up; hidden by
tapping a blank point of the target's scroll view before tapping`.

## What is never on the list, and why

- **The keyboard's own return key, whatever its label and however single-line the field.** Measured to SUBMIT the
  finportal login from the password field, the key labelled `done` (K5d,
  docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md). The label (`return`, `done`, `go`, `next`) is the app's
  `returnKeyType`, not what its `onSubmit` / `textFieldShouldReturn` does, and the tree shows neither — so no field is
  provably safe, and the rule is "never a fallback that could submit a form". (ADR 0017's "the keyboard's own UI stays
  per verb" is unchanged: no strategy touches the keyboard's own nodes; the accessory Done stays opt-in config.)
- **WebDriverAgent's `/wda/keyboard/dismiss`**: measured to fail (K5a).
- **A tap on any node that is not bare**: a control would be pressed (ADR 0016's explicit refusal), and a text or an
  image may carry a gesture the tree does not show — the very gesture the configured title tap relies on.

## Measured

On the averi-lab iPhone 17 simulator (iOS 27.0), 2026-10-18, by hand through idb (`idb ui tap` / `idb ui swipe`, the
moves the adapter sends), each from a fresh launch:

- **The lab's form-keyboard cell** (SwiftUI `ScrollView`, no tap gesture outside the fields, `postcode` focused; the
  app's model the oracle — focus, values, submits): the title tap (201,84), blank taps at (201,124) and (300,500), drags
  down (300,200→400; 300,200→300 over 0.6 s; 300,450→700, into the keyboard; 201,124→560 and 201,124→224 from the blank
  point), a drag up (300,450→250), and a HID Shift / Control key press (`idb ui key 225`, `224`) — 2 runs each (the keys 1):
  the keyboard stayed up and the focus stayed on `postcode` every time, no value changed, no submit. Nothing generic hides
  this cell's keyboard without typing or pressing return; the fallbacks are tried and the refusal names them.
- **The Contacts "New Contact" sheet** (UIKit form, `First name` focused on open): a blank tap left of "Add Photo"
  (30,380) left the keyboard up (1 of 1); a 120-pt upward drag (30,500→30,380, 0.5 s) hid it, the sheet staying
  presented and the form scrolled 120 pt — 3 of 3. A downward drag was not sent there: a sheet at its scroll top would
  have been pulled down.

**Live, at this src** (docs/truth/live-ios-2026-10-18-keyboard-fallbacks.md, records
docs/truth/live-records/ios-keyboard-fallbacks-*.json): k2 and k3 — LOUD before — ok 3 of 3 each: the title and the
blank point leave the keyboard up, the drag lifts the target clear of it (120 pt for `vs`, 278 pt for `note`) and
averi taps / fills it, saying the keyboard is still up but no longer over it; no submit, no other field touched. k1
(nothing configured) refused as before, 3 of 3; the dismissal group 24 of 24 ok.

## Residuals accepted

1. **A gesture recogniser on a bare wrapper** is not seen by the tree. The blank-point tap could trigger one (ADR
   0016's residual for the picker, the same here). It presses nothing the tree lists, and the reply names the point.
2. **The drag scrolls the scroll view** toward its end by up to the drag's length when it does not hide the
   keyboard. The target is resolved again after it, the note says the scroll view was dragged, and a refusal after
   it says a drag may have scrolled the content.
3. **The post-fill dismissal has no fallbacks**: it has no target to anchor a blank point. A fill whose dismissal
   leaves the keyboard up still throws `AfterDismissalTap`; the next step's guard, with its target, tries them.
4. **No configured dismissal, no fallback.** Opt-in on purpose (the config's doc): an app whose author configured
   nothing gets the refusal, not an unasked touch.
5. **iOS only under WDA**, as the guard: under idb no band is marked and no guard acts (ADR 0006).
6. **The blank-point tap hid nothing measured.** No app measured so far ends editing on a tap outside the field; it
   is kept, before the drag, as the one move that changes no layout where it does nothing, for the apps that do (the
   common `hideKeyboardWhenTappedAround`). A device case of it is owed (a lab cell with a tap-to-dismiss container).

## Supersedes

The "never a second strategy" rule of the in-tree guard (keyboard-in-tree.ts's `AfterDismissalTap` doc until
2026-10-18; ADR 0016 judged one pick per look and is otherwise unchanged — its picker is the configured strategy).
