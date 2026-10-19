# Handoff: on-device check of round 16 (`arch/round-16` @ `ebe6822`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 16 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 16 = `arch/round-15` (`7a0618f`) + two architecture changes and the owner's decisions of 2026-10-14. **Round 15
has not been checked on a device yet: its whole checklist (round 15's handoff §2, Android first) still applies and is
run on THIS hash**, together with the items below.

- **One remedy for a target the agent cannot reach (ADR 0018 residual 8 amended).** The tap, the colour/ocr assert and
  `scroll_until` now take their advice from one decision, presented screen first. Behaviour changes only in the tap:
  a target **partly off the screen, under the status bar or cut at its scroll container's edge, beneath a presented
  screen** (a modal, a sheet, a popover) is refused with "close it first" instead of "scroll_until it … first" — the
  advice `scroll_until` already refused to follow there (it stops `presented`). Everything else is worded as before.
- **Differential harness in the repo (`scripts/differential/`).** It replays recorded trees through two versions of
  averi at the tool level, raw payloads included, so parser changes are measured too. It needs **raw payloads from the
  device** — see §2 C. Nothing for the server's users changes.

A tool-level differential over 479 trees (every device tree of rounds 11–14, the fixtures, synthetic shapes) against
`7a0618f` differs only in those tap refusals; the device calls are identical. The code-review fixes on top changed
nothing (0 differing calls of 244,755).

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/` (also committed on `docs/device-check-r5-r12`).
  Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- **Device-check tooling** (from round 15's handoff §0, if not done yet): in the `averi-repo` scratch, make `call.sh`
  default its argument to `'{}'` and wrap `daemon.mjs`'s `JSON.parse` in a `try` that answers 400.
- **Android first (owner decision):** round 15's §2 D items go first. The owner logs mp-native in and confirms the
  backend is up before the run; do not type credentials yourself.

## 1. Build

1. `git checkout arch/round-16` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### R15. Round 15's checklist
Run round 15's handoff §2 A–D (`docs/handoff/2026-10-14-device-check-round-15.md`) on this hash, Android (D) first.
Their expected replies are unchanged, except that a tap beneath a presented screen now ends as in A below.

### A. The tap beneath a presented screen (iOS WDA)
Bug note `2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet`
(ADR 0018).

1. **mp-native SWIFT form, Fees half sheet open:** `tap id:swift_payment.form.payee_street_input` (a form field only
   partly on screen beneath the sheet) → refused
   `… is off screen at (…) … — only N% of it … is on screen, and a tap goes to its centre — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped`
   (before: `— scroll_until it with fully: true first`). The same for `id:swift_payment.form.bank_country_select`.
   `scroll_until` to the same field stops before any swipe, naming the presented screen; the sheet stays at its detent.
2. **Under the status bar beneath a presented screen** (the Finportal forgot-password modal, or the Fees sheet): if an
   element with an id or a text lies under the status bar while the modal or sheet is up, `tap` it → refused ending
   `— a screen is presented over it (a modal or a sheet) — close it first; …`, never `scroll_until it first`. If no
   such element can be addressed, write "not addressable" in the table (the harness covers it on synthetic trees only).
3. **Smoke:**
   - With no presented screen, a tap partly off screen still says `scroll_until it with fully: true first`, and a tap
     under the status bar still gives the bar's advice.
   - The colour/ocr assert beneath a presented screen still ends `close it first; no scroll moves the element out from
     under that screen` (as in round 14).

### C. Raw payloads for the harness (iOS + Android), every tree you read
The harness can only measure the parser on raw payloads (`scripts/differential/README.md`, "Saving raw payloads in a
device check"). For **every** screen on which you call `ui_snapshot` in R15 and A, save right after it, next to the
run's other trees:

- iOS WDA: `curl -s 'http://127.0.0.1:<port>/source?format=json' > <name>.json` (port 8100 for the first simulator);
- iOS idb: `idb ui describe-all --json --udid <udid> > <name>.json`;
- Android: `adb -s <serial> exec-out uiautomator dump /dev/tty > <name>.xml`.

Use the same `<name>` as the item's `ui_snapshot` file. **Especially:** the SWIFT form with the IBAN validation shown
(round 15 B.1), with both idb and WDA — no raw payload of that screen exists yet. Do not commit the payloads (bank data).

## 3. Out of scope

- Everything in section 3 of round 15's handoff.
- The pixel assert's cut at the navigation bar beneath a presented screen (now "close it first" by the same rule): no
  device tree has it; not asked.
- Remedy sentences other than the presented ones still have no single owner in the code (later work).

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| R15 A–D (see round 15's table) | iOS + Android | | | |
| A.1 SWIFT field beneath the Fees sheet | iOS WDA | | | |
| A.2 status bar beneath a presented screen | iOS WDA | | | |
| A.3 smoke | iOS WDA | | | |
| C raw payloads saved (list) | iOS + Android | | | |


## 5. Device check results (2026-10-14, at `ebe6822`)
Run by the device-check agents at this round's hash for rounds 15 and 16 together (round 16 §2 R15), Android first as the owner decided: Android 17:07–17:21, iOS 17:24–17:47 UTC, 2026-10-14, at `ebe6822`, built from `arch/round-16`. mp-native's backend worked again; Android stayed logged in, iOS needed one approved PIN re-login. Per-note results are appended to each bug note as `## Device check (2026-10-14 <platform>, re-run at ebe6822)`. The bank-only items that rounds 8–14 could not reach during the backend outage were run on Android too (round 14 C.2 / D7.1 / sticky header, round 8/9 A2, round 10 D1.2 and D7.3, round 12 smoke 1): all hold or are recorded. Summary: R15 A, B.1–B.2, C and D hold (B.3 not reached: no error screen occurred, the network was not touched); R16 A.1 holds for `payee_street_input` but fails for `bank_country_select` (wholly off screen beneath the sheet still gets "scroll_until it first"), A.2 fails (under the status bar beneath a presented screen: the bar's advice) — new note; a colour assert on a 5-pt sliver beneath the Fees sheet measures the sheet and passes — new note; A.3 smoke holds. Raw payloads (§2 C) were saved in the run folders only (bank data, not committed): 22 Android XML dumps, 21 WDA and 3 idb JSON trees incl. the IBAN-error form on both sources.
New bug notes: `2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md`, `2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md`.

### Android: → round 12 smoke 1 (`2026-10-13-device-check-round-12.md` §3.1; the IME-guard and fill notes)

**carried r12 smoke 1a: SWIFT field under the docked Gboard → Back, then tap. Holds.**
- #66 `tap id:swift_payment.form.iban_input` (`17:17:05 input tap 540 634`) focused IBAN, with Gboard docked (`touchableRegion=SkRegion((0,1332,1080,2022))`, `mInputShown=true`). In the tree, `payee_name_input` was at `66,1835 948x143`, its centre under the keyboard (`swift_kb3.txt` #67).
- #69 `tap id:swift_payment.form.payee_name_input` → `Tapped id:swift_payment.form.payee_name_input (the soft keyboard covered id:swift_payment.form.payee_name_input; hidden before tapping)` (9.4 s), shim `17:17:22 input keyevent 4` then `17:17:27 input tap 540 1907`. The field was focused, the keyboard reopened, and the field stayed empty (`img-70-0.png`). Nothing was typed into IBAN.

**carried r12 smoke 1b: `fill` into a low field, then clear it. Holds.**
- With the section expanded, `payee_name_input` (the lowest field, at `66,1956`, cut above CONTINUE): #59 `type_text id:swift_payment.form.payee_name_input "Probe" clear` → `Filled id:swift_payment.form.payee_name_input (5 characters)` (8.6 s). The shim has `17:16:04 input tap 540 1968`, five single-character `input text` lines (P r o b e), then `keyevent 21`/`22`. The window then panned (`swift_kb.txt` #60, field `66,1278` value `Probe`; `img-61-0.png`).
- #62 `type_text … "" clear` → `Filled id:swift_payment.form.payee_name_input (0 characters, cleared 5 characters first)` (9.4 s). The shim has `17:16:35 input tap 540 1350`, `keyevent 112`, `keyevent 123`, five `keyevent 67`, and four `keyevent 112`. The field ended empty (`img-70-0.png` shows the "Payee's name" placeholder).
- I left the form with `common.top_bar.back` (#72, #79). No CONTINUE was pressed, and nothing was submitted or saved.

### Android: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| R15 D.1 row under floating tab bar | Android emulator-5554 (API 33, gesture), mp-native | ebe6822 | **holds**: refused naming `container id:nav.tab_cards`, ending `— scroll_until it first; nothing was tapped`, no FAB "wrapper may only position" hint, no shim tap. A row wholly in the bar's clip band is absent from the tree (selector times out) | #12, #13, #5, `acct4.txt/.xml`, `adb-input.log` 17:09:40 |
| R15 D.2 = r14 D7.1 row in navigation bar | Android emulator-5554, mp-native | ebe6822 | **holds**: refused verbatim "under the navigation bar at (540,2186), from y 2154 …; nothing was tapped" (×2), then `scroll_until` 1 stroke (`540 1638 540 1028 611`), then tap `540 1538` opens the detail | #6, #41, #42, #43, `acct1.txt`, `acct6.txt` |
| R15 D.2 sticky-header `row_0` | Android emulator-5554, mp-native | ebe6822 | **holds, identical to round 8/9**: `cutBounds 66,480 948x88`, tap `540 497` (centre already clear of the header), detail opened; `fully` 1 stroke; with a 3-px strip, refused naming `date_header_0` | #23, #25, #27, #28, #33, `sticky1/2/3.txt` |
| R15 D.3 Clock FAB hint | Android emulator-5554, Clock | ebe6822 | **holds**: `text:"Sunday, Saturday"` refused under `fab_container`, ending "the wrapper may only position its one child, button "Add alarm" …; nothing was tapped"; alarms OFF | #88, `clock3.txt/.xml` |
| R15 D.3 ordinary `scroll_until` | Android emulator-5554, Settings | ebe6822 | **holds**: "About emulated device" fully visible after 3 swipes | #92, shim 17:20:42–17:20:50 |
| carried r10 D7.3 gesture tap at 2186 | Android emulator-5554, mp-native | ebe6822 | **recorded**: raw `tap x:540 y:2186` → `Tapped (540, 2186)`, `input tap 540 2186`; it reached mp-native (row detail opened); a coordinate tap is not refused or moved | #19, `img-20-0.png`, `acct5.txt` |
| carried r8 A2 (A2.1 cut child) | Android emulator-5554, mp-native SWIFT form | ebe6822 | **holds verbatim**: `label:"Payment details"` refused as cut, "as is the 66,1924 948x55 it lies in", 948x42, hint present, no shim tap | #50, `swift1.txt` |
| carried r8 A2 (A2.2 scroll then tap) | Android emulator-5554, mp-native SWIFT form | ebe6822 | **holds (averi); app changed**: 1 stroke, then the tap lands on the label; the section now starts expanded, so the tap collapses it (a second tap expands it) | #52, #53, #56, #74–#77, `repro_after_scroll.xml` |
| carried r10 D1.2 toggle `66,1924 948x55` | Android emulator-5554, mp-native SWIFT form | ebe6822 | **holds**: `id:…details_toggle` refused "cut at its scroll container's bottom edge (container 0,242 1080x1736); only a 948x55 part …", no shim tap | #51 |
| carried r12 smoke 1 (Gboard Back then tap) | Android emulator-5554, mp-native SWIFT form | ebe6822 | **holds**: "(the soft keyboard covered …; hidden before tapping)", `keyevent 4` then `input tap 540 1907` | #69, `swift_kb3.txt` |
| carried r12 smoke 1 (`fill` low field + clear) | Android emulator-5554, mp-native SWIFT form | ebe6822 | **holds**: `Filled … (5 characters)`, then `(0 characters, cleared 5 characters first)`; the field ends empty | #59, #62, `swift_kb.txt`, `img-70-0.png` |
| C raw payloads (Android) | Android emulator-5554 | ebe6822 | **saved**, one `.xml` per `ui_snapshot` with the same name: `acct1`, `acct2`, `acct3`, `acct4`, `acct5`, `acct6`, `acct_end`, `sticky1`, `sticky2`, `sticky3`, `sticky_tapped`, `pay1`, `swift1`, `swift2`, `swift3`, `swift_kb`, `swift_kb2`, `swift_kb3`, `clock1`, `clock2`, `clock3`, `settings1` (each with `.txt` + `.xml`). Extra raw dumps with no `ui_snapshot`: `repro_after_scroll.xml`, `repro_after_tap.xml`. Bank data, kept in $R only | `$R/*.xml`, `$R/*.txt` |

## NEW


None. The candidate I investigated (#53's tap at y 875 after the label had been at 1924) was the app's expanded-by-default payment details, confirmed by the raw dumps from #76/#77, and not an averi fault.

### Android: Gaps and observations

- **mp-native drops list rows that lie wholly in the tab-bar host's clip band (y 1840–2088) from the accessibility tree.** `row_3` was absent while it lay there (#4, #8; `acct1.xml`, `acct2.xml` have no `row_3`), so a selector tap times out instead of giving the tab-bar refusal. That is app/Compose behaviour, not averi. The D.1 refusal reports a 21-px visible part for the same reason (the list clips at 1840, 36 px above the bar's top edge at 1876).
- The swift_kb tree (#60) shows the keyboard-panned window `action_bar_root 0,0 1080x1663` with the top bar and debit/amount rows as 0x0 nodes, and `continue_button 66,1422` lying under the Gboard (keyboard `touchableRegion` from 1332). I did not tap CONTINUE.
- #62's focus tap on `payee_name_input` (`input tap 540 1350`) lay 18 px inside Gboard's `touchableRegion` (from 1332), but above its drawn suggestion strip (about 1399). The field was already focused, and the clear went through (5 deletes took). averi did not apply the Back-first guard there, consistent with judging that field clear of the keyboard. Whether the tap reached the field or Gboard's transparent top could not be told from this case.
- #39: a probe-stroke `scroll_until … fully` inside the horizontal account carousel spent its 15 s on three 48–50-px strokes (see the carousel observation above). This is an existing residual.
- I tapped `row_4` once by mistake while meaning only to look (#35, `input tap 540 2150`), which opened a transaction detail (read-only). The following `scroll_until` (#36, two strokes on the detail screen, "content exhausted") and tap (#37, timed out) ran on that detail screen and do not bear on any item.
- Not run: R15 A–C and R16 A (iOS, the other agent).

### Android: End state

- **mp-native** (`com.finshape.skeleton.dev`): **logged in**, last seen on Account Detail (`acct_end.txt` #80) and now in the background. The SWIFT form was left with Back; nothing was submitted. Its payment-details section was left collapsed (#77), and the payee name field had been cleared to empty before leaving.
- **Clock:** both alarms OFF (`checked="false"`), cards collapsed.
- **Settings:** in the foreground (`topResumedActivity com.android.settings/.Settings`), scrolled to "About emulated device"; nothing changed.
- **Keyboard:** hidden (`mInputShown=false`).
- **Navigation:** still gesture navigation (`navigation_mode` 2).
- Nothing was installed. No adb server commands were run. No averi source, `averi.yaml`, handoff or bug note was edited.
- **Files** in $R: `results.md`, `session.log`, `adb-input.log`, `tools.json`, `img-3/15/20/24/29/32/48/55/58/61/68/70/73/78-0.png`, the 22 `.txt` + `.xml` pairs listed in the table, `repro_after_scroll.xml`, `repro_after_tap.xml`, and helpers `snap.sh`, `flat.py`.

### iOS: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| R15 A.1–A.2 discard popover, no swipe | iOS WDA, iPhone 17 iOS 27.0 | `ebe6822` | **holds** | keyboard down: `stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on container "dismiss popup" …` (#111), shim 42→42, popover up `img-113-0.png`; keyboard up: same at (201,459) (#153), and `… lies under the soft keyboard: its centre (52,590) lies below the keyboard's top edge at y 573 …` for "Insert add phone" (#154), shim 60→60, `img-155-0.png`. The keyboard is named only for a target in its band; below-the-fold says `below the viewport` |
| R15 A.3 SWIFT Fees sheet, no swipe | iOS WDA | `ebe6822` | **holds** | `payee_city_input` (#53) and `bank_country_select` (#52) `stopped before any swipe … touch down at (201,699) on scrollable (31,456 340x355) …`; shim 24→24; grabber `Half screen` y 411 (#54), `img-55-0.png`; OUR kept (#62) |
| R15 A.4 scroll smoke | iOS WDA | `ebe6822` | **holds** | SWIFT form 1 swipe (#65, l.26); Transactions 1 swipe (#91, l.33); Contacts sheet 1 swipe (#102, l.36); Contacts list 0 swipes (#97, fits on screen); Safari 3 swipes (#171, l.64–66). A first Safari try (#168) sent no swipe during a WDA restart (Gaps) |
| R15 B.1–B.3 field errors | iOS idb + WDA | `ebe6822` | B.1 **holds**, B.2 **holds**, B.3 **not reached** | IBAN `XX12` field `error="The IBAN you've entered is not valid. Please adjust and try again"`, exactly 1 error, on WDA (#41) and idb (#42), `img-40-0.png`; pristine 0 errors WDA (#31), idb (#32), and after the clear (#45); Account Detail never errored; SWIFT's own error page 0 errors (#22, #23) |
| R15 C.1–C.2 hidden tab bar | iOS WDA | `ebe6822` | **holds** | `nav.tab_*` `"hidden": true` at y 711 (#31); `Tapped text:Standard` (#33, l.15 `78 715`), undone (#36–#37); Transactions row_7 refused `under button "Cards" (201,755 82x64) … only a 354x9 part … scroll_until it first` (#90) |
| R15 C.3–C.4 parked content | iOS WDA | `ebe6822` | **holds** | `role:text label:"add instant message" is off screen at (201,1332) … (rect 20,1306 362x52) — scroll_until it first` (#101); `scroll_until` → `fully visible after 1 swipe` (#102); Kate Bell under popover refused `… close it first` (#112). The handoff's `text:"add instant message"` matches 2 nodes and tap refuses it (#100) |
| R16 A.1 field beneath Fees sheet | iOS WDA | `ebe6822` | **holds** for `payee_street_input`; **fails** for `bank_country_select` | `… only 10% of it … is on screen … — a screen is presented over it (a modal or a sheet) — close it first; …; nothing was tapped` (#49); `bank_country_select` (wholly off screen) `… — scroll_until it first` (#50) while `scroll_until` on it stops `presented` (#52); same split in Contacts (#114 vs #111); NEW note 1 |
| R16 A.2 status bar beneath presented | iOS WDA | `ebe6822` | **fails** (Finportal: not addressable) | country sheet up, `priority_select 24,-20`: tap → `under the status bar … scroll_until it first, to move it out from under the bar` (#79); `scroll_until` names the sheet (#81); NEW note 1 |
| R16 A.3 smoke | iOS WDA | `ebe6822` | **holds** for no-presented taps and colour/ocr with a part below the bar; **fails** under the status bar and on a bottom sliver | `scroll_until it with fully: true first` (#63); bar advice (#67); presented ending on colour #56, ocr #57, #60, grabber colour #115; status-bar advice beneath the sheet on colour #82 and ocr #83 (note 1); colour PASS on the sheet's pixels for a 90%-off-screen field (#59, note 2) |
| C raw payloads (iOS) | iOS idb + WDA | `ebe6822` | **saved** (in `run16-ios` only, bank data, not committed) | WDA: `account-detail-wda.json`, `swift-error-wda.json`, `swift-pristine-wda.json`, `swift-priority-sheet-wda.json`, **`swift-iban-error-wda.json`**, `swift-cleared-wda.json`, `swift-fees-sheet-wda.json`, `swift-scrolled-wda.json`, `swift-scrolled2-wda.json`, `swift-country-sheet-wda.json`, `transactions-wda.json`, `contacts-list-wda.json`, `contacts-sheet-wda.json`, `contacts-popover-wda.json`, `contacts-sheet-focused-wda.json`, `contacts-sheet-keyboard-wda.json`, `contacts-sheet-keyboard2-wda.json`, `contacts-sheet-keyboard3-wda.json`, `contacts-popover-keyboard-wda.json`, `finportal-forgot-wda.json`, `safari-b-wda.json`; idb: `swift-error-idb.json`, `swift-pristine-idb.json`, **`swift-iban-error-idb.json`**. Each beside its `ui_snapshot` reply `<name>-<src>.txt` |

### iOS: Gaps and observations

- **Safari `scroll_until` overran its budget during a WDA restart and blamed the content** (#168, 17:45:54, 38.2 s wall for a 15 s budget):
  `scroll_until role:text label:"Link number 30" failed after 15000ms (timeout) — element in tree but never intersected the 402x874 viewport (last rect {"x":32,"y":1811,"width":150,"height":28})`.
  - No swipe was sent; the shim shows nothing between l.63 and l.64.
  - `server-stderr.log` has `WDA on port 8100 … stopped answering (The operation was aborted due to timeout) — restarting it once`.
  - The reply does not say that no swipe was sent or that WDA was restarted. Repeated after the restart (#171), the same call took 3 swipes and passed.
  - This may deserve a note if it reproduces. I did not file one on a single occurrence.
- **Account Detail's transaction list took no swipes.**
  - Two coordinate swipes (l.2–3), `swipe up` (#14, l.4) and `scroll_until id:transactions.list.row_6` (#17, l.5–6) all left the list in place (`img-16-0.png`).
  - #17 said `failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken)`. WDA lists `scrollable id=transactions.list.container 0,180 402x694` with content `0,180 402x1925`.
  - The Transactions tab's list scrolled normally (#91). This looks app-side (mp-native), and averi's reply is accurate.
  - Because of it, C.2 was measured on the Transactions tab.
- **The bottom safe-area strip clips Account Detail's rows.** The list's visible content ends at about y 839 (`img-5-0.png`), but WDA reports the scroll view to y 874 and `row_4 24,816 354x53` with no flag. A tap on row_4 would press (201,842), which is blank. Not exercised, and nothing was tapped.
- **A row hidden under the SWIFT form's top bar was "Tapped", and the tap scrolled the form to its top.**
  - `tap text:"PAYMENT DETAILS"` (`24,58 108x16`, form scrolled) → `Tapped text:"PAYMENT DETAILS"` (#68, l.27 `78 66`).
  - The text lies behind the pinned navigation header (`_TtGC7SwiftUI32NavigationStackHosting 0,62 402x54`, listed before the scroll view), so it is not drawn (`img-73-0.png` shows the content starting below y ~116).
  - The tap scrolled the form back to the top (`img-70-0.png`), as a status-bar tap does, although (78,66) lies 4 pt below the 62 pt inset.
  - This is the known open case in `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md` ("a top bar … listed before the scroll view … is not seen"), so no new note.
  - The colour PASS #69 that followed was measured after this scroll-to-top, so it is not evidence about the status bar. I discarded it.
- **idb typing re-enables the hardware-keyboard prefs.** After `idb ui text` (l.52) the keyboard prefs read 1 again. A soft keyboard is kept only if text is typed by tapping its keys (I used `tap role:other label:Z`, l.59). The handoff's "a field of the sheet focused before Cancel" needs this.
- **The handoff selector `text:"add instant message"` matches 2 nodes on the sheet** (container + text, both at the cell rect now). `tap` refuses it as ambiguous (#100); `scroll_until` accepts it.
- **Not raw-saved:** filtered `ui_snapshot` calls on a screen whose full tree was already saved unchanged — #10, #12 (Account Detail), #37, #54, #62, #72, #74, #119, #145, #147. Where the screen differed, the raw tree was saved right after: `swift-scrolled2-wda.json` (#74), `contacts-sheet-focused-wda.json` (#119), `contacts-sheet-keyboard*-wda.json` (#145, #147). #62's filter (fees field after the sheet closed) has no raw tree.

### iOS: End state

- **mp-native:** left on Account Detail (Home tab) via SWIFT Back (#86) and tab taps (#88, #93). No payment was created. CONTINUE was never pressed. Fees stayed OUR and Priority Standard. Payee's country and the IBAN were left empty, and the form was left with Back. One PIN re-login (#27); no `login` rung, no registration.
- **Contacts:** 6 stock contacts and nothing saved (3 drafts discarded: #125, #138, #156). Nobody was called. After relaunches the app restored John Appleseed's card; I left it with Back.
- **Finportal:** the login screen in English, not logged in, modal closed (#165, `img-166-0.png`).
- **Safari:** on `http://127.0.0.1:47915/b.html`; the server is stopped.
- **Simulator:** foreground app Safari. Keyboard prefs `AutomaticMinimizationEnabled = 1`, `HardwareKeyboardLastSeen = 1`. WDA stopped (8100 closed). Metro :8081 still running. Only `37956039-…` booted. The averi daemon (pid 86016, port 47913) was left running as provided.
