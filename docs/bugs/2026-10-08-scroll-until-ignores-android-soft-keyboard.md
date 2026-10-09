# BUG: `scroll_until` on Android ignores the soft keyboard — it reports an element under the IME "fully visible", and with the IME up its swipes start on the keyboard and scroll nothing

> **Status (2026-10-08):** fixed on branch `fix/keyboard-aware-scroll` (with [2026-10-05-android-floating-gboard-keyboard.md](2026-10-05-android-floating-gboard-keyboard.md)), unit-tested on fakes. Direction taken: "plan the stroke inside the uncovered box" — every round reads `readSoftKeyboard` (the oracle on Android, the WDA band on iOS) and, while a keyboard is shown, judges the stop against and draws the stroke in the screen above its top edge; nothing is pressed. After review: the band is applied only when it changes the round and the input method does not deny it (the guard's veto — the window state goes stale after a navigating tap; at most one witness query a round, asked on every round the band matters and never kept — a scroll can hide a confirmed keyboard), a band from the top edge fails at once naming it, and a round whose tree did not read keeps the last read round's stroke box. A stop clipped at the keyboard's edge and every failure name it (`… CLIPPED at bottom, 52% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]`; with `fully: true`, a row still under it at the end of the content fails saying so, with how to hide it). Hiding first was not taken: a `back` (or a configured tap) from a step that sent none, the trade the tap guard rejected. Then **device-checked at `e9e6509`** (the two "Device check" sections below): on Android both symptoms hold fixed (each target in 1 swipe, 637 px a swipe, the clipped wording as designed), one gap — a row wholly under the IME at the end of a non-resizing container swiped for the full 15 s; under WDA the clipped wording holds and a down-swipe now moves the content, but two new failures came from the stroke drawn over the box above the keyboard — a stop caught mid-fling reported as reached (the row came to rest at y -48 / -121 / -133; once 613 → -357 and five more swipes down), and a content-up stroke starting at y 114 in the app's top bar that moved nothing. **Follow-up fix (branch `fix/r2-a-scroll`, after two review rounds; unit-tested on fakes, not yet run on a device):** (1) the stroke over a keyboard is still the uncovered box's, but its touch-down is never inside the keyboard clearance (0.8 of the uncovered height) nor higher than without a keyboard (`swipe.ts#swipeVectorAbove`; only the covered area's top edge is read) — iOS content-up 175 → 458 (was 114 → 458), Android content-up 444 → 1118 (was 280 → 1118); content-down unchanged, iOS 458 → 114 and Android 1118 → 280, as the device checks ran them (no length cut: the fling is answered by (2)); (2) a stop after a stroke is confirmed on one more read after a further settle, the target's rect unchanged — a moved target is judged from the new read, up to 3 such reads a stroke, then reported with `settled: false` ("still moving at the last read"), as is a stop at the deadline; a target a fling carried beyond the far edge after a read saw it short of it turns the next stroke round (`scroll.ts#Motion`), every turn halving the reach of the strokes after it so the scroll converges whatever the app flings (never restored after a turn; never under the larger of 48, twice an assumed 24-unit touch slop, and 3 % of the screen's side along the stroke — 67 px on the Pixel_3a's 2220 height, 26 pt on the iPhone so 48 there; `swipe.ts#shortenStroke`) — e.g. the 681 → -48 overshoot is followed by a 142-pt content-up stroke instead of the 283-pt one — while it stays in the tree (no turn on a lazy list), and a failure counts the turns and says when the target was in the viewport but did not stay; (3) a target in the tree, off the frame, with a non-zero rect, that two identical strokes in a row left — with every other match — where it was fails then, cause "the last 2, swiping …, did not move it: content exhausted, or the swipes were not taken", in the stop bound's words (the keyboard and the remedy named) — `my_note_input` would fail after 2 swipes; the `fully: true` clipped stop's "content exhausted" likewise takes two identical unmoved strokes (it took one). Cost: each confirming read is a round like any other — one more settle and tree read and, on Android, the round's keyboard reading: the window query, the touchable-region query while the keyboard reads shown, and a witness query only when the band matters on that read (1 to 3 adb calls; the table is on `soft-keyboard.ts#readSoftKeyboard`); the rounds number at most 1 + 4 × `maxSwipes` (25 at the defaults) within the deadline. To check on a device: the WDA runs of the iOS device check (priority_select / fees_select down, debit_select up, pad up) — whether the 344-pt content-down stroke's fling now ends in a confirmed stop after a turn, and how far a content-up stroke (175 → 458, and the halved 175 → 317) moves the form with the pad up (unmeasured; the fakes assume up to 650–729 pt) — and on Android that each target is still reached in one swipe and `my_note_input` fails in two. Still open: iOS under the default `treeSource: idb` is unchanged — marking the keyboard idb carries on iOS 27 is a separate step; the pinned app chrome is its own note ([2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md)); and a limitation, not a regression, seen in the Android device check below: uiautomator reports a node's bounds CLIPPED to its scroll container, so `fees_select` partly hidden under the top bar read `{y:242, height:99}` (its siblings are 143 high) and `scroll_until … fully: true` said `fully visible after 0 swipes` — averi cannot see the clipped part from the tree (an open follow-up, no fix designed yet).

**Measured 2026-10-08 16:19–16:21 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, SWIFT payment form
of PR #6, branch `feature/swift-payment`), emulator-5554 (Pixel_3a AVD, sdk_gphone64_arm64, Android 13, 1080x2220,
Gboard), averi = mobile-verify @ `c35388a` built from source (`npm run build`, `node dist/mcp/server.js` over stdio).

Two symptoms, one cause: `scrollUntilVisible` judges visibility against the whole screen and plans its stroke over the
whole screen, and neither asks the soft-keyboard oracle that the tap guard and the pixel poll already ask.

## Observed (measured)

The form was open with the numeric IME up after a `type_text` into `swift_payment.form.amount_input`. The window
manager's IME inset at the time (`adb shell dumpsys window displays`):

