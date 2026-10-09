# Handoff: on-device check of round 3 (`fix/round-3` @ `347e70d`)

For the agent that runs the device check. Everything quoted as "expected" was read from the code at `347e70d`. Where
the code or the bug notes do not pin something down, this note says **to determine on device**: measure it and record it.
Do not guess.

## 1. What to test and how to build it

`fix/round-3` @ `347e70d` = `main` `c11d179` + 41 round-3 fix commits + four architecture deepenings (scroll: one owner of the
stroke box, keyboard included, and the round deriving its tree facts itself; fill: the clear as the pure
`fill-clear.ts#clearStep`, and `judgeFill`/`differenceOf` judging the facts fill.ts reports). In `/Users/mholecy/dev/mobile-verify`:

1. `git checkout fix/round-3`.
2. `git rev-parse --short HEAD` must print `347e70d`. If it does not, stop and ask.
3. Run `npm ci` only if `node_modules` is missing or stale, then `npm run build` (it wipes `dist/` and runs `tsc`).
4. Point the averi MCP server you drive at THIS `dist/` and **restart it after the build**. Otherwise you test stale code.
   Record the commit (`347e70d`) in every result.

Rules:
- Do not push. Do not merge into `main`: the merge happens only after this check, and only on the user's word.
- Write findings as a new `## Device check (<date>, re-run at 347e70d)` section at the end of the relevant
  `docs/bugs/2026-10-09-*.md` note. Follow the existing sections' style, for example
  `docs/bugs/2026-10-05-android-floating-gboard-keyboard.md` ("Device check (2026-10-09 Android, re-run at 610660f)").
  That means: a "Measured HH:MM–HH:MM UTC, device, averi = … @ commit (`dist/`, stdio), fixture" line, then one bullet per
  case starting **Holds** / **Fails** / **Not reached**, with the call, the reply verbatim, the duration, the strokes/keys
  from the shim log, and the screenshot evidence.
- A new problem gets a new bug note in the same style (`# BUG: …`, Measured, Observed, Why, Why it matters, Repro). Commit
  only notes, and only if the user asks.

Fixtures, as in the notes:
- **Android**: emulator-5554, Pixel_3a AVD, Android 13, 1080x2220, Gboard docked. The owner must log in to the mp-native app
  (`com.finshape.skeleton.dev`, Compose). SWIFT form path: Account Detail → PAY → SWIFT payment.
- **iOS**: iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). Bank app
  `com.finshape.dbosbanking` (display name "Skeleton Internal"), stock Contacts `com.apple.MobileAddressBook`.
- **Stroke and key log**: put an `adb` shim (and an `idb` shim for iOS) first on the server's PATH. It appends its argv
  with a timestamp to a log, then execs the real binary. This is how the earlier checks got `input swipe x1 y1 x2 y2 ms`.
  Items d–h need it.
- WDA (iOS `treeSource: wda`, via a scratch config) listens on port 8100 for the first simulator (`src/adapters/wda.ts`).

## 2. Checklist

### a. iOS launch waits for the launched app's tree — `2026-10-09-ios-launch-app-reads-previous-apps-tree.md`
**Fixed:** with the idb tree source, `launch_app` and a flow `launch:` read until the tree's `Application` label is one of the
bundle's names from `simctl appinfo`. They wait at most 3 s (`FOREGROUND_WAIT_MS`), poll every 200 ms, and never fail
the launch. WDA does not wait and stays silent.
**Setup:** both apps running, neither terminated, default `treeSource: idb`. Contacts has the "New Contact" sheet open.
1. **appinfo format.** Run `xcrun simctl appinfo 37956039-94EA-4F51-93E5-94F7723A4578 com.finshape.dbosbanking` (and the same
   for `com.apple.MobileAddressBook`). The parser (`src/adapters/simctl-appinfo.ts`) expects an old-style plist `{ … }` with
   top-level `CFBundleDisplayName = "Skeleton Internal";` and/or `CFBundleName = …;`. Values may be quoted or bare, with
   `\"` `\\` `\n` `\t` `\Uxxxx` escapes. Octal escapes are NOT decoded. Only top-level keys count. Paste the raw output into
   the note: this format has never been measured. **FAIL:** a different format (JSON or XML plist), the keys nested,
   or neither key present. The last case makes every launch say
   `could not check that <bundle> is in front (simctl appinfo listed neither CFBundleDisplayName nor CFBundleName) — …`.
