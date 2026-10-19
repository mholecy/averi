# BUG: on Android an OCR assert on a text the app draws under the gesture navigation bar reads its cut glyphs as a text mismatch

> **Status (2026-10-12):** open. Found by the round-8 device check (Android), averi `fix/round-8` @ `0ff6df3`. The bottom counterpart of
> round 8's N1/N2: averi now reads Android's status bar from the window insets but not the navigation bar.

## Summary

Settings draws its list behind the gesture navigation bar (`dumpsys window displays`: `InsetsSource type=ITYPE_NAVIGATION_BAR
frame=[0,2154][1080,2220] visible=true`; `settings get secure navigation_mode` = 2). uiautomator clips every node to the window's
visible frame, so a row title whose glyphs run on below y 2154 is dumped as `text id=title 'Sound & vibration' 198,2105 428x49` (its laid
height is 74 — the same row reads `198,2031 428x74` higher up). The screenshot shows the whole word "Sound & vibration" there, with the
navigation handle drawn just under it. averi crops the dumped rect:

- `assert ocr { text: "Sound & vibration" }` → `FAIL element text:"Sound & vibration" renders text "Sound & vibration" — read "Colnd &
  vibration"; vs expected "Sound & vibration" ≠` (25 s; twice). With `heightPct: 2.5` it also reports `ink height 3.43% of width` — of the
  cut glyphs.
- The failure blames the rendering, where the cause is that the crop stops at the navigation bar's top edge; no "cut"/"covered" wording,
  nothing says to scroll it up. A colour assert on the same node samples only the clean top 49 px and passes.
- Plain `scroll_until text:"Sound & vibration"` → `fully visible after 0 swipes` on the 49-of-74 node (the list scrolls further).

The tap is fine: `tap` → `input tap 412 2130`, inside the visible part, the Sound screen opened.

## Repro

1. Settings home, drag the list so the last visible row's title sits on the navigation bar's top edge (here `input swipe 900 1000 900
   1114 800` from the launch position): `ui_snapshot` → `title 'Sound & vibration' 198,2105 428x49`, its `text_frame 154,2061 926x93`.
2. `assert [{ element: { text: "Sound & vibration" }, ocr: { text: "Sound & vibration" } }]` → `read "Colnd & vibration"`.

## Evidence

