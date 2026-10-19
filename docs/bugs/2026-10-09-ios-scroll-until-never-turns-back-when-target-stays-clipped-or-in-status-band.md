# BUG: `scroll_until` never turns back toward a target that stays at the screen's top edge (clipped, or in iOS's status-bar band) — it spends every stroke the wrong way and fails "layout defect" / `maxSwipes`; round 6's status band sends a row resting near the top into this

**Measured 2026-10-09 18:14–18:29 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (port 47843) and, on the same device, screen and positions, `dd50327` (a scratch worktree
build, port 47845). mp-native SWIFT form (`swift_payment.form.priority_select`), idb (default) and WDA (scratch `treeSource: wda`).
Positions set by slow hand drags (`idb ui swipe … --duration 2.5`). Strokes from the `idb` shim. Found by the round-6 device check
(item T-1.3).

## Observed (measured)

The form scrolls 791 pt; one 300-ms stroke (`201 699 → 201 175`) flings it end to end. `priority_select` (`354x52`) rests at y 771 with
the form at its top and at y −20 with the form at its end.

| start (row y) | build | call | reply | strokes |
|---|---|---|---|---|
| 20 | dd50327 | `scroll_until … fully: true` | `fully visible after 0 swipes` | none |
| 20 | **2f98900** | `scroll_until … fully: true` | `failed after 6 swipes (maxSwipes) — element reached the viewport but stayed CLIPPED at top, 62% of it is in the viewport (last rect … "y":-20 …)` | `201 699 201 175` ×6 |
| 20 | **2f98900** | plain `scroll_until` | `failed after 5 swipes — its centre stays under iOS's status bar at (201,5), in the top 62 pt …, and the content is exhausted: swiping down no longer moves it out from under the status bar — try direction: "up"; …` | `201 699 201 175` ×5 |
| 28 (WDA) | **2f98900** | plain `scroll_until` | `failed after 6 swipes (maxSwipes) — element reached the viewport but its centre stays under iOS's status bar at (201,4) …` | `201 699 201 175` ×6 |
| −20 | dd50327 | `fully: true` | `failed after 3 swipes — element is in the viewport but CLIPPED at top, 60% … and the content is exhausted … that is a layout defect (no clearance for an overlay?), not a scroll that needs more swipes` | ×3 |
| −20 | 2f98900 | `fully: true` | the same, `after 2 swipes` | ×2 |
| −20 | dd50327 and 2f98900 | `direction: "up", fully: true` | `failed after 6 swipes (maxSwipes) — element reached the viewport but stayed under button "Continue to summary" (24,780 354x44) … 15% of it shows (last rect … "y":772 …)` | `201 175 201 699` ×6 |

In every failing row the row was reachable: a 262-pt stroke back (`201 175 → 201 437`, the turn the same scroll takes from rest at 771,
round-5 C3-1.2) puts it at y ≈ 563, fully visible and clear. From rest (771) both builds pass (`fully visible after 2 swipes`).

## Why (read from the source at 2f98900)

