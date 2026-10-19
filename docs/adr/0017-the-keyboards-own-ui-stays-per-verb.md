# 17. What the keyboard's own UI is exempt from stays per verb

Status: accepted, 2026-10-13 (owner decision).

## Context

Where the soft keyboard lies is one module, `ui-tree/keyboard-position.ts#KeyboardPosition`: the keyboard line (a
corroborated reading's cover top and idb's band, merged) and the nodes that are the keyboard's own UI
(`KeyboardPosition.owns`: a WDA key the reading marks, `KeyboardReading.ofKeyboard`, or a node of idb's band,
`DrawOrder.ofKeyboardBand`). Gathering the position in one place showed that the verbs do not exempt the keyboard's own
UI from the same things:

- **The tap** (`interact/tap-judgement.ts`). A WDA key is exempt from the reading's own questions: `over` and
  `frameOver` read `unknown` for it. It is NOT exempt from the reading's merged line, which the chrome aim reads when the
  centre is covered. A node of idb's band is exempt from idb's band line (`KeyboardPosition.line`'s `subject`).
- **The dismissal picker** (`interact/keyboard-dismissal.ts#configuredStrategy`). It skips a WDA key first, as "the keyboard's
  own control", then asks the tap's standing with the same merged line, so a node of idb's band is exempt from the band
  line. It does not skip idb's band nodes as the keyboard's own control.
- **`scroll_until`'s read** (`interact/scroll-read.ts#judgeRead`). A node `owns` answers for — a WDA key or a node of
  idb's band — is judged against the whole screen, under no cover at all.
- **The pixel poll** (`verify/pixel-poll.ts#overElement`). The reading's `overlapping(rect, subject)` exempts a WDA key,
  and `line`'s `subject` a node of idb's band.

## Decision

Keep each verb's answer as it is. The position module offers both: `line(subject, reading)` exempts only a node of
idb's band from the band line, and `owns(node)`, the union, is asked by the scroll read alone. The module header states
the asymmetry as a residual, so a later unification is a decision and not an accident.

Unifying every verb on `owns` is a behaviour change, in cases no device has measured:

- a WDA key whose centre something covers could be moved by the tap to a piece under the keyboard;
- the picker would skip idb's band nodes as "the keyboard's own control" — unreachable in production (the picker runs
  only under WDA), but visible over idb fixtures with a synthetic band.

It would be its own change: a sweep with a diff report over the tap, the keyboard guard and the picker, and an ADR
superseding this one.

## Residuals accepted

- A WDA key a tap targets is still judged against the reading's merged line: a key whose centre is covered is not
  moved to a piece under the keyboard, as it could be under `owns`.
- The picker never skips a node of idb's band as the keyboard's own control. Unreachable today: idb's reading is
  `unknown`, so the picker never runs on an idb tree.
