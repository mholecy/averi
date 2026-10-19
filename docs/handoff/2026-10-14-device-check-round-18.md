# Handoff: on-device check of round 18 (`arch/round-18` @ `dda435b`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 18 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 18 = `arch/round-17` (`84f51e6`) + the fixes from the device check of round 17 (results in round 17's handoff
§5) and the owner's decisions of 2026-10-14/15:

- **On iOS WDA a row is judged by what its scroll view draws** (the "drawn frame": the row's rect cut by every
  ancestor that scrolls). A row WDA lists inside a form or list but that the scroll view clips away is no longer
  tapped "Tapped" on bare background, no longer stopped on by `scroll_until` ("visible after 0 swipes"), and no longer
  measured by the colour assert on whatever lies there. Nothing drawn → `… it lies outside its scroll view scrollable
  (x,y wxh) …` with the usual remedy (beneath a presented screen "close it first", otherwise `scroll_until it first`).
  Android and idb are unchanged (idb lists no scroll view; recorded as a residual).
- **A row whose centre lies outside its scroll view but part of it is drawn is refused** (`only N% … is drawn …
  scroll_until it with fully: true first`), as at the screen's edge (owner 2026-10-15).
- **The colour/ocr assert judges covers on the drawn part only** (the region it samples): a button that lies only over
  the row's undrawn part no longer fails the assert (owner 2026-10-15). A sliver of 2 pt or less at the scroll view's
  edge fails closed as at the screen's edge.
- **`scroll_until … fully: true` on an element its scroll view's edge clips** names the edge's cutter and what of it
  is drawn, and words the cause per side: `… its content ends before the element does (no room after it — a layout
  defect)` (bottom/right), `… begins after the element does (no room before it …)` (top/left), or `It is taller than
  what of its scroll view the screen shows: no scroll shows it whole.` A cut at the screen's edge keeps its sentence.
- **`scroll_until`'s description** says the timeout is checked once a round, so a call can run past it by one swipe,
  the settle after it and one more round, all inside the reported time (owner Q3).
- **Closed probes (no change):** the iOS status band stays 62 pt (D.1); Android's docked keyboard line from the IME
  inset is right (D.2).
- **Known and recorded (not changed):** iOS strokes still go over the screen's middle, not the target's scroll view
  (a country-sheet row with `direction: up` may touch down above the sheet); an ocr assert on a text line cut at its
  scroll view's edge reads clipped glyphs.

A tool-level differential over 580 trees (every device tree of rounds 11–17 incl. the run17 raw payloads) against
`84f51e6`: changes only on iOS WDA trees, every group classified; Android 0, idb 0; no refused → Tapped.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- The owner logs mp-native in and confirms the backend is up before the run (Android fell to Welcome / SIGN IN in
  round 17 and was re-logged in); do not type credentials yourself.
- Save the raw payload next to every `ui_snapshot` you take, as in rounds 16–17: WDA
  `curl -s 'http://127.0.0.1:<port>/source?format=json'`, idb `idb ui describe-all --json --udid <udid>`, Android
  `adb -s <serial> exec-out uiautomator dump /dev/tty`. Same name as the snapshot. Do not commit them (bank data).
- Selectors: `role:text label:"…"` where plain `text:` matches a container and its text.

## 1. Build

1. `git checkout arch/round-18` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. A row outside its scroll view (iOS WDA)
Bug note `2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes`.

