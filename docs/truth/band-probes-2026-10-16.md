# Band probes, measured 2026-10-16 (phase 3 B4)

The raw evidence behind scripts/truth/truth.ts#navigationBandTakes and the B4 paragraph of
docs/plans/2026-10-15-ground-truth-lab-app.md (phase 3): what a raw tap in a system band does, read from the lab app's
own touch log (the state file's `events`). The cell is `bands` (fixtures/apps/cells/bars.json): S centred in the status
band, O 4 dp/pt into it below, N centred in the navigation band, Q 4 into it above.

## Android: the averi_lab AVD (API 33, 1080x2220)

Per tap: a fresh process on the cell, the events logged so far counted, the raw tap, 1 s, the events since, then the
focused window (`a` is `adb -s emulator-5554`):

```sh
a shell am force-stop dev.averi.lab
a shell am start -W -n dev.averi.lab/.MainActivity --es cell bands; sleep 2
n=$(a exec-out run-as dev.averi.lab cat files/lab-state.json | <count events>)
a shell input tap X Y; sleep 1
a exec-out run-as dev.averi.lab cat files/lab-state.json | <events from n>
a shell dumpsys window | grep -m1 mCurrentFocus
```

Gesture navigation, as the AVD was found: `settings get secure navigation_mode` → `2`; `cmd overlay list` →
`[x] com.android.internal.systemui.navbar.gestural`; `dumpsys window displays` → `InsetsSource type=ITYPE_STATUS_BAR
frame=[0,0][1080,66]`, `InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220]`. The state's `safeArea`:
top 66, bottom 66.

```
tap 540 2187 (N centre, nav band):    [('touch', '540,2187'), ('tap', 'N')]  mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
tap 100 2187 (nav band, beside N):    [('touch', '100,2187')]                mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
tap 540 2215 (nav band, bottom row):  [('touch', '540,2215'), ('tap', 'N')]  mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
tap 540 33 (S centre, status band):   []                                     mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
tap 540 143 (O centre, the control):  [('touch', '540,143'), ('tap', 'O')]   mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
```

Three-button navigation: `cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton`,
4 s; `navigation_mode` → `0`; `ITYPE_NAVIGATION_BAR frame=[0,2088][1080,2220]`; the state's `safeArea` bottom 132, N's
frame `127,2132 825x44`.

```
tap 540 2154 (N centre, nav band = Home):  []  mCurrentFocus=Window{… com.google.android.apps.nexuslauncher/…NexusLauncherActivity}
tap 100 2154 (nav band, left edge):        []  mCurrentFocus=Window{… com.google.android.apps.nexuslauncher/…NexusLauncherActivity}
tap 270 2154 (nav band, Back):             []  mCurrentFocus=Window{… com.google.android.apps.nexuslauncher/…NexusLauncherActivity}
tap 540 33 (status band):                  []  mCurrentFocus=Window{… dev.averi.lab/dev.averi.lab.MainActivity}
```

Restored: `cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural`; `navigation_mode` →
`2`, `[x] …navbar.gestural`, `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220]` again. The captures were taken after,
and record the mode (`CellTruth.navigation: "gesture"`, `AndroidLab.navigation`).

## iOS: the averi-lab iPhone 17 simulator (iOS 27.0, 402x874 pt, safe area top 62, bottom 34)

Per tap: `simctl terminate`, the state file removed, `simctl launch … -cell bands`, 2.5 s, the events counted,
`idb ui tap X Y`, 1 s, the events since.

```
tap 201 31: []      tap 60 31: []      tap 340 31: []      tap 201 10: []      tap 120 50: []
tap 201 52: []      tap 201 53: []
tap 201 54: [('touch', '201.0,54.0'), ('tap', 'O')]     tap 60 54: [('touch', '60.0,54.0'), ('tap', 'O')]
tap 201 55: [('touch', '201.0,55.0'), ('tap', 'O')]     tap 201 58: [('touch', '201.0,58.0'), ('tap', 'O')]
tap 201 61: [('touch', '201.0,61.0'), ('tap', 'O')]
tap 201 857: [('touch', '201.0,857.0'), ('tap', 'N')]   tap 60 857: [('touch', '60.0,857.0'), ('tap', 'N')]
```

The status bar's window takes every tap above y 54 of its 62-pt band (no touch up to 53, a touch from 54); B3 measured
the same on `open` (no touch at y 2–50, a touch from 55). `truth.ts#IOS_STATUS_BAR_SWALLOWS_ABOVE` is 54 — a probe
above y 54 that left no touch is the bar's, one from 54 on is undelivered — which both measurements bear out (B3's 51
was not: B4 logged no touch at y 52 and 53). The home-indicator band passes every tap to the app.

## Follow-up

- No capture exists under three-button navigation: the committed Android run is gesture navigation's. A run under three
  buttons (the AVD switched as above, then restored) would hold N `nav-band`, not reached, `navigation:
  "three-button"` — consistent by navigationBandTakes, its rows R-band with the colour row expecting a FAIL
  (rows.ts#bandColour; under gesture navigation it accepts N's PASS on its own colour too), the capture
  calibration.json #23 needs to calibrate on that row. Two-button navigation was not measured: a capture under it
  records `two-button`, and a nav-band target there is broken until it is.
