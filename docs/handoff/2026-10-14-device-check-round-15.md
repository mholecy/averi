# Handoff: on-device check of round 15 (`arch/round-15` @ `7a0618f`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 15 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 15 = `arch/round-14` (`e1384aa`) + the fixes from round 14's device check (results in round 14's handoff §5)
and the owner's decisions of 2026-10-14:

- **`scroll_until` never swipes onto a presented screen (ADR 0018 amendment "No stroke onto a presented screen").**
  Before each stroke for a target in the tree that it has not judged in the viewport (below the fold, under the
  keyboard, cut), it asks where the swipe would touch down; on a modal's dim, a sheet or a popover over the target's
  screen it stops `presented` with no swipe. A failed read while holding never strokes.
- **Field errors:** a text whose identifier ends in `_error` / `.error` / `-error` is the error of the nearest textfield
  above it in its column, at most max(24 pt, the field's height) below it, with no field between. mp-native's IBAN
  message pairs with its field; Account Detail's screen-level error pairs with none.
- **WDA hidden subtrees (ADR 0019):** a WDA node that is neither visible nor accessible, is not a structural wrapper,
  and whose whole subtree is invisible roots a hidden subtree: its nodes cover no target (a presented screen's surface
  excepted). `ui_snapshot` prints `"hidden": true` on them. The phantom tab bar on the pushed SWIFT form no longer
  refuses the rows beneath it.
- **Parked cell content (ADR 0019):** content WDA parks at the sheet's origin for a below-the-fold cell is placed at
  its cell: Contacts' "add instant message" reads off screen (`scroll_until it first`), not visible at the top.

A differential harness over 233 trees (corpus + every device tree of rounds 11–14) differs from `e1384aa` only in
`scroll_until` on the 16 iOS trees with a presented screen (68,008 plays now stop with no swipe). The hidden and
parked rules were measured on the 8 raw WDA trees that carry visibility flags: no on-screen target worse. Field errors
over 258 device trees: only the IBAN pair changes.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/` (also committed on `docs/device-check-r5-r12`).
  Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- **Device-check tooling:** round 14's device agents crashed their daemon with a call without arguments. In the
  `averi-repo` scratch, make `call.sh` default its argument to `'{}'` and wrap `daemon.mjs`'s `JSON.parse` in a `try`
  that answers 400 before starting.
- **Android first (owner decision):** the Android items not run in round 14 (§2 D) go first. The owner logs mp-native
  in and confirms the backend is up before the run; do not type credentials yourself.

## 1. Build

1. `git checkout arch/round-15` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. `scroll_until` under a presented screen (iOS WDA)
Bug note `2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold`.

1. **Contacts, New Contact sheet, discard popover up:** `scroll_until text:"add instant message"` (below the fold) →
   fails `stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (…) on
   container "dismiss popup" … — a screen is presented over it … close it first …`, with **no swipe**: the popover must
   still be up afterwards.
2. **Same, keyboard up** (a field of the sheet focused before Cancel): the stop names the keyboard (`… lies below the
   keyboard's top edge …`) and still sends no swipe.
3. **mp-native SWIFT form, Fees half sheet open:** `scroll_until` to a form row below the fold (e.g. the payee city
   field) → stops with no swipe; the sheet stays at its detent.
4. **Smoke:** an ordinary `scroll_until` with no presented screen (Contacts list, the SWIFT form, Safari's local page)
   swipes and finds its target as at round 14.

### B. Field errors (iOS idb + WDA)
Bug note `2026-10-14-ios-field-error-with-its-own-identifier-is-never-paired-with-its-field`.

1. **SWIFT form, IBAN validation shown** (e.g. an invalid IBAN, then leave the field): `ui_snapshot` / a `fill` reply
   shows the IBAN field with `error` = the message, with `treeSource: idb` and WDA. No other field gets an error.
2. **Pristine SWIFT form:** no field error (as at round 14).
3. **Account Detail error screen** (if it can be reached without harm, e.g. offline): the search field has **no** error.

### C. WDA hidden subtrees and parked content (iOS WDA)
Bug notes `2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows`,
`2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible`.

1. **SWIFT form pushed over the hidden tab bar:** `tap` the row text "Standard" (or another row in the bottom 120 pt)
   → tapped, not refused under `nav.tab_*`. `ui_snapshot` shows `"hidden": true` on the `nav.tab_*` buttons.
2. **Account Detail with the tab bar shown:** a tap on a row under the visible tab bar is still refused naming the tab
   bar (the bar is not hidden there).
3. **Contacts, New Contact sheet:** `tap text:"add instant message"` (below the fold) → refused off screen `… —
   scroll_until it first`, never `Tapped`; `scroll_until text:"add instant message"` with no popover → swipes and finds
   it.
4. **Discard popover over the sheet:** a row of the Contacts list beneath is still refused (the sheet still covers).

### D. Android (not run in round 14; run first, mp-native logged in by the owner)
1. **mp-native, a row under the floating tab bar:** refused, ending `— scroll_until it first; nothing was tapped` (no
   FAB hint on a tab bar).
2. **Round 14's D7.1 and the sticky-header row** as listed in round 14's handoff.
3. **Smoke:** Clock's FAB hint as at round 14; an ordinary `scroll_until` swipes.

## 3. Out of scope

- Everything in section 3 of round 14's handoff.
- ADR 0018 residual 6: a target not yet in the tree is still stroked for; the exact-frame twin dim on the Fees sheet
  (two strokes up before the stop).
- ADR 0019 residuals: a drawn element WDA reports hidden (the Account Detail search icon); medium sheets and menus;
  carousels inside a cell (not parked by design).
- The SwiftUI blur with no node (ADR 0018 residual 9): app-side fix in mp-native.

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1–A.2 discard popover, no swipe | iOS WDA | | | |
| A.3 SWIFT Fees sheet, no swipe | iOS WDA | | | |
| A.4 scroll smoke | iOS WDA | | | |
| B.1–B.3 field errors | iOS idb + WDA | | | |
| C.1–C.2 hidden tab bar | iOS WDA | | | |
| C.3–C.4 parked content | iOS WDA | | | |
| D.1–D.3 Android | Android | | | |


## 5. Device check results

Round 15 was not run at `7a0618f`: as round 16's handoff asks, its whole checklist (§2 A–D, Android first) was run at round 16's
hash `ebe6822` on 2026-10-14. Results: round 16's handoff §5 and the `## Device check (2026-10-14 <platform>, re-run at ebe6822)`
sections of the bug notes named in §2.
