# Plan: take the screen size from OUTSIDE the tree

**Fixes** `docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md`
(follow-up to `docs/bugs/2026-08-26-ios-ocr-crop-scale.md`, shipped in 0.5.0).
**Status:** IMPLEMENTED 2026-08-27 (phases 1–4), reviewed and corrected twice the same day
(§10, §11),
device acceptance still owed. Phase 5 was
examined and deliberately dropped — see the note at the end of §3.4. The plan is kept as written,
with a §9 recording where the build diverged from it.

---

## 1. Verification of the bug report

Reproduced against 0.5.0 code with the dump shape the report describes (rect-less root →
origin-anchored `Application` child `{0,0,402,874}` → two overlays at `{-402,-874,1206,2622}`,
png 1206×2622):

```
root rect      : { x: 0, y: 0, width: 0, height: 0 }
inferScreenSize: { width: 804, height: 1748, reliable: false, trustworthyHeight: false }
pngScale       : error: 'screen width 804 is a CONTENT width, not the window width …'
control (root carrying the app rect): { scale: 3, width: 402 }
```

The error string is **verbatim** what the device run reported. The report is accurate on
everything that matters:

- OCR (and same-scale color sampling) is genuinely unusable on iOS sheet screens today —
  it fails closed, by design, in `src/verify/scale.ts:76`.
- The overlays inflate the walk to 804 and their negative origin sets `reliable: false`.
- The origin-anchored window rect IS in the tree, one level below the root, and
  `inferScreenSize` (`src/ui-tree/geometry.ts:56`) never looks there.

Two corrections, both of which change the fix, not the diagnosis:

1. **The 0×0 root is not "the normalizer's synthetic root" on the WDA path.**
   `parseWdaSourceValue` returns WDA's root as-is (`src/adapters/wda-source.ts:61`); the
   committed fixtures root at `Application {0,0,402,874}`. The zeros come from
   `toUiNode`'s missing-`rect` fallback (`wda-source.ts:97`): the live payload's root node
   carried no usable `rect`, so we zero-filled it and the root-rect leg disqualified it.
   The synthetic-root wording describes idb (`adapters/ios.ts:277`) and uiautomator
   multi-root dumps. Practical consequence: fix (1) below must handle *a root with no
   usable rect*, whatever produced it — and we should stop conflating "no rect" with
   "a 0×0 rect at the origin".
2. **Fix (2) as worded — "exclude `PopoverDismissRegion` and kin" — is not implementable
   as written.** `UiNode` has no `type`; WDA types are mapped to a coarse `role` and
   `PopoverDismissRegion` lands in `other` (`wda-source.ts:86`). The usable signal is
   geometric, not nominal: **a rect whose origin is negative is not layout.** That rule
   also covers the Android/idb equivalents we have never named.

Not verified (needs the device, see §6): that the same live tree yields scale 3.0 end to end
after the fix, and that `idb describe` reports the screen in the same points the WDA tree uses
on a sheet screen. Everything in §1 above is from code and a synthetic repro only.

---

## 2. The out-of-tree size already exists

`DeviceAdapter.viewport()` is exactly the source the report asks for, already implemented,
already cached per adapter, already in the same units as the tree rects:

| platform | source | units | code |
| --- | --- | --- | --- |
| iOS | `idb describe --json` → `screen_dimensions.{width,height}_points` | points (matches WDA *and* idb rects) | `src/adapters/ios.ts:189` |
| Android | `wm size` (Override beats Physical) | device pixels (matches uiautomator bounds and `screencap`) | `src/adapters/android.ts:133` |

So this is **plumbing, not new I/O**: `viewport()` memoizes per adapter, and `assertAbsent`
already pays for it on some runs.

The conceptual win is bigger than closing the two known holes. The scale we actually want is
**png ↔ screen**, not png ↔ window: the screenshot is a full-screen capture and the rects are
absolute screen coordinates. Deriving from the device screen makes a window narrower or
shorter than the capture (hole 2, split view, system-bar insets) a non-issue by construction
rather than by tolerance.

---

## 3. Design

### 3.1 Trust order in `pngScale`

```ts
export interface DeviceScreen { width: number; height: number }
export function pngScale(
  tree: UiNode, pngWidth: number, pngHeight: number, screen?: DeviceScreen,
): PngScale
```