```
InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true
```

### 1. An element entirely under the keyboard is "fully visible after 0 swipes"

```
scroll_until { platform: android, selector: "id:swift_payment.form.priority_select", fully: true }
→ Element id:swift_payment.form.priority_select fully visible after 0 swipes          (2.0 s)

ui_snapshot { filter: "id:swift_payment.form.priority_select" }
→ rect {"x":66,"y":1906,"width":948,"height":73}
```

y 1906–1979 lies wholly inside the IME frame (y ≥ 1398). The screenshot taken right after shows the keyboard keys
where the field is; the field is not visible to the user at all. Reproduced at 16:20:00 UTC on a second element:

```
scroll_until { selector: "id:swift_payment.form.fees_select", fully: true }
→ Element id:swift_payment.form.fees_select fully visible after 0 swipes             (2.0 s)
rect {"x":66,"y":1719,"width":948,"height":143}     (inside [0,1398][1080,2220])
```

`fully: true` is the mode the tool description recommends "when the next step MEASURES the element (a rect assert, a
screenshot)" — here the next screenshot measures the keyboard.

### 2. With the IME up, scrolling DOWN never moves the content

```
scroll_until { selector: "id:swift_payment.form.payee_street_input" }
→ scroll_until id:swift_payment.form.payee_street_input failed after 15000ms (timeout) — element never appeared in the tree   (15.7 s)

16:20:44 UTC, again:
scroll_until { selector: "id:swift_payment.form.payee_street_input", maxSwipes: 2 }
→ scroll_until id:swift_payment.form.payee_street_input failed after 2 swipes (maxSwipes) — element never appeared in the tree   (7.4 s)
```

The screenshot after the first call shows the form at exactly the scroll offset it had before the call, IME still up
(`dumpsys input_method`: `mInputShown=true`). Then `press_key back` (IME down, `mInputShown=false`) and the same call:

```
scroll_until { selector: "id:swift_payment.form.payee_street_input" }
→ Element id:swift_payment.form.payee_street_input fully visible after 1 swipe       (4.7 s)
```

The opposite direction worked with the IME up (`direction: up` → `fully visible after 1 swipe`): a content-up stroke
STARTS in the upper part of the screen, above the keyboard.

The failure text says the element "never appeared in the tree", which is true, but nothing in it says the swipes landed
on the keyboard, so it reads as a wrong selector or a missing field.

## Why (read from the source)

- `src/interact/scroll.ts:119` takes the visibility frame from `adapter.viewport()` — the device screen size — and
  `:144` scores each candidate with `visibleFractionInViewport(node.rect, viewport)`. On Android the IME is a separate
  window, absent from the uiautomator tree, so the node keeps its at-rest rect and the screen frame counts it as
  visible. Nothing in `scroll.ts` reads the keyboard (`grep keyboard src/interact/scroll.ts` → no match).
- `:194–195` plans the stroke with `swipeVector(screenBox(...).box, direction, 'content')`: a stroke through the screen
  centre, `SWIPE_REACH_FRACTION = 0.3` (`src/interact/swipe.ts:25`) either side. On a 2220 px screen, content-down means
  the finger goes up from y ≈ 1776 — inside the IME frame (≥ 1398) — so the gesture starts on a key and the app's scroll
  container never receives it.
- The oracle already exists and is used by the two neighbours: `KeyboardOracle.state()`
  (`src/adapters/types.ts:279–292`) feeds the tap guard (`src/interact/keyboard.ts#resolveClearOfKeyboard`) and the pixel
  poll (`src/verify/pixel-poll.ts:397`, `readSoftKeyboard`), which since
  [2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md](2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md)
  fails closed on exactly this geometry. `scroll_until` (tool and flow `scroll_until:` step, `src/flow/engine.ts:1146`)
  is the remaining reader of element visibility that does not ask.

## Why it matters

- A false "fully visible" is the one answer `fully: true` exists to prevent; a rect/ocr/screenshot step after it measures
  the keyboard (the pixel assert now fails closed on that, a screenshot does not).
- The down-scroll failure costs a full `timeoutMs` (15 s default) per call and points at the selector. In a form flow
  the IME is up after every field, so "type, then scroll to the next field" — the natural sequence (the mp-native Maestro
  flows do `hideKeyboard` before every `scrollUntilVisible` for this reason) — fails this way every time.
- iOS is not affected the same way only by accident of source: with `treeSource: wda` the keyboard band is in the tree
  (`keyboardInTree`), but `scroll.ts` does not read that either (not measured on iOS in this session).

## Possible fix directions (owner's choice)

- Ask `adapter.keyboard?.state()` once per round in `scrollUntilVisible` and, when `shown`, shrink the visibility frame
  to the part of the screen above the band (so an element under it scores 0 or "clipped at bottom"), and either
  - hide the keyboard first with the same dismissal the tap guard uses (`dismissKeyboard`) and say so in the result,
    as `tap` does ("the soft keyboard covered …; hidden before tapping"), or
  - plan the stroke inside the uncovered box (centre and reach taken from the frame above the IME).
- At minimum, when the keyboard is `shown` at the stop, append it to the failure ("the soft keyboard covered
  [0,1398][1080,2220] during every swipe") and never report "fully visible" for a rect that overlaps the band.

## Repro

1. Any Android screen with a scroll container and a text field (here: mp-native SWIFT form, `run_flow
   goto_swift_payment_form`).
2. `type_text { selector: "id:<field near the top>", text: "1" }` — the IME comes up.
3. `scroll_until { selector: "id:<element under the IME's area>", fully: true }` → "fully visible after 0 swipes";
   `screenshot` shows keys over it.
4. `scroll_until { selector: "id:<element below the fold>" }` → times out, "element never appeared in the tree"; content
   did not move. `press_key back` (IME only), repeat step 4 → found after 1 swipe.

## iOS counterpart (measured 2026-10-08 16:37–16:40 UTC)

Same repo and form, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), default
`treeSource: idb`, same averi build (`c35388a`). The decimal pad was brought up by a focus tap on the amount field (no
typing — idb's HID typing parks the software keyboard; the simulator's `com.apple.keyboard.preferences`
`AutomaticMinimizationEnabled` / `HardwareKeyboardLastSeen` were set to `0` and the app relaunched to get the pad, and
restored afterwards).

