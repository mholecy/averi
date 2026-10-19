# Handoff: on-device check of round 17 (`arch/round-17` @ `84f51e6`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 17 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 17 = `arch/round-16` (`ebe6822`) + the fixes from the device check of rounds 15 and 16 (results in round 16's
handoff §5) and the owner's decisions of 2026-10-14:

- **Beneath a presented screen every target the agent cannot reach is told "close it first"** (ADR 0018 residual 8
  amended). Whether a modal, sheet or popover is over the target is now judged of the target itself, not only of its
  visible part. A field **wholly** off screen or **wholly** under the status bar beneath a sheet no longer gets
  "scroll_until it first" or the bar's advice, in the tap and in the colour/ocr assert alike (`scroll_until` already
  stopped there).
- **The colour/ocr assert has an off-screen case.** When nothing of the element lies on the screen, or only a sliver
  of 2 pt or less at the screen's edge, it fails closed saying so, with the same remedy: beneath a presented screen
  "close it first", otherwise scroll it on-screen. **The colour assert no longer measures the sheet over a sliver and
  passes**: the region it checks for covers is now the region it samples (clipped to the screen, then inset).
- **A `scroll_until` that times out says what happened**: `failed after <spent>ms (timeout <budget>ms; no swipe was
  sent; 1 tree read took <n>ms)` — so a slow or restarting WDA no longer reads as the content's fault.
- **Known and recorded (not changed):** beneath an undimmed partial sheet the tap says "close it first" while
  `scroll_until` may still swipe where its touch-down misses the sheet (ADR 0018 residual 11); Account Detail's
  bottom rows in the app-drawn blank strip (residual 10).

A tool-level differential over 548 trees (every device tree of rounds 11–16 incl. the 40 raw payloads you saved in
round 16, fixtures, synthetic shapes) against `ebe6822`: `scroll_until` unchanged; no Android remedy changed (only the
wording for elements with no area); every changed reply is classified. Among them a real device tree from round 12
(`M1-wda-fees-sheet`, a row at y 872 beneath the Fees sheet) whose colour assert used to PASS on the sheet and now
fails "close it first".

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- The owner logs mp-native in and confirms the backend is up before the run; do not type credentials yourself.
- Save the raw payload next to every `ui_snapshot` you take, as in round 16 (§2 C there): WDA
  `curl -s 'http://127.0.0.1:<port>/source?format=json'`, idb `idb ui describe-all --json --udid <udid>`, Android
  `adb -s <serial> exec-out uiautomator dump /dev/tty`. Same name as the snapshot (the converter now keeps both). Do not
  commit them (bank data).
- Selectors: use `role:text label:"add instant message"` (plain `text:` matches the container and the text, and the
  tap rightly refuses it as ambiguous).

## 1. Build

1. `git checkout arch/round-17` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. Beneath a presented screen (iOS WDA)
Bug note `2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar`.

1. **mp-native SWIFT form, Fees half sheet open** (as in round 16 A.1):
   - `tap id:swift_payment.form.bank_country_select` (wholly off screen beneath the sheet) → refused ending
     `— a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that
     screen; nothing was tapped` (before: `— scroll_until it first`).
   - `tap id:swift_payment.form.payee_street_input` → still the same ending (held in round 16).
   - `assert` colour and ocr on `bank_country_select` → fail closed, the off-screen sentence ending in
     `close it first …` (before: `element rect is outside the screenshot … — scroll it on-screen and re-run`).
   - `scroll_until` to either field still stops before any swipe; the sheet stays at its detent.
2. **Contacts, New Contact sheet, discard popover up:** `tap role:text label:"add instant message"` (below the fold)
   → `… close it first …` (before: `scroll_until it first`).
