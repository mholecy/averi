# Handoff: on-device check of round 6 (`fix/round-6` @ `2f98900`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 6 is still being implemented, reviewed
> and fixed after its code review: do not check out, build or test anything. When it reads
> `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the title and the expected replies below are final: start.
> Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. `fix/round-6` = `arch/round-5` @ `dd50327` (round 5, already checked on
device) + the fixes for what round 5's device check found. Everything quoted as "expected" is read from the code. Where
the code does not settle something, this note says **to determine on device**: measure it and record it. Do not guess.
The expected texts below are final for this hash.

## 0. Before anything else

- The round-5 results are uncommitted edits in `docs/bugs/` (17 notes + the new Compose-button note). `git checkout
  fix/round-6` carries them over (those files are identical on both branches). Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters.
- **Never** run the mp-native `login` ladder rung or anything that registers the device. Section 3 item O-2 is checked
  only up to the refusal, never past it.
- Do not run adb server commands (`adb kill-server`, `adb start-server`, `adb -L …`).

## 1. What to test and how to build it

| item | what changed | behaviour change? | bug note |
|---|---|---|---|
| B | a Compose `Button`'s own unlabelled clickable (same x and width as the label's wrapper) is no longer a cover of its label text; a row's own content (avatar, amounts) is no longer a cover of the row's label node | **yes**: Compose text taps work again | `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md` |
| O | `optional:` skips a step only when its element is ABSENT; an element present but refused (under a cover, off screen) fails the flow, and a ladder does not escalate past it | **yes**: flow semantics | the same note, "Why it matters" + item 3 |
| T | iOS: the status bar band counts as off screen for `tap` and the `scroll_until` stop | yes | `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md` (C3-1.3) |
| H | iOS idb flat tree: top-bar chrome listed before the content (Back, title) is not covered by content listed after it that ENDS inside the bar's band (top 20 % of the screen); a menu/sheet reaching past that line still covers — replaces round 5's interim rule | yes | the same note (C3-3) |
| CR | code review of the round: the status-bar refusal names its remedy (scroll_until only inside a scroll view, else "pinned"); docs and names; no other behaviour change (sweep: 0 diffs) | wording | — |

Build, in `/Users/mholecy/dev/mobile-verify`:

1. Run `git checkout fix/round-6`.
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules, the same as rounds 3–5: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)`
at the end of the bug note named in its item; put anything new in a new bug note; commit only notes, and only if the
owner asks; leave `docs/architecture-reviews/` alone.

## 2. Regression: re-run round 5's checklist

Run `docs/handoff/2026-10-09-device-check-round-5.md` sections 2 and 3 again on this build. Expected changes against
the round-5 results:

- **C3-4.1:** the uncovered piece quoted is `948x56` (was `948x48`, the LR avatar counted as a cover).
- **C3-4.2 / 4.3:** no `PARTLY UNDER text "LR"`; `fully` stops on a fully visible row without extra strokes.
- **C3-6 Android:** every Compose button tapped by its text works (see B-1).
- **C3-3:** see H-1; **C3-1.3:** see T-1.
- Everything that held in round 5 must still hold.

## 3. Round 6 checklist

### B-1. Android: Compose buttons by their text
Note: `2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md`.

