# Handoff: on-device check of round 5 (`arch/round-5` @ `dd50327`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, the code-review fixes are still being made and
> verified: do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in
> the title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. `arch/round-5` = `fix/round-3` @ `86eb42d` (round 4) + round 5.
**This one run checks both rounds**: round 4's checklist (`docs/handoff/2026-10-09-device-check-round-4.md`) and the
round-5 items below. Everything quoted as "expected" was read from the code. Where the code does not settle something,
this note says **to determine on device**: measure it and record it. Do not guess.

## 0. Before anything else

- **A stray adb server.** An earlier analysis left a second adb server running (`adb -L tcp:localhost:5999 fork-server`,
  pid 44664 at the time). It can take over the emulator's connection and make it read `offline`. Check with
  `ps aux | grep 'fork-server' | grep 5999`. If it is still running, ask the owner to stop it
  (`ADB_SERVER_SOCKET=tcp:localhost:5999 adb kill-server`). Do not run other adb server commands yourself.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters. It wipes the app's data,
  including the login and device registration. Item 7 needs an app the owner names as safe to wipe.

## 1. What to test and how to build it

Round 5 is an architecture pass, each item reviewed to APPROVED, followed by a code review of the whole round.

| item | what changed | behaviour change? |
|---|---|---|
| C2 | draw order moved out of `geometry.ts` into `ui-tree/draw-order.ts`: one walk, one table of what draws nothing | no (differential: 0 diffs over 2.8M cases) |
| C3 | chrome drawn over the TARGET (a CONTINUE bar, the tab bar, a top app bar) is now judged by `tap`, `fill`'s focus tap and `scroll_until` | **yes, the main thing to check** |
| D1/D3 | the scroll stroke's container is judged in the direction the stroke actually goes; a content-down stroke is cut above a node over its would-be touch-down (short lists under the bar) | yes, strokes |
| C1 | `launch_app` and the flow `launch:` share one launch; a `launch_app { clearState: true }` is now counted and warned | yes, `launch_app` reply |
| adb | a timed-out `adb get-state` is worded as a timeout; an `unauthorized` or `offline` device gets its own message | yes, error texts |
| code review | P1: idb's flat tree gets an interim rule (C3-3); P2: `tap` and `scroll_until` pick among several matches by one rule; P3: a plain `scroll_until` stops only with the centre on screen and uncovered; P4: on idb only, a text over the target is excused as its floating label only if it repeats the target; S1: a stop short of a cover fails led by the cover | yes, see the replies below |

Build, in `/Users/mholecy/dev/mobile-verify`:

1. Run `git checkout arch/round-5`.
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules, the same as rounds 3 and 4:

- Do not push or merge.
- Write each result as `## Device check (<date>, re-run at <hash>)` at the end of the bug note named in its item.
- Put anything new in a new bug note.
- Commit only notes, and only if the owner asks.
- Leave `docs/architecture-reviews/` alone.
- Fixtures and the adb/idb PATH shims are as in the round-4 handoff.

## 2. Round 4: run its whole checklist on this build

Run every item of `docs/handoff/2026-10-09-device-check-round-4.md`, with this hash instead of `86eb42d`. Round 5 should
not change those expectations:

- the tab-bar touch-downs 1638 / 1553;
- `row_40` fails fast;
- content-up strokes go 1104→1942, uncut;
- the itemless toolbar;
- the launch give-up note;
- the `simctl listapps` measurement.

**One possible difference:** round-4 item 1.1 scrolls to `row_36` with `fully: true`. Under C3, a row that ends under
the tab-bar host is no longer "fully visible", so expect possibly one more swipe before the stop. That is not a
regression.

## 3. Round 5 checklist

### C3-1. iOS, mp-native SWIFT form, idb (the bug's own repro)
Note: `docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md`.
**Setup:** keyboard down, `iban_notice` shown, so `priority_select` sits at about `24,771 354x52`, its centre (201,797) on
CONTINUE `24,780 354x44`. Default `treeSource: idb`.

