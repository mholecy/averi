# BUG: `scroll_until` on Android cannot stop on a row of a fast-flinging lazy list (RecyclerView) — one 300 ms stroke carries the row across the viewport between two reads, the list drops it from the tree, and the loop swipes on the same way until the 15 s timeout ("never appeared in the tree")

**Measured 2026-10-09 05:03–05:18 UTC** on emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi =
mobile-verify `fix/keyboard-aware-scroll` @ `610660f` built from source (`dist/`, stdio). Strokes recorded with an `adb`
shim on the server's PATH that logs every `input` call. Fixtures: stock Settings home and the Google Contacts "Create
contact" editor. Not a regression of the round-2 branches (the no-keyboard stroke is unchanged, 1776 → 444, 300 ms); the
`Motion` turn documents that a lazy list defeats it ("Needs the target to STAY in the tree") — this note measures what that
costs on two ordinary screens.

## Observed (measured)

### 1. No keyboard: Settings home, a row two rows below the fold is never reached

Settings home list (`recycler_view`, 0,737 1080x1417) with `Display` the next row below the fold (a slow manual swipe later
showed it at y 2003). One averi stroke (`input swipe 540 1776 540 444 300`) moves this list ≈ 2190 px — more than the list's
1417-px height: before it `Display` at y 2003; after it `Accessibility` (two rows later) at y 297, `Display` gone from the tree.

```
05:17:03 scroll_until { selector: 'text:"Display"', fully: true }
→ [isError] scroll_until text:"Display" failed after 15000ms (timeout) — element never appeared in the tree        (16.4 s, 5 strokes 1776→444)
05:17:20 scroll_until { selector: 'text:"Accessibility"', fully: true }
→ [isError] … failed after 15000ms (timeout) — element never appeared in the tree                                   (16.1 s, 5 strokes)
05:17:3x scroll_until { selector: 'text:"Network & internet"', direction: "up", fully: true }  → fully visible after 2 swipes
```

Both rows passed through the viewport during the strokes; no read ever caught them.

### 2. With the docked IME: Contacts editor, a row clipped by the keyboard is flung off the top

`Last name` at y 1317–1477 against the IME band at 1398 (`First name` focused):

```
05:06:34 scroll_until { selector: 'text:"Last name"' }
→ Element text:"Last name" visible after 0 swipes — CLIPPED at bottom, 51% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. …
05:06:3x scroll_until { selector: 'text:"Last name"', fully: true }                                                   (16.4 s)
→ [isError] scroll_until text:"Last name" failed after 15000ms (timeout) — element was in the viewport before the first swipe but did not stay — it is no longer in the tree (a fling carried it off? a lazy list drops what scrolls away). The soft keyboard was up over [0,1285][1080,2220] in 6 of the 6 rounds read: …
strokes: 540 1118 → 540 280 (band 1398), then 4 × 540 1029 → 540 257 (Gboard's band grew to 1285)
```

After the first stroke the editor sat at its END (`Add address`, `Add to label`, `Notes`, `Add fields`, `Saving to Device
only`); four more strokes went DOWN into exhausted content. The failure text is right; the four strokes and ≈ 12 s are wasted:
the target was last seen clipped at the bottom edge with the caller's direction down, so it can only have left over the top.

### 3. Wording: a row wholly under the keyboard at round 0 is said to have "never appeared in the tree"

Same editor, first call of the session, `Last name` read at y 1409–1569, wholly under the 1398 band (in the tree, `ui_snapshot`
05:03:08):

```
05:03:50 scroll_until { selector: 'text:"Last name"', fully: true }
→ [isError] scroll_until text:"Last name" failed after 15000ms (timeout) — element never appeared in the tree. The soft keyboard was up over [0,1285][1080,2220] in 6 of the 6 rounds read: …
```

It was in the tree before the first stroke (under the keyboard, `visible = 0`, so `inFrameAfter` stayed unset); the first
stroke flung it out. "never appeared in the tree" is false and hides the fling.

Side observation in the read right after a fling (05:18, Settings): nodes with NEGATIVE heights — `Accessibility … 198 297
306 -251`, `Security 198 297 197 -9`, `About emulated device 198 2187 560 -33` — uiautomator's clipped bounds with bottom < top,
passed through as-is by `ui_snapshot`.

## Why (read from the source)

