# BUG: under idb, a submit pinned above the keyboard (SwiftUI's bottom safe-area inset) is no cover of the field it lies over — `tap` answers `Tapped` and sends a tap that SUBMITS the form; `scroll_until` calls the field "fully visible after 0 swipes"

**Found 2026-10-15** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/form-keyboard.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `truth/phase-0-1` on `arch/round-20`'s
`src/` (`debc9b2`; no other `src/` change on the branch — first seen on `dda435b`'s, unchanged since). Replayed only;
the tap's effect is the capture's own probe on the simulator.

## The screen

`form-keyboard` (fixtures/apps/ios/AveriLab/Form.swift): ten fields in a scroll view, `postcode` focused on appear, the
submit `Continue` pinned in the bottom safe-area inset (`.safeAreaInset(edge: .bottom)`), so it rides on the keyboard.
The app's own frames (`form-keyboard.truth.json`): the keyboard `0,573 402x301`; `Continue` `20,516.7 362x46.3`; the
`phone` field `20,530 362x34` — its centre `(201,547)` lies under `Continue`.

## Truth

The capture's probe relaunched the cell and sent a raw `idb ui tap 201 547` at the phone field's centre. The app logged
`touch 201.0,547.0` (the tap reached the app — the positive control) and `submit invalid`: the tap pressed `Continue`
and submitted the form. The phone field never took the focus. `situationOf` measures it `covered` (centre in the pinned
bar's band); golden-spec.ts#controlRows judges a covered control whose probe fired another control: `tap` must not
answer `Tapped` and must send no tap; `scroll_until` must not answer "reached" without a swipe.

## Observed (replayed)

```
idb  tap { selector: 'id:"lab.form-keyboard.phone"' }
→ Tapped id:"lab.form-keyboard.phone"
device: idb ui describe-all --json ×2 | idb describe --json | idb ui tap 201 547          ← submits the form

idb  scroll_until { selector: 'id:"lab.form-keyboard.phone"', direction: "down" }
→ Element id:"lab.form-keyboard.phone" fully visible after 0 swipes

wda  tap { … the same … }
→ ERROR id:"lab.form-keyboard.phone" is under button "Continue" (20,516 362x47) at its centre (201,547), drawn over
  it; only a 362x1 part of it shows above the soft keyboard, under the 24x24 a tap may be moved to — scroll_until it
  first; nothing was tapped
wda  scroll_until → ERROR … failed after 3 swipes — … under button "Continue" … — a layout defect (no clearance for a
  pinned bar?) …
```

WDA judges the cell as the truth does; idb does not. On a banking form the idb answer is the worst kind: a reported
`Tapped` on a field whose tap sent the payment form.

## Expected

src/mcp/tools.ts, `tap`: "a target whose centre lies under another element of the app drawn over it (a pinned button
bar, …) is tapped on a part of it nothing is drawn over … with less showing it is REFUSED, naming the cover, nothing
tapped". ADR 0004 ("the pinned CONTINUE still covers `priority_select`") and draw-order.ts#bottomPinned ("a bar LIFTED
onto idb's keyboard … reaches the keyboard's top", measured run2-ios #250) say the same for idb's flat list.

## Cause (verified by replay at `8600176`; src/ui-tree/soft-keyboard.ts, geometry.ts, draw-order.ts — not changed here)

idb lists the screen flat (`form-keyboard.idb.json`): the form, `Continue` `20,517 362x46` (listed right after
`phone` `20,530 362x34`), then the keys, the keyboard's background `GenericElement 0,590 402x284` (ending at the
screen's bottom, 874), and LAST two buttons of the keyboard's bottom inset, `Next keyboard` and `Dictate`.

`bottomPinned` (draw-order.ts) counts `Continue` as a bar lifted onto the keyboard only when nothing listed after it
starts at or below its bottom, the keyboard's keys left out (`keyboardOf`'s `keys`: the run `flatListKeyboardBand`
returns). Here the run leaves out both trailing buttons, so `Continue` is not pinned; it then starts ABOVE `phone`
(517 < 530) and is listed after it — `flatListReadingOrder`'s reading break — so it is excused as the next
container's, and nothing covers the field.

Why the run leaves them out — a 1-pt overhang, not their place under the key rows:

- idb's raw frame of `Next keyboard` is `{8.48, 805.70}, {68.09, 68.74}`: it ends at 874.43, a fraction of a point
  past the screen. ios-node.ts rounds origin and size separately (`Math.round` of each), so the parsed rect is
  `8,806 68x69`, ending at **875** — 1 pt past the background's (and the screen's) bottom, 874. `Dictate`
  (`{325.44, 805.37}, {68.09, 68.74}`) parses to `325,805 68x69`, ending at 874: inside.
- `flatListKeyboardBand` (soft-keyboard.ts, lines 94–109) tests membership with `rectWithin` (geometry.ts, line 522),
  which has no slack, and its `to` scan (lines 104–105) stops at the first node listed after the background that is
  not inside it. `Next keyboard` is that node, so `Dictate`, inside, is dropped with it.
- Replayed: `flatListKeyboardBand` over the parsed list (pre-order, the synthetic root first, as draw-order.ts passes
  it) gives `{ top: 590, from: 16, to: 49, at: 48 }` — keys 16..48, the background at 48; `Next keyboard` (49) and
  `Dictate` (50) are outside the run; `Continue` is node 15, right before it. (The round-2 review's
  `{from 15, to 48, at 47}` is the same band counted without the root.)

Checked by replaying an edited copy of the idb list through the same harness (scratchpad, not committed): with only
`Next keyboard`'s y moved up 0.33 pt to `Dictate`'s (805.37, so it parses to `8,805 68x69`, ending at 874), the tap is
refused — `under button "Continue" (20,517 362x46, reaching 20,517 362x73) … nothing was tapped`, no tap sent — and
scroll_until stops `under button "Continue"` after 3 swipes, touching down at y 472 and 175, as WDA does.

A fix is the round's to choose; the measurement says what it needs: membership of the band with a slack
(`PIXEL_OVERLAP_SLACK`, 2 pt) or the node clamped to the screen first — that alone admits `Next keyboard`; not
stopping the `to` scan at the first outlier only keeps `Dictate` and would not fix this tree by itself. (Rounding the
frame's END rather than its size — 874.43 → 874 — would remove the overhang here, but is a parser change with a wider
reach.) The earlier suggestion, "count the buttons inside the keyboard's background rect", would still miss `Next
keyboard`: it is not inside by 1 pt. The golden rows above are the fix's check.

## Notes

- Kept in tests/differential/golden.test.ts's KNOWN list as `lab finding: …` (`form-keyboard.idb.json phone tap`,
  `… phone scroll_until`) until fixed.
- The four fields wholly under the keyboard (`vs`, `ks`, `ss`, `note`) are absent from idb's list: their `tap` times out
  "waiting for element … to appear" — the known "idb lists nothing under the keyboard" (tools.ts says so), not this
  bug. Their `scroll_until` rows are KNOWN too: two swipes touching down at y 472, above the keyboard, then "never
  appeared in the tree" — vacuous (a replayed tree cannot show whether the swipes would bring the field out), and
  pinned with those swipes, so a stroke moved under the keyboard fails the ratchet.
- Re-verified by replay at `8600176` (`arch/round-20` merged): unchanged — idb `tap` answers `Tapped
  id:"lab.form-keyboard.phone"` and sends `idb ui tap 201 547`; `scroll_until` answers `fully visible after 0 swipes`.
