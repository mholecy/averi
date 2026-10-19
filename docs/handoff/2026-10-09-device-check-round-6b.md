# Handoff: on-device check of round 6b (`fix/round-6b` @ `5e5a3d1`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 6b is still being implemented, reviewed
> and fixed after its code review: do not check out, build or test anything. When it reads
> `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the title and the expected replies below are final: start.
> Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. Round 6b = branch `fix/round-6b` = `fix/round-6` @ `2f98900` (round 6, checked on device) + the fixes
for what round 6's device check and its final code review found. The checklist and the expected replies are filled in
before the STATUS flips; the expected texts are re-checked against the final code before then.

## 0. Before anything else

- The round-5 and round-6 results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. What is coming (being implemented and reviewed)

| item | what changes | bug note |
|---|---|---|
| I | Android Compose ICON buttons (Cancel, More options, Delete, …): the clickable inset on all four sides by the touch-target padding is the label's own control, no longer a cover | `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md` |
| M | iOS idb: a modal listed BEFORE the content behind it (the PAY payment-type chooser, the value-date picker) is no longer read as covered by that content — the "reading-order break" | `2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md` |
| P | iOS idb: a pinned bottom control (CONTINUE) covers down to the screen's bottom — a label just below its frame is no longer "tapped" onto CONTINUE | `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md` (H-1) |
| S | `scroll_until` turns back toward a target resting at the screen's top edge (clipped, or in iOS's status band) instead of spending every stroke the wrong way | `2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md` |
| F | `optional:` no longer skips a `fill` whose text did not land, or one refused for a control character — it fails the flow like a refused tap | the Compose-button note, "Why it matters" |

## 2. Build

1. Run `git checkout fix/round-6b` (the docs/bugs edits carry over; the files are identical on both branches).
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as in rounds 3–6: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)` at the end
of the bug note named in its item; anything new goes into a new bug note; commit only notes, and only if the owner asks;
leave `docs/architecture-reviews/` alone.

## 3. Regression: re-run round 6's checklist

Run `docs/handoff/2026-10-09-device-check-round-6.md` sections 2 and 3 again. Expected changes against the round-6 results:

- **B-1 icon buttons:** Contacts' Cancel, More options, Delete (and Dismiss / Go back if they appear) are now tapped at the
  label's centre (I-1 below).
- **Round-5 re-run on iOS idb:** the PAY → SWIFT / own-transfer chooser rows and the value-date picker are tapped (M-1).
- **T-1.3:** a row resting at y ≈ 20 now turns back after one stroke and stops (S-1), instead of `maxSwipes`.
- **H-1:** the bank-street label just below CONTINUE is refused or moved, never "Tapped" onto CONTINUE (P-1).
- **O-2:** round 6 used `Show list filters` (a padded icon checkbox) as its refused element; round 6b excuses that shape.
  Use the mp-native row under the tab-bar host on Account Detail instead (C3-4.1's row).
- Everything else that held in round 6 must still hold.

## 4. Round 6b checklist

### I-1. Android: Compose icon buttons by their label
Note: `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md`.
1. Google Contacts "Create contact": `tap { platform: android, selector: 'label:"More options"' }` → `Tapped …` at the
   label's centre; the menu opens (close it). Then `label:"Cancel"` on a staged contact with nothing entered (or skip it
   if it would discard data the owner cares about).
2. Any screen with Dismiss / Go back icons: tap by label → tapped at the centre.
3. **Record** for each icon: the wrapper's rect, the clickable's rect and the label's rect from `ui_snapshot`. The rule
   needs the four insets within 1 px of each other.
4. **Still covers:** a labelled pinned CTA over a text (B-2) is still refused. An icon cut by the list's edge (uneven
   insets) is still refused — expected, a stated residual.

### M-1. iOS idb: a modal listed before the content
Note: `2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md`.
1. mp-native Account Detail → PAY → the payment-type chooser: `tap id:"…row_own"` and `id:"…row_swift"` → tapped at their
   centres, the right form opens (back out without submitting anything).
