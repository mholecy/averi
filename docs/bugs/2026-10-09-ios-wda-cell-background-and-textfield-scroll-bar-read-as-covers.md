# BUG: under WDA, nodes that draw nothing over a control — a grouped cell's empty background frame, a textfield's own scroll indicator — read as covers: taps refused, `scroll_until` fails

**Measured 2026-10-09 20:56–21:06 UTC**, iPhone 17 simulator iOS 27.0, `treeSource: wda` scratch configs, averi `5e5a3d1` and `2f98900`
(identical replies) — not a round-6b regression.

## Observed

1. **Settings › General › Language & Region** (`cfg-set-wda`). WDA lays each grouped row as `container LOCALE 'Region, Slovakia' 20,411
   362x54` → (`container 20,411 332x54` → `container` → `button LOCALE 'Region, Slovakia' 36,428 308x21` → `text 'Region'`, `text
   'Slovakia'`), then `container 20,411 362x54` → `container 20,411 362x54` (empty), a separator, `button 'chevron'`.
   ```
   21:04:42 tap { selector: 'text:"Region"', configPath: cfg-set-wda } → text:"Region" is under container (20,411 362x54) at its centre (63,439), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
   tap { selector: "id:LOCALE" } (2f98900)                            → id:LOCALE is under container (20,411 362x54) at its centre (190,439) … nothing was tapped
   21:05:48 scroll_until { selector: 'text:"Region"' } → failed after 6 swipes (maxSwipes) — element reached the viewport but stayed under container (20,181 362x54) at its centre (63,208), drawn over it — 0% of it shows (last rect {"x":36,"y":197,…})
   ```
   Six `idb ui swipe 201 699 201 175`. The row is plainly on screen (`img-292-0.png`). Round 6's WDA Settings check tapped `…siri` on the
   root page (a different cell shape) and passed.
2. **The SWIFT form** (`cfg-swift-wda`), mid-screen, nothing over it: `container swift_payment.form.payee_name_input 24,431 354x52` →
   `text 'Payee’s name' 42,446 103x22`, `textfield 42,447 318x20` → `container 'Horizontal scroll bar, 1 page' value '0 %' 42,454
   318x10` → `container 45,461 309x3`.
   ```
   20:57:18 tap { selector: 'text:"Payee’s name"' } → text:"Payee’s name" is under container "Horizontal scroll bar, 1 page" (42,454 318x10) at its centre (94,457), drawn over it; only a 103x1 part of it shows … nothing was tapped
   tap { selector: "id:swift_payment.form.payee_name_input" } → Tapped (idb ui tap 201 457)
   ```
   The same label below CONTINUE names the scroll bar too, not CONTINUE. idb taps the same label (`Tapped text:"Value*"`, …).

## Why (read from the source)

`NOT_DRAWN.structural.target` (`src/ui-tree/draw-order.ts:370–374`) excuses an unlabelled structural node only when it is a leaf or holds
the target whole within a screen-sized/scroll-view wrapper (`holdsWhole`, l. 222) — the cell's background `container` has one empty child
and is the cell's size, so it covers (the Compose tab-bar host rule). `scrollIndicator` (l. 809–811) excuses an indicator only under a
scroll view (`scrolls(parent)`); the textfield is not one, and the indicator is labelled, so `structural` does not excuse it either. The
textfield over its own placeholder label also covers it (`ownControl`, l. 780, needs the label inside the control; 446–468 vs 447–467).

## Why it matters

Any WDA config tapping or scrolling to a Settings-style grouped row by its text or id is refused or fails after `maxSwipes`; a field's label
tap (the natural selector for an unlabelled textfield) is refused everywhere on such forms.

## Suggested fix (owner's choice)

Excuse, for `target`, a structural node whose every descendant is an empty frame (`emptyFrame`) — it carries nothing drawable — and an
indicator-shaped container (label `/^(Horizontal|Vertical) scroll bar/` or the existing thumb shape) whatever its parent; let a textfield
that holds its placeholder's centre count as its own control.

## Repro

`treeSource: wda`; Settings › General › Language & Region; `tap text:"Region"`. Or the SWIFT form, `tap text:"Payee’s name"`.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**C2 — Holds.**
- C2.1 Settings › General › Language & Region (`cfg-set-wda`, list scrolled, `LOCALE` cell `20,183 362x54`): `tap text:"Region"` →
  `Tapped text:"Region"`, `63 210` (06:27:04), the region picker opened (closed by `tap label:"close"`, nothing chosen); `tap id:LOCALE` →
  `Tapped id:LOCALE (2 matches; picked the only interactive one (button))`, `190 210`; `scroll_until text:"Region"` → `fully visible after
  0 swipes`. At 5e5a3d1: refused under `container (20,… 362x54)` / `failed after 6 swipes`.
- C2.2 + C2.3 SWIFT form (`cfg-swift-wda`): `scroll_until text:"Payee’s name" fully` → `fully visible after 1 swipe`; `tap text:"Payee’s
  name"` (label `42,115 103x22`, its field's `Horizontal scroll bar, 1 page` beside it) → `Tapped text:"Payee’s name"`, `94 126` (the
  label's centre), the field focused (`img-128-0.png`).
- C2.4 still covers: `My note` `42,785 60x20` under CONTINUE `24,780 354x44` → `text:"My note" is under button "Continue to summary"
  (24,780 354x44) at its centre (72,795), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped` under WDA and
  idb alike (at 5e5a3d1 the WDA reply named the field's scroll bar). RN icons with an identifier: not on these screens (not reached).
- Observation: on the region picker (WDA tree ≈1,500 nodes) `tap label:"close"` took 17.5 s and 15.1 s.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**C2 — Holds.**
- C2.1 Settings › General › Language & Region (WDA): `tap text:"Region"` → Tapped `63 439` (2.4 s), `tap id:LOCALE` → `Tapped id:LOCALE
  (2 matches; picked the only interactive one (button))` at `190 439` (2.4 s). Round 7's 15–17 s per tap did not recur. Region left on
  Slovakia (picker closed with its close button each time).
- C2.3 mp-native SWIFT form (WDA): `tap label:"Payee’s name"` → Tapped `94 126` (the label at `42,116 103x20`); the field focused (WDA then
  lists `keyboard 0,573 402x301`).
- C2.4 not re-run (no RN screen reachable — see the pixel note).
