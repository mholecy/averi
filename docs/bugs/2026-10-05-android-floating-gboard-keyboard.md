# BUG: Android floating Gboard is invisible to the keyboard handling (Maestro `hideKeyboard` measured; averi suspected)

> **Status (2026-10-08, after the device checks):** measured and fixed on branch `fix/r2-d-gboard` (on top of `fix/keyboard-aware-scroll`, with [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md)); the fix is not yet re-checked on a device. **What the device checks found** (the three sections at the end): on API 33 a floating Gboard is NOT "window clear" — `ITYPE_IME` keeps a 132-px band (`[0,2088][1080,2220]`, `visible=true`, `mInputShown=true`), so the dismissal reads `covering` and presses `back`, which hid it and left the form (correct, by the old row); the panel is a second rect of the IME window's `touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))`, and the band alone let a guarded tap press Gboard's `d` key and `scroll_until … fully` call a row behind the panel "fully visible after 0 swipes". **The fix:** `KeyboardOracle.touchable()` (adapters/android.ts#keyboardTouchable — one adb call, `dumpsys input_method | grep -m1 -w mInputShown; dumpsys window InputMethod | grep -F 'touchable region='; true`, `parseTouchableRegion`) is asked only after `state()` read shown, by `ui-tree/soft-keyboard.ts#oracleKeyboard` — the one composer of an oracle reading, used by `readSoftKeyboard` and by the guard's re-check loop after a witness veto (review round 1: that loop had read `state()` alone and, once the witness said hidden, judged the point clear on the strip and tapped the `d` key); `panelsBeyond` admits a rect only when the same call's `mInputShown` is true, the region holds the band exactly (the stale-landscape region does not), the rect lies inside the screen the band spans and is not the band; the reading carries them as `panels`, and every reader tests `keyboardRects` — the tap guard (`keyboardOver`: a point under the panel takes the band's path, witness → one `back` → one look), the pixel poll (the covered miss quotes the panel) and `scroll_until` (its cover cut above the highest covered rect, `highestCover`: a target behind the panel is not certified, the stroke starts above it). Docked: the region is the band, nothing beyond it, behaviour unchanged (pinned). Cost: one more adb call per oracle reading that finds the band up, none while it reads hidden or unknown — a tap with the keyboard up but clear of the point pays 2 calls (was 1); a covered tap 2 + the witness + `back` + the look after it; a witness-veto re-check round 3 while the band is up; a pixel-poll round 2; a `scroll_until` round 2, or 3 when the band changes the round (its corroborating witness — the touchable call's own `mInputShown` is not reused for it yet, a follow-up ui-tree/soft-keyboard.ts#readSoftKeyboard gives the reason for), and every confirming read after a stroke is such a round. The full-width cut in `scroll_until`: everything below the panel's top edge counts as covered, so content beside the panel (x < 359) and in the gap above the strip is never judged visible — a target there that cannot be scrolled above the panel fails `scroll_until` naming the keyboard, though the tap guard would tap it; a panel dragged near the top leaves a short stroke box. The earlier SAFE-direction row stays: `src/interact/keyboard-window.ts#dismissal`'s window `clear` + witness `shown` → `unlocated` (nothing pressed, a `⚠ fill` warning; `scroll_until` says so on a failed or `fully: true` stop) — it was never reached by a floating Gboard on API 33; its sentence now names "one still coming up?" (the transient read right after the focus tap) instead of "a floating keyboard?". Residuals: the transient window-hidden read right after the focus tap (no band, so no region is read: that one look fails open as before); the brittle rule is the exact-band test — a floating keyboard whose region strip is not equal to its inset frame (another navigation mode, a strip that leaves out the nav bar, IME touchable insets that differ from its content insets, a band that is not full width — side nav bar, landscape, split — where Skia merges a panel sharing its rows) has its whole region dropped and the `d`-key tap returns (fail open, no worse than before); each such refusal is said once on stderr (`averi: the soft keyboard window's touchable region … — <reason>`: the input method not saying shown, no rect equal to the band, rects outside the band's screen, an unreadable region), so a device check can tell the cases apart; the combined command's cost and `grep -F` on toybox are unmeasured; split keyboards and API 34+ unmeasured. Note: the code quoted below as `src/interact/keyboard.ts dismissKeyboard()` moved in `0e48a63` (2026-10-07): the decision is `src/interact/keyboard-window.ts#dismissal`.

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

## Device check (2026-10-09 Android, re-run at 610660f)

Measured 05:10–05:13 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio). The mp-native SEPA form was not reachable (bank app logged out,
PIN login not permitted to this session): fixture = Google Contacts "Create contact" editor. Gboard → grid → Floating, with
`First name` focused, then docked again the same way. Taps/keys recorded with an `adb` shim on the server's PATH.

