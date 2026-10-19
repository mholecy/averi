# BUG: on Android a React Native field's floating label overhangs its EditText by 3 px (about 1 dp) — past the 2-px own-label allowance — and averi reads it as covered by its own field: the tap refused, `scroll_until` fails

> **Status (2026-10-19):** fixed at ce19c234 and f3a7043f (arch/r23-rn-label; the second asks the label to span the field's height) — the own-label overhang is 2 pt or dp, as half a
> percent of the screen's shorter side (src/ui-tree/draw-order.ts#labelOverhang: 5 px on this AVD), and the field shape
> no longer asks its parent's size (RN lays the fields in the screen's own view) — docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md,
> refinement 2026-10-19. Measured: golden from truth/round-7 5c71158 `--side` the branch — rn-field's N and M tap and
> scroll_until green (`Tapped at its node's centre (304.5,390.5)`), every other reply and device call byte-identical;
> the ocr rows skipped in the sandbox; pinned over this capture (5 px own, 6 px a cover) by
> tests/ui-tree/draw-order.test.ts. Calibration.json LR2.

Lab note LR2. **Found 2026-10-19** by round 7's React Native lab app (fixtures/apps/rn, `rn-field`; RN 0.88.0) on the
`averi_lab` AVD (Android 13, API 33, 1080x2220, density 2.75), averi = truth/r7-rn's src.

## Observed (measured)

uiautomator (tests/fixtures/truth/android-rn-averi_lab-api33/rn-field.xml), the label listed before its field, both
children of the screen's ViewGroup:

```
TextView lab.rn-field.N 'Payee’s name'               [177,360][432,421]
EditText lab.rn-field.N.field (NAF, clickable)       [177,363][903,418]
TextView lab.rn-field.M 'Message for the recipient'  [177,1350][652,1411]
EditText lab.rn-field.M.field                        [177,1353][903,1458]
```

The label is laid 1 dp above its field (styles: label top 21 dp, field 22 dp; the label's line box 22 dp, N's field
20): 3 px past it at the top (and N's 3 px at the bottom). A raw `adb input tap` at each label's centre focuses its
field (rn-field.truth.json). averi (golden, and live):

```
tap text:"Payee’s name"  → ERROR text:"Payee’s name" is under textfield id:lab.rn-field.N.field (177,363 726x55) at its
                           centre (305,391), drawn over it; only a 255x3 part of it shows … nothing was tapped
scroll_until …           → failed after 3 swipes — … under textfield … 10% of it
```

## Why (read from the source)

`fieldOf` (src/ui-tree/draw-order.ts, the `ownControl` row) holds the label within the field grown by `LABEL_OVERHANG`
= 2 in the tree's units — on Android pixels, "a third of that — stricter, the safe direction" (its doc; ADR 0014). A
1-dp overhang is 2.75 px on this AVD, rounded to 3 by the layout: the same shape the allowance exists for (the SWIFT
form's label 1 pt past its field) is refused on Android only because of the unit.

## Suggested fix (owner's choice)

State the allowance in dp on Android (2 dp ≈ 5.5 px at 2.75), as the tap minimum already is (`minTapPiece`), or
accept this as ADR 0014's residual and record it there.

## Repro

`node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only android-rn-averi_lab-api33/rn-field`.
