# BUG: on Android `scroll_until` answers "visible after 0 swipes" for a field the submit bar riding on the soft keyboard is drawn over — the bar's surface is not in the tree, and Compose cuts the field's bounds at the button only

Lab note F2A1. **Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the Android lab app's
ground truth (`tests/fixtures/truth/android-averi_lab-api33/form-keyboard.*`, captured by
scripts/truth/capture-android.ts on the dedicated `averi_lab` AVD, Android 13 / API 33, 1080x2220, gesture navigation,
docked Gboard). averi = mobile-verify `truth/r3-forms-android` on `arch/round-20`'s `src/` (`debc9b2`; no `src/` change
on the branch). Replayed only; the taps' effects are the capture's own probes on the emulator.

## The screen

`form-keyboard` (fixtures/apps/android/…/Forms.kt, phase 2b): ten fields in a scroll column that keeps its height when
the IME comes up (the IME is drawn over the form, as in mp-native's forms), `postcode` focused on appear, the submit
`Continue` in a bar that rides on the IME (its bottom padding the IME's inset). The app's frames (screen pixels):

| what | frame | |
|---|---|---|
| IME (WindowInsets.ime; `dumpsys window displays` says the same `[0,1398][1080,2220]`) | `0,1398 1080x822` | |
| the bar (`submit.bar`, a grey surface, no semantics) | `0,1210 1080x188` | |
| `Continue` (`lab.form-keyboard.submit`) | `55,1238 970x132` | |
| `phone` (`lab.form-keyboard.phone`) | `55,1296 970x99` | wholly inside the bar's frame: the user sees the bar's grey, no field |

## Truth

- A raw `adb shell input tap 540 1346` at the phone field's centre logged `touch 540,1346` and `submit invalid`: it
  pressed `Continue`. `situationOf` measures phone `covered`.
- A second probe at its piece clear of the IME and of `Continue` (`55,1370 970x25`, the bar's bottom padding) — `input
  tap 540 1382` — focused phone: the bar's padding lets a tap through (ControlTruth.reachedAtPiece).

## What the tree says

```
lab.form-keyboard.submit  android.view.View      [55,1238][1025,1370]
lab.form-keyboard.phone   android.widget.EditText [55,1370][1025,1412]
```

Compose reports phone's bounds (its 48-dp touch target, 132 px: `1280–1412`, the dump's bottom edge 1412) with what the later clickable `Continue` covers
taken out (as `docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md` measured on
`pinned-bar`). The bar's own surface has no semantics node: nothing in the dump covers `1370–1398`.

## Observed (replayed)

```
scroll_until { selector: 'id:"lab.form-keyboard.phone"', direction: "down" }
→ Element id:"lab.form-keyboard.phone" visible after 0 swipes — CLIPPED at bottom, 67% of it is in the viewport above
  the soft keyboard over [0,1398][1080,2220]. A rect assert or screenshot on this element will measure the CLIPPED box
tap { selector: 'id:"lab.form-keyboard.phone"' }
→ Tapped id:"lab.form-keyboard.phone"          device: adb shell input tap 540 1391
```

The tap is right by the truth: 1391 lies in the piece the second probe reached (the field took the focus; measured
directly on the emulator too: `input tap 540 1391` → `focus phone`, no submit). The stop is not: the field is drawn
over by the bar, its centre under `Continue`; "visible … 67 % in the viewport" describes a strip of grey bar.

## Expected

src/mcp/tools.ts, `scroll_until`: no plain stop on an element whose centre lies under an element of the app drawn over
it (the pinned-chrome rule, docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md); golden-spec/
forms.ts#controlRows (`covered`, its centre's probe fired another control): not reached with no swipe. iOS judges the
same cell so under WDA (the lab's L2 is idb's miss of it).

## Cause (not changed here)

The tree the stop judges never shows the cover: the bar is a background with no semantics, and Compose cuts the field's
rect at the button, so the field reads as a 970x42 strip (`1370–1412`) with nothing over it, 28 px of it above the IME. averi has no
way to see the bar from the dump; the screenshot shows it (grey `#F2F2F7` over the strip). Whether that is averi's to
fix (judge a field whose rect was cut by a later sibling as covered at its uncut centre, as the `pinned-bar` note
suggests; or not stop on a rect cut to under the tap minimum by a cover) or a residual of the tree is the round's to
decide; the golden row is the check.

## Notes

- KNOWN in tests/differential/golden/forms.known.ts (`form-keyboard.xml phone scroll_until`, `as: bug:` this note).
- The tap row accepts `Tapped` inside the probed piece (ADR 0005, a covered target's tap moved to its piece).