1. **Device screen, when supplied and sane** (finite, > 0). Orientation-correct first: if the
   png is landscape and `screen` portrait (or vice versa), swap `width`/`height` — `simctl`
   and `wm size` report the unrotated panel. Then `scale = pngWidth / screen.width`, and
   cross-check `pngHeight / screen.height` against it with `MAX_AXIS_SCALE_RATIO`, **both
   directions** (with a device size, a real disagreement means the wrong device or a stale
   capture, not system chrome). Returned `width` is the screen width — it feeds
   `ColorPlatformStats.rootWidth`, which becomes honest rather than "root width".
2. **Root rect**, as today, plus the new one-level-down leg (§3.3).
3. **Widest-rect walk**, as today, with negative-origin hygiene (§3.3).

Only when all three fail does it fail closed, with today's wording. The tree stays a
**cross-check**: when the tree's own inference disagrees with the device size by more than
~2 %, attach a note (not a failure) naming both numbers. That note is the only way a genuinely
non-full-screen window (iPad split view) stays visible after this change.

A device-screen read that *throws* must degrade to `undefined`, never take down an assert:
the tree path is exactly today's behavior, so the fallback is already tested.

### 3.2 Plumbing (`screen` threaded from adapter to scale)

| file | change |
| --- | --- |
| `src/verify/scale.ts` | signature + trust order above; rewrite the "TWO KNOWN HOLES" header — with a device size both are shut, without one they stand |
| `src/verify/text-parity.ts:236,268` | `ocrRegionsFor(contract, tree, pngW, pngH, screen?)`, `ocrRegionForRect(id, rect, tree, pngW, pngH, screen?)` — pass through only |
| `src/verify/color-parity.ts:232,309,641` | `ColorCapture` gains `screen?: DeviceScreen`; `statsFor` passes it; `evaluateColorAssert(rect, expectation, tree, png, screen?)` |
| `src/verify/assert.ts:364,411` | `Verifier` gains a memoized `private screen(): Promise<DeviceScreen \| undefined>` wrapping `this.adapter.viewport()` with `.catch(() => undefined)`; `assertOcr`/`assertColor` await it. `assertAbsent:473` should read through the same memo so a run pays once |
| `src/run/verify.ts:141,265,314` | `VerificationLeg` gains `viewport?: {width,height}` read fail-soft inside `runOne` (next to `appHealth`); `captureOf` attaches it to the `ColorCapture`; `runOcr` passes it to `ocrRegionsFor`. When it is missing, add one note in the same voice as `noTreeNote` — a table scaled off the tree must say so |

`verify/` keeps importing no adapter: it receives a `{width, height}` value, same as
`intersectsViewport` does today. Layering per ARCHITECTURE §3 is unchanged.

### 3.3 Tree-side hardening (still needed — it is the fallback)

Both live in `src/ui-tree/geometry.ts:56` and matter whenever `viewport()` is unavailable
(no idb, adb hiccup, unit tests, future tree sources):

- **Root leg, one level down.** When the root has no usable rect (`width <= 0 || height <= 0`)
  and **exactly one** child is origin-anchored with a positive size, take that child as the
  window (`trustworthyHeight: true`). The single-candidate guard is what keeps idb's flat list
  out: its synthetic root has many origin-anchored children and no way to pick — that pinned
  hole (`tests/verify/scale.test.ts:105`) must keep failing over to the walk.
- **Walk hygiene by geometry, not by type.** Skip nodes with a negative origin
  (`rect.x < 0 || rect.y < 0`) when computing the widest/tallest extent — hit-test scrims,
  not layout. Applied alone this already turns the reported dump into width 402, scale 3.
  Keep them in the tree for every other consumer (selectors, `absent`) — this is a
  geometry-walk rule only.

### 3.4 Out of scope for this change (call it explicitly)

`rect-parity.ts:293,526` normalizes by `inferScreenWidth` and has the same trust problem —
an inflated width skews every `%` delta silently (the earlier bug doc's own "cheapest
discriminator" argument). It is the same fix shape (`compareRectParity(contract, trees, opts)`
gaining per-platform widths; `evaluateRectAssert(rect, expected, tree, screen?)`) but a
different table, different tests and no acceptance case in this report. **Phase 5 below,
optional; ship phases 1–4 without it if the device window is short.**

---

## 4. Phases

