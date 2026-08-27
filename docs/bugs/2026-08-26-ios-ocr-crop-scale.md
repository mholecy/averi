# BUG: iOS `ocr` element asserts crop the wrong screen region (WDA tree, modal sheet open)

**Measured 2026-08-26** in `/Users/mholecy/Finshape/skeleton` (config `averi.yaml`,
`app.ios.treeSource: wda`, iPhone 17 simulator, app DBOSBanking/Internal, screen 393×852 pt).
Filed by the parity-hardening session; a task chip pointing here exists in Claude Code.

## Observed

With the transaction advance-filter **modal sheet** open (`ensure_state transaction_filter`):

```json
[{"element":{"id":"transactions.filter.apply_button"},"ocr":{"text":"APPLY"}},
 {"element":{"id":"transactions.filter.clear_button"},"ocr":{"text":"CLEAR FILTER"}}]
```

- Tree rects are correct and in **points**: `clear_button` `{x:18, y:791, w:178, h:45}`,
  `apply_button` `{x:208, y:791, w:176, h:44}` — visually exactly where the buttons render
  (bottom of the sheet, ~93 % of screen height).
- OCR read back `"Magnetic"` and `"agnetic Arun"` — the **"Magnetic Áruház" transaction-list row**
  that sits at ~40–45 % of screen height, *behind* the sheet.
- Stable across retries (not an animation race: re-asserted after the sheet settled, same reads).
- The same OCR asserts **PASS on Android** in the same run. Tree `text` asserts on the same iOS
  elements PASS. `rect` asserts are unaffected.

## Where the crop is computed

- `src/verify/assert.ts` → `assertOcr()` (~line 364) calls
- `src/verify/text-parity.ts` → `ocrRegionForRect()` (~line 259):
  `scale = pngWidth / inferScreenWidth(tree).width`, then `rect * scale`.
- `inferScreenWidth` lives in `src/ui-tree/geometry.ts`.

## Analysis (unverified hypothesis — instrument before fixing)

The crop landed at ~40 % height instead of ~93 %, i.e. the effective scale was ~1.0–1.3 where a
3× (or png/393) scale was expected. Since the rects themselves are right, the suspect is the
**scale derivation** on this tree: `inferScreenWidth(tree)` returning a too-large width — e.g. the
widest-rect heuristic picking up a pixel-sized or otherwise oversized node in the WDA tree while a
modal sheet is presented (extra windows/overlays in the hierarchy), or the WDA root window rect
being absent/odd with a sheet up. Note `ocrRegionForRect` ignores the `reliable` flag that
`inferScreenWidth` returns (color-parity reads it; text-parity does not) — if the width was flagged
unreliable here, the assert silently used it anyway.

## Repro

1. Boot iPhone 17 sim; `scripts/build-for-averi.sh ios` + `install_app ios` in the skeleton superrepo.
2. `ensure_state("transaction_filter", ios)` (⚠️ a cold login burns a real device registration —
   reuse a live session if one exists).
3. Run the two OCR asserts above; dump `inferScreenWidth(tree)` and the computed `OcrRegion`
   alongside `png.width/height`.

## Expected fix shape

