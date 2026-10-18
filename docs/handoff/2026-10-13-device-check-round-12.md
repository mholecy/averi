# Handoff: on-device check of round 12 (`arch/round-12` @ `20307d2`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 12 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 12 = `arch/round-11` (`896b275`) + **Spec D**, the architecture review's C3 (one keyboard position per look,
one tap judgement per look) and C8 (the tap judgement leaves `resolve.ts` for `interact/tap-judgement.ts`; the cut
and side phrases in a wording leaf `interact/target-text.ts`; the guard's look carries its scene). Every slice is a
refactor, proven behaviour-neutral by a differential harness against `896b275`: `scroll_until` rounds, tap and pixel
judgements, the dismissal picker, the whole keyboard guard (every adapter call and sleep, in order) and the keyboard
line — 0 differences. No reply should change.

**Order:** rounds 9, 10 and 11 were never device-checked. Run round 9's §3–4, round 10's §2–3 and round 11's §3
first **at this round's hash**, then section 3 below.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. Build

1. `git checkout arch/round-12` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge; results as `## Device check (<date>, re-run at <hash>)` at the end of the bug
note named in the item (items without a note go in the results table; failures go into a new bug note); commit only
notes, and only if the owner asks; leave `docs/architecture-reviews/` alone.

## 2. What changed

| id | change | where it shows |
|---|---|---|
| C3 | the keyboard's line has no adapter name (`{ y, witnessed }`); one keyboard position per look; one tap judgement per look | nothing: `tap`, `fill`, `scroll_until` and the keyboard guard reply as at round 11 |
| C8 | `resolve.ts` split (tap judgement module, wording leaf); the guard's look carries its scene | nothing: every reply as at round 11 |

## 3. Round 12 checklist (smoke — every reply must equal round 11's)

1. Android mp-native: a `tap` on a field under the open Gboard → the guard presses Back, then taps; `fill` into a
   field low on the screen; `scroll_until … fully: true` on Account Detail `row_30` stops as at round 11.
2. Android: a tap refused off screen; a tap on a row cut at a scroll container's edge → the cut sentence and
   "scroll_until it first" as before.
3. iOS idb SWIFT form: `tap` and `scroll_until` on `priority_select` under CONTINUE, and a row under idb's keyboard
   band → the reply names the band, `scroll_until`'s result still carries `keyboard.source: "idb-band"`.
4. iOS WDA: login with `dismissals: [tap id:login_title]` → picked, keyboard hidden; a text label next to its own
   field as a dismissal → refused "covered by …" as at round 11.
5. iOS WDA: a tap whose target is under the keyboard that clears on the second look → tapped, note as at round 11.
6. One `assert_color` per platform.

## 4. Out of scope

- Everything in section 4 of rounds 10 and 11's handoffs and section 5 of round 9's.
- Owner decision OD-3 (a): which nodes count as the keyboard's own UI still differs per verb (the tap and picker exempt
  a WDA key only from the reading's own questions; the scroll read exempts it from the whole cover). Unchanged here.

## 5. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| round 9 §3–4 at this hash | Android / iOS | | | |
| round 10 §2–3 at this hash | Android / idb / WDA | | | |
| round 11 §3 at this hash | Android / idb / WDA | | | |
| smoke 1–2 | Android | | | |
| smoke 3 | iOS idb | | | |
| smoke 4–5 | iOS WDA | | | |
| smoke 6 | Android / iOS | | | |


## 6. Device check results (2026-10-13, rounds 9–12 at `20307d2`)
Run by the device-check agents at this round's hash for rounds 9, 10, 11 and 12 together (see Order). Per-note results are appended to each bug note as `## Device check (2026-10-13 <platform>, re-run at 20307d2)`. mp-native's backend (`gds-business` subgraph, `SUBGRAPH_RESPONSE_BODY_EMPTY`) failed from 17:33 UTC; on the owner's instruction the items it blocked were re-run on Google Contacts / iOS Contacts / Settings and the FinPortal app (`sk.finportal.myport`, Expo dev build with Metro; never logged in, nothing submitted). D7.2 (3-button navigation) was run on the owner's approval and gesture navigation restored.
New bug notes: `2026-10-13-android-fab-host-layer-refuses-taps-beside-the-fab.md`, `2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md`, `2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md`, `2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md`, `2026-10-13-ios-idb-quicktype-bar-lies-above-the-keyboard-band-and-is-tapped.md`.

### Android: Re-runs on Contacts / Finportal (owner's instruction, 17:51–17:58 UTC)

Finportal first showed a stale redbox ("Unable to load script", #232–#236 — see Gaps); after `terminate_app` + `launch_app` (Metro up) it
showed its login screen (`login_screen 0,0 1080x2220`, a scroll view to the screen's bottom). Never logged in; only the forgot-password modal
was opened and closed; the password field was typed into with a dummy and cleared; nothing submitted.

- **A2 (cut child of a section control) — Holds, Contacts.** Create contact, IME down, `Add email` staged at the editor's bottom edge:
  outer wrapper `132,2112 948x42` (cut at the form's bottom 2154), inner `132,2112 816x108` (not clipped by uiautomator), text `Add email
  495,2151 179x3`. #264 `tap text:"Add email"` → `text:"Add email" is cut at its scroll container's bottom edge (container 0,242 1080x1912), as
  is the 132,2112 948x42 it lies in; only a 179x3 part of it shows, 3 deep across that edge, under the 65 a tap needs — scroll_until it first
  (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge,
  or tap by coordinates); nothing was tapped` (4.6 s, no shim tap). #265 plain `scroll_until` → `fully visible after 1 swipe`, `17:56:57 input
  swipe 540 1772 540 624 1150`; #266 `tap` → `Tapped`, `17:57:07 input tap 585 971`, an Email field appeared. Editor cancelled (no prompt).
- **D1.2 cut sentence — Holds** on Contacts (above) and Settings (#184). The "stuck `scroll_until` on a COVERED sliver names the edge" half:
  Not reached (no sliver both cut and covered at an edge it cannot leave on these apps).
- **Round 12 smoke 1 — Holds, Finportal.** Username focused (Gboard docked, `touchableRegion=SkRegion((0,1332,1080,2022))`; the window is
  not resized): #246 `tap id:login_forgot` (`315,1642 450x110`, centre under the keyboard) → `Tapped id:login_forgot (the soft keyboard covered
  id:login_forgot; hidden before tapping)` (9.5 s), shim `17:54:13 keyevent 4`, `17:54:17 input tap 540 1637` — Back first, then the button
  re-resolved after the page settled; the forgot-password modal opened. `fill` into a field low on the screen: #252 `type_text
  id:login_password "probe1" clear` → `Filled id:login_password (6 characters)` (9.0 s; `input tap 540 1181`, six `input text`, the field then
  `val='••••••'`) — **the Android password field round 8 could not reach: the masked read-back is verified by length**; #254 clear → `Filled
  id:login_password (0 characters, cleared 6 characters first)`; #255 `ab` without clear → `(2 characters)`; #256 clear → `(0 characters,
  cleared 2 characters first)`; the field ends empty.
- **M — not reachable (Finportal).** The forgot-password modal is an RN `Modal` in its own window (`forgot_overlay 0,0 1080x2220`,
  `forgot_modal 44,698 992x605`, `forgot_close 372,1978 336x132`): the login screen beneath is not in the dump, so #249 `tap id:login_submit` →
  `Timed out after 5000ms waiting for element id:login_submit to appear` (never tapped through); the modal holds no scroller. #250 OCR on
  `forgot_close_label` (just above the navigation bar) → `read "Close"` PASS; #251 `tap id:forgot_close` → `input tap 540 2044`, closed.
- **S / F / S2 on Finportal — not reachable** without logging in (the login screen has no snackbar, FAB, sheet or list).
- **D7.3 — Not reached** on these apps (nothing of theirs is drawn below 2154).

### Android: TABLE

| round | item | result | evidence |
|---|---|---|---|
| 9 | round-8 regression (§3) | **holds** — §3.1 sticky header (cutBounds 88, tap at centre below header, `fully` 1 stroke identical to round 8), §3.2 only rows at the tab-bar host carry cutBounds, §3.3 padded icons + Add phone/Add fields with the IME up, §3.4 N1 verbatim, B1 verbatim; A2 on the SWIFT form not reached (backend down) — **holds on Contacts** (`Add email` cut child refused verbatim, 1 stroke, tap adds the field, #264–#266) | #10–#21, #38, #43–#67, #88–#93, #149–#150 |
| 9 | W web view scrolls | not run (iOS item; Android optional) — the only Android web view met (Google Assistant Routines page in the Google app, opened from Clock) has no native bar over it; its `Maybe later` button tapped (#119, #134) | — |
| 9 | S snackbar over a list | **holds (S.1); S.2 partly; S.3 not reachable** — Clock "Alarm set for 13 hours…" snackbar (host `container 0,0 1080x2220`, `snackbar_text 66,1447 948x135`): no `cutBounds` on any row, `delete 88,1379 279x132` overlapping it carries none (#128 `snapS1.txt`); #132 `tap id:workflow_label` (just above it) → `input tap 540 1313`, the row's own action opened — the snackbar's presence at that instant not confirmed (≈ 4 s after it showed); this snackbar has no action (no Undo) | #127–#135, `img-129-0.png` |
| 9 | F FAB over a list | **holds as worded, new bug** — Clock alarms, `fab 408,1626 264x264` in `fab_container 0,1582 1080x352`: no row carries `cutBounds` (F.1); `workflow_label` (centre under the FAB) refused naming `button "Add alarm"` (F.2), but every element whose centre is CLEAR of the FAB inside the FAB host's band is refused or treated as covered by `container id:fab_container` → `2026-10-13-android-fab-host-layer-refuses-taps-beside-the-fab.md` | #105, #109, #110, #124, #126, `img-106-0.png`, `img-125-0.png` |
| 9 | M scroller in a later layer | not reachable on Android — Finportal's forgot-password RN Modal (`forgot_overlay 0,0 1080x2220`) is its own window: the login screen beneath is not in the dump (`tap id:login_submit` → `Timed out … to appear`, #249), and the modal has no scroller | #249, `snapF6.txt` |
| 9 | S2 sheet with a classic list | not reachable — Contacts' "Choose fields to add" sheet is its own window: the editor beneath is not in the dump, so no row beneath can be targeted | `snapS2.txt` |
| 9 | optional: bottom-sheet scrim | not reachable — same (dialog window; the dump has only the sheet and a `Close sheet 0,2110 1080x110` node) | `snapS2.txt` |
| 10 | round 9 §3–4 at this hash | as the round 9 rows above | — |
| 10 | smoke (§2.2) | **holds** — tap (#13), scroll_until (#11, #21), assert_color (#35) as round 9 apart from the D7/P1 changes | — |
| 10 | D7.1 row_4 refused → scroll → tap | **holds** — refused verbatim "under the navigation bar at (540,2186) …", 1 stroke, tap `540 1537` opens the detail | #10, #11, #13 |
| 10 | D7.2 3-button nav | **holds** — bar `0,2088 1080x132`; no averi input below y 2000; OCR on a text ending at 2088 fails closed naming the bar "from y 2088"; colour measures; `fully` 1 stroke; gesture nav restored | #274–#287, `d72-3btn.png`, `d72-restored.png` |
| 10 | D7.3 gesture tap at 2186 | not reached — mp-native backend down; Contacts, Settings, Clock and Finportal draw nothing tappable below 2154 (their scroll containers / tab items end at 2154; Finportal's login screen is empty there) | — |
| 10 | D7.4 Settings flush OCR / colour / fully | **holds** — OCR fails closed "may be cut at the navigation bar … scroll it up", colour measured, `fully` 1 short stroke, OCR passes | #143–#146 |
| 10 | D7.5 Account Detail rows in the bar | **holds** — "the navigation bar is drawn over the element (element 66,2069 948x143, navigation bar 0,2154 1080x66)" | #31 |
| 10 | D7.6 Contacts "Add fields" | **holds** — OCR fails closed at 12 and 51 of 55 px; `fully` 1 stroke; then read "Add fields" | #77–#84 |
| 10 | D7.7 pinned bottom bar still measured | **holds** (closest shape: Contacts tab item ending at 2154, colour + OCR measured) | #50 |
| 10 | D7.8 immersive app | not reached (Camera hides only the status bar) | #152 |
| 10 | P1.1 row_30 fully then pixel passes | **holds** on `row_36` (last row now): 1 stroke, colour PASS | #33, #35 |
| 10 | P1.2 plain stop unchanged | **holds** — `fully visible after 0 swipes`, no stroke | #29 |
| 10 | P1.3 pinned surfaces stop at once | **holds** (Android bottom surface `bottom_nav`: 0 swipes, pixel fails closed "its content above the bar, say"); top full-bleed bar not reachable (Contacts' bar is scroll content: `fully` fails after 5 strokes, 16.5 s, honest wording) | #50–#52 |
| 10 | D2.7 WDA / Gboard unchanged | **holds (Android)** — floating Gboard: Back then tap; strokes above the panel; Notes beside the panel (residual) | #168, #169 |
| 10 | D1 / slices 1–4 | **2: holds on Settings and Contacts (cut sentence, "as is the … it lies in"), SWIFT not reached; stuck-covered-sliver wording not staged; 3: holds** (Contacts app bar (256,3) refused verbatim); 1, 4 iOS | #184, #264, #88, #89 |
| 11 | round 9 §3–4 at this hash | as above | — |
| 11 | round 10 §2–3 at this hash | as above | — |
| 11 | smoke 1 (Android row_30 fully / plain) | **holds** (row_36) | #29, #33 |
| 11 | smoke 4 (Android assert_color, tap off screen) | **holds** | #35, #187, #188 |
| 12 | round 9 §3–4 at this hash | as above | — |
| 12 | round 10 §2–3 at this hash | as above | — |
| 12 | round 11 §3 at this hash | as above | — |
| 12 | smoke 1–2 | **holds** — tap under docked Gboard: Back then tap (Contacts #201, Finportal `login_forgot` #246); `fill` into a low field: Finportal password `Filled id:login_password (6 characters)` and clears (#252–#256); `fully` on the last row as round 11 (#33); off-screen refusal (#187/#188); cut sentence + "scroll_until it first" (#184, #264). SWIFT form not reached (backend down) | #33, #184–#188, #201, #246, #252–#256, #264 |
| 12 | smoke 6 | **holds (Android)** | #35, #50 |

### Android: Gaps and observations

- **D7.2 not run by this agent (later run by the coordinator, see the D7 section above).** The coordinator relayed at ~17:50 and ~17:52 that the owner approved switching to 3-button navigation. My hard rules
  reserve navigation-mode changes for the owner, and a relayed agent message is not the owner's own approval, so I did not change the overlay.
  The device stays on gesture navigation (`cmd overlay list | grep navbar` → `[x] com.android.internal.systemui.navbar.gestural`, the other
  five `[ ]`; `navigation_mode` 2). The owner can confirm directly to have it run.
- **Dump ≠ screen on Finportal's first launch (an app/launch state, recorded):** the dump held the RN redbox (`rn_redbox_stack 0,66
  1080x1934`, DISMISS/RELOAD) while the screen showed the Expo splash (`img-233-0.png`, `img-239-0.png`): `dumpsys window windows` listed
  `Window{… Splash Screen sk.finportal.myport}` ABOVE the focused MainActivity windows, all `isOnScreen=true`. uiautomator dumps the focused
  window, so averi judged a hidden tree: #235 `tap text:"then"` → `Tapped`, `input tap 540 1998` onto the splash; #236 colour on
  `rn_redbox_reload_button` sampled the splash background `#EAEEEF`; OCR → `the recognizer read no text in this element rect …` (honest). The
  Android counterpart of `2026-10-08-ios-launch-transition-tree-reads-as-rendered.md`; a starting window that never leaves is not in the dump.
  Not filed as a new note (an app that never finished loading), owner's call.
- **A 4-px leaf at a scroll container's edge is tapped (the stated "Unknowable" residual, reached):** in that redbox tree `text 'then' 44,1996
  992x4` lay flush with `rn_redbox_stack`'s bottom (2000) inside a wrapper cut to `0,1974 1080x26`. #235 tapped it at (540,1998). By
  `geometry.ts#evidentCut` the wrapper shows no evidence (its only descendant across the edge is 4 px, under `MIN_INSIDE_EVIDENCE` 8), and the
  leaf has none of its own — the residual the source states ("a cut node with no descendants … reads whole"). Recorded for the owner; the tap
  here would have done nothing even on a visible redbox.
- **Backend outage (not averi):** from 17:33 UTC every mp-native GraphQL read returned `SUBGRAPH_RESPONSE_BODY_EMPTY` from `gds-business`
  (`get_logs` #161/#180/#216); still failing at 17:55 after a fresh PIN login (#223). Not reached because of it: round 8/9 A2 on the SWIFT
  form, round 10 D1.2's SWIFT toggle `66,1924 948x55`, round 12 smoke 1's SWIFT field under Gboard and `fill` low on the form, D7.3's raw tap
  at 2186 on a row. Shapes measured on Contacts/Settings instead where they exist (above).
- **"fully visible" for a node cut at the navigation bar (residual, as round 8 reported):** a plain `scroll_until` stops at 0 swipes and says
  `fully visible` on `row_36 66,2069 948x143` (58 px under the bar), on `Add fields 198,2103 180x51` (51 of 55) and on `Sound & vibration
  198,2105 428x49` (49 of 74). The OCR assert on the same node now refuses (D7.4/D7.6), so the pair is consistent in behaviour, but the
  stop's wording claims more than shows. The tool text states the centre rule; flagged for wording only.
- **Ambiguity list is capped silently:** #185 `tap id:icon_frame` → `Selector matches 6 elements` then lists 5 (`src/interact/resolve.ts:193`
  `.slice(0, 5)`) with no "…and 1 more". Cosmetic.
- **Fail-closed pixel asserts are slow** (13.6–16.5 s each vs 2.7–3.0 s for a pass), unchanged since round 8.
- `screenshot` warned `the screen did not settle: 6 captures …` on mp-native's loading spinner and on Gboard's toolbar animation (#166,
  #211, #215) — correct.
- `tap` on a label inside an expanded Clock card worked by its `label` with the U+200A hair space (`label:"9:00 AM"`).
- Round 9 S.2 is only partly proved: the tap just above the snackbar landed on the row, but the snackbar ("Alarm set for …", no action) may
  have left before the tap (≈ 4 s; each averi call takes ≈ 4.6 s). S.3 needs a snackbar with an action (Undo); none reachable without
  deleting data.
- Clock alarms were toggled on/off three times for the snackbar and left OFF (both 8:30 and 9:00, `img-137-0.png`), the 8:30 card collapsed
  again; the Assistant "Routines" promo was dismissed with "Maybe later" twice (it records nothing beyond the dismissal).
- My hand drags: a 3-s 60–100 px drag on the Create contact form was taken as a long-press (a "Select all" popup on the phone field;
  dismissed by a tap on empty space, nothing typed or selected).
- The round-8 `row_29/30` and `row_30` shapes moved: the shared account now returns 37 transactions; measured on `row_35/36`.

### Android: End state

At 17:58 UTC: mp-native in front, **logged in** (tab host after the 17:43 PIN login, `nav.tab_home` present) but showing "Mandatory data not
loaded / TRY AGAIN" — NOT Account Detail with data: the backend's `gds-business` subgraph still returns an empty body (owner: leave it, no
more PIN logins). Keyboard down (`mInputShown=false`), Gboard docked (restored at ~17:35 after the floating check; docked region on the
next focus `(0,1332,1080,2022)` as before). Gesture navigation unchanged (overlay `gestural` enabled, `navigation_mode` 2). Google Contacts on
its list, still only Abdulla and Sherzod (every editor cancelled or discarded). Settings unchanged (only scrolled). Clock: both alarms OFF as
found, cards collapsed, app terminated; the Assistant Routines promo dismissed with "Maybe later". Camera terminated (NEXT not pressed).
Finportal on its login screen, password field empty, not logged in; Metro left running. Daemon on 47881 left running. No averi source,
mp-native file, `averi.yaml`, handoff or bug note edited.

Addendum 18:03 UTC (coordinator): D7.2 run on 3-button navigation and gesture navigation restored (overlay `gestural`, `navigation_mode` 2, bar `0,2154 1080x66`); Settings closed, Contacts on its list. Metro: one instance (pid 52567, started by the iOS agent; the coordinator's duplicate exited on the busy port).

### iOS: Follow-up 17:51–17:59 UTC — Finportal (`sk.finportal.myport`), at 20307d2

Owner update: mp-native's backend stopped answering, so mp-native was not touched after 17:37. Finportal (Expo dev build) was run
on Metro at localhost:8081: I started it in the background from `~/dev/finportal/app` (`npx expo start --dev-client --port 8081`,
pid in `run12-ios/metro.pid`, log `metro.log`), and the coordinator says Metro stays running. Finportal was terminated and launched
again, which landed on its login screen. There was no login, no submit, no language change and no clearState. Config: a copy of
`~/dev/finportal/app/averi.yaml` (`treeSource: wda`) as `fp-cfg.yaml`, plus `keyboardDismiss` variants:
- `fp-title.yaml`: `login_title`
- `fp-wrappers.yaml`: `login_username_field`, then `login_password_field`
- `fp-wrappers-title.yaml`: both wrappers, then the title
- `fp-label.yaml`: `login_username_label`
- `fp-logo.yaml`: `login_logo`

The software keyboard was raised with the prefs at 0 (17:53, Finportal relaunched) and restored to 1 at 17:58:50. The WDA tree of the
login screen is `FP-login-wda.json`; with the keyboard up, `FP-wda-kb.json` (WDA `keyboard 0,546 402x328`, which includes a 44-pt
QuickType bar) and `FP-idb-kb.json` (the idb band is `other 0,590 402x284`, and the QuickType `button 'Passwords' 30,546 342x44` lies
above it).

**C2.1 / round-12 smoke 4–5 (login with `dismissals: [tap id:login_title]`), Finportal WDA: holds.** QWERTY up on `login_username`.
With no dismissals (`fp-cfg`), 17:55:11 `tap id:login_support_text` (`16,699`) was refused: `The soft keyboard covers
id:login_support_text: the band it draws over [0,546][402,874] contains the tap point (201,719) …, and no dismissal is configured.
Nothing was tapped …` (5.4 s). With `fp-title`, 17:55:17 the same tap → `Tapped id:login_support_text (the soft keyboard covered
id:login_support_text; hidden by tapping id:"login_title" before tapping)` (8.4 s; shim `201 303`, then `201 719`; the keyboard was gone).

**C2.7 (field wrappers as dismissals), Finportal WDA: holds.** With `fp-wrappers`, 17:55:47 → `… none of the configured dismissals is
usable on this screen (tap id:"login_username_field": covered by container; tap id:"login_password_field": covered by container).
Nothing was tapped …` (5.0 s, no shim tap). With `fp-wrappers-title`, 17:55:35 → both wrappers skipped, then `hidden by tapping
id:"login_title"`, tapped (shim `201 303`, `201 719`).

**Label next to its field (C2.5 shape), Finportal: picked.** `login_username_label 36,339 330x20` sits at the top of its wrapper
`login_username_field 36,339 330x80` (a container, listed after it; the textfield `90,383` does not hold the label's centre). With
`fp-label`, 17:55:52 → `Tapped … hidden by tapping id:"login_username_label" before tapping` (shim `201 349`). No control was pressed,
so this is consistent with ADR 0016: the label is refused only when an interactive node holds its centre.

**C2.6: not reached.** No title on these screens shares its rect with a labelled button. Finportal's same-rect pairs are a text and a
container (`login_support_text` / `login_support`), or a button and its own flag container. A text inside its own button
(`login_submit_label`) was not configured, because a dismissal tap there would press "Log in".

**Round-11 smoke 3 (WDA row under the keyboard band, scroll_until asks the witness), Finportal: holds.** Keyboard up,
`login_support_text` at `16,699` (under the band at 546). 17:56:14 `scroll_until id:login_support_text` → `Element id:login_support_text
fully visible after 1 swipe` (5.8 s). The single stroke was `201 437 → 201 109`, above the band; the row ended at `16,368` with the
keyboard still up (`FP-wda-after-scroll.json`). No "judged above the soft keyboard" clause appears, because the band did not change
the stop.

**P1.3 iOS (pinned screen-sized surface), Finportal WDA: holds.** 17:56:50 `scroll_until id:login_screen` (`0,0 402x874`) with
`fully: true` → `Element id:login_screen fully visible after 0 swipes` (0.7 s, no stroke). An OCR assert on it fails closed: `the
status bar is drawn over the element (element 0,0 402x874, status bar 0,0 402x62) — … — assert something in it that lies clear of that;
no scroll moves the screen itself out from under it; failing closed, rendered text unchecked`. No hero image laid from y 0 exists on any
reachable screen.

**D2.4 (lone QuickType suggestion), Finportal idb: FAILS. New note below.** On the first focus after a launch, iOS showed the QuickType
"Passwords" bar. idb lists it as `button 'Passwords' 30,546 342x44`, ABOVE its band node `other 0,590 402x284` (WDA's keyboard frame
starts at 546 and includes it). 17:54:45 `tap role:button text:"Passwords"` → `Tapped role:button text:"Passwords"` (shim `201 568`).
The keyboard then closed; no AutoFill sheet appeared (`img-226-0.png`). With the bar up, idb also drops `login_submit` (`36,547
109x48`, under the bar) from its tree. The bar did not come back on later focuses, so the WDA side of this was not reached.

**D2.1 / D2.2, Finportal idb: not reached.** With the keyboard up, idb lists no app node under its band, neither at rest nor scrolled
(`FP-idb-kb-scrolled.json`). The screen's content ends before the keys.

**M (full-screen modal over a native control), Finportal WDA: FAILS. New note below.** "Reset account" opens `ForgotPasswordModal`, an
RN `transparent` `Modal`. WDA lists it after the screen as `container id:forgot_overlay 0,0 402x874` (a dimming tint), `container
id:forgot_modal 16,301 370x220` (the card) and `button forgot_close 140,776 122x48` (`FP-forgot-wda.json`).
- 17:57:29 `tap id:login_title` (centre under the card) → `id:login_title is under container id:forgot_modal (16,301 370x220) at its
  centre (201,303), drawn over it; only a 330x10 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first;
  nothing was tapped`. The "330x10 part" that shows lies under the dim overlay.
- 17:57:32 `tap id:lang_sk` (`268,235 43x32`, under the dim overlay only) → `Tapped id:lang_sk` (3.3 s, shim `290 251`). The overlay
  swallowed the touch and the language stayed English (`img-253-0.png`).
- idb lists only the modal's content (`FP-forgot-idb.json`); `tap role:text text:"Login"` → `Timed out … to appear`.
- The modal was closed with `forgot_close` (shim `201 800`).
- The web-view-in-a-modal variant was not reached: neither Finportal nor any other app here has an in-app web view, and a local web
  page cannot put a native layer over a native control.

### iOS: TABLE

| round | item | result | evidence |
|---|---|---|---|
| 9 | W web view scrolls | iOS WDA: **holds**; idb: holds (no web content seen); Android n/a | Safari `b.html` scrolled, bar expanded, `BackButton 34,792 48x48` over `Link number 15 32,811`: WDA `Tapped id:BackButton` (l.76 `58 816`, page A shown); idb same (l.79). W.2 link `32,27`: WDA refused `… it lies in a scroll view — scroll_until it first …`; idb `Timed out … to appear` (idb lists no web content). W.3: `W3-wda-b-scrolled.json`, `W1-wda-b-bar-over-scrolled.json` (`webview id=WebView 0,0 402x874` → 2 nested `webview` → `container 'Page B' 0,-98 402x3480` → `other`/`text` per link; bar = `CapsuleViewController` listed after). Safari on iOS 27 has no top bar: the native bar is the bottom capsule, minimised while scrolled |
| 9 | M scroller in a later layer | iOS WDA: **holds** where layer content holds the point; **fails** where only the layer's bare background/dim lies over it (Contacts sheet; Finportal RN transparent Modal) → 2 NEW notes; web-view-in-modal not reachable | Contacts: `Contact photo for Hank` → `under container "add email" … nothing was tapped`; `Contact photo for Kate Bell` → `Tapped` (l.72 `41 290`, swallowed by the sheet). mp-native fees sheet (identified container) refused. Finportal: `login_title` → `under container id:forgot_modal …; nothing was tapped`; `lang_sk` under `forgot_overlay 0,0 402x874` → `Tapped id:lang_sk` (shim `290 251`, swallowed; language unchanged). M.2/M.3 hold (SWIFT Back tapped idb/WDA; trees `M3-wda-swift-scrolled.json`, `M2-idb-swift-scrolled.json`) |
| 10 | round 9 §3–4 at this hash (iOS) | as rows above | — |
| 10 | smoke §2.2 idb / WDA | **holds** | idb: tap refusal `row_3` (round 8 verbatim), tabs tapped, colour PASS, `scroll_until` slice 1 1 stroke; WDA: same refusal, colour PASS, slice 1 1 stroke |
| 10 | P1.3 pinned surfaces (iOS) | **holds** (Finportal WDA, screen-sized `login_screen`); no hero image anywhere | `scroll_until id:login_screen fully` → `fully visible after 0 swipes` (0.7 s); OCR → `the status bar is drawn over the element … assert something in it that lies clear of that; … failing closed`. idb Contacts root (covered by its own rows) → 3 strokes, "layout defect" — recorded |
| 10 | D2.1–D2.6 idb keyboard band | D2.3, D2.5, D2.6 **hold**; D2.4 **fails** (Finportal: QuickType "Passwords" lies above idb's band and is tapped) → NEW note; D2.1, D2.2 **not reached** (idb omits every node whose centre is under the band; SWIFT form, Contacts and Finportal alike) | `D2-idb-numpad*.json`, `D2-idb-qwerty.json`, `D2-contacts-kb.json`, `FP-idb-kb.json`; l.41–46, 53–55, 58; Finportal `tap role:button text:"Passwords"` → `Tapped` (shim `201 568`) |
| 10 | D2.7 WDA unchanged | **holds** (SWIFT form; RN login unreachable) | `The soft keyboard covers label:"Payee’s name": the band … [0,572][402,874] … and no dismissal is configured. Nothing was tapped` |
| 10 | D1 / slices 1, 3, 4 | **hold** (idb + WDA) | slice 1 on `payee_country_select 24,775/776` (form layout changed); slice 3 `(201,6)` refused; slice 4 from `24,-20` 1 stroke to `24,530` |
| 10 | F1 capture | **recorded — cause measured** | `F1poll/171636-311.json`: `Button:TextFieldWithComponentStyle` (clear button) absent between clear and retype; `F1-before.json`, `F1-after.json`; reply `… NOT verified: … (the screen changed while typing)` |
| 11 | round 9 §3–4, round 10 §2–3 at this hash | as rows above | — |
| 11 | smoke 2 idb `priority_select` under CONTINUE | **holds** (stand-in row) | slice 1 rows |
| 11 | smoke 3 WDA row under the keyboard band | **holds** (Finportal) | keyboard up, `login_support_text 16,699` → `fully visible after 1 swipe`, one stroke `201 437 → 201 109` above the band (546), row `16,368`, keyboard still up. (mp-native attempt exposed the hidden-tab-bar bug: `wda-more.json`) |
| 11 | smoke 4 assert_color + off-screen tap | **holds** | colour PASS idb/WDA; `label:"My note" is off screen at (72,1102) …` |
| 11 | C2.1–C2.4 picked | C2.1 **holds** (Finportal `login_title`), C2.2, C2.3 **hold**; C2.4 holds for a non-interactive row, interactive row skipped per ADR 0016 residual 1 | Finportal `hidden by tapping id:"login_title" before tapping` (shim `201 303`, `201 719`); mp-native l.47–48, 51–52, 61; `wda-C24.json`; `img-103-0.png` |
| 11 | C2.5–C2.7 refused/skipped | C2.5 **holds** (`covered by textfield`); C2.7 **holds** (Finportal wrappers `covered by container`); C2.6 **not reached** | Finportal `(tap id:"login_username_field": covered by container; tap id:"login_password_field": covered by container)`; Finportal label at its wrapper top picked (no interactive node at its centre) |
| 12 | round 9 §3–4, round 10 §2–3, round 11 §3 at this hash | as rows above | — |
| 12 | smoke 3 iOS idb | **holds** | `priority_select` under the band: tap times out (absent), `scroll_until` names `the soft keyboard was up over [0,589][402,874] in 5 of the 5 rounds read`, strokes from 472; `keyboard.source` not visible in the MCP text |
| 12 | smoke 4–5 iOS WDA | **hold** (login with `login_title` dismissal picked + keyboard hidden + tapped, on Finportal; label next to its field refused `covered by textfield` on mp-native) | C2 rows |
| 12 | smoke 6 assert_color iOS | **holds** | idb `#EDEFF2`, WDA `#3F3F50` PASS |

### iOS: Gaps and observations

- **Not reached (after the Finportal follow-up):**
  - C2.6: no title shares its rect with a labelled button.
  - D2.1/D2.2: idb omits every node whose centre lies under its band, on the SWIFT form, Contacts and Finportal alike.
  - P1.3 hero image: none exists. The pinned-surface rule was checked on Finportal's screen-sized `login_screen` instead.
  - M with a web view in a modal: no app here has an in-app web view.
  - D2.4 under WDA: the QuickType bar did not show again.

  Reached on Finportal: C2.1, C2.7, round-12 smoke 4–5 (login part) and round-11 smoke 3.
- **Account Detail now scrolls on iOS** (round 8: static) with a collapsing header; idb plain `scroll_until row_3` from rest: the first
  stroke `201 699 → 201 175` flung `row_3` from 721 to −503, the turn strokes `201 175 → 201 437` (l.12–15) did not move the list at all —
  y 175 lands on the pinned header's background (search 67–115, PAY row 120–165, the header surface to ~183, not in idb's tree); a manual
  `201 175 → 201 437` also did nothing, `201 300 → 201 800` did. The reply was honest ("did not move it: content exhausted, or the swipes
  were not taken"); recorded for the stroke-start choice, not filed.
- **mp-native "That's an error"** on Account Detail at 17:11 (VPN fine: gateway 400; TRY AGAIN did not help) — the session had expired
  server-side (the Android agent shares the test account); PIN re-login fixed it. Not averi.
- idb read right after the exit-confirmation dialog closed was bare (2 nodes, the bare-tree ⚠) — transient; the next read was full.
- The keyboard-band refusals/asserts under idb still advise configuring `app.ios.keyboardDismiss` ("the guard taps the first one on
  screen") and mention "WebDriverAgent's keyboard/dismiss fails", though under idb the list is inert — wording only.
- WDA `fees_select` tap after hiding the keyboard landed at `201 677` (round 8: 639) because the amount `5,00` adds the "will remain"
  line — app layout, not averi.
- The country picker opened by the moved WDA tap received two `scroll_until` strokes (l.85–87) from my next calls before I saw it; no
  country was selected (closed by a grabber swipe, field still "Payee’s country").
- Timings: cold WDA first call 10.5 s; WDA dismissal taps 10.5–10.9 s; Contacts dismissal "still up" 27.6 s; fail-closed colour asserts
  4.6–6.6 s with a 4–5 s timeout.

### iOS: End state

17:59 UTC: Finportal is in the foreground on its login screen, keyboard down, language English, nothing typed into or submitted from
its fields, no login. Metro (`npx expo start --dev-client --port 8081`, started by this agent, pid in `run12-ios/metro.pid`) is left
running as the coordinator asked. mp-native has not been touched since 17:37 and stays in the background on Account Detail (Home tab,
logged in at that time; its backend is reported down). The SWIFT form was discarded earlier: no payment was made and CONTINUE was never
pressed. WDA is stopped (xcodebuild killed, port 8100 closed). The web server is stopped (port 47891 closed). The keyboard prefs
`AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` are back to 1. Contacts is unchanged (nothing saved, no call). Settings was
never opened. Safari holds a tab of the stopped local page A.


**Follow-up (2026-10-14):** the mp-native items this round could not reach during the backend outage were run on Android at `ebe6822` once the backend was back; see round 16's handoff §5 and the bug notes' `re-run at ebe6822` sections.
