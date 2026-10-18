# Plan: a ground-truth lab app and a golden mode for the harness

Answers `2026-10-15-proposal-find-bugs-in-batches.md` (P1 + P2, with P3/P5/P6 placed around them; the proposal lives
in the main checkout's docs/plans, not committed, so not on this branch). Written 2026-10-15
on `truth/phase-0-1`, branched from `arch/round-18` @ `dda435b`. Separate from the round-19 fix work: it touches no
file under `src/`.

## Goal

Test averi against screens whose truth is known — no login, no bank data, committable, runnable without the owner —
so that a visibility bug is found by a test, not by the next device round, and a fix is checked against the whole
neighbourhood of its bug at once.

## Shape

| piece | where | what |
|---|---|---|
| cell catalog | `fixtures/apps/cells/<family>.json`, generated into `fixtures/apps/cells.json` (phase 3 B1) | one entry per screen: `id`, the layer over the targets, the geometry, the targets (tag, colour, what the cell declares about it) |
| iOS lab app (SwiftUI) | `fixtures/apps/ios/` (xcodegen) | renders a cell chosen by launch argument (`-cell <id>`) or deep link (`averilab://cell/<id>`); writes its state file |
| Android lab app (Compose) | `fixtures/apps/android/` | the same catalog, phase 2 |
| capture | `scripts/truth/capture-run.ts` over a `LabDevice` (`lab-device.ts`: `IosLab` simctl/idb/WDA, `AndroidLab` adb); the arithmetic pure in `truth.ts`; command lines `capture.ts` (iOS) and `capture-android.ts` (uiautomator) | per cell: launch, wait for `ready`, save raw trees (WDA, idb / uiautomator), the screenshot, the app's state, then the tap probe |
| truth corpus | `tests/fixtures/truth/<platform>/` | a differential corpus run (manifest + payloads) plus `screenshot` and `truth` per capture — committed |
| golden mode | `scripts/differential/golden.ts` | replays the truth corpus through ONE side, serves the captured screenshot, compares each verb's answer with what the truth implies |
| expected replies | `scripts/differential/golden-spec.ts` (over `golden-spec/<family>.ts`, phase 3 B1) | the table: truth → expected outcome class per verb |

Not in the npm package (`package.json` `files` lists only `dist`, `skill`, docs).

## Truth: three sources, each answering one question

| source | from | answers |
|---|---|---|
| declared | the catalog | what kind of situation the cell builds (open, beneath a presented layer, outside its scroll view, …) — names the expected remedy |
| reached | the tap probe: the capture script taps each target's centre with a raw `idb ui tap` / `adb input tap`, reads the app's tap log, relaunches; the app logs every touch its windows receive, the positive control that the tap reached it at all | whether a tap at its centre reaches the target |
| drawn | the screenshot: the fraction of the target's frame (as the app reports it, `.frame(in: .global)`) painted the target's own colour | how much of it the user sees as itself |

The app reports its own frames, so the truth does not depend on what WDA, idb or uiautomator list — a disagreement
between the app's frame and the tree's rect is itself a finding. A cell whose three sources disagree with each other
(declared open, but not reached) is a broken cell, reported as such, not a verdict on averi.

The tap probe is empirical rather than a `hitTest` replica: SwiftUI's hit testing is not UIView hit testing, and what
matters for `Tapped` is whether the action fired.

## Golden mode

- Same corpus format, two optional fields per capture: `screenshot` (PNG beside the payload) and `truth` (JSON).
- One side (NEW). The fake device answers the screenshot with the captured PNG (iOS: at the device's scale; the
  frame is what the device returned).
- Per target, the verbs the spec covers. Outcomes are compared as classes, not wording — wording stays the
  differential's job:

| truth | tap | colour assert | scroll_until (down) |
|---|---|---|---|
| reached, drawn ≥ 95 % | `Tapped` (phase 3 round 3: at its probe point, golden-spec/base.ts#atProbe) | pass with its own colour | reached, 0 swipes |
| not reached, declared `presented-over` | refused, `close it first`, nothing tapped | fail (asked with the colour the screenshot shows there, so a pass means it measured the cover) | stopped before any swipe, `close it first` |

  New rows are added with the cells that need them (outside its scroll view → scroll advice; partly drawn with centre
  out → `fully: true first`; …). The table lives in code (`golden-spec.ts`), each row citing the ADR that decides it;
  an ADR records only the principle (the truth outranks a hand-written expectation).
- Report: per cell × target × verb `ok` / `MISMATCH` (expected class, actual reply) / `broken cell`.
- Runs in vitest over the committed truth corpus (no device), like `tests/differential/`.

## Phases

### Phase 0 — decisions and schemas (this branch)

- Answers to the proposal's questions: Q2 in this repo (`fixtures/apps/`); Q3 in code, principle in an ADR
  (docs/adr/0020-the-truth-outranks-a-hand-written-expectation.md); Q1 (P3's
  inversion) after golden exists, measured against truth rather than as a count of `Tapped → refused`.
- `fixtures/apps/cells.json` schema, the app's state file schema, the truth file schema (`scripts/truth/schema.ts`).
- The golden spec's first rows.

### Phase 1 — iOS walking skeleton (this branch)

- SwiftUI lab app, three cells:
  - `open` — four coloured targets (A–D), no layer;
  - `sheet-medium` — a form of coloured targets, a sheet at the medium detent presented on appear (targets under the
    dim above it and under the sheet; a target inside the sheet);
  - `alert-dim` — the form beneath a SwiftUI alert (the round-18 note
    `2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md`).
- Capture on a dedicated simulator (`averi-lab iPhone 17`, iOS 27.0, 402×874) and a WDA port of its own, never the
  device-check simulator.
- Golden mode + vitest over the committed captures.
- **Acceptance:** golden reports the round-18 bug on `alert-dim` at `dda435b` (tap `Tapped`, colour pass on the dim,
  `scroll_until` fully visible), and the cell is green once round 19's alert fix (`fix/r19-alert`) lands. `open` is
  green at `dda435b`. Measured: red at `dda435b` as stated, green at `fix/r19-alert` `e10219e` (commit 9604314's message
  says `5ac759f`; that SHA is wrong — the green tip was `e10219e`). On this branch: green from the merge of
  `arch/round-20` (round 19's alert fix and round 20's presented layer) at `8600176` — golden 237 checks, 69 → 60
  mismatches, the 9 WDA `alert-dim` rows struck off KNOWN, no other row's verdict changed. With phases 1b and 2: 237
  checks, 64 mismatches, all KNOWN and each pinned by its class, its reply's kind (62 not found, 1 Tapped, 1 visible)
  and the taps and swipes it sent (a "not in the tree" reply is classed by its effect where its row rejects it): 19
  tap refused without "close it first", 4 tap refused without naming the keyboard, 1 Tapped, 16 swiped 2× beneath a
  presented layer, 3 swiped 2× beneath the sheet, 1 reached with no swipe where a tap fires submit, and 20 vacuous
  "not in the tree" (16 colour, 4 keyboard `scroll_until`).

### Phase 1b — forms and validation (iOS)

averi's daily use is verifying a banking app: forms, validation, the keyboard. The visibility cells alone do not test
that, so forms are a cell family of their own, with an oracle of their own — the app reports, per field:

- its **value** as the model holds it (not as the tree reports it), whether it is **focused**, and its **validation
  error** (text and the identifier convention it uses);
- the **keyboard's frame** (`keyboardWillChangeFrame`) and which field it serves;
- every **submit** and whether the form passed validation.

| cell | builds | verbs it checks |
|---|---|---|
| `form-basic` | text, email, IBAN, amount (number pad), secure PIN; a submit at the bottom | `fill` (with and without `clear`), `type_text`, the value read back, a secure field's masked value |
| `form-errors` | the same fields after a dirty submit: an error under each, by both conventions (same identifier below the field; `<id>_error`) and one by neither | `assert … error:`, field-error pairing, a screen-level error that pairs with no field |
| `form-keyboard` | a long form; the focused field near the bottom; the submit pinned over the keyboard (a toolbar / safe-area inset) | taps under the keyboard refused, `scroll_until` above the keyboard, dismissal (`keyboardDismiss`), the submit reachable |
| `form-prefilled` | fields pre-filled, as a dev flavour does | a `fill` without `clear` that must not destroy content; a `clear` that must |
| `form-picker` | a country field opening a sheet with a long list (the SWIFT form's country sheet) | `scroll_until` in a sheet, a row tap, the value back in the field |

Text cells for P5's sample (typographic quotes, NBSP, diacritics) are fields and labels here too, so `fill` and the
tree's text are judged on the same strings. `ocr` on them moved to phase 4, with OCR against real pixels. The golden
spec gains rows per verb: the field's value after `fill` equals what was asked, an error the app shows is the one
`assert … error:` reads, and so on.

A replayed tree is static: typing changes nothing in it, so `fill` / `type_text` / `clear` cannot be judged by replay.
The form cells therefore bring the **live** golden mode forward (phase 5's): averi runs on the lab simulator, and the
app's own report of the field's value is the oracle. The static parts (error pairing, the keyboard cover, the submit
over the keyboard) are captured and replayed like the visibility cells.

### Phase 2 — Android (Compose, the same cells, uiautomator)

The tap log is a `Modifier.clickable` per target; state file read with `adb exec-out run-as`. Emulator use only with
the owner's go (device-check rules: no adb server commands without it).

### Phase 2b — Android forms (Compose)

Phase 1b's form cells (`form-basic`, `form-errors`, `form-keyboard`, `form-prefilled`, `form-picker`) in the Compose
app: the same catalog entries, the same oracle in the state file (field values, focus, shown errors, the IME's
frame from `WindowInsets.ime`, submits), captured through uiautomator, the static golden rows, and the live golden
(`live.ts` against the `averi_lab` emulator: `fill` / `type_text` / `clear`, Android's one-character-per-`input
text` typing). Android sets no `error` on a field (docs/verification.md): its error rows assert the message's text.
Owner request 2026-10-15.
The pinned submit's bar was measured from iOS's padding in points (the former truth.ts#PINNED_BAR_PADDING, in
`situationOf`); since phase 2b the app reports its bar's frame (`frames["submit.bar"]`) and `situationOf` reads it on
both platforms, the constant dropped.
Done 2026-10-16 (`truth/r3-forms-android`): the six form cells (form-shared-id too) on `averi_lab`, golden 707 → 776
checks (69 Android form rows, 7 mismatches, KNOWN: lab note F2A1 and L1's class on form-picker), the IME's readings
captured and served (CellTruth.ime), `submit.bar` reported by both apps (the iOS app built with it, xcodebuild for a
generic iOS Simulator; the committed iOS form truths, captured before it, held no bar — the phase-3 round-3 review
recaptured the nine iOS form cells, the forms family and toolbar-dismiss*, with the current app on the averi-lab
iPhone 17: form-keyboard's state holds `submit.bar` 0,506.7 402x66.3, every control's situation, reach and probe as
before, the controls under the keyboard gaining their `seen` and phone its probe at its piece, not reached; golden's
rows all as before, plus 32 colour rows — 16 green under WDA, 16 idb `not in the tree`, KNOWN), the live
golden on Android 18 ok / 2 LOUD of 20 (docs/truth/live-android-2026-10-16.md; lab note F2A2: non-ASCII typing; k5, a
tap on a field the bar drops over once `back` hid the IME, no submit — replayed too, over the layout after back the
capture keeps beside the truth: CellTruth.afterBack).

### Phase 3 — calibration on the bug notes

Every visibility note (36 of 72) gets a cell. Golden must fail on the commit before its fix and pass after. A note
that does not fail shows a hole in the truth or the spec table.

Done for the existing cells: `scripts/truth/calibration.json` lists every bug note — calibrated on golden rows with the
note's own symptom as its `defect`, or why no cell reproduces it yet (`needs-cell:…`, `needs-2b`, `needs-live`,
`needs-ocr`, a residual), or excluded with its class — and `scripts/truth/calibrate.ts` replays the whole corpus over
each note's before and after commit (a canary refuses a side that does not really load; rows regressed elsewhere at a
fix are reported) into `docs/truth/calibration.md`. The `needs` of each note not yet reproduced are the cells phase 4
builds (scripts/differential/README.md, Calibration on the bug notes).

Two notes calibrated on the existing cells are holes, each DOES-NOT-FAIL as its `expect` says, with its `needs`: #28 (a
WDA sheet's bare background is no cover) needs a `presented` sheet-background cell — a page sheet whose bare background,
no node of its own content, lies over a target beneath (form-picker's sheet puts its rows over every target); FE2 (field
errors pair a shared component id with the next field's title) needs a `forms` variant whose fields and titles share one
identifier (form-errors gives every title its own). The first B0 run called #28 CALIBRATED (32d002f's message says so,
and history keeps it); review round 1 corrected it to DOES-NOT-FAIL: at its before commit, 53da035, its rows are
already refused, red only on #33's defect.

**B1 — the families and the plumbing (no cell, no capture), committed on truth/phase-3 itself: the base B2–B5 branched
from and were merged into.** So that phase 3's batches (B2 edges, B3 presented, B4 bars, B5 false covers) are written in
parallel worktrees without touching each other's files, every shared file is split by cell family — `base` (`open`),
`presented` (`sheet-medium`, `alert-dim`), `forms` (the five form cells), `edges`, `bars`, `false-covers`
(scripts/truth/schema.ts#FAMILIES):

| piece | per family | shared, B1's |
|---|---|---|
| catalog | `fixtures/apps/cells/<family>.json` | `fixtures/apps/cells.json`, GENERATED by `scripts/truth/catalog.ts` (each cell stamped with its `family`; tests/truth/catalog.test.ts fails while it is stale) — both apps bundle it |
| iOS app | `AveriLab/<Family>.swift` (Base, Presented, Forms, Edges, Bars, FalseCovers) | `AveriLabApp.swift#CellRouter` (every family named once), `Lab.swift` (the state) |
| Android app | `dev/averi/lab/<Family>.kt` | `MainActivity.kt#CellRouter`, `Lab.kt` |
| golden rows | `scripts/differential/golden-spec/<family>.ts` (which rows a truth asks) | `golden-spec/judges.ts` (the judges), `golden-spec/rows.ts` (phase 3's row types: R-off, R-outside-sv, R-sliver, R-stroke, R-land, R-fully, R-band, R-under-chrome, R-overlap, R-dismiss, R-direction — live only), `golden-spec.ts` (the façade) |
| ratchet | `tests/differential/golden/<family>.known.ts` (KNOWN and COUNTS of its own cells; a row may be filed `as: bug:<note>` or `residual:<decision>`) | `golden/known.ts`, `golden.test.ts` (aggregates; refuses a row filed under another family) |
| capture | `capture.ts --family <f>` / `capture-android.ts --family <f>` (with or without `--cells`) | `capture-run.ts`, `truth.ts` |

The truth gains a MEASURED geometry beside `declared` (truth.ts#geometryOf — off-screen, outside-scroll-view,
status-band, nav-band, sliver, partly-centre-in, centre-out, under-chrome:<name>, band-overlap:<band>,
chrome-overlap:<name>, whole), measured from the app's frames and the state's new optional `safeArea`, `scrollViews` and
`chrome`, with each target's `visible` and `piece` and a second probe at the piece (`reachedAtPiece`);
`CatalogTarget.text`, `CatalogCell.config` (golden's configFor), the `tab` event. All optional: no app writes them yet,
so every committed capture loads and judges as before, and the new rows ask only a target that carries a geometry other
than `whole`.

What B1 leaves where, so no batch looks for it here: R-presented (a target beneath a presented layer) is no row type in
rows.ts — the phase-1 presented-over rows in `golden-spec/presented.ts` cover it, and B3 extends them; the Android IME's
frame from `dumpsys` (calibration.json #1, `needs-2b`) is captured in phase 2b (B6), not in B1–B5. Until B2–B5's
captures carry a geometry, the new rows are exercised only by tests/differential/golden-wiring.test.ts (golden over a
committed capture under a synthetic truth whose targets carry one; golden-rows.test.ts pins their judges alone). The
apps' B1 changes were compiled outside the sandbox at 690ef8f: Android `assembleDebug` with JDK 17, iOS `xcodebuild`
for a generic iOS Simulator.

How to add a cell (B2–B5):

1. **Catalog** — its entry in `fixtures/apps/cells/<family>.json` (targets with `scrollView`, `text`; `config` for a
   variant), then `node --import tsx scripts/truth/catalog.ts` to regenerate `cells.json`.
2. **App view** — in the family's Swift and Kotlin file (replacing its `UnbuiltCell`), reporting each target's frame and
   what its geometry needs: `safeArea`, the scroll views' clips, the chrome's frames (the apps' `Lab` gains the writers
   with the first cell that needs them; a recapture of the existing cells then adds those keys to their state and
   `geometry: whole` to their targets, which asks no new row).
3. **Capture** — `capture.ts --udid <lab> --out tests/fixtures/truth/<run> --family <family>` (and the Android one).
4. **Spec rows** — a target's rows are chosen by its MEASURED geometry (truth.ts#geometryOf), not by its family:
   `golden-spec/edges.ts` and `golden-spec/bars.ts` are geometry groups, asked of a target of any family whose capture
   measured an edge, band or chrome geometry, so a B2 or B4 cell needs no spec change for a geometry they already map. A
   family file maps what a geometry does not decide (presented.ts: the presented-over rows; forms.ts: the form rows); a
   new row type goes into rows.ts with the ADR or note deciding it, and a judge table test. A row keyed on the cell, not
   on a target's geometry, is wired through the façade: false-covers' R-dismiss (rows.ts#dismissRow, under the form
   cell's `config.ios.keyboardDismiss`) through `golden-spec.ts#formExpectations` (WDA only), its text targets through
   `golden-spec.ts#expectations`; both take the capture's source, required. So a B5 author edited
   `golden-spec/false-covers.ts` (its rows), the façade (to ask them), rows.ts only for a new row type, and steps 1–3
   and 5's files.
5. **KNOWN** — `tests/differential/golden/<family>.known.ts`: the captures' COUNTS, and each mismatch the checkout has
   with its class, reply kind, calls, note and `as: bug:<note>` or `residual:<decision>`; then the note's rows in
   `scripts/truth/calibration.json` and a calibrate run.

**B2 — edges (2026-10-16), merged into truth/phase-3 (fe65922).** Three cells in both apps (Edges.swift, Edges.kt; the
apps' `Lab` gained the `chrome` writer, and Android's the `safeArea` and `scrollViews` ones — iOS's are B3's, one of
each): `scroll-bounded` (two bounded scroll views — a whole row, a row cut with its centre showing, a sliver, a row
below its scroll view but on the screen, a row laid out below the screen), `scroll-sticky` (a lazy list whose pinned
section header overlaps its first row, the header reported as chrome) and `scroll-top-edge` (a row resting in the status
band — on iOS under the bar's own touch area, its probe swallowed: truth.ts#statusBarMaySwallow, measured by B3 and
B4 below — and a row above the screen). Calibrated: #4 and #29; #9 and #17's static half DOES-NOT-FAIL; #12 and #13
STILL-RED-AFTER, partial (the lab's Compose does not cut uiautomator's bounds flush with the container, the shape their
fixes judge); #10 not reproduced (no inverted bounds); lab findings LE1–LE4. What changed in the shared rows:
`fully: true` is a verb of its own (`fully`, judges.ts#Verb), so a target asked both stops keys two rows; the
R-outside-sv colour asks for the colour the screen shows there (a pass measured the background); an edge row accepts a
target missing from the tree only where its capture's tree of that source did not list it (TargetTruth.listed,
scripts/truth/target-contract.ts#unlistedBy); R-stroke holds every touch-down inside the target's own scroll view where the truth names it;
R-band's tap is not expected refused where the probe fired the target.

**B3 — presented (2026-10-16, iOS only: every note it calibrates is iOS's; the Android app builds none of its layers),
merged into truth/phase-3 (c86aa9e).** Six cells (fixtures/apps/cells/presented.json): `sheet-medium-edges` (the medium
sheet over a scrolled host; targets wholly above, wholly under the status bar, a 5-pt sliver, wholly below, and one
whole under the dim, the positive control), `sheet-background` (a large sheet's bare background over the targets — #28's
cell; CALIBRATED, no longer DOES-NOT-FAIL), `sheet-long-list` (a UIKit table in a large sheet, WDA parking the label of
a row below the fold at the sheet's origin, #20), `dim-cover` (an RN-style transparent cover, #27), `blur-menu` and
`blur-menu-grouped` (a menu over a blurred backdrop no tree lists, #31's residual; its rows listed in reading order, or
before the screen beneath, #15). #27 and #28 calibrate at 41c394a (fix/r20-marks), not at their notes' 15896c5, which
fixed the device trees only; the same 41c394a re-breaks #30, #32 and #34's shape (lab note L3). A presented-over target
is asked the presented rows whatever its measured geometry, never R-off / R-sliver (golden-spec/presented.ts). Measured
on the way: iOS's status bar swallows a raw tap in the top of its band (truth.ts#statusBarMaySwallow).

**B4 — bars (2026-10-16), merged into truth/phase-3 (73ff1f9): the band probes, measured.** B1 left what a raw tap in
Android's navigation band does unmeasured (gesture navigation or three buttons, ADR 0009's context) and never probed a
centre there; it assumed iOS's status band passes every tap to the app. B4 measured both on the `bands` cell (S centred
in the status band, N in the navigation band, O and Q 4 dp/pt into them) with the lab app's touch log as the witness —
per tap: `am force-stop` and `am start … --es cell bands` (iOS: `simctl terminate`, `simctl launch … -cell bands`), the
state file's event count, the raw tap, 1 s, the events since:

| device, mode | the band | raw taps (x,y) | the app logged |
|---|---|---|---|
| averi_lab AVD, API 33, gesture (`settings get secure navigation_mode` 2; `dumpsys window displays`: `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220]`) | navigation | (540,2187), (540,2215) on N; (100,2187) beside it | the touch each time, and `tap N` for the two on N |
| the same, three buttons (`cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton`, mode 0, `[0,2088][1080,2220]`) | navigation | (540,2154), (100,2154), (270,2154) | nothing; the launcher took the focus (Home, Back) |
| the same, either mode | status (`[0,0][1080,66]`) | (540,33) on S | nothing |
| averi-lab iPhone 17 simulator, iOS 27.0 | status (0–62 pt) | (201,10), (201,31), (60,31), (340,31), (120,50), (201,52), (201,53) | nothing — the status bar's window takes them |
| the same | status | (201,54), (60,54), (201,55), (201,58), (201,61) | the touch, and `tap O` beneath |
| the same | home indicator (840–874 pt) | (201,857), (60,857) on N | the touch, and `tap N` |

The raw touch logs are docs/truth/band-probes-2026-10-16.md. The AVD was set back to gesture navigation
(`…navbar.gestural`; mode 2, the band at 2154 again) before its captures. So the capture probes a centre in any band
(truth.ts#unprobedReason no longer names the navigation band) and, on Android, records the navigation mode
(`CellTruth.navigation`, AndroidLab.navigation: `settings get secure navigation_mode`); consistency holds the probe to
what was measured: Android's status band swallows (systemBarSwallows, #21); the navigation band
(truth.ts#navigationBandTakes) is the app's on iOS and under gesture navigation — the touch logged, the target reached
(on iOS drawn too) — and the bar's under three buttons — not reached; with no mode recorded (or two buttons, not
measured) a nav-band target is broken. No capture existed under three-button navigation then (a follow-up): round 3
captured `bands-three-button` under it (truth/r3-variants, below). B1's iOS
assumption did not hold: iOS's status bar swallows a tap in the top of its band — B3 measured it the same day on `open`
(no touch at y 2–50, a touch from 55) and wrote the rule, truth.ts#statusBarMaySwallow, accepted above its line
`IOS_STATUS_BAR_SWALLOWS_ABOVE`; B4's taps above agree and narrow the line (no touch up to 53, a touch from 54), so the
constant is 54 pt, borne out by both measurements (a probe from y 54 on with no touch is undelivered). averi refuses
a tap in a band (ADR 0009 N-a, ADR 0008): R-band — on iOS the status band's only (golden-spec/bars.ts). R-band's colour
row follows the mode recorded (rows.ts#bandColour): under gesture navigation, where bands' N is reached, 90 % drawn and
seen in its own colour beneath the handle, a PASS on its own colour or a fail-closed FAIL (ADR 0020: the measured truth
outranks a hand-written expectation); under three buttons a FAIL — the row calibration.json #23 needs a three-button
capture for.

**B5 — false covers (2026-10-16), merged into truth/phase-3 (d4281cc).** `own-parts` (both platforms: a button's own
text, a text field over its own label), `toolbar-dismiss` (SwiftUI's own full-screen `Toolbar` host from a principal
title) and `toolbar-dismiss-bar` (plus an itemless bar-sized UIToolbar over the title), iOS form cells with
`config.ios.keyboardDismiss`, R-dismiss asked under WDA only; `form-shared-id` in `forms` (FE2). #7 (first fix), #8, #18
(wider, still partial: no lab text field lists a scroll indicator), #19 and FE2 (its assert half; `ui_snapshot`'s error
column has no golden verb yet) calibrated (docs/truth/calibration.md). On Android `own-parts`' N is a green control row,
no reproduction: uiautomator lists the label AFTER the field (EditText [177,1316][902,1448], TextView
[177,1351][443,1412]), so neither #8's shape nor #18's.

**Round 3 — the open tap at its probe point (2026-10-16, truth/r3-open-tap).** base.ts's open tap asks where the tap
lands: every tap within OPEN_TAP_REACH (a sixth of the extent, chosen between the measured 0.081 of own-parts' N and
0.313 of #26's C) of the probe's logged touch, and no "tapped the uncovered part" reply on a target measured uncovered.
#26 calibrated on its tap. Follow-up: hold every open tap to the centre of the target's node in the recorded tree
(exact, up to the tools' rounding) — it closes the reach's blind spot (a cover averi imagines over under a third of
the target moves the tap under a sixth, and passes unless the reply says it moved). Done in round 4
(truth/r4-followups): the open tap is held to the centre of the target's node in the replayed tree, ±1
(base.ts#NODE_CENTRE_SLACK; truth.ts#nodeFramesIn, the harness's own reading of WDA's `rect`, idb's `frame`,
uiautomator's `bounds`), the reach kept as the fallback where the tree lists no node for it whose centre the probe's touch agrees with (within
the reach; several such frames: one of their centres) (66 of the 68 open taps have one node; idb's sheet-long-list and
sheet-long-list-short R none). No row flips (879 checks, 257 mismatches,
0 broken, each row's verdict as before); #26 still CALIBRATED; own-parts' N is now held to its text node's centre.

**Round 3 — cell variants for partial notes (2026-10-16, truth/r3-variants).** A cell may name the platforms that build
it (`CatalogCell.platforms`) and, on Android, the navigation mode it is captured under (`CatalogCell.navigation`);
capture-run skips it elsewhere (catalog.ts#captureRefusal), so `bands` (gesture) and `bands-three-button` sit in one
run. Android: `scroll-bounded-flush` (rows whose identified container is not clickable — uiautomator cuts it flush with
its scroll container: #12, #13 CALIBRATED, R-fully accepting a probed flush stop, replies.ts#flushProbedSide),
`scroll-sticky-cut` (the header one accessibility element: Compose cuts the row AND its content at it — #9
STILL-RED-AFTER, lab finding VA1), `bands-three-button` (#23 still DOES-NOT-FAIL: the assert at 94bae14 does not pass on
the bar). iOS: `sheet-long-list-short` (a row on the screen outside its table: #29's fix cures it, not #20's) and
`toolbar-dismiss-short` (a scroll view shorter than the screen over the title: #7's second fix, the pair 5cff2ad →
c3ebc62). R-fully's flush acceptance is checked against the truth (the named edge flush with the target's scroll view,
a swipe from inside it toward that edge); whether the probe reveals the row is live (phase 5). A decision taken at the
round-3 merge (501ec21), for fidelity: each Android capture keeps the device's own `dumpsys window displays`
(CellTruth.displays), which golden's fake device serves in place of its stock gesture-mode dump — `bands-three-button`
was recaptured with it, so it is replayed against its three-button bar, not the gesture band (#23's verdict
unchanged); since the round-3 review it is the one source of that IME-down dump, an IME-up capture's ImeCapture
holding only what is extra. Round 4 (truth/r4-followups) adds `scroll-sticky-view` (Android): scroll-sticky-cut with
R's content an Android View (AndroidView) — the container cut at the header, the View listed whole, #9's own shape:
#9 CALIBRATED on it (10fb02b → d2b7744); VA1 stays the all-Compose row's. And `form-keyboard-floating` (Android, `ime:
floating`): form-keyboard with Gboard switched to Floating by hand on averi_lab (the grid → the Floating tile; no adb
command or setting switches Gboard's mode — tried nothing else; docked again after): the strip `[0,2088][1080,2220]` the
inset, the panel `(71,1092,1008,1884)` the touchable region's second rect, four fields' centres under it
(truth.ts#imePanels; situationOf holds them under-keyboard; readControlProbe no longer reads a focus left in place by a
tap the panel took as a reach) — #1 CALIBRATED on them (7d9a783 → cb77485: Tapped with no back, a colour PASS on the
panel, `fully visible after 0 swipes` before; back then a tap, failing closed, strokes clear of the panel after), its
regression elsewhere at cb77485 the pinned submit between panel and strip, lab finding FU1. Follow-up:
calibrate takes one before/after pair per note, so #7's two fixes share 5cff2ad → c3ebc62 — several pairs per note
would verify each fix alone. Done in round 4 (truth/r4-followups): a note may name `pairs`, one before/after per further fix, each
judged alone (`<n>.1`, `<n>.2` …) — #7 CALIBRATED on both (5cff2ad → 7542021 on toolbar-dismiss, d928789 → c3ebc62 on
toolbar-dismiss-short, each its own `covered by` symptom), #1's 9131730 CALIBRATED on the docked IME's scroll_until rows
(the cb77485 pair, #1.1, CALIBRATED on form-keyboard-floating: below), #19's first fix cd4d177 STILL-RED-AFTER (as the note says); #5's
1bc603a, 565b747 (a stale IME reading: live) and #8's c8c06a8 (no icon-button cell) unpaired, in their `needs`.

### Phase 4 — the matrix, generated

One template `Host(layer, geometry)` per platform; cells generated from `cells.json` (layer × geometry). Text cells for
P5's sample. OCR judged against real pixels (the macOS recognizer on the captured screenshot; skipped where it is
unavailable), phase 1b's text samples included. The covering layer per target (the proposal's P1, "the covering layer,
if any") is recorded in the truth file here; until then the cell's `layer`, the declared kind and the probe's events
(`dismissed`, another target's `tap`) stand for it (ADR 0020, residuals). The RN modal cases only if the existing RN
trees do not cover them.

Text and OCR done 2026-10-16 (`truth/r4-ocr`, round 4): the `text` family (fixtures/apps/cells/text.json; AveriLab/
Text.swift, Text.kt) — `text-sample` (P5's sample: Slovak and Czech diacritics, ’ “ ” ‘ – — …, amounts with NBSP and
narrow-NBSP thousands separators and U+2212, an IBAN), `text-under-bar` (a string in the status band, one open, one
under a pinned Continue), `text-nav-cut` (Android, a string drawn across the gesture band's top) — captured on both
platforms. golden-spec/text.ts asks any text target, by its string, the tree's `text` and the `ocr` assert; the
under-keyboard form row gains its OCR half. OCR is judged by the host's own recognizer on the captured screenshot
(golden.ts#ocrAvailability, fake-device.ts#useRecognizer): each side compiles and runs its own; where Vision cannot
read (not macOS, or inside a sandbox: `nilError`) the `ocr` rows are skipped and said so, counted, never red, and
calibrate reads them NOT-ASKED. Golden with the recognizer on r4-ocr itself 879 → 1087 checks, 257 → 285 mismatches;
merged with r4-followups and r4-live (a15d43d) 1131 checks, 286 mismatches, 0 broken (inside the sandbox, no
recognizer: 1131 checks, 260 mismatches, 0 broken, 86 `ocr` rows skipped). Lab
notes OC1 (both platforms: Ľ read L', ĺ read í — no fold reaches them) and OC2 (iOS: an NBSP thousands separator read
as nothing). Calibrated: #3's and #22's OCR halves, #23's band on a text across it (T colour; its cut-glyph OCR half
still needs a node the tree cuts at the band — Compose dumps none: calibration.json), and the typographic-apostrophe
note (TX1, 35321b4) on own-parts' N and text-sample's E and A. Typing the sample (F2A2, Android `type_text` non-ASCII;
`2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md`) stays the live golden's: a replayed tree shows no typing —
text-sample's strings are its inputs, not static rows. #36 (OCR in a presented sheet under WDA) needs a text target on
a sheet's layer. Deferred to the next round (review round 4, P7): "phase 1b's text samples included" is not done — the
form cells' titles and labels get no open `ocr` row; a form is asked OCR only for a control under the keyboard
(golden-spec/forms.ts, fails closed).

### Phase 5 — live golden

averi's verbs run on the simulator against the lab app, the app's tap log and scroll offset as the oracle: covers
what a static tree cannot (`scroll_until` dynamics, strokes, the keyboard).

Round 4 (2026-10-16, truth/r4-live): both apps report each scroll view's offset and strokes (LabState.offsets,
.strokes); `scripts/truth/live.ts --groups visibility,dismissal` builds its cases from the static truth
(live-visibility.ts: a tap per target judged by the tap log, a scroll_until toward every target not whole — fully too
where it is cut — judged by the target's live geometry and R-direction over the strokes, refusal cases beneath a
presented layer, turn-back cases; the dismissal's dynamics on the toolbar cells), and `--side <checkout>` runs an
older averi for a live calibration (calibration.json `live`: #12, #17, #7 per fix, #19). A new cell,
edges/scroll-top-edge-end, gives #17's turn-back its shape. Results: docs/truth/live-android-2026-10-16-visibility.md
(73 cases), docs/truth/live-ios-2026-10-16-visibility.md (222), docs/truth/live-calibration-2026-10-16.md; new lab
notes LV1 (Android: a list moving through blank content read as exhausted), LV2 (Android: the flush probe leaves a deep
cut cut, intermittent), LV3 (iOS: the turn-back stroke touches down above the list) — live only, `excluded`; LE4
measured live. Review round 1: the stop judged on the state read when scroll_until returned; a claim that the last
swipes "did not change the screen" checked against the app's strokes whatever the tree listed; a live KNOWN
(scripts/truth/live-known.ts); `--record` / `--rejudge` (docs/truth/live-records/); #12's live verdict
CALIBRATED-ON-DEFECT, intermittent (one after-run of five leaves S cut). Round-4 code review: the live KNOWN pins a
case by its verdict class (weaker than ADR 0020 §4: no reply kind, no strokes), and live.ts exits 1 on an unknown
MISMATCH and — in a run of this checkout — on a known case not marked `intermittent` that comes out ok (WDA's
blur-menu-grouped C struck off by it; LV2's two the only intermittent ones); tests/truth/live-rejudge.test.ts rejudges
both visibility records in vitest (no device; 73/62/3/8 and 222/178/5/39, 0 not known); every note a `bug:` or a
`residual:` (idb's identifier-less UIKit table rows: lab note
2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md); #7's second fix rerun live at d928789, the
static pair's before (`pair: 2`).

### Alongside

- P5 (text inventory) is independent and small — any time.
- P3 / P4 after phase 3, judged on the golden corpus as well as the 580-tree differential.

### Pending captures (round 6, truth/r6-cells) — captured 2026-10-18 (truth/r6-device-ios)

Built in both apps, captured on Android first: on 2026-10-18 the host's Xcode 27.1 expected CoreSimulator 1174.9.2
and found 1171.7, so no iOS capture was made until the owner ran `xcodebuild -runFirstLaunch`. Round 6's iOS device
check then ran `capture.ts --udid <averi-lab iPhone 17> --out tests/fixtures/truth/ios-iphone17-ios27 --cells
carousel-in-list,own-parts` (iOS 27.0, the lab app built from truth/r6-device-ios): it wrote only those two cells'
files and their manifest entries (own-parts' L and N trees as before, I added). Golden at round 6's src: 1344 checks,
230 mismatches (1322/228 before: +22 rows, +2 mismatches, both known).

- `edges/carousel-in-list` — WDA: all 9 rows green. C's R-stroke `right` (S4's measurement): two strokes `307 181 →
  95 181`, both inside the carousel (scrollable 24,138 354x85), along its axis, at its middle; the replay moves
  nothing, so the stop fails honestly ("the last 2, swiping right, did not move it … outside its scroll view"). idb
  (no scroll view listed, LE2 across): C's colour PASSES on the page's background (#EEEEEE, the card's 7 % on screen)
  and its scroll_until strokes the screen's middle (`322 437 → 80 437` twice, then one back) — both filed in
  edges.known.ts as LE2; C's tap is refused under both sources.
- `false-covers/own-parts` I — as expected: both sources list the SwiftUI button alone (`lab.own-parts.I`, labelled
  Close, 179,660 44x44), tapped by its label and reached with no swipe — green; calibration.json #8's `needs` (8.2's
  iOS leg) done and dropped.

### Round 7 — the owner's decisions of 2026-10-18 on round 6's open points

- **HIGH: lab cell #18 — a React Native text field** (calibration.json #18's `needs`): an RN `TextInput` whose tree
  lists its own scroll indicator (`container 'Horizontal scroll bar, 1 page'` under the field, as mp-native's do) — the
  half of #18 no lab field reproduces (neither SwiftUI's TextField nor UIKit's UITextField lists one). First in round 7.
  Done 2026-10-19 (`truth/r7-rn`): a third lab app, React Native 0.88.0 (fixtures/apps/rn, its README), the
  `react-native` family's `rn-field` captured on both platforms (runs `ios-rn-iphone17-ios27`,
  `android-rn-averi_lab-api33`; the capture and the live golden drive one app per run, `--app react-native`). RN's
  multiline TextInput lists the indicator over its label's centre under WDA (its single-line one lists none); the bar
  is excused at HEAD, but the label is refused as under its own field — WDA wraps RN's input in an unnamed view of its
  rect (lab note LR1), and on Android the label overhangs its EditText by 3 px (LR2). Golden +30 checks, 12 KNOWN;
  live docs/truth/live-rn-2026-10-19.md.
- **Android presented windows the parser does not mark** (ADR 0018's residual 19, accepted with the active-window
  hint): a **full-screen dialog** (a `Dialog` with `usePlatformDefaultWidth = false` / a full-screen `DialogFragment`,
  its window at 0,0 the screen's size) and a **Views `BottomSheetDialog`** (its `touch_outside` scrim, labelled or not:
  does the scrim rule hold?). Each with a target beneath it: the tap's wait and `scroll_until` read with the hint, and
  whether the window could be marked from the dump.
  Measured 2026-10-19 (presented/dialog-fullscreen, presented/bottom-sheet-dialog): docs/truth/live-android-2026-10-18-visibility.md
  "Round 7: presented windows the parser does not mark"; lab note LW1.
- **Eyes: verify a "fully" claim with pixels** (ADR 0013's residual, live case k7): where a node-less sibling's padding
  — a bar riding on the IME, an inset its surface draws but its node does not span — may lie over the target, a
  `fully visible` stop is checked against the screenshot (the target's colour across its whole frame), so the 18 px of
  phone under the bar's top padding are seen, not assumed away.

From round 6's iOS device check (docs/truth/live-ios-2026-10-18-visibility.md; its review round 1):

- **A table long enough for ADR 0021 decision 4's long-list half**: lengthen sheet-long-list (its 40 rows end inside
  every far row's window: Row 30 whole over 1172–1748, the last offset 1748), or a new cell, so a target row's window
  lies wholly before the content's end and past one stroke's carry (≈ 1040 pt under WDA) — then a full final stroke
  overshoots it, and the carry case (live-visibility.ts#CARRY, its turns already counted from the touch log and the
  reply) can fail on a missing cut. Needs lab note LV6 fixed first (a scrolled table's parked rows read above the
  screen, docs/bugs/2026-10-18-lab-ios-wda-scrolled-tables-parked-row-text-reads-above-the-screen.md), or a target with
  its own identifier far down the list, which WDA parks alike. Done 2026-10-19 (truth/r7-lab-fixes): 56 rows, target L at row 30
  (docs/truth/live-ios-2026-10-19-lab-fixes.md); measured once LV6 is fixed.
- **Stale src prose to update on the next src branch** (not edited from a truth branch): src/interact/stroke-plan.ts's
  module doc (its lines 63–70) still says carousel-in-list is captured on Android only and that the iOS measurement
  waits on "Pending captures (round 6)" — both captured: under WDA C's stroke goes inside the carousel along its axis
  (the replay `307 181 → 95 181`; live one stroke at (307,181) moving the carousel 447–532 pt).

## Workflow per bug, once phase 3 is in

1. A device or exploratory finding becomes a cell plus its neighbours (other layer kind, other edge, other verbs,
   other tree source).
2. Capture → golden red.
3. Fix in the usual pipeline; golden green over the whole truth corpus, and the OLD/NEW differential over the
   device corpus shows no `refused → Tapped`.
4. The device round on the real apps confirms; a lab-app round can be run by an agent alone (no login, `clearState`
   allowed).

## Risks

- Compose hit testing / tap logging is harder than SwiftUI's — Android follows the iOS skeleton.
- Xcode / API upgrades shift trees: the manifest records the device and OS; recapture is one script run.
- The lab app is not the bank app: fewer and shorter device rounds, not none.
