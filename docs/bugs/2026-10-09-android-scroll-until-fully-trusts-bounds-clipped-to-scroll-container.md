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

## Device check (2026-10-09 Android, re-run at 347e70d)

Measured 11:28–11:42 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify `fix/round-3` @
`347e70d` (`dist/` built 11:21 UTC, stdio, cwd mp-native). Fixtures: mp-native SWIFT form (container `0,242 1080x1736`, rows 143 px)
and Account Detail; Settings search in landscape for item f. Rows placed by slow manual drags with the real `adb` (not in the shim log).
Probe cap on this screen: 0.08 × 2220 = 178 px.

- **Holds — Fees (top edge).** Keyboard down, `fees_select` read `66,242 948x102` (cut by the top bar; `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-52-0.png`). 11:32:07
  `scroll_until { selector: "id:swift_payment.form.fees_select", fully: true }` → `Element id:swift_payment.form.fees_select fully visible
  after 1 swipe` (7.2 s). Shim: one probe `input swipe 540 589 540 766 300` — finger DOWN, 177 px, inside the container. Row after
  `66,390 948x143`; screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-55-0.png` shows the `Fees*` label and value whole.
- **Holds, on a substitute row — bottom edge.** The `priority_select {y:1846,height:133}` shape needs the form taller above it (the
  `iban_notice`); with `DE89…` in a CZK payment no notice appeared on Android, so the form at its top keeps `priority_select` at
  `66,1749 948x143`, whole. Same rule, two rows cut by the container's bottom (1978) instead: `details_toggle` read `66,1924 948x55` →
  11:33:14 `scroll_until … details_toggle, fully: true` → `fully visible after 1 swipe` (7.2 s), probe `540 1631 540 1454 300` (finger UP,
  177 px), the toggle then `66,1731 948x132`; `payee_name_input` then read `66,1894 948x85` → 11:33:32 → `fully visible after 1 swipe`
  (7.2 s), probe `540 1631 540 1454 300`, row after `66,1704 948x143` (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-65-0.png`).