- `src/interact/scroll-rounds.ts` `nextStroke` (l. 1171–1175) turns only when the target was carried PAST the frame (`carriedPast`) —
  a target that stays in the frame, clipped at the top edge or under a cover at the content's end, is stroked on in the caller's
  direction until the fast fail or `maxSwipes`. The comment above it (l. 1163–1168, "a known cost, accepted (code review P7)") says such a
  target is "carried further under or past the top edge, and only then turned back — extra strokes, never a wrong stop". At the end of the
  content it is never carried past, so it is never turned back: not extra strokes, a failure. The round-5 handoff §4 ("covers at the top of
  the screen can cost extra strokes before the scroll turns back. That is a cost, not a failure") relies on the same claim.
- Round 6 (T, `src/adapters/ios-status-band.ts`: 62 pt on 402×874) makes a row whose centre is in the top 62 pt not a stop. Before, a row
  resting at y 20 stopped at once (wrongly: a tap there hits the status bar, round-5 C3-1.3); now it is stroked away from the screen and
  never comes back. The failure's own advice (`try direction: "up"`) does not help either: from −20, `up` flings it to the other end
  (771, under CONTINUE) and also never turns.

## Why it matters

- A row parked near the top of a short form (after a `fill`, a dismissal, or a previous scroll) now fails `scroll_until` where it used to
  stop; the reply calls it a layout defect or content exhausted, and the remedy it names fails too.
- Any target that rests under a cover at either end of the content (a pinned bar at the bottom, the status band at the top) cannot be
  reached by a fling-speed stroke on iOS: the app's fling carries the whole form in one stroke.

## Possible fix directions (owner's choice)

- Turn when the last strokes stopped moving the content (content exhausted) while the target is still in the frame but clipped, banded or
  covered on the side the strokes push it toward — the same turn as `carriedPast`, with the reach halved.
- Choose the first stroke's direction from where the target lies when it is already in the frame (top part → content down), instead of the
  caller's default.
- At minimum, do not say "layout defect" / "content exhausted" when the other direction has not been tried with the target in the frame.

## Repro

1. iOS, mp-native SWIFT form (any tree source), the form scrolled with a slow drag so `priority_select` lies at y ≈ 20–30.
2. `scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }` → six `201 699 201 175` strokes, `failed … (maxSwipes) …
   CLIPPED at top` with the row at −20. At `dd50327`: `fully visible after 0 swipes`.
3. From −20, `direction: "up", fully: true` → six strokes, the row ends at 771 under CONTINUE, `failed … (maxSwipes)`.

## Device check (2026-10-09 Android, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:19 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/`, stdio via the HTTP daemon on port 47851, cwd mp-native). Strokes and taps from the
`adb` shim (`run9-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only
(`cfg-opt-bank`, `cfg-opt-contacts`, `cfg-optional`, new `cfg-fill`, `cfg-fill-bank`); mp-native's `averi.yaml` untouched.

S on Android (S-1.4's regression check plus what S does to Android's own far edges).

- **S-1.4 — Holds, no new turns:** the mp-native row under the floating tab bar scrolls in 1 stroke (`540 1617 540 949 669`, as round 6;
  pinned-chrome note), and the SWIFT Fees row in 1 (`540 589 540 766 300`). The tab-bar strokes (1.1–1.4) are unchanged in kind.
- **S works on Android for a row cut at the far edge:** `label:"Loan repayment, 17.07.2026, +602.00 EUR"` (row_0, its top under the sticky
  date header, `66,403 948x143` against the header `0,401 1080x79`), `fully: true`, default direction → `fully visible after 1 swipe`
  (20:59:09), `input swipe 540 765 540 982 300` — turned at once, half reach.
- **Does NOT turn at once for a node uiautomator reports with inverted bounds** (Settings, a row scrolled under the collapsing app bar):
  `text:"Apps"` reads `198,297 126x-114` (raw dump `bounds="[198,…][…]"` with bottom above top; also `homepage_title` `[66,66][428,44]`).
  21:12:36 plain `scroll_until { selector: 'text:"Apps"' }` → `failed after 15000ms (timeout) — element in tree but never intersected the
  1080x2220 viewport (last rect {"x":198,"y":297,"width":126,"height":-132}). It was turned round 1 time: …` — one stroke the wrong way
  (`540 1783 540 669 1116`), then two half-reach turns (`540 669 540 1226 558`) the collapsing bar absorbed. The same call at 21:09:14 needed 4
  strokes (1 wrong + 3 back); `direction: "up"` from the same position (21:12:07) → `fully visible after 1 swipe` (`540 669 540 1783 1116`).
  **New note: `2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md`.**

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**S-1.1 — Holds (fixed).** `priority_select` placed by hand at `24,25 354x52` (centre 51, in the band): 20:45:06 plain `scroll_until` →
`Element id:swift_payment.form.priority_select fully visible after 1 swipe` (3.7 s), one `idb ui swipe 201 175 201 437`, row `24,557`.

**S-1.2 — Holds.** From `24,27`, `fully: true` → `fully visible after 1 swipe; still moving at the last read (a fling not yet over, or an
animated element?) …` (one `201 175 201 437`, row `24,653`). From `24,-20`: plain → `after 1 swipe` (row `24,570`); `fully: true` → `after
1 swipe` (row `24,550`); each one `201 175 201 437`. Round 6 from 20: `maxSwipes` after 6 strokes the wrong way. WDA (`cfg-swift-wda`), row at
`24,27 354x53`: band refusal `… it lies in a scroll view — scroll_until it first …` (WDA wording), then `fully: true` → `after 1 swipe`
(`201 175 201 437`, row `24,572`).

**S-1.3 — Holds.** `direction: "up", fully: true` from `24,30` → `fully visible after 2 swipes`: `201 175 201 699` (row flung under
CONTINUE), then `201 699 201 437` (turned), row `24,186`. `direction: "up"` from the form's top (row at rest `24,771` under CONTINUE) →
`after 1 swipe`, the first stroke already the other way (`201 699 201 437`), row `24,162`. The "nor does swiping …" layout-defect sentence
was not reached: no screen found where a covered target cannot move (Account Detail's list does not scroll on iOS — see below — but its
`row_3` reads uncovered, which is the NEW tab-bar bug).

**S-1.4 no new turns — Holds.** `payee_country_select` at `24,795` under CONTINUE → `fully visible after 1 swipe` (`201 699 201 175`, the
forward way), row `24,304` — round 6's count.

**Residual observed (not a regression of S): a top cover that starts a few points below the target's top is not "over its far side".**
Contacts New Contact (idb), `add url` at `20,78 362x51` under `Toolbar 0,83 402x48` (listed last; refusal: `… under other "Toolbar" …
only a 362x5 part of it shows`). 21:02:32 plain `scroll_until` → `fully visible after 2 swipes`: `201 699 201 175` (the wrong way, the row
pushed out the top), then `201 175 201 437`. From `20,69` the same took 3 swipes (two wrong-way strokes). `overFarSide`
(`src/interact/scroll-rounds.ts:1054–1066`) asks `cover.y <= rect.y` for the top edge — 83 ≤ 78 is false — so a bar that leaves the
target's top 5 pt uncovered (the sheet's own header strip above it, not a node of idb's list) never turns the stroke. One wasted stroke,
then the S turn rescues it.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**Android — Holds (S, B2.2: no new turns).** A2.3's toggle cut at the form's TOP edge → default `scroll_until` turned at once (1 stroke
`540 589 540 1110 522`); the tab-bar row → 1 stroke; `row_1` under the sticky header → 1 stroke content down; Settings `Apps` with `direction:
"up"` → 1 stroke. A plain call started with the target clipped OUT above (B1) still strokes the wrong way 4 times (owner's default, out of
scope) — see the inverted-bounds note for its failure text.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**S-1 (re-run) and B2 — Hold.**
- S-1.1 `priority_select` at `24,30` (centre in the 62-pt band), plain `scroll_until` → `fully visible after 1 swipe; still moving …`,
  `201 175 201 437`. S-1.2 from `24,-10`, `fully: true` → `fully visible after 1 swipe`, `201 175 201 437`.
- B2.1 Contacts New Contact: `add url` at `20,80 362x51` under `Toolbar 0,83 402x48` → plain `scroll_until label:"add url"` (06:25:06)
  → `fully visible after 1 swipe`, `201 175 201 437` (content down, one stroke); from `20,86` with `fully: true` (06:25:30) → `fully
  visible after 1 swipe`, the same stroke. At 5e5a3d1: 1–2 strokes the wrong way first.
- S-1.3 (`direction: "up"`) not re-run (unchanged logic, held at 5e5a3d1).

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**B2 — Holds; one 1-pt edge differs.**
- Contacts "New Contact" sheet (toolbar `0,83 402x48`), `label:"add url"` staged at `20,80 362x51`: plain `scroll_until` → 1 stroke
  `201 175 → 201 437` (content down), stop; `fully: true` → the same, 1 stroke. Both replies end `… fully visible after 1 swipe; still
  moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match`.
- Staged at `20,82` (1 pt above the toolbar, 2 pt below it) the plain run took 2 strokes: `201 699 → 201 175` (content up, away) then
  `201 175 → 201 437` — at 82 the sliver below the bar (2 pt) outweighs the one above (1 pt). Recorded, not a regression of the 78/80 shape.
