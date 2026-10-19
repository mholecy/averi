<!-- The live golden on iOS for round 7's A4 (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md):
forms k1–k3 three times and the dismissal group once, at src arch/r23-keyboard (81bccf2f's keyboard code, merged with
arch/round-23 3ec1f26c), run from truth/round-7 a615e118's harness with `--side`, 2026-10-19 05:46–06:05: the averi-lab
iPhone 17 simulator (3AB1E82E, iOS 27.0, 402x874), WDA on port 8120 from the lab's own derived data, idb through a
companion of this run's own on TCP 10883 (`idb connect localhost 10883`; the simulator's domain-socket companion,
registered before a reboot, answered every HID event with "The dtuhidd connection … has been invalidated").
Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources wda --groups forms --cases k1,k2,k3 --side <checkout> --record <file>
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --sources idb,wda --groups dismissal --side <checkout> --record <file>
Records: docs/truth/live-records/ios-keyboard-fallbacks-k-run1…3.json, ios-keyboard-fallbacks-dismissal.json (each
rejudged on this branch: 3 ok of 3, 24 ok of 24). The run before the change: docs/truth/live-ios-2026-10-18-visibility.md
("Forms": k2 and k3 LOUD on WDA). -->

# Keyboard fallbacks on WDA, 2026-10-18/19

| case | before (11683c3) | after (this src), 3 runs |
|---|---|---|
| k1 — tap `vs` under the keyboard, no dismissal configured | ok (refused, focus stays on postcode) | ok ×3, the same refusal; nothing moved |
| k2 — tap `vs`, `keyboardDismiss: [tap: { text: Transfer details }]` | LOUD: the title tapped, the keyboard stayed up, refused | ok ×3: focus on `vs`, no submit |
| k3 — fill `note` with the same dismissal | LOUD: the field untouched, refused | ok ×3: `note` holds "Thanks - ok", focus on `note`, no submit |
| dismissal group (idb 12, WDA 12) | 24 ok | 24 ok ×1 — the configured titles hide the keyboard, no fallback reached |

k2's reply, the same in every run:

    Tapped id:"lab.form-keyboard.vs" (the soft keyboard covered id:"lab.form-keyboard.vs"; tapped text:"Transfer details",
    tapped a blank point of the target's scroll view, the keyboard stayed up; dragged the target's scroll view up, and the
    keyboard is still up but no longer over it)

k3's: `Filled id:"lab.form-keyboard.note" (11 characters)` with the same note.

What happened, move by move: the navigation title has no gesture of its own, so its tap does nothing; the blank point
(201,126), just under the navigation bar, does nothing either (the form ends no editing on a tap outside a field); the
drag up from the blank point nearest the keyboard (201,502) — 120 pt for `vs` (centre 621), 278 pt for `note` (centre
843: what lifts it to 8 pt above the keyboard's top at 573) — does not hide the keyboard (SwiftUI's `ScrollView` here
keeps it on a scroll) but scrolls the form so the target lies above it, and the guard taps it there. The keyboard stays
up and the reply says so.

# Probes behind the decision (by hand, idb, from fresh launches)

- The lab's form-keyboard: the title tap, blank taps (201,124) and (300,500), five downward drags (one into the
  keyboard, two from the blank point), one upward drag, and a HID Shift / Control press — the keyboard stayed up every
  time, focus on postcode, nothing typed or submitted (2 runs each, the keys 1).
- Contacts "New Contact" (UIKit, `First name` focused): a blank tap left of "Add Photo" left the keyboard up; a 120-pt
  upward drag (30,500 → 30,380, 0.5 s) hid it, the sheet still presented — 3 of 3. No downward drag was sent there: it
  would pull the sheet down.
