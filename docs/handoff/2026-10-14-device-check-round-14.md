# Handoff: on-device check of round 14 (`arch/round-14` @ `e1384aa`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 14 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 14 = `arch/round-13` (`d407256`) + the fixes from round 13's device check (results in round 13's handoff §5)
and the owner's decisions of 2026-10-14:

- **ADR 0018 amended (Q5 a):** a structural leaf that fills the screen on a presented layer is a presented screen,
  labelled or not — UIKit's `PopoverDismissRegion` ("dismiss popup") over the SWIFT Fees half sheet and over Contacts'
  discard popover. A tap beneath says *close it first*; `scroll_until` stops **without swiping** (it used to move the
  sheet to another detent / close the popover). Tap verdicts are unchanged — only the remedy and the stop.
- **Field errors (Q8 a):** a same-identifier text that overlaps a same-identifier field is that field's title, never
  an error. mp-native's SWIFT form (every field and its floating title share `TextFieldWithComponentStyle`) no longer
  reports each field's error as the next field's title.
- **Wording:**
  - the colour/ocr assert on an element under a presented screen says *close it first* (also under the status bar,
    in place of the bar's own advice);
  - a tap refused under a wrapper that only positions one small control (Android's FAB host, Q9) names that control:
    tap it when it is the target, otherwise scroll the element out of the wrapper's band.
- **ADR 0018 residual 9 (Q7 a):** an in-window overlay with no accessibility node (mp-native's SwiftUI PAY menu over a
  blurred Account Detail) is not seen; the fix is app-side in mp-native (`.accessibilityAddTraits(.isModal)` or a
  labelled backdrop element). Nothing to check here.

A differential harness over 213 trees (corpus + every device tree of rounds 11–13) differs from `d407256` only as
intended: tap/scroll remedies and stops on the three trees with a labelled dim, the pixel remedy on the ten presented
trees, the FAB hint on Clock's trees, and 1028 false field errors gone with none gained. No tap or pixel verdict changed.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/` (also committed on `docs/device-check-r5-r12`).
  Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. Build

1. `git checkout arch/round-14` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. Presented screens with a labelled dim (iOS WDA), ADR 0018 amendment
Bug note `2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet`.

1. **mp-native SWIFT form, Fees half sheet open:**
   - `tap id:swift_payment.form.debit_select` → **refused**
     `… is under container "dismiss popup" (-402,-874 1206x2622) … — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`.
   - `scroll_until id:swift_payment.form.debit_select` → fails `stopped before any swipe — element is in the viewport
     but under container "dismiss popup" …` with **no swipe**: the sheet must still be at its half detent afterwards.
   - a tap on a row of the sheet itself → tapped.
2. **Contacts, New Contact sheet, discard popover up** (Cancel on an edited contact):
   - a tap on a field of the sheet beneath (e.g. "add instant message") → refused under `container "dismiss popup"
     (0,0 402x874)` with the presented sentence.
   - `scroll_until` to that field → fails with no swipe; **the popover must still be up**.
3. **Same popover or sheet:** `assert_color` (or an ocr assert) on an element beneath → fails closed ending
   `a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen`
   — never "scroll_until the element with `fully: true` first", also when the element reaches under the status bar.
4. **Smoke, as at round 13:** the Finportal forgot-password modal and the Contacts sheet refuse and stop as before;
   Safari's local page taps through `CapsuleViewController`; Finportal login with no modal taps as before.

### B. Field errors (iOS, idb and WDA)
Bug note `2026-10-14-ios-field-errors-pair-a-shared-component-id-with-the-next-fields-title`.

1. **mp-native SWIFT form, fields empty, no validation shown:** `ui_snapshot` / a `fill` reply reports **no** field
   error on any field (before: each field had the next field's title, `IBAN*`, `BIC*`, …), with both `treeSource: idb`
   and WDA.
2. **Same form, a real validation message shown** (e.g. submit with a required field empty, if the form shows one):
   the message is paired with its field.

### C. Wording (Android)
Bug note `2026-10-13-android-fab-host-layer-refuses-taps-beside-the-fab`.

1. **Clock, alarm list with the FAB:** a tap on a row's control beside or under the FAB → still refused naming
   `container id:fab_container`, now ending
   `— the wrapper may only position its one child, button "Add alarm" (…): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`.
2. **mp-native, a row under the floating tab bar:** refused as before, ending `— scroll_until it first; nothing was
   tapped` (no FAB hint on a tab bar).

### D. Captures for round 15 (no fix yet; owner decision Q6)
Q6 (a) — a WDA subtree that is wholly hidden (`isVisible=0` and `isAccessible=0`) is no cover, and a guard never
excuses an ADR 0018 surface — needs the raw trees first.

1. **iOS WDA, raw `/source?format=json`** (the WDA HTTP endpoint, not `ui_snapshot`) of:
   - the SWIFT form pushed over the tab bar (bug note `2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows`);
   - the Finportal forgot-password modal;
   - the Contacts New Contact sheet (and, if easy, the discard popover).
2. For each, record `isVisible` / `isAccessible` (or `visible` / `accessible`) of: every `nav.tab_*` button and its
   tab-bar host; the modal's and the sheet's dimming leaves (`forgot_overlay`, `PopoverDismissRegion`, the sheet's
   unlabelled dim). Save the JSON files next to the run's other trees and quote the attributes in the bug note.

## 3. Out of scope

- Everything in section 3 of round 13's handoff.
- ADR 0018 residual 9 (an overlay with no node, e.g. mp-native's PAY menu over a blur): unchanged; the fix is in
  mp-native.
- Q6 (hidden WDA subtrees): round 15, after the captures in D.

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 SWIFT Fees sheet | iOS WDA | | | |
| A.2 Contacts discard popover | iOS WDA | | | |
| A.3 pixel presented remedy | iOS WDA | | | |
| A.4 smoke | iOS WDA | | | |
| B.1–B.2 SWIFT field errors | iOS idb + WDA | | | |
| C.1 FAB hint | Android | | | |
| C.2 tab bar, no hint | Android | | | |
| D WDA /source captures | iOS WDA | | | |


## 5. Device check results (2026-10-14, at `e1384aa`)
Run by the device-check agents (Android 06:54–07:00, iOS 06:55–07:16 UTC, 2026-10-14) at `e1384aa`, built from `arch/round-14`. Per-note results are appended to each bug note as `## Device check (2026-10-14 <platform>, re-run at e1384aa)`. Summary: C.1, A.1, A.3, A.4, B.1 hold; A.2 holds for a field in the viewport but a target below the fold is still swiped under the popover (new note); B.2 fails — a message with its own `<field>_error` id is never paired (new note); D captured (`isVisible`/`isAccessible` come as strings, tab buttons `"0"/"0"` but their images `isAccessible "1"`, the tab-bar host `isVisible "0"` in both states). C.2, D7.1 and the sticky-header row were not reached: mp-native on Android was logged in with "Mandatory data not loaded" and then showed its inactivity "Logged out / LOGIN" screen; the LOGIN tap was blocked by the permission classifier, so no PIN re-login was done there.
New bug notes: `2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md`, `2026-10-14-ios-field-error-with-its-own-identifier-is-never-paired-with-its-field.md`.

### Android: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| C.1 FAB hint | Android emulator-5554 (API 33) | e1384aa | **holds** — chevron, digits, switch and "Sun, Sat" beside/under the FAB refused naming `container id:fab_container (0,1582 1080x352)`, each reply ending `— the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first; nothing was tapped`; no shim tap; alarms OFF at the end | #11, #13, #14, #15, `img-10-0.png`, `snapC2.txt`, `r14-clock.xml`, `adb-input.log` |
| C.2 tab bar, no hint | Android (mp-native) | e1384aa | **not reached** — mp-native was on its inactivity "Logged out / LOGIN" screen (no tab bar, nothing under one); the one `tap text:"LOGIN"` to reach the PIN prompt was denied by the session's permission classifier, so no PIN re-login | `img-32-0.png`, `snapM1.txt` |
| R-added: D7.1 nav-bar refusal on a row | Android (mp-native) | e1384aa | **not reached** — same (logged out; backend state unknown: the first screenshot at 06:55 still showed "Mandatory data not loaded / An unknown error occurred. / TRY AGAIN") | `img-4-0.png` |
| R-added: `row_0` under sticky header `cutBounds` | Android (mp-native) | e1384aa | **not reached** — same | `img-4-0.png`, `img-32-0.png` |
| R-added: tap off screen | Android emulator-5554 (Settings) | e1384aa | **holds** — `text:"Sound & vibration"` (clipped out above) → `Timed out after 5000ms waiting for element text:"Sound & vibration" to appear` / `(it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)`; identical to round 13 #17 | #28, `snapS1.txt` |
| R-added: one `assert_color` | Android emulator-5554 (Settings) | e1384aa | **holds** — `PASS  element text:"Accessibility" fill within dE00 8 of #F0F0F3 — sampled #F0F0F3 (dominant, 73% of region) vs expected #F0F0F3 → dE00 0.00 ≤ 8; scale 1.000` (4.4 s) | #29 |
| R-added: `tap id:title` ambiguity | Android emulator-5554 (Settings) | e1384aa | **holds** — `Selector matches 8 elements: id:title` + Wallpaper & style, Accessibility, Security, Privacy, Location + `…and 3 more` + `Narrow it (add role:, id: or an exact text:) so exactly one element matches`; same as round 13 #15; no shim tap | #26 |
| R-added (extra): cut-at-edge row | Android emulator-5554 (Settings) | e1384aa | **holds** — `text:"Digital Wellbeing & parental controls" is cut at its scroll container's bottom edge (container 0,297 1080x1857), as is the 154,2099 926x55 it lies in; only a 816x11 part of it shows, 11 deep across that edge, under the 65 a tap needs — scroll_until it first (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates); nothing was tapped`; no shim tap | #30 |

## NEW


None. No new averi bug found at this hash on Android.

### Android: Gaps and observations

- **C.2 and the mp-native items not reached.** Timeline: at 06:55 mp-native was in front, logged in, on "Mandatory data not loaded / An
  unknown error occurred. / TRY AGAIN" (`img-4-0.png`, floating tab bar showing — the backend outage of rounds 12–13 apparently still on).
  I went to Clock and Settings (06:55–06:58); when mp-native was brought back (#31 `launch_app`, no clearState) it showed the inactivity
  screen "Logged out — Due to your inactivity you have been logged out for security reasons. You can now log in again. — LOGIN"
  (`img-32-0.png`, `snapM1.txt`: no `nav.tab_*`, no tab bar). This is the registered-device logout (not Welcome/SIGN IN), so the PIN rung
  would have been allowed after a screenshot of the PIN screen, but the single `tap text:"LOGIN"` needed to reach that screen was denied
  by the permission classifier and I did not work around it. Running C.2 needs the owner to allow that tap (or to log mp-native in by
  hand), and the backend to be checked first (TRY AGAIN). Lesson for the next run: do the mp-native items **first**, before switching away
  — an Android background trip of ~3 min was enough to trigger the inactivity logout.
- **Selector slip (#12), not a bug:** Clock's digits label is `9:00 AM` (U+200A hair space); an exact `label:"9:00 AM"` with a plain
  space times out as "waiting … to appear" with no hint that a near-identical label exists. Not judged (exact match is documented); noted
  only as an ergonomics point.
- **One unintended tap went through (#16):** I tapped `id:workflow_label` expecting it under the FAB as in round 12, but the expanded 8:30
  card now has an extra `Pause alarm` row, so it lay at `88,1247 904x132`, wholly above the host — averi correctly `Tapped id:workflow_label`
  (shim `06:57:10 … input tap 540 1313`) and Google's "Make your alarm smarter with Google Assistant Routines" intro opened
  (`img-17-0.png`, `com.google.android.googlequicksearchbox/…SettingsActivity`). Nothing was chosen on it ("Maybe later" / "Set up Routine"
  not touched). #18 `press_key back` (shim `06:57:26 keyevent 4`) did not leave it (`img-20-0.png`); #21 `launch_app` Clock brought Clock
  back. Alarm settings unchanged (both `checked="false"`). Correct verdict by averi — my target choice.
- **Daemon fragility (harness, not averi):** `call.sh` with one argument sends invalid JSON and `daemon.mjs` has no try/catch around
  `JSON.parse`, so a bare `$R/c __list` kills the daemon. Always pass `'{}'`.
- The FAB-hint replies keep round 13's quantities, including `nothing of it shows` for the switch (#13) and "Sun, Sat" (#15), both wholly
  visible in `img-10-0.png` — the wording now tells the agent why (a wrapper that only positions the FAB), which addresses round 13's remark.
- Timings unchanged from round 13 (refusals 5.4–5.9 s, the 5 s wait budget; colour PASS 4.4 s).
- The iOS simulator, idb, WDA, Metro and port 47903 were not touched.

### Android: End state

At 06:59:48 UTC: mp-native (`com.finshape.skeleton.dev`) in front (`topResumedActivity … MainActivity`), on its inactivity **"Logged out /
LOGIN"** screen — still registered (not Welcome/SIGN IN), not logged in; no PIN entered, nothing tapped in it this round. Keyboard down
(`mInputShown=false`), gesture navigation (`navigation_mode` 2). Clock: both alarms OFF (`checked="false"` in `r14-clock.xml`), 8:30 card
collapsed again, in the background; the Google Assistant Routines intro activity may remain lower in Clock's task (t224), untouched.
Settings: launched on its existing scrolled position and only read/refused — nothing changed. Files on `/sdcard`: none (`/sdcard/r14-clock.xml`
deleted after the pull; round 13's `r13-*.xml` were already gone — `ls /sdcard/r1*.xml` finds nothing). Daemon on 47901 left running
(restarted at 06:55:08). No averi source, `averi.yaml`, handoff or bug note edited; no git command beyond `git rev-parse`.

### iOS: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 SWIFT Fees sheet | iOS WDA, iPhone 17 iOS 27.0 | `e1384aa` | **holds** | `debit_select` refused `under container "dismiss popup" (-402,-874 1206x2622) … a screen is presented over it … close it first; …; nothing was tapped` (#89); `scroll_until` `stopped before any swipe … so none was sent` (#90), shim 47→47, grabber `Half screen` y 411, `img-92-0.png`; `fees_sheet.row_0` → `Tapped` (#101, l.50), OUR kept (#102). **But** a target wholly below the fold swiped the sheet to `Expanded` (#98, l.48–49), NEW note |
| A.2 Contacts discard popover | iOS WDA | `e1384aa` | **holds** for a sheet field in the viewport; **fails** for "add instant message" (below the fold here) | `Insert add phone` refused `under container "dismiss popup" (0,0 402x874) … close it first` (#24); `scroll_until` no swipe, popover up (#26, `img-28-0.png`); `scroll_until` "add instant message" → `fully visible after 1 swipe` (#35, l.9), popover gone (`img-36-0.png`), NEW note; Discard Changes (#39), nothing saved |
| A.3 pixel presented remedy | iOS WDA | `e1384aa` | **holds** | popover: colour (#29), status-bar grabber colour (#31) and ocr (#32, names the status bar, then the presented remedy); Contacts sheet colour (#20); SWIFT sheet colour (#93) and ocr (#94); Finportal modal colour (#9). All end `a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen`; no `fully: true` advice anywhere |
| A.4 smoke | iOS WDA | `e1384aa` | **holds** | Finportal `lang_sk` refused (#7), `scroll_until` no swipe (#8), `forgot_close` tapped (#10), login `login_username` tapped (#11), English kept; Contacts sheet Kate Bell refused (#17), no swipe (#18); Safari "Go to page B" (#107) and "Link number 11" (#108) tapped |
| B.1 SWIFT field errors, pristine | iOS idb + WDA | `e1384aa` | **holds** | 0 `"error"` over 12 textfields on idb (#63) and WDA (#64), and after fills (#66, #67, #74); `Filled role:textfield value:Dummy …` on WDA (#72) and idb (#73), cleared (#75) |
| B.2 SWIFT real validation message | iOS idb + WDA | `e1384aa` | **fails** (unpaired, not mispaired) | IBAN "XX12" + blur shows the message (`img-79-0.png`); it is `text id=swift_payment.form.iban_input_error` and the field `textfield id=TextFieldWithComponentStyle value XX12` has no `error` on idb (#80) or WDA (#81); NEW note |
| D WDA /source captures | iOS WDA | `e1384aa` | **captured** | `D-swift-form.json`, `D-swift-fees-sheet.json`, `D-finportal-forgot.json`, `D-contacts-sheet.json`, `D-contacts-discard-popover.json`, `D-account-detail-contrast.json`; tabs `isVisible "0" isAccessible "0"` but their images `isAccessible "1"`; the host is `isVisible "0"` in both states; dims: `forgot_overlay` `"1"/"0"`, `PopoverDismissRegion` `"1"/"0"` (popover and Fees sheet), the Contacts sheet's unlabelled dim `"0"/"0"` |
| R-added: parked off-screen text tap | iOS WDA | `e1384aa` | **fails** (still open, out of scope) | `Tapped role:text label:"add instant message"` at l.13 `143 73` while the row is at y 1306 (#43) |

### iOS: Gaps and observations

- **Daemon crash on a missing-args call (harness, not averi).** `call.sh` with no second argument sends `"args":{\}` because of
  `${2:-{\}}` quoting, and `daemon.mjs` dies on the `JSON.parse` error. The Android daemon log shows the same crash and a restart at
  06:55:08. A `try` around the parse, or the default `'{}'`, would prevent it. I restarted mine identically (header).
- **A.2 target placement.** In round 13 "add instant message" was in the viewport only because Notes had been grown with newlines. This
  time, with the keyboard down, it lay at y 1306. So the in-viewport check used "Insert add phone", and the below-the-fold case became
  the NEW scroll note.
- **The ocr assert under the popover + status bar** (#32) names `the status bar is drawn over the element …` and then the presented
  remedy. That matches the round-14 wording ("in place of the bar's own advice"). The colour assert on the same element (#31) names the
  dim instead, because colour reads the rect inset 12% a side, which clears the bar.
- **Finportal colour under the modal** (#9) names the card's text `"Send your password reset request …" (32,389 338x48)`, not
  `forgot_overlay`. The verdict and remedy are right. The named cover is the topmost presented node over the field.
- **Off-screen button not listed.** Under WDA, Contacts' off-screen cells list their `container` and parked `text` but no `button
  'Insert add instant message'` (#25 timed out). With the popover up, `tap role:text …` was refused at the parked rect (#33): right
  verdict, wrong geometry.
- **Second `PopoverDismissRegion` on the SWIFT form.** It is `isVisible "0"` inside the form's own window, listed before the content,
  next to the Fees sheet's live one. It may be left over from the PAY menu or the SwiftUI host. No verdict depended on it.
- **BIC title changes:** with "Testbank" in Payee's bank name, the BIC title read `BIC` (no asterisk, `img-68-0.png`). That is app
  behaviour and unrelated to averi.
- **Timings:**
  - WDA calls on Contacts' New Contact sheet took 9.0–10.0 s; WDA colour/ocr asserts that failed closed took 12.8–14.7 s; the first
    `type_text` on Contacts took 19.2 s.
  - A colour assert with `timeout: 3000` on Contacts could not finish one round (4.4 s) and said so (#19).
  - Finportal WDA refusals took 2.6–2.9 s.
  - mp-native WDA refusals took 2.4–2.6 s; WDA `type_text` took 7–10 s.
- **mp-native "That's an error"** on the SWIFT form at 07:04 (session expired; the account is shared with the Android agent). It was
  fixed by one `login_pin_ios_here` after a relaunch. This is not averi.
- **Not mine:** items C.1 and C.2 (Android).

### iOS: End state

At 07:13 UTC:
- **mp-native:** in the background on Account Detail (Home tab), logged in since 07:05 by one `login_pin_ios_here`. The SWIFT form was
  left with Back (#104). No CONTINUE was pressed and no payment was made. The fee was re-selected on its own value and is unchanged (OUR).
  All fields are empty.
- **Finportal:** in the background on its login screen, English, `login_username` focused, nothing typed, no login, no submit, no
  language change.
- **Contacts:** in the background on its list with the 6 stock contacts. One draft ("Zz") was discarded with Discard Changes. One
  unedited New Contact was closed. Nothing was saved and nobody was called.
- **Safari:** in the foreground on local page B (`127.0.0.1:47905/b.html`, server stopped).
- **Settings:** never opened.
- **Keyboard prefs:** `AutomaticMinimizationEnabled = 1` and `HardwareKeyboardLastSeen = 1`, never changed.
- **WDA:** stopped (xcodebuild 95058 killed, WDA 95061 gone, 8100 closed at 07:12:23).
- **Web server:** on 47905, stopped at 07:12:14.
- **Metro:** :8081 (pid 88312) left running.
- **averi daemon:** on 47903, left running for the caller (restarted by me at 06:55:29).
- **Simulators:** one booted. Nothing on the Android emulator, adb or port 47901 was touched.


**Follow-up (2026-10-14):** the mp-native items this round could not reach during the backend outage were run on Android at `ebe6822` once the backend was back; see round 16's handoff §5 and the bug notes' `re-run at ebe6822` sections.