1. **Geometry fallback** — root-leg-one-level-down + negative-origin walk hygiene, with the
   real dump shape as a fixture. Self-contained; makes the reported case pass *without any
   plumbing*, so it is the cheapest thing that unblocks iOS sheet OCR.
2. **`pngScale(… , screen?)`** — trust order, orientation swap, cross-check note. Pure, fully
   unit-testable.
3. **Plumbing** — `assert.ts` memo + `text-parity`/`color-parity` pass-through
   (single-element `ocr`/`color` asserts, the acceptance path).
4. **`run/verify.ts`** — leg viewport, color captures, whole-screen OCR, missing-size note.
5. *(optional)* rect parity, per §3.4.

Phases 1 and 2 are independent; 3 depends on 2; 4 depends on 3.

---

## 5. Tests

New fixture `tests/fixtures/wda-source-filter-sheet.json` — the real dump shape:
rect-less root → `Application "Skeleton Internal" {0,0,402,874}` → the two
`PopoverDismissRegion` overlays `{-402,-874,1206,2622}` → the two filter buttons at their
measured rects (`apply_button {208,791,176,44}`, `clear_button {18,791,178,45}`).

- `tests/ui-tree/geometry.test.ts` — the fixture yields `{width: 402, height: 874,
  reliable: true, trustworthyHeight: true}`; a rect-less root with *two* plausible children
  still falls through to the walk; negative-origin nodes do not move width or height.
- `tests/verify/scale.test.ts` — with the device screen: 3.0 on the fixture; 3.0 even when
  the tree is hopeless (0-wide, filtered); orientation swap (portrait `screen`, landscape
  png); disagreement note when tree and device differ > 2 %; axis mismatch fails closed both
  directions; `screen: undefined` reproduces every existing assertion in the file unchanged.
  **Update the two "holes, pinned" cases**: they keep their tree-only behavior and gain a
  device-size sibling showing the hole is shut when the size is available.
- `tests/verify/assert.test.ts` — `ocr`/`color` asserts scale off the fake adapter's
  `viewportSize` (`tests/helpers/fake.ts:89`); a `viewport()` that throws still produces
  today's tree-derived verdict (no throw, no silent pass); the viewport is read **once**
  across a multi-assert run (the counting seam at `assert.test.ts:702` is the model).
- `tests/run/verify.test.ts` — a leg whose viewport read fails still renders both tables and
  carries the note; the color stats' `rootWidth` is the device width when available.
- `npm run lint` (both tsconfigs) — the signature changes ripple through five call sites.

---

## 6. Acceptance (device, cannot be faked)

From the skeleton superrepo, iPhone 17 sim, `app.ios.treeSource: wda`, a live session
(`ensure_state("transaction_filter")` — a cold login burns a real device registration):

```json
[{"element":{"id":"transactions.filter.apply_button"},"ocr":{"text":"APPLY"}},
 {"element":{"id":"transactions.filter.clear_button"},"ocr":{"text":"CLEAR FILTER"}}]
```

Both must PASS, and the reported scale must be 3.000. Also worth capturing in the same
session, since it is free once the sheet is up:

- the same two asserts with `color`, to confirm the shared scale;
- a `verify` run with the transactions contract, to see the text/color tables on a sheet screen;
- **the raw `/source` payload of the sheet, saved as the fixture** — §1 corrections mean the
  committed fixture is currently my reconstruction, not the device's bytes.

Android must be re-run once as a no-regression check (`wm size` path, 1× scale).

---

## 7. Risks

- **`idb describe` reports something other than the WDA point frame** (rotation, a
  non-native-resolution sim). Mitigated by the orientation swap and by the cross-check note;
  if the device round shows a systematic mismatch, keep the tree as leg 1 on iOS and demote
  the device size to the cross-check — the trust order is one `if`.
- **`viewport()` cost on a cold adapter** — one `idb describe` / `wm size` per run, memoized.
  Negligible next to a screenshot.
- **Behavior change for callers that today fail closed.** Runs that reported "CONTENT width"
  will start producing numbers. That is the point, but it means the first device round should
  spot-check a *passing* scale against a known-good screen (login), not only the sheet.
- **In-flight work:** `src/flow/engine.ts` and `tests/flow/engine.test.ts` are dirty on `main`
  (the recovery-pass bug). No overlap with these files — but land or stash that first so the
  release commit for this fix is readable.

---