1. At rest, `tap { platform: ios, selector: "id:swift_payment.form.priority_select" }`.
   - **Expected:** refused, with the idb shim showing **no** `ui tap`:
     `id:swift_payment.form.priority_select is under button "Continue to summary" (24,780 354x44) at its centre (201,797), drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`
   - **FAIL:** `Tapped …` (the old behaviour).
2. `scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }`.
   - **Expected:** at least one swipe, then `fully visible after N swipes`, with the row's bottom above 780 in the next
     `ui_snapshot`.
3. Back at rest (scroll the form to the top), a plain `scroll_until` without `fully`, then `tap` the row.
   - **Expected:** the scroll stops only once the centre is above 780. The tap gives `Tapped …`, and
     `ui_snapshot { filter: 'id~"priority_sheet"' }` lists `priority_sheet.row_0`. Close the sheet without choosing
     anything.
4. **Moved tap, if reachable.** Find a position where the row shows ≥ 24 pt above CONTINUE but its centre is under it.
   An example from the tests: centre (201,780), 26 pt clear.
   - **Expected:** `Tapped id:… at (201,767) — its centre (201,780) is under button "Continue to summary" (24,780 354x44), drawn over it; tapped the uncovered part 354x26`,
     and the sheet opens.
   - If the position cannot be produced, mark it **Not reached**.

### C3-2. The same form under WDA
Use a scratch config with `treeSource: wda`, plus the form title as the `keyboardDismiss` tap.

1. Repeat C3-1 steps 1–3. **Expected:** the same replies.
2. **No false refusal near the scroll indicators.** With the keyboard up, tap a field, so the title-tap dismissal runs.
   Then tap the back button.
   - **Expected:** both are tapped at their centre, with no "under …" note.

### C3-3. iOS idb: Back with a row scrolled up under the top bar (interim rule, measure it)
This is the B2 residual. idb's tree is flat, so a form row scrolled up under the translucent top bar is listed AFTER
BackButton and the title, and reads as drawn over them. The owner chose an **interim rule** for idb's flat tree, and it
is **implemented in this build** (`flatListAbove` in `src/ui-tree/draw-order.ts`): a node covers the target only if its
top lies at or below the target's top. So expect Back and the title to be tapped at their centre. The rule is
unmeasured, and its stated residuals go both ways: a sheet whose top starts above the target is missed, and a short row
under a tall bar can still be falsely refused.

1. On the SWIFT form, scroll down until a row (e.g. the IBAN input) sits under the top bar (y ≈ 27 or less).
2. Run `ui_snapshot` and record the order and rects of: BackButton, the title, and the rows overlapping 0–116 pt.
   Paste them into the note. This measurement decides the permanent rule.
3. `tap { selector: <BackButton's selector> }`.
   - **Expected:** `Tapped …` at its centre, and the screen goes back.
   - **FAIL:** a `… is under … nothing was tapped` refusal, or a moved tap.
4. Repeat at 2–3 other scroll positions where a row's top lies between BackButton's top and bottom. Record which ones
   are refused. The interim rule may still refuse some of them, so these are measurements, not fails.

### C3-4. Android, Compose Account Detail (tab bar shown)
1. `tap { platform: android, selector: "id:transactions.list.row_N" }` for a row whose centre lies under the bar host
   `66,1840 948x248`. Pick N from `ui_snapshot`; if the app drops rows under the bar, use the lowest listed one that
   overlaps.
   - **Expected:** either a moved tap, `Tapped … at (…) — its centre (…) is under container (66,1840 948x248) …; tapped the uncovered part …`,
     or a refusal naming the container.
   - The adb shim must show no `input tap` with y ≥ 1840 inside x 66–1014.
2. Plain `scroll_until row_N`. **Expected:** it stops only once the row's centre is above 1840.
3. `scroll_until row_N, fully: true`. **Expected:** it does not stop while the row overlaps the host.