1. mp-native inactivity "Logged out" screen: `tap { platform: android, selector: 'text:"LOGIN"' }`.
   - **Expected:** `Tapped text:"LOGIN"`, the shim shows `input tap 540 1463` (the text's centre), Welcome opens.
2. Welcome: `tap text:"SIGN IN"` → `Tapped …`, `input tap 541 1869` (the centre the round-5 refusal quoted). Do not go past the PIN screen's appearance if it
   would register anything.
3. SWIFT form exit dialog: `tap text:"KEEP EDITING"`, then reopen and `tap text:"DISCARD"` → both tapped at the text's
   centre.
4. Account Detail: `tap text:"PAY"`, `text:"PAY ME"`, `text:"SCAN QR"` (close each sheet without choosing).
5. Google Contacts: the sync promo's `No thanks` and `Sync device and SIM contacts` (tap only `No thanks`), "Create
   contact" `Save` (only with nothing entered — or skip it), `Add phone`, and `scroll_until { selector:
   'text~"[Ff]ields"', fully: true }`.
   - **Expected:** each tapped at its centre; the `fields` scroll stops (`fully visible after N swipes`) instead of
     the "layout defect" failure.
6. `scroll_until { selector: 'text:"SIGN IN"' }` on Welcome → `fully visible after 0 swipes`, no stroke in the shim.
7. **Record** for every button: the wrapper's rect and the clickable's rect from `ui_snapshot` (the rule needs the
   same x and width). Any Compose button still refused → FAIL, paste both rects.

### B-2. Android: still covers (no false excuse)
- C3-4.1 (a row under the tab-bar host) is still refused or moved, naming the host.
- C3-5 (Contacts "First name" under the top app bar) behaves as in round 5.
- **To determine on device:** any screen where a real pinned button (CONTINUE/LOG IN style, labelled) lies over a
  text in the same layout — `tap` that text must still be refused. Mark Not reached if none is found.

### O-1. `optional:` still skips an absent element
A scratch config (only `app.android.package` + one flow, as in round 5's `cfg-optional`): an `optional: tap { text:
"NO SUCH BUTTON" }` followed by a harmless step.
- **Expected:** `optional: skipped text:"NO SUCH BUTTON" (not present)` and the flow goes on.

### O-2. `optional:` does not skip a present-but-refused element (never past the refusal)
The same scratch config, a screen where a tap is refused for a cover (e.g. a row whose centre is under the tab-bar
host on Account Detail, as C3-4.1): `optional: tap { selector: <that row> }` then a harmless `wait`.
- **Expected:** the flow fails at that step with a ✗ line reading
  `optional step not skipped: its element is present, but the tap was refused — <the refusal>`; the next step does not
  run.
- If the ladder's `detect` already matches after the refused rung, the call passes with
  `⚠ reach <flow>: failed — … — state reached anyway` (a probe, not an escalation). Record which one you saw.
- In a scratch ladder (two rungs, the second one harmless, e.g. a `wait` only): the refusal in rung 1 does **not**
  escalate to rung 2. **Never** use mp-native's real `login_registered` / `login` ladder for this.

### T-1. iOS: the status bar is off screen
Note: `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md` (round-5 C3-1.3).
1. Repeat C3-1.3 on idb: plain `scroll_until` to `swift_payment.form.priority_select` from the form's top, then `tap`.
   - **Expected:** the scroll does not stop with the row's centre in the status-bar band (the top **62 pt** on this
     402x874 simulator, `src/adapters/ios-status-band.ts`); it turns back; the tap never sends `idb ui tap 201 6` or
     any y < 62; the sheet opens.
   - If a tap is refused for the band, the reply reads
     `… is under iOS's status bar at (x,y), in the top 62 pt of the screen, where a tap goes to the status bar (rect …) — <remedy>; nothing was tapped`,
     the remedy being `it lies in a scroll view — scroll_until it first …` (WDA, the row in the form's scroll view) or,
     on idb's flat list (no ancestry), `if it lies in a scroll view, scroll_until it first …; if not, no scroll moves it out: it is pinned under the status bar …`.
2. The same under WDA.
3. `scroll_until … fully: true` on a short row: it still stops normally below the band (clipping is judged against the
   whole screen; only the tap point must be below 62 pt).
4. **Record:** the status bar's height on the screenshot against 62 pt.

### H-1. iOS idb: Back and the title under a scrolled row
Repeat C3-3 at the six positions (or as close as reachable: row tops ≈ 27, 66, 75, 80, 82, 90 under Back `30,70 28x28`).
- **Expected:** `tap` on BackButton (and the title) is tapped at its centre at **every** position; no `… is under …`
  refusal.
- C3-1.1 (CONTINUE over `priority_select`) is still refused, unchanged.
- New, read from the code: the SWIFT form's bank-street field and its label (`42,807 192x20` / `42,798`) under CONTINUE
  are now covers (round 5 missed them). A `tap` on them at those positions is refused or moved — not a regression.

### R-2. Regressions of round 6's flow change in mp-native's own flows (added by the device-check agent)
O changes `flow/engine.ts` for every `optional:` step, and mp-native's approved re-login flows are built of them
(`login_pin_android_here` / `login_pin_ios_here`: optional `SKIP`, optional `permission_allow_button`). Whenever a re-login
is needed during the run (inactivity logout), record the `run_flow` trace:
- **Expected:** each absent hop prints `optional: skipped … (not present)`, `branch: matched state logged_in`, `appAlive: true`,
  as at dd50327. A ✗ `optional step not skipped` there is a FAIL (paste it); stop and do not retry the flow.
- Round-5 R-1 (`2026-10-09-device-check-round-5.md` §3) is part of section 2's re-run; L-1 runs on Google Contacts, the app the
  owner named safe to wipe in round 5.

## 4. Out of scope: do not report these as regressions
- The navigation (top) bar as a cover on iOS — only the status-bar band is judged (T).
- Inside `optional:`, still skipped by design: a keyboard refusal after averi pressed `back` or tapped a dismissal
  (`AfterKeyboardDismissal`/`AfterDismissalTap`), one whose target did not resolve again, and an optional
  `scroll_until` that found its target but could not stop on it. A keyboard refusal with nothing sent and the target
  resolved twice is NOT skipped (it fails like a cover).
- iOS screen sizes other than 402x874 use Apple's published insets, unmeasured; an unknown size (e.g. iPhone Air) gets
  20 pt. A small popover listed after the content that ends inside the bar band is not seen over a bar item.
- The default `scroll_until` budget (`row_36` 15 s timeout) — its own note, a later round.
- The first OCR assert's 37 s against a 6 s timeout — unproven cause, a later round.
- Stated residuals of B: an unlabelled clickable overlay filling a small wrapper (Compose `clickable(role = Button)`,
  an unlabelled ImageButton over a thumbnail caption, an RN dismiss `Pressable` in a safe-area container under WDA) is
  excused like a Compose button.
- Everything in section 4 of the round-5 handoff.

## 5. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-5 checklist re-run | both | 2f98900 | Android Holds (round-5 Compose failures gone; C3-4.1 `948x56`, no `PARTLY UNDER "LR"`, `fully` 0 swipes; L-1 `(1 …)`/`(2 this session)`/one line). iOS Holds except a NEW round-6 regression: idb refuses the payment-type chooser's rows | Android strokes 1638/1553/765 unchanged, Fees probe, floating Gboard, R-1. iOS C3-1.1/1.2/1.4, C3-2, round-4 2.x/3.x (3.2 fired naturally, exact), P3, a5. NEW `2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md` (`row_swift is under button "Loan repayment…"`; PAY → SWIFT flows fail on idb; dd50327 tapped it) |
| B-1 Compose buttons by text (+ rects) | Android | 2f98900 | Holds for text buttons; **FAILS for icon buttons** | LOGIN `540 1463`, SIGN IN `541 1869`, KEEP EDITING, DISCARD, PAY/PAY ME/SCAN QR, Add phone, Save; `fields` after 1 swipe; SIGN IN scroll 0 swipes. Icon buttons (Contacts `Cancel`: wrapper `11,88 132x132`, button `22,99 110x110`, inset on all sides; `Show list filters`) still `… is under button …`. Sync promo Not reached. Rects in the Compose-button note |
| B-2 still covers | Android | 2f98900 | Holds; labelled pinned CTA over a text Not reached | C3-4.1 `under container (66,1840 948x248)`, C3-5 `under container (154,88 407x132)` |
| O-1 optional skips absent | Android | 2f98900 | Holds | `optional: skipped text:"NO SUCH BUTTON" (not present)`, flow done |
| O-2 optional does not skip a refusal (+ ladder) | Android | 2f98900 | Holds: the ✗ line (not "state reached anyway"); scratch ladder stops at rung 1 | `optional step not skipped: its element is present, but the tap was refused — …` (Contacts icon; mp-native row under the host) |
| T-1 status bar off screen | iOS idb + wda | 2f98900 | 1, 2, 4 Holds/Measured; **3 Fails from a row resting in the band** | plain scroll turns back, tap `201 591` opens the sheet; band refusal texts verbatim (idb and WDA remedies); status icons 24–40 pt, Back at 62. From y 20 `fully` → `maxSwipes` (dd50327: 0 swipes): NEW `2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md` |
| H-1 Back/title under a scrolled row | iOS idb | 2f98900 | Holds 9/9 (Back and title); C3-1.1 still refused | tops 72/74 (`IBAN*`), 80 (`will_remain`), 69/81 (amount) all `Tapped` at `44 84` / `201 84`. Bank-street at 807 refused naming CONTINUE; at 817 (3 pt below CONTINUE's frame) `Tapped` pressed CONTINUE: SUMMARY opened, left with Back at once, nothing confirmed. The bar's background is not a node: pinned-chrome residual |
| R-2 mp-native re-login flows under the new `optional:` | both | 2f98900 | Holds (Android ×1, iOS ×2) | `optional: skipped text:"SKIP" (not present)`, `branch: matched state logged_in`, `appAlive: true` |
