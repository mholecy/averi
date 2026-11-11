# Verification in depth

Reference for averi's verification features: assert semantics, forms, and layout contracts
(geometry, color, and text checked with numbers). For the day-to-day workflow see
[skill/SKILL.md](../skill/SKILL.md); for the architecture see
[ARCHITECTURE.md](../ARCHITECTURE.md).

Verification is tiered, cheapest first:

1. **Element asserts** — deterministic checks against the normalized accessibility tree.
2. **Screenshots** — for the agent's own visual judgment.
3. **Pixel-diff** against stored baselines (auto-created as `.averi/baselines/<platform>/<name>.png`
   beside averi.yaml on first use — refused, not created, while the screen, a blinking caret or a
   clock included, is still changing; delete the file to re-baseline). On iOS the status band (top safe area) is left out
   of a baseline diff.
4. **Numbers, never impressions, for geometry and fills**: `rect` asserts against Figma-frame
   values, `color` asserts against an expected hex (CIEDE2000), `ocr` asserts reading back the
   text an element actually renders, and `verify` with a layout contract printing per-anchor
   geometry, color and text/type-size tables.

A successful `ensure_state` or `run_flow`, every `assert`, and every `verify` leg whose state and
flow completed end with an `appAlive` line (when averi.yaml names the app for the platform) —
`false` with a crash-log excerpt if the app died, `unknown` if the device could not be asked. A
FAILED flow or leg carries no `appAlive` line: after a failure, check with `get_logs` (grep for
the crash) or a `screenshot`.

## Forms & validation

Added 2026-08-05, dogfooded on a real cross-platform payment form:

```yaml
flows:
  check_validation:
    requires: payment_form
    steps:
      - scroll_until: { element: { id: submit_button } }   # swipe until visible — no coordinates
      - tap: { id: submit_button }                          # dirty submit
      - assert:                                             # inline checks mid-flow
          - { element: { text: "Required" } }
      - fill: { id: amount_input, value: "1.00", clear: true }  # focus + clear + type in one step
      - assert:
          - { element: { text: "Required" }, absent: true }
```

- **`absent` semantics** (assert + state `detect:`): an element is absent when it is *not in the
  tree, or its rect does not intersect the visible viewport*. This is the one portable meaning —
  Android prunes off-screen nodes from its tree while iOS keeps them with off-viewport rects, so
  a raw tree check would pass on one platform and fail on the other for the same screen. On a
  BARE tree (only wrappers, unlabeled decoration, or iOS's status bar and launch icon — a cold launch's decor or splash) absence is
  undecided, never satisfied: the assert fails `could not verify …`, `wait:`/`branch:` keep
  polling, and a state `detect:` reads it as unknown.
