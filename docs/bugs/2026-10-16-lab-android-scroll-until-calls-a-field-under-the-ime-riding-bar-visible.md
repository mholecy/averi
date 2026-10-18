# BUG: on Android `scroll_until` answers "visible after 0 swipes" for a field the submit bar riding on the soft keyboard is drawn over — the bar's surface is not in the tree, and Compose cuts the field's bounds at the button only

> **Status (2026-10-18):** fixed on `arch/r22-f2a1` at `6d8f8de` (from `arch/round-22` `b71cbbb`), by the owner's
> decision of 2026-10-17 — a field remnant under the tap minimum is refused. The sliver rule (ADR 0013) takes a second
> evidence: a control thinner than the minimum across an edge flush with a node drawn after it that spans that edge
> (`src/ui-tree/standing.ts#cutByLater`, `geometry.ts#Cut.by`), Android's trees only. Both symptoms of the one cause:
> `tap phone` (IME up) is refused naming `container id:lab.form-keyboard.submit`, the strip at `55,1370` (`970x28` of
> its `970x42` above the keyboard's line), and
> "the soft keyboard is up (its top edge at y 1398): dismiss it first … — a bar riding on it goes down with it — or
> scroll_until it out from under that container first"; `tap note` after the guard's `back` is refused on its `970x14`
> strip at `55,2126` with "scroll_until it out from under that container first" (no tap at y 2133); `scroll_until phone`
> is no stop — its strokes move nothing on this screen (the form fits), and it fails after 3 swipes naming the bar and
> "dismiss it first …, and scroll again". Measured by replay only: golden from `truth/round-6` with `--side` over this
> branch, 1137 checks / 241 mismatches (baseline 242) — the KNOWN row `form-keyboard.xml phone scroll_until` turns
> green; three replies change (phone tap, phone scroll_until, note tap), every other row's reply and calls identical.
> Not checked on the emulator. Review round 1 (0eb0f10–0bb2704) changed the wording only — the rest "may" lie under
> the bar, the whole-thin case's way past (a coordinate tap), the keyboard named only for a cutter riding on it, the
> strip counted above the keyboard's line — golden again 1137 / 241 / 0 / 86, the same three rows, their calls
> identical. iOS cannot show the geometry: WDA lists `phone` whole under the bar (covered at its
> centre, its rows green), idb's flat list misses the bar (lab note L2, a separate finding). Residuals (ADR 0013's
> refinement): a WHOLE control that thin laid flush against a later node that spans it is refused too ("may lie under",
> with a coordinate tap as its way past); and a clickable with no role — Compose's `Modifier.clickable` without one
> dumps as `android.view.View`, read as a `container` or `other` — cut to such a strip is still tapped on the strip, and
> in an app whose bar takes the touch that tap is reported done and reaches nothing (the owner's "accidentally
> submitted" risk). Not widened on purpose: the gate is the control roles (selectors.ts#isInteractive), and a role-less
> node is as often a layout wrapper as a clickable — refusing those would refuse wrappers and containers that are no
> target.
>
> **Live (2026-10-18, round 6's Android device check):** measured on the emulator at round 5's src (b71cbbb) and at
> round 6's (e98b87e), by three forms cases of the live golden (scripts/truth/live.ts k5, and k6/k7 added for this
> note). `tap phone` (IME up): before `Tapped` at `540,1391` — the bar's padding, phone focused, no submit; after
> refused naming `container id:lab.form-keyboard.submit`, nothing tapped, the focus left on postcode. `tap note` after
> `back` (k5): before `Tapped` at `540,2133`, note focused; after refused ("cut at its top edge by container …
> submit … only a 970x14 part of it shows … scroll_until it out from under that container first"), no submit.
> `scroll_until phone` (k7): before "visible after 0 swipes — CLIPPED at bottom, 67% …" with no stroke, phone's centre
> under Continue; after ONE stroke (the app's touch-down at `540,1034`) and "fully visible after 1 swipe" — the replay's
> premise does not hold on the device: the form DOES scroll above the IME, the stroke moved it 167 px (phone 1296 → 1129),
> leaving phone's centre clear of the bar and of the IME, 18 px of its bottom under the bar's top padding (the surface
> with no node: averi cannot see those 18 px, so "fully" overstates by them). So the replay's "fails after 3 swipes" (two
> unmoved strokes and one back) is not what the device does: 1 stroke, a right stop. A consequence of the refusal: live
> case k3 (fill note under the IME, back hides it) was ok before — the fill tapped the 14-px strip and typed — and is now
> LOUD, refused for the same strip, the field untouched: an honest refusal the owner's 2026-10-17 decision implies.
> docs/truth/live-android-2026-10-18-visibility.md.

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

Compose reports phone's bounds (its 48-dp touch target, 132 px: `1280–1412`, the dump's bottom edge 1412) with what the
later clickable `Continue` covers taken out (as
`docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md` measured on `pinned-bar`).
The bar's own surface has no semantics node: nothing in the dump covers `1370–1398`.

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
rect at the button, so the field reads as a 970x42 strip (`1370–1412`) with nothing over it, 28 px of it above the IME.
averi has no way to see the bar from the dump; the screenshot shows it (grey `#F2F2F7` over the strip). Whether that is
averi's to fix (judge a field whose rect was cut by a later sibling as covered at its uncut centre, as the `pinned-bar`
note suggests; or not stop on a rect cut to under the tap minimum by a cover) or a residual of the tree is the round's
to decide; the golden row is the check.

## Notes

- KNOWN in tests/differential/golden/forms.known.ts (`form-keyboard.xml phone scroll_until`, `as: bug:` this note).
- The tap row accepts `Tapped` inside the probed piece (ADR 0005, a covered target's tap moved to its piece).
- The same cause makes a tap land by luck (OWNER DECISION): live case k5 (docs/truth/live-android-2026-10-16.md) taps
  `note` after the guard's `back`; in the layout then (`form-keyboard.after-back.xml`, `.after-back.state.json`: the bar
  back at `0,1966 1080x188`, Continue `55,1994 970x132`) Compose dumps note as `[55,2126][1025,2140]` — its 48-dp touch
  target with Continue taken out — and averi taps its centre, y 2133, 7 px below Continue's bottom. That reaches note
  only because this bar's padding is no touch target (the probe at that point after back focused note,
  ControlTruth.afterBack.piece.reached; at note's own centre, y 2074, the form was SUBMITTED). In an app whose bar
  takes the touch (a clickable or a pointer-consuming surface), the same tree — the bar has no node either way — would
  get the same `Tapped`, and nothing would reach the field. Whether averi should keep tapping such a sliver of a
  control cut by a later sibling, or refuse it as under the tap minimum, is the owner's call; the golden row
  (`form-keyboard.xml note tap`) holds the measured truth for this app.