1. **mp-native SWIFT form at rest** (no sheet, no keyboard; the form's ScrollView `0,0 402x780`, CONTINUE below):
   - `ui_snapshot`: the root carries `"unclippedFrames": true`. Record `payee_name_input`'s and
     `payee_street_input`'s rects.
   - `tap id:swift_payment.form.payee_name_input` (rect `24,801 354x52` in round 17) → refused naming
     `outside its scroll view scrollable (0,0 402x780)` … `nothing was tapped`; **no** tap in the shim/idb log
     (before: `Tapped` at (201,827) on bare background).
   - `assert` colour on `payee_street_input` (round 17 B.2: rect `24,869`, 5 pt on screen) → **FAIL** closed, never
     PASS. Expected: an off-screen or outside-its-scroll-view sentence ending in a scroll advice. Same for ocr.
   - `scroll_until id:…payee_name_input` (direction down) → it **swipes** and either stops with the row drawn (record
     the reply) or fails naming the scroll view; never `visible after 0 swipes`.
   - After that scroll_until stops on it: `tap` it → `Tapped` and the field takes the focus.
2. **Country sheet open** (as round 16/17), the list ends at ~811: `tap role:text label:"Ukraine"` (or the last row
   whose frame lies below the list's bottom) → `… close it first …` (beneath the sheet) — record whether the reply
   names the scroll view. `scroll_until` to it: record the reply and whether the sheet stayed at its detent.
3. **Partly drawn row:** on the SWIFT form, scroll so that a field straddles the form's bottom at 780 with its centre
   below 780 (or the closest you can get) → `tap` refused `only N% … is drawn … fully: true first`; `assert` colour on
   a field straddling 780 with its centre above 780 → measured (no CONTINUE cover named when CONTINUE lies only below
   780). Record rects.
4. **Smoke (unchanged):** Settings (iOS) list: tap a visible row → `Tapped`; `scroll_until` a row below the fold →
   swipes and stops; colour/ocr on a fully visible row → measured as before. MyPort-style login (if available) with the
   keyboard up: `scroll_until` the submit button → swipes (touch-downs above the keyboard band), then stops; record.

5. **`fully` at a scroll view's edge:** on the country sheet, `scroll_until role:text label:"<a row cut by the list's
   bottom at ~811>" fully: true` → if the list cannot bring it whole, the reply names `scrollable (31,456 340x355)` and
   `N% of it is drawn`, never `no clearance for an overlay`. On Contacts' sheet scrolled (round 14 A.2 shape), a row cut
   at the sheet's top: `… begins after the element does …`. Record the replies.

### B. Android and idb unchanged (smoke)
1. Android emulator, Settings: `ui_snapshot` root carries **no** `unclippedFrames`; tap a row, `scroll_until` a row
   below the fold, colour on a visible row → same replies as round 17.
2. iOS idb (if used): one tap and one colour assert on a visible element → as before.

### C. `scroll_until` timeout wording (any platform)
1. Reproduce round 17's C.1 (`timeoutMs: 3000`, a selector not on the screen): the reply shape is unchanged; check
   the time reported against the description's bound (one swipe, the settle after it and one more round past the
   budget). Record it.

## 3. Out of scope
- Round 17 §3; residuals 10 and 11 of ADR 0018.
- Strokes over the screen's middle rather than the target's scroll view (recorded in ADR 0010).
- ocr on glyphs cut at a scroll view's edge (recorded in ADR 0010).

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 SWIFT at rest: tap / colour / ocr / scroll_until on rows below 780 | iOS WDA | | | |
| A.2 country sheet: row past the list's bottom | iOS WDA | | | |
| A.3 partly drawn row (tap refused, colour measured) | iOS WDA | | | |
| A.4 smoke (Settings, login with keyboard) | iOS WDA | | | |
| A.5 fully at a scroll view's edge (wording) | iOS WDA | | | |
| B.1 Android smoke | Android | | | |
| B.2 idb smoke | iOS idb | | | |
| C.1 timeout wording and bound | iOS / Android | | | |
| raw payloads saved (list) | iOS + Android | | | |


## 5. Device check results (2026-10-15, at `dda435b`)
Run by the device-check agents (Android 09:11–09:16, iOS 09:11–09:32 UTC, 2026-10-15) at `dda435b`, built from `arch/round-18`. Per-note results are appended to each bug note as `## Device check (2026-10-15 <platform>, re-run at dda435b)`. Summary: A.1 holds (root `"unclippedFrames": true`; tap on `payee_name_input` at `24,801` refused `outside its scroll view scrollable (0,0 402x780)`, no tap sent; colour/ocr on `payee_street_input` fail closed; `scroll_until` swipes once and stops, then the tap focuses the field). A.2 holds (the refusal names `scrollable (31,456 340x355)` with `scroll_until it first`, not `close it first` — the row belongs to the sheet's own list; `scroll_until` moved the sheet from Half screen to Expanded, not mentioned in the reply). A.3 holds (37% drawn, centre below 780 → refused `fully: true first`; 74% drawn, centre above → measured, no CONTINUE cover). A.4 holds for Settings; the login-with-keyboard half was not reached (hardware keyboard connected, simulator prefs not changed). A.5 partial: the new edge wording never came up (the half-detent sheet expanded and brought the row whole; the list's last row sits flush; Contacts' cut field scrolled back in) — and `no clearance for an overlay` never appeared. B.1 (Android) holds: no `unclippedFrames`, replies as round 17. B.2 (idb) holds. C.1 holds on both platforms (iOS 4593 ms / 3000 ms with 1 swipe, 9275 ms / 8000 ms with 2 swipes; Android 6552 ms / 3000 ms with 1 swipe — each overrun within the new description's bound). Incidents: one iOS PIN re-login (Home showed "That's an error"; terminate + launch, no clearState, `login_pin_ios_here` once); one unintended tap set Payee's country to "Uganda" on a SWIFT form that was then discarded (nothing submitted, fee OUR). Android mp-native stayed on its inactivity "Logged out" screen untouched (no Android item needed it). One Contacts tap (`Restore contacts`) was refused by the permission classifier and not attempted otherwise. Raw payloads stay in the run folders (bank data, account e-mail).
New bug notes: `2026-10-15-android-numeric-character-references-in-uiautomator-attributes-are-not-decoded.md`, `2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md`, `2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-as-straight.md`.

### Android: B.1 Android Settings smoke

- **No `unclippedFrames` on the root.**
  - `settings1.txt` (#8): the root keys are `children, identifier, label, paddedTouchTargets, rect, role, value`.
  - `grep -c unclippedFrames settings1.txt` → `0`. The same holds for `settings2`, `settings3` and `contacts1`.
  - Only the Android `paddedTouchTargets` mark is present, as before.
- **Tap a row.**
  - #9 `tap text:"Storage"` → `Tapped text:"Storage"` (4.6 s). Shim: `09:12:50 -s emulator-5554 shell input tap 293 799`.
  - The Storage page opened (`img-10-0.png`).
  - #11 `press_key back` → `Pressed back`. Shim: `09:13:01 … input keyevent 4`.
- **`scroll_until` a row below the fold.**
  - #12 `scroll_until text:"System" direction:down` → `Element text:"System" fully visible after 2 swipes` (13.8 s).
  - Shim: `09:13:03 input swipe 540 1736 540 484 1254`, then `09:13:08 input swipe 540 1783 540 669 1116`.
  - The first stroke, made before the target was found, is drawn over the screen's largest scrollable. The second is drawn over the target's container, as the description says.
  - It stopped with System at `198,1485 182x74` (`settings2.txt`, #14; `img-13-0.png`).
- **Colour (and ocr) on a visible row.** #15:
  - `PASS  element text:"Google" fill within dE00 8 of #F0F0F3 — sampled #F2F0F4 (dominant, 73% of region) vs expected #F0F0F3 → dE00 1.21 ≤ 8; scale 1.000`
  - `PASS  element text:"System" renders text "System" — read "System"; vs expected "System" =`
  - The reply has the same shape as round 14's #29 Settings colour PASS (`… (dominant, 73% of region) … scale 1.000`) and the earlier ocr PASS lines, which also end in `=`.
- **Extra unchanged-behaviour checks** (Settings, after C.1; `settings3.txt`, #18):
  - #19 `tap text:"Notifications"`, with the row clipped out above `recycler_view` (`198,297 310x0`), → `Timed out after 5000ms waiting for element text:"Notifications" to appear` / `(it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)`. This is the same wording as round 13 #17 and round 14 #28. Nothing was tapped.
  - #20 `scroll_until text:"Notifications" direction:up fully:true` → `Element text:"Notifications" fully visible after 1 swipe`. Shim: `09:14:39 input swipe 540 669 540 1783 1116`.
  - #21 colour + ocr on Notifications → both PASS (`sampled #F2F0F4 (dominant, 74% of region) … dE00 1.21`; `read "Notifications"`).
- Verdict: **holds.** The Android replies keep their round 13–17 shapes, and nothing in the WDA "drawn frame" change leaked into Android.

### Android: C.1 `scroll_until` timeout wording and bound (Android)

- **The description's bound**, read from round 18's tools list (`tools.txt`, `__list` #3), verbatim: "The timeout is checked once a round, after its tree read (and, on Android, its keyboard queries), so a call can run past it by one swipe, the settle after it and one more such round — the one that shows what that swipe did; the time a failure reports includes all of it."
- **#16** (`09:13:54.859Z`, `direction:"up"`, `timeoutMs:3000`, `text:"zzq averi no such row 18"`):
  - Reply: `scroll_until text:"zzq averi no such row 18" failed after 6552ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4786ms, the last 2448ms) — element never appeared in the tree`.
  - Shim: `09:13:57 input swipe 540 669 540 1783 1116`.
- **#17** (`09:14:01.493Z`, same call):
  - Reply: `… failed after 6821ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 5009ms, the last 2533ms) — element never appeared in the tree`.
  - Shim: `09:14:04 input swipe 540 669 540 1783 1116`.
- **Arithmetic for #16:**
  - Round 1 read: 4786 − 2448 = 2338 ms. That is under the 3000 ms budget, so one swipe is allowed.
  - Swipe plus settle: 6552 − 4786 = 1766 ms (a 1116 ms stroke plus about 650 ms of settle).
  - Round 2 read: 2448 ms. After it the budget is spent, so the call fails.
  - The overrun is 3552 ms, which is exactly one swipe, its settle and one more round. The bound in the description is about 3000 + 1766 + 2448 ≈ 7.2 s at most, given these read times.
- **#17** fits the same breakdown: 2476 ms + 1812 ms + 2533 ms.
- **Against round 17:** the reply has the same shape (round 17: `failed after 6558ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4719ms, the last 2416ms)`). The reported time includes the whole overrun.
- Verdict: **holds**. The wording is unchanged, and the time reported lies inside the description's bound.

### Android: Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| B.1 Android smoke | Android emulator-5554 (API 33, gesture), Settings | `dda435b` | **holds** | #8 `settings1.txt` root keys `children, identifier, label, paddedTouchTargets, rect, role, value`, no `unclippedFrames`; #9 `Tapped text:"Storage"` (shim `09:12:50 input tap 293 799`, `img-10-0.png`); #12 `Element text:"System" fully visible after 2 swipes` (shim `09:13:03`/`09:13:08` swipes); #15 `PASS … text:"Google" fill … sampled #F2F0F4 (dominant, 73% of region) … dE00 1.21 ≤ 8; scale 1.000` + ocr `read "System"`; extra #19 clipped-row timeout wording as round 13/14, #20 `fully visible after 1 swipe`, #21 2/2 PASS |
| C.1 timeout wording and bound | Android emulator-5554, Settings | `dda435b` | **holds** | #16 `failed after 6552ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 4786ms, the last 2448ms) — element never appeared in the tree`; #17 `6821ms … 5009ms, the last 2533ms`; 1 swipe each (shim `09:13:57`, `09:14:04`); the overrun is exactly one swipe + settle (1766 ms) + one more round (2448 ms), inside the description's bound |
| raw payloads saved (Android) | Android emulator-5554 | `dda435b` | **saved**: `settings1`, `settings2`, `settings3`, `contacts1` (`.txt` + `.xml`); no bank data, but `contacts1` holds the Google account e-mail | `$R/*.txt`, `$R/*.xml` |
| NEW numeric char refs not decoded | Android emulator-5554, Google Contacts | `dda435b` | **fails** (new note above) | #23 label `…finshape.com&#10;Account and settings.`; #25 `FAIL … \nAccount … not found within 3 s` / `PASS … &#10;Account … exists` |

### Android: Gaps and observations

- **Denied by the permission classifier (not worked around):** `tap text:"Restore contacts"` in Google Contacts. This
  was a probe of a row flush with `organize_container`'s bottom at 1977 (`187,1928 339x49`), meant to check the
  cut-strip refusal. It was denied as "Irreversible Local Destruction". The call never reached the daemon, so it has no
  call number and no shim line.
- `select_device` takes `device`, not `deviceId` (#4 schema error). This was my mistake, not a bug.
- Settings tree reads took about 2.3–2.5 s each on this emulator, as in round 17.

### Android: End state (09:16:27 UTC)

- **Settings** (`com.android.settings`): in the foreground at its top level, scrolled to the top (`img-27-0.png`). No
  value was changed.
- **Google Contacts:** in the background on its Organize tab. Nothing was tapped there.
- **mp-native:** in the background, untouched, on its "Logged out" screen as handed over.
- **Navigation:** still gesture navigation, the same as at the start. Keyboard never raised. The daemon is still running.
- **Files in $R:**
  - `results.md`, `session.log`, `adb-input.log`, `tools.txt`
  - `img-7-0.png`, `img-10-0.png`, `img-13-0.png`, `img-24-0.png`, `img-27-0.png`
  - `settings1/2/3.{txt,xml}`, `contacts1.{txt,xml}`

### iOS: TABLE

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1 SWIFT at rest: tap / colour / ocr / scroll_until on rows below 780 | iOS WDA, iPhone 17 iOS 27.0 | `dda435b` | **holds** | root `"unclippedFrames": true`; `payee_name_input 24,801 354x52`, `payee_street_input 24,869 354x52` (#20); tap → `… is outside its scroll view scrollable (0,0 402x780) at (201,827): nothing of it is drawn (rect 24,801 354x52) — scroll_until it first; nothing was tapped` (#21), shim 8→8; colour #22/#23 and ocr #24 `FAIL … nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780) (element 24,869 354x52, …) — scroll it into view: scroll_until the element first and re-run; failing closed, …`; scroll_until → `fully visible after 1 swipe` (#26, l.9), rect `24,100`; tap → `Tapped` l.10 `201 126`, focus ring `img-31-0.png` (#29) |
| A.2 country sheet: row past the list's bottom | iOS WDA | `dda435b` | **holds** (reply names the scroll view; scroll advice, not `close it first` — the row is the sheet's own) | `role:text label:"Ukraine" is outside its scroll view scrollable (31,456 340x355) at (77,847): nothing of it is drawn (rect 48,836 57x21) — scroll_until it first; nothing was tapped` (#49); `row_8` same (#50); shim 15→15; scroll_until Ukraine → `fully visible after 2 swipes` (#79, l.32–33), sheet went `Half screen` → `Expanded` (#78 → #80, `img-81-0.png`) |
| A.3 partly drawn row (tap refused, colour measured) | iOS WDA | `dda435b` | **holds** | `payee_name_input 23,760 356x54`: `… at (201,787): only 37% of it (rect 23,760 356x54) is drawn, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped` (#36), shim 12→12; `23,740 356x54` (centre 767): colour `PASS … sampled #FDFDFD (dominant, 98% of region) … dE00 0.40 ≤ 8` (#40), no CONTINUE cover; sheet list: `only 32%` (#60) / `only 48%` (#61); ocr #41 fails only on `’` vs `'` (NEW note) |
| A.4 smoke (Settings, login with keyboard) | iOS WDA, Settings + MyPort | `dda435b` | **holds** (Settings); keyboard part **not reached** | `Tapped id:com.apple.settings.camera` (#128, l.56 `201 528`, Camera opened `img-129-0.png`); `scroll_until role:button label:"Privacy & Security"` → `fully visible after 1 swipe` (#133, l.58), row `16,403`; colour `PASS … sampled #FFFFFF (dominant, 96% of region) … dE00 0.00` (#131), ocr `PASS … read "Accessibility"` (#132). MyPort login: hardware keyboard connected, no software keyboard (`SystemInputAssistantView 0,874`, `myport-login.txt` #138); `scroll_until id:login_submit` → `fully visible after 0 swipes` (#139); prefs not changed, so no keyboard-up run |
| A.5 fully at a scroll view's edge (wording) | iOS WDA | `dda435b` | **partial — wording not reached** | country `row_7` cut at 811 → `fully visible after 2 swipes` (#57): the first stroke expanded the sheet, so the row came whole; list end flush (`row_248 24,771 354x45`, list bottom 816, #74); Contacts `First name 36,56` cut at 62 → `fully visible after 1 swipe` (#146, 19.2 s). Neither `N% of it is drawn` nor `begins after the element does` arose; `no clearance for an overlay` never appeared |
| B.2 idb smoke | iOS idb, mp-native Transactions | `dda435b` | **holds** | idb tree (#112, `transactions-idbtree.txt`, no `unclippedFrames`): `row_37 'Alza' 24,139 354x52`; colour on `row_38` `PASS … sampled #F1F3F5 (dominant, 93% of region) vs expected #F2F3F6 → dE00 0.83 ≤ 8` (#114); `row_44 24,734` → `FAIL … button "Cards" (201,755 82x64, reaching 201,742 82x77) is drawn over the element … failing closed` (#115); `Tapped id:transactions.list.row_37` (#116, l.53 `201 165`), Alza detail opened `img-117-0.png` |
| C.1 timeout wording and bound | iOS WDA, Transactions tab | `dda435b` | **holds** | `scroll_until id:averi.round18.nothing failed after 4593ms (timeout 3000ms; 1 swipe sent; 2 tree reads took 3473ms, the last 2140ms) — element never appeared in the tree` (#109, l.50); 8000 → `failed after 9275ms (timeout 8000ms; 2 swipes sent; 3 tree reads took 7096ms, the last 2964ms) …` (#110, l.51–52). Overruns 1593 / 1275 ms, each below one swipe + settle + one round (last read 2140 / 2964 ms) as the description now states ("a call can run past it by one swipe, the settle after it and one more such round"); swipe counts match the shim |
| NEW alert dim no cover | iOS WDA | `dda435b` | **fails** (NEW note) | beneath "Exit confirmation": `Tapped id:swift_payment.form.message_for_bank_input` (#100, l.47; also #85, l.36) with the target `hidden` in averi's tree; colour sampled the dim `#CACACA` (#101); `scroll_until` `fully visible after 0 swipes` (#102) |
| raw payloads saved (iOS) | iOS | `dda435b` | **saved** | per snapshot `<name>.txt` + `<name>-wda.json` + `<name>-idb.json`: `swift-rest` (#20), `swift-scrolled1` (#27), `swift-name-focused` (#30), `swift-straddle1` (#35), `swift-straddle2` (#39), `swift-country-sheet` (#47), `country-after-uganda` (#53, taken after the sheet had closed — misnamed), `swift-country-sheet2` (#56), `country-after-row7` (#58), `country-end` (#74), `country-after-ukraine` (#80), `swift-exit-alert` (#98), `swift-exit-alert-after` (#103), `transactions` (#108), `settings` (#124), `settings-root` (#127), `settings-scrolled` (#134), `myport-login` (#138), `contacts-new` (#142), `contacts-scrolled` (#144), `contacts-after-fn` (#147) — 21 × 3 files; plus `transactions-idbtree.txt` (#112, idb-path tree); all in `run18-ios` only |

### iOS: Gaps and observations

- **`scroll_until` on a half-detent sheet's own row changes the detent, silently.** #57 and #79: the first stroke (touch-down (201,699) on the sheet's list, which is still at its top) dragged the sheet from `Half screen` to `Expanded`; the second stroke turned back; the reply only says `fully visible after 2 swipes`. ADR 0018 lets a row of the presented sheet be swiped for on the sheet; the handoff lists strokes over the screen's middle as known (ADR 0010). Not filed; the reply could say the sheet moved to another detent (it is visible in the grabber's value).
- **A.2 premise.** The handoff expected `… close it first …` for the country row past the list's bottom; the row is the sheet's own list row, so `scroll_until it first` is right. The reply names the scroll view as asked.
- **A.5 not reachable** on these screens: at the half detent a `fully` scroll expands the sheet instead of failing; at the list's end the last row is flush; Contacts' first content is not cut at the top.
- **Top bar over `payee_name_input` after #26.** The stop at `24,100` leaves the field's top 16 pt under the form's top bar (0–116, `img-28-0.png`), yet the reply says `fully visible`. This is the top-bar case of `2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md`, out of scope by the owner's decision there; the tap at y 126 (below 116) still focused the field.
- **Colour on a partly drawn row says nothing of the cut.** #37 (`only 37%` drawn by the tap's measure) and #62 (`only 48%`) PASS with `100%`/`99% of region` and no "clipped … off-png"-style note, which round 17 printed for screen-edge cuts. Consistent with the owner's 2026-10-15 decision (judge the drawn part); noted only.
- **Slow call.** #146 (Contacts, `scroll_until … fully`, 1 swipe) took 19.2 s; #148 (`tap close`) 9.3 s. Not investigated.
- **"That's an error" on first Home open** recurred (`img-9-0.png`); TRY AGAIN did not help; terminate/launch + PIN fixed it, as in rounds 16–17.
- idb tree on the Transactions tab lists the tab buttons at `y 755 82x64` while WDA lists the hidden host-tab copies at `711 66x52` (`transactions-idbtree.txt` vs `transactions.txt`); the drawn bar is at ≈ 742–830. Consistent with earlier rounds; noted only.

### iOS: End state

- Simulator `37956039-…` the only booted one; mp-native in front, logged in, on the Transactions tab (tab bar visible, `img-151-0.png`), no form open (SWIFT form left via Back → Discard at #86 and #105; nothing submitted, nothing continued/confirmed/certified; fee OUR throughout; the only field changed was Payee's country = Uganda, discarded).
- Contacts: 6 stock contacts, nothing saved (`img-149-0.png`). Settings: General → Camera opened and closed, nothing changed; ended scrolled on the root list. MyPort: on its login screen, nothing typed.
- WDA stopped (xcodebuild 94735 killed, WDA 94738 gone, port 8100 closed). Daemon on 47933 left running.
- Nothing written outside `run18-ios`; no averi source, `averi.yaml`, handoff or bug note edited; no git writes.