`src/interact/scroll.ts#Motion`: `carriedPast` (the turn) needs a read that FINDS the target beyond the far edge; a read that
does not find it clears it ("a lazy list dropped it: nothing to turn for"), and `nextStroke` then strokes toward the caller's
direction. `exhausted` needs the target in the tree (`offFrame` over found nodes), so content exhausted with the target gone
runs to the deadline. The Android stroke is `input swipe … 300` (`adapters/android.ts#swipe`, default 300 ms), a fling on
RecyclerView. The "never appeared" branch is chosen when no read had the target in the frame, even if a read had it in the tree.

## Why it matters

`scroll_until` is "the portable way to reach content below the fold"; a Settings-style RecyclerView row one screen down cannot
be reached at all, and the error says the element does not exist. In flows this reads as a missing element, not as a scroll
that overshot.

## Possible fix directions (owner's choice)

- Make the stroke not fling: a slower `input swipe` (e.g. ≥ 800–1000 ms for the same distance; measured here: a 1500 ms
  500-px swipe moved the list 485 px (`Network & internet` 794 → 309)) or an explicit hold at the end (`input motionevent DOWN/MOVE…/UP` with a pause
  before UP), so one stroke moves the content by about its own length.
- Remember the last side the target was seen on (in the tree, any rect): when a stroke drops it, turn with half the reach as
  for `carriedPast`, instead of honouring the caller's direction.
- Fail fast: two identical strokes after which the WHOLE tree is unchanged (not only the target's matches) is exhausted
  content too, target or not.
- Say "was in the tree (under the soft keyboard / off the frame) before the first swipe, then left it" instead of "never appeared".

## Repro

1. emulator, `adb shell am start -n com.android.settings/.Settings`, list at the top.
2. `scroll_until { platform: android, selector: 'text:"Display"', fully: true }` → 15 s timeout, "never appeared in the tree".
3. `swipe { fromX: 540, fromY: 1700, toX: 540, toY: 1200, durationMs: 1500 }` → `Display` is on screen.

## Device check (2026-10-09 Android bank app, re-run at 610660f)

06:05–06:07 UTC, mp-native Account Detail transaction list (Compose lazy list, `transactions.list.row_N`, rows unmounted off
screen), emulator-5554, keyboard down, averi `dist/` from `610660f`.

- **Reproduces upward.** From the end of the list (rows 28–36 on screen), `scroll_until { selector:
  "id:transactions.list.row_20", direction: "up", fully: true }` → `failed after 15000ms (timeout) — element never appeared in
  the tree` (15.9 s), 5 strokes `input swipe 540 444 540 1776 300`; the list ended at the top (row_0 at y 1112) — row_20 was
  carried past between reads.
- Down: `scroll_until row_12 fully` from the top → `fully visible after 1 swipe` (it happened to land in view). One manual
  stroke of the same shape (1776 → 444, 300 ms) moved the list ≈ 2300 px (row_0 1112 → row_8 at 482), about 9 rows, more
  than a viewport.
- `scroll_until row_40` (the list ends at row_36) → 5 strokes, `never appeared in the tree` at 15 s — correct outcome, but
  the same timeout shape: no "content exhausted" fast-fail for a target that is not in the tree.

## Device check (2026-10-09 Android, re-run at 347e70d)

Measured 11:25–11:37 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked, keyboard down), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd mp-native). Fixtures: Settings home (RecyclerView), the mp-native
Account Detail transaction list (Compose lazy list, `transactions.list.row_0…row_36`). Strokes from the `adb` shim; the formula is
`ms = max(300, ceil(length / 0.999))`.

- **Holds — Settings drag.** List at the top. 11:36:26 `scroll_until { selector: 'text:"Display"', fully: true }` → `Element text:"Display"
  fully visible after 1 swipe` (8.2 s, was a 15 s "never appeared"); stroke `input swipe 540 1736 540 484 1254` (1252 px → 1254 ms ✓; box
  `settings_homepage_container` 0,66 1080x2088, 0.8/0.2). Display then at y 1184, rows Battery…Privacy listed in order between — nothing
  skipped. 11:36:36 `text:"Accessibility"` → `fully visible after 0 swipes` (already on screen at 1668). Extra: 11:36:46
  `text:"About emulated device"` → `fully visible after 2 swipes` (11.6 s), `540 1783 540 669 1116` ×2 (1114 px → 1116 ms ✓), the rows
  Location…Tips & support listed contiguously after. Every stroke ≥ 300 ms and on the formula. (The negative-height nodes of the
  original read still appear: `Apps 198,297 126x-249`.)
