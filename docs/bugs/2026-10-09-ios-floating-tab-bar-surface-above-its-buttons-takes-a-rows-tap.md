# BUG: on iOS a row whose centre lies in the strip the floating tab bar draws above its buttons is "Tapped" — and the tap switches tabs

**Measured 2026-10-09 21:11–21:12 UTC**, iPhone 17 simulator iOS 27.0 (402×874 pt), mp-native Account Detail (logged in), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (idb, mp-native's own `averi.yaml`; and WDA through a scratch config) and `2f98900` (same result).

## Observed

idb lists the tab items first (`button nav.tab_home 37,755 82x64` … `nav.tab_more 283,755 82x64`), then the content;
`transactions.list.row_3 24,721 354x52` (centre (201,747)). The screenshot (`run9-ios/img-374-0.png`) shows the floating bar's pill
from ≈743 pt to ≈830 pt, x 24–378 — its surface starts ≈12 pt ABOVE its buttons' frames, over the row's lower half; no node of either
tree has that rect.

```
21:11:28 scroll_until { platform: ios, selector: "id:transactions.list.row_3" }  → Element … fully visible after 0 swipes   (0.3 s)
21:11:29 tap { platform: ios, selector: "id:transactions.list.row_3" }          → Tapped id:transactions.list.row_3          idb ui tap 201 747
```

The app switched to the **Cards** tab (`cards.detail.card_visual …`; `img-381-0.png`) — x 201 is the Cards item's column. Same at 2f98900
(`idb ui tap 201 747`, Cards opened) and under WDA (`cfg-swift-wda`: WDA lists the row and the four tab buttons, no bar; `Tapped …row_3`,
`idb ui tap 201 748`, Cards opened).

## Why (read from the source)

The bar's surface is no node; only its buttons are. `bottomPinned` (`src/ui-tree/draw-order.ts:1014–1028`) would extend a pinned bar's
reach, but asks for an interactive node whose bottom lies within `FLAT_LIST_BOTTOM_BAR_FRACTION` (52 pt) of the screen's bottom: the tab
buttons end at 819, 55 pt above 874 — not pinned, and even a pinned one reaches DOWN, not up. The round-6b M fix rightly stops rows
"covering" the tabs, but nothing stands for the pill above them. WDA: the tree carries the same four buttons only.

## Why it matters

A tap the caller aimed at a row presses another tab and averi reports success; the next step fails on the wrong screen (or, on another
app, a tab whose screen has side effects). mp-native's measured rows here are `row_3` (centre 747) and anything scrolled into 743–755.
Android's floating-tab-bar note is the same shape on the other platform.

## Suggested fix (owner's choice)

Treat a row of equal-width interactive siblings low on the screen (a tab bar: ≥3 buttons sharing y and height, spanning most of the width)
as a bar whose cover reaches above its buttons by a margin (≈ half the inter-button padding, or a measured 12 pt), and refuse/move a
target whose centre falls in it; or, cheaper, count a target as covered when its centre is within N pt above an interactive node it is
listed before/after in the bottom band.

## Repro

mp-native logged in, Account Detail at rest; `tap id:transactions.list.row_3` → `Tapped`, Cards opens.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**C1 — Holds (idb and WDA).**
- C1.1 idb 06:17:02, Account Detail, `transactions.list.row_3` `24,721 354x52` (centre 747, in the strip above the tab buttons at 755):
  `tap id:transactions.list.row_3` → `id:transactions.list.row_3 is under button "Cards" (201,755 82x64) at its centre (201,747), drawn
  over it; only a 354x21 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`. No shim tap,
  the tab did not change (at 5e5a3d1: `Tapped`, Cards opened). The reply names the tab's frame with a centre above it — known.
- C1.2 WDA (`cfg-swift-wda`) 06:18:26 → the same refusal, centre `(201,748)`, `354x21`.
- C1.3 idb: `tap id:nav.tab_transactions` → Tapped `160 787`; `tap id:nav.tab_home` → Tapped `78 787`; WDA `tap id:nav.tab_home` ×3 → Tapped.
- C1.4 the transaction-filter sheet over the bar: idb lists no tab items under it; `direction_incoming` `81,732 84x34` (centre 749, the
  strip's height band) → Tapped `123 749`. WDA lists the four `nav.tab_*` buttons BEFORE the sheet's buttons; `direction_all` → Tapped
  `50 750`, `apply_button` → Tapped `292 805`. Never moved or refused by the tab bar.
- R-5.2/R-5.3 look-alikes: the PIN pad (its last row is key `0` alone at `169,712 64x64`) typed all 4 digits in two `login_pin_ios_here`
  runs; Contacts' bottom row above the Search field + Add button → Tapped `194 664`; the contact card's text just above the four equal
  62×62 inline actions (centre 447) → Tapped `201 447`. No reply named a tab.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**C1 — Holds (idb and WDA).**
- C1.1 idb 09:50:47, Account Detail, `transactions.list.row_3` `24,721 354x52` → `id:transactions.list.row_3 is under button "Cards"
  (201,755 82x64) at its centre (201,747), drawn over it; only a 354x21 part of it shows, under the 24x24 a tap may be moved to —
  scroll_until it first; nothing was tapped`. No shim tap, tab unchanged.
- C1.2 WDA (cold start, the session's first WDA call) 09:51:50 → the same, centre `(201,748)`.
- C1.3 idb `nav.tab_transactions` → Tapped `160 787`, `nav.tab_home` → `78 787`; WDA `nav.tab_cards` → `242 787`, `nav.tab_home` → `78 787`.
- C1.4 the transaction-filter sheet over the bar: idb `direction_incoming` → Tapped `123 749`; WDA (which lists the four `nav.tab_*` before
  the sheet) `direction_all` → `50 750`, `apply_button` → `292 805`. The filter was left on "All" (the default).
- R-5.2/R-5.3 look-alikes: the PIN pad typed all 4 digits in both `login_pin_ios_here` runs (4 shim taps each, none refused or moved);
  Contacts' bottom row above Search + Add → Tapped `194 664`; the card text above the four inline actions → Tapped `201 447`; Settings'
  `standBy` row above the bottom Search field → Tapped `201 735`, and `screenTime` (only 12 pt above the field) refused naming
  `textfield "Search"`. No reply named a tab.
