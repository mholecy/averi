# Handoff: on-device check of round 4 (`fix/round-3` @ `86eb42d`)

For the agent that runs the device check. Round 4 fixes the problems the round-3 device check found, recorded in
commit `188740b`. Everything quoted as "expected" was read from the code at `86eb42d`. Where the code does not pin something
down, this note says **to determine on device**: measure it and record it. Do not guess.

The round-3 handoff (`docs/handoff/2026-10-09-device-check-round-3.md`) stays the reference for fixtures, the shim and the
report style. This note repeats only what you need and lists what changed.

## 1. What to test and how to build it

`fix/round-3` @ `86eb42d` = `188740b` (the round-3 device check) + round 4. Round 4 is three fixes, each reviewed to
APPROVED, plus the code-review fixes:

- **Android:** a stroke whose touch-down would land on a node drawn over the list, such as a floating tab bar, now starts
  above that node (`swipe.ts#strokeRoom` / `overlayTop`, `ui-tree/geometry.ts#drawnOver`).
- **iOS WDA:** whether a toolbar has no items is judged by its content, not by its child count
  (`ui-tree/geometry.ts#shadowing`).
- **iOS:** the `launch_app` give-up note is chosen by the label, never licensed by the screenshot
  (`adapters/ios-foreground.ts#notInFront`).

In `/Users/mholecy/dev/mobile-verify`:

1. `git checkout fix/round-3`.
2. `git rev-parse --short HEAD` must print `86eb42d`. If it does not, stop and ask.
3. Run `npm ci` only if `node_modules` is missing or stale, then `npm run build`.
4. Point the averi MCP server at THIS `dist/` and **restart it after the build**. Record `86eb42d` in every result.

Rules (the same as round 3):

- Do not push, and do not merge into `main`. The merge happens only after this check, and only when the user says so.
- Write the findings as a new `## Device check (<date>, re-run at 86eb42d)` section at the end of the bug note each item
  names. Use the same style as the `re-run at 347e70d` sections already in those notes.
- A new problem gets a new bug note in the same style.
- Commit only notes, and only if the user asks.
- Leave `docs/architecture-reviews/` alone.

Fixtures:

- **Android:** emulator-5554, Pixel_3a AVD, Android 13, 1080x2220, Gboard docked. The owner logs in to mp-native
  (`com.finshape.skeleton.dev`).
- **iOS:** iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). Use the bank app
  `com.finshape.dbosbanking` ("Skeleton Internal") and Contacts `com.apple.MobileAddressBook`.
- **Shims:** put an `adb` shim and an `idb` shim first on the server's PATH, logging argv with a timestamp. Item 1 cannot
  be judged without the `input swipe` lines.

## 2. Checklist

### 1. Android: the stroke does not touch down on the floating tab bar
Note: `docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md`.

**Fixed.** A node is a cover when all of the following hold:

- it comes after the list's subtree in the tree and overlaps the list;
- it crosses the stroke's line (x = the box centre);
- its top lies in the lower half of the list's part above the keyboard.

Such a node cuts the stroke box above its top, just as the keyboard does. This applies to content-down strokes only:
content-up strokes are never cut. When the strokes still move nothing, the fast fail names the node they touched down on.

**Setup:** Account Detail, the list at the top, the tab bar shown (the default on arrival), keyboard down.

1. `scroll_until { platform: android, selector: "id:transactions.list.row_36", fully: true }`.
   - **Expected:** the shim shows `input swipe 540 1638 540 <~1028> <ms>`, the list moves, and the reply is
     `Element id:transactions.list.row_36 fully visible after N swipes` (or the probe's flush wording).
   - **FAIL:** a touch-down at y ≥ 1840, the list not moving, or `failed after 2 swipes … content exhausted`.
2. After the page has scrolled (the list container is about `0,401 1080x1753`), repeat the call.
   - **Expected:** touch-downs at about `540 1553`, and the list moves.
3. List at its end, tab bar hidden: `scroll_until … row_40` (a row that does not exist).
   - **Expected:** the fast fail as before, `failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken)`, with no node named.
4. Tab bar shown: a content-up scroll back to the top (`direction: up`, a row above the screen).
   - **Expected:** the stroke is uncut and touches down at about `540 1104`.
5. **Regressions** in the round-3 items this touches (round-3 handoff items d, e, g, h). Re-run one case each:
   - the Settings / bank-list drag;
   - one `fully: true` probe on the account card (the `fills` text);
   - Contacts editor strokes with the IME up. They must stay above the IME top, unchanged from the round-3 table.
6. **Optional:** any screen where a bar or FAB sits right above the open keyboard over a list.
   - **Expected:** the stroke touches down above the bar, not between the bar and the keyboard. Which screen has this is
     **to determine on device**; skip it if there is none.

If a reply does name a node, the wording is:
`… did not change the screen: they touched down at x,y on <role> "<label>" (id <id>) at <rect>, drawn over the list <rect>, which may have taken them (else: …)`.

### 2. iOS WDA: a toolbar with no items does not refuse the dismissal tap
Note: `docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md`.

**Fixed.** A `toolbar` covers nothing if every descendant is an empty `container`, with no label, value or identifier.
An unlabelled `other` still counts as an item.

**Setup:** as in the note's round-3 section. Contacts → + (New Contact) with the software keyboard up (after
terminate+launch with `AutomaticMinimizationEnabled` / `HardwareKeyboardLastSeen` = NO). Scratch config `treeSource: wda` +
`keyboardDismiss: [tap: { role: text, text: "New Contact" }]`.

