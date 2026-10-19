# BUG: Android `scroll_until` draws its stroke over the list's container, so its touch-down lands on a floating tab bar drawn over the list; the list never moves and the scroll fails as "content exhausted"

Measured 2026-10-09 11:25–11:27 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked, keyboard down),
averi = mobile-verify `fix/round-3` @ `347e70d` (`dist/`, stdio, cwd mp-native), mp-native Account Detail
(`com.finshape.skeleton.dev`, Compose; transaction list `transactions.list.row_0…row_36` under the account header). Strokes
from an `adb` PATH shim; manual comparison strokes sent with the real `adb` (not in the shim log).

## Observed (measured)

Account Detail, list at the top, floating tab bar shown (`nav.tab_*` 1876–2052; an unlabelled sibling container
`66,1840 948x248` — the bar's host — lies over the list's lower part; the list container is `0,825 1080x1395` CLIP,
running under the bar to the screen bottom):

```
11:25:11 scroll_until { platform: android, selector: "id:transactions.list.row_36", fully: true }      (8.7 s)
→ [isError] scroll_until id:transactions.list.row_36 failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
shim: input swipe 540 1942 540 1104 839   ×2
```

The list had not moved (row_0 still at 1112). After a manual scroll of the page (list container now `0,401 1080x1753` / `0,401
1080x1819`, bar still shown):

```
11:26:04 scroll_until … row_36, fully: true  (9.2 s) → the same "failed after 2 swipes … content exhausted …"
shim: input swipe 540 1857 540 765 1094   ×2
```

