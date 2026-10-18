# Handoff: on-device check of round 13 (`arch/round-13` @ `d407256`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 13 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 13 = `arch/round-12` (`20307d2`) + the fixes from the device check of rounds 9–12 (results in round 12's
handoff §6):

- **ADR 0018:** a screen presented over another in the same window covers the screen beneath. That means a modal's
  screen-filling dimming leaf or a sheet's scroll view. A host with children (Safari's bottom-bar host, an RN Portal,
  FAB or Snackbar host) still does not. Fixes the RN transparent-modal and Contacts-sheet bugs, where taps were
  reported `Tapped` but landed on the overlay.
- **Wording:** idb's QuickType bar (ADR 0007 amended), the idb keyboard texts, the Android FAB host trade-off, and
  `…and N more` on ambiguous selectors.

Behaviour is unchanged everywhere else. A differential harness over the 94 corpus trees and all 91 device trees of
rounds 11–12 differs from `20307d2` only on the 5 trees with a presented modal or sheet.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/` (also committed on `docs/device-check-r5-r12`).
  Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. Build

1. `git checkout arch/round-13` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. Presented screens (iOS WDA), ADR 0018
1. **Finportal, forgot-password modal up** (bug note `2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done`):
   - `tap id:lang_sk` → **refused** `… under container id:forgot_overlay … a screen is presented over it (a modal or a
     sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`.
   - `tap id:forgot_close` (on the modal) → tapped.
2. **Same modal:** `scroll_until id:lang_sk` → fails `stopped before any swipe … a screen is presented over it … and a
   swipe on it may dismiss it`, with **no swipe** sent (the modal must still be up afterwards).
3. **Contacts, New Contact page sheet up** (bug note `2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath`):
   - a tap on a row of the list beneath (e.g. Kate Bell) → refused with the presented sentence.
   - a tap on a field of the sheet → tapped.
   - `scroll_until` to a list row → fails without swiping; **the sheet must not be dismissed**.
4. **Same sheet:** `assert_color` on a list row beneath → fails closed naming the sheet's scroll view.
5. **Safari, a local test page (round 12 row W):** `tap` on "Go to page B" → tapped, and the page navigates. No web
   element may be refused under `CapsuleViewController`.
6. **Smoke:**
   - The SWIFT form with its full-screen toolbar host: `tap` and the dismissal picker as at round 12.
   - Finportal login with no modal: taps as at round 12.

### B. Wording
1. **idb, iOS 27, QuickType "Passwords" showing** (bug note `2026-10-13-ios-idb-quicktype-bar-lies-above-the-keyboard-band-and-is-tapped`):
   a tap on it presses it, as before. This is expected now (ADR 0007).
2. **idb:** a tap on a field under the keyboard band → refused. Its advice says `tap one yourself first: with
   treeSource: idb no guard acts …`, not "name them under app.ios.keyboardDismiss".
3. **Android Clock, FAB** (bug note `2026-10-13-android-fab-host-layer-refuses-taps-beside-the-fab`): a tap beside the
   FAB is still refused naming `fab_container`. The tool description (`tap`) explains why.
4. **Any platform:** a selector matching more than 5 elements → the refusal lists 5 and ends `…and N more`.

### C. Captures (no fix yet; owner decisions Q2(b) and Q4)
1. **iOS WDA, the SWIFT form pushed over the tab bar** (bug note `2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows`):
   - Save the raw WDA `/source` XML (not `ui_snapshot`).
   - Record each `nav.tab_*` button's `visible` / `isVisible` attribute.
   - Put it in the bug note as evidence.
2. **Android:**
   - Capture the raw `uiautomator dump` XML of Clock with the FAB showing, and of mp-native's screen with the floating
     tab bar.
   - Record `clickable`, `focusable` and `class` of `fab_container` and of the tab-bar host.
   - Put both in the FAB bug note.
   - Use only `adb shell uiautomator dump` + `adb pull`; no adb server commands.

## 3. Out of scope

- Everything in section 4 of rounds 10–12's handoffs.
- ADR 0018 residuals:
  - a dimming view that is a wrapper with children is not seen;
  - the sheet's own bare dim stays excused;
  - `scroll_until` still strokes for a target beneath that is off screen or under the keyboard;
  - a full-screen pass-through leaf refuses taps beneath it.

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1–A.2 Finportal modal | iOS WDA | | | |
| A.3–A.4 Contacts sheet | iOS WDA | | | |
| A.5 Safari | iOS WDA | | | |
| A.6 smoke | iOS WDA | | | |
| B.1–B.2 idb | iOS idb | | | |
| B.3 FAB | Android | | | |
| B.4 …and N more | any | | | |
| C.1 WDA /source capture | iOS WDA | | | |
| C.2 uiautomator capture | Android | | | |


## 5. Device check results (2026-10-14, at `d407256`)
Run by the device-check agents (Android 22:05–22:12, iOS 22:05–22:27 UTC). Per-note results are appended to each bug note as `## Device check (2026-10-14 <platform>, re-run at d407256)`. mp-native's backend still failed on Android ("Mandatory data not loaded"), so D7.1 and the sticky-header row were not re-checked there; FinPortal (Metro, never logged in) and Contacts carried the iOS items.
New bug notes: `2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md`, `2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md`, `2026-10-14-ios-field-errors-pair-a-shared-component-id-with-the-next-fields-title.md`.

### Android: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| B.3 FAB | Android emulator-5554 (API 33) | d407256 | **holds** — taps beside the FAB still refused naming `container id:fab_container (0,1582 1080x352)` (chevron, digits, switch; replies identical to round 12, no shim tap); the `tap` description states the trade-off ("since the tree cannot tell a host that swallows touches (a tab bar's) from a transparent one … e.g. Clock's fab_container … can be refused naming the container") | #9–#11, `img-8-0.png`, `snapC2.txt`, `tools.json` |
| B.4 …and N more | Android emulator-5554 | d407256 | **holds** — Settings `tap id:title` → `Selector matches 8 elements: id:title` + 5 listed + `…and 3 more`; `id:icon_frame` the same (8, 5 listed, `…and 3 more`); no shim tap | #15, #16 |
| C.2 uiautomator capture | Android emulator-5554 | d407256 | **captured** — both `fab_container` (ViewGroup) and the mp-native tab host (Compose View) are `clickable="false" focusable="false"`; `clickable` does not separate them | `r13-clock-fab.xml`, `r13-mpnative-tabbar.xml` |
| R-added: tap off screen | Android | d407256 | **holds** — `text:"Sound & vibration"` (clipped out above) → `Timed out after 5000ms … (it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)` | #17 |
| R-added: cut-at-edge row sentence | Android | d407256 | **holds** — Settings `title 'Digital Wellbeing & parental controls' 198,2143 816x11` in `text_frame 154,2099 926x55` → `… is cut at its scroll container's bottom edge (container 0,297 1080x1857), as is the 154,2099 926x55 it lies in; only a 816x11 part of it shows, 11 deep across that edge, under the 65 a tap needs — scroll_until it first (…); nothing was tapped`, no shim tap | #25, `snapS4.txt` |
| R-added: D7.4 OCR fail-closed / colour | Android | d407256 | **holds** — same title (ends on 2154 with its container): OCR `FAIL … the element may be cut at the navigation bar (element 198,2143 816x11, navigation bar from y 2154): it ends on the bar's top edge, as its scroll container 0,297 1080x1857 does … failing closed, rendered text unchecked`; colour in the same call measured `PASS … sampled #F0F0F3 (dominant, 100% of region) … dE00 0.00` (18.6 s for both) | #26 |
| R-added: one `assert_color` | Android | d407256 | **holds** (the colour half of #26) | #26 |
| R-added: tap under docked Gboard | Android (mp-native) | d407256 | **holds** — search field focused (#31, `input tap 523 146`; `mInputShown=true`, region `(0,1332,1080,2022)`), `TRY AGAIN` text `435,1543 211x49` under the keyboard: #33 `tap text:"TRY AGAIN"` → `Tapped text:"TRY AGAIN" (the soft keyboard covered text:"TRY AGAIN"; hidden before tapping)` (12.1 s), shim `22:11:48 keyevent 4`, `22:11:55 input tap 541 1568`; `mInputShown=false` after | #31, #33, `img-32-0.png` |
| R-added: D7.1 nav-bar refusal on a row | Android (mp-native) | d407256 | **not reached** — mp-native backend still returns no data (Account Detail empty); D7.4 run instead (above) | — |
| R-added: row_0 under sticky header `cutBounds` | Android (mp-native) | d407256 | **not reached** — no transaction data (backend outage, "Mandatory data not loaded" after TRY AGAIN ×2) | `img-28-0.png`, `img-30-0.png` |

## NEW


None. No new bug found at this hash on Android.

### Android: Gaps and observations

- **A 23-px cut leaf at the list's bottom was tapped (stated residual, harmless here):** Settings `summary 'Saved passwords, autofill, synced
  accounts' 198,2131 751x23` (natural 53, cut at the list's bottom 2154) inside `text_frame 154,2013 926x141` (natural 215). #18 `tap` →
  `Tapped`, shim `22:08:12 input tap 574 2143`, and the Passwords & accounts page opened (`img-20-0.png`; Back #21, shim `22:09:00 keyevent 4`).
  This is `geometry.ts`'s documented behaviour, not a regression: the leaf has no descendants to evidence its cut ("Unknowable"), and the
  frame it lies in is 141 deep, over the 65 minimum, so no cut is inherited ("Nor is a node flush with the edge of an ancestor cut there
  DEEPER than the minimum … tapped"). The tap point (2143) lay above the navigation bar on the clickable row, so it did what the user would
  expect. #19's assert on that summary then failed `not found within 12 s` because the page had changed (my sequencing, not averi).
- **The FAB refusal's own text gives no hint of the trade-off** (see B.3 remark): "drawn over it … scroll_until it first" for an element
  plainly visible beside the FAB. For the switch (#11) the reply says `nothing of it shows` — it shows wholly in `img-8-0.png`.
- **C.2 → the bug note's suggested `clickable=false` discriminator does not work** on these two hosts (both false). The bug note also guessed
  the FAB host is a `FrameLayout`; the raw class is `android.view.ViewGroup` (likely a CoordinatorLayout/ConstraintLayout subclass reported
  generically).
- B.4 count: `id:title` matched 8, not the 10 dumped — `Sound & vibration` (clipped out at the top, 0 height) and the cut row are excluded
  from the count; the list order is top to bottom. Not judged.
- Not reached: D7.1 and the `row_0` sticky-header `cutBounds` check (mp-native backend outage continues — no transaction data). The iOS
  simulator, idb, WDA and port 47893 were not touched.
- Fail-closed OCR still slow-ish (#26: 18.6 s for OCR fail + colour pass).

### Android: End state

At 22:12 UTC: mp-native (`com.finshape.skeleton.dev`) in front (`topResumedActivity … MainActivity`), **logged in** (tab host with `nav.tab_*`)
on "Mandatory data not loaded / TRY AGAIN" (backend, not averi; no PIN re-login done). Keyboard down (`mInputShown=false`), Gboard docked
(region `(0,1332,1080,2022)`), gesture navigation (`navigation_mode` 2). Clock: both alarms OFF (`checked="false"`), 8:30 card collapsed again,
left in the background. Settings: only scrolled (by two slow hand drags) and the Passwords & accounts page opened and closed — nothing changed.
Contacts untouched (left on its Organize tab). Metro and `adb reverse` untouched; daemon on 47891 left running. Dump files remain on the device
at `/sdcard/r13-clock-fab.xml` and `/sdcard/r13-mpnative-tabbar.xml`. No averi source, `averi.yaml`, handoff or bug note edited; no git.

### iOS: TABLE

| item | result | evidence |
|---|---|---|
| A.1–A.2 Finportal modal (iOS WDA) | **holds** | `lang_sk` refused `… under container id:forgot_overlay … a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped` (#8, #16); `scroll_until` `stopped before any swipe … and a swipe on it may dismiss it, so none was sent` (#9, #18, #19), no shim stroke, modal still up (`img-11-0.png`, `img-20-0.png`); `forgot_close` → `Tapped` (#21, l.3), modal closed, English (`img-22-0.png`). First `forgot_close` correctly refused under the RN LogBox toast (#12) |
| A.3–A.4 Contacts sheet (iOS WDA) | **holds** | Kate Bell refused `under scrollable (0,62 402x812) … a screen is presented over it` (#57, #59); `Last name` → `Tapped` (#65, l.15); `scroll_until` `stopped before any swipe …, so none was sent` (#61, #62), shim count unchanged, sheet up (`img-64-0.png`); colour → `scrollable (0,62 402x812) is drawn over the element … failing closed` (#63). R-added M (row over Hank) still refused (#58) |
| A.5 Safari (iOS WDA) | **holds** | `tap role:other label:"Go to page B"` → `Tapped` (#104, l.30 `94 219`), page B loaded; `Link number 11 32,747` inside `CapsuleViewController 0,0 402x874` → `Tapped` (#108, l.31); nothing refused under the capsule host. R-added W.2 refused under the status bar (#112) |
| A.6 smoke (iOS WDA) | **holds** | SWIFT: no dismissal refused (#150); `cfg-wda-title` → `hidden by tapping id:"swift_payment.form.title"` (#151, l.47–48). Finportal login: refused / `login_title` / wrappers `covered by container` / `login_username_label` picked (#40–#47), verbatim round 12. **But** see NEW notes: SWIFT fees half-sheet (`scroll_until` swiped it) and Account Detail's payment-type overlay (tap beneath reported done) |
| B.1–B.2 idb | B.1 **holds** (press expected, ADR 0007); B.2 **holds** for the wording where reached (assert path), **tap path not reached** | B.1 `Tapped role:button text:"Passwords"` (#36, l.5 `201 568`); B.2 assert `… tap one yourself first: with treeSource: idb no guard acts, so app.ios.keyboardDismiss is inert (with treeSource: wda the guard taps its first on-screen entry before a covered target) …` (#164); idb never lists an on-screen node whose centre is under its band (#32, #33, #166) |
| B.4 …and N more (iOS WDA) | **holds** | Contacts list `tap role:button label~"Contact photo.*"` → `Selector matches 6 elements …` lists 5 then `  …and 1 more` (#52). idb lists no such buttons (#53 timeout) |
| C.1 WDA /source capture | **captured** | `c1-source.xml`: all 4 `nav.tab_*` `visible="false" accessible="false"` at y 711 (no `isVisible` attribute); Account Detail contrast `visible="true" accessible="true"` at y 755 (`c1-source-account-detail.xml`); `visible="false"` also on rows under CONTINUE |
| R-added: M row over the target (Contacts) | **holds** | #58 |
| R-added: W.2 | **holds** | #112 |
| R-added: D2.5 idb stroke start | **holds** | #75, l.18 `201 472 → 201 118` |
| R-added: round-12 smoke 4–5 (Finportal dismissal picker) | **holds** | #40–#47 |

### iOS: Gaps and observations

- **Not reached:**
  - **B.2 tap path (idb, a field under the band).** idb never lists an on-screen node whose centre lies under its band. This was seen
    on Finportal, Contacts and the SWIFT form. The advice text was checked on the assert path instead.
  - **B.3, C.2.** Android, out of my half.
- **Round-13 residual measured (out of scope §3, recorded): the Contacts discard popover.** In New Contact (draft with blank Notes
  newlines), `close` raises "Are you sure you want to discard this new contact? / Discard Changes". WDA lists `container 'dismiss
  popup' id=PopoverDismissRegion 0,0 402x874` with the popover as its child (`X-wda-discard-popover.json`).
  - 22:16:35 `tap role:button label:"Insert add instant message"` → `… is under container "dismiss popup" (0,0 402x874) at its centre
    (52,271), drawn over it; nothing of it shows above the soft keyboard — scroll_until it first; nothing was tapped` (#94).
  - 22:16:52 `scroll_until` on the same button → `fully visible after 1 swipe` (#96, l.27 `201 459 → 201 115`). The swipe closed the
    popover and the keyboard; the content did not scroll. The reply gives no hint that a presented layer was swiped away (`img-97-0.png`).
  - This is the "dimming view that is a wrapper with children" residual. The tap wording is odd too: "nothing of it shows above the soft
    keyboard" for a target at y 271 with the keyboard at 573, and "scroll_until it first" leads into the swipe. The draft was then
    discarded (`Discard Changes`), and Contacts is unchanged.
- **A.4 wording.** The colour assert under a presented sheet still advises `scroll_until the element with fully: true first …`, while
  `scroll_until` and `tap` now say `no scroll moves it out from under that screen`. The assert's own fallback clause ("or, if no scroll
  moves it out …") covers it, but it does not use the presented sentence.
- **RN LogBox toast (Finportal dev build).** "Open debugger to view warnings" is listed twice in WDA, once inside the login screen and
  once last, and it covers `forgot_close`. averi refused correctly (#12). The refusal's `scroll_until it first` advice does not fit an
  overlay toast. Close the toast (× at `369,811`) before Finportal checks.
- **mp-native "That's an error"** on Home/Account Detail at 22:19, with TRY AGAIN failing. It was fixed by one approved
  `login_pin_ios_here` after a relaunch, as in round 12 (the session expired; the test account is shared with the Android agent). This
  is not averi.
- **Timings:** cold WDA call 7.8 s (#6); WDA calls on Contacts' New Contact sheet 9.4–10.0 s each (taps and `scroll_until`); colour
  assert failing closed 14.6 s (#63); WDA dismissal taps 7.1–10.3 s; Finportal WDA refusals 2.6–3.0 s.
- B.1: unlike round 12, the keyboard stayed up after the "Passwords" press.
- The Contacts M refusal (#58) now names `image "add" (39,645 26x26)`, the row's icon, not the row container. It is correct either way.

### iOS: End state

At 22:27 UTC:
- **Finportal:** in the foreground on its login screen, English, keyboard down, nothing typed or submitted, no login
  (`img-171-0.png`).
- **mp-native:** in the background on Account Detail (Home tab), logged in at 22:20 by one `login_pin_ios_here`. The SWIFT form was
  left with Back; no payment, no CONTINUE, fees unchanged (OUR).
- **Contacts:** unchanged, with the 6 stock contacts. The New Contact draft was discarded, and nothing was saved or called.
- **Settings:** never opened.
- **Safari:** holds a tab of the stopped local page B.
- **Services:** WDA stopped (xcodebuild 59210 killed, port 8100 closed 22:27:12). Web server on 47895 stopped (22:19:24). Keyboard
  prefs `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` = 1. Metro on :8081 left running. Nothing on the emulator, adb or port
  47891 was touched.


**Follow-up (2026-10-14):** the mp-native items this round could not reach during the backend outage were run on Android at `ebe6822` once the backend was back; see round 16's handoff §5 and the bug notes' `re-run at ebe6822` sections.