- **Holds — bank list up.** From the end (rows 32–36 on screen, tab bar hidden): 11:27:03 `scroll_until { selector:
  "id:transactions.list.row_20", direction: "up", fully: true }` → `Element id:transactions.list.row_20 fully visible after 3 swipes`
  (15.0 s; was a 15.9 s "never appeared"). Strokes `input swipe 540 752 540 1804 1054` ×3 (1052 px → 1054 ms ✓; box = the list container
  0,401 1080x1753). row_20 at y 843 after, rows 19–25 listed (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-25-0.png`).
- **Holds, from the end — fast fail.** 11:27:49, list at its end: `scroll_until id:transactions.list.row_40, fully: true` → `scroll_until
  id:transactions.list.row_40 failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading,
  or the swipes were not taken) — element never appeared in the tree` (9.1 s); `540 1804 540 752 1054` ×2.
- **Not the fast fail when the list still has to travel.** 11:27:25, right after the row_20 stop (row_20 at 843): the same `row_40` call →
  `failed after 15000ms (timeout) — element never appeared in the tree` (16.1 s), 4 strokes `540 1804 540 752 1054`. The first strokes
  carried the list to its end (row_36 at 1631 after); at ~3.5–4 s a round (1 s drag + settle + reads) the 15 s ran out before two unmoved
  strokes were counted. Correct outcome; it is the budget, not the rule — but "well under 15 s" holds only from the end.
- **Fails (new bug) — bank list down with the tab bar shown.** List at its top: 11:25:11 `scroll_until id:transactions.list.row_36, fully:
  true` → `failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were
  not taken) — element never appeared in the tree` (8.7 s), `540 1942 540 1104 839` ×2, list unmoved; again at 11:26:04 with the list
  container at 0,401: `540 1857 540 765 1094` ×2, unmoved. The touch-down lies on the floating tab bar's host (66,1840 948x248), which takes
  the gesture; manual strokes from y ≤ 1800 scroll. New with round 3's container box (at 610660f the stroke touched down at 1776):
  [2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md](2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md).
- **Not reached — loading list.** No screen with a spinner while paging was found: the bank list loads all 37 rows at once, Settings has
  none. The `progress` exemption from the fast fail is unmeasured.
- **Not reached — `left` wording.** The Contacts editor resizes with the IME on this image (its scroll container became `0,242 1080x1156`,
  ending at the IME top 1398, the moment `First name` was focused), so `Last name` was never under the band at round 0
  (`Last name` 132,1223 816x160 above it). Neither the PASS nor the `left` failure could be produced.

## Device check (2026-10-09 Android, re-run at 86eb42d)

Measured 12:52–12:57 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked, keyboard down), averi = mobile-verify
`fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, HTTP daemon port 47821, cwd mp-native). Fixtures: Settings home, the mp-native
Account Detail list. Strokes from the `adb` shim. Round-4 handoff item 1.5 (round-3 item d).

- **Holds — Settings drag.** Settings force-stopped and started at its top. 12:56:50 `scroll_until { selector: 'text:"Display"', fully: true }`
  → `Element text:"Display" fully visible after 1 swipe` (8.2 s). Shim `input swipe 540 1736 540 484 1254` — byte-identical to 347e70d (1252
  px → 1254 ms ✓; Settings has no overlay, so the round-4 cut changes nothing). Display at y 1180 after, rows Battery…Privacy listed in
  order — nothing skipped.
- **Holds — bank list fast fail from the end** (written in full in the tab-bar note): `row_40` → `failed after 2 swipes` (bar shown,
  8.8 s) / `after 3 swipes` (bar hidden, 12.7 s), every stroke ≥ 300 ms on the formula.
- **Observed — the default budget vs drag speed on a long list.** From the list top, `scroll_until row_36, fully: true` (default 15 s)
  timed out after 4 strokes with the list moving (row_14 reached); with `timeoutMs: 60000` it reached row_36 in 5 more strokes (21.2 s).
  Each stroke carries ~3.3 rows (865 px), a round ~3–3.5 s. Same shape as the 347e70d "not the fast fail when the list still has to
  travel": correct outcome, the budget. Noted because the round-4 handoff expected success at the default budget on this call; a flow
  that scrolls 30+ rows of this list needs `timeoutMs` (and the `(timeout) — element never appeared` reply does not say the list was
  still moving).
