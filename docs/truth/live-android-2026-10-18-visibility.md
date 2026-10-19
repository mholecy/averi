<!-- The live golden on Android, round 6's device check (forms and visibility groups), as scripts/truth/live.ts printed
it — judged again from the run's records (docs/truth/live-records, `--rejudge`) after the check refiled what it found —
2026-10-18: averi_lab AVD (emulator-5554, Android 13 / API 33, 1080x2220, gesture navigation, docked Gboard), booted
`-no-snapshot-save`; the Android lab app built from truth/r6-device (= truth/round-6 e98b87e: carousel-in-list,
own-parts I, scroll-collapsing). Two srcs, the same harness (this branch's cases and judges):
  - before: round 5's src b71cbbb (`--side`, a detached checkout), record android-vis-b71cbbb.json;
  - after: round 6's src e98b87e (truth/round-6: S1 LV4/LV5 WDA-only, S2 F2A1's cut-by-later refusal, S3 L1's
    presented window, S4 axis-aware strokes), record android-vis.json.
Reproduce (adb outside the sandbox):
  node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups forms,visibility [--side <checkout>] [--record <file>]
The cases come from the static truth (tests/fixtures/truth/android-averi_lab-api33, live-visibility.ts#visibilityCases)
and live.ts's forms cases; the oracle is the app's tap log, its scroll offsets and strokes, its frames, focus, submits
and touch log. Every visibility case not ok at e98b87e is KNOWN (scripts/truth/live-known.ts) — the marks below. The
previous Android runs (src debc9b2): docs/truth/live-android-2026-10-16.md (forms), live-android-2026-10-16-visibility.md. -->

# What the check added to the harness

- **A refusal case beneath a presented layer in no scroll view** (live-visibility.ts#visibilityCases,
  #judgePresentedScroll): `scroll_until` toward each of alert-dim's and sheet-medium's A–D. Their targets lie in no
  scroll view, so every touch the app logs is a stroke on the layer — L1's effect, which no live case asked before.
- **F2A1's phone** (live.ts k6, k7; Android): `tap phone` with the IME up — never a submit, refused or tapped where it
  focuses phone; `scroll_until phone` — no stop while its centre lies under the bar or the IME, the strokes counted.
- 133 cases a src: 22 forms (k6, k7 new), 111 visibility (73 in the previous record; new: the 8 presented scrolls, the
  phase-4/round-6 cells — scroll-sticky-view 3, carousel-in-list 6, scroll-collapsing 6 with `turn:scroll-collapsing.A`,
  own-parts I, text-sample 10, text-under-bar 3, text-nav-cut 1).

# Before (b71cbbb) and after (e98b87e)

| src | cases | ok | loud | mismatches | not known (HEAD's KNOWN) |
|---|---|---|---|---|---|
| b71cbbb (round 5) | 133 | 108 | 5 | 20 | 9 — L1's 8 presented scrolls, F2A1's k7 |
| e98b87e (round 6) | 133 | 116 | 6 | 11 | 0 |
| e98b87e, visibility only (live-rejudge.test.ts) | 111 | 97 | 3 | 11 | 0 |

# What turned

| cases | b71cbbb | e98b87e | |
|---|---|---|---|
| scroll alert-dim A–D | "fully visible after 1 swipe": the one stroke (touch-down 540,444 or 540,1776) DISMISSED the alert (`dismissed alert`), the tap then found the target | `stopped before any swipe — … the next swipe would touch down at (540,444) on the dim outside container (155,851 770x517) — a dialog is presented over it — close it first`; no touch logged | **L1 fixed live** |
| scroll sheet-medium A, B | "fully visible after 1 swipe": the stroke at 540,444 landed on the scrim, `dismissed sheet` | `stopped before any swipe — … on other "Close sheet" (0,0 1080x1110) — a screen is presented over it (a modal or a sheet) — close it first`; no touch | **L1** |
| scroll sheet-medium C, D | three strokes at 540,1776 EXPANDED the sheet (S y 1353 → 243), "never appeared in the tree" | stopped before any swipe, "close it first"; no touch | **L1** |
| tap alert-dim / sheet-medium A–D | ok: "Timed out … waiting for element … to appear" | ok: "Timed out after 5000ms: element … is not in the tree, which lists only the window presented on top … — close it first" | L1's wording |
| k6 tap phone (IME up) | `Tapped` at 540,1391 (the bar's padding), phone focused | refused naming `container id:lab.form-keyboard.submit`; focus stays on postcode, no submit | **F2A1** |
| k5 tap note after back | `Tapped` at 540,2133, note focused | refused: "cut at its top edge by container … submit … only a 970x14 part of it shows" — no submit | **F2A1** |
| k7 scroll_until phone | MISMATCH: "visible after 0 swipes — CLIPPED at bottom, 67% …", no stroke, phone's centre under Continue | ok: **1 stroke** (touch-down 540,1034) moving the form 167 px (phone y 1296 → 1129), "fully visible after 1 swipe", phone's centre clear of the bar; 18 px of its bottom still under the bar's top padding (no node) | **F2A1** — the replay's 3 swipes are not the device's |
| k3 fill note under the IME | ok: the fill tapped note's 14-px strip and typed | LOUD: refused for the same strip, the field untouched | F2A1's consequence (owner) |

LIVE_KNOWN: no entry turned ok (L1 and F2A1 had none — their cases are new or forms cases); LV2's two flush cases are
ok in both runs (intermittent, kept).

# What is new (KNOWN, filed)

| cases | what the app shows | note |
|---|---|---|
| carousel-in-list tap C, scroll C (`right`) | `Tapped` at 1047,497 — the page's background, nothing fires; the stop "fully visible after 0 swipes", no stroke. Same at b71cbbb | **LE1** across a carousel (live-known.ts; the note's Status) |
| turn:scroll-collapsing.A | 4 swipes down at 540,1820: the list 715 → 1984 → 2488 (A from y -11 to -1784), the last two unmoved; no turn; the reply names `up` ("clipped out above its scroll container … scroll_until it with direction: \"up\""). Same at b71cbbb | **#10**'s open part: filed as the note, calibration.json #10 `openLive` (new field, lab-notes.test.ts), pending ADR 0021's uiautomator turn |

The rest of round 6's new cells are ok at both srcs: scroll-collapsing tap A (refused "clipped out above …"), scroll A
`up` (1 swipe, 715 → 0, fired), D, D.fully; carousel-in-list B, U; scroll-sticky-view R, R.fully; own-parts I
(`label:"Close"`); text-sample, text-under-bar, text-nav-cut.

# Still open (as in the previous run, KNOWN)

LE1 (scroll-bounded P.fully, S, S.fully, tap S), VA1 (scroll-sticky-cut R.fully), LV1 (scroll-bounded O, F;
tabbar-floating F: "the last 2 swipes did not change the screen" while the app logged them moving the list), #24 (fab
L, K refused under the FAB host: accepted), turn:scroll-bounded.F (LOUD: F unlisted, honest), F2A2 (b1d, b7: `input
text` fails on non-ASCII, LOUD).

# Android points the owner decided (2026-10-18)

1. **ADR 0021's uiautomator turn — decided: NO turn.** Unmoved strokes on uiautomator are no proof; the tool reports the
   direction, the agent turns. `turn:scroll-collapsing.A` — averi strokes the caller's `down` until two unmoved strokes,
   then fails loudly naming `up` — is that rule: its judge on Android became live-visibility.ts#judgeAndroidTurn (ok:
   no turn, at most `UNMOVED_STROKES_EXHAUST` unmoved strokes, the target's direction named), the case struck off
   live-known.ts and calibration.json #10's `openLive` closed. Rejudged from android-vis.json (no device): ok;
   visibility 111 cases / 98 ok / 3 loud / 10 mismatches, 0 not known. `turn:scroll-bounded.F` stays LOUD (not-reached):
   F unlisted, the reply names no direction — honest. WDA's turn cases keep ADR 0021's turn judge.
2. **ADR 0021's one-stroke stop — decided: the two-stroke stop KEPT on uiautomator.** ADR 0021 states the rule with
   this check's live example (4 swipes, the last 2 unmoved, then the loud failure naming `up`), F2A1's phone kept as
   the replay's figure only.
3. **F2A1's refusal and fills — decided: k3 is REFUSED BY DESIGN.** A fill into a control a later node cuts to a strip
   under the tap minimum is refused like the tap; k3's judge reads the refusal with the remedy and the field untouched
   as ok (live.ts k3; rejudged: forms+visibility 133 cases / 118 ok / 5 loud / 10 mismatches, 0 not known). F2A1's way
   past ("only if a screenshot shows it whole … tap by coordinates") is kept, every remedy before it (pinned over the
   real captures, tests/helpers/escape-order.ts; ADR 0013 "Decided 2026-10-18").
4. **"fully visible" with 18 px under a surface with no node (k7) — decided: a KNOWN residual.** k7's judge reads the
   stop ok (phone's centre clear of the bar), so no live KNOWN entry; filed as ADR 0013's accepted residual and in
   F2A1's note, with a future "eyes" item in docs/plans/2026-10-15-ground-truth-lab-app.md (verify a "fully" claim with
   pixels where a node-less sibling's padding may lie over the target).
5. **ADR 0018's residuals 18 and 19 — accepted,** with an honest hint on the tap's and fill's wait ("… to appear") and
   `scroll_until`'s "element never appeared in the tree" on uiautomator, where the presented window's words do not
   claim them (not the asserts' "not found", nor a flow's `wait:`): `(the tree lists only the active window: if a sheet or a dialog is open over the
   screen, close it first)` (ui-tree/standing.ts#ACTIVE_WINDOW_HINT). `form-picker`'s six rows are filed as residual
   18; lab cells for a full-screen dialog and a Views `BottomSheetDialog` are planned.

# The active-window hint, run live (round 6's closing review)

Decision 5's hint had only been read off replayed trees. Run on the device on 2026-10-18 (averi_lab, emulator-5554,
booted `-no-snapshot-save`; lab app and src built from truth/r6-cr2 ea070d2 = truth/round-6 9d1aaf8 + arch/r22-cr2),
a narrow run, record docs/truth/live-records/android-vis-hint-ea070d2.json (pinned in live-rejudge.test.ts, as the other
partial records are: 24 cases, 21 ok, 1 loud, 2 mismatches):

  node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups forms,visibility --cases c2,c3,c4,tap:scroll-bounded.O,scroll:scroll-bounded.O,tap:scroll-bounded.F,scroll:scroll-bounded.F,turn:scroll-bounded.F,<tap: and scroll: of alert-dim and sheet-medium A–D> --record <file>

24 cases, 21 ok, 1 loud, 2 mismatches (0 not known):
- **form-picker's expanded sheet** — new forms cases c2–c4 (live.ts; live-forms.ts#judgeUnderSheet): a tap on name,
  country, submit with the picker sheet open and fully expanded (no scrim, no presented window marked: residual 18).
  All ok: nothing fired (no row selected, no submit, the sheet not dismissed, no field focused), and each reply is the
  wait with the hint beneath it, verbatim: `Timed out after 5000ms waiting for element id:"lab.form-picker.name" to
  appear` / `(the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first)`.
- **scroll_until "never appeared"** — scroll:scroll-bounded.O and .F: `… — element never appeared in the tree (the tree
  lists only the active window: if a sheet or a dialog is open over the screen, close it first) — if it lies above, try
  direction: "up"`; turn:scroll-bounded.F the same, swiping up; their taps' waits carry it as c2–c4's. Verdicts as
  before: O and F LV1's `unchanged-claim` (known), turn F LOUD (not-reached).
- **Said once, and only where no window is marked**: counted per reply over the record, every reply above carries
  "close it first" exactly once; none of L1's 16 presented cases (tap and scroll_until on alert-dim and sheet-medium
  A–D, all ok) carries the hint — their presented remedy alone, once each (`… — a dialog is presented over it — close it
  first`, `… — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it …`).

# The run itself

The first run at e98b87e (docs/truth/live-records/android-vis-e98b87e-run1.json) had three tool calls hang past the
MCP client's 300 s timeout — `tap:bands.Q`, `tap:bands-three-button.O`, `scroll:tabbar-floating.F` — and the bands Q
tap landed late, inside the next case (`tap:bands.N` logged `tap Q`). The emulator was slow throughout (a
`uiautomator dump` took ~2.9 s; `4 tree reads took 10893ms` in one reply), the whole run took ~80 min. A rerun of the
three cells on the same build (no restart) ran clean: bands and bands-three-button every case ok, tabbar-floating F
once LOUD at the 15 s budget (3 swipes, slow reads) and once as LV1 (known). android-vis.json is the first run with
those three cells' 15 cases from the reruns (bands, bands-three-button from the first rerun, tabbar-floating from the
second); the b71cbbb run had no such hang. Not reproduced, not diagnosed: an averi hang would need a capture of the
adb commands under way (no session log was kept) — worth watching on the next Android run.

<!-- averi: e98b87e (this checkout, rejudged from docs/truth/live-records/android-vis.json) -->
# Live golden: 133 cases, 116 ok, 6 loud, 11 mismatches (0 not known), 0 skipped

## uiautomator
- ok k1 form-keyboard: a tap under the keyboard, no dismissal configured: refused, the focus stays (Android: hidden with back, then tapped — the focus on vs) — Tapped id:"lab.form-keyboard.vs" (the soft keyboard covered id:"lab.form-keyboard.vs"; hidden before tapping)
- ok k4 form-keyboard: a tap on the submit pinned above the keyboard fires it — Tapped id:"lab.form-keyboard.submit"
- LOUD k3 form-keyboard: a fill under the keyboard with a dismissal (Android: none configured — back hides it) — the app holds "", not "Thanks - ok" — field untouched; averi: ERROR id:"lab.form-keyboard.note" was not tapped: after back was pressed to hide the soft keyboard, it is cut at its top edge by container id:lab.form-keyboard.submit (55,1994 970x132), drawn after it — the dump (Compose
    type_text → ERROR id:"lab.form-keyboard.note" was not tapped: after back was pressed to hide the soft keyboard, it is cut at its top edge by container id:lab.form-keyboard.submit (55,1994 970x132), drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the rest of it may lie under that container; only a 970x14 part of it shows, at 55,2126, 14 deep across that edge, under the 65 a tap needs — scroll_until it out from under that container first (only if a screenshot shows it whole — a control that thin laid flush against that container — no scroll shows more: tap by coordinates)
- ok k5 form-keyboard: a tap on note, under the IME and, once back hid it, under the bar dropped to the bottom: never a submit — refused, nothing fired (focus postcode): ERROR id:"lab.form-keyboard.note" was not tapped: after back was pressed to hide the soft keyboard, it is cut at its top edge by container id:lab.form-keyboard.submit (55,1994 970x132), drawn after it — the dump (Compose
- ok k6 form-keyboard: a tap on phone, under the bar riding on the IME (its dump a strip cut at Continue): never a submit — refused, or tapped where it focuses phone — refused, nothing fired (focus postcode): ERROR id:"lab.form-keyboard.phone" is cut at its top edge by container id:lab.form-keyboard.submit (55,1238 970x132), drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node cove
- ok k7 form-keyboard: scroll_until phone, under the bar riding on the IME: no stop while its centre lies under the bar or the IME, never a submit (the strokes counted) — stopped with phone's centre clear of the bar and the IME (phone 1129–1228 (launched 1296), 18 px of it under the bar); 1 stroke(s) the app logged at (540,1034): Element id:"lab.form-keyboard.phone" fully visible after 1 swipe
- ok b1 form-basic: fill, no clear, a name — Filled id:"lab.form-basic.name" (9 characters)
- LOUD b1d form-basic: fill, no clear, a name with diacritics — the app holds "Jan ", not "Jan Šťastný" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShellCommand.onCommand(InputShellCommand.java:231) ⏎ 	at com.android.modules.utils.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:97) ⏎ 	at android.os.ShellCommand.exec(ShellCommand.java:38) ⏎ 	at com.android.server.input.InputManagerService.onShellCommand(InputManagerService.java:3807) ⏎ 	at android.os.Binder.shellCommand(Binder.java:1049) ⏎ 	at android.os.Binder.onTransact(Binder.java:877) ⏎ 	at android.hardware.input.IInputManager$Stub.onTransact(IInputManager.java:1144) ⏎ 	at android.os.Binder.execTransactInternal(Binder.java:1285) ⏎ 	at android.os.Binder.execTransact(Binder.java:1244)
- ok b2 form-basic: type_text without a selector types into the focused field — Typed 6 characters
- ok b3 form-basic: fill, clear, an e-mail — Filled id:"lab.form-basic.email" (23 characters)
- ok b4 form-basic: fill, clear, an IBAN with spaces — Filled id:"lab.form-basic.iban" (29 characters)
- ok b5 form-basic: fill the amount (decimal pad) — Filled id:"lab.form-basic.amount" (7 characters)
- ok b6 form-basic: fill the secure PIN (number pad) — Filled id:"lab.form-basic.pin" (4 characters)
- LOUD b7 form-basic: fill typographic text (’ “ ” – …) — the app holds "O", not "O’Brien “Jr.” – Co…" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShellCommand.onCommand(InputShellCommand.java:231) ⏎ 	at com.android.modules.utils.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:97) ⏎ 	at android.os.ShellCommand.exec(ShellCommand.java:38) ⏎ 	at com.android.server.input.InputManagerService.onShellCommand(InputManagerService.java:3807) ⏎ 	at android.os.Binder.shellCommand(Binder.java:1049) ⏎ 	at android.os.Binder.onTransact(Binder.java:877) ⏎ 	at android.hardware.input.IInputManager$Stub.onTransact(IInputManager.java:1144) ⏎ 	at android.os.Binder.execTransactInternal(Binder.java:1285) ⏎ 	at android.os.Binder.execTransact(Binder.java:1244)
- ok p1 form-prefilled: a no-clear fill keeps the prefill — Filled id:"lab.form-prefilled.name" (4 characters)
- ok p2 form-prefilled: a clear fill replaces the prefill — Filled id:"lab.form-prefilled.iban" (29 characters, cleared 29 characters first)
- ok p3 form-prefilled: a clear alone empties the field — Filled id:"lab.form-prefilled.email" (0 characters, cleared 23 characters first)
- ok p4 form-prefilled: a clear fill over a prefill with an NBSP — Filled id:"lab.form-prefilled.amount" (5 characters, cleared 8 characters first)
- ok p5 form-prefilled: a no-clear fill on the prefilled secure PIN keeps it — or averi says it did not — Filled id:"lab.form-prefilled.pin" (1 character)
- ok p6 form-prefilled: a clear fill on the prefilled secure PIN — Filled id:"lab.form-prefilled.pin" (4 characters, cleared 4 characters first)
- ok e1a form-errors: fixing a field drops its error, and its message (Android sets no error: asserted as text) goes from the tree — name: message gone; email: message still read
- ok c1 form-picker: scroll_until a row far down the lazy list, tap it: the value is written back — Element id:"lab.form-picker.country.ST" fully visible after 3 swipes
- ok tap:open.A open: tap A (open): fires it alone — Tapped id:"lab.open.A"
- ok tap:open.B open: tap B (open): fires it alone — Tapped id:"lab.open.B"
- ok tap:open.C open: tap C (open): fires it alone — Tapped id:"lab.open.C"
- ok tap:open.D open: tap D (open): fires it alone — Tapped id:"lab.open.D"
- ok tap:sheet-medium.A sheet-medium: tap A (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.sheet-medium.A" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a screen is presented over it (a modal or a sheet) — close it first; no scroll move
- ok scroll:sheet-medium.A sheet-medium: scroll_until A beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.sheet-medium.A" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,444) on other "Close sheet" (0,0 1080x1110) — a screen is presented over it (a modal or a sheet) — close it first; no 
    app: A 127,303 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:sheet-medium.B sheet-medium: tap B (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.sheet-medium.B" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a screen is presented over it (a modal or a sheet) — close it first; no scroll move
- ok scroll:sheet-medium.B sheet-medium: scroll_until B beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.sheet-medium.B" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,444) on other "Close sheet" (0,0 1080x1110) — a screen is presented over it (a modal or a sheet) — close it first; no 
    app: B 127,798 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:sheet-medium.C sheet-medium: tap C (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.sheet-medium.C" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a screen is presented over it (a modal or a sheet) — close it first; no scroll move
- ok scroll:sheet-medium.C sheet-medium: scroll_until C beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.sheet-medium.C" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,1776) on container (0,1243 1080x977) — a screen is presented over it (a modal or a sheet) — close it first; no scroll 
    app: C 127,1293 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:sheet-medium.D sheet-medium: tap D (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.sheet-medium.D" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a screen is presented over it (a modal or a sheet) — close it first; no scroll move
- ok scroll:sheet-medium.D sheet-medium: scroll_until D beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.sheet-medium.D" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,1776) on container (0,1243 1080x977) — a screen is presented over it (a modal or a sheet) — close it first; no scroll 
    app: D 127,1788 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:sheet-medium.S sheet-medium: tap S (open): fires it alone — Tapped id:"lab.sheet-medium.S"
- ok tap:alert-dim.A alert-dim: tap A (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.alert-dim.A" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first
- ok scroll:alert-dim.A alert-dim: scroll_until A beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.alert-dim.A" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,444) on the dim outside container (155,851 770x517) — a dialog is presented over it — close it first, and a swipe would l
    app: A 127,303 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:alert-dim.B alert-dim: tap B (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.alert-dim.B" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first
- ok scroll:alert-dim.B alert-dim: scroll_until B beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.alert-dim.B" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,444) on the dim outside container (155,851 770x517) — a dialog is presented over it — close it first, and a swipe would l
    app: B 127,798 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:alert-dim.C alert-dim: tap C (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.alert-dim.C" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first
- ok scroll:alert-dim.C alert-dim: scroll_until C beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.alert-dim.C" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,1776) on the dim outside container (155,851 770x517) — a dialog is presented over it — close it first, and a swipe would 
    app: C 127,1293 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:alert-dim.D alert-dim: tap D (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms: element id:"lab.alert-dim.D" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first
- ok scroll:alert-dim.D alert-dim: scroll_until D beneath the presented layer: refused, nothing stroked, nothing dismissed — refused, nothing moved or fired: ERROR scroll_until id:"lab.alert-dim.D" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,1776) on the dim outside container (155,851 770x517) — a dialog is presented over it — close it first, and a swipe would 
    app: D 127,1788 825x176 (whole); strokes none; fired nothing; touches none
- ok tap:scroll-bounded.W scroll-bounded: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded.W"
- ok tap:scroll-bounded.P scroll-bounded: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded.P"
- ok scroll:scroll-bounded.P scroll-bounded: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,886)
- MISMATCH (stop-claim) scroll:scroll-bounded.P.fully scroll-bounded: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,886)
- MISMATCH (tap-claim) tap:scroll-bounded.S scroll-bounded: tap S (sliver): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    tap → Tapped id:"lab.scroll-bounded.S"
- MISMATCH (stop-claim) scroll:scroll-bounded.S scroll-bounded: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- MISMATCH (stop-claim) scroll:scroll-bounded.S.fully scroll-bounded: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- ok tap:scroll-bounded.O scroll-bounded: tap O (outside-scroll-view): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.O" to appear
- MISMATCH (unchanged-claim) scroll:scroll-bounded.O scroll-bounded: scroll_until O (outside-scroll-view) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 848→1290, upper 1290→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.O" to appear
    app: O 128,1706 825x176 (outside-scroll-view); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→428, upper 428→848, upper 848→1290, upper 1290→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- ok tap:scroll-bounded.F scroll-bounded: tap F (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
- MISMATCH (unchanged-claim) scroll:scroll-bounded.F scroll-bounded: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 879→1307, upper 1307→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→440, upper 440→879, upper 879→1307, upper 1307→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- LOUD (not-reached) turn:scroll-bounded.F scroll-bounded: the wrong direction: lower at its top, F below: a stroke up moves nothing — turn back down — under uiautomator F is not in the tree, so no turn is asked there, only an honest reply — not reached (off-screen), and averi said so (not in the tree: its strokes unjudged — 2 swipes, none of them brought it closer (0 stroke(s) logged)): ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→0, upper 0→0; fired nothing; touches (540,424) (540,424)
- ok tap:scroll-sticky.R scroll-sticky: tap R (chrome-overlap:stickyHeader): fires it alone — Tapped id:"lab.scroll-sticky.R"
- ok scroll:scroll-sticky.R scroll-sticky: scroll_until R (chrome-overlap:stickyHeader) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky.R" visible after 0 swipes — PARTLY UNDER text "Sticky header" (400,347 281x66), drawn over it — 63% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too; then Tapped id:"lab.scroll-sticky.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,479)
- ok scroll:scroll-sticky.R.fully scroll-sticky: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky.R" fully visible after 1 swipe; then Tapped id:"lab.scroll-sticky.R"
    app: R 128,457 825x176 (whole); list clip 0,303 1080x1238 offset 0 (launched 66); strokes list 66→0; fired tap R; touches (540,551) (541,545)
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P" [known (intermittent), ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md]
    app: P 128,718 825x176 (whole); upper clip 0,303 1080x605 offset 80 (launched 0); strokes upper 0→80; fired tap P; touches (540,788) (541,806)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-bounded-flush.S" is cut at its scroll container's bottom edge (container 0,1046 1080x495); only a 825x22 part of it shows, 22 deep across that edge, under the 65 a tap needs — scroll_until it first (if it is whole and only its own content 
- ok scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1149 825x176 (whole); lower clip 0,1046 1080x495 offset 370 (launched 0); strokes lower 0→370; fired tap S; touches (540,1443) (541,1237)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match; then Tapped id:"lab.scroll-bounded-flush.S" [known (intermittent), ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md]
    app: S 128,1340 825x176 (whole); lower clip 0,1046 1080x495 offset 179 (launched 0); strokes lower 0→61, lower 61→118, lower 118→179; fired tap S; touches (540,1443) (540,1443) (540,1443) (541,1428)
- ok tap:scroll-sticky-cut.R scroll-sticky-cut: tap R (chrome-overlap:stickyHeader): fires it alone — Tapped id:"lab.scroll-sticky-cut.R"
- ok scroll:scroll-sticky-cut.R scroll-sticky-cut: scroll_until R (chrome-overlap:stickyHeader) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes; then Tapped id:"lab.scroll-sticky-cut.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,512)
- MISMATCH (stop-claim) scroll:scroll-sticky-cut.R.fully scroll-sticky-cut: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes — the app lays it out chrome-overlap:stickyHeader, not fully visible [known: bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md]
    scroll_until → Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-sticky-cut.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,512)
- ok tap:scroll-sticky-view.R scroll-sticky-view: tap R (chrome-overlap:stickyHeader): fires it alone — Tapped id:"lab.scroll-sticky-view.R"
- ok scroll:scroll-sticky-view.R scroll-sticky-view: scroll_until R (chrome-overlap:stickyHeader) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky-view.R" visible after 0 swipes — PARTLY UNDER text "Sticky header" (400,347 281x66), drawn over it — 63% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too; then Tapped id:"lab.scroll-sticky-view.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,479)
- ok scroll:scroll-sticky-view.R.fully scroll-sticky-view: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky-view.R" fully visible after 1 swipe; then Tapped id:"lab.scroll-sticky-view.R"
    app: R 128,457 825x176 (whole); list clip 0,303 1080x1238 offset 0 (launched 66); strokes list 66→0; fired tap R; touches (540,551) (541,545)
- ok tap:scroll-top-edge.A scroll-top-edge: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge.A" to appear
- ok scroll:scroll-top-edge.A scroll-top-edge: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.A"
    app: A 128,275 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap A; touches (540,444) (541,363)
- ok tap:scroll-top-edge.T scroll-top-edge: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge.T" is under the status bar at (541,61), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 128,0 825x121) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothi
- ok scroll:scroll-top-edge.T scroll-top-edge: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok scroll:scroll-top-edge.T.fully scroll-top-edge: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok turn:scroll-top-edge.T scroll-top-edge: turn back: T in the status band, more content below: a stroke down carries it off the top — turn back — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,672 825x176 (whole); page clip 0,0 1080x2220 offset 373 (launched 1100); strokes page 1100→373; fired tap T; touches (540,444) (541,760)
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge-end.A" to appear
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
    app: A 128,275 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap A; touches (540,444) (541,363)
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under the status bar at (541,61), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 128,0 825x121) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; n
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,684 825x176 (whole); page clip 0,0 1080x2220 offset 361 (launched 1100); strokes page 1100→361; fired tap T; touches (540,444) (541,772)
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,681 825x176 (whole); page clip 0,0 1080x2220 offset 364 (launched 1100); strokes page 1100→364; fired tap T; touches (540,444) (541,769)
- MISMATCH (tap-claim) tap:carousel-in-list.C carousel-in-list: tap C (outside-scroll-view): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.carousel-in-list.C" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    tap → Tapped id:"lab.carousel-in-list.C"
- MISMATCH (stop-claim) scroll:carousel-in-list.C carousel-in-list: scroll_until C (outside-scroll-view) right: stops on it as the app lays it out, every stroke on carousel bringing it closer, then the tap fires it — averi says Element id:"lab.carousel-in-list.C" fully visible after 0 swipes — the app lays it out outside-scroll-view, not visible; then the tap: averi says Tapped id:"lab.carousel-in-list.C" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.carousel-in-list.C" fully visible after 0 swipes
    tap → Tapped id:"lab.carousel-in-list.C"
    app: C 1014,380 948x234 (outside-scroll-view); carousel clip 66,380 948x234 offset 0 (launched 0); strokes none; fired nothing; touches (1047,497)
- ok tap:carousel-in-list.B carousel-in-list: tap B (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.carousel-in-list.B" to appear
- ok scroll:carousel-in-list.B carousel-in-list: scroll_until B (off-screen) down: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.carousel-in-list.B" fully visible after 1 swipe; then Tapped id:"lab.carousel-in-list.B"
    app: B 128,1876 825x176 (whole); page clip 0,0 1080x2220 offset 1864 (launched 825); strokes page 825→1864; fired tap B; touches (540,1899) (541,1964)
- ok tap:carousel-in-list.U carousel-in-list: tap U (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.carousel-in-list.U" to appear
- ok scroll:carousel-in-list.U carousel-in-list: scroll_until U (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.carousel-in-list.U" fully visible after 1 swipe; then Tapped id:"lab.carousel-in-list.U"
    app: U 128,275 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 825); strokes page 825→0; fired tap U; touches (540,935) (541,363)
- ok tap:scroll-collapsing.A scroll-collapsing: tap A (outside-scroll-view): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-collapsing.A" to appear
- ok scroll:scroll-collapsing.A scroll-collapsing: scroll_until A (outside-scroll-view) up: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-collapsing.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-collapsing.A"
    app: A 127,1095 825x176 (whole); list clip 0,611 1080x2000 offset 0 (launched 715); strokes list 715→0; fired tap A; touches (540,620) (540,1188)
- ok tap:scroll-collapsing.D scroll-collapsing: tap D (partly-centre-in): fires it alone — Tapped id:"lab.scroll-collapsing.D"
- ok scroll:scroll-collapsing.D scroll-collapsing: scroll_until D (partly-centre-in) up: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-collapsing.D" fully visible after 0 swipes; then Tapped id:"lab.scroll-collapsing.D"
    app: D 127,209 825x176 (partly-centre-in); list clip 0,220 1080x2000 offset 715 (launched 715); strokes none; fired tap D; touches (540,303)
- ok scroll:scroll-collapsing.D.fully scroll-collapsing: scroll_until D (partly-centre-in) up, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-collapsing.D" fully visible after 1 swipe; then Tapped id:"lab.scroll-collapsing.D"
    app: D 127,401 825x176 (whole); list clip 0,220 1080x2000 offset 523 (launched 715); strokes list 715→523; fired tap D; touches (540,620) (540,489)
- MISMATCH (R-direction) turn:scroll-collapsing.A scroll-collapsing: turn back: A scrolled above the list, its uiautomator bounds inverted: a stroke down carries it further — turn back up (#10) — R-direction: no turn back: stroke 1 (715→1984, away) and stroke 2 (1984→2488, away) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-collapsing.A" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its  [known: bug:2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-collapsing.A" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its scroll container, past the edge the swipes push it out through, never in the viewport, and is no longer in the tree (a lazy list drops what scrolls away) — scroll_until it with direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-collapsing.A" to appear
    app: A 127,-1784 825x176 (off-screen); list clip 0,220 1080x2000 offset 2488 (launched 715); strokes list 715→1984, list 1984→2488; fired nothing; touches (540,1820) (540,1820) (540,1820) (540,1820)
- ok tap:bands.S bands: tap S (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands.S" is under the status bar at (540,28), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 127,0 825x55) — it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar (a layout tha
- ok tap:bands.O bands: tap O (band-overlap:status): fires it alone — Tapped id:"lab.bands.O"
- ok tap:bands.W bands: tap W (whole): fires it alone — Tapped id:"lab.bands.W"
- ok tap:bands.Q bands: tap Q (band-overlap:nav): fires it alone — Tapped id:"lab.bands.Q"
- ok tap:bands.N bands: tap N (nav-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands.N" is under the navigation bar at (540,2171), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 127,2121 825x99) — it lies in no scroll view, so no scroll moves it out: it is pinned under the
- ok tap:bands-three-button.S bands-three-button: tap S (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands-three-button.S" is under the status bar at (540,28), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 127,0 825x55) — it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar 
- ok tap:bands-three-button.O bands-three-button: tap O (band-overlap:status): fires it alone — Tapped id:"lab.bands-three-button.O"
- ok tap:bands-three-button.W bands-three-button: tap W (whole): fires it alone — Tapped id:"lab.bands-three-button.W"
- ok tap:bands-three-button.Q bands-three-button: tap Q (band-overlap:nav): fires it alone — Tapped id:"lab.bands-three-button.Q"
- ok tap:bands-three-button.N bands-three-button: tap N (nav-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands-three-button.N" is under the navigation bar at (540,2171), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 127,2121 825x99) — it lies in no scroll view, so no scroll moves it out: it is pin
- ok tap:pinned-bar.W pinned-bar: tap W (whole): fires it alone — Tapped id:"lab.pinned-bar.W"
- ok tap:pinned-bar.P pinned-bar: tap P (chrome-overlap:pinned): fires it alone — Tapped id:"lab.pinned-bar.P"
- ok tap:tabbar-floating.T tabbar-floating: tap T (whole): fires it alone — Tapped id:"lab.tabbar-floating.T"
- ok tap:tabbar-floating.R tabbar-floating: tap R (under-chrome:tabBar): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.tabbar-floating.R" is under container id:lab.tabbar-floating.tabBar (66,1860 948x239) at its centre (540,1871), drawn over it; only a 948x61 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped
- ok scroll:tabbar-floating.R tabbar-floating: scroll_until R (under-chrome:tabBar) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.tabbar-floating.R" fully visible after 1 swipe; then Tapped id:"lab.tabbar-floating.R"
    app: R 66,1041 948x143 (whole); list clip 0,550 1080x1670 offset 758 (launched 0); strokes list 0→758; fired tap R; touches (540,1598) (540,1113)
- ok tap:tabbar-floating.F tabbar-floating: tap F (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.tabbar-floating.F" to appear
- MISMATCH (unchanged-claim) scroll:tabbar-floating.F tabbar-floating: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged list 1709→2550, list 2550→3307 in them: ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "u [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.tabbar-floating.F" to appear
    app: F 66,2743 948x143 (off-screen); list clip 0,550 1080x1670 offset 3307 (launched 0); strokes list 0→852, list 852→1709, list 1709→2550, list 2550→3307; fired nothing; touches (540,1598) (540,1598) (540,1598) (540,1598)
- ok tap:fab.W fab: tap W (whole): fires it alone — Tapped id:"lab.fab.W"
- LOUD (tap-refused) tap:fab.L fab: tap L (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: residual:accepted (round 13: the FAB host layer is a cover)]
    tap → ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
- LOUD (tap-refused) tap:fab.K fab: tap K (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: residual:accepted (round 13: the FAB host layer is a cover)]
    tap → ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
- ok tap:own-parts.L own-parts: tap L (open): fires it alone — Tapped text:"LOGIN"
- ok tap:own-parts.N own-parts: tap N (open): fires it alone — Tapped text:"Payee’s name"
- ok tap:own-parts.I own-parts: tap I (open): fires it alone — Tapped label:"Close"
- ok tap:text-sample.A text-sample: tap A (whole): fires it alone — Tapped text:"Prihlásiť sa"
- ok tap:text-sample.B text-sample: tap B (whole): fires it alone — Tapped text:"Ľubomír Šťastný"
- ok tap:text-sample.C text-sample: tap C (whole): fires it alone — Tapped text:"Mäkčeň, dĺžeň a vokáň"
- ok tap:text-sample.D text-sample: tap D (whole): fires it alone — Tapped text:"Jiří Dvořák: věřitel, půjčka"
- ok tap:text-sample.E text-sample: tap E (whole): fires it alone — Tapped text:"Payee’s name"
- ok tap:text-sample.F text-sample: tap F (whole): fires it alone — Tapped text:"Poznámka “pre mňa” a ‘OK’"
- ok tap:text-sample.G text-sample: tap G (whole): fires it alone — Tapped text:"Splatnosť 1–15 — mesačne…"
- ok tap:text-sample.H text-sample: tap H (whole): fires it alone — Tapped text:"1 234,56 €"
- ok tap:text-sample.I text-sample: tap I (whole): fires it alone — Tapped text:"−12 345,00 EUR"
- ok tap:text-sample.J text-sample: tap J (whole): fires it alone — Tapped text:"SK31 1200 0000 1987 4263 7541"
- ok tap:text-under-bar.S text-under-bar: tap S (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR text:"Zostatok 1 234,56 €" is under the status bar at (541,33), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 395,11 291x44) — it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar (a
- ok tap:text-under-bar.W text-under-bar: tap W (whole): fires it alone — Tapped text:"Šťastný účet"
- ok tap:text-under-bar.P text-under-bar: tap P (under-chrome:pinned): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element text:"Pokračovať na súhrn" to appear
- ok tap:text-nav-cut.T text-nav-cut: tap T (band-overlap:nav): fires it alone — Tapped text:"Zvuk a vibrácie"

Known but ok this run: uiautomator scroll:scroll-bounded-flush.P.fully, uiautomator scroll:scroll-bounded-flush.S.fully


## Appendix: the cases not ok at b71cbbb (rejudged from android-vis-b71cbbb.json, a --side run)

# Live golden: 133 cases, 108 ok, 5 loud, 20 mismatches (9 not known), 0 skipped

- MISMATCH k7 form-keyboard: scroll_until phone, under the bar riding on the IME: no stop while its centre lies under the bar or the IME, never a submit (the strokes counted) — averi says Element id:"lab.form-keyboard.phone" visible after 0 swipes — CLIPPED at bottom, 67% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. A rect assert or screenshot on this element will measure the — phone's centre lies under the bar; phone 1296–1395 (launched 1296), 99 px of it under the bar; 0 stroke(s) the app logged
    scroll_until → Element id:"lab.form-keyboard.phone" visible after 0 swipes — CLIPPED at bottom, 67% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. A rect assert or screenshot on this element will measure the CLIPPED box
- LOUD b1d form-basic: fill, no clear, a name with diacritics — the app holds "Jan ", not "Jan Šťastný" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShellCommand.onCommand(InputShellCommand.java:231) ⏎ 	at com.android.modules.utils.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:97) ⏎ 	at android.os.ShellCommand.exec(ShellCommand.java:38) ⏎ 	at com.android.server.input.InputManagerService.onShellCommand(InputManagerService.java:3807) ⏎ 	at android.os.Binder.shellCommand(Binder.java:1049) ⏎ 	at android.os.Binder.onTransact(Binder.java:877) ⏎ 	at android.hardware.input.IInputManager$Stub.onTransact(IInputManager.java:1144) ⏎ 	at android.os.Binder.execTransactInternal(Binder.java:1285) ⏎ 	at android.os.Binder.execTransact(Binder.java:1244)
- LOUD b7 form-basic: fill typographic text (’ “ ” – …) — the app holds "O", not "O’Brien “Jr.” – Co…" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShellCommand.onCommand(InputShellCommand.java:231) ⏎ 	at com.android.modules.utils.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:97) ⏎ 	at android.os.ShellCommand.exec(ShellCommand.java:38) ⏎ 	at com.android.server.input.InputManagerService.onShellCommand(InputManagerService.java:3807) ⏎ 	at android.os.Binder.shellCommand(Binder.java:1049) ⏎ 	at android.os.Binder.onTransact(Binder.java:877) ⏎ 	at android.hardware.input.IInputManager$Stub.onTransact(IInputManager.java:1144) ⏎ 	at android.os.Binder.execTransactInternal(Binder.java:1285) ⏎ 	at android.os.Binder.execTransact(Binder.java:1244)
- MISMATCH (presented-stop) scroll:sheet-medium.A sheet-medium: scroll_until A beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.sheet-medium.A" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.sheet-medium.A" fully visible after 1 swipe
    app: A 127,303 825x176 (whole); strokes none; fired dismissed sheet; touches (540,444)
- MISMATCH (presented-stop) scroll:sheet-medium.B sheet-medium: scroll_until B beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.sheet-medium.B" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.sheet-medium.B" fully visible after 1 swipe
    app: B 127,798 825x176 (whole); strokes none; fired dismissed sheet; touches (540,444)
- MISMATCH (presented-stroke) scroll:sheet-medium.C sheet-medium: scroll_until C beneath the presented layer: refused, nothing stroked, nothing dismissed — stroked the presented layer over a target in no scroll view: 3 touch(es) at (540,1776) (540,1776) (540,1776) — averi: ERROR scroll_until id:"lab.sheet-medium.C" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    scroll_until → ERROR scroll_until id:"lab.sheet-medium.C" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    app: C 127,1293 825x176 (whole); strokes none; fired nothing; touches (540,1776) (540,1776) (540,1776)
- MISMATCH (presented-stroke) scroll:sheet-medium.D sheet-medium: scroll_until D beneath the presented layer: refused, nothing stroked, nothing dismissed — stroked the presented layer over a target in no scroll view: 3 touch(es) at (540,1776) (540,1776) (540,1776) — averi: ERROR scroll_until id:"lab.sheet-medium.D" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    scroll_until → ERROR scroll_until id:"lab.sheet-medium.D" failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    app: D 127,1788 825x176 (whole); strokes none; fired nothing; touches (540,1776) (540,1776) (540,1776)
- MISMATCH (presented-stop) scroll:alert-dim.A alert-dim: scroll_until A beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.alert-dim.A" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.alert-dim.A" fully visible after 1 swipe
    app: A 127,303 825x176 (whole); strokes none; fired dismissed alert; touches (540,444)
- MISMATCH (presented-stop) scroll:alert-dim.B alert-dim: scroll_until B beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.alert-dim.B" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.alert-dim.B" fully visible after 1 swipe
    app: B 127,798 825x176 (whole); strokes none; fired dismissed alert; touches (540,444)
- MISMATCH (presented-stop) scroll:alert-dim.C alert-dim: scroll_until C beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.alert-dim.C" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.alert-dim.C" fully visible after 1 swipe
    app: C 127,1293 825x176 (whole); strokes none; fired dismissed alert; touches (540,1776)
- MISMATCH (presented-stop) scroll:alert-dim.D alert-dim: scroll_until D beneath the presented layer: refused, nothing stroked, nothing dismissed — averi says Element id:"lab.alert-dim.D" fully visible after 1 swipe — the target lies beneath the presented layer
    scroll_until → Element id:"lab.alert-dim.D" fully visible after 1 swipe
    app: D 127,1788 825x176 (whole); strokes none; fired dismissed alert; touches (540,1776)
- MISMATCH (stop-claim) scroll:scroll-bounded.P.fully scroll-bounded: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,886)
- MISMATCH (tap-claim) tap:scroll-bounded.S scroll-bounded: tap S (sliver): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    tap → Tapped id:"lab.scroll-bounded.S"
- MISMATCH (stop-claim) scroll:scroll-bounded.S scroll-bounded: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- MISMATCH (stop-claim) scroll:scroll-bounded.S.fully scroll-bounded: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- MISMATCH (unchanged-claim) scroll:scroll-bounded.O scroll-bounded: scroll_until O (outside-scroll-view) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 861→1286, upper 1286→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.O" to appear
    app: O 128,1706 825x176 (outside-scroll-view); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→427, upper 427→861, upper 861→1286, upper 1286→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- MISMATCH (unchanged-claim) scroll:scroll-bounded.F scroll-bounded: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 865→1295, upper 1295→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→439, upper 439→865, upper 865→1295, upper 1295→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- LOUD (not-reached) turn:scroll-bounded.F scroll-bounded: the wrong direction: lower at its top, F below: a stroke up moves nothing — turn back down — under uiautomator F is not in the tree, so no turn is asked there, only an honest reply — not reached (off-screen), and averi said so (not in the tree: its strokes unjudged — 2 swipes, none of them brought it closer (0 stroke(s) logged)): ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→0, upper 0→0; fired nothing; touches (540,424) (540,424)
- MISMATCH (stop-claim) scroll:scroll-sticky-cut.R.fully scroll-sticky-cut: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes — the app lays it out chrome-overlap:stickyHeader, not fully visible [known: bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md]
    scroll_until → Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-sticky-cut.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,512)
- MISMATCH (tap-claim) tap:carousel-in-list.C carousel-in-list: tap C (outside-scroll-view): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.carousel-in-list.C" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    tap → Tapped id:"lab.carousel-in-list.C"
- MISMATCH (stop-claim) scroll:carousel-in-list.C carousel-in-list: scroll_until C (outside-scroll-view) right: stops on it as the app lays it out, every stroke on carousel bringing it closer, then the tap fires it — averi says Element id:"lab.carousel-in-list.C" fully visible after 0 swipes — the app lays it out outside-scroll-view, not visible; then the tap: averi says Tapped id:"lab.carousel-in-list.C" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.carousel-in-list.C" fully visible after 0 swipes
    tap → Tapped id:"lab.carousel-in-list.C"
    app: C 1014,380 948x234 (outside-scroll-view); carousel clip 66,380 948x234 offset 0 (launched 0); strokes none; fired nothing; touches (1047,497)
- MISMATCH (R-direction) turn:scroll-collapsing.A scroll-collapsing: turn back: A scrolled above the list, its uiautomator bounds inverted: a stroke down carries it further — turn back up (#10) — R-direction: no turn back: stroke 1 (715→1984, away) and stroke 2 (1984→2488, away) neither brought it closer — averi: ERROR scroll_until id:"lab.scroll-collapsing.A" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its  [known: bug:2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-collapsing.A" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its scroll container, past the edge the swipes push it out through, never in the viewport, and is no longer in the tree (a lazy list drops what scrolls away) — scroll_until it with direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-collapsing.A" to appear
    app: A 127,-1784 825x176 (off-screen); list clip 0,220 1080x2000 offset 2488 (launched 715); strokes list 715→1984, list 1984→2488; fired nothing; touches (540,1820) (540,1820) (540,1820) (540,1820)
- MISMATCH (unchanged-claim) scroll:tabbar-floating.F tabbar-floating: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged list 1702→2559, list 2559→3405 in them: ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "u [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.tabbar-floating.F" to appear
    app: F 66,2645 948x143 (off-screen); list clip 0,550 1080x1670 offset 3405 (launched 0); strokes list 0→847, list 847→1702, list 1702→2559, list 2559→3405; fired nothing; touches (540,1598) (540,1598) (540,1598) (540,1598)
- LOUD (tap-refused) tap:fab.L fab: tap L (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: residual:accepted (round 13: the FAB host layer is a cover)]
    tap → ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
- LOUD (tap-refused) tap:fab.K fab: tap K (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: residual:accepted (round 13: the FAB host layer is a cover)]
    tap → ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