1. `tap { platform: ios, selector: 'role:text text:"add pronouns"', configPath: <scratch> }`
   - **FAIL:** the round-3 refusal `… (tap text:"New Contact" role:"text": covered by toolbar "Toolbar") …`.
   - **Expected:** no refusal. The reply carries `the soft keyboard covered role:text text:"add pronouns"; hidden by tapping role:"text" text:"New Contact" before tapping`.
   - **Expected:** the idb log shows two taps, the title at about (201,100), then the row.
2. **Never measured:** whether a title tap hides this UIKit sheet's keyboard at all.
   - If it does not, an `AfterDismissalTap` error saying the screen was touched is the correct behaviour, not a regression.
     Record it.
   - Also record whether the title tap changed anything else on the sheet, per the screenshot.

### 3. iOS: the launch give-up note does not say "can be ignored" on a stale tree
Note: `docs/bugs/2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md`.

**Fixed.** There are three branches, chosen by the label the tree still shows after 3 s:

- **SpringBoard:** unchanged.
- **The label is the name of an app averi launched earlier in this server process:** the note says the tree is still
  that app's.
- **Otherwise:** the note says to treat the tree as the previous app's until a read carries the launched app's name. It
  offers the localized-name reading only for a read 20 s or more after the launch.

The stale window does not reproduce on every switch. In round 3 it showed once, on the first switch after a long stay in
the bank app. Try a few switches, and report "Not reached" if the note never fires.

1. **The app was not launched by averi.** Restart the server. Keep the bank app in front, opened by hand, for a few
   minutes, then `launch_app { platform: ios, appId: com.apple.MobileAddressBook }`.
   - **Expected, if the note fires:**
     `… the UI tree was still the app labelled "Skeleton Internal" — … (an absent check passes on it). Treat the tree as the previous app's until a read is labelled "Contacts": after an app switch idb was measured serving the previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is still labelled "Skeleton Internal" while the screenshot shows com.apple.MobileAddressBook is that label its on-screen name …`
   - **FAIL:** the old `If the screenshot shows … this can be ignored`.
2. **The app was launched by averi.** In the same server, `launch_app { appId: com.finshape.dbosbanking }`, stay a few
   minutes, then `launch_app { appId: com.apple.MobileAddressBook }`.
   - **Expected, if the note fires:**
     `… "Skeleton Internal" is the name of com.finshape.dbosbanking, which averi launched earlier, not of com.apple.MobileAddressBook: the tree is still that app's, even if the screenshot already shows com.apple.MobileAddressBook (it switches before idb's tree does) — read again before trusting what the tree says`.
3. **Regression** (round-3 handoff a3): 3× and 2× switches with an `absent` assert right after. Expect no wrong-app read.
4. **Measurement for a follow-up.** Run `xcrun simctl listapps 37956039-94EA-4F51-93E5-94F7723A4578`.
   - Record its output format (paste the entry for one app) and how long it takes (`time`).
   - It decides whether averi can look up the names of all installed apps, which would also catch case 1.

### 5. Regressions of the earlier fixes that round 4 touches (added by the device-check agent)
Round 4 changes `shadowing` (every WDA cover judgement), the stroke box (every Android content-down stroke) and the launch
note's branches. Re-run once each, as a `Holds` / `Fails` bullet in the note named:
- **iOS P3, fullscreen SwiftUI toolbar** — `2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md`: SWIFT form,
  scratch `treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`, amount focused, tap
  `id:swift_payment.form.priority_select` under the keyboard. Expected as at 347e70d: `… hidden by tapping
  id:"swift_payment.form.title" before tapping`, idb taps 201 84 then the row. The SwiftUI toolbars there hold labelled
  items, so the content rule must not start excusing them where they DO cover.
