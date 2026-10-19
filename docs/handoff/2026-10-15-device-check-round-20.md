# Handoff: on-device check of round 20 (`arch/round-20` @ `debc9b2`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 20 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 20 = `arch/round-19` (`c9ae31c`) + architecture round A of 2026-10-15: **the presented layer is the source's
fact** (ADR 0018 and 0019 amendments). It does NOT include fixes from round 19's device check — run round 19's handoff
first (or alongside) if it is not done yet; this round changes only the iOS WDA presented-screen behaviour.

- **WDA marks a presented layer** (`ui_snapshot` prints it): a layer (a Window's direct child) is
  - `"presentation": "screen"` when every node of the screen-sized layer beneath reads `isVisible="0"` and this later
    screen-sized layer has a visible node on screen (Contacts page sheet, SwiftUI half/expanded sheets, RN modal);
  - `"alert"` / `"actionSheet"` / `"popover"` when it holds an on-screen WDA `Alert` / `Sheet` / `Popover`
    (precedence in that order; the element carries `"presentationElement": true`);
  - the root carries `"presentationsJudged": true` whenever WDA reported visibility flags.
- **Beneath a marked layer** every target is refused / fails closed / stopped (`… close it first`), named by the
  topmost node of the layer at the point (a sheet row, its nav bar, `dismiss popup`), the layer `container (0,0
  402x874)` only where nothing of it draws. A typed layer is named by its element, as the alert in round 19 (`an
  action sheet is presented over it ("…")`). The layer's OWN nodes stay tappable (`PopoverDismissRegion`, alert and
  action-sheet buttons, sheet rows).
- **`scroll_until` with the target not in the tree** stops before any swipe when the touch-down lands beneath a marked
  layer, unless it lands on a scroll view of the topmost marked layer itself (a search inside the sheet keeps
  swiping); `optional: true` fails there.
- **Not changed:** Android, idb, unmarked iOS screens (Settings, Safari, the SWIFT form without a sheet). The old
  shape rule still judges trees without `presentationsJudged`.

Tool-level differential (648 trees) vs `c9ae31c`: 6 555 differing calls on 58 iOS WDA trees — 63 verdict flips, all
toward refusal (42 moved taps, 18 `scroll_until` bound → presented stop, 1 `Tapped` → refused, 1 colour PASS → fail
closed), the rest cover names and the new `ui_snapshot` fields; Android, idb, normalized trees 0; no refused → Tapped,
no FAIL → PASS. Not-in-tree `scroll_until` (probe over 59 raw WDA trees): 15 bound → stop on 12 sheet/modal trees.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- The owner logs mp-native in and confirms the backend is up; do not type credentials yourself.
- Save the raw payload next to every `ui_snapshot` you take, as in rounds 16–19: WDA
  `curl -s 'http://127.0.0.1:<port>/source?format=json'`, idb `idb ui describe-all --json --udid <udid>`. Same name as
  the snapshot. Do not commit them (bank data).
- Do not submit, continue, confirm or certify any payment form. Leave a changed form via Back → Discard. In Contacts,
  never save a new contact (Cancel → Discard Changes).

## 1. Build

1. `git checkout arch/round-20` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Results as `## Device check (<date>, re-run at <hash>)` at the end of the bug
note named in the item; items without a note go in the results table, failures into a new bug note. Commit only notes,
and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. Marks in `ui_snapshot` (iOS WDA)
1. Settings root: `ui_snapshot` → root `presentationsJudged: true`, **no** `presentation` anywhere.
2. Contacts → `+` (New Contact page sheet): one layer `"presentation": "screen"`; save raw payload.
3. SWIFT form → Fees info (half sheet) and the country sheet (half, then expanded): one `screen` layer each.
4. SWIFT form → change a field → Back → "Exit confirmation" alert: the alert's LAYER `"presentation": "alert"`, the
   Alert node `"presentationElement": true`.
5. Contacts New Contact → type a name → Cancel (discard popover): the popover layer `"presentation": "actionSheet"`.
6. Finportal (if reachable without logging in): Forgot password modal → `screen` layer.

### B. Beneath a sheet (iOS WDA)
1. Contacts New Contact sheet up: `tap id:ContactsListView` (or a list row visible in the top strip) → refused
   `… close it first; nothing was tapped`, naming a node of the sheet (not the list); no tap in the log.
