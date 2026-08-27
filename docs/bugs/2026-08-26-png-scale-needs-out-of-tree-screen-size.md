# BUG: png-scale inference is defeated by WDA sheet trees — take the screen size from OUTSIDE the tree

**Follow-up to** `2026-08-26-ios-ocr-crop-scale.md` (read it first for the incident, the 0.5.0 fix
and its "Known holes"). Self-contained evidence + fix shape below; filed 2026-08-26 after on-device
verification of 0.5.0.

## Current state (0.5.0, verified live)

With a modal sheet up on iOS (WDA tree source), `ocr` element asserts **fail closed** with
"screen width 804 is a CONTENT width, not the window width" — correct per design, but it means OCR
(and the same-scale color sampling) is **unusable on sheet screens**, which are exactly where
rendered-copy parity questions live (the transaction filter's CLEAR FILTER / APPLY, measured).
Interim: tree `text` asserts (labels carry the rendered casing).

## Why the tree cannot be trusted here (real WDA dump, iPhone 17, 402×874 pt, filter sheet up)

- Two **`PopoverDismissRegion`** nodes carry `{x: -402, y: -874, w: 1206, h: 2622}` — a
  **pixel-scale rect inside an otherwise point-scale tree** (1206 = 3×402, 2622 = 3×874),
  origin off-screen. The widest-rect walk reads their extent as x∈[-402, 804] → width 804,
  `reliable: false` → `pngScale` fails closed.
- The origin-anchored Application window IS present (label "Skeleton Internal", `{0,0,402,874}`)
  but as a **child of the normalizer's synthetic 0×0 root**, so `inferScreenSize`'s root-rect leg
  never sees it and falls through to the walk.
- 0.5.0's own "Known holes" already concede rootless trees and the one-sided axis check; this dump
  shows even root-bearing WDA captures degrade to the walk whenever the normalizer wraps them.

## Fix shape, cheapest first

1. **Root-rect leg, one level down:** when the root is the synthetic 0×0 container, accept an
   origin-anchored full-screen CHILD (the WDA `Application` node) as the window rect. Closes this
   exact case with no new I/O.
2. **Walk hygiene:** exclude overlay hit-regions with off-screen origins (`PopoverDismissRegion`
   and kin) from the widest-rect walk — they are hit-test scrims, not layout.
3. **The durable fix (this report's title):** derive the screen size from OUTSIDE the tree —
   `simctl` device metrics / WDA `/window/size` on iOS, `wm size` on Android — and use the tree
   only as a cross-check. This is what closes 0.5.0's Known holes 1 and 2 (rootless trees, windows
   narrower than the capture) for good.

Regression fixtures: the real dump shape above (synthetic root → Application child + two
pixel-scale off-origin overlays) must yield scale 3.0, not fail closed; keep the existing
fail-closed tests for trees where no trustworthy size exists.

## Acceptance

`{"element":{"id":"transactions.filter.apply_button"},"ocr":{"text":"APPLY"}}` passes on the
skeleton's iOS filter sheet (iPhone 17 sim, `treeSource: wda`) — the assert that fails closed
today. The skeleton repo is the ready-made testbed; reaching the sheet costs no registration when
a session is alive (`ensure_state("transaction_filter")`).

---

## Verification (2026-08-27, code + synthetic repro — no device)

Reproduced from the described dump shape against 0.5.0. `inferScreenSize` returned
`{width: 804, height: 1748, reliable: false, trustworthyHeight: false}` and `pngScale` failed with
**verbatim** the string the device run reported — so the mechanism is confirmed. Two details in
the report needed correcting, and both changed the shape of the fix:

1. **The 0×0 root is not the normalizer's.** `parseWdaSourceValue` returns WDA's root as-is
   (`src/adapters/wda-source.ts`), and the committed fixtures root at `Application {0,0,402,874}`.
   The zeros came from the parser's missing-`rect` fallback: the live payload's root node carried
   no `rect` at all. So the fix keys on *a root with no usable rect*, whoever produced it — which
   also covers idb's and uiautomator's synthetic roots for free.
2. **Fix (2) could not be done by node type.** `UiNode` carries no `type`; WDA's
   `PopoverDismissRegion` is normalized to `role: 'other'`. The usable signal is geometric — **a
   rect whose origin is negative is not layout** — which is strictly more general: it covers the
   Android and idb equivalents nobody has named.

## Fix (shipped)

Three layers, cheapest first — the first two are the fallback, the third is this report's title:

- `ui-tree/geometry.ts`: the window rect may now be found ONE LEVEL DOWN when the root has no
  rect of its own (the widest origin-anchored child, ties broken on height), and the widest-rect
  walk SKIPS nodes with a negative origin. Either alone turns the reported dump into scale 3.0.
- `verify/scale.ts`: `pngScale(tree, pngW, pngH, screen?)` takes the device screen as the FIRST
  source and demotes the tree to a cross-check, noting a disagreement over 2% rather than failing
  on it. Orientation is corrected only when the png AND the tree both disagree with the device —
  one witness is not enough, because a wide short png is also what a band-shaped capture looks
  like.
- Plumbing: `DeviceAdapter.viewport()` was already the out-of-tree size (`idb describe` points on
  iOS, `wm size` pixels on Android) and already memoized per adapter, so this cost no new I/O.
  `Verifier` reads it once per run and degrades to the tree if it throws; `run/verify.ts` carries
  it on each leg into the color and text tables, which say when they had to scale off the tree.

Both 0.5.0 holes are shut whenever a device size is available. Without one:
hole 1 (an oversized node at x=0 on a rootless tree) now FAILS CLOSED instead of silently halving
the scale — the widest origin-anchored child reaches the axis check; hole 2 (a window narrower
than the capture) is unfalsifiable from a tree alone and stays pinned in the tests.

**Rect parity deliberately still scales from the tree.** Its denominator is a different quantity:
`% of screen width` is compared against a Figma FRAME, i.e. the app's canvas, which in split view
is the window and not the device screen. Swapping in the device size there would change what the
deltas mean, on a guess, with no measured case behind it.

Cover: `tests/fixtures/wda-source-filter-sheet.json` (the dump shape, reconstructed — replace with
the real bytes on the next device round), plus cases in `tests/ui-tree/geometry.test.ts`,
`tests/verify/scale.test.ts`, `tests/verify/assert.test.ts`, `tests/run/verify.test.ts`.

**Still open: the acceptance run.** Nobody has yet run the §Acceptance asserts on the device
against this build. Until that happens, this is a fix that passes its tests.

## Review round (2026-08-27) — two ways the first cut reintroduced the bug

An independent code review and an architecture review, run against the first implementation,
both found the tree-side hardening had opened a NEW silent-wrong-scale path. Confirmed by
execution, fixed, and pinned:

1. **Widest-wins crowned sub-views and bars.** `{0,0,201,437}` beside content reaching x=386 was
   promoted to "the window" and scaled a 1206px capture by 6.0 in silence, where 0.5.0 refused to
   scale at all. Mirror case: a non-edge-to-edge uiautomator dump whose app window starts below
   the status bar left the BAR as the only origin-anchored child — crowned, then failed closed on
   a capture 0.5.0 read correctly. A child now earns the promotion only by CONTAINING the
   on-layout extent (`WINDOW_WIDTH_SLACK`, `WINDOW_HEIGHT_SLACK`); a refused candidate drops back
   to the walk, never to an error.
2. **The rotation rule trusted the tree.** The first cut swapped the device size only when the
   png and the tree both disagreed with it — but the tree's orientation comes from a walked
   height, the one number geometry.ts calls inflated without limit. A landscape iPhone whose
   scroll container won the tie-break made the tree read "portrait", the swap was refused, and
   the crop scaled by 6.522 instead of 3.0 — in the ACROSS direction, which the one-sided check
   cannot see. **Supplying the device screen was worse than withholding it.** Orientation is now
   decided by axis agreement alone: a rotation agrees in the swapped orientation, a band capture
   agrees in neither and is left alone.

Also from that round: the `DeviceScreen` shape moved to `adapters/types.ts`, where the units
contract it carries belongs; the device-vs-tree disagreement note now reaches the text table too
(a comment claimed the run layer said it — it did not); the single-element asserts say when they
had to scale off the tree; a partial root rect (`{0,0,0,874}`) no longer skips the child leg; and
`FakeAdapter.viewport()` derives from the screen it is showing, so a test must ASK for a
device/tree mismatch instead of getting one by accident.

**Rect parity's numbers did change**, contrary to what the note above implies on a fast read: it
still derives from the tree, but the shared geometry hardening means an iOS sheet now normalizes
by the window's 402 rather than the scrims' 804, and the UNRELIABLE banner is gone from that
shape. That is a correction — 804 was wrong — and it is now pinned in
`tests/verify/rect-parity.test.ts` rather than left to be discovered.

## Second review round (2026-08-27) — the fixes themselves were the next bug

The corrections above were re-reviewed, and the containment guard from round 2 turned out to
reopen the hole round 1 had closed. Confirmed by execution, then replaced:

- **A refused candidate fell back to the walk, which has no axis check.** `trustworthyHeight` is
  what arms that check, and only the window path grants it — so every refusal handed trust to the
  same untrustworthy witness with the safety net folded up. Hole 1's oversized node plus ordinary
  scrolled-off rows (`{0,900,402,2100}` — any scrolled iOS list) went back to scaling **1.5
  silently**. A sole correct candidate beside a y-inset oversized node did too, where round 1 had
  answered correctly.
- **The width veto counted junk parked at the right edge**, which is the ORIGINAL 2026-08-26
  inflator, so the child-leg promotion failed closed on exactly the screen class it exists for.
  The committed fixture passed only because its scrims sit at a NEGATIVE origin.

The guard is now two rules that need no global witness:

1. A child must be **screen-shaped** (no flatter than 3:1) to be a candidate at all. That is what
   keeps a status bar out — and, unexpectedly, a tall scroll container too, which had been winning
   the height tie-break and making a landscape tree read "portrait".
2. Layout **starting inside** the chosen window may peek past its right edge (10%, a carousel
   card) but not contradict it (a node that doubles it). A contradiction is reported as
   unreliable — the png scale then fails closed — rather than resolved by picking a side. Nodes
   beginning at or past the right edge are ignored, which is what lets the sheet class through.

Also from this round: a capture that fits the device **only when rotated, and only loosely**, now
fails closed by name — that reading's error lands in the ACROSS direction, which the one-sided
axis check cannot see. And the "how was this scaled" sentence has ONE owner in `verify/scale.ts`
instead of three wordings keyed off `screen === undefined`, which had missed the case where a
screen size was supplied and was unusable.

Known and left open, pinned in `tests/verify/scale.test.ts`: a partial capture whose aspect
matches the device rotated is indistinguishable from a rotation. Production captures are always
full-screen, so nothing generates that input today.

## Third round (2026-08-27) — the same class, twice more, and where it actually stops

The round-2 replacement was verified in turn, and two of its rules had the same defect in new
clothes. Both confirmed by execution, both fixed:

- **The contradiction test was applied to the ROOT window, not just to a guessed one.** A root rect
  IS the window — but horizontally scrollable content straddles the screen edge (a carousel's next
  card, a list cell mid-swipe, whose full frame iOS reports), so every root-bearing tree with such
  a child started failing closed. This was the worst regression of the whole change: it hit the
  ORDINARY case, on both the scale path and rect parity, and 0.5.0 handled all of them correctly.
  The window leg is now reported, and only a guessed (child-leg) window faces the test.
- **The shape gate closed screen-shaped junk and opened bar-shaped junk.** A bar is no longer
  crowned as a window — but a bar that is never a candidate still reaches the walk, and the walk
  granted `reliable` to any origin-anchored maximum with no cross-check at all. Pixel-scale junk
  `{0,0,804,150}` in a point tree read as an 804pt screen and scaled 1.5 in silence: hole 1, third
  appearance, one gate over. The walk now requires a SCREEN-SHAPED rect to corroborate its maximum
  when the tree contains one — a real status bar is corroborated by the window beneath it, junk is
  not — and keeps the old, weaker answer for trees with nothing screen-shaped in them at all.

The structural lesson, which is why this is the round it stops: every previous fix moved the guess
to a different rule while leaving ONE path that answered confidently without a cross-check. The
walk was that path all along. It now either has a witness or says it has none, so a refusal cannot
drain into a quiet answer — which was the mechanism behind all three recurrences.

A fourth hole is named and pinned rather than closed: a left|right split screen is geometrically
identical to the iOS sheet class (a window-sized node starting exactly at the window's right edge),
so the tree reads it as a sheet and scales by the pane. 0.5.0 refused that shape, but only by
accident — it refused the sheet class too. The device screen resolves it and says the tree
disagreed.
## Acceptance run — PASSED on device (2026-08-27, averi 0.6.0)

The §Acceptance asserts ran against 0.6.0 on the real devices, via a full cross-platform
`verify(state: transaction_filter)`:

```
## android:  PASS clear_button renders "CLEAR FILTER" — read "CLEAR FILTER"
             PASS apply_button renders "APPLY" — read "APPLY"
## ios:      PASS clear_button renders "CLEAR FILTER" — read "CLEAR FILTER"
             PASS apply_button renders "APPLY" — read "APPLY"
```

iPhone 17 sim, `treeSource: wda`, filter sheet up — the exact tree shape that read "Magnetic"
pre-0.5.0 and failed closed on 0.5.0 now reads the rendered strings. This report is CLOSED.
