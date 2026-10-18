# BUG: on Android a `tap` on a target cut to a sliver at its scroll container's edge is sent and reported "Tapped", and the app does nothing — a cover-cut sliver that size is refused

> **Status (2026-10-09):** open. Found by the round-6b device check (Android), averi `fix/round-6b` @ `5e5a3d1`. App-side cause not
> determined; what averi does with it is the finding.

## Summary

mp-native SWIFT form at rest: the "Payment details" toggle (`swift_payment.form.details_toggle`, a `FiSectionHeadline`, 132 px tall) reads
`66,1924 948x55` — cut by the form's scroll container bottom (1978); its button `66,1936 948x42`. `tap
id:swift_payment.form.details_toggle` → `Tapped id:swift_payment.form.details_toggle` (6.0 s), shim `input tap 540 1952` — and the section
does not expand (twice: 20:51:20, 20:52:50). With the toggle wholly on screen (`66,1793 948x132`) the same call taps `540 1859` and it
expands. Hand taps on the sliver (`540 1930`, `540 1940`, `970 1970` on the chevron's visible top) also do nothing — the visible strip
does not take taps, though nothing in the tree covers it (the CONTINUE bar `66,1979 948x132` starts below the container).

averi refuses a target with a 948x47 part showing beside a COVER (`only a 948x47 part of it shows, under the 65x65 a tap may be moved
to — scroll_until it first`), but sends a tap to a 948x55 part left by a CLIP, and reports success. A flow then runs on with the section
collapsed: the next step (e.g. a fill into `payee_name_input`) fails far from the cause.

## Repro

1. mp-native Account Detail → PAY → SWIFT payment, form at the top, keyboard down.
2. `ui_snapshot`: `details_toggle 66,1924 948x55`.
3. `tap { platform: android, selector: "id:swift_payment.form.details_toggle" }` → `Tapped …`, `input tap 540 1952`; `ui_snapshot` shows no
   `payee_name_input` (screenshot `run9-android/img-61-0.png`: the toggle row hidden but for the chevron's top above CONTINUE).

## Where

`src/interact/resolve.ts:517–557` (`refuseOffScreen`'s doc: "a node whose centre is on screen is tapped as before, however much of it is
clipped"); uiautomator hands Android nodes already cut to the container (`android.ts:1034`), so averi never sees that the 55 px is a sliver
of 132.

## Suggestion

Treat a target whose rect lies flush on its clipping container's edge (`scroll-rounds.ts#flushEdges` already finds that) and is smaller
than the move-to minimum (65 px here) like a cover-cut one: refuse with `only a 948x55 part of it shows at its scroll container's edge —
scroll_until it fully first; nothing was tapped`. Or scroll it in first, as the keyboard guard does for the IME.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**A2 — Holds (1–3); A2.4 recorded.** SWIFT form, scrollable `0,242 1080x1736`.

- **A2.1:** `details_toggle 66,1924 948x55` (children `other 'Payment details' 66,1936 948x42`, `other 926,1955 88x23`, `button 66,1936
  948x42`) → `tap id:"swift_payment.form.details_toggle"` (06:22:07) → `id:"swift_payment.form.details_toggle" is cut at its scroll container's
  bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across that edge, under the 65 a tap needs — scroll_until
  it first (if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it, or tap by coordinates);
  nothing was tapped` — verbatim as expected, no shim tap.
- **A2.2:** plain `scroll_until id:details_toggle` → `fully visible after 1 swipe` (7.9 s), `input swipe 540 1631 540 589 1044`, toggle
  `66,1793 948x132`; then `tap` → `input tap 540 1859`, the section expanded (`payee_name_input` appeared).
- **A2.3:** staged at the top edge, `details_toggle 66,242 948x56` → `tap` → `… is cut at its scroll container's top edge (container 0,242
  1080x1736); only a 948x56 part of it shows, 56 deep across that edge, under the 65 a tap needs — scroll_until it with direction: up first
  (…); nothing was tapped`; default `scroll_until` → `fully visible after 1 swipe`, `input swipe 540 589 540 1110 522` — content down, the
  turn at once.
