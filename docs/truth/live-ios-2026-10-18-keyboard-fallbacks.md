<!-- The live golden on iOS for round 7's A4 (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md):
forms k1–k3 three times and the dismissal group once, at src arch/r23-keyboard fd5f7001 (review round 1's fixes: no
blank-point tap, averi's drag only behind a configured move, 240 pt/s, the lift to the drag's start; runs 1–2 and the
dismissal group) and 62edb990 (the same keyboard code merged with arch/round-23 bd43fc66 — A1, A8, A9; run 3, 06:50), run from truth/round-7's
harness with `--side`, 2026-10-19 06:36–06:50: the averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0, 402x874), WDA on
port 8120 from the lab's own derived data, idb through a companion of this run's own on TCP 10883 (`idb connect
localhost 10883`; the simulator's domain-socket companion, registered before a reboot, answered every HID event with
"The dtuhidd connection … has been invalidated").
Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources wda --groups forms --cases k1,k2,k3 --side <checkout> --record <file>
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources idb,wda --groups dismissal --side <checkout> --record <file>
Records: docs/truth/live-records/ios-keyboard-fallbacks-k-run1…3.json, ios-keyboard-fallbacks-dismissal.json (each
rejudged on this branch: 3 ok of 3, 24 ok of 24). The run before the change: docs/truth/live-ios-2026-10-18-visibility.md
("Forms": k2 and k3 LOUD on WDA). -->

# Keyboard fallbacks on WDA, 2026-10-19

| case | before (11683c3) | after (fd5f7001 ×2, 62edb990 ×1) |
|---|---|---|
| k1 — tap `vs` under the keyboard, no dismissal configured | ok (refused, focus stays on postcode) | ok ×3, the same refusal; nothing moved |
| k2 — tap `vs`, `keyboardDismiss: [tap: { text: Transfer details }]` | LOUD: the title tapped, the keyboard stayed up, refused | ok ×3: focus on `vs`, no submit |
| k3 — fill `note` with the same dismissal | LOUD: the field untouched, refused | ok ×3: `note` holds "Thanks - ok", focus on `note`, no submit |
| dismissal group (idb 12, WDA 12) | 24 ok | 24 ok — the configured titles hide the keyboard, no drag reached |

k2's reply, the same in all three runs:

    Tapped id:"lab.form-keyboard.vs" (the soft keyboard covered id:"lab.form-keyboard.vs"; tapped text:"Transfer details",
    the keyboard stayed up; dragged the target's scroll view up from (201,502) to (201,367), and the keyboard is still up
    but no longer over it)

k3's: `Filled id:"lab.form-keyboard.note" (11 characters)` with the same note, the drag `from (201,502) to (201,145)`.

What happened: the navigation title has no gesture of its own, so its tap does nothing; averi then drags the form up
from the lowest point of its scroll view that nothing lies over (201,502, just above the pinned Continue bar), far
enough to bring the target's centre up to that point plus 16 pt of pan slop — 135 pt for `vs` (centre 621), 357 pt for
`note` (centre 843), at 240 pt/s. SwiftUI's `ScrollView` here keeps the keyboard on a drag, but the target rides up out
from under it and above the bar, and the guard taps it there. The keyboard stays up and the reply says so.

# On the way (records not kept in the repo)

- 2026-10-18, the first version (a blank-point tap, then a 120-pt drag over 500 ms): k2 ok 3/3 — `vs` lifted 120 pt;
  k3 ok 3/3 — a 278-pt drag over 500 ms flung `note` past the bar. The blank-point tap (201,126) did nothing every time;
  review round 1 dropped it (ADR 0022, "never on the list").
- 2026-10-19, at 240 pt/s with the lift to the keyboard's top: k3 LOUD 2/2 — the 278-pt drag moved `note` 267 pt
  (centre 576, under the keyboard at 573: the pan's slop). With 16 pt of slop added: k3 LOUD 2/2 — `note` at centre
  559, under the pinned Continue bar (516–563), refused honestly ("only a 362x10 part of it shows above the soft
  keyboard"), no submit. Hence the lift to the drag's start, above the bar.

# Probes behind the decision (by hand, idb, from fresh launches, 2026-10-18)

- The lab's form-keyboard: the title tap, blank taps (201,124) and (300,500), five downward drags (one into the
  keyboard, two from a blank point), one upward drag, and a HID Shift / Control press — the keyboard stayed up every
  time, focus on postcode, nothing typed or submitted (2 runs each, the keys 1).
- Contacts "New Contact" (UIKit, `First name` focused): a blank tap left of "Add Photo" left the keyboard up; a 120-pt
  upward drag (30,500 → 30,380, 0.5 s) hid it, the sheet still presented — 3 of 3. No downward drag was sent there: it
  would pull the sheet down.