Floating, 05:10:50 (identical to the 2026-10-08 fixture):
```
touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))
InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true
mGivenContentInsets=[0,2022][0,0]   mInputShown=true
```

- (a) **Holds** — guarded tap under the panel: `tap { selector: 'text:"+1"' }` (phone textfield 132,1647 816x176, centre
  (540,1735) inside the panel) → `Tapped text:"+1" (the soft keyboard covered text:"+1"; hidden before tapping)` (9.5 s);
  sent `keyevent 4` then `input tap 540 1735` — one back, one look, one tap; afterwards `+1` `focused="true"`, `First name`
  still empty (no key pressed). Before the fix the same shape typed `d` into the IBAN.
- (b) **Holds** — `scroll_until { selector: 'text:"Mobile"', fully: true }` (row 1845–2021, behind the panel) → `fully visible
  after 1 swipe`, stroke `540 1016 → 540 254` (inside the box above the panel top 1269), row at y 641 after; screenshot shows
  it above the panel, panel still floating.
- (c) **Holds** — pixel poll on an element under the panel: `assert … text:"Add birthday" color #D3E3F1` (467,1390 234x55) →
  `FAIL … the soft keyboard covers the element (element 467,1390 234x55, keyboard 359,1269 681x643) — dismiss it … failing
  closed, color unchecked` (9.1 s, timeout 8000). An element BESIDE the panel (`text:"Notes"` 176,1763 118x66, x < 359) was
  measured normally: `PASS … sampled #E8EFF6 … dE00 0.49` — the pixel poll uses the panel rect, not the full-width cut.
- (d) `server-stderr.log`: **no** `averi: the soft keyboard window's touchable region …` notice in the whole run (the region
  held the band exactly every time; no refusal case arose).
- (e) **Holds** — docked (05:12, after toggling Floating off: `SkRegion((0,1398,1080,2220))`, band `[0,1398]`): `tap
  text:"First name"` with its centre (540,1341) clear of the keyboard → `Tapped text:"First name"`, one `input tap 540 1341`,
  no back; `tap text:"Last name"` with its centre (540,1429) under the band → `… (the soft keyboard covered text:"Last name";
  hidden before tapping)`, `keyevent 4` + `input tap 540 1429`, Last name focused.
- Flow dismissal (docked, scratch config): `fill { text: "Company", value: "Acme", dismissKeyboard: true }` → typed into the
  Company input, one `keyevent 4`, IME `visible=false` after, editor still open (not popped).
- Gboard restored to docked (touchable region = band) at 05:12.

## Device check (2026-10-09 Android bank form, re-run at 610660f)

Measured 06:03–06:05 UTC on the original fixture: the mp-native SWIFT form (`com.finshape.skeleton.dev`, logged in by the
owner), emulator-5554, averi = mobile-verify `fix/keyboard-aware-scroll` `dist/` from `610660f` (stdio), `adb` shim logging
input. IBAN focused (text keyboard), Gboard → grid → Floating at 06:04:01:
`touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))`, `ITYPE_IME frame=[0,2088][1080,2220]`.