## 8. Doc updates that ship with the fix

- `docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md` — a "Fix (shipped)"
  section, plus the two §1 corrections (the root is WDA's own rect-less node; the overlay
  rule is geometric because `type` does not survive normalization).
- `docs/bugs/2026-08-26-ios-ocr-crop-scale.md` — mark Known holes 1 and 2 closed *when a
  device size is available*, and drop the "use tree `text` asserts on iOS sheets" interim
  advice.
- `skill/SKILL.md:30,34` — the CONTENT-width warning stays (it is still reachable), but the
  iOS-sheet caveat goes.
- `src/verify/scale.ts` header — it currently states the holes as open and names this very
  report as "the fix this is not". That paragraph is the deliverable.

---

## 9. What the implementation changed about this plan

- **§3.1's orientation swap needed a second witness.** Swapping on the png aspect alone breaks
  every band-shaped capture — the package's own test fixtures are wide and short, and one of them
  scaled by the screen's HEIGHT before this was caught. The shipped rule swaps only when the png
  disagrees with the device AND the tree sides with the png. The tree is a sound witness of
  orientation even when it is a bad one of size: the sheet dump reads 804×1748 — inflated, still
  unambiguously portrait.
- **§3.1's two-sided axis check went back to one-sided.** Same reason, stated in the file: a png
  shorter than the screen is a band capture, which clamping already makes safe. Against the
  device, what is left to catch is a capture from another device or from before a rotation.
- **§3.3's "exactly one origin-anchored child" became "the widest".** The single-candidate guard
  was there to keep idb's flat list out; picking the widest is better, because a too-large
  candidate then reaches the axis check and FAILS CLOSED. That flips hole 1 from silently halving
  the scale to refusing to scale — a pinned test changed accordingly.
- **§3.4's rect parity was examined and dropped, not deferred.** Its denominator is not the same
  quantity: `% of screen width` is compared against a Figma FRAME — the app's canvas, which under
  split view is the window, not the device screen. Using the device size there would change what
  the deltas mean on a guess. The crop scale wants the screen; the normalization wants the canvas.
- **The color table grew a second note.** Beyond the tree/device disagreement note this plan
  named, `ColorPlatformStats.note` also says when a leg had no device size at all — otherwise a
  table that quietly took the old path looks exactly like one that did not.

---

## 10. Review round

Two independent reviews (code, architecture) ran against the first implementation. Both found the
same class of defect — the tree-side hardening had opened a new silent-wrong-scale path — from
different directions, and both were confirmed by execution before anything was changed. The
corrections are recorded in the bug doc's "Review round" section; the design consequences worth
carrying forward are:

- **A heuristic that promotes a node to "the window" needs a cross-check against the rest of the
  tree, not just a tie-break rule.** §3.3 specified the tie-break and not the cross-check, and
  §9's argument for widest-wins ("a too-large candidate reaches the axis check") covered
  candidates that are too large while missing ones that are too SMALL with a screen-like aspect.
- **Do not let the tree vote on orientation.** §3.1's swap rule was built to protect band-shaped
  captures and reached for the tree as a second witness; the tree's orientation is derived from
  the one quantity this file elsewhere calls untrustworthy. Axis agreement needs no witness and
  covers both cases.
- **One fact, one channel.** The disagreement note existed in three surfaces with two policies,
  and the comment describing the arrangement was factually wrong. Threading it out of
  `ocrRegionsFor` cost four lines and removed the asymmetry.

---

## 11. Second review round

The round-2 corrections were themselves reviewed, and the headline fix — a containment guard on
the window candidate — reopened the hole round 1 closed. Details in the bug doc; the lesson worth
keeping is narrower than "review your fixes":

**A guard that can only REFUSE must be checked against what refusal falls back to.** The guard
was correct about which candidates are suspect and wrong about what to do with them: dropping to
the walk removed `trustworthyHeight`, and with it the axis check that was the only thing standing
between a suspect tree and a silent wrong scale. Refusal has to be louder than the thing it
refuses, not quieter.

The replacement rules are also a better fit for what the tree can actually witness: a shape test
on the candidate itself (a screen is not 13:1) and a contradiction test on the layout inside it,
neither of which consults a global extent that off-layout nodes poison. The shape test closed a
defect from round 2's own review for free — a tall scroll container was winning the height
tie-break and making a landscape tree read as portrait.