- **`fill`** clears opt-in only: typing APPENDS on both platforms, but dev flavors may pre-fill
  login fields that must survive. Fills are verified against a fresh accessibility tree when the
  field exposes its text — a clear-fill that lands wrong is wiped and retyped once; a no-clear
  fill never destroys existing content (it fails loudly instead). A field that reformats as it is
  typed (an IBAN grouped in fours, an amount's thousands) passes when it shows every typed character
  in order with one kind of separator added between groups — a space, `-`, `/`, or `.`/`,` where a
  thousands separator sits or as two or more marks grouping digits alone (a dotted date `31.12.2026`
  for `31122026`) — and the reply says `the field shows them reformatted: N separators
  added` (for an added thousands `.` or `,` as a ⚠ line: it reads like a decimal point); a dropped, reordered
  or changed character still fails — the one accepted change is a typed space shown as a no-break
  or narrow no-break space (`respaced`), which is formatting (ADR 0034). A field that grouped
  what landed and dropped the end (`1 234 567,` for `1234567,89`) gets the tail alone typed again
  on iOS, as an exact prefix does (ADR 0034's D28 amendment). One that shows every typed character
  with separators the rule refuses (a cents mask's `12.34` for `1234`) fails saying so, the check
  and the remedy named (ADR 0034's D53 amendment). Without clear, an earlier text that
  vanished (a placeholder the source does not name, read as the empty field's value) no longer
  fails the fill: the reading is judged as the value alone too (ADR 0034's D29 amendment;
  widened by D61: an unnamed placeholder whose letters and digits start the value's).
  Without clear, a reading unchanged since typing began fails as `did not change` unless it is
  the value itself (ADR 0034's D63 amendment).
  Without clear, the reading must be the value itself, or hold it in what was typed after the
  earlier text, not anywhere in the reading: a field that kept its earlier text and only the start
  of the typing (a length cap, a dropped tail) is no fill, though its text holds the value; on iOS
  the tail is typed again (ADR 0034's D64 amendment). A reading that is the value itself cannot be
  told from a select-all field that replaced its text, so a dropped key can pass there: `55` typed
  after `5`, the second key lost, replies Filled (ADR 0034's A9 amendment, backlog D71).
  On Android a no-clear fill by sole id into an empty plain field does not read the field again
  after focus (ADR 0028), so a reading that holds the value among other text (`+421 421` for `421`)
  replies Filled with a ⚠ line that its text after focus was not read: the field may have inserted
  that text, and the keys may not have landed at all (`+421 `). Check its value where it matters
  (ADR 0028's D64b-3 amendment). A reading exactly the value says nothing, and cannot be told
  from one the field inserted; nor does a reformatted reading (the field's own grouping of the
  typed characters, said in the reply's aside) get the line; a non-empty plain field's earlier text is the pre-tap reading on
  every source, with no such line.
  Android types one character per `input text` call: bulk injection races Compose's async state
  and drops most characters (measured 3 of 11 landing). averi types printable ASCII
  (U+0020–U+007E) on both platforms; on iOS with `treeSource: wda` also Latin, Greek, Cyrillic
  and Han letters, common punctuation and symbols, NBSP and U+202F, through WebDriverAgent's
  `/wda/keys` (ADR 0037's D43 amendment — ASCII stays on idb). A value holding any other
  character — on idb and Android `Š`, `’`, `–`, an NBSP; everywhere an emoji — is refused as a
  control character is, before the field is tapped, cleared or typed into, the error naming the
  first such character by code point, never the value, and the way out for the project (idb's
  `ui text` and Android's `input text` cannot type it: ADR 0037). The same holds for `type:` and
  the `type_text` tool.
- **Field errors**: on iOS `ui_snapshot` attaches `error` to an input by one of two rules, on idb
  and WDA alike. First, a same-identifier text below the field (the SwiftUI convention when
  titles/errors share the field's `accessibilityIdentifier`) that is not a title of a
  same-identifier field (a same-identifier text overlapping a field), and lies above the next such
  field; the nearest such text wins. Second, for a field the first rule left without one, a text
  whose own identifier ends in `_error`, `.error` or `-error`, in any case (mp-native's
  `swift_payment.form.iban_input_error`). It pairs with the nearest textfield above it in its
  column: the field overlaps it horizontally and ends at or above its top, at most 24 pt above
  it, or the field's height when that is more. Any textfield counts, with or without an
  identifier. It does not pair when another textfield of that column starts between them. Of two
  fields side by side, it takes the one it overlaps more, and the first listed on a further tie.
  Of several such texts under one field, the nearest wins. A message with no field close above it
  in its column pairs with none: a screen-level error such as Account Detail's
  `accounts.detail.error`, 337 pt under the search field, is no field's. An error named some
  other way (`IbanError`, `error_iban`) is not seen. Assert with
  `{ element: { id: amount_input }, error: "Required" }`. Android sets no `error`, so there
  assert the message's `text` instead.
- **Tap disambiguation**: when a selector matches several nodes and exactly one is interactive
  (button/textfield/switch/…), `tap`/`fill` target that one and say so in the trace. Several
  interactive matches: a flow step takes the first and says so (the descriptor's author can see
  the tree, and can narrow with `role:`); the MCP `tap` / `type_text` tools refuse and list them.

## Layout contracts — geometry with numbers

The screenshot judge cannot see a 46-vs-24pt margin or a 1.81-vs-1.60 aspect ratio — geometry is
arithmetic, so averi checks it with numbers (a port of the convergence superrepo's
`rect-parity.py`, consuming averi's own normalized UI tree). Two entry points, no new tool:

- **One element** — a `rect` assert spec:
  `{"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}}`. Expected values
  are Figma-frame units; both sides are normalized to **% of screen width** before comparing
  (default tolerance 2%). `y` is measured and reported but **never fails**: absolute y drifts
  between devices with different aspect ratios from geometry alone.
- **Whole screen** — `verify` with `contract: path/to/contract.json`: after the legs run, each
  leg's UI tree is compared per anchor and a `## rect parity` table is appended — per-field
  deltas vs the contract and android-vs-ios, **gap-to-previous-anchor** rows for vertical
  position (local, aspect-independent — this is why absolute y never fails), aspect-ratio
  spread, and MISSING anchors listed separately with their likely causes. An invalid field
  value in a table the run would produce (a bad `bg`, `sample`, `text`, `text_dynamic` or
  `tolerance_*`) refuses the call **before any leg runs**, listing every such field — fix the
  contract and re-run; nothing was run on a device.

```json
{
  "screen": "transactions.list",
  "figma_frame_width": 393,
  "tolerance_pct": 2.0,
  "anchors": [
    { "id": "transactions.list.pill_bar", "x": 24, "y": 247, "w": 345, "h": 32 },
    { "id": "transactions.list.row_0", "x": 24, "w": 345 }
  ]
}
```

Anchor ids are the elements' test identifiers (identical on both platforms); omitted fields are
compared platform-to-platform only, never against the contract.

## Color parity

Same contract file (a port of the superrepo's `color-parity.py`, live-validated on device
2026-08-14): anchors may additionally carry `bg` (expected fill, `#RRGGBB` or `#RRGGBBAA` —
alpha dropped), `bg_dark` (the dark-theme counterpart — **carried, not yet exercised**: `verify`
always runs the light axis, because averi cannot switch device themes and sampling a light
capture against dark hexes would fake evidence; `bg_dark` waits for the dark-mode round, which
needs a theme input plus a device actually captured in dark mode) and `sample` (`"dominant"`,
the default — mode of the region after a 12% edge inset, reported as the winning bucket's mean —
or `"patches"`: 4 corners + center, for busy centers). When any anchor opts in, `verify` samples
each leg's final screenshot at the anchors' tree rects and appends a `## color parity` table
next to `## rect parity`:

```json
{ "id": "payment.form.debit_select", "x": 24, "y": 106, "w": 345, "h": 129,
  "bg": "#FDFDFD", "bg_dark": "#363644", "sample": "dominant" }
```

```
anchor                                   android       ios  dE(a,i)  dE(a,c)  dE(i,c)  verdict
payment.form.debit_select                #CFCFD3   #FDFDFD    10.19    10.19     0.00  FAIL
```

Deltas are CIEDE2000. Android-vs-ios is the **primary** axis (tolerance `tolerance_de`, default
8); each platform vs the contract hex runs at 1.5× that — deliberately looser, because the app
background is a gradient and translucent fills composite differently per y-position, so both
devices drift off the contract hex together while staying close to each other. The calibration
point is the real 2026-08-13 bug (`base.color4` grey vs `base.color1` white = dE00 10.19): over
the primary axis, **under** the default contract axis — so a single-platform run at defaults
misses it, and the output then suggests `tolerance_de: 6`. Hex only in contracts at this level;
token names (`base.color1`) are skipped with a note — resolve them to hex in the layer that owns
the token definitions. Anchors without `bg` are color-compared platform-to-platform only. The
single-element form is a `color` assert: `{"element":{"id":"card"},"color":{"expected":"#FDFDFD",
"deltaE":8,"sample":"dominant"}}` — compared directly against `deltaE` (no 1.5× slack: the
caller chose the hex), so the default catches the 10.19 bug. Thin 1–2 px strokes are invisible
to region sampling — borders stay with the screenshot judge.

The `color` and `ocr` asserts poll for up to 12 s by default (`timeout` per spec; tree asserts
3 s). Each round measures only a frame whose ELEMENT region held still across two captures 300 ms
apart (falling back to the whole screen when the region cannot be checked), so "the screen did
not settle" usually means the element's own region kept changing — a spinner or fade inside it.
A round whose element is overlapped by the soft keyboard (Android: the window state's band and,
since 2026-10-08, a floating keyboard's panel read from the keyboard window's touchable region;
iOS under `treeSource: wda`: the tree's keyboard band) is a fail-closed miss that names both rects and
captures nothing; the poll keeps going, so a keyboard that hides before the deadline costs a
round, not the verdict.

Screen width per platform is the WINDOW's width, read from the whole tree (the id-less
root/window node), and the device screen witnesses it. Both the `rect` assert and the rect
table **fail closed** on a width that cannot be trusted — they print no deltas and no verdict:

- **a content width** — the widest rect starts inset, so every delta would be scaled wrong
  (until 2026-10-07 this was only a warning, and a real -4.2 % defect could read WITHIN
  TOLERANCE under it). On iOS this typically means the default idb tree source surfaced no real
  window rect (width came from the widest accessibility element): set `app.ios.treeSource: wda`
  in `averi.yaml`, whose tree carries a real window rect. On Android it is usually the app's own
  window letterboxed or freeform (a fixed-orientation or non-resizable app on a large screen),
  which starts inset by design — measure it full-screen. Otherwise the tree was filtered before
  it reached the comparator.
- **a 0-wide tree** (idb's 0×0 synthetic root when elements carry no frames).
- **a window wider than the device screen side it faces** — a portrait window rect against the
  short side, a landscape one against the long side, a width with no window rect against the
  longer side — a node that is not the window was counted as it. Before refusing, averi reads
  the device screen once more (the size is otherwise read once and kept), so a screen changed
  since the first read — `wm size`, an unfold — is judged as it is now; the refusal says the
  screen was read again, or that the re-read failed.

An Android app window in landscape beside a 3-button navigation bar or a display cutout starts
inset, or ends short of the screen, by the bar's width. With the device screen as witness it is
measured — at its own width, with `x` measured from its left edge — and not refused as a
content width or noted as a split view. The rule is narrow: landscape-shaped, the full short
side tall, each gap at most 10 % of the long side, Android only (an iOS app window is the
screen; an inset rect there is content).

A window NARROWER than the device screen is still measured (a split view's canvas is what the
Figma frame describes) with a `! <platform>: window … DEVICE screen` line; a leg whose device
screen could not be read says the width is the tree's alone. A refused width fails the WHOLE
rect table (`FAILED: rect parity: <platform>: …`), not just that platform's rows.

## Text and type-size parity

Same contract file (live-validated on device 2026-08-14): anchors may carry `text` — the exact
string the anchor renders — or `text_dynamic: true` for amounts, balances and dates, whose
locale formatting differs legitimately (`1,121.00` vs `1 121,00`). When any anchor opts in,
`verify` reads the copy back off the same screenshots with the macOS Vision recognizer and
appends a `## text parity` table:

```json
{ "id": "payment.form.amount_input", "text": "Enter amount" }
```

```
anchor                       src   android   ios             contract      Δsize  verdict
payment.form.amount_input    ocr   0.00      Enter amount    Enter amount      —  FAIL
payment.form.continue_button ocr   CONTINUE  CONTINUE        CONTINUE      0.74%  OK
```

Why OCR rather than the tree: **the accessibility tree does not record rendered copy.** On iOS
SwiftUI collapses a card or button into one element carrying an authored a11y label — measured
on the payment form, `credit_select` exposes `'To account'` while the screen reads `'Select
credit account'`, and the visible `CONTINUE` is missing from the tree entirely. Tree-only
comparison covered 2 of 7 anchors there. The tree remains the fallback when the recognizer
cannot run (macOS-only); the `src` column names the source per row, and the two are never mixed
across platforms.

The same read yields the **type-size** check: Vision returns a bounding box per string, i.e. the
rendered ink height, compared android-vs-ios in % of screen width at `tolerance_size_pct`
(default 10) and only where both strings match. Calibration: a matching `CONTINUE` reads 0.74%
apart, the real 22sp-vs-17pt title drift 12.63%. `text_dynamic` anchors are never size-checked.

Two kinds of row are withheld from findings, because comparing them would dispatch a phantom: an
anchor whose tree copy vanished from the reading (something covers its rect — usually the IME —
or the text sits at a contrast the recognizer cannot resolve, which would be a real defect; the
output says the cause is undetermined), and an anchor whose source yields no string at all. Both
still fail the run. Single-element form:
`{"element":{"id":"cta"},"ocr":{"text":"CONTINUE","heightPct":2.96}}`.

## Standing lab run

The harness's own net on the Android lab emulator, in one command:

```
npm run truth:lab -- --out <dir outside the checkout> --serial emulator-5554 [--groups chooser|forms|visibility|…]
```

`scripts/truth/batch/lab-run.ts` checks that the emulator is the `averi_lab` AVD, then builds the lab app from the
checkout and installs it. It runs the live golden's `chooser` group (launch_app and open_deep_link around Android's
"Open with" chooser) between a read-only `--check` of the lab's defaults before and a cleanup check after, then the
live golden's other Android groups, `forms`, `visibility`, `ensure` and `carousel`, each its own block with its own
verdict (backlog A22). Every group runs by default; `--groups` names some of them, comma-joined. Each live run is
bounded: `B_LIVE`, 1800 s by default, and the visibility group by its own 3000 s (its 181 cases ran past 1800 s,
backlog A34); `B_LIVE` given bounds every group alike. It refuses to start
with no serial, and the lab guard refuses any emulator that is not the lab AVD before anything is built.

The Android build runs under JDK 17, looked up in this order: JAVA_HOME, then `/usr/libexec/java_home -v 17`, then
the first `*.jdk` in `/Library/Java/JavaVirtualMachines` and then in `~/Library/Java/JavaVirtualMachines`. A home
counts when its `release` file says 17 and it has `bin/javac`. The SUMMARY's `LAB android:` line names it: `this run's
build installed under JDK 17: <home> (from JAVA_HOME | java_home | JavaVirtualMachines)`. When an earlier source was
passed over (JAVA_HOME set but not a JDK 17, or `java_home` finding none, as inside the agent's sandbox), that line is
a WARN that starts with what each passed-over source said and `— the build used the one from <source>`. The lab check
still passes and the exit code is unchanged. When no JDK 17 is found, nothing is built: the lab check WARNs with the
build's reason, which lists every source and what it gave, and the run ends unproven (exit 3).

It runs as Gate B of every release ([docs/release.md](release.md)), on `emulator-5554`, by the agent preparing the
release (the owner's decision, backlog T24) or by the owner. A chooser run that leaves a lab default behind fails the
run by name, and the cleanup clears that default by uninstalling and reinstalling the lab app. Everything it writes
goes under `--out`, apart from the git-ignored Gradle build products in the checkout: a `<block>/run-<id>` folder per
block, holding the live records, logs and rejudge summaries (each with its failure reasons beside it as JSON,
`<run>.rejudge.json`, which a live block's FAIL names; one missing or unreadable makes the block INCONCLUSIVE), and
`meta/run-<id>/summary.txt`, the SUMMARY.

Its iOS counterpart, `npm run truth:lab:ios -- --out <dir> --udid <lab simulator>` (lab-run-ios.ts, Gate C, the
owner's), runs live.ts's iOS groups on the lab simulator: every idb run first, then every WebDriverAgent run in its own
D43 settings window, with the same exit codes.

For a batch author: `runBatch` (scripts/truth/batch/runner.ts) returns the run's result, its `exit` among it, and
leaves the process's exit to the batch. End the batch with `process.exit(result.exit)` right after it; a batch that
forgets still ends with the run's code, which runBatch sets as `process.exitCode`.

The exit code is stricter than a device batch's, so a release can gate on it (only 0 passes):

| Code | Meaning |
| --- | --- |
| 0 | every selected block PASSed, and no line is INCONCLUSIVE or ERROR |
| 1 | a FAIL, or state left to put back by hand (`RESTORE.txt`) |
| 2 | refused (a selection with no live group too, such as `ONLY=lab`), or nothing ran |
| 3 | unproven: a build that failed, a live run past its bound, a check that could not prove the lab clean |
| 130 | interrupted |

It is not scheduled: it is a release gate (docs/release.md, backlog T24, which replaced the schedule T20c). ADR 0041's
T20b and T24 amendments have the details.
