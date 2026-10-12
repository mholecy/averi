# 6. idb's keyboard band is a keyboard line for every judgement (D2)

Status: accepted, 2026-10-12 (owner), including the refusal decided the same day.

## Context

idb marks no keyboard node, so averi reads its band by shape (`draw-order.ts#DrawOrder.keyboardBandTop`). idb's
keyboard reading stays `unknown`, and no guard acts on it: a blind key press there was measured to submit a form (K5d).
Before this decision only the tap's piece box and `scroll_until`'s stroke used the band. The other judgements treated
keys as ordinary covers, with these effects:

- A pixel miss named `button "Q"` and advised a scroll.
- An element in a gap between keys could pass a colour assert that measured keyboard pixels.
- A centre in the number pad's strip 589–596, between the band's top and the keys, lay under no key. It was tapped, on
  the keyboard, and it stopped a plain `scroll_until`.

## Decision

idb's band is a `KeyboardLine` with `{ source: 'idb-band', witnessed: false }`, built by the one merge,
`ui-tree/keyboard-cover.ts#keyboardEdge`. The tap, `scroll_until`'s judgement and stroke, and the pixel assert all judge
against it:

- **The tap.** A centre under the line is refused with "under the soft keyboard … hide the keyboard first". This holds
  even when a large piece of the target shows above the band (owner decision, 2026-10-12): the tap is never moved to
  that piece. That matches WDA without a configured dismissal. For a line no guard stands by, story 6 (no tap to the
  keyboard) wins over story 12 (move to the uncovered piece).
- **The plain stop.** A centre under the line is not reachable.
- **The pixel assert.** An element whose rect meets the band at all is the keyboard miss, quoting the band (ADR 0010).
- **No key named as a cover.** The keyboard's own nodes lie under no line (ADR 0007).

## Residuals accepted

- A target with a large piece above the band and its centre under it is refused, not tapped.
- An idb field with its placeholder, lying under the band, is refused.
- The band is drawn on the box judged. A stale size draws it on the stale box (ADR 0012, D4).

## Bug note

docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