- **Holds — the original symptom is gone.** `tap { selector: "id:swift_payment.form.value_date_select" }` (rect 66,1472
  948x143, centre (540,1544) on the panel's `d` key) → `Tapped id:swift_payment.form.value_date_select (the soft keyboard
  covered id:swift_payment.form.value_date_select; hidden before tapping)` (9.5 s); sent `keyevent 4` then `input tap 540
  1544`; the value-date picker opened (screenshot), IBAN still empty — no `d` typed. Cancelled.
- **Holds** — IBAN refocused (panel floating again, same region), `scroll_until { selector:
  "id:swift_payment.form.fees_select", fully: true }` (rect y 1659–1802, behind the panel) → `fully visible after 1 swipe`
  (7.3 s), stroke `input swipe 540 1016 540 254 300` (0.8 / 0.2 of the panel top 1269); row at y 431 after, screenshot shows it
  clear of the panel.
- `server-stderr.log`: the server wrote nothing to stderr in the whole run (file never created) — no refusal notice.
- Gboard restored to docked at 06:05:09 (`SkRegion((0,1398,1080,2220))`).

## Device check (2026-10-09 Android, re-run at 347e70d)

Measured 11:33–11:35 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220), averi = mobile-verify `fix/round-3` @ `347e70d`
(`dist/` built 11:21 UTC, stdio, cwd mp-native), mp-native SWIFT form, IBAN focused (holding `DE89370400440532013000`). Gboard → grid →
Floating at 11:34:16: `touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))` (same as the earlier checks); screenshot
`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/kb-float.png`. Keys/taps from the `adb` shim.

- **Holds — tap under the panel.** 11:34:25 `tap { selector: "id:swift_payment.form.value_date_select" }` (66,1375 948x143, centre
  (540,1447) under the panel) → `Tapped id:swift_payment.form.value_date_select (the soft keyboard covered
  id:swift_payment.form.value_date_select; hidden before tapping)` (9.4 s). Shim: `keyevent 4` then `input tap 540 1447` — back first,
  then the row. The date picker opened (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run5-android/img-69-0.png`); cancelled by hand; IBAN still `DE89370400440532013000` — no letter typed.
- **Holds — scroll with the panel up.** IBAN refocused (panel floating again, same region), 11:34:53 `scroll_until { selector:
  "id:swift_payment.form.fees_select", fully: true }` → `Element id:swift_payment.form.fees_select fully visible after 1 swipe` (7.7 s),
  stroke `input swipe 540 1064 540 448 617` — both ends above the panel top 1269 (box 242–1269, 0.8/0.2), drag speed (616 px, 617 ms;
  at 610660f `1016 → 254, 300`). Row at y 882 after; IBAN unchanged.
- `server-stderr.log`: only the `.env.averi` load line; no refusal notice.
- Gboard restored to docked at 11:35:19 (`touchable region=SkRegion((0,1398,1080,2220))`).

## Device check (2026-10-09 Android, re-run at 86eb42d)

Measured 13:01–13:03 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220), averi = mobile-verify `fix/round-3` @ `86eb42d` (`dist/`
built 12:50 UTC, HTTP daemon port 47821, cwd mp-native), mp-native SWIFT form, IBAN focused (holding `AT611904300234573201`). Gboard → grid →
Floating at ~13:01:40: `touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))`, `ITYPE_IME frame=[0,2088][1080,2220]` (as in
every earlier check). Keys/taps from the `adb` shim. Round-4 handoff §5.

- **Holds — tap under the panel.** 13:01:51 `tap { selector: "id:swift_payment.form.value_date_select" }` (66,1375 948x143, centre (540,1447)
  under the panel) → `Tapped id:swift_payment.form.value_date_select (the soft keyboard covered id:swift_payment.form.value_date_select;
  hidden before tapping)` (11.5 s). Shim: `13:01:56 keyevent 4` then `13:02:02 input tap 540 1447` — back first, then the row. The date
  picker opened (`/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-64-0.png`); cancelled by hand; IBAN unchanged.
- **Holds — scroll with the panel up.** IBAN refocused (averi `tap`, panel floating again, same region), 13:02:31 `scroll_until { selector:
  "id:swift_payment.form.fees_select", fully: true }` → `Element id:swift_payment.form.fees_select fully visible after 1 swipe` (7.7 s),
  `input swipe 540 1064 540 448 617` — identical to 347e70d, both ends above the panel top 1269. Row at y 886 after; screenshot
  `/private/tmp/claude-501/-Users-mholecy-Finshape-mp-native/7fbfe9d5-e34d-4d96-8f31-ac55f222c022/scratchpad/averi-repo/run6-android/img-69-0.png` (flagged "did not settle" — the caret/teardrop handle) shows it clear of the panel, IBAN unchanged.
- `server-stderr.log`: only the `.env.averi` load line; no refusal notice.
- Gboard restored to docked at 13:03:00 (`touchable region=SkRegion((0,1398,1080,2220))`).
