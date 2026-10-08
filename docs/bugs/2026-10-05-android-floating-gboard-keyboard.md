# BUG: Android floating Gboard is invisible to the keyboard handling (Maestro `hideKeyboard` measured; averi suspected)

> **Status (2026-10-08):** open — the code quoted below as `src/interact/keyboard.ts dismissKeyboard()` moved in `0e48a63` (2026-10-07): the decision is `src/interact/keyboard-window.ts#dismissal`, which still maps a `clear` window to nothing.

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