### C3-5. Android, Google Contacts "Create contact" (top app bar)
1. `scroll_until { selector: 'text:"First name"', direction: "up", fully: true }`. Then run `ui_snapshot`, and record
   whether the app bar's nodes come **after** the scroll view in the dump. This decides whether C3 sees the bar at all.
2. `tap { selector: 'text:"First name"' }`.
   - **Expected if the bar comes after the scroll view:** a refusal like `… only a 816x38 part of it shows, under the 65x65 …`,
     or more swipes in step 1, and no `input tap 540 198`.
   - **If the bar comes first:** the behaviour is unchanged (tap at 540,198 on the bar). Record it; it is a known limit,
     not a fail.

### C3-6. No false refusals: each must behave exactly as before
- **Contacts "New Contact" sheet, WDA:** tap Cancel; tap First name, Last name and Company; the title-tap keyboard
  dismissal (round-4 item 2).
- **A SwiftUI full-screen-toolbar screen** (the one from `2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md`):
  tap a row and the title.
- **Settings (SwiftUI list):** tap 3 cells, including one near the bottom.
- **mp-native SWIFT form:** the form-title keyboard dismissal on both tree sources.
- **FAIL:** any `… is under …` refusal or moved tap on these screens. Record the reply and the covering node.

### S-1. Strokes D1/D3 (Android)
1. The regression touch-downs are round-4 items 1.1–1.4 (section 2).
2. **D3:** on a screen whose list container starts low (top ≥ ~1530 px) and runs under the bar host, run
   `scroll_until … direction: "down"`.
   - **Expected:** the touch-down is above 1840 (e.g. `540 1782` for a list `0,1550 1080x670`), and the list moves.
   - Which screen has this is **to determine on device**. Mark it Not reached if there is none.
3. **D1** (a short nested scroller with the bar over it, plus a fling past the target) is pinned by tests and hard to
   stage. Skip it unless such a screen shows up.

### L-1. C1: `launch_app` counts its wipe (only on an owner-approved app)
1. With the owner's named safe app, `launch_app { platform: <p>, appId: <safe app>, clearState: true }`.
   - **Expected:** two lines:
     ```
     Launched <app>[/<Activity>] on <p> (state cleared)
     ⚠ clearState: app state wiped (data container deleted) — anything the app persisted, a device registration included, is gone (1 this session)
     ```
2. A second wiping launch in the same server. **Expected:** `(2 this session)`.
3. A launch without `clearState`. **Expected:** one line, with no ⚠ wipe line.
- Mark it Not reached if no app is approved.

### A-1. adb device states (only if they occur naturally; do not provoke them)
- Do not kill adb, revoke keys or force a state.
- If, during the run, `adb devices -l` ever shows a device as `unauthorized` or `offline`:
  - paste the raw line (its shape for `unauthorized` was never measured);
  - record the tool reply. **Expected** to start with `… is unauthorized: adb sees it, but the device has not accepted this computer's debugging key …`
    or `… is offline: adb sees it but cannot talk to it …`.
- A `get-state` timeout cannot be staged safely. Skip it.

### R-1. Regressions of the earlier fixes that round 5 touches (added by the device-check agent)
Round 5 also changes `interact/keyboard*.ts`, `resolve.ts`, `fill*.ts`, `ui-tree/bare-tree.ts` and `flow/launch.ts`, which
section 3 does not name. Re-run once each, as a `Holds` / `Fails` bullet in the note named:
- **iOS tap under the soft keyboard** — `2026-10-05-ios-tap-lands-on-soft-keyboard.md`: SWIFT form, amount focused, `tap` a
  row under the keyboard. Expected as at 347e70d: under WDA (scratch `keyboardDismiss`) the keyboard is hidden first, then the row
  is tapped; under idb the covered row is absent from the tree and the tap times out (`src/mcp/tools.ts:377`). Never a tap on a key.
  (Corrected after the run: the first wording expected the WDA behaviour on idb.)