2. The value-date picker on the SWIFT form: tap a row → tapped.
3. CONTINUE over `priority_select` (C3-1.1) is still refused.
4. **Keyboard on idb:** with the number pad up on the SWIFT form (round-5 run2 #250 shape: CONTINUE lifted above the
   keys), `tap` a row partly under the keys → refused or moved, never a key press (no digit typed into the field).
   Record what the reply names as the cover.
5. Account Detail's floating tab bar: tap a tab item while list rows are scrolled under it → tapped (rows no longer
   "cover" the floating bar).

### P-1. iOS idb: CONTINUE covers down to the screen's bottom
Note: `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md`.
1. Scroll the SWIFT form so a field's label sits between CONTINUE's bottom (824) and the screen's bottom (874).
2. `tap` that label → refused (`… is under button "Continue to summary" …`) or moved to a visible part — **never**
   `Tapped` with SUMMARY opening. The reply may quote CONTINUE's frame `(24,780 354x44)` with a centre below it — known.
3. **Record** (the lifted-bar rule is inferred, not measured): with the keyboard up, tap the empty strip between the
   lifted CONTINUE and the keys; does it press CONTINUE?

### S-1. `scroll_until` turns back toward a target at the far edge
Note: `2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md`.
1. iOS idb, the SWIFT form: get `priority_select` to rest at y ≈ 20 (its centre in the 62 pt status band), then plain
   `scroll_until` with the default direction → one stroke back (shim: about `201 175 201 437`), then a stop. Not
   `maxSwipes`.
2. The same from y ≈ −20, and with `fully: true`.
3. `direction: "up"` from the top so the row ends under CONTINUE → it turns back and stops; on a real layout defect
   (the content cannot move it out) the failure says the other direction was tried too (`…, nor does swiping <the other way>`).
4. **No new turns** (regression): Android Account Detail rows under the floating tab bar and the SWIFT rows at 785/790
   under CONTINUE scroll in as many strokes as in round 6 (1 stroke).

