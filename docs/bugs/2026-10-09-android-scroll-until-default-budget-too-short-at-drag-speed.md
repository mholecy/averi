# BUG: at drag speed `scroll_until`'s default budget no longer reaches a row ~30 rows down, and the `(timeout)` reply hides that the list was still moving

**Measured 2026-10-09 12:52–12:54 UTC**, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked, keyboard down),
averi = mobile-verify `fix/round-3` @ `86eb42d` (`dist/`, stdio via the HTTP daemon on port 47821, cwd mp-native), mp-native
Account Detail (`com.finshape.skeleton.dev`, `transactions.list.row_0…row_36`). Strokes from the `adb` shim. Found by the round-4
device check (item 1.1); the measurements are in the `re-run at 86eb42d` sections of
[2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md](2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md)
and [2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md](2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md).
Filed on its own here because it is a consequence of the drag fix, not of the tab-bar fix.

## Observed (measured)

List at the top, row_0 at y 1112, bar shown:

```
12:52:53 scroll_until { platform: android, selector: "id:transactions.list.row_36", fully: true }      (15.1 s)
→ scroll_until id:transactions.list.row_36 failed after 15000ms (timeout) — element never appeared in the tree
```

Shim: `input swipe 540 1638 540 1028 611`, then `540 1553 540 689 865` ×3. The list MOVED on every stroke: row_14…row_20 were on
screen at the timeout. The same call continued with `timeoutMs: 60000, maxSwipes: 20` →
`Element id:transactions.list.row_36 fully visible after 5 swipes` (21.2 s).

- One drag stroke carries ~3.3 rows of 143 px (865 px at 0.45 screens/s ≈ 866 ms) and a round (stroke + settle + read) takes ~3–3.5 s.
  Row 36 from the top needs ~11 strokes / ~35 s.
- The default budget is 15 s (`DEFAULT_SCROLL_TIMEOUT_MS`) AND 6 swipes (`DEFAULT_MAX_SWIPES`). At drag speed it carries the list
  ~4 strokes (≈ 13 rows) in 15 s; raising only `timeoutMs` stops at 6 strokes (≈ 20 rows). A row beyond ~13–20 rows is unreachable
  with the defaults. Whether the 300 ms flings of 610660f reached row_36 from the top within the defaults was not measured (they
  carried more per stroke, but skipped rows, the fling note); the round-4 handoff expected `fully visible after N swipes` here.
- The same shape on the SWIFT form at 86eb42d: `my_note_input` (IBAN focused) now ends on the 15 s timeout after 4 swipes (15.9 s)
  instead of the round-3 fast fail after 5 swipes (17.9 s).

## Why (read from the source at 86eb42d)

- `src/interact/scroll.ts:13` `DEFAULT_SCROLL_TIMEOUT_MS = 15_000` and l. 16 `DEFAULT_MAX_SWIPES = 6` were sized for 300 ms strokes;
  the drag fix (`f09ab3e`, `adapters/android.ts#dragSpeed`) made each stroke ~0.6–1.3 s and shorter in content carried per second,
  without touching either default.
- `src/interact/scroll-text.ts:289–290` renders the bound as `after ${timeoutMs}ms (timeout)`, and l. 311 the shortfall as
  `element never appeared in the tree`. The round knows whether the last strokes moved the tree (it is what the fast fail tests);
  the timeout reply does not say it.

## Why it matters

- `element never appeared in the tree` after a timeout reads as "not in this list". Here the list was moving and the row was further
  down; a flow author cannot tell "raise the budget" from "wrong selector".
- A flow that scrolls a long Android list with the default budget can now time out where faster strokes would have arrived. Each
  stroke is correct; the budget around them was not resized with the drag fix.

## Possible fix directions (owner's choice)

- Scale the defaults on an adapter with `dragSpeed` (e.g. 30 s and 12 swipes on Android), or make the default budget a distance
  (screens of content) rather than a time.
- In the `(timeout)` / `(maxSwipes)` reply, say the last stroke still moved the list:
  `failed after 15000ms (timeout) — the list was still moving (last stroke moved it N px); element not yet in the tree — raise timeoutMs/maxSwipes`.
- At minimum, name the budget in the `scroll_until` tool description next to the drag speed (~3 rows of 143 px per stroke).

## Repro

