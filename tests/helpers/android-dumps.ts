/**
 * The line `adb shell "dumpsys input_method | grep -m1 mInputShown"` prints —
 * real, emulator-5554 (API 33), 2026-10-04 (false); true was observed on the
 * login screen the same day. Shared by the adapter's witness tests and the
 * end-to-end keyboard test.
 */
export const INPUT_SHOWN_LINE = (shown: boolean) =>
  `  mShowRequested=${shown} mShowExplicitlyRequested=false mShowForced=false mInputShown=${shown}\n`;
