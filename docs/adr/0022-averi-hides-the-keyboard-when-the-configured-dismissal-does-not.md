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

The in-tree model's dismissal is ordered lists of named strategies (`interact/keyboard-dismissal.ts`), walked one move
at a time: the first strategy that chooses a move on the current look is performed, the keyboard read again
(`KEYBOARD_HIDE_CONFIRM_LOOKS` looks, as before), and only when it is still up is the NEXT strategy judged — on the
look that found it still up, never the one before the move. The lists:

1. **Every configured entry, in the config's order** (`configuredStrategies`) — judged exactly as ADR 0016's picker
   judged them. New: a second configured entry is tried when the first, tapped, left the keyboard up (both the guard
   and the post-fill `dismissKeyboard`).
2. **Averi's own** (`AVERIS_OWN`) — walked by the guard only, and only AFTER a configured strategy performed a move
   that its looks confirmed left the keyboard up (review round 1, the orchestrator's decision): the author opted into
   touching this screen and the configured touch was not enough. Nothing configured, or nothing configured usable on
   this screen, moves nothing — the refusal as before. The post-fill dismissal has no target to anchor them and walks
   none. One strategy:
   - **a drag** — the target's scroll view dragged UP by `DRAG_LENGTH` (120 pt) — or, when the target's centre lies
     deeper under the keyboard, by what lifts that centre to `BLANK_MARGIN` above the keyboard's top, never past the
     status band — at `DRAG_SPEED` (240 pt/s: the speed measured to hide the Contacts keyboard, 120 pt in 500 ms; the
     duration follows from the length, so a long lift is no faster and no fling — a 300-ms stroke at 1147 pt/s was
     measured to fling a SwiftUI form 729–970 pt). It touches down on the blank point nearest the keyboard: a point
     of the target's nearest scroll view, below the status band, above the keyboard's top and `SCREEN_EDGE` (24 pt)
     in from the screen's sides (clear of iOS's edge gestures), whose 8-pt square (`BLANK_MARGIN`) holds only bare
     wrappers that have children or lie inside that scroll view, an ancestor of it, a hidden subtree's, or the
     keyboard's own; sought only when the target's own tap standing is `reachable` (nothing but the keyboard over
     it, so the scroll view is the top layer's). Two ways it gets the target clear: a scroll view whose
     `keyboardDismissMode` is `onDrag` hides the keyboard on it (measured on Contacts; `interactive` is unmeasured);
     one that keeps it is scrolled toward its end, the target with it, out from under the keyboard — the note then
     says where the drag went and that the keyboard is still up but no longer over it — or it does not move. The
     guard resolves the target again where it now is, as after every move. This is the one place averi scrolls a
     screen to clear the keyboard — rejected as a FIRST move (interact/keyboard.ts), kept as the last, after a
     dismissal the author configured. **Never down**: at the top of a sheet's scroll view a downward drag pulls the
     sheet itself down — the swipe that dismisses a sheet.

Every move is irreversible and none is repeated. The target not coming back after a move ends the walk at once
(`AfterDismissalTap`, naming every move so far): a screen the target has left is no screen to judge another strategy
on. Every strategy spent with the keyboard still up is today's honest refusal, extended: `AfterDismissalTap` naming
each move in order and why each later strategy was passed over.

The reply says which move left the keyboard up and which got the target clear:
`the soft keyboard covered id:lab.form-keyboard.vs; tapped text:"Transfer details", the keyboard stayed up; dragged
the target's scroll view up from (201,502) to (201,382), and the keyboard is still up but no longer over it`.

## What is never on the list, and why

- **The keyboard's own return key, whatever its label and however single-line the field.** Measured to SUBMIT the
  finportal login from the password field, the key labelled `done` (K5d,
  docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md). The label (`return`, `done`, `go`, `next`) is the app's
  `returnKeyType`, not what its `onSubmit` / `textFieldShouldReturn` does, and the tree shows neither — so no field is
  provably safe, and the rule is "never a fallback that could submit a form". (ADR 0017's "the keyboard's own UI stays
  per verb" is unchanged: no strategy touches the keyboard's own nodes; the accessory Done stays opt-in config.)
- **WebDriverAgent's `/wda/keyboard/dismiss`**: measured to fail (K5a).
- **A tap on a "blank" point** (in the first version of this decision; dropped in review round 1): WDA lists a tappable
  row (`Cell`, mapped to `container`) and an RN Pressable without an accessibility label as bare containers, so a
  point the tree calls empty may be a control — the review found an unlabelled "From account" row tapped mid-row — and
  no such tap was measured to hide a keyboard (the lab form and the Contacts sheet both kept it). Owed before a blank
  tap returns: a lab cell whose container ends editing on a tap, and a rule that tells such a container from a row.
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

1. **The drag may touch down on an unlabelled control.** Its start keeps off every node the tree names, but WDA lists a
   tappable row (`Cell`) and an unlabelled RN Pressable as bare containers. A drag that begins on one is a scroll —
   UIKit cancels the row's touch once the scroll view takes the pan — so nothing is pressed; a gesture recogniser on a
   bare wrapper that fires on touch-down is not seen (ADR 0016's residual for the picker).
2. **The drag scrolls the scroll view** toward its end when it does not hide the keyboard — that is how it lifts the
   target. The target is resolved again after it, the note says where the drag went, and a refusal after it says a
   drag may have scrolled the content.
3. **An upward drag on a sheet at a medium detent expands it** (UIKit's `prefersScrollingExpandsWhenScrolledToEdge`,
   on by default) before it scrolls. Unmeasured; the guard resolves the target on the expanded sheet, and the note
   names the drag.
4. **The post-fill dismissal has no fallback**: it has no target to anchor the drag. A fill whose dismissal leaves the
   keyboard up still throws `AfterDismissalTap`; the next step's guard, with its target, tries it.
5. **No configured move, no fallback.** Nothing configured, or nothing configured usable on this screen, is the
   refusal, not an unasked touch.
6. **iOS only under WDA**, as the guard: under idb no band is marked and no guard acts (ADR 0006).

## Supersedes

The "never a second strategy" rule of the in-tree guard (keyboard-in-tree.ts's `AfterDismissalTap` doc until
2026-10-18; ADR 0016 judged one pick per look and is otherwise unchanged — its picker is the configured strategy).
