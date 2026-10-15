# BUG: under idb, a submit pinned above the keyboard (SwiftUI's bottom safe-area inset) is no cover of the field it lies over — `tap` answers `Tapped` and sends a tap that SUBMITS the form; `scroll_until` calls the field "fully visible after 0 swipes"

**Found 2026-10-15** by the golden mode (scripts/differential/golden.ts) over the iOS lab app's ground truth
(`tests/fixtures/truth/ios-iphone17-ios27/form-keyboard.*`, captured by scripts/truth/capture.ts on the dedicated
`averi-lab iPhone 17` simulator, iOS 27.0, 402x874). averi = mobile-verify `truth/phase-0-1` on `dda435b`'s `src/` (no
`src/` change on the branch). Replayed only; the tap's effect is the capture's own probe on the simulator.

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

## Suspected cause (src/ui-tree/draw-order.ts — not changed here)

idb lists the screen flat (`form-keyboard.idb.json`): the form, then `Continue` `20,517 362x46` right after `phone`
`20,530 362x34`, then the keys, the keyboard's background `GenericElement 0,590 402x284`, and LAST two buttons of the
keyboard's bottom inset, `Next keyboard` `8,806 68x69` and `Dictate` `325,805 68x69`.

`bottomPinned` counts `Continue` as a bar lifted onto the keyboard only when nothing listed after it starts at or below
its bottom, the keyboard's keys left out (`keyboard.keys`). `Next keyboard` and `Dictate` are evidently not among
`keyboardOf`'s keys (they lie below the key rows, in the keyboard's bottom inset), so `Continue` is not pinned. It then
starts ABOVE `phone` (517 < 530) and is listed after it — `flatListReadingOrder`'s reading break — so it is excused
as the next container's, and nothing covers the field.

Checked by replaying edited copies of the idb list through the same harness: without `Next keyboard` and `Dictate`
the tap is refused, `under button "Continue" … nothing was tapped`; without the whole keyboard it is `Tapped` again (no
keyboard floor to pin to, and the bar is no bottom-of-screen bar). The run2-ios #250 dump the rule was measured on
evidently had no such trailing buttons. A fix is the round's to choose (count the buttons inside the keyboard's
background rect as its keys, or measure the floor from the background); the golden rows above are its check.

## Notes

- Kept in tests/differential/golden.test.ts's KNOWN list as `lab finding: …` (`form-keyboard.idb.json phone tap`,
  `… phone scroll_until`) until fixed.
- The four fields wholly under the keyboard (`vs`, `ks`, `ss`, `note`) are absent from idb's list: their `tap` times out
  "waiting for element … to appear" — the known "idb lists nothing under the keyboard" class (tools.ts says so), not
  this bug.
- Re-verified by replay at `8600176` (`arch/round-20` merged): unchanged — idb `tap` answers `Tapped
  id:"lab.form-keyboard.phone"` and sends `idb ui tap 201 547`; `scroll_until` answers `fully visible after 0 swipes`.