`run11-android/session.log` #195 (10:20:44), #198 (10:21:24); `img-197-0.png` (the full text drawn under the 2154 line, the handle at
y ≈ 2187); `snapT.txt` (the node's ancestors: `recycler_view 0,596 1080x1558` ending at 2154). Insets from `adb shell dumpsys window
displays` (read-only).

## Where

- `src/adapters/android.ts:974–975` (`STATUS_BAR_INSETS_TYPES`): only the status bar's insets are read; `ITYPE_NAVIGATION_BAR` /
  `navigationBars` in the same dump are ignored.
- The pixel asserts' cover rule (round 8's `paintsOver`, `src/verify/pixel-poll.ts`) has no band for the navigation bar, and a node
  clipped to the window frame carries no `cutBounds` to tell the crop that it is cut.

## Suggestion

Read the navigation bar's frame beside the status bar's (same dump, `ITYPE_NAVIGATION_BAR` / `navigationBars`, visible only) and treat
it as a bottom band: a colour/OCR assert whose element touches it fails closed ("the navigation bar is drawn over the element … scroll it
up"), and a plain `scroll_until` does not call a node flush with it "fully visible".


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

Round 10 D7 and P1 (ADR 0009). **D7.1, D7.4, D7.5, D7.6, D7.7, P1.1, P1.2 Hold; P1.3 Holds for the bottom pinned surface; D7.2 Holds
(3-button, run 18:00–18:03 on the owner's approval); D7.3, D7.8 Not reached.**

- **D7.1 — Holds.** Account Detail at the top (fresh after the PIN login): `row_4 66,2152 948x68` (dumped clipped at the window bottom;
  `row_3` absent behind the tab-bar host, as in rounds 5–8). #10 17:11:54 `tap id:transactions.list.row_4` → `id:transactions.list.row_4 is
  under the navigation bar at (540,2186), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect
  66,2152 948x68) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped` (4.6 s), no shim
  line. #11 plain `scroll_until` → `Element id:transactions.list.row_4 fully visible after 1 swipe` (7.5 s), shim `17:12:07 input swipe 540 1638
  540 1028 611`, row at `66,1465 948x143`. #13 `tap` → `Tapped id:transactions.list.row_4`, shim `17:12:23 input tap 540 1537`, the transaction
  detail opened (`transactions.detail.amount`).
- **D7.2 — Holds (run by the coordinator 18:00–18:03 UTC on the owner's approval, given in the owner's own message).** `cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton` → `navigation_mode` 0, `ITYPE_NAVIGATION_BAR frame=[0,2088][1080,2220]` (132 px, vs 66 px gestural). Contacts and Settings are not edge-to-edge under it (their windows end at 2088; `d72-3btn.png`). Every averi input stayed above 2088: #274 `tap id:nav_organize` (`720,1911 360x177`) → `Tapped`, shim `input tap 900 2000`; Settings `text:"Security"` dumped `198,2088 197x0` → #279 refused `matched only nodes clipped out below its scroll container … scroll_until it with direction: "down" first`, #280 `scroll_until … fully: true` → `fully visible after 1 swipe` (shim `input swipe 540 1730 540 656 1076`), #281 tap → shim `input tap 297 1273`. D7.4 shape under 3-button: Settings summary `Emergency SOS, medical info, alerts 198,2036 623x52` (ends on 2088): #285 OCR → `FAIL … the element may be cut at the navigation bar (element 198,2036 623x52, navigation bar from y 2088): it ends on the bar's top edge, as its scroll container 0,297 1080x1791 does … failing closed, rendered text unchecked` (13.8 s) — the band follows the 3-button frame; #286 `assert_color` measured (PASS, 4.2 s); #287 `scroll_until … fully: true` → 1 swipe (shim `input swipe 540 1730 540 1553 300`). No averi tap or stroke touched Back/Home/Recents (shim lines 18:00:54–18:02:43, all y ≤ 2000). Restored: `enable-exclusive … navbar.gestural` → `navigation_mode` 2, frame `[0,2154][1080,2220]`; one manual Back closed Settings (`d72-restored.png`).
- **D7.3 — Not reached.** The raw tap at y ≈ 2186 needed an mp-native row lying in the bar; the backend broke (header) before it was
  staged again. Contacts/Clock have nothing tappable below 2154 (their tab items end at 2154), so a raw tap there would prove nothing.
  For the record only: #90 a coordinate `tap x:256 y:3` (top band) was sent as given (`Tapped (256, 3)`, `17:24:23 input tap 256 3`), nothing
  happened on screen — the documented "coordinate taps are sent as given".
- **D7.4 — Holds.** Settings home at launch already had `title 'Sound & vibration' 198,2105 428x49` (laid 74, flush at 2154). #143 `assert`
  OCR → `FAIL … the element may be cut at the navigation bar (element 198,2105 428x49, navigation bar from y 2154): it ends on the bar's top
  edge, as its scroll container 0,596 1080x1558 does, so the crop may read only what shows of it — scroll it up: scroll_until the element with
  \`fully: true\` first and re-run; failing closed, rendered text unchecked`; colour in the same call → measured `sampled #F0F0F3 … dE00 3.40`
  (16.5 s for the two). #145 `scroll_until … fully: true` → `fully visible after 1 swipe` (7.3 s), one short stroke `17:32:02 input swipe 540
  1842 540 1665 300`; title then `198,1921 428x74`; #146 OCR → `read "Sound & vibration"` PASS (3.0 s). Screenshot `img-142-0.png`.
  Round 8 read `"Colnd & vibration"` here.
- **D7.5 — Holds.** `row_36 66,2069 948x143` (staged by a slow drag; bottom 58 px under the bar, centre 2140 above it). #31 colour → `FAIL
  element id:"transactions.list.row_36" fill within dE00 8 of #F1F1F2 — the navigation bar is drawn over the element (element 66,2069 948x143,
  navigation bar 0,2154 1080x66) — the capture would show it, not the element; scroll_until the element with \`fully: true\` first and re-run;
  failing closed, color unchecked` (13.8 s).
