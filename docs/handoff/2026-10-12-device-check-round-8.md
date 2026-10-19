# Handoff: on-device check of round 8 (`fix/round-8` @ `0ff6df3`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 8 is still being reviewed and fixed
> after its code review: do not check out, build or test anything. When it reads
> `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the title and the expected replies below are final: start.
> Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. Round 8 = branch `fix/round-8` = `fix/round-7` @ `35d5997` (round 7, checked on
device) + the fixes for the 2 new bug notes and the gaps round 7's device check found.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. What changed

| item | what changes | bug note |
|---|---|---|
| N1 | Android reports its VISIBLE system status bar (from `dumpsys window displays`) as the status band: a tap in it is refused, `scroll_until` does not stop on a target in it; status-bar wording is platform-neutral | `2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md` |
| N2 | colour and OCR asserts fail closed when the status band or chrome painted over the element meets what they read (its own pixel cover rule `paintsOver`; overlaps ≤ 2 units ignored) | `2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md` |
| A2 | a node flush with the edge its ancestor is cut to a sliver at inherits the cut (refused; plain `scroll_until` does not stop on it); hint "tap something in it that lies clear of that edge" | `2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md` |
| B1 | a plain `scroll_until` that fails after its target lay clipped out past the far edge names that side and `direction: "up"`; a never-found target after the content stopped moving gets "if it lies above, try direction: "up"" | `2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md` |
| D3 | a `clear` fill mismatch says it retried: "(after one wipe and retype)" / "(after typing it once more)" | `2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md` |

## 2. Build

1. Run `git checkout fix/round-8` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as in rounds 3–7: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)` at the end
of the bug note named in its item; anything new goes into a new bug note; commit only notes, and only if the owner asks;
leave `docs/architecture-reviews/` alone.

## 3. Regression: re-run round 7's checklist

Run `docs/handoff/2026-10-10-device-check-round-7.md` section 4 (and its R-4/R-5) again. Everything that held at `35d5997`
must still hold. Expected changes:
- Android status-bar wording now reads `… is under the status bar at (x,y), in the top 66 of the screen (tree units), where a
  tap goes to the status bar …` (iOS: `… in the top 62 …`) — same meaning as before on iOS.