- **iOS localized name (round-3 a5)** — `2026-10-09-ios-launch-app-reads-previous-apps-tree.md`: German, launch Contacts
  ("Kontakte"). Round 4 drops the "can be ignored" licence: record which branch fires now and its exact text; a launch must
  not fail. Restore the language afterwards.
- **iOS flow `launch:` ⚠ trace** — the new note texts in a `run_flow` reply as a `⚠ launch` line.
- **Android SWIFT form** — `2026-10-08-scroll-until-ignores-android-soft-keyboard.md` and
  `2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md`: the form's pinned CONTINUE bar sits
  below the scroll container (`[0,242][1080,1978]`), not over it, so the overlay cut must not fire there. Re-run the Fees
  probe (`fully visible after 1 swipe`, a ≤ 178 px probe) and, IBAN focused, `id:swift_payment.form.my_note_input`
  (round 3: fail after 5 swipes / 17.9 s, "the last 2 … did not move it"). Record the strokes.
- **Android floating Gboard** — `2026-10-05-android-floating-gboard-keyboard.md`: one tap under the panel (`back` first)
  and one scroll stroke above it. Restore docked Gboard.

### 4. Out of scope: do not report these as regressions
- WDA reports the text of an off-screen cell at a parked frame (`0,62 …`), so it reads as visible
  (`2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md`). It is not fixed and will get its own
  round after the merge.
- A row behind the tab bar judged visible, or a tap landing on the bar
  (`2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md`).
- A floating header over the list top under a content-up `fully: true` probe. It is still reported as "checked" (a known
  residual, documented on `overlayTop`).
- Everything listed in section 3 of the round-3 handoff.

## 3. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| 1.1 row_36, list at top, bar shown | Android | 86eb42d | Holds (stroke), budget caveat; NEW bug | `input swipe 540 1638 540 1028 611`, list moved; `failed after 15000ms (timeout)` — `2026-10-09-android-scroll-until-default-budget-too-short-at-drag-speed.md` |
| 1.2 after page scroll | Android | 86eb42d | Holds | `540 1553 540 689 865` ×5, `fully visible after 5 swipes` (timeoutMs 60000) |
| 1.3 row_40 fast fail, bar hidden | Android | 86eb42d | Holds | `failed after 3 swipes (… did not change the screen …)`, no node named |
| 1.4 content-up uncut | Android | 86eb42d | Holds | `540 765 540 1857 1094` ×6, uncut (page scrolled, so not ~1104) |
| 1.5 regressions d/e/g/h | Android | 86eb42d | Holds | Settings `540 1736 540 484 1254` identical; `fills` text; Contacts strokes above the IME |
| 1.6 bar above the IME (optional) | Android | 86eb42d | Not reached | no bar drawn above the open keyboard on any screen |
| 2.1 add pronouns, no toolbar refusal | iOS (wda) | 86eb42d | Holds (refusal gone); reply/row tap not reached | title tapped `201 100`, then `… but it is still up` (2.2) |
| 2.2 does the title tap hide the keyboard | iOS (wda) | 86eb42d | Measured: no | keyboard stays up, sheet unchanged |
| 3.1 note, app not launched by averi | iOS | 86eb42d | Holds (third branch, exact text) | fired on a stuck Contacts tree, not a stale window — NEW bug `2026-10-09-ios-launch-note-blames-previous-app-when-launched-process-tree-is-empty.md` |
| 3.2 note, app launched by averi | iOS | 86eb42d | Not reached naturally (4 tries); Holds when forced | exact owner text with a forced stuck tree |
| 3.3 regression a3 | iOS | 86eb42d | Holds | 3/3 + 2/2, no ⚠, absent asserts fail |
| 3.4 `simctl listapps` format and time | iOS | 86eb42d | Measured | 0.13 s, old-style plist keyed by bundle id, 42 apps; Contacts listed as "Contacts" (not localized) |
| 5 regressions (iOS P3, a5, flow launch, SWIFT form, floating Gboard) | both | 86eb42d | Holds | iOS P3 (taps 201 84 → 201 707), German "Kontakte" third branch, flow `⚠ launch`, SWIFT Fees probe 177 px, floating Gboard `back` then tap |
