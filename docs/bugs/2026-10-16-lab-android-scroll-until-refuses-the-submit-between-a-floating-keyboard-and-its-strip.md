# BUG: on Android `scroll_until` refuses a pinned submit that lies between a floating keyboard's panel and its strip — drawn, tappable, and "never intersected the screen above the soft keyboard"

Lab note FU1. **Found 2026-10-16** by the golden mode (scripts/differential/golden.ts) over the Android lab app's
ground truth (`tests/fixtures/truth/android-averi_lab-api33/form-keyboard-floating.*`, captured by
scripts/truth/capture-android.ts on the dedicated `averi_lab` AVD, Android 13 / API 33, 1080x2220, gesture navigation,
Gboard 12.4 switched to Floating by hand for the capture and docked again after). averi = mobile-verify
`truth/r4-followups` on `arch/round-20`'s `src/` (`debc9b2`; no `src/` change on the branch). Replayed only; the taps'
effects are the capture's own probes on the emulator.

This is the residual
[2026-10-05-android-floating-gboard-keyboard.md](2026-10-05-android-floating-gboard-keyboard.md) names as the cost of
its fix (`cb77485`): "The full-width cut in `scroll_until`: everything below the panel's top edge counts as covered, so
content beside the panel (x < 359) and in the gap above the strip is never judged visible — a target there that cannot
be scrolled above the panel fails `scroll_until` naming the keyboard, though the tap guard would tap it". The lab now
measures it.

## The screen

`form-keyboard-floating` (fixtures/apps/cells/forms.json, `ime: floating`): `form-keyboard`'s ten fields, `postcode`
focused on appear, the submit `Continue` in a bar that rides on the IME's inset. Floating, the inset the app hears of
is only the strip, so the bar sits just above it (screen pixels):

| what | frame |
|---|---|
| IME inset (WindowInsets.ime; `ITYPE_IME frame=[0,2088][1080,2220]`) | `0,2088 1080x132` |
| the floating panel (`touchable region=SkRegion((71,1092,1008,1884)(0,2088,1080,2220))`) | `71,1092 937x792` |
| the bar (`submit.bar`) | `0,1900 1080x188` |
| `Continue` (`lab.form-keyboard-floating.submit`, dump `[55,1928][1025,2060]`) | `55,1928 970x132` |

## Truth

A raw `adb shell input tap 540 1994` at `Continue`'s centre logged `touch 540,1994` and `submit`: the button is drawn
and takes the tap — below the panel's bottom (1884), above the strip (2088). The golden mode's `tap` row on it is green
(`Tapped`).

## Observed (replayed, the IME's three readings served by the fake device)

```
scroll_until { selector: 'id:"lab.form-keyboard-floating.submit"', direction: "down" }
→ ERROR scroll_until id:"lab.form-keyboard-floating.submit" failed after 2 swipes (the last 2, swiping down, did not
  move it: content exhausted, or the swipes were not taken) — element in tree but never intersected the 1080x1092
  screen above the soft keyboard over [71,1092][1008,1884] (last rect {"x":55,"y":1928,"width":970,"height":132}) …
  device: adb shell input swipe 540 874 540 218 657 (twice)
```

At `7d9a783` (before the floating fix) the same row is green, "fully visible after 0 swipes": the fix's full-width cut
at the panel's top (`highestCover`) turned it red — calibrate records it as #1's regression elsewhere at `cb77485`.

## Expected

src/mcp/tools.ts, `scroll_until`: a stop on an element visible on the screen, clear of every cover; the panel is a
rect, not a band — the screen below it and beside it is the app's (golden-spec/forms.ts#controlRows: the pinned submit
above the keyboard, open, "reached with no swipe"). Pinned in tests/differential/golden/forms.known.ts.