- **Holds — carousel `fills`.** Account Detail, the account carousel: card `accounts.detail.header 66,275 948x330` in its clip
  `0,275 1080x330`. 11:42:13 `scroll_until { selector: "id:accounts.detail.header", fully: true }` → `Element id:accounts.detail.header
  fully visible after 0 swipes; but it fills its scroll container (0,275 1080x330) exactly — its top and bottom edges lie on the
  container's, where Android cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — it may
  be cut there, a rect assert or screenshot may measure part of it; usual for a card as tall as its carousel — check with a screenshot`
  (2.1 s). No stroke in the shim. Screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-111-0.png`: the card is whole (not cut).
- **Holds — probe vs pull-to-refresh (no refresh on this screen).** Account Detail, list at the top: `transactions.list.filter_panel
  0,825 1080x170` flush with the list container `0,825 1080x1395`. 11:28:24 `scroll_until { selector: "id:transactions.list.filter_panel",
  fully: true }` → `Element id:transactions.list.filter_panel fully visible after 1 swipe; its top edge lies on its scroll container's
  (0,825 1080x1395), and a probe swipe toward it moved nothing — nothing of it is cut there` (4.9 s). Probe `540 1104 540 1281 300`
  (finger down, 177 px). Screenshot after (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-31-0.png`): no spinner, no reload. A manual 900-px, 2.5-s pull at the top showed
  only the stretch overscroll (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/ptr-mid.png`) — this screen has no pull-to-refresh, so "no refresh fired" is shown only in that
  sense; a screen WITH pull-to-refresh was not found.
- **Not reached — `budget` / `tap` unchecked wordings.** Not tried (`maxSwipes: 1` opportunistic; `tap` unit-only).

### Item f (no probe under the IME, `da3dfe7`)

- **Not reached — the < 80 px shape.** No screen gave a list whose top lies < 80 px above the IME top with a short target flush at its
  top. Measured candidates: landscape Settings search (rotation 1; IME band `[0,397][2220,1080]`, results list `list_results 0,245 2220x835`
  → 152 px of list above the IME; the first flush node `icon 312,245 66x232` runs under the IME, no short flush target);
  Account Detail with the search field focused (list top 825, IME top 1398 → 573 px). The bank SWIFT form and the Contacts editor have
  their containers at y 242 (≥ 1100 px above the IME). Rotation restored (`user_rotation 0`, `accelerometer_rotation 1`, as found).
- **Holds — contrast (≥ 80 px of list above the IME).** Account Detail, `accounts.detail.search_field` focused (docked IME, band
  `(0,1398,1080,2220)`, `mInputShown=true`), `filter_panel` flush at the list top 825. 11:35:58 `scroll_until { selector:
  "id:transactions.list.filter_panel", fully: true }` → `… fully visible after 1 swipe; its top edge lies on its scroll container's
  (0,825 1080x1395), and a probe swipe toward it moved nothing — nothing of it is cut there` (4.8 s). Probe `input swipe 540 1104 540
  1152 300`: start y 1104, end y 1152, both inside the list's part above the IME (825–1398). Note the probe is **48 px** here against
  177 px with the keyboard down on the same row: its touch-down (1104 = 0.2 of the whole container, 825 + 0.2 × 1395) is the container's,
  not the part above the IME, and the lift-off is then held short — see the §4 rows in
  [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md). 48 px is exactly
  2 × TOUCH_SLOP; it moved nothing here, which is right for a row that is not cut (the row read `0,825 1080x170` before and after; the keyboard-down screenshot of 11:28 shows it whole — none was taken on this IME-up run),
  but a 48-px probe on a CUT row was not tried, so whether it is long enough to reveal a cut is unmeasured. Search field still empty after.

## Device check (2026-10-09 Android, re-run at 86eb42d)

Measured 12:56–12:59 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify `fix/round-3` @
`86eb42d` (`dist/` built 12:50 UTC, HTTP daemon port 47821, cwd mp-native). mp-native Account Detail and SWIFT form (container
`0,242 1080x1736`; the pinned CONTINUE bar `66,1979 948x132` lies BELOW it, not over it). Rows placed by slow manual drags with the real
`adb`. Round-4 handoff items 1.5 (round-3 e) and §5 (SWIFT form).

- **Holds — carousel `fills`.** List at the top, bar shown. 12:56:28 `scroll_until { selector: "id:accounts.detail.header", fully: true }` →
  `Element id:accounts.detail.header fully visible after 0 swipes; but it fills its scroll container (0,275 1080x330) exactly — its top and bottom edges lie on the container's, where Android cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — it may be cut there, a rect assert or screenshot may measure part of it; usual for a card as tall as its carousel — check with a screenshot`
  (2.1 s), verbatim as at 347e70d; no stroke. Screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-25-0.png`.
- **Holds — top-edge probe with the tab bar shown.** 12:56:31 `scroll_until { selector: "id:transactions.list.filter_panel", fully: true }`
  → `Element id:transactions.list.filter_panel fully visible after 1 swipe; its top edge lies on its scroll container's (0,825 1080x1395), and a probe swipe toward it moved nothing — nothing of it is cut there`
  (4.8 s). Probe `input swipe 540 1104 540 1281 300` — identical to 347e70d (a finger-down probe is content-up, never cut by the bar).
- **Holds (§5) — Fees probe on the SWIFT form.** Keyboard down, `fees_select` read `66,242 948x121` (cut by the top bar). 12:59:42
  `scroll_until { selector: "id:swift_payment.form.fees_select", fully: true }` → `Element id:swift_payment.form.fees_select fully visible
  after 1 swipe` (8.0 s). Shim: one probe `input swipe 540 589 540 766 300` — finger DOWN, 177 px ≤ 178, inside the container, the same
  stroke as 347e70d. Row after `66,351 948x143`; screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-52-0.png` shows `Fees*` and its value whole. The overlay cut did not
  fire (the CONTINUE bar is not over the container).
