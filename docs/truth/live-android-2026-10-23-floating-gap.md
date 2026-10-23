# Live golden, Android, 2026-10-23: the strip between a floating Gboard's panel and its band (FU1)

## 2026-10-23 — FU1's fix, `34f82f25` (bugs/r1023b-fu1)

averi_lab (emulator-5554, API 33, 1080x2220, gesture navigation; booted `-no-window -no-snapshot-save`, shut down
after), the lab app as installed. averi = this checkout at `34f82f25` (its src; the kf cases and their judge,
scripts/truth/live.ts and live-forms.ts#judgeFloatingGap, added in the records' commit). Note:
docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md, ADR 0027.

**Floating, by hand.** No adb setting floats Gboard. With `form-keyboard-floating` launched (postcode focused, Gboard
docked: `touchable region=SkRegion((0,1398,1080,2220))`, `ITYPE_IME frame=[0,1398][1080,2220]`), screenshot-guided taps:
the toolbar's grid key (63,1456), the grid's second page, the **Floating** tile (294,1770). Read after:

```
touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))
InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true
```

Two rects: the panel `359,1269 681x643` (where Gboard put it — the 2026-10-08 device check's place, not the capture's
`71,1092 937x792`; left there, its region recorded instead) and the 132-px strip. The gap is `0,1912 1080x176`; the
dump's submit `[55,1928][1025,2060]` lies wholly in it, ks `[55,1644][1025,1776]` under the panel.

**The cases** (`--groups forms --cells form-keyboard-floating --cases kf1,kf2,kf3`, three runs:
docs/truth/live-records/android-forms-r1023b-fu1-1.json, -2.json, -3.json — 3 of 3 ok each):

| case | reply (each run) | the app |
|---|---|---|
| kf1 `scroll_until submit` | `Element id:"lab.form-keyboard-floating.submit" fully visible after 0 swipes` | no touch, no submit |
| kf2 `scroll_until submit`, `tap submit` | the same, then `Tapped id:"lab.form-keyboard-floating.submit"` | one touch at (540,1994), one submit, the IME still up (no `back`) |
| kf3 `scroll_until ks` | `ERROR … failed after 3 swipes … never intersected the 1080x1269 screen above the soft keyboard over [359,1269][1040,1912]` | three strokes touching down at (540,1060), above the panel; ks 1493–1592, under the panel; postcode untouched |

The run's judge first counted kf2's tap as a stroke (the app logs the tap's touch too) and called it a MISMATCH; the
judge was fixed (kf2's one touch is its tap) and the three records rejudged: 3 of 3 ok each, as pinned in
tests/truth/live-rejudge.test.ts.

**Docked control.** Gboard docked again (grid → Floating, the tile now off): `touchable region=SkRegion((0,1398,1080,2220))`
— one rect, the band. kf1 once more: SKIP, "keyboard docked (the app hears an IME 822 px tall, not the floating strip)"
(not recorded). Then `adb -s emulator-5554 emu kill`.
