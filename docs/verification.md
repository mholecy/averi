# Verification in depth

Reference for averi's verification features: assert semantics, forms, and layout contracts
(geometry, color, and text checked with numbers). For the day-to-day workflow see
[skill/SKILL.md](../skill/SKILL.md); for the architecture see
[ARCHITECTURE.md](../ARCHITECTURE.md).

Verification is tiered, cheapest first:

1. **Element asserts** — deterministic checks against the normalized accessibility tree.
2. **Screenshots** — for the agent's own visual judgment.
3. **Pixel-diff** against stored baselines (auto-created under `.averi/baselines/` on first use;
   delete one to re-baseline).
4. **Numbers, never impressions, for geometry and fills**: `rect` asserts against Figma-frame
   values, `color` asserts against an expected hex (CIEDE2000), `ocr` asserts reading back the
   text an element actually renders, and `verify` with a layout contract printing per-anchor
   geometry, color and text/type-size tables.

Every flow response reports `appAlive` with a crash-log excerpt if the app died.

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
  a raw tree check would pass on one platform and fail on the other for the same screen.
- **`fill`** clears opt-in only: typing APPENDS on both platforms, but dev flavors may pre-fill
  login fields that must survive. Fills are verified against a fresh accessibility tree when the
  field exposes its text — a clear-fill that lands wrong is wiped and retyped once; a no-clear
  fill never destroys existing content (it fails loudly instead). Android types one character per
  `input text` call: bulk injection races Compose's async state and drops most characters
  (measured 3 of 11 landing).
- **Field errors**: `ui_snapshot` attaches `error` to an input when the platform exposes the
  association (iOS: a same-identifier text below the field — the SwiftUI convention when
  titles/errors share the field's `accessibilityIdentifier`); assert with
  `{ element: { id: amount_input }, error: "Required" }`.
- **Tap disambiguation**: when a selector matches several nodes and exactly one is interactive
  (button/textfield/switch/…), `tap`/`fill` target that one and say so in the trace. Several
  interactive matches stay an error.

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
  spread, and MISSING anchors listed separately with their likely causes.

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

Screen width per platform is inferred from the widest rect in the whole tree (the id-less
root/window node). **Reliability caveat:** when the widest rect starts inset, the inferred width
is a content width and every delta is scaled wrong — the output says so explicitly. On iOS this
typically means the default idb tree source surfaced no real window rect (width came from the
widest accessibility element): set `app.ios.treeSource: wda` in `averi.yaml`, whose tree carries
a real window rect. Otherwise the tree was filtered before it reached the comparator.

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