2. **Label = display name.** Compare the first element of `idb ui describe-all --udid <udid>` (the `Application`
   node's AXLabel) with the appinfo names, for both apps. Expected: "Skeleton Internal" and "Contacts". Contacts' appinfo
   names are **to determine on device**. If Contacts lists neither name, or a different one, every Contacts launch gets the
   note.
3. **Previous app's tree never read.** From the bank app in front, `launch_app { platform: ios, appId: com.apple.MobileAddressBook }`
   then immediately `assert [{ element: { id: "New Contact" }, absent: true, timeout: 500 }]` (scratch config naming Contacts).
   Do it 3×, and 2× the other way (`launch_app com.finshape.dbosbanking` from Contacts, then
   `assert [{ element: { id: "accounts.detail.search_field" }, absent: true, timeout: 500 }]` only if the bank screen has
   that field). **Expected:** the reply is `Launched com.apple.MobileAddressBook on ios` with no `⚠` line, and it takes
   ~1–3 s instead of 0.8 s. The absent assert then **fails**, because the element is there. **FAIL:** the absent assert
   passes, or the first `ui_snapshot` after the launch shows the other app.
4. **Wording when the wait gives up.** The text, with `<names>` = `"Skeleton Internal"`-style quoted names joined by ` or `:
   `3 s after launching <bundle> (<names>), the UI tree was still the app labelled "<label>" — iOS can hand idb the previous
   app's tree for a second or more after an app switch, so a read now may judge the wrong app (an absent check passes on it).
   Compare with screenshot. If the screenshot shows <bundle>, its on-screen name differs from its Info.plist name (a
   localized display name) and this can be ignored; otherwise read again before trusting what the tree says`.
   For SpringBoard (label `" "`) the text reads `…still SpringBoard's (the home screen or the launch animation) — … Compare
   with screenshot. Read again before trusting what the tree says`. The MCP reply shows it as a second line `⚠ …`. A flow shows
   it as a `⚠ launch` trace line. Other endings: `idb's tree stayed empty for the 3 s averi waited after launching <bundle>, so
   which app is in front was not checked — …` and `could not check that <bundle> is in front (<why>) — …`.
5. **Localized display name.** Switch the simulator language (e.g. German) and launch an app whose on-screen name is
   localized. Expected: the full 3 s wait plus the note above, quoting the localized label. Whether stock Contacts shows a
   localized label while appinfo lists "Contacts" is **to determine on device**. Restore the language afterwards. **FAIL:**
   no note while the label differs, or the launch fails.

### b. Android hint-aware clear — `2026-10-09-android-clear-reads-edittext-hint-as-content.md`
**Fixed:** the clear stops when a delete round leaves the reading unchanged (re-read once after the poll cadence). A hint
read as text is not content. A placeholder the source names (WDA `placeholderValue`, a dump `hint` attribute) counts as
empty. Masked fields still fail as clear-twice.
**Setup:** Settings: `adb shell am start -n com.android.settings/.Settings`, then tap the search bar
(`id:open_search_view_edit_text`, hint "Search settings", 15 chars). Contacts editor:
`adb shell am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact` ("Last name", 9 chars).
- **Empty field + value (probe J):** `type_text { platform: android, selector: "id:open_search_view_edit_text", text: "wifi", clear: true }`.
  Expected: `Filled id:open_search_view_edit_text (4 characters)` with no "cleared … first". The shim shows ONE round of
  15 deletes, then `wifi` typed. **FAIL:** `fill: field still shows 15 characters after clearing twice`, a second round of
  deletes, or "cleared 15 characters first".
- **Field holding text:** Contacts "Last name" holding `Q` (the editor has no resource-ids, so select by position or
  `role:textfield` with care). `clear: true, text: "Probe"` → expected `Filled <sel> (5 characters, cleared 1 character first)`
  with deletes **1 then 9** (tests/interact/fill.test.ts l. 838–842).
- **Clear alone on the empty hinted field:** `text: "", clear: true` → expected
  `Cleared <sel> (15 deletes sent) — NOT verified: the field still shows 15 characters that the deletes did not change — its
  hint or placeholder (shown while empty), or a field that ignores deletes`. Use 9 for "Last name". On a field holding
  `Probe`, the count is 5 + 9 = `(14 deletes sent)`.
- **Bank SWIFT form regression:** `type_text { selector: "id:swift_payment.form.bic_input", text: "", clear: true }` on the
  empty BIC → `Filled id:swift_payment.form.bic_input (0 characters)`, no delete sent (as at `610660f`).
- **WDA `placeholderValue`:** iOS Contacts "New Contact", scratch `treeSource: wda`. With the sheet up and Company empty,
  run `curl -s 'http://localhost:8100/source?format=json' | grep -o '"placeholderValue":"[^"]*"'`. Whether WDA sends it
  is **to determine on device**: no captured fixture had it. If it does, `run_flow fill { id: Company, value: "Acme", clear: true }`
  sends **no** delete and passes (`= Acme`), and a clear alone on the empty field replies
  `Focused id:"Company" — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text; the tree cannot tell which`.
  If WDA does not send it, the unchanged-round rule applies, as on Android: one round of 7 deletes, then `Filled …`.
  **FAIL:** `field still shows 7 characters after clearing twice`.
- **Masked field, focus missed:** expected `fill: field still shows 8 characters after clearing twice` (8 = the bullet
  count). Nothing typed. Bullets are never treated as a hint. Making the focus tap miss on a device is **to determine on
  device** (unit test "A" only). Run it if a password field gives the chance; otherwise mark it **Not reached**.

### c. Fill mismatch wording — `2026-10-09-fill-mismatch-error-says-equal-counts-when-app-transforms-text.md`
**Fixed:** a mismatch says what kind of difference it is (case, same length, unchanged, length, masked), never the content.
**Setup:** iOS Contacts → + → the `Notes` field (empty, UIKit sentence auto-capitalisation), scratch `treeSource: wda`.
The iOS Notes app body is an extra case if one is wanted.
- `type_text { platform: ios, selector: "role:textfield label:Notes", text: "hello" }` → expected `[isError]`
  `fill: typed 5 characters but the field shows 5 — the typed text is there but for letter case, 1 character differing: the app transformed the input (auto-capitalisation?); content withheld from this error`.
  It still spends the whole read-back poll (~36 s, by design: `pollValue` does not stop early). That time is not a FAIL.
- **FAIL:** the old `… shows 5 (content withheld from this error)`, or wording that names a character or a position.
- Other kinds, if seen: `— as many characters as were typed, K differing: …` and
  `— the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)`.

### d. Drag, not fling — `2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md`
**Fixed:** Android strokes move at `dragSpeed` 0.45 screens/s (999 px/s on 2220 px), so
`ms = max(300, ceil(length / 0.999))`: 1332 px → 1334 ms, ~850 px → ~851 ms. A dropped target turns the strokes back.
Two identical strokes that leave the whole tree unchanged fail fast (`UNMOVED_STROKES_EXHAUST` = 2), unless a `progress`
node with area is on screen.
- **Settings home, list at the top:** `scroll_until { platform: android, selector: 'text:"Display"', fully: true }`, then
  `text:"Accessibility"`. Expected: `Element text:"Display" fully visible after N swipes`, with N to determine (it was 15 s
  "never appeared" before). Every `input swipe` in the shim log must have duration ≥ 300 matching the formula, and no row
  may be skipped (read the rows between strokes off `ui_snapshot` if needed).
- **Bank transaction list (`transactions.list.row_N`, ends at row_36):** from the end,
  `scroll_until { selector: "id:transactions.list.row_20", direction: "up", fully: true }` → expected `fully visible after N swipes`.
  Then `scroll_until id:transactions.list.row_40` → expected a fast fail after the 2 unchanged strokes:
  `scroll_until id:transactions.list.row_40 failed after N swipes (the last 2, swiping down, did not change the screen:
  content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree`, well under 15 s.
- **Loading list:** on a list that shows a spinner (ProgressBar / Compose indicator) while it loads its next page, the scroll
  must NOT fail with "did not change the screen" while the spinner shows. It runs to its bound (`(maxSwipes)` / `(timeout)`).
  Which screen has one is **to determine on device**.
- **`left` wording:** Contacts editor, docked IME, `First name` focused, `Last name` wholly under the band at round 0,
  `scroll_until { selector: 'text:"Last name"', fully: true }`. With dragging this should now succeed (a PASS). If it still
  loses the row, the failure must read `element was in the tree before the first swipe (off the viewport, or under the soft
  keyboard), never in the viewport, and is no longer in the tree — a swipe carried it out (a fling?) and a lazy list drops what
  scrolls away`, never "never appeared in the tree".
- **FAIL:** any 300 ms full-length stroke, a target skipped between reads, `never appeared` for a row that was in the tree,
  or a list with a spinner called exhausted.

### e. Clipped bounds / flush probe — `2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md`
**Fixed:** on Android a `fully: true` stop whose edge along the scroll lies (±1 px) on a clipping ancestor's edge is probed.
The probe is one short stroke toward that edge, over the first ancestor with room, a quarter of a stroke, capped at 8 % of
the long side (178 px on the Pixel_3a). The SWIFT form's container is `0,242 1080x1736` (`[0,242][1080,1978]`), rows 143 px.
- **Fees:** scroll so `id:swift_payment.form.fees_select` sits cut by the top bar (`{y:242,height:92}` or `103`), then
  `scroll_until { selector: "id:swift_payment.form.fees_select", fully: true }`. Expected: one probe stroke (finger moving
  DOWN, ≤ 178 px, inside the container), then `Element id:swift_payment.form.fees_select fully visible after 1 swipe`. The row
  now reads 143 high, and the screenshot shows the `Fees*` label whole. **FAIL:** `fully visible after 0 swipes` while the row
  is cut. Another case: if the probe moved nothing, the reply ends `; its top edge lies on its scroll container's
  (0,242 1080x1736), and a probe swipe toward it moved nothing — nothing of it is cut there`. That is correct only if the
  screenshot shows the row whole.
- **Priority:** keyboard down, `id:swift_payment.form.priority_select` read `{y:1846,height:133}` (cut by CONTINUE). Same
  call. Expected: a probe with the finger moving UP, then `fully visible after 1 swipe` at 143 high. Same FAIL rule.
- **Carousel in a list** (`fills`): a card as tall as its horizontal carousel, fully inside the list. Expected reply tail:
  `; but it fills its scroll container (<x,y WxH>) exactly — its top and bottom edges lie on the container's, where Android
  cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — it may be cut there, a
  rect assert or screenshot may measure part of it; usual for a card as tall as its carousel — check with a screenshot`. No
  probe is sent. Which app has such a carousel is **to determine on device**.
- **Probe vs pull-to-refresh:** a pull-to-refresh list at rest, `fully: true` on its first row (flush with the list top).
  Expected: a probe of ≤ 178 px (65 dp, under SwipeRefreshLayout's 128 dp and Compose's 160 dp), NO refresh spinner or
  reload, and the reply `…; its top edge lies on its scroll container's (…), and a probe swipe toward it moved nothing —
  nothing of it is cut there`. The screen is **to determine on device** (the bank transaction list, if it has
  pull-to-refresh). **FAIL:** a refresh fires.
- **Unchecked wordings** (`; but its <edge> edge lies on its scroll container's (<rect>), where Android cuts a node's bounds
  to the container, and <why> — it may be cut there, a rect assert or screenshot may measure part of it`), where `<why>` is:
  `budget` → `no swipe or time was left to check it` (try `maxSwipes: 1` on a stop that needs one stroke and lands flush,
  opportunistic); `room` → `no scroll container around it has room for a probe swipe to check it` (item f); `tap` →
  `the probe swipe was too short to tell from a tap` (tiny screens only; unit-tested, do not chase it).
- Out of scope here: a row cut by a pinned bar drawn OVER the list reads cut at the bar, not flush, and is not probed (see §3).

### f. NEW — no probe under the IME (`da3dfe7`, repro `03c4248`)
**Fixed:** a probe's room is judged above the keyboard. The rule (`swipe.ts#strokeBox`): the container ∩ screen above the
IME top must be ≥ `MIN_STROKE_BOX` = 80 px along the stroke. If it is smaller, no probe is sent and `why: 'room'` is reported.
**Test shape** (`tests/interact/scroll.test.ts`, "a probe whose container has room on the screen but not above the IME"):
IME `[0,1398][1080,2220]`, list `0,1340 1080x800` (clipsDescendants), target row `66,1340 948x50`: flush with the list top,
wholly above the IME, 58 px of list above the keyboard.
**On device:** a docked IME, a focused field, and below it a list whose top lies < 80 px above the IME top, with a short
target (≤ that gap, e.g. a section header or label) at the list's very top. Run `scroll_until { selector: <target>, fully: true }`.
A candidate is landscape Settings search (IME band `[0,397][2220,1080]` there) or the bank account-detail search field above
the transactions list. The real screen is **to determine on device**: confirm the geometry in `ui_snapshot` first.
- **Expected:** NO swipe in the shim log, and
  `Element <sel> fully visible after 0 swipes; but its top edge lies on its scroll container's (<x,y WxH>), where Android cuts a node's bounds to the container, and no scroll container around it has room for a probe swipe to check it — it may be cut there, a rect assert or screenshot may measure part of it`.
- **FAIL:** any probe swipe (in particular one touching down outside the list, e.g. `540 444 → 540 613`), or a
  `checked` / "nothing of it is cut there" / plain `fully visible` reply.
- **Contrast (≥ 80 px of list above the IME):** the probe must be drawn inside the list's part above the IME. Record its
  start and end y.

### g. NEW — strokes toward the target with the IME up (`f20506f`, `528db47`)
**Fixed:** a stroke goes over the target's nearest clipping container that has room above the keyboard. If none has room,
it goes over the screen box with `coverTop` = the IME top. It never goes over a sibling list (the "largest scroller") that
cannot hold the target, and never over the whole screen including the keyboard.
**Setup:** Contacts editor, docked Gboard, `First name` focused. `scroll_until { selector: 'text:"Notes"', fully: true }`,
then a lower row (`text:"Add fields"`, whatever is below the fold). The IME top is 1398, or 1285 once Gboard grows; read it
from the reply's `[0,y][1080,2220]`.
- **Expected:** every stroke in the shim log lies inside the editor's scroll container (or the screen box) and above the IME
  top, and the stop is `fully visible after N swipes, judged above the soft keyboard over [0,<top>][1080,2220]` (or a plain
  `fully visible` when the band did not change the stop).
- **Sibling case (table test):** target in a list under the IME from y 1340, a larger sibling page above it. If a real screen
  with two scrollers shows up (a form over a list), check that the second stroke is NOT over the sibling. Which screen is
  **to determine on device**.
- **FAIL:** a stroke over another list, or a touch-down / lift-off at y ≥ the IME top.

### h. IME-up strokes in general
On every IME-up run above (d `left`, f, g, and the SWIFT form with the IBAN focused): both ends of every stroke lie above
the keyboard top. Check the field afterwards (`ui_snapshot` value / screenshot): **no characters typed into it** and no
key presses in the shim log (`keyevent`/`input text` that you did not send). **FAIL:** any stroke end in the band, or text
appearing in the focused field.

### i. P2 items
- **Inert keyboardDismiss note** (`…ios-inert-keyboard-dismiss-note-says-idb-carries-no-keyboard.md`): a scratch config with
  `app.ios.keyboardDismiss: [tap: { … }]` and no `treeSource`. Expected stderr, once per config:
  `app.ios.keyboardDismiss is set but app.ios.treeSource is idb (the default): the idb tree marks no node as the keyboard (on iOS 27 it lists the keys, as plain buttons), so no tap is ever refused or hidden and the list is inert — set treeSource: wda for it to apply`.
  With `treeSource: idb` set explicitly, the `(the default)` is absent. **FAIL:** "carries no keyboard" anywhere (the note or
  the `tap`/`scroll_until` descriptions).
- **Itemless WDA toolbar** (`…ios-wda-childless-toolbar-refuses-keyboard-dismissal.md`): Contacts "New Contact", scratch
  `treeSource: wda` + `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`, software keyboard up (hardware-keyboard
  prefs off), a field focused. Run `tap { platform: ios, selector: 'role:text text:"add pronouns"' }` (a row under the
  keyboard). Expected: the title tap hides the keyboard and the reply contains `hidden by tapping <the dismissal> before
  tapping`; the row is tapped. **FAIL:** `… none of the configured dismissals is usable on this screen (tap text:"New Contact"
  role:"text": covered by toolbar "Toolbar")`. Also possible: `Tapped <the dismissal> at (x,y) to hide the soft keyboard
  covering …, but it is still up: …`. That means the rule worked but a title tap does not hide this sheet's keyboard (never
  tried before). Record it as a finding, not a regression.

