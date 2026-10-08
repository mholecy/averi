# BUG: `scroll_until` on Android ignores the soft keyboard — it reports an element under the IME "fully visible", and with the IME up its swipes start on the keyboard and scroll nothing

> **Status (2026-10-08):** fixed on branch `fix/keyboard-aware-scroll` (with [2026-10-05-android-floating-gboard-keyboard.md](2026-10-05-android-floating-gboard-keyboard.md)), unit-tested on fakes. Direction taken: "plan the stroke inside the uncovered box" — every round reads `readSoftKeyboard` (the oracle on Android, the WDA band on iOS) and, while a keyboard is shown, judges the stop against and draws the stroke in the screen above its top edge; nothing is pressed. After review: the band is applied only when it changes the round and the input method does not deny it (the guard's veto — the window state goes stale after a navigating tap; at most one witness query a round, asked on every round the band matters and never kept — a scroll can hide a confirmed keyboard), a band from the top edge fails at once naming it, and a round whose tree did not read keeps the last read round's stroke box. A stop clipped at the keyboard's edge and every failure name it (`… CLIPPED at bottom, 52% of it is in the viewport above the soft keyboard over [0,1398][1080,2220]`; with `fully: true`, a row still under it at the end of the content fails saying so, with how to hide it). Hiding first was not taken: a `back` (or a configured tap) from a step that sent none, the trade the tap guard rejected. Then **device-checked at `e9e6509`** (the two "Device check" sections below): on Android both symptoms hold fixed (each target in 1 swipe, 637 px a swipe, the clipped wording as designed), one gap — a row wholly under the IME at the end of a non-resizing container swiped for the full 15 s; under WDA the clipped wording holds and a down-swipe now moves the content, but two new failures came from the stroke drawn over the box above the keyboard — a stop caught mid-fling reported as reached (the row came to rest at y -48 / -121 / -133; once 613 → -357 and five more swipes down), and a content-up stroke starting at y 114 in the app's top bar that moved nothing. **Follow-up fix (branch `fix/r2-a-scroll`, after one review round; unit-tested on fakes, not yet run on a device):** (1) the stroke over a keyboard is still the uncovered box's, but its touch-down is never inside the keyboard clearance (0.8 of the uncovered height) nor higher than without a keyboard (`swipe.ts#swipeVectorAbove`; only the covered area's top edge is read) — iOS content-up 175 → 458 (was 114 → 458), Android content-up 444 → 1118 (was 280 → 1118); content-down unchanged, iOS 458 → 114 and Android 1118 → 280, as the device checks ran them (no length cut: the fling is answered by (2)); (2) a stop after a stroke is confirmed on one more read after a further settle, the target's rect unchanged — a moved target is judged from the new read, up to 3 such reads a stroke, then reported with `settled: false` ("still moving at the last read"), as is a stop at the deadline; a target a fling carried beyond the far edge after a read saw it short of it turns the next stroke round (`scroll.ts#Motion`), while it stays in the tree (no turn on a lazy list), and a failure counts the turns and says when the target was in the viewport but did not stay; (3) a target in the tree, off the frame, with a non-zero rect, that two identical strokes in a row left — with every other match — where it was fails then, cause "the last 2, swiping …, did not move it: content exhausted, or the swipes were not taken", in the stop bound's words (the keyboard and the remedy named) — `my_note_input` would fail after 2 swipes. Cost: every stop after a stroke spends one more settle, tree read and (Android) window query; a witness query only when the band matters on that read. To check on a device: the WDA runs of the iOS device check (priority_select / fees_select down, debit_select up, pad up) — whether the 344-pt content-down stroke's fling now ends in a confirmed stop after a turn — and on Android that each target is still reached in one swipe and `my_note_input` fails in two. Still open: iOS under the default `treeSource: idb` is unchanged — marking the keyboard idb carries on iOS 27 is a separate step; the pinned app chrome is its own note ([2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md](2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md)).

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
