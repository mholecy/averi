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
| reached, drawn ≥ 95 % | `Tapped` | pass with its own colour | reached, 0 swipes |
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
The pinned submit's bar is measured today from iOS's padding in points (scripts/truth/truth.ts#PINNED_BAR_PADDING,
`situationOf`); phase 2b has the app report its bar's frame (e.g. `frames["submit.bar"]`) and `situationOf` read it
on both platforms, the constant dropped.

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

**B1 — the families and the plumbing (no cell, no capture).** So that phase 3's batches (B2 edges, B3 presented, B4
bars, B5 false covers) are written in parallel worktrees without touching each other's files, every shared file is
split by cell family — `base` (`open`), `presented` (`sheet-medium`, `alert-dim`), `forms` (the five form cells),
`edges`, `bars`, `false-covers` (scripts/truth/schema.ts#FAMILIES):

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
   on a target's geometry, is wired through the façade, `golden-spec.ts#expectations` — false-covers' R-dismiss
   (rows.ts#dismissRow, under the cell's `config.ios.keyboardDismiss`). So a B5 author edits
   `golden-spec/false-covers.ts` (its rows), `golden-spec.ts#expectations` (to ask them), rows.ts only for a new row
   type, and steps 1–3 and 5's files.
5. **KNOWN** — `tests/differential/golden/<family>.known.ts`: the captures' COUNTS, and each mismatch the checkout has
   with its class, reply kind, calls, note and `as: bug:<note>` or `residual:<decision>`; then the note's rows in
   `scripts/truth/calibration.json` and a calibrate run.

**B4 (bars) — the band probes, measured (2026-10-16).** B1 left what a raw tap in Android's navigation band does
unmeasured (gesture navigation or three buttons, ADR 0009's context) and never probed a centre there; it assumed iOS's
status band passes every tap to the app. B4 measured both on the `bands` cell (S centred in the status band, N in the
navigation band, O and Q 4 dp/pt into them) with the lab app's touch log as the witness — per tap: `am force-stop` and
`am start … --es cell bands` (iOS: `simctl terminate`, `simctl launch … -cell bands`), the state file's event count,
the raw tap, 1 s, the events since:

| device, mode | the band | raw taps (x,y) | the app logged |
|---|---|---|---|
| averi_lab AVD, API 33, gesture (`settings get secure navigation_mode` 2; `dumpsys window displays`: `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220]`) | navigation | (540,2187), (540,2215) on N; (100,2187) beside it | the touch each time, and `tap N` for the two on N |
| the same, three buttons (`cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton`, mode 0, `[0,2088][1080,2220]`) | navigation | (540,2154), (100,2154), (270,2154) | nothing; the launcher took the focus (Home, Back) |
| the same, either mode | status (`[0,0][1080,66]`) | (540,33) on S | nothing |
| averi-lab iPhone 17 simulator, iOS 27.0 | status (0–62 pt) | (201,10), (201,31), (60,31), (340,31), (120,50), (201,52), (201,53) | nothing — the status bar's window takes them |
| the same | status | (201,54), (60,54), (201,55), (201,58), (201,61) | the touch, and `tap O` beneath |
| the same | home indicator (840–874 pt) | (201,857), (60,857) on N | the touch, and `tap N` |

The AVD was set back to gesture navigation (`…navbar.gestural`; mode 2, the band at 2154 again) before its captures. So
the capture probes a centre in any band (truth.ts#unprobedReason no longer names the navigation band), and
consistency holds it to what the touch says: Android's status band swallows (systemBarSwallows, #21); in the
navigation band, Android's or iOS's home indicator's (truth.ts#bandTouchTells), a logged touch means the target must be
reached, none that it must not be. B1's iOS assumption did not hold: iOS's status bar swallows a tap in the top of its
band — B3 measured it the same day on `open` (no touch at y 2–50, a touch from 55) and wrote the rule,
truth.ts#statusBarMaySwallow; B4's taps above agree (no touch up to 53, a touch from 54). averi refuses a tap in a band
(ADR 0009 N-a, ADR 0008): R-band — on iOS the status band's only (golden-spec/bars.ts).

### Phase 4 — the matrix, generated

One template `Host(layer, geometry)` per platform; cells generated from `cells.json` (layer × geometry). Text cells for
P5's sample. OCR judged against real pixels (the macOS recognizer on the captured screenshot; skipped where it is
unavailable), phase 1b's text samples included. The covering layer per target (the proposal's P1, "the covering layer,
if any") is recorded in the truth file here; until then the cell's `layer`, the declared kind and the probe's events
(`dismissed`, another target's `tap`) stand for it (ADR 0020, residuals). The RN modal cases only if the existing RN
trees do not cover them.

### Phase 5 — live golden

averi's verbs run on the simulator against the lab app, the app's tap log and scroll offset as the oracle: covers
what a static tree cannot (`scroll_until` dynamics, strokes, the keyboard).

### Alongside

- P5 (text inventory) is independent and small — any time.
- P3 / P4 after phase 3, judged on the golden corpus as well as the 580-tree differential.

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