### j. Regressions of the earlier fixes (added by the device-check agent)
Round 3 rewrote the stroke box (both platforms go through `strokeRoom`), the clear (`fill-clear.ts`), the fill verdict and
the toolbar rule (`ae23890`: an itemless toolbar covers nothing). The fixes the 610660f check confirmed run through that code,
so re-run each once and write it as a `Holds` / `Fails` bullet in the note named:
- **Fullscreen SwiftUI toolbar (P3)** — `2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md`: SWIFT form,
  scratch `treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`, amount focused, a keyboard-covered
  tap/fill with `dismissKeyboard: true`. Expected as at 610660f: the title tap hides the keyboard, then the field is acted on.
  Watch for the one silent wrong action `dcd089b` states (an itemless toolbar that IS drawn over the dismissal).
- **iOS WDA scroll with the keyboard up** — `2026-10-08-scroll-until-ignores-android-soft-keyboard.md` (iOS sections):
  `scroll_until … fully: true` to a row under the keyboard. Expected: strokes inside the box above the keyboard, the stop inside it.
- **iOS idb fill / clear** — `2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md` and
  `2026-10-07-ios-fill-empty-value-fails-in-idb.md`: amount fill with `clear: true` (`Filled …` or the known
  `NOT verified … (the screen changed while typing)` of §3), and `text: "", clear: true` on an empty field
  (`Filled … (0 characters)`, no delete).
