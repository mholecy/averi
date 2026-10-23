# Live golden, Android, 2026-10-24: the window manager's word on the focused window (residual 19)

## 2026-10-24 — residual 19's fix, `b3acdeb` (bugs/r1023b-r19)

averi_lab (emulator-5554, API 33, 1080x2220, gesture navigation; booted `-no-snapshot-save`, shut down after), the
lab app built from `103c4056` (the new cell `presented/dialog-views-fullscreen`). averi = this checkout at `b3acdeb`
(its src). Note: ADR 0018, the amendment "Android's window by the window manager's word"; open-bugs #17; LW1's note,
"The full-screen dialog".

**The probe.** With each presented cell up, `dumpsys window displays | grep -E 'mCurrentFocus=|DisplayFrames w='; dumpsys
window windows` (the adapter's FOCUSED_WINDOW_COMMAND; API 33 prints `mCurrentFocus` in `displays` only):

| cell | dumped root | focused window (`ty=`, `Frames: … frame=`) | beneath it |
|---|---|---|---|
| open | `[0,0][1080,2220]` | BASE_APPLICATION `[0,0][1080,2220]` | no other app window visible |
| alert-dim | `[155,851][925,1368]` | APPLICATION, the same | the activity, BASE_APPLICATION, visible |
| sheet-medium | `[0,0][1080,2220]` | APPLICATION, the same | the activity |
| bottom-sheet-dialog | `[0,0][1080,2220]` | APPLICATION, the same | the activity |
| form-picker (the sheet) | `[0,0][1080,2220]` | APPLICATION, the same | the activity |
| dialog-fullscreen | `[0,66][1080,2153]` | APPLICATION, the same (`mAttrs` `1081x2087`) | the activity |
| dialog-views-fullscreen | `[0,0][1080,2220]` | APPLICATION, the same | the activity |

On dialog-views-fullscreen `mTopFullscreenOpaqueWindowState` IS the focus (the cheap `displays` rule reads it as the
app's screen); the type tells it. The call: 41 KB, 25–26 ms through execFile (ten runs; the `windows` dump alone
21–23 ms, filtered on the device 26–30 ms), 30–31 ms through the adapter during the speed runs below.

**The visibility cases** (`--groups visibility --cells dialog-fullscreen,bottom-sheet-dialog,dialog-views-fullscreen`,
three runs: docs/truth/live-records/android-vis-r1023b-r19-1.json, -2.json, -3.json — 39 of 39 ok each):

| cells | tap A–D | scroll_until A–D | S | colour A–D |
|---|---|---|---|---|
| dialog-fullscreen | refused, the presented headline ("a screen is presented over it (a modal or a sheet) — close it first"), nothing fired | `stopped before any swipe` — no stroke (was two, on the dialog) | Tapped | FAIL, nothing fired |
| bottom-sheet-dialog | as before (the parser's mark) | as before | Tapped | FAIL |
| dialog-views-fullscreen | the presented headline, nothing fired | `stopped before any swipe`, no stroke | Tapped | FAIL |

Run 1 and 2 ended "FIXED, not intermittent — strike off live-known.ts" for the four `scroll:dialog-fullscreen.*`
entries (struck before run 3, which exits 0).

**The forms cases** (`--groups forms`, three runs: android-forms-r1023b-r19-1.json, -2.json, -3.json — 32 cases, 27 ok,
b1d and b7 LOUD as known, kf1–kf3 SKIP: Gboard docked): form-picker's c2–c4 (the taps beneath the expanded sheet)
refused with the presented remedy, once; c5–c7 (an element and a colour assert, a flow's `wait:`) fail with "(a sheet
or modal is presented over it, and the tree lists only that window — close it first)"; c1 (scroll_until a row far down
the sheet's own lazy list) `fully visible after 3 swipes` — the strokes on the sheet's own list go on, as decision 3
lets them. Nothing fired.

**Speed** (scroll_until D on dialog-fullscreen, the adapter driven directly, three runs each): at `6ff9ca3e` 9645–9673
ms ("failed after 2 swipes"); at `b3acdeb` 4512–4585 ms ("stopped before any swipe"), the window manager's call 30–31
ms of it — the rest the two reads the stop takes.

Then `adb -s emulator-5554 emu kill`.