1. Android, the mp-native Account Detail list at its top (or any list of 30+ rows).
2. `scroll_until { selector: "id:transactions.list.row_36", fully: true }` with the default budget → `failed after 15000ms (timeout)
   — element never appeared in the tree`; the shim shows 4 drag strokes and the list moved on each.
3. The same with `timeoutMs: 60000, maxSwipes: 20` → `fully visible`.

## Device check (2026-10-09 Android, re-run at dd50327)

Measured 2026-10-09 15:35–16:01 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47831, cwd mp-native). Strokes and taps from
the `adb` shim; page placement, bar show/hide and Gboard mode by hand with the real `adb`.

Not fixed in round 5; recorded per the round-5 handoff R-1.

- **Still so.** List at the top, bar shown, 15:37:57 `scroll_until { selector: "id:transactions.list.row_36", fully: true }` (default 15 s /
  6 swipes) → `scroll_until id:transactions.list.row_36 failed after 15000ms (timeout) — element never appeared in the tree` (15.3 s) after
  3 strokes (`540 1638 540 1028 611`, `540 1804 540 752 1054` ×2); the list moved on every stroke (row_17 reached). With `timeoutMs: 60000,
  maxSwipes: 20` → `fully visible after 5 swipes` (27.6 s). The reply still does not say the list was moving.
- Also measured: SWIFT `my_note_input` with IBAN focused (15:48:51) → `failed after 15000ms (timeout) — element in tree but never
  intersected …` after 3 strokes (15.1 s); at 86eb42d after 4 (15.9 s), at 347e70d a fast fail after 5 (17.9 s). Bar-shown `row_40` at the
  list end ran out at 15 s after 3 strokes, where at 86eb42d it fast-failed after 2 (see the tab-bar note).

## Device check (2026-10-09 Android, re-run at 2f98900)

Measured 2026-10-09 18:09–18:33 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47841, cwd mp-native). Strokes and taps from the
`adb` shim; placement and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's `averi.yaml` untouched.

Not fixed (out of scope of round 6). **Still so:** 18:18:01 `row_36`, `fully: true`, default budget → `failed after 15000ms (timeout) —
element never appeared in the tree` after 4 strokes (`540 1638 540 1028 611`, `540 1553 540 689 865` ×3), the list moving on each; with
`timeoutMs: 60000, maxSwipes: 20` → `fully visible after 5 swipes`. SWIFT `my_note_input` with IBAN focused this time fast-failed (`failed
after 5 swipes (the last 2 … did not move it …)`, 18.0 s) instead of the dd50327 timeout — see the soft-keyboard note.

## Device check (2026-10-09 Android, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:19 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/`, stdio via the HTTP daemon on port 47851, cwd mp-native). Strokes and taps from the
`adb` shim (`run9-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only
(`cfg-opt-bank`, `cfg-opt-contacts`, `cfg-optional`, new `cfg-fill`, `cfg-fill-bank`); mp-native's `averi.yaml` untouched.

Not fixed (out of scope). **Still so:** 20:45:31 `row_36`, `fully: true`, default budget → `failed after 15000ms (timeout)` after 3 strokes
(each moved the list); with `timeoutMs: 60000, maxSwipes: 20` → `fully visible after 6 swipes`. SWIFT `my_note_input` with IBAN focused
timed out again (`failed after 15000ms (timeout) …`, 3 strokes) — see the soft-keyboard note. Every call ran slower this run: a bare
`uiautomator dump` took 2.4–2.7 s by hand (ui_snapshot 2.5–2.8 s against round 6's 2.0 s; every `tap` 5.7–6.1 s against 4.5 s on the same
selectors) — the emulator, not averi (host load average 0.9–2.1; the iOS agent ran in parallel).

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

Not fixed (out of scope). **Still so:** 06:30:17 `row_36`, `fully: true`, default budget → `failed after 15000ms (timeout) — element never
appeared in the tree` after 4 strokes (`540 1553 540 689 865` ×4; round 6b: 3); `timeoutMs: 60000, maxSwipes: 20` → `fully visible after 4
swipes` from there (8 in all), row `66,1697 948x143`. Back: `row_0 fully, direction: up, timeoutMs 60000, maxSwipes 20` → `fully visible
after 7 swipes` (`540 765 540 1857 1094` ×7, 29.4 s).
