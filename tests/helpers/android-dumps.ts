/**
 * The line `adb shell "dumpsys input_method | grep -m1 mInputShown"` prints —
 * real, emulator-5554 (API 33), 2026-10-04 (false); true was observed on the
 * login screen the same day. Shared by the adapter's witness tests and the
 * end-to-end keyboard test.
 */
export const INPUT_SHOWN_LINE = (shown: boolean) =>
  `  mShowRequested=${shown} mShowExplicitlyRequested=false mShowForced=false mInputShown=${shown}\n`;

/**
 * The floating-Gboard device check (2026-10-08, emulator-5554, Pixel_3a AVD,
 * API 33, 1080x2220 portrait — docs/bugs/2026-10-05-android-floating-gboard-
 * keyboard.md, the three "Device check" sections), as the commands printed
 * it. `displays`: the lines of `dumpsys window displays` the oracle's state()
 * reads; `touchable`: what AndroidAdapter's keyboardTouchable command prints
 * — the `mInputShown` line of `dumpsys input_method`, then the `touchable
 * region=` line of `dumpsys window InputMethod`. Shared by the adapter's
 * parser tests, the reader's rules (tests/ui-tree/soft-keyboard.test.ts) and
 * the end-to-end keyboard test.
 */
export const GBOARD = {
  /** Floating, IBAN field focused, the panel drawn at about x 359–1040, y 1269–1912: the IME inset is only the 132-px collapse strip. */
  floating: {
    displays:
      '    mIsImeShowing=true\n' +
      '        InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true\n',
    touchable:
      '  mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true\n' +
      '  touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))\n',
  },
  /** Docked, Settings search field focused: the region is one rect, equal to the band. */
  docked: {
    displays:
      '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true\n',
    touchable:
      '  mShowRequested=true mShowExplicitlyRequested=false mShowForced=false mInputShown=true\n' +
      '  touchable region=SkRegion((0,1398,1080,2220))\n',
  },
  /** Hidden by `back`: the region is NOT empty — the collapsed strip stays. */
  hidden: {
    displays:
      '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false\n',
    touchable:
      '  mShowRequested=false mShowExplicitlyRequested=false mShowForced=false mInputShown=false\n' +
      '  touchable region=SkRegion((0,2088,1080,2220))\n',
  },
  /** Hidden, the first read after a LANDSCAPE keyboard, back in portrait: the region is stale, in landscape coordinates. */
  staleLandscape: {
    touchable:
      '  mShowRequested=false mShowExplicitlyRequested=false mShowForced=false mInputShown=false\n' +
      '  touchable region=SkRegion((0,948,2220,1080))\n',
  },
} as const;

/** The floating panel and its band, as rects (the fixtures' `(l,t,r,b)` read). */
export const GBOARD_PANEL = { x: 359, y: 1269, width: 681, height: 643 } as const;
export const GBOARD_STRIP = { x: 0, y: 2088, width: 1080, height: 132 } as const;