- **iOS tap off screen (P2)** — `2026-10-08-ios-tap-off-screen-reported-done.md`: tap on a row below the fold → refused, not `Tapped`.
- **iOS launch bare tree (P0)** — `2026-10-08-ios-launch-transition-tree-reads-as-rendered.md`: a cold `launch_app` (terminate
  first) of the bank app. The new foreground wait (a) runs before this read: record both, and that they do not double-warn.
- **Flow `launch:` step** — the a4 note as a `⚠ launch` trace line in a `run_flow` reply (scratch flow with `- launch` from the
  other app in front), not only in `launch_app`.
- **Android floating Gboard** — `2026-10-05-android-floating-gboard-keyboard.md`: floating Gboard on the SWIFT form, a tap on
  a row under it. Expected as at 610660f: `back` first, then the row; no letter typed. Restore docked Gboard afterwards.
- **Android SWIFT form, IME up** — `2026-10-08-scroll-until-ignores-android-soft-keyboard.md`: IBAN focused,
  `scroll_until id:swift_payment.form.debit_select fully: true` and `id:swift_payment.form.my_note_input` (at 610660f:
  2 swipes; and a fail after 3 swipes, "the last 2 … did not move it"). Record the new replies and strokes (also item h / §4).
- **Android clear on the SWIFT form** — the IBAN with `clear: true` (a value already in it): one delete round of the value's
  length, then `Filled …` — no second round now that the clear stops on an unchanged reading.