Derive the scale from a trustworthy source (WDA window/screen size, or screenshot-vs-`simctl`
device metrics) rather than the widest-rect heuristic when a modal window is present; at minimum,
honor `reliable === false` by failing closed with a reason (the file's own contract: "the caller
must then report why, never silently pass"). Add a regression test with a tree containing a modal
window + an oversized node on a non-1× device.

---

## Verification (2026-08-26, code review + synthetic repro — no device)

**Mechanism confirmed, on-device root cause still unproven.** Reproduced the exact symptom
from a synthetic tree: iPhone-class window 402×874 pt, screenshot 1206×2622, `apply_button`
at `{x:208, y:791, w:176, h:44}`.

| tree | `inferScreenWidth` | crop y | % of height |
| --- | --- | --- | --- |
| clean | `{402, reliable: true}` | 2373 | **90.5 %** |
| + off-viewport sibling at `{x:402, w:402}` | `{804, reliable: false}` | 1187 | **45.3 %** |
| + oversized node at `{x:0, w:804}` | `{804, reliable: true}` | 1187 | **45.3 %** |

45.3 % matches the reported "~40–45 %". The derived scale was 1.5 — comfortably inside
color-parity's existing `[0.5, 4.0]` sanity range, which is why nothing flagged it.

Corrections to the analysis above:

- **"`rect` asserts are unaffected" contradicts the hypothesis.** `evaluateRectAssert`
  normalizes by the same width (`norm = value/width*100`), so a doubled width turns
  `apply_button` x into 25.9 % against a contract's ~52.9 % → Δ−27 % → hard FAIL. If a rect
  assert really did run on these ids with the sheet up and passed, the width was NOT wrong
  and the cause is elsewhere. **Run that assert first — it is the cheapest discriminator.**
- **"Honor `reliable`" was not sufficient on its own.** Case 3 above breaks identically with
  `reliable === true`; the flag only sees a widest rect that starts *inset*.
- **`reliable` was nowhere a failure.** It was a display note in color-parity (`:547`, `:691`)
  and rect-parity (`:401`, `:554`) — no comparator failed on it.
- **Blast radius was wider than filed.** `assertColor` and the whole-screen color/text tables
  derive the scale identically and were broken the same way.

## Fix (shipped)

- `ui-tree/geometry.ts`: `inferScreenSize()` takes the **root rect** when it is a real
  origin-anchored window (WDA `Application`, uiautomator hierarchy root), falling back to the
  widest-rect walk only for the sources that have no usable root (idb's synthetic 0×0 root,
  uiautomator multi-root dumps). `inferScreenWidth()` is now a thin wrapper, so all five call
  sites get the fix.
- New `src/verify/scale.ts` owns `pngScale(tree, pngW, pngH)` — the single derivation of the
  points→pixels scale. It lives in `verify/` rather than beside `inferScreenSize`: geometry
  answers "how big is the screen", verify decides whether to trust that answer, and
  `ui-tree/geometry.ts` states in its own header that it knows nothing about tolerances.
  It fails closed on degenerate inputs, a 0-wide tree, a content width (`reliable === false`),
  and a **one-sided axis check** at a 1.5x ratio.
- `ocrRegionForRect` returns a discriminated `{region} | {error}` so the assert quotes the real
  reason; `ocrRegionsFor` throws, because an empty list reads as "no text anchors" and would
  drop the whole table (contained by `run/verify.ts` as a per-platform note).
  `evaluateColorAssert` and `statsFor` route through `pngScale` too.
- Regression cover: `tests/verify/scale.test.ts` and `tests/ui-tree/geometry.test.ts`.

### Why the axis check is blunt

An earlier draft used a 2 % tolerance. Review found that would hard-fail captures the OLD code
handled correctly: `parseUiautomatorXml` returns a single-window dump's root directly, and a
non-edge-to-edge Android window excludes the status and navigation bars — a 1080x2274 window
against a 1080x2400 `screencap` disagrees by 5.5 %, a gesture bar alone by 1.9 %. The threshold
is now set by the gap between system chrome (≤ ~20 %) and an off-viewport node counted as the
screen (~100 %), not by rounding.

### Known holes, deliberately left open

1. **Rootless trees keep the bug.** The axis check needs a height it can trust, which only the
   root rect gives — a walked height is inflated by scroll content. idb's flat `describe-all`
   (synthetic 0x0 root) and uiautomator multi-root dumps therefore get the width check only, so
   case 3 of the table above still poisons the scale there silently. Pinned by a test.
2. **The check is one-sided.** A window NARROWER than the capture (iPad split view, Android
   freeform) reads as a too-large scale and passes. Also pinned.
3. **Split-screen fails closed.** A half-height window trips the 1.5x ratio. Out of scope for a
   tool that drives one full-screen app, and it fails loudly with both readings named.

Shutting 1 and 2 needs a screen size from OUTSIDE the tree — `simctl` device metrics, WDA
`/window/size`, `wm size` — which is what "Expected fix shape" above actually asks for. That is
the follow-up; this change is not it.

**Still open:** on-device confirmation. The fix removes the failure class for root-bearing trees
(WDA, single-root uiautomator), but nobody has yet dumped the real WDA tree with the sheet up,
so which node inflated the width is still unknown.

## On-device confirmation (2026-08-26, later the same day) — the inflating node is named

Dumped the real WDA tree with the filter sheet up (iPhone 17, 402×874 pt). The "Still open" question
is answered:

- The width inflators are **two `PopoverDismissRegion` nodes** with rect
  `{x: -402, y: -874, w: 1206, h: 2622}` — a **pixel-scale rect inside an otherwise point-scale
  tree** (1206 = 3×402, 2622 = 3×874), origin off-screen. The widest-rect walk reads their extent as
  x∈[-402, 804] → inferred width 804 with an inset start → `reliable: false`.
- The origin-anchored Application window IS in the tree — node label "Skeleton Internal",
  `{0, 0, 402, 874}` — but as a **child of the normalizer's synthetic 0×0 root**, so the fix's
  root-rect leg does not see it and falls through to the walk.
- 0.5.0 behaves as designed on this tree: the OCR assert now **fails closed** with
  "screen width 804 is a CONTENT width, not the window width" instead of silently reading the band at
  ~45 % height. Confirmed live, both filter buttons.

Follow-ups this suggests, cheapest first: (1) when the root is the synthetic 0×0 container, take an
origin-anchored full-screen CHILD (the WDA `Application` node) as the window rect; (2) exclude
overlay hit-regions with off-screen origins (`PopoverDismissRegion`) from the widest-rect walk;
(3) the durable fix stays the out-of-tree screen size (`simctl` metrics / WDA `/window/size`).
Until one lands, OCR asserts on iOS sheet screens fail closed — use tree `text` asserts there
(labels carry the rendered casing).

## Known holes 1 and 2: closed (2026-08-27)

The follow-up shipped — see `docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md`.
The scale now comes from `DeviceAdapter.viewport()` (the `simctl`/`idb`/`wm size` reading this
section asked for), with the tree as a cross-check, so both holes above are shut whenever the
device answers; a rootless tree that must still be trusted alone now fails closed rather than
scaling silently. **The interim advice — "OCR asserts on iOS sheet screens fail closed, use tree
`text` asserts there" — no longer applies.**

## CLOSED (2026-08-27, averi 0.6.0)

The out-of-tree screen size landed in 0.6.0 and the acceptance run PASSED on device — the exact
asserts that read "Magnetic" pre-0.5.0 and failed closed on 0.5.0 now read the rendered strings on
both platforms. Evidence and traces in
`2026-08-26-png-scale-needs-out-of-tree-screen-size.md` §"Acceptance run".