- **D7.6 — Holds.** Contacts › Create contact, IME down, `Add fields` staged by hand. Text cut to 12 px (`198,2142 180x12`): #77 OCR → `… the
  element may be cut at the navigation bar (element 198,2142 180x12, navigation bar from y 2154): it ends on the bar's top edge, as its scroll
  container 0,242 1080x1912 does, … scroll it up: scroll_until the element with \`fully: true\` first and re-run; failing closed, rendered text
  unchecked` (13.8 s). Text 51 of 55 (`198,2103 180x51`): #80 the same OCR refusal; colour measured `#E8EFF6 dE00 0.00` (16.4 s). #82 `fully:
  true` → `fully visible after 1 swipe`, `17:23:32 input swipe 540 1772 540 1595 300`, text `198,1916 180x55`; #84 OCR → `read "Add fields"` PASS.
- **D7.7 — Holds (closest shape).** No non-edge-to-edge app with a pinned bar ending at 2154 was found; Google Contacts' bottom navigation
  items end exactly at 2154 (`container id=contacts 0,1977 360x177`, inside `bottom_nav 0,1977 1080x243`, which runs to 2220). #50 colour on
  `id:contacts` → measured `#DCE3E9 dE00 0.00`; OCR on `text:"Contacts"` → `read "Contacts"` (both PASS — an element ending ON the bar's top
  edge still measures).
- **D7.8 — Not reached.** No immersive app with the navigation bar hidden: Camera (`com.android.camera2`, first-run dialog) hides only the
  status bar (`ITYPE_STATUS_BAR … visible=false`, `ITYPE_NAVIGATION_BAR … visible=true`; its dump lists `other id=navigationBarBackground
  0,2154 1080x66`). NEXT not pressed (it changes a location-tagging setting).