### F-1. `optional:` and fills
Scratch config only (as round 5's `cfg-optional`), never mp-native's real login ladder.
1. An `optional: fill` into a field whose text cannot land (e.g. a field that transforms or limits input) → the flow fails
   with `optional step not skipped: its field is present, but its value did not land — …`.
2. An `optional: fill` with a control character in its value → `optional step not skipped: averi refused its value before
   anything was typed — …`.
3. An `optional: fill` on an absent field → `optional: skipped step (not present)`, the flow goes on.
4. An `optional: type:` with a control character → still skipped.

### R-3. Regressions of round 6b's changes in mp-native's own flows and elsewhere (added by the device-check agent)
mp-native's `averi.yaml` has no `optional: fill` (F does not touch it), but every `optional:` there is a tap, and I/M/P/S
change what counts as a cover and which way `scroll_until` goes.
1. `back_to_tab_host` (its `optional: tap id:common.top_bar.back`) from a pushed screen (SWIFT form after DISCARD-safe
   back-out, or Settings → a sub-screen) on both platforms: the back tap lands, the tab bar returns. On a tab root the
   optional step is skipped. Look at the screen first; no `requires:` chain.
2. `login_pin_*_here` after an inactivity logout (as R-2): the optional LOGIN / SIGN IN / SKIP / permission hops still
   behave as in round 6.
3. iOS under WDA (not idb): an unlabelled centred button over a text stays a cover (P2: `paddedTouchTargets` is set only
   by the Android parser) — e.g. Contacts/Settings controls; record any WDA tap that changed against round 6.
4. Android `scroll_until` with `direction: "up"` toward a row under the top app bar, and a plain scroll to a row far
   below: the stroke count matches round 6; no early turn-back.
5. iOS Settings / Contacts (non-bank apps, idb): a sheet or alert listed before the content (e.g. Contacts' "New Contact"
   sheet, a Settings action sheet) — taps on its rows land; a row of the content behind the sheet is still refused.

## 5. Out of scope: do not report these as regressions
- Residuals of I: an unlabelled clickable laid with an even margin over a centred text (FAB over a caption, play button
  over a title) is excused like an icon button; an icon cut by the list's edge is refused.
- Residuals of M: a menu listed last that starts above a content target is not seen; keys listed without a keyboard
  background node count as content; the last list row near the bottom may be read as pinned.
- The navigation bar's area is not off screen (owner: not now).
- Inside `optional:`: a fill's failed read-back (a dead device or adb error during it) fails the flow; a device error
  while typing is still skipped (a stated gap).
- Everything in section 4 of the round-6 handoff.

## 6. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-6 checklist re-run | both | 5e5a3d1 | **Holds** on both. Android: B-1 text buttons, B-2, O-1, O-2 (mp-native row + ladder), R-2, C3-4/5/6, round-4 1.1/1.3/1.4, R-1, L-1; 1.2 not reproduced (bar stayed hidden). iOS: C3-1.1 idb+WDA, T-1 band refusals, H-1 5/5, C3-6 Settings, R-1, off-screen, a3 3/3+3/3, R-2 ×4; a5 not re-run (no launch code changed); 3.2 did not fire | Android: LOGIN `540 1463`, SIGN IN `541 1869`, C3-4.1 `948x47` refused, C3-5 `816x53` refused; filter-panel probe now 48 px (was 177), reply correct. iOS: per-note sections |
| I-1 Compose icon buttons (+ rects) | Android | 5e5a3d1 | **Holds**; I-1.4 not reached | More options `1003 154`, Delete `1014 1632`, Cancel `77 154`, Show list filters `970 330`, View labels `838 330`; wrapper 132x132, label 66x66, control 110x110, insets 11/11/11/11 each |
| M-1 idb modal, keyboard, tab bar | iOS idb | 5e5a3d1 | **Holds**; residual: the refusal's "354x7 part shows" lies inside the keyboard band. NEW: a row whose centre is in the strip above the tab buttons presses a tab | `row_own` `201 423`, `row_swift` `201 479`, `goto_swift_payment_form` ×4; picker `fully … 0 swipes`, tap closes it unchanged; C3-1.1 still refused; keyboard: covered rows absent, partial row refused naming the lifted CONTINUE, no key press; tab items tapped |
| P-1 CONTINUE reach (+ lifted-bar record) | iOS idb | 5e5a3d1 | **Holds**; record: a hand tap in the strip between the lifted CONTINUE and the keys pressed CONTINUE (SUMMARY opened, left at once with Back, nothing confirmed) — the inferred reach is right | label at 825–845 refused naming `Continue to summary`; no SUMMARY from any averi tap |
| S-1 turn back at the far edge | iOS idb (+ Android regression) | 5e5a3d1 | **Holds** on iOS (idb + WDA) and no new turns on Android. Residual: a top bar starting a few pt below the target's top (Contacts toolbar, 5 pt) costs 1–2 wrong strokes; the "nor does swiping …" sentence not reached | iOS y 25/27/−20 → 1 stroke `201 175 201 437` then stop, plain and `fully`; `up` turns; 785/795 rows 1 forward stroke. Android tab-bar row 1 stroke, Fees 1 stroke, a cut row turns at once |
| F-1 optional fills | Android or iOS | 5e5a3d1 | F-1.2/1.3/1.4 **Hold** (both). **F-1.1 not met:** a field that drops every character reads "exposes no value" (unverifiable), so the flow passes — NEW note; on iOS 1 not reachable | `averi refused its value before anything was typed — cannot type U+0009 …`; `optional: skipped step (not present)`; Android amount `abc` → `⚠ … NOT verified: the matched node exposes no value`, flow done |
| R-3 mp-native flows, WDA, Android scroll, non-bank sheets | both | 5e5a3d1 | R-3.1 Android holds; **iOS fails from the SWIFT form — mp-native, not averi** (the iOS payment screens' back id is `BackButton`, not `common.top_bar.back`); R-3.2 holds (Android ×2, iOS ×4); R-3.3 shape not found, two other WDA false covers (NEW); R-3.4 holds; R-3.5 holds | `back_to_tab_host` Android `77 154`; iOS `optional: skipped id:"common.top_bar.back" (not present)` → `wait … Timed out after 15000ms` |

New bug notes from this check (8): Android — `2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md`,
`2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md`,
`2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md`,
`2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md`; iOS —
`2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md`,
`2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md`,
`2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md`, `2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md`.
The iOS tab-bar, WDA-cover and hold-still bugs reproduce at `2f98900` too (not round-6b regressions).