- **iOS tap off screen** — `2026-10-08-ios-tap-off-screen-reported-done.md`: form at the top, `tap 'text:"Payee’s street"'`
  → `… is off screen at (…) … — scroll_until it first; nothing was tapped`, no `ui tap` in the idb shim.
- **iOS launch tree** — `2026-10-08-ios-launch-transition-tree-reads-as-rendered.md` and
  `2026-10-06-ui-snapshot-empty-right-after-launch.md`: `launch_app` the bank app (no `clearState`) then an immediate
  `ui_snapshot`: the bare ⚠ or the PIN screen, never an unannotated SpringBoard tree. The launch reply is one line (C1).
- **Android pixel assert under the IME** — `2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md`: SWIFT form,
  IBAN focused, a `color`/`ocr` assert on a field under Gboard: refused or measured after the keyboard, never the keys.
- **Android fill under the IME** — `2026-10-08-scroll-until-ignores-android-soft-keyboard.md`: `fill` `my_note_input` with
  IBAN focused; it is scrolled clear of the IME and filled (round-3 behaviour).
- **Default budget** — `2026-10-09-android-scroll-until-default-budget-too-short-at-drag-speed.md`: record round-4 item 1.1
  with the DEFAULT budget at this hash (not fixed in round 5; record, do not fail).
- **iOS launch note, empty launched tree** — `2026-10-09-ios-launch-note-blames-previous-app-when-launched-process-tree-is-empty.md`:
  record whether it recurs during round-4 item 3 (not fixed in round 5).

### Reply texts after the code review (read from the code at this hash)
- **Plain `scroll_until`, stopped with part of the element under a bar:** `visible after N swipes — PARTLY UNDER <cover>, drawn over it — NN% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too`.
  With a clip as well: `visible after N swipes — CLIPPED at bottom, NN% of it is in the viewport; PARTLY UNDER …`.
- **Stopped short of a cover at the end of the content (S1):**
  `scroll_until <sel> failed after N swipes — element is in the viewport but under <cover> at its centre (x,y), drawn over it — NN% of it shows — and the content is exhausted: swiping <dir> no longer moves it. The app draws that over it at the end of the content — a layout defect (no clearance for a pinned bar?), not a scroll that needs more swipes. Last rect …`.
  This now leads with the cover even when the element is also clipped.
