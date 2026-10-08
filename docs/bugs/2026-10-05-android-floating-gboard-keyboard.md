# BUG: Android floating Gboard is invisible to the keyboard handling (Maestro `hideKeyboard` measured; averi suspected)

> **Status (2026-10-08, after the device checks):** measured and fixed on branch `fix/r2-d-gboard` (on top of `fix/keyboard-aware-scroll`, with [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md)); the fix is not yet re-checked on a device. **What the device checks found** (the three sections at the end): on API 33 a floating Gboard is NOT "window clear" — `ITYPE_IME` keeps a 132-px band (`[0,2088][1080,2220]`, `visible=true`, `mInputShown=true`), so the dismissal reads `covering` and presses `back`, which hid it and left the form (correct, by the old row); the panel is a second rect of the IME window's `touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))`, and the band alone let a guarded tap press Gboard's `d` key and `scroll_until … fully` call a row behind the panel "fully visible after 0 swipes". **The fix:** `KeyboardOracle.touchable()` (adapters/android.ts#keyboardTouchable — one adb call, `dumpsys input_method | grep -m1 -w mInputShown; dumpsys window InputMethod | grep -F 'touchable region='; true`, `parseTouchableRegion`) is asked by `ui-tree/soft-keyboard.ts#readSoftKeyboard` only after `state()` read shown; `panelsBeyond` admits a rect only when the same call's `mInputShown` is true, the region holds the band exactly (the stale-landscape region does not), the rect lies inside the screen the band spans and is not the band; the reading carries them as `panels`, and every reader tests `keyboardRects` — the tap guard (`keyboardOver`: a point under the panel takes the band's path, witness → one `back` → one look), the pixel poll (the covered miss quotes the panel) and `scroll_until` (its cover cut above the highest covered rect, `highestCover`: a target behind the panel is not certified, the stroke starts above it). Docked: the region is the band, nothing beyond it, behaviour unchanged (pinned). Cost: one more adb call per keyboard read that finds the band up — a guarded tap with the keyboard up pays two calls instead of one, likewise a pixel-poll or `scroll_until` round; none while it reads hidden or unknown. The earlier SAFE-direction row stays: `src/interact/keyboard-window.ts#dismissal`'s window `clear` + witness `shown` → `unlocated` (nothing pressed, a `⚠ fill` warning; `scroll_until` says so on a failed or `fully: true` stop) — it was never reached by a floating Gboard on API 33; its sentence now names "one still coming up?" (the transient read right after the focus tap) instead of "a floating keyboard?". Residuals: the transient window-hidden read right after the focus tap (no band, so no region is read: that one look fails open as before); a panel abutting the band in the same rows would merge with it in the SkRegion and the region would be ignored (unmeasured); the combined command's cost and `grep -F` on toybox are unmeasured; split keyboards and API 34+ unmeasured. Note: the code quoted below as `src/interact/keyboard.ts dismissKeyboard()` moved in `0e48a63` (2026-10-07): the decision is `src/interact/keyboard-window.ts#dismissal`.

**Measured 2026-10-05** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`), emulator-5554 (Pixel_3a AVD,
API 33, 1080x2220), app `com.finshape.skeleton.dev`, flow `android/.maestro/own-transfer.yaml` run through
`scripts/run-maestro.sh`. Filed from the SWIFT-payment journey-developer run (run folder
`debug-ai-logger/2026-10-05-1304-swift-payment/infra-recovery.md`, attempts 1–3).

## Observed (measured)

Gboard was in **floating** mode (the detached suggestion bar, "I'm · I · ok · 🎤", drawn mid-screen at roughly
y 1220–1350 of 2220, with a separate collapse strip at the very bottom). Most likely it was switched on by hand during a
manual device registration that morning.

1. `own-transfer.yaml`: `tapOn payment.form.amount_input` → `inputText "1.00"` → **`hideKeyboard` FAILED**. Twice in a
   row, same step, same signature.
2. After the failure the app was back on **Home**: the form had been popped, the Home search field was focused and the
   floating bar was still up. The flow header already documents this trap ("a bare back press with the IME already down
   pops the whole form").
3. While the floating bar was up:
   ```
   $ adb shell dumpsys input_method | grep -E 'mInputShown|mIsInputViewShown'
     mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true
     mIsInputViewShown=true mStatusIcon=0
   ```
   One `adb shell input keyevent 4` → `mInputShown=false`, and the IME closed. Because the app was on its root screen,
   the same press also backgrounded it.
4. The owner docked the keyboard (Gboard toolbar → Floating off). The **same flow then passed**: `hideKeyboard`
   COMPLETED, Continue was reached, the Summary asserted, and the flow backed out. Nothing else changed.

So a floating Gboard reads as "shown" to the input method manager, but the keyboard dismissal in the tooling does not
handle it.

## Why averi is likely affected too (inferred — NOT measured)

`src/interact/keyboard.ts` `dismissKeyboard()` decides from the window manager's IME insets first:

```ts
const reading = windowAnywhere(await oracle.state());          // dumpsys window displays → InsetsSource type=ITYPE_IME
const decision = reading === 'covering' ? dismissal(reading, await oracle.witness()) : dismissal(reading);
```

and `dismissal('clear')` is `'nothing'`. The independent witness (`mInputShown`, `keyboardWitness`) is consulted **only
when the window reading is `covering`**. It can veto a `back`, but it can never trigger one.

A floating IME window normally contributes **no IME insets** to the app. That is the point of floating mode: the app is
not resized. Expected reading while floating: `InsetsSource type=ITYPE_IME frame=[0,0][0,0] … visible=false` (or no
`mIsImeShowing=true`), next to `mInputShown=true`. If that holds:

- `dismissKeyboard` reads `clear` and sends nothing. The keyboard stays up, the call returns success, and the agent
  believes it is gone.
- The tap guard sees no covered region, so a tap whose target sits under the floating bar (mid-screen, not bottom-docked)
  lands on the keyboard instead of the element.
- `fill{dismissKeyboard:true}` inherits both.

This is the inverse of the 2026-10-04 stale-insets case the witness was added for (window says shown, IME says hidden).
Here the window says **hidden** and the IME says **shown**, and that row of the decision table does not exist.

## To measure (next session with a floating keyboard)

1. Turn Gboard floating on: tap a text field → Gboard toolbar ⋯ → Floating.
2. With a field focused, in one go:
   ```
   adb shell dumpsys window displays | grep -E 'ITYPE_IME|type=ime|mIsImeShowing'
   adb shell "dumpsys input_method | grep -m1 -w mInputShown"
   adb shell dumpsys window InputMethod | grep -E 'frame=|touchable region'
   ```
   The window `InputMethod` dump's `touchable region` is where the floating bar's real rect would show.
3. Run averi `dismissKeyboard` (or a `fill` with `dismissKeyboard: true`) and read `mInputShown` again.
4. Tap an element that lies under the floating bar; see whether it is hit.

If step 2 shows `visible=false` / no frame next to `mInputShown=true`, the bug is confirmed for averi.

## Possible fix directions (for the owner to choose)

- Add the missing row: window `clear` + witness `shown` → `back`. This needs care. The 2026-10-04 incident shows a wrong
  `back` pops a screen, and `mInputShown` can lag a navigation. The guard that already protects the `unknown → back` row
  probably applies here too.
- For the tap guard, read the floating window's `touchable region` from `dumpsys window InputMethod` (measured
  2026-10-03 as the only place the covered area appears) when the insets are empty but the IME is shown.
- At minimum, surface it: when `mInputShown=true` and the insets are empty, return `keyboard: floating (not handled)`
  in the tool result, instead of silent success.

## Workaround

Dock the keyboard on the evidence emulator (Gboard → Floating off). Optionally assert it in pre-flight: a floating Gboard
leaves `mInputShown=true` with no IME insets.

## Device check (2026-10-08, re-run at e9e6509): measured — floating Gboard is NOT "window clear"

Measured 19:58–20:01 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220), Gboard switched to Floating via its
toolbar (grid → Floating), mp-native SEPA form, averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509`.

"To measure" step 2, with the IBAN field focused and the floating panel drawn at about x 359–1040, y 1269–1912:
```
mIsImeShowing=true
InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true
mControl=… mInsetsHint=Insets{left=0, top=0, right=0, bottom=132}
mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true
mIsInputViewShown=true
dumpsys window InputMethod:
  mGivenContentInsets=[0,2022][0,0] mGivenVisibleInsets=[0,2022][0,0]
  touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))
  Frames: … frame=[0,66][1080,2220]
```
So on API 33 the floating keyboard keeps a 132-px IME inset: the docked strip at the bottom (the collapse chevron and
the keyboard-switch key) — the window reading is `covering` with band `[0,2088][1080,2220]`, not `clear`. The new
`clear + shown → unlocated` row was therefore NOT reached. One transient exception: read right after a focus tap that
brought the floating panel up, the same dump gave `frame=[0,0][0,0] … visible=false` / `mIsImeShowing=false` and
`touchable region=SkRegion((0,2088,1080,2220))`; a second read moments later gave the values above.

Step 3, flow `fill { id: swift_payment.form.iban_input, value: …, clear: true, dismissKeyboard: true }` (scratch config):
```
fill: id:"swift_payment.form.iban_input" = FR1420041010050500013M02606 (cleared 28 characters first)
```
No `⚠ fill` line. `back` was pressed (window `covering`, witness `shown`): afterwards `mInputShown=false`,
`mIsImeShowing=false`, the form still on screen (not popped). Correct outcome, by the old row.

Step 4 — the defect that remains (the Status's "Not done: the tap guard"). Tap on a field under the floating panel:
```
tap { selector: "id:swift_payment.form.message_for_payee_input" }   (rect y 1515–1658; centre (540,1586) inside the panel)
→ Tapped id:swift_payment.form.message_for_payee_input
ui_snapshot iban_input → "value": "FR14200410100505d00013M02606"     (was FR1420041010050500013M02606)
```
The tap hit Gboard's `d` key and typed into the focused IBAN field; the target was never focused. averi's guard judged
the target against the 132-px strip only. Same for `scroll_until`:
```
scroll_until { selector: "id:swift_payment.form.message_for_payee_input", fully: true }
→ Element id:swift_payment.form.message_for_payee_input fully visible after 0 swipes
```
(screenshot: the row is behind the panel). Direction, now with a measured fixture: when the IME window's
`touchable region` has a rect that is not the inset band, treat that rect as covered too (tap guard, scroll stop, pixel
poll). The shape is `SkRegion((l,t,r,b)(l,t,r,b))`, in screen coordinates. Gboard was restored to docked after the check.

## Device check (2026-10-08 20:28–20:29 UTC, docked + hidden IME region)

emulator-5554 Pixel_3a API 33, Gboard docked, portrait (`cur=1080x2220`). Commands per read:
`dumpsys window InputMethod | grep -E "touchable region|mGivenContentInsets"`, `dumpsys window displays | grep ITYPE_IME`,
`dumpsys input_method | grep -E "mInputShown|mShowRequested"`.

| State | touchable region | mGivenContentInsets | ITYPE_IME | mInputShown |
|---|---|---|---|---|
| Docked, Settings search field focused (two reads 5 s apart, identical) | `SkRegion((0,1398,1080,2220))` — one rect, equal to the band | `[0,1332][0,0]` | `frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true` | `true` |
| Hidden by `back`, field still focused | `SkRegion((0,2088,1080,2220))` | `[0,2022][0,0]` | `frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false` | `false` |
| Hidden, back in the app (Account Detail, nothing focused) | `SkRegion((0,2088,1080,2220))` | `[0,2022][0,0]` | `frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false` | `false` |
| Hidden, first read of the session — the last shown IME layout had been in LANDSCAPE, device back in portrait | `SkRegion((0,948,2220,1080))` (landscape coordinates) | `[0,1014][0,0]` | `frame=[0,0][0,0] visible=false` (no visibleFrame) | `false` |

What this says for the fix (`touchable region` minus the inset band = covered):
- Docked: the region is exactly the band, so "extra rect" finds nothing — no false cover from a normal keyboard.
- Hidden: the region is NOT empty. It keeps a 132 px strip `(0,2088,1080,2220)` — the same 132 px band the floating
  keyboard reported as its `ITYPE_IME` frame. So the floating band is this collapsed strip, and the floating panel is the
  extra rect. The region is also stale: after a landscape keyboard it still holds landscape coordinates
  (`0,948,2220,1080`) in portrait. Read it only when the IME is shown (`ITYPE_IME visible=true` / `mInputShown=true`),
  never as evidence on its own.
- `mIsImeShowing` does not appear in `dumpsys input_method` on this image (grep matched nothing).
