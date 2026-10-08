# BUG: `scroll_until` on Android ignores the soft keyboard — it reports an element under the IME "fully visible", and with the IME up its swipes start on the keyboard and scroll nothing

> **Status (2026-10-08):** fixed on branch `fix/keyboard-aware-scroll` (with [2026-10-05-android-floating-gboard-keyboard.md](2026-10-05-android-floating-gboard-keyboard.md)), unit-tested on fakes, **not yet run on a device**. Direction taken: "plan the stroke inside the uncovered box" — every round reads `readSoftKeyboard` (the oracle on Android, the WDA band on iOS) and, while a keyboard is shown, judges the stop against and draws the stroke in the screen above its top edge; nothing is pressed. After review: the band is applied only when it changes the round and the input method does not deny it (the guard's veto — the window state goes stale after a navigating tap; one witness query per call), a band from the top edge fails at once naming it, and a round whose tree did not read keeps the last band's stroke box. The result and every failure name the keyboard (`… above the soft keyboard over [0,1398][1080,2220]`; with `fully: true`, a row still under it at the end of the content fails saying so, with how to hide it). Hiding first was not taken: a `back` (or a configured tap) from a step that sent none, the trade the tap guard rejected. To check on a device: the Repro below (symptoms 1 and 2) on the Pixel_3a AVD; the same with `treeSource: wda` on iOS; and whether the shorter stroke (838 px over the box above the IME, against 1332 px over the whole screen) still moves a RN form enough per swipe. Still open: iOS under the default `treeSource: idb` is unchanged — marking the keyboard idb carries on iOS 27 (the iOS counterpart's fix direction) is a separate step, needing an iOS 26.5 vs 27 device comparison first.

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