- **P1.1 — Holds (on `row_36`, the list's last row now).** `row_36 66,2069 948x143` (bottom under the bar): #33 `scroll_until … fully: true` →
  `Element id:transactions.list.row_36 fully visible after 1 swipe` (8.1 s), `17:15:32 input swipe 540 1804 540 752 1054`, row at `66,1631
  948x143`; #35 colour → `PASS … sampled #F1F1F2 (dominant, 93% of region) … dE00 0.00` (2.7 s).
- **P1.2 — Holds.** Same staging, #29 plain `scroll_until` → `Element id:transactions.list.row_36 fully visible after 0 swipes` (2.1 s), no
  stroke (centre 2140 above the bar). The wording "fully visible" for a row whose bottom 58 px lie under the navigation bar is round 8's
  remark again (see Gaps); the same on Contacts #81 (`Add fields` 51 of 55 → `fully visible after 0 swipes`) and Settings #144.
- **P1.3 — Holds for a bottom full-width surface; the top case reached only in a scroll view.** Contacts `bottom_nav 0,1977 1080x243`
  (full width, laid to the screen's bottom, in no scroll view): #51 `scroll_until … fully: true` → `fully visible after 0 swipes` (2.1 s, no
  stroke); #50 colour/OCR on it → `FAIL … the navigation bar is drawn over the element (element 0,1977 1080x243, navigation bar 0,2154
  1080x66) — the capture would show it, not the element — assert something in it that lies clear of that (its content above the bar, say); no
  scroll moves an element laid to the screen's bottom edge out from under it; failing closed, color unchecked` (OCR: `… rendered text
  unchecked`). The top: Contacts' edge-to-edge `app_bar_layout 0,0 1080x418` lies INSIDE `scrollable contact_list` (a collapsing
  CoordinatorLayout bar), so it is not "in no scroll view" and not exempt: #52 `fully: true` → `failed after 15000ms (timeout) — element
  reached the viewport but it stays partly under the status bar, in the top 66 … fully: true stops only with none of it under the bar (its
  centre is clear: a plain scroll_until stops on it, and a tap lands) (last rect …0,0 1080x408). It was turned round 3 times …` (16.5 s, five
  strokes: `540 396 540 989 594` ×2, `540 1582 540 1286 300`, `540 396 540 544 300` ×2). Consistent with the ADR (scroll content), honest
  wording; no Android 15+ device for a pinned full-bleed bar. The Contacts "Choose fields to add" sheet (`0,426 1080x1728`) ends at 2154, not at
  the bottom, and has no id — not used.


## Device check (2026-10-14 Android, re-run at ebe6822)

Round 16 Android device check, 2026-10-14 17:07:57–17:21:08 UTC, emulator-5554 (Pixel_3a AVD, Android 13 / API 33, 1080x2220, gesture navigation, `navigation_mode` = 2 before and after). averi built from `~/dev/mobile-verify` `arch/round-16` at `ebe6822`, checked with `git rev-parse --short HEAD` → `ebe6822` (read-only, detached), daemon on port 47911 via `$R/c`. Apps: mp-native `com.finshape.skeleton.dev` (first, already logged in by the owner, on Account Detail), Google Clock `com.google.android.deskclock`, Settings `com.android.settings`. **No PIN re-login was needed:** mp-native stayed logged in for the whole run. No `ensure_state`/`run_flow`, no `login` rung, no registration, no credentials typed, no `clearState`. **Backend: working.** Account Detail loaded balances (1,121.00 CZK / 2,000.00 CZK, "Account 1 of 4") and a full transaction list. Two transaction details opened with data. The SWIFT form loaded the debit account. No "Mandatory data not loaded" screen appeared. Calls #2–#92 are in `session.log`. The shim log `adb-input.log` has 66 lines, and every line cited below is quoted from it.

**D7.1: row in the navigation bar. Holds.** With Account Detail at the top, `row_4 66,2152 948x68` (`acct1.txt` #4):
- #6 `tap id:transactions.list.row_4` →
  `id:transactions.list.row_4 is under the navigation bar at (540,2186), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 66,2152 948x68) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped` (no shim tap).
- Repeated from the top later in the run (after #39 brought the page back), with the same rect (`acct6.txt` #40): #41 gave a verbatim-identical refusal. #42 `scroll_until id:transactions.list.row_4` → `Element id:transactions.list.row_4 fully visible after 1 swipe`, shim `17:13:22 input swipe 540 1638 540 1028 611`. #43 tap → `Tapped id:transactions.list.row_4`, shim `17:13:32 input tap 540 1538`, and the detail opened. This matches round 10 (`540 1028 611` stroke, tap `540 1537`/`1538`).
- In between, a row whose visible part lay between the tab bar (ends 2052) and the navigation bar (2154), `row_4 66,2079 948x141`, was tapped on that strip. #14 → `Tapped id:transactions.list.row_4`, shim `17:09:58 input tap 540 2150`, and the +208.00 EUR detail opened (`img-15-0.png`). #35 was the same (`17:12:31 input tap 540 2150`). The y of 2150 lies 4 px above the bar, consistent with round 12's `row_36` (`input tap 540 2097` in the strip).

**carried r10 D7.3: gesture-navigation tap at y≈2186 on an mp-native row. Recorded (round 10 asked only for a record). The raw tap reaches the app.** Account Detail with `row_4 66,2079 948x141`, so the row was drawn across the gesture band 2154–2220 (`acct5.txt` #18). #19 `tap x:540 y:2186` → `Tapped (540, 2186)`, shim `17:10:35 input tap 540 2186`. The mp-native transaction detail for that row (+208.00 EUR, 14.06.2026) opened (`img-20-0.png`), and no system gesture fired. averi neither refuses nor moves a coordinate tap in the band: coordinate taps are not judged, as in earlier rounds. Only selector taps are refused there (#6/#41 above).
