# Handoff: on-device check of round 9 (`arch/round-9` @ `3492318`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 9 is still being reviewed and fixed
> (per-branch review loop, then the round's code review and its fixes): do not check out, build or test anything. When
> it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the title and the expected replies below are final:
> start. Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. Round 9 = branch `arch/round-9` = `fix/round-8` @ `0ff6df3` (round 8) + the
first architecture deepening of the 2026-10-12 review: **scroll containers** (spec A). It is a refactor with four
deliberate behaviour changes (items W, M, S and F below); everything else must behave exactly as at `0ff6df3`.

**Order:** round 8 was checked at `0ff6df3` and held (its section 6). Run section 3 below as the regression list, then
section 4. The two new notes from round 8's check (Android navigation bar, iOS bouncing list end) are NOT fixed in this
round — do not re-check them here.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. What changed

| item | what changes | where it shows |
|---|---|---|
| W | iOS + Android: a **web view scrolls**. Web content scrolled under a native bar is scrolled content, not a cover of the bar's buttons | a tap on a native top-bar button over a scrolled web page is tapped, where it used to be refused "covered by link …" |
| S | Android: a row is widened under an overlay (`cutBounds` in `ui_snapshot`) **only when draw order says something drawn meets the gained strip** — a screen-sized wrapper with nothing of its own there (a snackbar host) no longer widens rows | rows near a shown snackbar keep their dumped rect; no `cutBounds` on them |
| F | Android: a list-sized layer listed after a list that holds the list whole, with its own content elsewhere (e.g. a floating-action-button host), no longer widens rows | rows near a FAB keep their dumped rect |
| M | iOS + Android: content of a scroller (web view or native list) is excused as "scrolled content" **only when the scroller lives on the same screen as the target** (its nearest screen-sized layer also holds the target). A scroller in a LATER screen-sized layer — an RN transparent Modal's WebView, a full-screen sheet's list — covers the screen beneath again | a tap on a control of the screen beneath such a modal/sheet is refused as covered (or aims clear of it), never tapped through |
| — | `ui_snapshot`'s tool text now says one dump cannot tell a sticky header from the next row of the same list (a row overflowing into the next row may carry `cutBounds`), and that a snackbar host never causes it | tool description only |

Internals (no expected device effect): one module now owns "clips" / "scrolls"; the Android parser asks draw order
through a port instead of its own walk; a test checks that every code reference in comments resolves.

## 2. Build

1. Run `git checkout arch/round-9` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as in rounds 3–8: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)` at the end
of the bug note named in its item (items W/S/F have no bug note: record them in the results table below, and anything
that fails goes into a new bug note); commit only notes, and only if the owner asks; leave `docs/architecture-reviews/`
alone.

## 3. Regression: Android widening and taps must be unchanged

1. mp-native Account Detail: `row_0` under the sticky date header (the run9 shape) still carries `cutBounds`; a tap on it
   aims below the header; `scroll_until … fully: true` on it still strokes.
2. The round-5 floating tab bar: only `row_29` / `row_30` at the bar carry `cutBounds` — as in round 5.
3. Google Contacts: the padded icon buttons (132 / 110 / 66) tap as before; with the IME up, "Add fields" / "Add phone"
   are refused or tapped exactly as in round 8.
4. The round-8 checklist items N1, A2, B1 (Android) give the same replies as in round 8.

## 4. Round 9 checklist

### W. A web view scrolls (iOS, both WDA and idb if available; Android optional)
1. A screen with a WKWebView (an in-app browser, or an RN `WebView`) under a native navigation bar. Scroll the page so
   that a link sits under the bar. `tap` the bar's Back (or close) button → **tapped**, the screen leaves. Never
   "covered by link …".
2. A link of that page under the status band (y < 62): `tap` it → refused with `… it lies in a scroll view — scroll_until it
   first …` (unchanged).
3. **Record:** `ui_snapshot` of that screen once (attach the path) — the web view's role and its children.

### S. Snackbar over a list (Android)
1. A list screen where an action shows a snackbar (delete with undo, or a "Saved" message), on a Compose app if
   available. While the snackbar shows: `ui_snapshot` → the rows near the bottom carry **no** `cutBounds`.
2. `tap` a row just above the snackbar → tapped on the row (not on the snackbar).
3. `tap` the snackbar's action ("Undo") → tapped.

### F. Floating action button over a list (Android)
1. A list with a FAB (e.g. Contacts' "+" / Gmail's Compose) whose host layer is the list's size: `ui_snapshot` → the
   rows near the FAB carry no `cutBounds`.
2. `tap` a row whose centre is clear of the FAB → tapped on the row. A row whose centre lies under the FAB → refused as
   covered by the FAB (or the tap aims at its uncovered part), never tapped through the FAB.

### M. A scroller in a later layer covers the screen beneath (iOS; Android if a shape exists)
1. A WebView (or a native list) shown in a full-screen RN transparent `Modal` or a full-screen sheet, over a screen whose
   native button lies under the web content: `tap` that button → refused as covered by the web content (or aimed at a part
   clear of it), never tapped through to the page. Record the reply.
2. **Must still hold:** item W.1 (Back over a web page scrolled under the bar, same screen) is tapped; the round-8 iOS
   checks of Back over a form scrolled under the navigation bar are tapped.
3. The SWIFT form (WDA) scrolled so its rows sit under the navigation bar: `tap` Back → **tapped** (the logged
   2026-10-08 shape). **Record** the `ui_snapshot` of that screen either way (path in the table): the bar branch's
   nesting was reconstructed, and this tree becomes the fixture that pins it. If it is refused as covered by a form row, record a `ui_snapshot` path — that is the stated residual
   "a navigation bar nested in its own full-screen host reads as a second screen" and the owner must see the tree.
4. If the reply in 1 says "covered" but the button is in fact visible and tappable on screen, record it as a new bug note
   with a `ui_snapshot` path.

### S2. Android sheet with a classic list (optional, if available)
1. A bottom sheet whose content is a classic `RecyclerView`/`ListView` over another list: `ui_snapshot` → rows of the list
   beneath carry no `cutBounds` from the sheet; record the reply of a `tap` on a row beneath.

### Optional
- A Compose bottom-sheet scrim over a list: the rows behind it are not tappable through the scrim; record what the
  reply says.

## 5. Out of scope: do not report these as regressions
- A row whose touch target overflows into the NEXT row of the same list may still carry `cutBounds` (one dump cannot tell
  that from a sticky header) — stated as permanent.
- A bare, childless, unlabelled overlay node listed after a row no longer widens it.
- idb (flat list): "lies in a scroll view" stays unknown (no remedy claims a scroll).
- Everything in section 5 of the round-8 handoff.

## 6. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-8 regression (section 3) | Android | | | |
| W web view scrolls | iOS WDA / idb (Android optional) | | | |
| S snackbar over a list | Android | | | |
| F FAB over a list | Android | | | |
| M scroller in a later layer | iOS (Android if found) | | | |
| S2 sheet with a classic list | Android | | | |
| optional: bottom-sheet scrim | Android | | | |


## Device check (2026-10-13)

Round 9's checklist was run at `20307d2` together with round 12, as its Order section asks. Results: `docs/handoff/2026-10-13-device-check-round-12.md` section 6 (one table per platform, rows by round and item) and the `## Device check (2026-10-13 …, re-run at 20307d2)` sections at the end of each bug note named in the items.
