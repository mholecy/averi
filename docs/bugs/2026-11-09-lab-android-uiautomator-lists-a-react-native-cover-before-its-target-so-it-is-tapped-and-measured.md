# BUG: on Android, uiautomator lists a React Native cover BEFORE the target it is drawn over — averi taps the covered target (`Tapped`) and its colour assert measures the cover as the target

> **Status (2026-11-09): open.** Lab note LR4 (scripts/truth/calibration.json, open). Found by T6's Android capture of
> **rn-banner** (tests/fixtures/truth/android-rn-averi_lab-api33/rn-banner.*), golden red on all six uiautomator rows,
> listed in tests/differential/golden/react-native.known.ts as this note. Backlog D75. No fix yet.

Lab note LR4, LR3's Android twin
(docs/bugs/2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md: fixed under WDA,
idb its ADR 0015 residual 4). **Found 2026-11-09** by T6 on the `averi_lab` AVD (Pixel 3a, API 33, gesture
navigation), the React Native lab app (fixtures/apps/rn, `dev.averi.lab.rn`), captured by
`scripts/truth/capture-android.ts --app react-native --cells rn-banner`.

## Observed (measured)

rn-banner (fixtures/apps/cells/react-native.json, `declared: covered`): each coloured target T, U, C has, as its LATER
JSX sibling, an opaque cover (`#263238`, no touch handler) drawn over its centre — T's a toast labelled `Saved`, U's and
C's bare Views with a testID only; T's and U's covers start 10 dp above the target's top, C's 10 dp below it
(fixtures/apps/rn/src/ReactNative.tsx#COVERS).

The uiautomator dump (`rn-banner.xml`) lists every cover FIRST, though React Native draws it last — C's too, whose
frame starts below its target's (so this is not iOS's "by the frame's top" order):

```
index=1 lab.rn-banner.T.cover [73,276][1008,419]    ← drawn over T, listed before it
index=2 lab.rn-banner.T       [128,303][953,479]
index=3 lab.rn-banner.U.cover [73,771][1008,914]
index=4 lab.rn-banner.U       [128,798][953,974]
index=5 lab.rn-banner.C.cover [73,1321][1008,1464]  ← starts BELOW C's top, still listed before it
index=6 lab.rn-banner.C       [128,1293][953,1469]
```

The capture's truth (`rn-banner.truth.json`): the probe tap at each target's centre (541,391), (541,886), (541,1381)
logged its touch and fired no tap (`reached: false`); the screenshot shows 34.1 % of T and of U, 18.8 % of C in their
own colour, the rest the cover's `#263238` (`seen`).

averi's replies on that tree (golden, side 41ac60cc and T6's HEAD, identical):

- `tap` T, U, C: `Tapped id:"lab.rn-banner.T"` — a tap sent at the centre (`adb shell input tap 541 391`, 886, 1381),
  on the cover, which fires nothing;
- `assert` colour (asked for `#263238`, the colour the screen shows there): `PASS … sampled #263238 (dominant, 71 % of
  region)` (95 % for C) — the cover measured as the target.

Under WDA the same cell is green (LR3's fix: a sibling listed before the target that draws there is a cover whose
order the eyes tell, ADR 0015's amendment, ADR 0024); on this uiautomator tree averi reads the target, listed after
its cover, as drawn over it (src/ui-tree/draw-order.ts's "listed later is drawn over"). Where the fix belongs is not
analysed here.

## Why it matters

averi claims `Tapped` on a target it never reached, and a colour PASS that measured something drawn over it — the silent
direction. A React Native banner or toast over a button is a common screen; the agent is told the button was pressed.

## Expected

The tap refused (covered, nothing sent) or moved off the cover onto what shows of the target; the colour assert not
passing on the cover — as golden-spec/covered.ts asks, and as WDA answers since LR3's fix.

## Reproduce

```sh
node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --only rn-banner
```

The six `android-rn-averi_lab-api33/rn-banner.xml` rows are red (`Tapped: …`, `passed on #263238: …`).
