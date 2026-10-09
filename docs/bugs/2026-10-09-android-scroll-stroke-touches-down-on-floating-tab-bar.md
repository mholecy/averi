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