- **P4 (idb only):** on the SWIFT form, a text that lies on a row and does not repeat the row's identifier or label
  (a total, a section title, a footer's text) is a cover. An outlined field's own floating label, which repeats the
  field's identifier, is not. On WDA and Android the old rule stays: a non-interactive sibling text on the target is
  part of it, whatever it says, so a React Native screen's own texts do not cover it.
- **P2:** when a selector matches several nodes (e.g. a container and a button sharing an id), `scroll_until` judges the
  same match `tap` would press.

## 4. Out of scope: do not report these as regressions
- WDA lists the text of an off-screen cell at a parked frame `0,62 …` (`2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md`).
  It has its own round later.
- The iOS idb top bar / status bar as a cover. It is not a tree node, so by the owner's decision it is not judged.
  `IBAN at y 27` still reads as visible to `scroll_until`.
- A wiping launch that throws after the wipe is not counted (a known gap, documented in `flow/launch.ts`).
- Covers at the top of the screen can cost extra strokes before the scroll turns back. That is a cost, not a failure.
- P1 (cutting the stroke box above the keyboard) and removing `drawn`/`owesDrawn` are deferred.
- A flow `tap` with `ambiguous: 'first'` after a `scroll_until` may press a different match than the one the scroll
  judged (a stated gap).
- A bare footer text in the same parent as a CONTAINER target (a list asked `fully`) is not seen as a cover on WDA or
  Android (stated residual of P4, the same as before round 5).
- Everything in section 4 of the round-4 handoff.

## 5. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-4 checklist (all items) | both | dd50327 | Holds; 1.6, 3.1, 3.2 Not reached naturally | Android: `540 1638 540 1028 611`, `540 1553 …`, row_40 fast fail after 2, `540 765 540 1857 1094` ×7, Settings `540 1736 540 484 1254`, `fills`, Fees probe 177 px, floating Gboard `keyevent 4` → tap; iOS: 2.1 title `201 100`, still up (2.2: no), 3.3 3/3 + 2/2, 3.4 0.12 s / 42 apps, P3 `201 84` → `201 707`, a5 "Kontakte" third branch. Exception: Contacts "Add fields" (C3-6 bug) |
| C3-1.1 tap at rest refused | iOS idb | dd50327 | Holds | exact text, `354x9 part`, no shim tap |
| C3-1.2 scroll_until fully clears CONTINUE | iOS idb | dd50327 | Holds | `fully visible after 2 swipes`, row `24,611` (bottom 663) |
| C3-1.3 plain scroll_until, then tap opens sheet | iOS idb | dd50327 | Fails as written (out-of-scope cause), 2/2 | 1 stroke → row `24,-20`, `visible … CLIPPED at top, 62%`; tap `201 6` hits the status bar, form scrolls to top, no sheet. The centre is clear of every tree node; idb's top bar is not one (§4) |
| C3-1.4 moved tap | iOS idb | dd50327 | Holds | `Tapped … at (201,768) … tapped the uncovered part 354x24`, sheet opened; 22 pt clear → refused |
| C3-2 same under WDA + no false refusal | iOS wda | dd50327 | Holds | same refusal text; plain `scroll_until` does not stop at −20 (2 swipes), tap `201 579` opens the sheet; fees `201 84` → `201 639`, Back `44 84` |
| C3-3 Back under scrolled row (interim rule) + tree order | iOS idb | dd50327 | Measured: 3 of 6 positions falsely refused | Back tapped with row tops 27 and 66; refused under `text "IBAN*"` at 75, 82 and the `will_remain` text at 80; title refused at 82, tapped at 90; bar opaque in the screenshot. Table in the pinned-chrome note |
| C3-4 Compose rows under the tab-bar host | Android | dd50327 | Holds (refusal names the host, no tap ≥ 1840); false `PARTLY UNDER text "LR"`, and `fully` never stops on a row label (C3-6 bug) | `… under container (66,1840 948x248) … only a 948x48 part` (56 px by the tree) |
| C3-5 Contacts top bar (dump order) | Android | dd50327 | Holds: the bar comes after the scroll view | `only a 816x33 part of it shows`, no `input tap` |
| C3-6 no false refusals | both | dd50327 | **iOS Holds; Android FAILS** | iOS: Contacts, SWIFT (WDA), Settings all at centre, Screen Time correctly refused. Android: every Compose button by its text is refused (`text:"LOGIN" is under button …`). NEW `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md` |
| S-1 D3 short list under the bar | Android | dd50327 | Not reached | no list container starts at ≥ ~1530 px (Account Detail 825/401, Transactions 66, More 121, Home 825) |
| L-1 launch_app wipe count | Android, Google Contacts (owner-approved) | dd50327 | Holds | `Launched com.google.android.contacts on android (state cleared)` + `⚠ clearState: … (1 this session)`, then `(2 this session)`; without `clearState` one line (16:26 UTC) |
| A-1 unauthorized / offline line | Android | dd50327 | Not occurred | `adb devices -l` always `device` |
| R-1 regressions (keyboard tap, off-screen, launch tree, pixel assert, fill, budget, empty tree) | both | dd50327 | Holds; budget still so; empty-tree note did not recur | WDA hides the keyboard first, idb times out (no key); off-screen refusal exact; launch one line + PIN tree; `the soft keyboard covers the element …`; `Filled … hidden before tapping`; `failed after 15000ms (timeout)` |
