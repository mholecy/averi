# BUG: on Android `scroll_until … fully: true` certifies a row the app's pinned bars cut, because uiautomator clips each node's bounds to its scroll container

**Measured 2026-10-09 05:58–06:05 UTC**, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`), mp-native SWIFT form
(`com.finshape.skeleton.dev`, Compose; Account Detail → PAY → SWIFT payment). First seen 2026-10-08 at `e9e6509` and noted
there as an "open follow-up" in [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md)
(sections "Device check (2026-10-08, re-run at e9e6509)" and "Device check (2026-10-09 Android bank form …)"); filed on its
own here because the 2026-10-09 run showed it is wider than one row at rest.

## Observed (measured)

The form's scroll container is `bounds="[0,242][1080,1978]"`: the app's top bar sits above y 242, the pinned CONTINUE bar
at 1979–2111. Rows are 143 px high. uiautomator reports each row's bounds CLIPPED to that container, so a row partly behind
either bar comes back shorter, with an edge exactly on the container's edge, and averi judges that clipped rect "entirely
inside":

| call | row as read | on screen | reply |
|---|---|---|---|
| `scroll_until id:swift_payment.form.fees_select fully: true` (at rest) | `{y:242, height:92}` | `Fees*` label cut by the top bar (screenshot) | `fully visible after 0 swipes` |
| same, after a content-down scroll | `{y:242, height:103}` (40 px behind the top bar) | row cut at the top | `fully visible after 1 swipe` |
| `scroll_until id:swift_payment.form.priority_select fully: true`, keyboard down | `{y:1846, height:133}` | lower edge cut by CONTINUE (screenshot) | `fully visible after 0 swipes` |

Also seen on stock Settings (2026-10-09 05:1x UTC): right after a fling, rows read with NEGATIVE heights
(`Accessibility … 306 -251`), the same clipping caught mid-motion
([2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md](2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md)).

## Why (read from the source)

`src/interact/scroll.ts` (`endsClean`, l. 227; the `fully` judgement, l. 694–850) compares the node's rect from the tree
with the viewport (or the box above the soft keyboard). On Android the rect comes straight from uiautomator's `bounds`,
which are already intersected with the nearest scrollable ancestor. The cut part never reaches averi, so "no edge clipped"
holds on a row that is cut. The viewport is the whole screen, not the scroll container, so the app's pinned chrome is not
in the comparison either (the iOS side of that: [2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md)).

## Why it matters

- `fully: true` exists so a following rect assert, pixel check or screenshot measures the whole element. Here it measures a
  partial row while reporting success.
- A `tap` at the centre of such a row can land on the bar: the reported centre is the centre of the clipped rect, inside
  the container, so it usually hits the row, but a screenshot comparison does not.
- On a fling the clipped (even negative) heights can make a stop look clean for one read.

## Possible fix directions (owner's choice)

- Treat a rect edge that lies exactly on its scrollable ancestor's edge as clipped (the cuts above sit exactly on
  `[0,242][1080,1978]`); with `fully: true` keep scrolling or report `CLIPPED at top/bottom by its scroll container`.
- Compare the height with siblings of the same role/id shape in the same container (143 vs 92/103/133), as a hint in the reply.
- Judge `fully` against the scroll container's bounds rather than the screen whenever the target has a scrollable ancestor
  (this would also cover the pinned-chrome case on Android).
- Discard reads with negative or zero heights as unsettled.

## Repro

1. Android, a Compose (or RecyclerView) screen with a pinned top bar and a pinned bottom bar around a scrollable.
2. Scroll so a row sits half behind either bar.
3. `scroll_until { selector: <that row>, fully: true }` → `fully visible after 0 swipes`; `ui_snapshot` shows its height
   shorter than its siblings, with an edge equal to the scrollable's bounds.