Manual strokes with the real `adb`, same screen: `540 1942 → 540 1104 839` moved nothing (row_0 at 1112 before and after);
`540 1857 → 1557` moved nothing; `540 1800 → 1500` and `540 1700 → 862` scrolled the list. So a touch-down at y ≥ ~1840 (the
bar's host) is taken by the bar, not the list. Once the bar hid (the list scrolled to its end), the same tool's strokes from
y 1804 (`540 1804 540 752 1054`) moved the list normally (`row_20` up: `fully visible after 3 swipes`; `row_40` from the end:
the fast fail after 2 strokes, correct there). The screen at the failure: the list at its top, 36 rows, nothing loading
(`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-17-0.png` for the second shape).

At `610660f` the same call shape stroked over the screen box (`input swipe 540 444 540 1776 300` / `1776 → 444`), touched down at
y 1776, above the bar, and moved the list (it overshot — the fling bug — but it moved).

## Why (read from the source at 347e70d)

`src/interact/scroll-rounds.ts` (the stroke step, ~l. 1157–1173): the stroke is drawn over the target's scroll container once a
read placed it in one, "else the screen's largest" (`now?.facts.mainScroller`, `ui-tree/geometry.ts#largestScroller`), met with
the gesture box (`swipe.ts#strokeRoom` → `strokeBox`). `swipeVector` then touches down at 0.8 of that box (content down):
825 + 0.8 × 1395 = 1941. Nothing in the box rule knows about a sibling drawn OVER the container (the tab bar is not an ancestor
and not the keyboard), so the touch-down can land on it. Before round 3 the box was the screen (`scroll.ts`, `screenBox`), whose
0.8 point (1776) happened to clear the bar. Then `UNMOVED_STROKES_EXHAUST` = 2 (`scroll-rounds.ts` l. 423): two identical strokes
that leave the whole tree unchanged fail fast as "content exhausted, still loading, or the swipes were not taken" — true in the
letter (the swipes were not taken), but the first cause named is the wrong one, and the scroll gives up after 2 strokes on a list
with 34 more rows.

Related, not the same: [2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md)
(a ROW behind the bar judged visible / a tap landing on a bar; handoff §3 keeps that out of scope). Here no row is judged — the
stroke's own touch-down is on the chrome, and this is new with round 3's container box (the screen box did not hit it).

## Why it matters

`scroll_until` down on the bank app's main screen (the dashboard, the most-used list) fails at once with the tab bar shown —
the default state on arrival — and says the content is exhausted. A flow reading that reply believes the list ends. The same
holds for any app with a floating bottom bar / FAB band over a list whose container runs to the screen bottom.

## Possible fix directions (owner's choice)

- Treat a sibling node drawn over the stroke box (later in z-order, intersecting the box, not an ancestor/descendant of the
  container) like the keyboard: cut the box above it (`coverTop`) when it spans the box's width, or move the touch-down off it.
- On the first unmoved stroke, retry once with the screen box's (pre-round-3) stroke or a touch-down nearer the box centre before
  counting toward `UNMOVED_STROKES_EXHAUST`; when the alternative moves the tree, the first box was blocked.
- At least: when the touch-down point lies inside a clickable node that is not inside the stroke's container, name it in the
  failure ("the swipes touched down on <node> over the list") instead of leading with "content exhausted".

## Repro

1. mp-native logged in, Account Detail, list at the top, tab bar shown.
2. `scroll_until { platform: android, selector: "id:transactions.list.row_36", fully: true }` → `failed after 2 swipes (the last 2,
   swiping down, did not change the screen: content exhausted …)`, shim `input swipe 540 1942 540 1104 839` ×2, list unmoved.
3. `adb shell input swipe 540 1700 540 862 839` → the list scrolls.

## Device check (2026-10-09 Android, re-run at 86eb42d)

Measured 12:52–12:59 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify `fix/round-3` @
`86eb42d` (`dist/` built 12:50 UTC, HTTP daemon on port 47821, cwd mp-native, default config). mp-native Account Detail
(`com.finshape.skeleton.dev`, "My Account CZK", `transactions.list.row_0…row_36`), tab bar shown on arrival, its host
`66,1840 948x248` as at 347e70d. Strokes from the `adb` shim; page placement and bar hide/show by manual strokes with the real `adb`
(not in the shim log). Run folder `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android`. Handoff round 4, items 1.1–1.6.

- **Holds (1.1) — the stroke starts above the bar and the list moves; the default 15 s budget does not reach row_36.** List at the top
  (container `0,825 1080x1395`, row_0 at 1112), bar shown, keyboard down. 12:52:53 `scroll_until { platform: android, selector:
  "id:transactions.list.row_36", fully: true }` →
  ```
  scroll_until id:transactions.list.row_36 failed after 15000ms (timeout) — element never appeared in the tree
  ```
  (15.1 s). Shim: `12:52:55 input swipe 540 1638 540 1028 611` (exactly the expected stroke: the box cut at the bar host's top 1840,
  825 + 0.8 × 1015 = 1637), then — the page had scrolled, container `0,401 1080x1819` — `540 1553 540 689 865` ×3. The list MOVED:
  row_14…row_20 on screen after (row_0 gone). Not a "content exhausted" fast fail — the 347e70d failure is gone. The timeout is the
  budget (see the fling note's 86eb42d section): at drag speed one stroke carries ~3.3 rows and a round takes ~3–3.5 s, so 36 rows need
  ~11 strokes / ~35 s. The handoff's "fully visible after N swipes" is reachable only with a larger budget (next bullet).
- **Holds (1.2) — after the page scroll.** Continuing from row_14 (container `0,401 1080x1819`, bar still shown): 12:53:37 the same call
  with `timeoutMs: 60000, maxSwipes: 20` → `Element id:transactions.list.row_36 fully visible after 5 swipes` (21.2 s). Shim
  `input swipe 540 1553 540 689 865` ×5 — touch-down 1553 (401 + 0.8 × (1840 − 401)), as expected. row_36 `66,1697 948x143` after, its
  bottom 1840 = the bar host's top; screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-12-0.png`: rows to 30.09.2025 above the bar, bar shown.
- **Holds (1.3) — fast fail, bar hidden, no node named.** The bar does not hide under averi's drag strokes (the app hides it only on a
  per-frame step > 12 dp, `BottomBarScrollController`; a 1 px/ms drag is ~16 px/frame) — it stayed shown at the list end; hidden by a
  manual 150-ms flick. List at its end, container `0,401 1080x1753`: 12:55:05 `scroll_until { selector: "id:transactions.list.row_40",
  fully: true }` →
  ```
  scroll_until id:transactions.list.row_40 failed after 3 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
  ```
  (12.7 s; 3 swipes, not 2, because the first still moved the list 66 px: row_36 1697 → 1631 once the bar had hidden). Shim `540 1804 540
  752 1054` ×3 (the 347e70d bar-hidden stroke, uncut). No node named. **Also, bar SHOWN at the end** (12:54:13, before the flick): the same
  call → `failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were
  not taken) — element never appeared in the tree` (8.8 s), `540 1553 540 689 865` ×2 — cut above the bar, no node named (the touch-down
  is no longer on it, so naming it would be wrong).
- **Holds (1.4) — content-up stroke uncut.** Bar shown (by a manual flick up), page scrolled (container `0,401 1080x1819`), rows 29–35 on
  screen. 12:55:36 `scroll_until { selector: "id:transactions.list.row_0", direction: "up", fully: true, timeoutMs: 60000, maxSwipes: 20 }`
  → `Element id:transactions.list.row_0 fully visible after 6 swipes` (26.0 s). Shim `input swipe 540 765 540 1857 1094` ×6: touch-down
  765 = 401 + 0.2 × 1819, lift-off 1857 = 401 + 0.8 × 1819 — the UNCUT container (cut it would be 689 → 1552); the lift-off lies on the bar
  host, which does not stop a drag already in the list. The handoff's "about 540 1104" is the list-at-top shape (825 + 0.2 × 1395), which a
  content-up scroll cannot start from; the page here was scrolled, so 765 is the same rule. row_0 `66,747` after.
- **Holds (1.5) — regressions d / e / g / h.** One case each, written in the notes that own them: Settings drag `text:"Display"` →
  `fully visible after 1 swipe`, `540 1736 540 484 1254` (identical to 347e70d; fling note); carousel `fills` reply on
  `accounts.detail.header` verbatim as at 347e70d, no stroke, plus the `filter_panel` probe `540 1104 540 1281 300` (clipped-bounds
  note); Contacts editor with the IME up, every stroke above the IME top, the same strokes as the round-3 table (soft-keyboard note).
- **Not reached (1.6) — a bar above the open keyboard.** On Account Detail with `search_field` focused (docked IME `[0,1398][1080,2220]`)
  the tab bar stays in the tree at 1876 but is drawn UNDER the IME (screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-40-0.png`) — not above it. Contrast, measured:
  12:58:37 `scroll_until { selector: "id:transactions.list.row_2", fully: true }` (row_2 `66,1632`, under the IME) → `Element
  id:transactions.list.row_2 fully visible after 1 swipe` (7.5 s), `input swipe 540 1284 540 940 345` — box cut at the IME top only
  (825 + 0.8 × 573 = 1283); the bar node (top 1840, below the IME top) did not cut it further, as the cover rule says. No other screen
  with a bar or FAB over a list above the open keyboard was found (the SWIFT form's CONTINUE sits below its container).

## Device check (2026-10-09 Android, re-run at dd50327)

Measured 2026-10-09 15:35–16:01 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47831, cwd mp-native). Strokes and taps from
the `adb` shim; page placement, bar show/hide and Gboard mode by hand with the real `adb`.

Round-5 handoff §2 (round-4 items 1.1–1.4) on `dd50327`. Account Detail, tab-bar host `66,1840 948x248`.

- **Holds (1.1) — touch-down above the bar.** List at the top, bar shown, 15:37:57 `scroll_until { selector:
  "id:transactions.list.row_36", fully: true }` (default budget) → `scroll_until id:transactions.list.row_36 failed after 15000ms (timeout) —
  element never appeared in the tree` (15.3 s). Shim: `input swipe 540 1638 540 1028 611` (cut above the bar, as at 86eb42d), then
  `540 1804 540 752 1054` ×2 — **the bar hid after the first drag this time** (at 86eb42d it stayed shown under the same 611-ms stroke),
  so the next strokes were uncut. List moved on each (row_9…row_17 on screen after). Continued with `timeoutMs: 60000, maxSwipes: 20`
  (15:38:29) → `Element id:transactions.list.row_36 fully visible after 5 swipes` (27.6 s), `540 1804 540 752 1054` ×5; row_36 `66,1904
  948x143`, bar hidden. No touch-down at y ≥ 1840. The handoff's "possibly one more swipe" under C3 did not apply: the bar was hidden at the stop.
- **Holds (1.2) — after a page scroll, bar shown.** Page scrolled (list container `0,401 1080x1819`), bar shown, 15:40:58 `row_36`,
  `fully: true`, `timeoutMs: 90000, maxSwipes: 25` → `fully visible after 8 swipes` (39.2 s). Shim: `540 1553 540 689 865` (401 + 0.8 ×
  (1840 − 401), as at 86eb42d), then the bar hid and `540 1804 540 752 1054` ×7.
- **Holds (1.3) — fast fail, bar hidden.** List at its end, bar hidden, 15:39:10 `scroll_until … row_40` → `scroll_until
  id:transactions.list.row_40 failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or
  the swipes were not taken) — element never appeared in the tree` (11.1 s), `540 1804 540 752 1054` ×2, no node named.
  Bar SHOWN at the end (15:39:38, shown by a hand flick): `failed after 15000ms (timeout) — element never appeared in the tree` (15.5 s),
  `540 1553 540 689 865` then (bar hid) `540 1804 540 752 1054` ×2 — the first stroke moved the list (the bar's hiding changed the screen), so
  the 15 s ran out before two unmoved strokes; the budget (see the default-budget note), not the rule. No node named.
- **Holds (1.4) — content-up uncut.** Bar shown, list at its end, 15:40:07 `scroll_until { selector: "id:transactions.list.row_0", direction:
  "up", timeoutMs: 90000, maxSwipes: 25 }` → `Element id:transactions.list.row_0 fully visible after 7 swipes` (36.7 s), `540 765 540 1857
  1094` ×7 — byte-identical to 86eb42d (page scrolled, so 765 not ~1104), uncut.

## Device check (2026-10-09 Android, re-run at 2f98900)

Measured 2026-10-09 18:09–18:33 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47841, cwd mp-native). Strokes and taps from the
`adb` shim; placement and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's `averi.yaml` untouched.

Round-4 items 1.1–1.4 through the round-5 re-run. Account Detail, tab-bar host `66,1840 948x248`.

- **Holds (1.1).** List at the top, bar shown, 18:18:01 `scroll_until { selector: "id:transactions.list.row_36", fully: true }` (default
  budget) → `failed after 15000ms (timeout) — element never appeared in the tree` (15.2 s): `input swipe 540 1638 540 1028 611`, then
  `540 1553 540 689 865` ×3 (the bar stayed shown this time); row_14…row_20 on screen after. Continued with `timeoutMs: 60000, maxSwipes:
  20` → `Element id:transactions.list.row_36 fully visible after 5 swipes` (21.2 s), `540 1553 540 689 865` ×5; row_36 `66,1697 948x143` —
  its bottom exactly at the host's top 1840 (C3: not stopped while it overlapped the host). No touch-down at y ≥ 1840.
- **Holds (1.2):** the `540 1553 540 689 865` strokes above, after the page had scrolled.
- **Holds (1.3), bar SHOWN.** List at its end (row_36 the last row), 18:18:51 `scroll_until … row_40` → `failed after 2 swipes (the last 2,
  swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the
  tree` (8.7 s), `540 1553 540 689 865` ×2, no node named.
- **Holds (1.4).** Bar shown, 18:19:07 `scroll_until { selector: "id:transactions.list.row_0", direction: "up", timeoutMs: 90000, maxSwipes:
  25 }` → `fully visible after 7 swipes` (29.4 s), `input swipe 540 765 540 1857 1094` ×7, uncut.

## Device check (2026-10-09 Android, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:19 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/`, stdio via the HTTP daemon on port 47851, cwd mp-native). Strokes and taps from the
`adb` shim (`run9-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only
(`cfg-opt-bank`, `cfg-opt-contacts`, `cfg-optional`, new `cfg-fill`, `cfg-fill-bank`); mp-native's `averi.yaml` untouched.

Round-4 items 1.1–1.4. Account Detail, tab-bar host `66,1840 948x248`.

- **Holds (1.1).** List at the top, bar shown, 20:45:31 `scroll_until { selector: "id:transactions.list.row_36", fully: true }` (default
  budget) → `failed after 15000ms (timeout) — element never appeared in the tree` (15.4 s): `input swipe 540 1638 540 1028 611`, then
  `540 1804 540 752 1054` ×2 — **the bar hid after the first stroke this time** (list container `0,401 1080x1753`, no `nav.tab_*` in the tree),
  so the box ran to the list's bottom instead of round 6's `540 1553 …` (bar shown). Continued with `timeoutMs: 60000, maxSwipes: 20` →
  `fully visible after 6 swipes` (31.0 s), `540 1804 540 752 1054` ×6; row_36 `66,1631 948x143`. No touch-down at y ≥ 1840 with the bar shown.
- **1.2 — Not reproduced as written:** the bar stayed hidden after the page scrolled, so the `540 1553` strokes (bar shown) did not occur;
  the bar-hidden strokes `540 1804` are the uncut box. Not a regression.
- **Holds (1.3), bar hidden.** 20:46:38 `row_40` → `failed after 2 swipes (the last 2, swiping down, did not change the screen: content
  exhausted, still loading, or the swipes were not taken) — element never appeared in the tree` (11.7 s), `540 1804 540 752 1054` ×2, no node named.
- **Holds (1.4).** 20:46:55 `row_0`, `direction: "up"`, `timeoutMs: 90000, maxSwipes: 25` → `fully visible after 8 swipes` (40.7 s): one
  `540 752 540 1804 1054` (bar still hidden), then `540 765 540 1857 1094` ×7 (bar back), uncut.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**Holds.** `scroll_until row_3 fully` from under the tab-bar host → 1 stroke `540 1616 540 942 675`, touching down above the bar (1840);
`row_36` strokes `540 1553 540 689 865`; back up `540 765 540 1857 1094`. No stroke touched down on the bar.


## Device check (2026-10-14 Android, re-run at ebe6822)

Round 16 Android device check, 2026-10-14 17:07:57–17:21:08 UTC, emulator-5554 (Pixel_3a AVD, Android 13 / API 33, 1080x2220, gesture navigation, `navigation_mode` = 2 before and after). averi built from `~/dev/mobile-verify` `arch/round-16` at `ebe6822`, checked with `git rev-parse --short HEAD` → `ebe6822` (read-only, detached), daemon on port 47911 via `$R/c`. Apps: mp-native `com.finshape.skeleton.dev` (first, already logged in by the owner, on Account Detail), Google Clock `com.google.android.deskclock`, Settings `com.android.settings`. **No PIN re-login was needed:** mp-native stayed logged in for the whole run. No `ensure_state`/`run_flow`, no `login` rung, no registration, no credentials typed, no `clearState`. **Backend: working.** Account Detail loaded balances (1,121.00 CZK / 2,000.00 CZK, "Account 1 of 4") and a full transaction list. Two transaction details opened with data. The SWIFT form loaded the debit account. No "Mandatory data not loaded" screen appeared. Calls #2–#92 are in `session.log`. The shim log `adb-input.log` has 66 lines, and every line cited below is quoted from it.

**R15 D.3 ordinary `scroll_until`. Holds.** Settings at its top (`settings1.txt` #91). #92 `scroll_until text:"About emulated device"` → `Element text:"About emulated device" fully visible after 3 swipes` (15.5 s), with strokes `17:20:42 input swipe 540 1736 540 484 1254`, `17:20:46 input swipe 540 1783 540 669 1116` and `17:20:50 input swipe 540 1783 540 669 1116`.