**idb on iOS 27 does carry the keyboard** — contrary to the tap/type_text descriptions ("With treeSource: idb the tree
carries no keyboard", `src/mcp/tools.ts:359`) and `src/adapters/ios.ts:313`. The unfiltered tree with the pad up ends:

```
 button '1' None None 5 596 132 54     … button '0' 137 758 133 54, button 'Delete' 270 758 132 54
 other None None None 0 589 402 285    ← the keyboard's frame
```

and the form elements whose frames lie under that band are **missing** from the tree (fees_select, priority_select,
details_toggle, "PAYMENT DETAILS"), while a partly covered one keeps its full rect
(`value_date_select` `{y:545, h:52}`, bottom 597 > 589).

### 1. A partly covered element is "fully visible after 0 swipes"

```
scroll_until { selector: "id:swift_payment.form.value_date_select", fully: true }
→ Element id:swift_payment.form.value_date_select fully visible after 0 swipes        (0.4 s)
```

Its bottom 8 pt are under the keyboard band (y ≥ 589), and the screenshot shows the row hidden behind the pinned
CONTINUE bar (y 512–556) and the pad.

### 2. With the pad up, scrolling down never moves the content

```
16:39:10  scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }
→ scroll_until id:swift_payment.form.priority_select failed after 6 swipes (maxSwipes) — element never appeared in the tree   (8.0 s)
```

The screenshot after it shows the form at the same offset, pad still up; the amount field stayed empty (the strokes
started on keys but typed nothing). After the keyboard was hidden (tap on the title), the same kind of call scrolled
normally (`scroll_until text:"Payee’s street"` → `fully visible after 1 swipe`, 16:32). On a 874-pt screen the content-down
stroke starts at y ≈ 437 + 0.3·874 ≈ 699, inside the band (≥ 589).

### 3. The neighbouring tap on idb: a covered target "never appears"

```
16:39:43  tap { selector: "id:swift_payment.form.priority_select" }
→ Timed out after 5000ms waiting for element id:swift_payment.form.priority_select to appear     (5.8 s)
```

(also 16:38:5x for `fees_select`). The tap does not land on the pad — idb simply drops the covered node — but the
message says nothing about the keyboard that is in the same tree, and the description's idb sentence promises the tap
"is sent as before".

Why, on iOS: `scroll.ts` reads no keyboard (as above); the idb parse (`src/adapters/ios-tree-source.ts`,
`ios-node.ts`) marks no `keyboard` role, so `readSoftKeyboard` / the in-tree model sees nothing even though the keys and
the band `other` are there (the WDA source marks them via `wda-source.ts#keyboardMarks`). Fix direction for iOS: mark
idb's keyboard (the trailing key buttons and the 402-wide `other` at the bottom) the way the WDA source does, so the
existing guard, the pixel poll, and a keyboard-aware `scroll_until` all see it under the default tree source.

## Device check (2026-10-08, re-run at e9e6509): confirmed, one gap

Measured 19:47–19:57 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), mp-native SWIFT form,
averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). IME up after a `type_text` into the
amount field; `dumpsys window displays`: `InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] … visible=true`.

- Symptom 1 holds fixed. A row under the IME is no longer "fully visible after 0 swipes":
  ```
  scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }   (rect y 1749, under the IME)
  → Element id:swift_payment.form.priority_select fully visible after 1 swipe          (now at y 385)
  scroll_until { selector: "id:swift_payment.form.bank_city_input", fully: true }    (y 1658)
  → Element id:swift_payment.form.bank_city_input fully visible after 1 swipe           (now at y 1021)
  ```
- Clipped wording, default mode (rect y 1284–1427 against the band at 1398):
  ```
  → Element id:swift_payment.form.payee_country_select visible after 0 swipes — CLIPPED at bottom, 80% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. A rect assert or screenshot on this element will measure the CLIPPED box
  ```
- Symptom 2 holds fixed: with the IME up every downward `scroll_until` moved the content (IME still up after, `mInputShown=true`).
  The shorter stroke is enough for this Compose form: each target above was reached in 1 swipe; measured movement
  637 px for one swipe (bank_city 1658 → 1021); a first swipe from the top of the form moved 1364 px (fling).
- Keyboard down (B2): fill → tap that opened a dialog (the guard hid the IME) → Cancel → `scroll_until
  payee_name_input fully` → `fully visible after 1 swipe`, no keyboard mentioned, `mIsImeShowing=false` at the time.

Gap (minor): a row ENTIRELY under the IME at the end of a container that does not resize for the keyboard (the form's
last field, `my_note_input`, y 1769) does not get the fast "content is exhausted" failure — the stuck-rect check only runs
for a node that intersects the viewport, so it swipes until the 15 s timeout:
```
scroll_until { selector: "id:swift_payment.form.my_note_input", fully: true }                       (15.9 s)
→ scroll_until id:swift_payment.form.my_note_input failed after 15000ms (timeout) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] (last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 6 of the 6 rounds read: … hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again
```
The words are right (it names the keyboard and the remedy); only the 15 s are wasted. Direction: apply the same
`rectsEqual(prevRect, rect)` stuck test to a node that is in the tree but outside the viewport.

Unrelated limitation seen on the same screen (not a regression): Android reports a node's bounds clipped to its scroll
container, so `fees_select` partly hidden under the top bar came back as `{y:242, height:99}` (its siblings are 143 high)
and `scroll_until … fully: true` answered `fully visible after 0 swipes`. averi cannot see the clipped part from the tree.

## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:14–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
SWIFT form, averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). Scratch config with
`treeSource: wda` (mp-native's `averi.yaml` untouched); decimal pad up after `tap id:swift_payment.form.amount_input`
(simulator `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` set to 0 for the run, restored to 1), WDA
`role:keyboard` `0 572 402 302`. The CONTINUE bar is pinned at y 512–556 with the pad up.

**WDA — partly holds, two new failures caused by the shorter stroke box:**

- Holds — clipped wording: `scroll_until id:swift_payment.form.value_date_select` (rect y 545–597) → `visible after 0 swipes
  — CLIPPED at bottom, 52% of it is in the viewport above the soft keyboard over [0,572][402,874]. A rect assert or
  screenshot on this element will measure the CLIPPED box`. No more "fully visible after 0 swipes" for a row under the pad.
- Holds — a down-swipe with the pad up now moves the content (it did not move at all on idb before).
- **Fails — overshoot reported as success.** `scroll_until { selector: "id:swift_payment.form.priority_select", fully: true }`
  (row at y 681, under the pad), 3 of 3 runs → `Element id:swift_payment.form.priority_select fully visible after 1 swipe`
  (3.5 s), and a read 1 s later puts the row at **y -48 / -121 / -133** — above the top of the screen, behind the top bar
  (screenshot: the form shows Payee’s street … bank country; Priority is gone). The content-down stroke in the box above the
  pad (finger 458 → 114) flings the SwiftUI form ~730–800 pt; the round's read (settle 400 ms, `src/interact/scroll.ts:505`)
  caught the row mid-fling inside 0–572 and stopped. Worse case: `scroll_until id:swift_payment.form.fees_select` (y 613,
  just under the pad) → the one fling carried it from 613 to -357 without a read in between, and the loop kept swiping DOWN
  into exhausted content: `failed after 6 swipes (maxSwipes) — element in tree but never intersected the 402x572 screen above
  the soft keyboard … (last rect {"x":24,"y":-357,…})` (14.2 s). With the pad DOWN the same tool is fine
  (`payee_country_select` 1005 → `fully visible after 1 swipe`, at y 304 a second later; `debit_select` up, likewise).
- **Fails — content-up does not move at all with the pad up.** `scroll_until { selector: "id:swift_payment.form.debit_select",
  direction: "up", fully: true }` from a scrolled form → `failed after 6 swipes (maxSwipes) — element in tree but never
  intersected the 402x572 screen above the soft keyboard over [0,572][402,874] (last rect {"x":42,"y":-586,…})` (13.9 s); the
  row did not move. The finger-down stroke in the 0–572 box starts at y 286 − 172 = **114**, inside the app's top bar (it
  ends at ≈ y 116; status bar + nav bar with the title at y 73–95). Measured by hand: `swipe (201,114) → (201,458)` → row
  unchanged at y -55; `swipe (201,160) → (201,458)` → row to y 367. Before the fix the full-screen stroke started at
  y 437 − 262 = 175, below the bar, and worked. The failure text blames nothing but maxSwipes (and recommends hiding the
  keyboard, which would work, but for the wrong stated reason).
- Keyboard no longer up (B2): `type_text` into the amount (pad up) → `tap id:swift_payment.form.debit_select` (the sheet;
  `role:keyboard` 0 matches after) → pick a row → `scroll_until id:swift_payment.form.bank_country_select fully` → `fully
  visible after 1 swipe`, no keyboard mentioned.

Direction: on iOS the stroke box above the keyboard should also exclude the top inset (status bar + navigation bar — e.g.
start no higher than the first content node / the scrollable's visible top), and the stop should be judged on a settled
tree (two equal reads, or re-check the stop after a further settle) so a fling past the target is not reported as reached;
a stroke of fixed fraction over a 572-pt box was enough to fling this form ~2 screens.

**Default idb — unchanged, as documented in Status:** pad up after `tap text:"Value*"` (idb lists the keys and the band
`other 0 589 402 285`): `scroll_until value_date_select fully` → `fully visible after 0 swipes` (bottom under the band);
`scroll_until priority_select fully maxSwipes 2` → `failed after 2 swipes (maxSwipes) — element never appeared in the tree`;
`tap id:swift_payment.form.priority_select` → `Timed out after 5000ms waiting for element … to appear`. The server's
startup warning still says "the idb tree carries no keyboard", which is not true on iOS 27 (keys + band are listed).

## Device check (2026-10-09 Android, re-run at 610660f)

Measured 05:03–05:18 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio). **The mp-native SWIFT form was NOT reachable**: the bank app
had been logged out for inactivity and the PIN login was not permitted to this session, so every check below ran on stock
apps (Google Contacts "Create contact" editor, Settings). Strokes were recorded with an `adb` shim on the server's PATH.

- Holds — content-up stroke over the docked IME starts clear of the keyboard and not higher than without one:
  `scroll_until { selector: 'text:"First name"', direction: "up", fully: true }` (band `[0,1398]`) → `fully visible after 1
  swipe`, stroke `input swipe 540 444 540 1118 300`; with Gboard's band grown to `[0,1285]` the strokes were `444 → 1029`
  (0.8 × 1285). Content-down unchanged: `1118 → 280` (band 1398), `1029 → 257` (band 1285).
- Holds — clipped wording: `scroll_until text:"Last name"` (y 1317–1477, band 1398) → `visible after 0 swipes — CLIPPED at
  bottom, 51% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]. A rect assert or screenshot on this
  element will measure the CLIPPED box`.
- Holds — floating panel cut: see the Gboard note's 2026-10-09 section (`scroll_until text:"Mobile" fully` → 1 swipe, stroke
  `1016 → 254` = 0.8/0.2 of the panel top 1269).
