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
   clock included, is still changing; delete the file to re-baseline).
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
  BARE tree (only wrappers and unlabeled decoration — a cold launch's decor or splash) absence is
  undecided, never satisfied: the assert fails `could not verify …`, `wait:`/`branch:` keep
  polling, and a state `detect:` reads it as unknown.
- **`fill`** clears opt-in only: typing APPENDS on both platforms, but dev flavors may pre-fill
  login fields that must survive. Fills are verified against a fresh accessibility tree when the
  field exposes its text — a clear-fill that lands wrong is wiped and retyped once; a no-clear
  fill never destroys existing content (it fails loudly instead). Android types one character per
  `input text` call: bulk injection races Compose's async state and drops most characters
  (measured 3 of 11 landing).
- **Field errors**: on iOS `ui_snapshot` attaches `error` to an input from a same-identifier text
  below the field (the SwiftUI convention when titles/errors share the field's
  `accessibilityIdentifier`); assert with `{ element: { id: amount_input }, error: "Required" }`.
  Android sets no `error`, so there assert the message's `text` instead.
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
A round whose element is overlapped by the soft keyboard (Android: the window state; iOS under
`treeSource: wda`: the tree's keyboard band) is a fail-closed miss that names both rects and
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