## 3. Known out of scope / not fixed (do not report as regressions)
- fill `NOT verified … (the screen changed while typing)` caused by the field's own clear button, and a clear alone never
  verified on floating-label fields: `docs/bugs/2026-10-09-ios-fill-screen-changed-from-fields-own-clear-button.md`.
- Pinned app chrome (a row under a bar drawn over the list, a tap on a bar): `docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md`.
- A no-`clear` fill passing on a pre-existing substring (the read-back is a containment test).
- WDA read cost (~4 s a read, long fill polls on WDA).
- The PIN-screen screenshot "did not settle".
- Android `row_3` behind the tab bar.
- A one-off hold-still timeout (the `settled: false` / still-moving note on a single run).

## 4. Deferred — measure if cheap: where the stroke box is cut above the keyboard
`strokeRoom` judges room above the keyboard, but the box it returns is not cut there. The driver's `scrollStroke` still
applies `coverTop` (`swipeVectorAbove`). On every IME-up run (f, g, h), record from the shim log each stroke's start y, end y,
length and duration, next to the IME top and the box (container) it was drawn in. Example row:
`stroke 540 1118 → 540 280, 839 ms, IME top 1398, box 0,242 1080x1736`. This shows later whether cutting the box earlier
would change stroke lengths.

## 5. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| a1 appinfo format | iOS / iPhone 17 iOS 27.0 | 347e70d | Holds | old-style plist, top-level keys; raw output in the launch note |
| a2 label = display name | iOS | 347e70d | Holds | idb labels "Skeleton Internal", "Contacts" = appinfo |
| a3 no previous-app tree (3× + 2×) | iOS | 347e70d | Holds | no ⚠, 1.0–2.0 s, every absent assert failed |
| a4/a5 give-up note, localized name | iOS | 347e70d | Holds (wording); NEW bug on its advice | `2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md`; "Kontakte" quoted in German |
| b Android hint clear (J, 1+9, clear alone) | Android / emulator-5554 | 347e70d | Holds | one round of 15, then `wifi`; 1 then 9; clear alone NOT verified wording |
| b WDA placeholderValue | iOS (wda) | 347e70d | Holds | WDA sends it; fill sent no delete; clear alone `Focused … exactly its placeholder` |
| b masked clear-twice | Android / iOS | 347e70d | Not reached | no password field in reach |
| c case mismatch wording | iOS (wda) | 347e70d | Holds | `… but for letter case, 1 character differing` (36.6 s) |
| d Settings / bank list drag, fast fail, spinner | Android | 347e70d | Holds; spinner / `left` not reached; NEW bug | `2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md` |
| e Fees / Priority / carousel / pull-to-refresh | Android | 347e70d | Holds (Priority on substitute rows; no pull-to-refresh screen) | 177 px probes, `fills` text on the account card |
| f no probe under the IME | Android | 347e70d | Not reached (< 80 px gap); contrast Holds | best gap 152 px; probe 1104→1152 inside the list |
| g strokes over the container above the IME | Android | 347e70d | Holds; sibling case not reached | Contacts editor strokes above IME top 1398/1285 |
| h IME-up strokes, nothing typed | Android | 347e70d | Holds | no stroke end in the band, no stray keys |
| i inert note, itemless toolbar | iOS | 347e70d | inert note Holds; itemless toolbar **Fails** | toolbars have one empty child; `ae23890` tests `children.length === 0` |
| j regressions (P3, iOS scroll, fills, P2, P0, flow launch, floating Gboard, SWIFT IME-up, IBAN clear) | both | 347e70d | Holds (empty idb field case not reached); NEW iOS bug | `2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md` (predates round 3) |
| 4 stroke y vs IME top | Android | 347e70d | Recorded | table in the soft-keyboard note |
