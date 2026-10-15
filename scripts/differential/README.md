# Differential harness

Replays recorded device trees through two checkouts of averi — OLD and NEW — and reports every tool call whose
answer differs. It is how a change that should move behaviour only where intended is checked against every tree a
device check ever saved, without a device.

It depends on each side through two interfaces (`side.ts`), and one shim for older sides:

- the **tool interface**: the side's own `createAveriServer` over an `AdapterRegistry`, called through an in-memory MCP
  client exactly as `tests/mcp/tools.test.ts` does — the reply an agent would read;
- the **adapter seam**: the side's own adapters over a recorded payload. Nothing behind the tools (standing, scroll
  rounds, tap judgement, the pixel poll …) is imported, so a refactor inside averi needs no change here;
- the **legacy-registry shim** (`side.ts#registry`): since 8413120 (2026-10-08) the registry is constructed with
  `{ factory, discovery }`; before, with the factory alone, and it listed devices through an unbound adapter's
  `listDevices()`. Which constructor a side has is told by its behaviour (`takesDeps`: one built with `{ factory,
  discovery }` asks that discovery when it lists devices), and an older side gets a factory that answers the unbound
  call with the discovery. A side picked wrong answers every call "this.factory is not a function"; golden marks such a
  reply as a fault (below).

Where the recording meets each side:

| recording | adapter | parser exercised |
|---|---|---|
| iOS, raw WDA `/source?format=json` | side's `IosAdapter` over `RecordedTreeSource` (`recorded-source.ts`), which reads it with the side's `parseWdaSourceValue` — WdaTreeSource's own parse | yes |
| iOS, raw idb `ui describe-all --json` | side's live wiring (`defaultFactory`, kind idb): its `IdbTreeSource` asks the fake device | yes |
| Android, raw `uiautomator dump` XML | side's live wiring: its `AndroidAdapter` asks the fake device for the dump | yes |
| normalized `ui_snapshot` tree, either platform | served as it is (iOS through `RecordedTreeSource`, Android in place of the adapter's tree read) | **no** |

The **fake device** (`fake-device.ts`) is the process boundary: `child_process.execFile` is replaced before either side
loads, and answers `idb`, `xcrun simctl`, `adb` and the OCR recognizer's `swiftc` from the recording and a small device
profile: the screen size; the screenshot frame (grey, one rect painted on request); on iOS the launch commands and
`appinfo` (the recording's app); on Android the `dumpsys window displays` captures in `tests/fixtures` (API 33 Pixel_3a
with the keyboard hidden, docked or floating; API 36 with no IME entry), the `mInputShown` witness and the touchable
region (tests/helpers/android-dumps.ts's Gboard measurements), and `back` hiding the keyboard. Every command is logged —
what the tool would have sent. A command of a known binary the fake does not model is answered with nothing and logged
`UNMODELLED <command>`; the report counts them. Every other way of starting a process, and `fetch`, throws, so a run
cannot touch a device. Time is virtual (`clock.ts`): the sleeps of averi's one sleep owner (`src/util/sleep.ts`) move a
fake `Date.now` and return at once, so a 12 s pixel poll or a five-stroke `scroll_until` runs in milliseconds and the
same on both sides; a run with calls and no virtual sleep warns that the owner has moved.

The recorded source is not in `src/` and not an `IosTreeSourceKind`: no averi.yaml can select it. It has to work against
an OLD checkout that predates it, so it takes the side's parser as an argument.

## Running it

```sh
# OLD and NEW each a git ref (checked out detached in a temporary worktree, removed afterwards) or a path;
# NEW defaults to this checkout. One checkout on both sides is refused: its modules would be compared with themselves.
node --import tsx scripts/differential/run.ts --old e1384aa --corpus <corpus dir> --out <report dir> \
     [--new <ref | path>] [--shards N] [--cap N] [--tools tap,scroll_until] [--only <regex on tree id>] [--worktrees <dir>] [--all]
```

`node --import tsx`, not `npx tsx`: tsx's CLI opens an IPC pipe some sandboxes refuse. Git worktrees and the child
processes need a shell that may create them. The run writes `report.md` (counts per tool, unmodelled device commands,
the trees with diffs, the diffs grouped by what changed — numbers and quoted values blurred so one change on many trees
is one group, `device calls only` when the replies agree, with an example each), `diffs.jsonl` (every differing call,
both outcomes) and, with `--all`, `calls.jsonl` (every call).

On 12 cores a corpus of 479 trees (about 245 000 calls, each on both sides) takes about five and a half minutes.

Per tree:

1. **Device variants**
   - iOS: the screen; no screen (`idb describe` fails); with the keyboard in the tree, `tap` again under
     `app.ios.keyboardDismiss: [accessory]` and `[tap: <the first text with a unique label>]`.
   - Android: keyboard hidden; docked (back hides it); floating; API 36 with the keyboard shown by the input method but
     no IME entry in the window state; no screen (`wm size` fails).
   - Both: `real scale` (the frame at 3× on iOS, 1× on Android) and `other screen` (an iPhone 17 Pro Max, 430×932; a
     1080×2400 phone — a device that differs from the tree), on the first three targets, `tap` and the colour assert.
   - The no-screen variant calls `tap` and `assert`; the dismissal variants `tap`; floating and API 36 `tap` and
     `scroll_until`. Every other frame is at half the screen (scale 0.5, inside the pixel asserts' plausible range):
     a 1080×2220 frame costs ~100 ms to decode in pngjs.
2. **Targets** — `ui_snapshot` on both sides; every node either side's tree lets a selector address: a unique identifier
   (`id:"…"`), else a unique text (`text:"…"`, label or value), else a unique `label:` or `value:`, else its role with
   text or id (`role:… text:"…"`, `role:… id:"…"`); values holding `"` cannot be written in the grammar.
3. **Calls**, each on both sides with the same arguments, the device and the clock reset before each:
   - per tree: `ui_snapshot`; `swipe` up and down; one `tap` per text more than one node carries (the many-matches
     path); on a raw iOS tree `launch_app` (its foreground wait asks the source which app the tree is of);
   - per target: `tap`; `scroll_until` down, up and down `fully`; `assert` element, colour and ocr (a 1 s budget each —
     a static tree keeps its verdict, a longer budget only adds rounds); `type_text` on a textfield.
   - A colour assert's target is painted its own colour in the frame (at the frame's scale) and the assert expects
     that colour: sampling another rect, or the right rect at the wrong scale, fails. OCR reads no text in any region,
     so the ocr assert is compared on whether it may look and how it refuses.
   - The outcome of a call is the reply (text blocks, image sizes and content hashes, `isError`) and the device calls
     it made.

`tests/differential/` runs the harness on a committed sample — two `tests/fixtures` payloads (a raw WDA source, a raw
idb list) and a Compose dump from `tests/helpers/android-dumps.ts` — and checks that the recorded adapters read like the
live ones, that OLD = NEW differs nowhere, that a parser change shows where a tool reads it, that a device-only change
groups as `device calls only`, and that a colour assert passes on its own painted target. The converter's tests cover
`session.log` extraction, the classification of each file, de-duplication, and the names a raw payload and its saved
`ui_snapshot` take side by side.

## Golden mode: against the truth, not against another checkout

OLD vs NEW cannot see an answer both sides get wrong. The golden mode judges ONE side against ground truth (ADR 0020):
captures of the lab apps (`fixtures/apps/`, docs/plans/2026-10-15-ground-truth-lab-app.md), each naming in its manifest
entry the `screenshot` the device showed and a `truth` file (scripts/truth/schema.ts: per target the app's own frame,
whether a raw tap at its centre fired its action, what else that tap made the app log — its touch first, the positive
control that the tap reached the app at all — and how much of the target the screenshot shows in its own colour). The
fake device serves that screenshot instead of the grey frame (and refuses a profile whose frame is not its size);
`golden-spec.ts` says what each verb must answer for each kind of truth (tapped or refused and the remedy, colour pass
or fail, scroll_until reached or stopped, a tap or a stroke sent or not) — classes, not wording. It is a façade over one
file per cell family (`golden-spec/<family>.ts`: base, presented, forms, edges, bars; false-covers to come), the judges
they share (`golden-spec/judges.ts`) and phase 3's row types (`golden-spec/rows.ts`: R-off, R-outside-sv, R-sliver,
R-stroke, R-land, R-fully, R-band, R-under-chrome, R-overlap, R-dismiss; R-direction declared live only — golden never
asks a row marked `live`). A row type is asked only of a target whose truth carries a measured `geometry` other than
`whole` (scripts/truth/truth.ts#geometryOf: measured when the app's state reports the system bands, its scroll views'
clips or its chrome — no capture before phase 3 does). A reply that says the target is not in the tree (a tap "waiting
for element … to appear", scroll_until's "never appeared in the tree", an assert's "not found within") is judged by its
effect first — a tap refused without its remedy, a stroke beneath the presented layer is the row's own mismatch; only
where the row would accept it is it no evidence either way, its mismatch said to be of that class first (`not in the
tree: …`).

```sh
node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth [--side <git ref | path>] [--worktrees <dir>] \
  [--only <cell>[,<cell>…]] [--json]
```

`--only` keeps the captures a token names (a cell, a capture with or without its extension, either behind its run; a
token naming none is an error); `--json` prints the results as data (`GoldenJson`) in place of the report. A check whose
reply is a harness or JavaScript error (`THROW`, "is not a function", "Cannot read properties of", the fake device's
`differential:`) or whose call sent a command the fake does not model (`UNMODELLED`) carries it as `faults`
(`golden.ts#faultsOf`) — no evidence about the tool either way. Exit code 1 on a mismatch, a broken target or a fault.
`tests/differential/golden.test.ts` runs it over the committed truth on this checkout: no broken target, the checks per
capture pinned, and the known mismatches listed by `<run>/<file> <target> <verb>` with their class, their reply's kind
(`golden-spec/judges.ts#replyKind`: not found, Tapped, visible, PASS, FAIL, refused, other), the taps and swipes they
sent and their notes — a ratchet both ways (one fixed fails until struck off; a new one fails until fixed or listed; one
whose class, reply kind or device calls change fails until re-noted). The ratchet is kept per cell family,
`tests/differential/golden/<family>.known.ts` (KNOWN and COUNTS of that family's cells only, aggregated by
golden.test.ts, which refuses a row filed under another family's file); a row may say what it is beside its class — `as:
bug:<docs/bugs file>` or `residual:<decision>`.

The form cells (`form-basic`, `form-errors`, `form-keyboard`, `form-prefilled`, `form-picker`; phase 1b) have no
coloured targets. Their truth (`CellTruth.form`) is the app's own model — per field its value, focus and the error it
shows with the identifier it shows it under, the keyboard's frame, the submits — and per control (field, submit, picker
row) where its frame lies (open, under the keyboard, partly covered, under the sheet, off the screen, not laid out —
measured from the app's frames by scripts/truth/truth.ts#situationOf, not declared) and what a raw tap at its centre
did. `golden-spec/forms.ts#formExpectations` holds their rows: `assert … error:` by the field-error rules of
docs/verification.md (each row names the rule it relies on, applied to the app's frames), titles and prefilled values
read back as text (the P5 sample: ’ “ ” – — … NBSP & diacritics), a secure value never read back, a tap under the
keyboard refused naming it (in the reply's own words — the selector it echoes is left out), the submit pinned above the
keyboard tapped and reached with no swipe, `scroll_until` touching down above the keyboard, a field under the pinned
submit whose probe tap submitted the form neither tapped nor "reached" without a swipe, and a lazy picker row swiped for
on the sheet.

What a replayed tree cannot judge — a fill, a clear, typing into the focused field, a dismissal — the live golden runs
on the lab simulator through averi's MCP tools, the app's model as the oracle (not a vitest test; it needs the
simulator; HID typing hides the soft keyboard, which `lab-device.ts` restores per launch through the simulator's own
keyboard preferences):

```sh
node --import tsx scripts/truth/live.ts --udid <lab udid> [--wda-port 8120] [--sources idb,wda] [--cases k1,b1]
```

The cell catalog is one file per family, `fixtures/apps/cells/<family>.json` (base, presented, forms, edges, bars,
false-covers — scripts/truth/schema.ts#FAMILIES); both apps bundle `fixtures/apps/cells.json`, which
`node --import tsx scripts/truth/catalog.ts` generates from them (`--check` exits 1 when it is stale;
tests/truth/catalog.test.ts fails then too), each cell stamped with its `family`, by which each app routes it to its
family's file (`AveriLab/<Family>.swift`, `dev/averi/lab/<Family>.kt`). A cell's `config` is merged into the averi.yaml
golden replays it under (`differential.ts#configFor`, through the truth's `config`). How to add a cell:
docs/plans/2026-10-15-ground-truth-lab-app.md, phase 3, B1.

The capture is one module, `scripts/truth/capture-run.ts#capture(lab, cells, opts)`, over a `LabDevice`
(`scripts/truth/lab-device.ts`: launch a cell in a fresh process and wait for its `ready`, read the app's state file,
a raw tap, the screenshot, the raw trees): `IosLab` (simctl, idb, WDA's own `/source`) and `AndroidLab` (adb). The
arithmetic — where a control lies, what a probe's events say, when a cell is broken — is `scripts/truth/truth.ts`,
pure and unit-tested (tests/truth/truth.test.ts). `capture.ts` and `capture-android.ts` are its command lines. Both
apps log every touch their windows receive (iOS: `UIApplication.sendEvent`; Android: the activity's and each dialog
window's `dispatchTouchEvent`), so a probe whose tap left no touch is a broken cell, not "not reached".

Recapturing iOS (a simulator, not the device-check one; WDA on its own port, built into its own derived data
`~/Library/Developer/Xcode/DerivedData/averi-wda-lab`, never device-check's `averi-wda`; idb's companion must be up for
the simulator):

```sh
cd fixtures/apps/ios && xcodegen generate && xcodebuild -scheme AveriLab -destination 'id=<udid>' -derivedDataPath build build
xcrun simctl install <udid> fixtures/apps/ios/build/Build/Products/Debug-iphonesimulator/AveriLab.app
node --import tsx scripts/truth/capture.ts --udid <udid> --out tests/fixtures/truth/<run> [--family forms] [--cells form-basic,…]
```

`--family` keeps the cells of those families, `--cells` those cells (both given: the named cells of those families); a
name that matches nothing is an error. A run of some cells adds to (or replaces those cells in) the run's manifest; the
other cells keep their captures. A manifest names one device: a run into a directory captured on another device is
refused. Exit code 1 when a cell is broken.

Android (fixtures/apps/android, Compose; an emulator of its own — the committed run is a dedicated `averi_lab` AVD,
Pixel 3a profile, API 33 — never the device-check AVD; JDK 17, the Gradle wrapper's 8.13). The truth is in screen
pixels, uiautomator's units (`scale` 1); the golden profile is the fake device's API 33 Pixel_3a, keyboard hidden:

```sh
cd fixtures/apps/android && ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleDebug
adb -s <serial> install -r fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk
node --import tsx scripts/truth/capture-android.ts --serial <serial> --out tests/fixtures/truth/android-<avd>-api<N> [--family presented]
```

The Android app builds the coloured-target cells; a form cell or another layer is skipped and said so (phase 2b brings
the forms, through the same `capture`).

### Calibration on the bug notes (phase 3)

`scripts/truth/calibrate.ts` runs golden (`--json`, the whole corpus) over the src of each before and after commit
`scripts/truth/calibration.json` names — every visibility note and the field-error notes, each calibrated on golden
rows, or why none can be (needs a cell, phase 2b, a live run, OCR; a residual), and every other bug note excluded with
its class — and writes `docs/truth/calibration.md`:

```sh
node --import tsx scripts/truth/calibrate.ts --worktrees <dir> [--note <n>[,<n>…]] [--out docs/truth/calibration.md] [--remove]
```

A note is CALIBRATED when every row it names is red before with the note's own symptom (`defect`, matched against the
mismatch or the reply — a red row that differs only in a remedy's wording does not count) and green after. A side counts
only when it passes the canary: no check with a fault, the `open` cell replayed and green — a side miswired still prints
JSON, every row an error a refusal row would accept. Every row of the corpus is compared at each fix: one green before
and red after that the note does not name is reported as regressed elsewhere, and fails the run unless the note's
`regressions` records it. An open note is judged on the working tree; for the lab findings (L1, L2) their family's KNOWN
(`tests/differential/golden/presented.known.ts` for L1, `forms.known.ts` for L2) owns the ratchet and calibration.json
only the note→rows link, so a fix that strikes their rows off KNOWN turns them OPEN-NOT-REPRODUCED, and calibrate exits
1, until the note becomes `calibrate` with its fix. Checkouts (`differential-cal-<sha>`) are kept for the next run and
reused only when they are at that commit; `--remove` removes those this run created. Exit code 1 on a verdict other than
the note's `expect`, or an unrecorded regression. A golden process that printed no JSON or was killed is run once more;
a side that still does not load says why (the exit code or signal and the last lines of stderr, or git's stderr), and
`--out` then leaves its file as it is and writes `<out>.failed`. With `--note`, which runs some notes only, `--out`
writes `<out>.partial`, the full report left as it is. `tests/truth/calibration.test.ts` pins the table against
docs/bugs and the git history, and the verdicts, the canary, the wiring and a side that fails as pure functions.

## Corpus format

One directory per capture run, one file per tree, and a `manifest.json` (`corpus.ts`). The directory's name is the run —
the manifest names none — and a tree's id in a report is `<run>/<file>`:

```json
{
  "platform": "ios",
  "screen": { "width": 402, "height": 874 },
  "device": "iPhone 17 simulator, iOS 27.0",
  "note": "optional",
  "captures": [
    { "file": "D-swift-form.json", "source": "wda", "form": "raw", "app": "Skeleton Internal" },
    { "file": "B2-idb-iban.snapshot.json", "source": "idb", "form": "normalized" }
  ]
}
```

- `source`: `wda` | `idb` (iOS), `uiautomator` (Android). `form`: `raw` — the payload the source read off the device
  (WDA's `/source?format=json` body, idb's `ui describe-all --json` array, the `uiautomator dump` XML) — or
  `normalized` — a UiNode tree as `ui_snapshot` printed it, replayed without the parser.
- `screen` (in the tree's units: points on iOS, pixels on Android) is what the fake device answers for the screen; a
  capture's own `screen` and `app` override the run's.

The corpus of real device trees stays out of git. `convert.ts` builds one from the device-check scratch directories
(`run<N>-ios`, `run<N>-android`, subdirectories included), each file classified by its content: raw WDA `/source`
bodies, raw idb `describe-all` lists, raw dumps, saved `ui_snapshot` trees, and every unfiltered `ui_snapshot` the
averi server logged in the run's `session.log` — all de-duplicated by content across the runs. It also takes the
repository's fixtures and the synthetic trees in `synthetic.ts` (among them two raw WDA captures whose status-band
header beneath a presented screen is given an identifier, so a selector reaches it). Skipped, with the reason in the
manifest's `note`: WDA's XML `/source` (no parser reads it), filtered snapshots, and files that hold no tree.

A device-run file's name in the corpus (`convert.ts#corpusName`) is its path, subdirectories flattened into it
(`F1poll/1.json` → `F1poll.1.json`), with an extension that says what it holds:

- a raw payload is `<name>.json` (WDA, idb) or `<name>.xml` (a `uiautomator` dump) — a `.txt` or `.raw` takes the one
  of its content;
- a normalized tree saved as `.json` keeps its name; saved under any other extension (`.txt`, `.raw`, `.xml`) it is
  `<name>.snapshot.json`. So a raw payload saved beside the `ui_snapshot` of the same screen under the same name, as
  below (`acct2.xml` beside `acct2.txt`, `contacts-list-wda.json` beside `contacts-list-wda.txt`), is kept as two trees
  — `acct2.xml` and `acct2.snapshot.json` — and a normalized Android tree is never named `.xml`;
- a tree the server logged is `session-<call>.json`.

The ids of normalized trees saved as `.json` are what they were before this rule; those saved under another extension
moved, so an id quoted before it now reads `….snapshot.json` (`run14-ios/B1-idb-swift.json` is
`run14-ios/B1-idb-swift.snapshot.json`; run11–run14 Android's `snap*.xml` are `snap*.snapshot.json`).

A raw payload saved as `.txt` or `.raw` beside a different `.json` of the same name (`x.txt` holding a WDA body
beside `x.json`) still fails the conversion (`duplicate corpus file x.json`): rename one.

**Rebuilt runs are not device captures.** A run may hold raw payloads REBUILT from normalized trees — the corpus's
`rebuilt-idb-ios` holds an idb `describe-all` list rebuilt from each normalized idb tree (idb's normalization maps
element by element, so the inverse is exact up to the type within a role and minus the parser's own marks, such as a
field's `error`: 41 of its 94 trees carry such marks from the parser that read them, so an OLD parser gives back 53 of
the 94 exactly). Such a run says so in its manifest (`device` and `note`, and each capture's `note`), and every tree in
it is also in its own run as normalized: it lets an idb parser change show where no raw payload was saved (the IBAN
`_error` pairing), but it is no evidence of what a device sends. `report.md` lists each run replayed with what its
manifest says it is. `convert.ts` does not build it: the script that does is kept in the run's directory, outside the
repository like the corpus.

```sh
node --import tsx scripts/differential/convert.ts --runs <dir of run<N>-* dirs> --repo . --out <corpus dir>
```

## Saving raw payloads in a device check

A normalized tree hides every parser change: the harness can only replay what the parser already made of it. A device
check should save, next to each tree it reads, the raw payload the tree source returned:

- iOS WDA: `curl -s 'http://127.0.0.1:<port>/source?format=json' > <name>.json` (session-less, as the fixtures
  `tests/fixtures/wda-capture-*.json` were captured; averi gives the first simulator port 8100, the next 8101 —
  adapters/wda.ts#wdaPortFor), right after the `ui_snapshot` of the same screen;
- iOS idb: `idb ui describe-all --json --udid <udid> > <name>.json`;
- Android: `adb -s <serial> exec-out uiautomator dump /dev/tty > <name>.xml` (the trailing status line is fine —
  the converter keeps the XML as is and the adapter strips it).

Then add them to a run directory with a manifest (`form: "raw"`), or let `convert.ts` pick them up — the raw payload
and the saved `ui_snapshot` under the same name are both kept (the naming rule above).

## What it does not cover

The scratch harness this replaces drove averi's internal functions directly; several of its sections ask questions no
tool call can express:

| section | at the tool level | how, and what not |
|---|---|---|
| TAP | **covered** for addressable nodes | `tap` per target, screen / no screen, Android keyboard hidden / docked / floating / API 36, iOS dismissal configs, many-matches texts. Not: nodes no selector addresses (no unique id, text, label, value or role pairing — the unlabelled headers and content containers); the "sent" sentence variant; a synthetic keyboard line over trees without one. The status-bar sentence beneath a presented screen in particular: the real status-band headers of the device trees (`0,0 402x102`, `0,0 402x116`) carry no identifier or label, so no selector addresses them, and it is covered only on the two synthetic header-id trees |
| PIXEL | **covered** for addressable nodes | `assert` colour (on a painted target) and ocr per target, with and without a screen, at real scale and on another screen for the first three. Not: the turned device; OCR content (the fake recognizer reads no text) |
| ROUNDS | **partly** | `scroll_until` down, up and down `fully` on the recorded static tree with real strokes. Not: plays with a synthetic corroborated or vetoed keyboard cover, `found` pairs, the band and two-way-screen variants — reducer inputs a static recorded tree cannot produce |
| GUARD | **partly** | `tap` under the iOS dismissal configs on trees with an in-tree keyboard; Android's oracle hidden, docked, floating, API 36 (no IME entry), back hides. Not: the synthetic WDA band on keyboard-less iOS trees; a witness that answers unknown |
| PICK | **partly** | the dismissal tap inside `tap` under `[tap: first unique text]` — one candidate per tree, not every non-interactive node |
| KEYPOS | **not covered** | keyboard-position internals; their effect shows in `tap` and `scroll_until` |
| SEQ | **not covered** | the scroll tests' own `round` sequences are unit tests, not trees |

Tools not called: `run_flow`, `ensure_state` and `verify` need an averi.yaml with states and flows written for the
app on screen, and drive several screens — a static recorded tree is one; `press_key`, `terminate_app`,
`open_deep_link`, `install_app`, `get_logs`, `list_devices` and `select_device` read no tree (one device command
each, or none); `screenshot` would return the fake's grey frame.