- **The stated cut-leaf residual, seen:** `tap label:"Payment details"` (the toggle's child leaf, 948x42 at the edge) → `Tapped`, `input tap
  540 1957`, and the section does NOT expand — the original bug through the child. The refusal's own hint ("tap a child of it") leads to
  exactly this tap on this shape; worth a word in the hint (a child cut at the same edge is no better).
- **A2.4 — no whole element refused** on the screens touched: Settings' bottom row (`text_frame 154,1960 926x194`, `Storage`) → `Tapped`,
  `input tap 293 2041`, Storage opened; Contacts' bottom navigation and FAB tapped; the IME-cut Create contact form: the leaf `text
  'Company' 176,1373 190x25` (flush with the container's bottom, 1398) → `Tapped`, `input tap 271 1386`, the field focused.

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

A2 (round 8) holds on the SWIFT form.
- Bottom edge, fresh form: `details_toggle 66,1924 948x55`, `label 'Payment details' 66,1936 948x42`, scroll container `0,242 1080x1736`.
  - `tap id:"swift_payment.form.details_toggle"` → `… is cut at its scroll container's bottom edge (container 0,242 1080x1736); only a
    948x55 part of it shows, 55 deep across that edge, under the 65 a tap needs — scroll_until it first (if it is whole and only its own
    content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates); nothing was
    tapped`.
  - `tap label:"Payment details"` (the cut child, round 7's gap) → `label:"Payment details" is cut at its scroll container's bottom edge
    (container 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42 part of it shows, 42 deep across that edge, under the
    65 a tap needs — scroll_until it first (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap
    something in it that lies clear of that edge, or tap by coordinates); nothing was tapped` — verbatim the handoff. `text:"Payment
    details"` the same. No shim line for any of the three.
  - Plain `scroll_until label:"Payment details"` → `fully visible after 1 swipe` (`input swipe 540 1631 540 589 1044`); `tap` → `input
    tap 540 1859`, the section expands (`payee_name_input` appears). Repeated 3×, same.
- Top edge (section expanded, toggle cut by the form's top at 242):
  - toggle `66,242 948x26`, label `66,242 948x13`: `tap` toggle → `… cut at its scroll container's top edge … only a 948x26 part of it
    shows … — scroll_until it with direction: up first (…)`; `tap` label → `… as is the 66,242 948x26 it lies in; only a 948x13 part …
    scroll_until it with direction: up first …; nothing was tapped`. Plain (default `down`) `scroll_until label:"Payment details"` →
    `fully visible after 1 swipe`, the one stroke content down (`input swipe 540 589 540 1110 522`), toggle whole at `66,725 948x132`.
    Round 7's A2.3 holds.
  - At the threshold — toggle `66,242 948x65` (not a sliver), label `66,242 948x52`: plain `scroll_until label:"Payment details"` →
    `fully visible after 0 swipes`; with toggle 70 / label 57 a `tap label` → `Tapped`, `input tap 540 271`, which landed in the toggle's
    65+ px and toggled the section. Consistent with the rule (only a sliver ancestor passes its cut on); the "fully visible" wording for a
    52-px piece of a 107-px label is the stated residual (a whole-looking node cut at the edge).
- **Still tapped (A2.4):** Contacts › Create contact with the IME up: `tap label:"Last name"` (under the keyboard) → `Tapped label:"Last
  name" (the soft keyboard covered label:"Last name"; hidden before tapping)` (`keyevent 4`, `input tap 540 1489`); plain `scroll_until
  text:"Company"` → 1 stroke (`input swipe 540 1167 540 473 695`); `tap text:"Company"` → `input tap 271 924`, focus on the field at
  `[132,825][948,1001]`.


## Device check (2026-10-13 Android, re-run at 20307d2)

Measured 2026-10-13 17:10–17:58 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation — `settings get secure
navigation_mode` = 2, `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true`; Gboard docked unless stated), averi = mobile-verify
`arch/round-12` @ `20307d2` (detached; `dist/` built 17:07 UTC after the commit; stdio via the HTTP daemon on port 47881, cwd mp-native).
Strokes, taps and keys from the `adb` shim (`run12-android/adb-input.log`, times UTC); stagings by hand with the real `adb` (slow `input
swipe` drags, not in the shim log). Every call is in `run12-android/session.log` (`#N` below = call number there; images `img-N-0.png`).
At start mp-native showed the inactivity "Logged out" screen: LOGIN → Welcome → SIGN IN → `run_flow login_pin_android_here` (approved rung,
no `requires:`), done at 17:11. Scratch configs only; mp-native's `averi.yaml` untouched. Round 9's §3–4, round 10's §2–3, round 11's §3
and round 12's §3 were all run at this one hash. **Environment break at 17:33 UTC:** mp-native's backend began answering every GraphQL read
with `{"data":null,"errors":[{"message":"Received empty response body from subgraph \"gds-business\"","extensions":{"code":
"SUBGRAPH_RESPONSE_BODY_EMPTY"}}]}` (HTTP 200, `get_logs` #161, #180) — "Mandatory data not loaded / TRY AGAIN" on every tab, also after a
fresh PIN login (#223, 17:43). Not averi, not the VPN (no 403). The mp-native items not run before 17:33 (SWIFT form: A2, D1.2, smoke 1's
SWIFT field, D7.3) are Not reached on mp-native; on the owner's instruction (17:51) they were re-run on Google Contacts and on Finportal
(`sk.finportal.myport`, Expo dev build on Metro; its `~/dev/finportal/app/averi.yaml` passed as `configPath`; never logged in, nothing
submitted) where an equivalent shape exists — see `## Re-runs on Contacts / Finportal` below. The data also changed since round 8:
Account Detail now lists `row_0`…`row_36` (37 rows, was 31), so the handoffs' `row_29/30` / `row_30` shapes were measured on the rows that
now sit there (`row_35/36`).

Round 10 D1/slices item 2 and round 12 smoke 2 — **the SWIFT toggle is Not reached** (backend down from 17:33; the SWIFT form is reached
from Account Detail's PAY). The same verdict on Settings — **Holds:** `title 'Sound & vibration' 198,2149 428x5` at the list's bottom edge
(its `text_frame 154,2105 926x49`): #184 `tap text:"Sound & vibration"` → `text:"Sound & vibration" is cut at its scroll container's bottom edge
(container 0,640 1080x1514), as is the 154,2105 926x49 it lies in; only a 428x5 part of it shows, 5 deep across that edge, under the 65 a tap
needs — scroll_until it first (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it
that lies clear of that edge, or tap by coordinates); nothing was tapped` (4.5 s), no shim line. The "stuck `scroll_until` on a covered
sliver names the edge" half was not staged (no covered sliver at a container edge on the reachable screens).
- Round 11 smoke 4 / round 12 smoke 2 "a tap refused off screen" — **Holds.** #187 `tap text:"Security"` (clipped out below) → `Timed out
  after 5000ms waiting for element text:"Security" to appear (it matched only nodes clipped out below its scroll container (scrolled past it)
  — scroll_until it with direction: "down" first)`; #188 `text:"Connected devices"` (clipped out above) → the same with `direction: "up"`.


## Device check (2026-10-14 Android, re-run at ebe6822)

Round 16 Android device check, 2026-10-14 17:07:57–17:21:08 UTC, emulator-5554 (Pixel_3a AVD, Android 13 / API 33, 1080x2220, gesture navigation, `navigation_mode` = 2 before and after). averi built from `~/dev/mobile-verify` `arch/round-16` at `ebe6822`, checked with `git rev-parse --short HEAD` → `ebe6822` (read-only, detached), daemon on port 47911 via `$R/c`. Apps: mp-native `com.finshape.skeleton.dev` (first, already logged in by the owner, on Account Detail), Google Clock `com.google.android.deskclock`, Settings `com.android.settings`. **No PIN re-login was needed:** mp-native stayed logged in for the whole run. No `ensure_state`/`run_flow`, no `login` rung, no registration, no credentials typed, no `clearState`. **Backend: working.** Account Detail loaded balances (1,121.00 CZK / 2,000.00 CZK, "Account 1 of 4") and a full transaction list. Two transaction details opened with data. The SWIFT form loaded the debit account. No "Mandatory data not loaded" screen appeared. Calls #2–#92 are in `session.log`. The shim log `adb-input.log` has 66 lines, and every line cited below is quoted from it.

**carried r8 A2.1 + r10 D1.2: SWIFT toggle cut at the form's bottom. Holds verbatim.** I opened the SWIFT form via Account Detail → PAY (#45) → `accounts.detail.payment_type_sheet.row_swift` (#47). `details_toggle 66,1924 948x55`, with its label `66,1936 948x42`, above CONTINUE `66,1979` (`swift1.txt` #49, `img-48-0.png`).
- #50 `tap label:"Payment details"` →
  `label:"Payment details" is cut at its scroll container's bottom edge (container 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42 part of it shows, 42 deep across that edge, under the 65 a tap needs — scroll_until it first (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates); nothing was tapped`
- #51 `tap id:swift_payment.form.details_toggle` →
  `id:swift_payment.form.details_toggle is cut at its scroll container's bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across that edge, under the 65 a tap needs — scroll_until it first (if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates); nothing was tapped`
- Neither call produced a shim line.

**carried r8 A2.2: plain `scroll_until`, then the tap toggles the section. Holds for averi. The app now opens the section EXPANDED, which changes the visible effect.**
- #52 `scroll_until label:"Payment details"` → `Element label:"Payment details" fully visible after 1 swipe`, one stroke `17:14:37 input swipe 540 1631 540 589 1044`.
- #53 `tap label:"Payment details"` → `Tapped label:"Payment details"`, shim `17:14:48 input tap 540 875`. The tap landed on the label, which the stroke had moved to about 828–935 because the expanded section's payee/bank fields lie below it. The tap **collapsed** the section (`swift2.txt` #54: toggle `66,1793`, no payee fields; `img-55-0.png`, chevron down).
- #56 tapped it again (`17:15:27 input tap 540 1859`) and expanded it (`swift3.txt` #57, `img-58-0.png`).
- I confirmed this by repeating the sequence on a freshly opened form (#74–#77): the raw dump straight after `scroll_until` (`repro_after_scroll.xml`) shows `details_toggle [66,816][1014,948]`, the label at `[66,828][1014,935]`, and `payee_name_input … bank_city_input` below it. #77 tapped `540 882` (`17:18:23`), and the label then sat at `[66,1805][1014,1912]` (`repro_after_tap.xml`).
- So averi tapped the label where it was each time. On this build the form's initial state is expanded, so "the tap expands the section" reads "the tap toggles it".
