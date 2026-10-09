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