2. SWIFT form with the Fees half sheet up: `tap` a form field visible above the sheet → refused naming the sheet's
   `dismiss popup` / container; colour assert on it → FAIL closed; `scroll_until` that field → stop before any swipe.
3. Same sheet: `tap` a row/button of the SHEET → `Tapped`. `scroll_until` a row of the sheet's own list (country sheet,
   e.g. `…payee_country_sheet.row_7`) → swipes and finds it (detent note may appear).
4. Country sheet up: `scroll_until text:"zzq no such row"` with the touch-down on the sheet's list → swipes (searches
   inside the sheet, then not found). Same with the sheet at half detent swiping UP (`direction: up`) → stop before any
   swipe naming the sheet's `dismiss popup` (known residual: the stroke box comes from the list beneath). Record both.
5. Same, `optional: true` → still a failure where it stopped (not skipped).

### C. Popover / action sheet (iOS WDA, Contacts)
1. Discard popover up: `tap id:PopoverDismissRegion` → `Tapped` (popover closes, sheet stays). Re-open.
2. `tap` a field of the New Contact sheet beneath → refused `… an action sheet is presented over it ("…discard…") —
   close it first`.
3. `tap role:button label:"Keep Editing"` (or the popover's cancel) → `Tapped`. Then Cancel → Discard Changes.

### D. Alert regression (iOS WDA) — round 19 A.2–A.5 unchanged
1. SWIFT exit alert: form field refused naming the alert; `Keep editing` / `Discard` `Tapped`; absent-target
   `scroll_until` stops before any swipe.

### E. Probes (owner decision: measure the unmeasured; no verdict expected, record what you see)
1. **PAY blur menu:** mp-native Account Detail → PAY menu up → `ui_snapshot` AND raw `/source`. Record whether the
   Account Detail layer reads wholly `isVisible="0"` and whether any layer is marked.
2. **Animation:** poll raw `/source` every ~50 ms (a shell loop, max ~3 s) while opening and while dismissing the Fees
   half sheet (and the Contacts page sheet). Save every payload with a timestamp. Do not tap anything during the poll
   except the one open/close action.
3. **System alert:** if the owner allows one to appear (e.g. a permission prompt in a test app, or Settings'
   confirmation **cancelled**), `ui_snapshot` + raw `/source` of the app beneath; tap a target beneath → record reply.
4. **Non-modal sheet:** any app with a sheet that leaves the screen beneath interactive (e.g. Maps' bottom card): raw
   `/source` + `ui_snapshot`; `tap` a target beneath → record (expected: no mark, judged as ordinary).

### F. Smoke (unchanged behaviour)
1. iOS Settings: tap a row → `Tapped`; `scroll_until` below the fold → swipes; colour/ocr on a visible row.
2. iOS idb (mp-native Transactions): one tap, one colour assert → as round 19 E.2.
3. Android Settings: tap, `scroll_until`, colour → as round 19 E.3.
4. SWIFT form (no sheet): tap a field → `Tapped`/as before; country row past the list's bottom → `outside its scroll
   view …`.

## 3. Out of scope / known residuals (ADR 0018 residuals 3, 4, 9, 10, 12–17; ADR 0019 residual 6)
- A presented screen in a later Window, or a layer smaller than the screen, is not marked by the flags rule.
- A later layer holding only empty frames (bare dim, no card) over a wholly hidden screen is not marked.
- Half sheet: an UP search for a target not in the tree stops on the dim (B.4).
- A hidden child of a marked layer is never named; the visible control is.
- Android/idb unchanged (shape fallback).

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1–A.6 marks in ui_snapshot | iOS WDA | | | |
| B.1–B.5 beneath a sheet | iOS WDA | | | |
| C.1–C.3 popover / action sheet | iOS WDA | | | |
| D.1 alert regression | iOS WDA | | | |
| E.1 PAY blur menu probe | iOS WDA | | | |
| E.2 animation poll | iOS WDA | | | |
| E.3 system alert probe | iOS WDA | | | |
| E.4 non-modal sheet probe | iOS WDA | | | |
| F.1–F.4 smoke | iOS WDA / idb / Android | | | |
| raw payloads saved (list) | iOS | | | |