- A2: `label:"Payment details"` (the toggle's cut child) is now refused too (item A2 below).
- Pixel asserts (colour/OCR) that passed in round 7 on an element under the status bar or chrome now fail closed (N2).

## 4. Round 8 checklist

### N1. Android: the system status bar is not app screen
Note: `2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md`.
1. Contacts with its app bar collapsed so "All contacts" sits at `149,0 213x6`: `tap text:"All contacts"` → refused:
   `text:"All contacts" is under the status bar at (256,3), in the top 66 of the screen (tree units), where a tap goes to the
   status bar (rect 149,0 213x6) — it lies in a scroll view — scroll_until it first …; nothing was tapped`. No `input tap`.
2. Plain `scroll_until text:"All contacts"` → strokes (content down), never "fully visible after 0 swipes"; then the tap lands.
3. `fully: true` on it → one stroke, stops wholly below 66.
4. **Still holds:** Contacts icon buttons at y 154 (More options, Cancel), mp-native back at `77 154`, Compose text/icon
   buttons, Account Detail rows under the tab bar — tapped as in round 7.
5. **Record:** `adb shell dumpsys window displays | grep -E "ITYPE_STATUS_BAR|statusBars"` once (read-only) — the line the
   adapter parses; and an immersive/full-screen app (video) — does a tap near the top still work?

### N2. Pixel asserts fail closed on chrome
Note: `2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md`. Scratch config only.
1. iOS idb, SWIFT form with `value_date_select` at y ≈ 30 (under the 62-pt band): a colour assert on it → fails:
   `the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — …; failing closed, color
   unchecked` — never a PASS on the bar's #EFF1F4. The same with OCR → `… rendered text unchecked`.
2. An element under CONTINUE (e.g. "Message for my bank" at 778): colour and OCR fail naming
   `button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)`.
3. The same element scrolled clear → the assert is measured and passes/fails on its own pixels.
4. **Must not fail:** a text inside a Compose card (Account Detail "1,121"), a row avatar ("LR"), the RN login field and
   language switcher under WDA, idb's chooser card ("Accounting Balance"), "Amount*"/"Value*" (2-pt overlap) — measured.
5. Android edge-to-edge app bar (e.g. Contacts `0,0 1080x220`): colour assert fails closed with advice
   `assert something in it that lies clear of that (its title, say) …`; the title inside it → measured.

### A2. Android: the toggle's cut child
1. SWIFT form, `details_toggle` cut to a 948x55 strip at the form's bottom: `tap label:"Payment details"` → refused:
   `… cut at its scroll container's bottom edge (container …), as is the 66,1924 948x55 it lies in; only a 948x42 part of it
   shows … (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that
   lies clear of that edge, or tap by coordinates); nothing was tapped`. No `input tap`.
2. Plain `scroll_until label:"Payment details"` → one stroke, then the tap expands the section.
3. **Still tapped:** Create contact `text 'Company'` with the IME up (A2.4) — tapped, its field focuses.

### B1. scroll_until names the way back
1. Settings with `Apps` clipped out above (as round 7 B1): plain `scroll_until text:"Apps"` → no turn on the first read; the
   failure ends `… clipped out above its scroll container, past the edge the swipes push it out through, … — scroll_until it
   with direction: "up"`, never "(a fling?)".
2. `direction: "up"` → reached.

### D3. Fill retry wording
1. Android amount field fed `abc` with `clear: true` → `fill: typed 3 characters (after typing it once more) but the field
   shows 0 …` (nothing to wipe) or `(after one wipe and retype)` when it held text.

### F. Captures for the next round (record only)
1. iOS idb: a `fill` that picks its field by its VALUE, without `clear` (round-7 R-5.1 shape) — capture `ui_snapshot`
   before and after typing; does the keyboard's key list change the tree enough to read as "screen changed"? (F1/F2)
2. iOS idb: `fill` a password into a `SecureTextField` with and without `clear` — does it pass? (round-7 D3.3, still open)

### R-6. Round 8's rules outside the named screens (added by the device-check agent)
Round 8 makes the Android status bar a band (N1), makes pixel asserts fail closed on chrome (N2) and widens the A2 cut to
children, so check the shapes these rules can catch by mistake, and the rounds' earlier notes the checklist above skips:
1. **N1 in mp-native and Settings (Android):** taps on the top bar's back (`77 154`), a Settings row at the list top and the
   search box → tapped, never refused as under the status bar; plain `scroll_until` back to the top of Account Detail stops
   with its first row wholly below 66.
2. **N1 wording on iOS:** a tap under the iOS band (Contacts / Settings row scrolled under it) → refused with
   `… in the top 62 of the screen …`; `scroll_until` brings it down as in round 7.
3. **N2 on mp-native's own chrome (both):** a colour assert on an Account Detail row under the tab bar → fails closed naming
   the tab bar; the same row scrolled clear → measured. And a colour assert on an element under the soft keyboard still fails
   closed (note `2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md`).
4. **N2 must not fail on whole screens without chrome over them:** colour/OCR asserts on mp-native's Account Detail balance
   and a Settings row title (both platforms) → measured.
5. **A2 children on non-bank lists (Android Settings / Contacts):** a row's title at the list's bottom edge when the row is
   whole and only its content runs to the edge → record refusal text and rects; a row cut to a sliver → its title refused, a
   plain `scroll_until` brings it whole.
6. **B1 / D3 wording on iOS:** a `scroll_until` that fails with the target clipped out above (Settings) and an iOS `clear`
   fill mismatch (amount field fed `abc`) → record the wording; the shared text should name `direction: "up"` / the retry.
7. **R-4 again:** PIN re-login and `back_to_tab_host` on both (iOS payment screens still use `BackButton`, an mp-native gap,
   not an averi regression).

## 5. Out of scope: do not report these as regressions
- N1: a bar shown or hidden without a `launch_app` keeps the last answer until the next launch or a fresh read (a tap's
  refusal re-reads fresh); a timed-out band read means no band until the next launch; the band cuts portrait screens only
  (Android keeps its bar in landscape); the band read right after a launch may catch the starting window's bar state.
- N2 (owner-approved exemptions, 2026-10-12): an element's own content, a clickable layer without drawing, and on idb a
  text made only of the element's label words are not pixel covers — so a toast "Saved" over a card "Saved payments" on
  idb, a dialog's bare background when the element is bigger than the panel, and a childless labelled panel laid inside the
  element are not seen. Elements that reach into the band by design (full-bleed headers on iOS and Android 15+, windows,
  roots) fail OCR asserts closed; idb's Application node fails a colour assert; idb keys are named as covers.
- A2: a sliver whose children fill it exactly shows no evidence; a whole node whose content runs to the edge reads cut.
- B1: the "if it lies above" hint is not given at `maxSwipes` or the deadline (the content may continue).
- F1/F2 are deferred to the captures in F.
- Everything in section 5 of the round-7 handoff.

## 6. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-7 checklist re-run | Android emulator-5554 (Pixel_3a, 13) + iOS iPhone 17 sim (27.0, idb + WDA) | `0ff6df3` | **holds** on both | Android: A1 (cutBounds 66,480 948x97, `fully` 1 stroke, 14-px strip refused naming `date_header_0`), A2, B1, D3/D4, R-4 (PIN ×2, once after an inactivity logout), R-5.1. iOS: C1.1–C1.4, C2 (Region 2.4 s, was 15–17 s), K, D2 3/3, B2, D4, R-4.1 ×2. `back_to_tab_host` on iOS payment screens still fails (mp-native `BackButton`). `run11-*/session.log` |
| N1 status bar as screen | Android (+ iOS wording) | `0ff6df3` | **holds** | refusal verbatim `(256,3)`, `rect 149,0 213x6`; plain `scroll_until` 1 stroke then the tap opens the sheet; `fully` 1 stroke; y-154 buttons tapped; immersive Camera: band `visible=false`, a y-30 tap sent. iOS: `… in the top 62 of the screen …; nothing was tapped` |
| N2 pixel asserts on chrome | iOS idb + WDA, Android | `0ff6df3` | **holds**; 1 new bug (Android nav bar) | iOS: status bar `0,0 402x62` and CONTINUE `(24,780 354x44, reaching 24,780 354x94)` named, failing closed; scrolled clear → measured; must-not-fail list measured (RN app items unreachable: red box). Android: app bar "its title, say" advice, title measured, tab-bar host + keyboard fail closed. New: `2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md`. Fail-closed asserts take 13–40 s |
| A2 cut child | Android | `0ff6df3` | **holds** | `label:"Payment details"` refused verbatim, 1 stroke then the tap expands; Company with the IME up tapped |
| B1 way back | Android | `0ff6df3` | **holds** (gap) | failure ends `… direction: "up"`, no "(a fling?)"; `up` reaches in 3. Gap: no "if it lies above" hint when the list was already at its end and no stroke moved it. On iOS the hint is unreachable: `2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md` |
| D3 retry wording | Android | `0ff6df3` | **holds** | "(after typing it once more)" when the field shows 0; "(after one wipe and retype)" when it kept part (12.345 → 5, 1a2 → 2). iOS not reachable (amount field accepts letters) |
| F captures | iOS idb | `0ff6df3` | recorded | F1: no keyboard keys in either read (HID typing hides the keyboard); "screen changed while typing" reproduces on the SWIFT form with no keyboard, same role:identifier sets before/after — the change happens inside the fill. F2: idb cannot see a web password field; WDA fills it with and without `clear`; native SecureTextField under idb still unmeasured (registration path) |
| R-6 rules outside named screens | both | `0ff6df3` | **holds**; iOS B1 hint → new bug | Android R-6.1, 6.3–6.5, 6.7 hold; iOS R-6.2–6.4, 6.7 hold; R-6.6 → bouncing-list note above |

New notes from this check: `2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md` (the gesture navigation
bar is not a band: an OCR assert reads a text cut at it as a mismatch, plain `scroll_until` calls it fully visible) and
`2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md` (a rubber-banding list end changes the tree on
every stroke, so "content exhausted" never fires and the whole budget is spent). Not reached: an Android password field (Wi-Fi
off), the RN login field/language switcher (the RN app shows only its "No script URL" red box).