3. **Under the status bar beneath a sheet** (SWIFT form scrolled so `priority_select` lies under the bar, then the
   country sheet opened — as round 16 #79): `tap id:…priority_select` → `… close it first …` (before: the bar's
   `scroll_until it first, to move it out from under the bar`). Colour and ocr on it → the same ending (before: the
   bar's advice, round 16 #82/#83).
4. **Smoke (unchanged replies):** with no sheet, a tap partly off screen still says `scroll_until it with fully: true
   first` and a tap under the status bar the bar's advice; colour/ocr on an element partly visible beneath the sheet
   still `close it first` (round 14/16).

### B. The colour assert on a sliver (iOS WDA)
Bug note `2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes`.

1. SWIFT form, Fees sheet open, `payee_street_input` with only a few pt on screen beneath the sheet (round 16 #59):
   `assert` colour expecting the sheet's colour → **FAIL**, naming the sheet's dim / surface and ending
   `close it first` — or, if 2 pt or less of it shows, `only a sliver of the element lies on the screen, too thin to
   measure … close it first`. It must never PASS. Record the exact `rect` from the tree.
2. With the sheet closed and the same field cut at the bottom edge by a few pt (scroll so): the colour assert measures
   it if more than 2 pt show, otherwise the sliver sentence ending in a scroll advice.

### C. `scroll_until` timeout wording (any platform)
1. `scroll_until` on a selector that is not on the screen with a small budget (e.g. `timeoutMs: 3000`, a long list) →
   `failed after <n>ms (timeout 3000ms; <k> swipes sent; <m> tree reads took <t>ms, the last <l>ms)`. Record it.
2. If a WDA restart happens on its own during the run (as round 16's Safari #168), record the reply: it must say how
   many swipes were sent (`no swipe was sent` if none) and the read time. Do not provoke a restart.

### D. Probes (no code changed; owner decisions Q4, Q5)
1. **iOS status bar hit area** (iOS WDA, SWIFT form scrolled so content lies under the top): raw coordinate taps
   `tap x:200 y:63`, `y:66`, `y:70` on a spot with **no** navigation header in the way (if the SWIFT form's header
   covers that band everywhere, use another scrolled screen, e.g. Transactions, or Safari's page). After each, record
   whether the scroll view jumped to its top (screenshot before/after). Purpose: does the status bar's scroll-to-top
   take taps below its 62-pt band?
2. **Android Gboard's transparent top** (emulator, gesture navigation): on the SWIFT form, with Gboard docked by
   focusing one field, make sure **another, unfocused** field's centre lies between Gboard's `touchableRegion` top
   (`dumpsys window` / `dumpsys input_method`, ~1332) and its drawn top (~1399). `tap` it with averi and record: the
   reply, the `input tap` coordinates in the shim log, and whether the tapped field took the focus (cursor/IME target).
   If no field can be brought into that strip, write "not reachable".

## 3. Out of scope
- Round 16 §3 and round 15 §3.
- The undimmed partial sheet (residual 11) and Account Detail's bottom strip (residual 10): recorded, not changed.
- The SwiftUI navigation header over a scrolled form (pinned-app-chrome note's open case).

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 Fees sheet: wholly off-screen field (tap, colour, ocr, scroll_until) | iOS WDA | | | |
| A.2 discard popover: below-the-fold text | iOS WDA | | | |
| A.3 status bar beneath the country sheet (tap, colour, ocr) | iOS WDA | | | |
| A.4 smoke | iOS WDA | | | |
| B.1 colour on a sliver beneath the Fees sheet | iOS WDA | | | |
| B.2 colour on a sliver, no sheet | iOS WDA | | | |
| C.1 timeout wording | iOS / Android | | | |
| C.2 WDA restart during scroll_until (if it happens) | iOS WDA | | | |
| D.1 status-bar hit area y 63/66/70 | iOS WDA | | | |
| D.2 Gboard transparent top, unfocused field | Android | | | |
| raw payloads saved (list) | iOS + Android | | | |


## 5. Device check results (2026-10-14, at `84f51e6`)
Run by the device-check agents (Android 19:59–20:01, iOS 20:00–20:12 UTC, 2026-10-14) at `84f51e6`, built from `arch/round-17`. Per-note results are appended to each bug note as `## Device check (2026-10-14 <platform>, re-run at 84f51e6)`. Summary: A.1–A.4 and B.1 hold (the colour assert beneath the Fees sheet now FAILs "close it first", round 16 passed); B.2 fails — the field lies wholly outside its scroll view (`0,0 402x780`) while its tree rect puts 5 pt on screen, so the colour assert samples the background and passes (new note); the ≤2 pt sliver case was not reachable. C.1 holds on both platforms (Android: `failed after 6558ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4719ms, the last 2416ms)`; the reply states the overrun); C.2 not reached (no WDA restart happened). D.1: on Safari's page, raw taps at y 63/66/70 neither scrolled to top nor expanded the toolbar (control at y 30 did); the SWIFT form's header covers the band to ~115 pt. D.2 not reachable: Android mp-native was on its inactivity "Logged out / LOGIN" screen and LOGIN (20:01:20) led to **Welcome / SIGN IN** — the device's registration appears gone (cause unknown; iOS's one PIN re-login came later, 20:02:13). No mp-native work on Android until the owner re-registers it. Raw payloads stay in the run folders (bank data).
New bug notes: `2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes.md`.

### Android: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| C.1 timeout wording (Android) | Android emulator-5554 (API 33, gesture), Settings | 84f51e6 | **holds (wording)**: `failed after 6558ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4719ms, the last 2416ms) — element never appeared in the tree`; a repeat gave the same shape (`6425ms … 4653ms, the last 2369ms`). The call ran past its budget by about 2.2x (one more read after the swipe) | #5, #6, shim `20:00:29` / `20:00:42 input swipe 540 669 540 1783 1116`, `settings1.txt/.xml` |
| D.2 Gboard transparent top, unfocused field | Android emulator-5554, mp-native SWIFT form | 84f51e6 | **not reachable**: mp-native fell to Welcome / SIGN IN after the inactivity LOGIN tap, so the SWIFT form could not be opened under the hard rules. A substitute on Google Contacts' create-contact form was denied by the permission classifier, and I did not try it another way | #8, #9, #11, `img-8-0.png`, `img-10-0.png`, `welcome1.txt/.xml` |
| raw payloads saved (Android) | Android emulator-5554 | 84f51e6 | **saved**, one `.xml` per `ui_snapshot` under the same name: `settings1`, `welcome1` (each `.txt` + `.xml`). Neither holds bank data | `$R/settings1.*`, `$R/welcome1.*` |

## NEW


None. No averi fault was seen. The C.1 overrun is reported in the reply's own terms (see Gaps). The mp-native session loss is app/session state, not averi.

### Android: Gaps and observations

- **C.1 detail.** Settings started at its bottom, and I scrolled `direction:"up"` with `text:"zzq averi no such row 17"`, which matches nothing.
  - #5 (`20:00:27.133Z`): `scroll_until text:"zzq averi no such row 17" failed after 6558ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4719ms, the last 2416ms) — element never appeared in the tree`. One stroke was sent: `20:00:29 -s emulator-5554 shell input swipe 540 669 540 1783 1116`.
  - #6 (`20:00:40.340Z`): `scroll_until text:"zzq averi no such row 17" failed after 6425ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4653ms, the last 2369ms) — element never appeared in the tree`. One stroke was sent: `20:00:42 -s emulator-5554 shell input swipe 540 669 540 1783 1116`.
  - Timing: read 1 took about 2.3 s, then the 1.1 s stroke ran, then read 2 took about 2.4 s after the budget had already run out. The total was about 2.2x the 3000 ms budget.
  - The wording matches the handoff's form, and the reply is honest about the overrun ("failed after 6558ms (timeout 3000ms …"). Settings' tree reads took about 2.4 s each on this emulator.
  - Whether the read after the budget should still be taken is a design question for the owner, not a wording fault.
- **mp-native session.** The inactivity "Logged out / LOGIN" screen led to Welcome (SIGN IN / RESET), not to the PIN prompt. Under the repo's observable (PIN = registered, Welcome = not), this reads as **this device's mp-native registration being gone**.
  - Two causes are possible: the logout itself dropped it, or something outside this run did (the iOS agent shares the test account). I cannot tell which from here.
  - The owner needs to re-register / log in before the next Android mp-native item. I did not tap SIGN IN or RESET.
- **D.2 Gboard top strip: still unmeasured.** No field was focused this run, so neither Gboard's `touchableRegion` top nor its drawn top was re-read. Round 16's values were `touchableRegion` from 1332 and drawn top about 1399.
- **Permission denials (not worked around).**
  - `launch_app com.google.android.contacts` with an INSERT intent, meant as the D.2 substitute: denied as "External System Writes".
  - The read-only end-state probe (`dumpsys input_method`, `dumpsys activity activities`, `settings get secure navigation_mode`): denied with no reason given.
  - So the end state below comes from the last screenshot and tree, not from dumpsys.
- Not run: A, B, C.2, D.1 (iOS, the other agent).

### Android: End state

- **mp-native** (`com.finshape.skeleton.dev`): in the foreground on **Welcome / SIGN IN / RESET** (`img-10-0.png`, `welcome1.xml` at 20:01:2x UTC), **not logged in**. Nothing was tapped there.
- **Settings:** in the background, scrolled about one swipe-length up from the bottom by C.1. Nothing was changed.
- **Keyboard:** no field was focused this run (not re-read with dumpsys, because the probe was denied).
- **Navigation:** gesture (`navigation_mode` 2 at start; not re-read at the end, same denial).
- Nothing was installed. No adb server commands were run, and no averi source, `averi.yaml`, handoff or bug note was edited.
- **Files in $R:**
  - `results.md`, `session.log`, `adb-input.log`, `tools.json`
  - `img-3-0.png`, `img-8-0.png`, `img-10-0.png`
  - `settings1.txt/.xml`, `welcome1.txt/.xml`
  - helpers `snap.sh`, `flat.py`

### iOS: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 Fees sheet: wholly off-screen field (tap, colour, ocr, scroll_until) | iOS WDA, iPhone 17 iOS 27.0 | `84f51e6` | **holds** | tap `bank_country_select` → `… (rect 24,1209 354x52) — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped` (#21); `payee_street_input` same ending (#22); colour #23 / ocr #24 `nothing of the element lies on the screen (element 24,1209 354x52, screen 0,0 402x874) — a screen is presented over the element … close it first …`; scroll_until #25/#26 `stopped before any swipe`; shim 9→9; `Half screen` y 411 (#29), `img-30-0.png` |
| A.2 discard popover: below-the-fold text | iOS WDA | `84f51e6` | **holds** | `role:text label:"add instant message" is off screen at (201,1332) … (rect 20,1306 362x52) — a screen is presented over it … close it first; …; nothing was tapped` (#89), no shim line; discarded (#90, l.32), `img-91-0.png` |
| A.3 status bar beneath the country sheet (tap, colour, ocr) | iOS WDA | `84f51e6` | **holds** | tap → `… under the status bar at (201,6) … (rect 24,-20 354x52) — a screen is presented over it (a modal or a sheet) — close it first; …` (#47); colour #48 and ocr #49 name the bar, then `a screen is presented over the element … close it first`; `fees_select` wholly above → `close it first` (#52); country unchanged `img-54-0.png` |
| A.4 smoke | iOS WDA | `84f51e6` | **holds** | `scroll_until it with fully: true first` (#38); bar advice tap #42, colour #43; partly visible beneath the sheet `bank_street_input` colour #50 / ocr #51 `… close it first` |
| B.1 colour on a sliver beneath the Fees sheet | iOS WDA | `84f51e6` | **holds** | rect `24,869 354x52` (5 pt on screen); expecting `#A6A7AB` → `FAIL … container "dismiss popup" … is drawn over the element … close it first; …; failing closed, color unchecked` (#27); white the same (#28) |
| B.2 colour on a sliver, no sheet | iOS WDA | `84f51e6` | **fails** (NEW note) | the field is outside its scroll view (`0,0 402x780`), not cut by the screen edge; colour PASSes on the background: `sampled #DEE0E6 … vs expected #FFFFFF → dE00 7.16 ≤ 8 … clipped 90% off-png` (#33), and `#DEE0E6` dE 0.00 (#35); ocr fails closed (#36); ≤ 2 pt not reachable |
| C.1 timeout wording (iOS) | iOS WDA, Transactions tab | `84f51e6` | **holds** | `scroll_until id:averi.round17.nothing failed after 4342ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 3287ms, the last 2046ms) — element never appeared in the tree` (#59, shim l.16); with 8000: `failed after 9561ms (timeout 8000ms; 2 swipes sent; 3 tree reads took 7456ms, the last 3120ms) …` (#60, l.17–18). Swipe counts match the shim |
| C.2 WDA restart during scroll_until | iOS WDA | `84f51e6` | **not reached** | no restart occurred (none provoked) |
| D.1 status-bar hit area y 63/66/70 | iOS (idb coordinate taps), Safari `b.html` scrolled | `84f51e6` | **no jump at 63, 66 or 70** | SWIFT form's header covers 0–~115 pt, so Safari was used (no header; `Link number 9` under the bar, x 200 right of its text). `Tapped (200, 63)` (#69, l.21) / `(200, 66)` (#71, l.22) / `(200, 70)` (#73, l.23): page unchanged and Safari's toolbar not expanded (`img-68`/`img-70`/`img-72`/`img-74`). Control: `(200, 30)` on the island → nothing (#75, `img-76`); `(290, 30)` → Safari expands its toolbar (#77, `img-78`), second `(290, 30)` → jumps to top (#79, `img-80-0.png`) |
| raw payloads saved (iOS) | iOS | `84f51e6` | **saved** | per snapshot `<name>.txt` + `<name>-wda.json` + `<name>-idb.json`: `swift-pristine` (#18), `swift-fees-sheet` (#20), `swift-closed-rest` (#32), `swift-scrolled` (#40), `swift-country-sheet` (#45), `transactions` (#58), `safari-scrolled` (#67), `contacts-popover` (#88) — 8 × 3 files, in `run17-ios` only |

### iOS: Gaps and observations

- **D.1 venue.** The SWIFT form's SwiftUI header covers the band down to ~115 pt (content is clipped below it, `img-41-0.png`), so the probe used Safari's `b.html` (served on 47925, then stopped). In Safari a status-bar tap first expands the minimized toolbar and only a second one scrolls to top (control #77/#79); the y 63/66/70 taps produced neither, so none of them reached the status bar. The control at `(200, 30)` — the Dynamic Island — did nothing either.
- **B.2 premise.** The handoff assumes the field can be cut at the screen's bottom edge; on this form the viewport ends at 780 (scroll view) and the field can never sit lower than at rest, so neither a true screen-edge cut nor a ≤ 2 pt sliver was reachable. Hence the NEW note.
- **Slow first ocr.** #36 (ocr, `timeout` 5000) took 35.5 s; the earlier ocr #24 failed closed before any recognition, so #36 was the session's first real recognizer run (likely the recognizer's compile). Later ocr #49/#51 took ~6 s. Not filed; noted for the budget wording ("polls out its whole budget").
- **Colour/ocr budget overrun.** The fail-closed colour/ocr asserts with `timeout` 5000 took 5.8–6.5 s (#23, #24, #27, #28, #48–#51); `scroll_until` with 3000 took 4342 ms — each by about one tree read. Consistent with the documented wording; noted only.
- **Software keyboard with prefs at 1.** In Contacts, after `type_text id:"First name"` (`idb ui text`, l.29), the software keyboard was up (`keyboard 0,573 402x301`, `img-87-0.png`) although both prefs read 1 before and after. Did not affect A.2 (the target is below the fold, not in the keyboard band).
- **"That's an error" on first SWIFT open** recurred as in round 16 (`img-9-0.png`); a terminate/launch + PIN fixed it.
- idb raw payloads under a presented sheet are small (`swift-fees-sheet-idb.json` 3.7 KB, `safari-scrolled-idb.json` 862 B): idb lists only the frontmost surface.

### iOS: End state

- Simulator `37956039-…` the only booted one; Contacts in front with the 6 stock contacts (nothing saved); Safari on `b.html` at the top (server stopped); mp-native running, logged in, on the Transactions tab (SWIFT form left with Back at #55; fee OUR, priority Standard, countries empty; nothing submitted, nothing continued/confirmed/certified).
- WDA stopped (xcodebuild 50231 killed, WDA 50346 gone, port 8100 closed). Port 47925 closed. Keyboard prefs both 1 (unchanged).
- Nothing written outside `run17-ios`; no averi source, `averi.yaml`, handoff or bug note edited; no git writes.


### Android: Follow-up D.2 (after the owner's re-login, 2026-10-14 20:17–20:20 UTC, at `84f51e6`)

D.2 is **measured** (supersedes "not reachable" above): an unfocused field centred in Gboard's reported-but-not-touchable strip (1332–1397) was tapped with no Back, and took the focus.

- **Time:** 2026-10-14 20:17:09–20:19:58 UTC, emulator-5554, averi `84f51e6`. The daemon was restarted for this follow-up, so call numbers restart at #2 (session.log from `=== connected 2026-10-14T20:16:37Z`).
- **Verdict: measured.** An unfocused text field's centre was placed in Gboard's strip and tapped. averi tapped it directly, with no Back-first, and **the field took focus**.
- **Start:** mp-native logged in on Account Detail (`img-2-0.png`). No PIN prompt, no login rung.
- **Path:** #6 `tap text:PAY`, #7 `tap id:accounts.detail.payment_type_sheet.row_swift`, #8 `ui_snapshot` (`d2-form1`), #9 `tap id:swift_payment.form.amount_input`. IBAN, BIC, bank name and amount were all empty, and Gboard docked (numeric layout).
- **y values:**
  - **Touchable top 1332 by the IME's own report.** `dumpsys input_method`: `contentTopInsets=1332 visibleTopInsets=1332 touchableInsets=3 touchableRegion=SkRegion((0,1332,1080,2022))`, the same as round 16.
  - **WM touchable top 1398.** `dumpsys window windows`, InputMethod window: `mGivenContentInsets=[0,1332][0,0]` but `touchable region=SkRegion((0,1398,1080,2220))`. This was read 3 times (20:18, 20:18:4x, 20:19:5x) and was the same each time.
  - **Drawn top about 1397.** Gboard's toolbar starts at about y 1258 in the 973-wide display of `d2-kb1.png` and `d2-after-tap.png`, which is about 1397 px.
  - **Strip:** 1332–1397.
- **Scrolling** (swipes clear of the keyboard, with a `ui_snapshot` and raw dump after each):
  - #11 `swipe 540,1100→540,900` → `d2-s1`
  - #13 `540,1250→900` → `d2-s2`
  - #15 `540,1250→950` → `d2-s3`
  - The payment-details section was expanded. Result: `payee_name_input 66,1295 948x143`, so its **centre is y 1366.5**, inside the strip. Gboard stayed up the whole time (`mInputShown=true`). In `d2-s3.xml` no node was `focused="true"`, because the amount field had scrolled out of the tree.
- **Reply #17** (`2026-10-14T20:19:25.177Z`, `tap {"selector":"id:swift_payment.form.payee_name_input"}`, 5.6 s), verbatim: `Tapped id:swift_payment.form.payee_name_input`. It added no keyboard note.
- **Shim:** one line, `20:19:30 -s emulator-5554 shell input tap 540 1367`. There was **no `keyevent 4`** before it.
- **Focus result: focused.**
  - `d2-after.xml` has `payee_name_input … focused="true" bounds="[66,1278][1014,1421]"`. The app nudged the field up 17 px.
  - The cursor shows in "Payee's name", and Gboard switched from the numeric layout to qwerty (`d2-after-tap.png`).
  - `dumpsys input_method`: the served input connection changed (`…Wrapper@de26229` → `@c05a321`), and `mInputShown=true`.
  - So the tap at 1367, which is inside the IME's reported touchable region (from 1332) but above the window manager's touchable region (from 1398) and above the drawn top, **reached the app, not Gboard**.
  - **Reading:** on this emulator, the band 1332–1397 is not touchable for Gboard; the window manager routes touches there to the app. averi was right not to treat it as covered. The IME's `touchableRegion` is the wrong number to judge cover by, and the WM's `touchable region` agrees with the drawn top.
- **Images:** `img-2-0.png` (start), `d2-kb1.png` (Gboard docked, numeric), `d2-before-tap.png`, `d2-after-tap.png`, `img-21-0.png` (end).
- **Raw payloads** (`.txt` = `ui_snapshot` reply, `.xml` = `uiautomator dump`): `d2-form1`, `d2-kb1`, `d2-s1`, `d2-s2`, `d2-s3`, `d2-after`. They hold bank data, so they stay in $R.
- **Cleanup:** nothing was typed into any field. #19 and #20 `press_key back` (shim `20:19:53` / `20:19:54 input keyevent 4`) hid the keyboard, then left the form. Nothing was submitted, and no CONTINUE was pressed.
- **End state (20:19:58 UTC):**
  - mp-native is logged in on **Account Detail** (`img-21-0.png`).
  - Keyboard down (`mInputShown=false`).
  - Navigation mode gesture (`navigation_mode` = 2).
  - Nothing installed. No adb server commands. Nothing edited outside $R.
