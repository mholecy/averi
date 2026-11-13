# A35: a real two-display capture (2026-11-13)

emulator-5554 (Pixel_3a AVD, API 33, 1080x2220, gesture navigation), with the owner's grant of 2026-11-13 ("A35 áno"):
an overlay display for the capture only, from branch feat/a35-two-display at main d8ec7eb9.

    node --import tsx scripts/truth/capture-two-display.ts --serial emulator-5554 --out <dir>

The script sets `overlay_display_devices` to `720x1280/320`, waits for the second display in `dumpsys window displays`,
reads the adapter's own shell lines (src/adapters/android-wm.ts, word for word) in three states, then removes the root
tasks it started, puts the setting back and checks it (capture.log.txt: the before and after lines).

| state | display 0                      | overlay display (id 4)     | fixtures (tests/fixtures/, `*-api33-two-display-<state>.txt`) |
|-------|--------------------------------|----------------------------|---------------------------------------------------------------|
| a     | the launcher, as found         | nothing                    | `…-a-launcher-d0`                                             |
| b     | Settings, focused              | nothing                    | `…-b-settings-d0`                                             |
| c     | Settings (lost window focus)   | the clock, focused         | `…-c-settings-d0-clock-d4`                                    |

Each state's four files: `dumpsys-window-displays-…` (`dumpsys window displays`, whole: parseImeInsets, parseStatusBand,
parseNavigationBand), `dumpsys-window-focused-window-…` (FOCUSED_WINDOW_COMMAND: parseFocusedWindow),
`dumpsys-window-focus-…` (CHOOSER_FOCUS_COMMAND: defaultDisplayFocus), `touchable-…` (TOUCHABLE_COMMAND). No host path
was in them (scripts/release/clean-log.ts changed nothing).

What the dumps show, and what the readers before A35 made of them (the capture's commit, e90d0fb7; what HEAD reads,
one rule for the default display: ADR 0041's A35 amendment):

- Display order: the top-focused display's block is printed LAST (a, b: display 4 then 0; c: 0 then 4). Only that
  display has a window focus: every other display prints `mCurrentFocus=null` (c: display 0 still holds Settings as
  `mFocusedApp`, but its `mCurrentFocus=null`).
- IME / status / navigation: the overlay display has its own InsetsState with an `ITYPE_IME` entry (`frame=[0,0][0,0]
  visible=false`) and its own `mIsImeShowing=false`, but no status-bar or navigation-bar entry. So the IME entries
  agree (hidden; a keyboard shown on display 0 was not captured — it would disagree with the overlay's hidden one and
  read `unknown`), the status band reads 66 (one entry), and the navigation band reads none in every state: the two
  `DisplayFrames` lines (1080x2220, 720x1280) differ, and parseNavigationBand refuses displays of different sizes.
- Focused window: FOCUSED_WINDOW_COMMAND prints no `Display:` header, but each display's `mCurrentFocus=` comes right
  before its `DisplayFrames` line, and every window block of `dumpsys window windows` names its display
  (`mDisplayId=<n> rootTaskId=…`). parseFocusedWindow takes the first non-null focus and the first `DisplayFrames`:
  in b that is Settings on display 0 with display 4's size, read as `screenAlone` with a frame of 720x1280 — the
  window's real frame is [0,0][1080,2220]: a wrong answer. In a, `unknown` (the launcher's GoogleDiscoverWindow is a
  visible app window beside it, as on one display); in c, `unknown` (the clock's own popup panel, and Settings on
  display 0 counted as "beside").
- Chooser: display 0's block. a: the launcher (app and window); b: Settings (app and window); c: Settings as the app,
  no window (display 0's `mCurrentFocus=null`).

Emulator before and after: `overlay_display_devices` `null` → `null` (deleted), display 0's focus the launcher, the same
root tasks, the clock not running. An earlier run of the script (two states) left display 0's `mFocusedApp=null`
after the overlay's removal (HOME did not reset it; Settings started and HOME pressed did). That recovery was done by
hand then; the script now does it when display 0's `mFocusedApp` reads null after the removal, but the recorded run did
not need it, so the script's own recovery has not been exercised. A Settings task that was there before is reused by
states b and c and kept: the script restores root tasks by id (removes those it did not find), not each task's state.

Nothing was wiped, cleared, rebooted or force-stopped.