- Holds — counts: "after 1 swipe", "after 2 swipes", "after 3 swipes".
- **Fails (new note)** — on this RecyclerView form the `fully: true` scroll to that clipped `Last name` flung it off the top
  in one stroke; the list dropped it from the tree; four more strokes went down into the end of the form and the call timed
  out at 15 s (`… element was in the viewport before the first swipe but did not stay — it is no longer in the tree …`). The
  same with no keyboard on Settings (`text:"Display"` never reached, 5 strokes). And a row wholly under the IME at round 0 was
  reported as `element never appeared in the tree`. Filed:
  [2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md](2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md).
- Not measurable on these fixtures: `my_note_input`'s "the last 2 … did not move it" failure (Contacts and Settings resize
  for the IME and uiautomator leaves rows under it out of the tree, so no target stays in the tree wholly under the keyboard),
  `settled: false` (not seen), the `fees_select` clipped-bounds limitation (mp-native only). The uiautomator clipping shows
  in another form on Settings: rows read with NEGATIVE heights right after a fling (`Accessibility … 306 -251`).
- Pinned top bar (Android): see [2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md) —
  the content-up `fully: true` stop certified `First name` at y 118–278, behind the Contacts top bar.

## Device check (2026-10-09 iOS, re-run at 610660f)

Measured 05:22–05:46 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`). **The mp-native SWIFT form was
not reachable this session**: the bank app was still logged in on the device, but every Hive read came back
`SUBGRAPH_RESPONSE_BODY_EMPTY` from `gds-business` (app log, 07:22–07:45 local — the no-session signature named in mp-native's
`scripts/hive-probe.mjs`), so the SWIFT form, the own-transfer form, the dashboard list and the Transactions tab all rendered
"That's an error"; logging in again was not permitted to this session. Fixtures instead: the bank app's account-detail screen
(search field + error state), the stock Contacts "New Contact" sheet (UIKit form, ~4 pages) and Settings (SwiftUI list).
Software keyboard raised by toggling `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen`
to false and switching apps (`launch_app` bank → `launch_app` Contacts) — a toggle plus focus change alone did not raise it
after a `fill` this time; both prefs restored to 1 at the end. Strokes recorded with an `idb` PATH shim logging every `idb ui
swipe|tap|text` the server sent.

**Partly measured: the strokes hold; the fling/turn path (the e9e6509 failures on the SwiftUI form) was not exercised** — no
stock fixture reproduced an overshoot, and the stock UIKit form hides the keyboard on drag.

Strokes as sent (idb shim), WDA, Contacts "New Contact" form:

| call (UTC) | keyboard | stroke sent | result |
|---|---|---|---|
| 05:36:28 `scroll_until role:text text:"add birthday"` fully | up, `0 573 402 301` | `swipe 201 459 → 201 115` (content-down, box above the pad) | `fully visible after 1 swipe` (16.6 s); row 1036 → 213, read 1 s later at 213 |
| 05:37:28 `scroll_until id:"First name"` up, fully | up | `swipe 201 175 → 201 459` (content-up, touch-down clear of the top bar) | `fully visible after 1 swipe` (15.5 s); First name -522 → 147 |
| 05:38:01 `scroll_until role:text text:"add date"` fully | down | `swipe 201 699 → 201 175` | `fully visible after 1 swipe` (16.4 s); at 242 a second later |

- Holds — content-up with the keyboard up now starts at **y 175** (was 114 at e9e6509, in the top bar) and moves the form
  (669 pt in one stroke). The content-down stroke is unchanged, 459 → 115 (the note's 458 → 114, rounded the other way).
- Contacts dismissed the keyboard during each drag (`role:keyboard` 0 matches after both keyboard-up calls); the replies
  said nothing about a keyboard, consistent with the band being gone by the stop read. So the halved stroke (175 → 317), a
  turn, `settled: false` and the turn count in a failure were not seen.
- Settings (SwiftUI list, keyboard down, WDA): `privacyAndSecurity` (lazy, not in the first tree) → `fully visible after 1
  swipe` (6.1 s, `699 → 175`), landed at y 403 and stayed; `general` up → `after 1 swipe` (5.7 s, `175 → 699`), y 293. No
  overshoot on either fixture (Contacts' UIKit form decelerates short of a screen; the SwiftUI form's ~730–800 pt fling was
  the case).
- Cost: on the Contacts sheet (≈320 nodes) one WDA read takes 3.5–4.5 s, so a 1-swipe `scroll_until` (the stop plus the
  confirming read) took 15.5–17.5 s; the same call on Settings (≈170 nodes) 5.7–6.1 s, and the bank screen reads in 0.5 s.
- Counts: `after 1 swipe`, `after 0 swipes` everywhere (singular/plural right).
- idb (`treeSource: idb`, unchanged by design): the server still prints, for a config that sets `keyboardDismiss` under idb,
  `app.ios.keyboardDismiss is set but app.ios.treeSource is idb: the idb tree carries no keyboard, so no tap is ever refused or
  hidden and the list is inert — set treeSource: wda for it to apply` (05:28 and 05:35 UTC) — while the same idb tree listed
  the keys as `button 'Q' 5 597 39 54` … `button 'return'` and the band `other 0 590 402 284` (Contacts, 05:26; the bank
  app's keys at 05:40). The sentence is still not true on iOS 27 (the conclusion — nothing is refused — is).

## Device check (2026-10-09 iOS bank form, re-run at 610660f)

Measured 05:56–06:08 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native SWIFT
form (`feature/swift-payment`, logged in by the owner-authorised PIN-only `login_pin_ios_here` after a cold relaunch; data
loaded), averi = mobile-verify `fix/keyboard-aware-scroll` `dist/` built at `610660f` (the branch head has since moved to
`57dd6ac`; `dist/` predates those commits — no `fill-verdict.js` in it), stdio, cwd `/Users/mholecy/Finshape/mp-native`.
Scratch configs only (`treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`; mp-native's `averi.yaml`
untouched). Decimal pad raised the round-1 way: `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled` /
`HardwareKeyboardLastSeen` set to NO before a cold relaunch, then a focus TAP (not a fill) on
`id:swift_payment.form.amount_input` → WDA `role:keyboard` `0 572 402 302`; prefs restored to 1 at the end. Strokes and taps
recorded with an `idb` PATH shim.

**Holds (WDA, pad up)** — the fling past the target is now answered by a turn with a halved stroke and a confirmed stop;
content-up from y 175 moves the form. No `settled: false` seen.

| call (UTC) | strokes sent (idb shim) | reply | rows ~1 s later (WDA) |
|---|---|---|---|
| 05:59:16 `scroll_until priority_select` fully | `458 → 114`, then `175 → 317` (turned, halved) | `fully visible after 2 swipes` (10.6 s) | priority `y 190`, fees 122, keyboard `0 572 402 302`; same at 05:59:37 |
| 05:59:48 `scroll_until debit_select` up, fully | `175 → 458` | `fully visible after 1 swipe` (7.4 s) | debit -341 → `150` (≈ 491 pt) |
| 06:00:11 `scroll_until fees_select` fully | `458 → 114`, `175 → 317` | `fully visible after 2 swipes` (9.1 s) | fees `y 122`, priority 190 |
| 06:00:24 debit up | `175 → 458` | `after 1 swipe` (7.6 s) | debit `150` |
| 06:00:35 priority | `458 → 114`, `175 → 317` | `after 2 swipes` (10.6 s) | priority `y 230` |
| 06:00:49 debit up | `175 → 458` | `after 1 swipe` (7.4 s) | debit `150` |
| 06:01:01 priority | `458 → 114`, `175 → 317` | `after 2 swipes` (10.6 s) | priority `y 234` |

Every stop lies inside the 0–572 box above the pad and below the top bar (≈ y 116); a screenshot at 05:59:4x shows Fees and
Priority under the title, the pad up. Round 1 (e9e6509) reported the same calls "after 1 swipe" with the row at -48 / -121 / -133
and fees at -357. The halved content-up stroke (`175 → 317`) was the turn after each down fling; the full content-up stroke moved
the form ~491 pt (content top reached). The reply does not mention the turn (fine — the count is right).

- Not seen: `settled: false`, a turn count in a failure (no failure occurred), "the last 2 … did not move it".

## Device check (2026-10-09 Android bank form, re-run at 610660f)

Measured 05:58–06:05 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), mp-native SWIFT form
(`com.finshape.skeleton.dev`, logged in by the owner; Account Detail → PAY → SWIFT payment), averi = mobile-verify
`fix/keyboard-aware-scroll`, `dist/` built 06:59 local from `610660f` (stdio). Strokes from an `adb` shim on the server's PATH.
IME up after `type_text` into the amount (`ITYPE_IME frame=[0,1398][1080,2220] visible=true`, `mInputShown=true` throughout).

- **Holds** — `priority_select` (y 1749, under the IME) `fully: true` → `fully visible after 1 swipe` (7.4 s), stroke
  `input swipe 540 1118 540 280 300`, row at y 378 after.
- **Holds** — `fees_select` down (from the top, y 1562) → `fully visible after 1 swipe` (7.3 s), stroke `1118 → 280`.
- **Holds, 2 swipes not 1** — `debit_select` `direction: "up"` from the bottom of the form → `fully visible after 2 swipes`
  (10.1 s), strokes `input swipe 540 444 540 1118 300` ×2 (the new content-up touch-down, 444 → 1118). Geometry, not a
  defect: the form had to come back 1371 px (priority 1749 → 378) and this stroke moved it ≈ 674 px with no fling; at
  `e9e6509` the stroke was 280 → 1118. `iban_input` up likewise took 2 swipes.
- **Holds** — `my_note_input` (wholly under the IME at the end of the non-resizing form) `fully: true` → fails in 10.5 s
  (was 15.9 s), 3 strokes (the first moved the form to its end, the last 2 did not):
  ```
  scroll_until id:swift_payment.form.my_note_input failed after 3 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] (last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 4 of the 4 rounds read: … hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again
  ```
- Not seen: `settled: false` (every stop confirmed; no "still moving").
- **The clipped-bounds limitation still shows, and also after a swipe and at the bottom edge.** (1) `fees_select` read
  `{y:242, height:92}` under the top bar → `fully visible after 0 swipes` (screenshot: the `Fees*` label cut by the bar).
  (2) The `fees_select` down scroll above stopped with the row at `{y:242, height:103}` — 40 px behind the top bar — and said
  `fully visible after 1 swipe`. (3) Keyboard down: `priority_select` `{y:1846, height:133}` (container ends at 1978, the
  pinned CONTINUE bar at 1979–2111) → `fully visible after 0 swipes`; screenshot shows its lower edge cut by the bar. uiautomator
  clips each node to its scrollable (`bounds="[0,242][1080,1978]"`), so a `fully: true` stop against either edge of a Compose
  scroll container is not proof. A height check against siblings is not available from the tree; the scrollable's own bounds
  are (both cuts sit exactly on them).

## Device check (2026-10-09 Android, re-run at 347e70d)

Measured 11:30–11:42 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify `fix/round-3` @
`347e70d` (`dist/` built 11:21 UTC, stdio, cwd mp-native). Fixtures: mp-native SWIFT form (IBAN focused, holding
`AT611904300234573201`; IME `[0,1398][1080,2220]`, `mInputShown=true` before and after every call), Google Contacts "Create contact"
(`First name` focused; Gboard `[0,1398]`, growing to `[0,1285]` with its suggestion strip). Strokes from the `adb` shim. Handoff items j
(SWIFT IME-up), g, h and §4.

- **Holds (j) — `my_note_input`.** 11:30:38 `scroll_until { selector: "id:swift_payment.form.my_note_input", fully: true }` →
  ```
  scroll_until id:swift_payment.form.my_note_input failed after 5 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes were not taken) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] (last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 6 of the 6 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — to reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again
  ```
  (17.9 s; at 610660f 3 swipes / 10.5 s). Strokes `input swipe 540 1167 540 473 695` ×5 — 694 px at 695 ms each (drag, not fling), so
  3 strokes to the end of the form instead of 1, then the 2 unmoved. Screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-46-0.png`: keyboard up, form at its end.
- **Holds (j) — `debit_select` up, with a still-moving note.** 11:31:09 `scroll_until { selector: "id:swift_payment.form.debit_select",
  direction: "up", fully: true }` → `Element id:swift_payment.form.debit_select fully visible after 4 swipes; still moving at the last read
  (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match` (16.6 s). Strokes `540 589 540 1167 579`
  ×3, then `540 589 540 734 300` (145 px — the shortened stroke). debit_select `66,286 948x297` after (the form's top); screenshot
  `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-49-0.png` shows it whole, IBAN unchanged (the screenshot itself warned "did not settle", the caret). The `settled: false` is
  the one-off kind handoff §3 lists; probably the top-edge stretch overscroll still animating at the last read — not chased.
- **Holds (g) — Contacts, strokes over the editor's container above the IME.** `First name` focused (the editor's scroll container
  resizes to the IME: `0,242 1080x1156`, later `0,242 1080x1043`). 11:40:51 `scroll_until { selector: 'text:"Notes"', fully: true }` →
  `Element text:"Notes" fully visible after 3 swipes` (16.2 s): `540 1167 540 473 695` ×2, then `540 1077 540 921 300` (Gboard had
  grown to 1285; 1077 = 242 + 0.8 × 1043). 11:41:23 `text~"[Ff]ields"` → `Element text~"[Ff]ields" fully visible after 1 swipe` (7.6 s),
  `540 1077 540 451 627`. 11:41:38 `text:"First name"` up → `fully visible after 2 swipes` (10.8 s), `540 451 540 1077 627` ×2. No
  stop said "judged above the soft keyboard" — the container already ends at the IME top, so the band never changed a stop (the
  plain wording is the expected one then). Every stroke inside the container and above the IME top of its round.
- **Not reached (g) — sibling case.** No screen with two scrollers (a form over a list) was found on these fixtures.
- **Holds (h) — nothing typed.** After every IME-up run: IBAN still `AT611904300234573201` (tree `val`, screenshots 46/49), Contacts
  `First name` still its hint (`val='First name'`), bank search field empty; the shim shows only `input swipe` lines during these
  calls — no `keyevent` or `input text` I did not send. Both ends of every stroke lie above the IME top (table below).

### §4 — stroke y vs the IME top (every IME-up stroke of this run)

| time | call | stroke (shim) | length, ms | IME top | container (tree) |
|---|---|---|---|---|---|
| 11:30:40 ×5 | SWIFT `my_note_input` | 540 1167 → 540 473 | 694, 695 | 1398 | 0,242 1080x1736 |
| 11:31:11 ×3 | SWIFT `debit_select` up | 540 589 → 540 1167 | 578, 579 | 1398 | 0,242 1080x1736 |
| 11:31:23 | (same, shortened) | 540 589 → 540 734 | 145, 300 | 1398 | 0,242 1080x1736 |
| 11:34:55 | SWIFT `fees_select`, Gboard FLOATING | 540 1064 → 540 448 | 616, 617 | 1269 (panel top) | 0,242 1080x1736 |
| 11:36:00 | Account Detail `filter_panel` probe (f contrast) | 540 1104 → 540 1152 | 48, 300 | 1398 | 0,825 1080x1395 |
| 11:40:53 ×2 | Contacts `Notes` | 540 1167 → 540 473 | 694, 695 | 1398 | 0,242 1080x1156 |
| 11:41:02 | (same, shortened) | 540 1077 → 540 921 | 156, 300 | 1285 | 0,242 1080x1043 |
| 11:41:25 | Contacts `Add fields` | 540 1077 → 540 451 | 626, 627 | 1285 | 0,242 1080x1043 |
| 11:41:40 ×2 | Contacts `First name` up | 540 451 → 540 1077 | 626, 627 | 1285 | 0,242 1080x1043 |

Reading: on the SWIFT form and Contacts the strokes are 0.8/0.2 (0.3/0.8 for content-up) of the container cut at the IME top
(242 + 0.8 × 1156 = 1167; 242 + 0.8 × 1027 = 1064 floating), so cutting the box earlier would change nothing there. The one stroke drawn
from the UNCUT box is the Account Detail probe: its touch-down 1104 is 0.2 of the whole container (825 + 0.2 × 1395) and its lift-off is
held at 1152, a 48-px probe where the same row with the keyboard down got 177 px (`540 1104 540 1281`). That is the case where cutting the
box at the keyboard first would change the stroke's length.

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder:
`scratchpad/averi-repo/run5-ios`. Bank app: cold relaunch at 11:36:52 (with the hardware-keyboard prefs off), PIN-only
`login_pin_ios_here` (11:37:11, `branch: matched state logged_in`), Account Detail → PAY → SWIFT payment.

iOS WDA, keyboard up, a target under it / below the fold.

- **Holds — SWIFT form** (scratch `treeSource: wda`, decimal pad up after a focus tap on the amount, `keyboard 0 572 402 302`;
  target `payee_country_select 24 1005 354 52`):
  ```
  11:38:50 scroll_until { selector: "id:swift_payment.form.payee_country_select", fully: true }                    (8.0 s)
  → Element id:swift_payment.form.payee_country_select fully visible after 1 swipe
  shim: 11:38:52 ui swipe 201 458 201 114 --duration 0.3          (both ends above the keyboard top 572)
  ```
  After: target `24 306 354 52` (bottom 358 < 572), the pad still up, the amount field empty (no key typed). Screenshot
  `run5-ios/img-105-0.png`.
- **Holds — Contacts "New Contact"** (keyboard `0 573 402 301`, target the cell `container 'add related name' 20 1171 362 52`):
  `11:35:11 scroll_until { selector: 'role:container label:"add related name"', fully: true }` → `Element … fully visible after
  1 swipe` (17.7 s); shim `11:35:14 ui swipe 201 459 201 115 --duration 0.3`; after: `20 342 362 52`. UIKit dismissed the
  keyboard on the drag (`0 matches for role:keyboard` after; the sheet's own behaviour).
- **New, not a regression of this fix — a false `fully visible after 0 swipes` under WDA** for the same row's TEXT
  (`role:text text:"add related name"`, 11:34:15, 3.4 s, no swipe): WDA lists an off-screen cell's StaticText at a parked frame
  `0,62 286x22` inside the viewport. Filed as
  [2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md](2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md).
- Seen on the idb side, by design (the tool description states idb reads no keyboard): `scroll_until
  id:swift_payment.form.debit_select direction: up fully: true` (11:39:21, default idb; the decimal pad was up at the last WDA
  read, ~11:39:00, and nothing hid it in between) swiped
  `201 175 → 201 699` — lift-off inside the keyboard band; nothing was typed (amount still empty after).

## Device check (2026-10-09 Android, re-run at 86eb42d)

Measured 12:57–13:01 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify `fix/round-3` @
`86eb42d` (`dist/` built 12:50 UTC, HTTP daemon port 47821, cwd mp-native). Fixtures: Google Contacts "Create contact" (`First name`
focused by an averi `tap`, IME `[0,1398]`, growing to `[0,1285]`), mp-native SWIFT form (IBAN focused and typed
`AT611904300234573201` by `type_text`; IME `[0,1398][1080,2220]`, `mInputShown=true` before and after), Account Detail with the search
field focused. Strokes from the `adb` shim. Round-4 handoff items 1.5 (round-3 g/h) and §5 (SWIFT `my_note_input`).

- **Holds (g) — Contacts editor, IME up.** 12:57:27 `scroll_until { selector: 'text:"Notes"', fully: true }` → `Element text:"Notes" fully
  visible after 3 swipes` (14.1 s): `540 1167 540 473 695` ×2, then `540 1077 540 451 627` (Gboard grown to 1285; 242 + 0.8 × 1043).
  12:57:41 `text~"[Ff]ields"` → `fully visible after 0 swipes` (2.1 s; the third Notes stroke was a full one, at 347e70d a 156-px
  shortened one, so Add fields was already on screen). 12:57:43 `text:"First name"` up → `fully visible after 2 swipes` (10.8 s),
  `540 451 540 1077 627` ×2. Every stroke inside the editor's container and above the IME top of its round — the table's values unchanged.
- **Holds (h) — nothing typed.** Contacts `First name` still its hint (`val='First name'`) after; IBAN still `AT611904300234573201` after
  every SWIFT call (tree `val`, screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-69-0.png`); bank search field empty after the 1.6 call. The shim shows no `keyevent`
  / `input text` I did not send (the only ones are the `type_text` fill's 20 `input text` + `keyevent 21/22`).
- **Holds (§5) — SWIFT `my_note_input`, IBAN focused: no overlay cut.** 13:00:33 `scroll_until { selector:
  "id:swift_payment.form.my_note_input", fully: true }` →
  ```
  scroll_until id:swift_payment.form.my_note_input failed after 15000ms (timeout) — element in tree but never intersected the 1080x1398 screen above the soft keyboard over [0,1398][1080,2220] (last rect {"x":66,"y":1769,"width":948,"height":143}). The soft keyboard was up over [0,1398][1080,2220] in 5 of the 5 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — to reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again
  ```
  (15.9 s). Strokes `input swipe 540 1167 540 473 695` ×4 — the round-3 stroke exactly; the CONTINUE bar did not cut the box. At 347e70d the
  same call ended `failed after 5 swipes (the last 2 … did not move it …)` in 17.9 s; here the rounds ran ~0.2 s slower and the 15 s ran
  out after the 4th stroke, before the second unmoved one — the budget, not the rule. Re-run at the form's end, 13:00:57 → `scroll_until
  id:swift_payment.form.my_note_input failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted, or the swipes were
  not taken) — element in tree but never intersected the 1080x1398 screen above the soft keyboard … in 3 of the 3 rounds read …` (8.4 s),
  `540 1167 540 473 695` ×2 — the round-3 wording. Screenshot `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-57-0.png`: keyboard up, form at its end.

### §4 — stroke y vs the IME top (every IME-up stroke of this run)

| time | call | stroke (shim) | length, ms | IME top | container (tree) |
|---|---|---|---|---|---|
| 12:57:29 ×2 | Contacts `Notes` | 540 1167 → 540 473 | 694, 695 | 1398 | 0,242 1080x1156 |
| 12:57:36 | (same) | 540 1077 → 540 451 | 626, 627 | 1285 | 0,242 1080x1043 |
| 12:57:46 ×2 | Contacts `First name` up | 540 451 → 540 1077 | 626, 627 | 1285 | 0,242 1080x1043 |
| 12:58:39 | Account Detail `row_2` (search focused) | 540 1284 → 540 940 | 344, 345 | 1398 | 0,825 1080x1395 |
| 13:00:35 ×4 | SWIFT `my_note_input` | 540 1167 → 540 473 | 694, 695 | 1398 | 0,242 1080x1736 |
| 13:00:59 ×2 | (same, at the form's end) | 540 1167 → 540 473 | 694, 695 | 1398 | 0,242 1080x1736 |
| 13:02:33 | SWIFT `fees_select`, Gboard FLOATING | 540 1064 → 540 448 | 616, 617 | 1269 (panel top) | 0,242 1080x1736 |

Reading: every touch-down and lift-off lies above the IME top. The Account Detail stroke is new to the table: the list's box is cut at the
IME top (825 + 0.8 × 573 = 1283), and the tab bar, in the tree at 1876 but drawn under the IME, did not cut it further.
