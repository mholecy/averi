# Live golden, Android, 2026-10-23: the strip between a floating Gboard's panel and its band (FU1)

## 2026-10-23 — FU1's fix, `34f82f25` (bugs/r1023b-fu1)

averi_lab (emulator-5554, API 33, 1080x2220, gesture navigation; booted `-no-window -no-snapshot-save`, shut down
after), the lab app as installed. averi = this checkout at `34f82f25` (its src; the kf cases and their judge,
scripts/truth/live.ts and live-forms.ts#judgeFloatingGap, added in the records' commit). Note:
docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md, ADR 0027.

**Floating, by hand.** No adb setting floats Gboard. With `form-keyboard-floating` launched (postcode focused, Gboard
docked: `touchable region=SkRegion((0,1398,1080,2220))`, `ITYPE_IME frame=[0,1398][1080,2220]`), screenshot-guided taps:
the toolbar's grid key (63,1456), the grid's second page, the **Floating** tile (294,1770). Read after:

```
touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))
InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true
```

Two rects: the panel `359,1269 681x643` (where Gboard put it — the 2026-10-08 device check's place, not the capture's
`71,1092 937x792`; left there, its region recorded instead) and the 132-px strip. The gap is `0,1912 1080x176`; the
dump's submit `[55,1928][1025,2060]` lies wholly in it, ks `[55,1644][1025,1776]` under the panel.

**The cases** (`--groups forms --cells form-keyboard-floating --cases kf1,kf2,kf3`, three runs:
docs/truth/live-records/android-forms-r1023b-fu1-1.json, -2.json, -3.json — 3 of 3 ok each):

| case | reply (each run) | the app |
|---|---|---|
| kf1 `scroll_until submit` | `Element id:"lab.form-keyboard-floating.submit" fully visible after 0 swipes` | no touch, no submit |
| kf2 `scroll_until submit`, `tap submit` | the same, then `Tapped id:"lab.form-keyboard-floating.submit"` | one touch at (540,1994), one submit, the IME still up (no `back`) |
| kf3 `scroll_until ks` | `ERROR … failed after 3 swipes … never intersected the 1080x1269 screen above the soft keyboard over [359,1269][1040,1912]` | three strokes touching down at (540,1060), above the panel; ks 1493–1592, under the panel; postcode untouched |

The run's judge first counted kf2's tap as a stroke (the app logs the tap's touch too) and called it a MISMATCH; the
judge was fixed (kf2's one touch is its tap) and the three records rejudged: 3 of 3 ok each, as pinned in
tests/truth/live-rejudge.test.ts.

**Docked control.** Gboard docked again (grid → Floating, the tile now off): `touchable region=SkRegion((0,1398,1080,2220))`
— one rect, the band. kf1 once more: SKIP, "keyboard docked (the app hears an IME 822 px tall, not the floating strip)"
(not recorded). Then `adb -s emulator-5554 emu kill`.

## 2026-10-23 — kf1 and kf2 evidence the panel themselves (FU1's code review)

The app's state cannot tell a floating panel from an IME collapsed to its strip with no panel: both give the app the
132-px strip, and with no panel kf1 and kf2 pass with no gap rule at all. Only kf3's refusal quoted the panel. So kf1
and kf2 now begin with a colour assert on ks (`live-forms.ts#FLOATING_PANEL_EVIDENCE`). The pixel poll refuses it
naming the rect over ks (`keyboard 359,1269 681x643`), with no touch and no key, and the IME left up. The judge is SKIP
unless that reply quotes a measured panel. The call goes first because a submit lays the form out again: sent after
kf2's tap, ks lay at y 2148 under the strip, and the reply quoted the band (`keyboard 0,2088 1080x132`).

averi_lab, as above, at this branch's tip (src as at `760dadea`, plus the review's refactor, which leaves behaviour the
same). Gboard was floated by hand the same way, and the region read was the same as above:
`SkRegion((359,1269,1040,1912)(0,2088,1080,2220))`.

There were three runs (docs/truth/live-records/android-forms-r1023b-fu1-cr-1.json, -2.json, -3.json), each 3 of 3 ok:
- **kf1:** the evidence reply quotes `keyboard 359,1269 681x643` over ks `55,1644 970x132`, then
  `fully visible after 0 swipes`.
- **kf2:** the same, then `Tapped`, with one submit and the IME still up.
- **kf3:** as before.

Docked again (the region was the band alone, `(0,1398,1080,2220)`), kf1–kf3 were SKIP "keyboard docked" (not
recorded). Then `adb -s emulator-5554 emu kill`.

The first three records (-1, -2 and -3, without the evidence call) now rejudge as kf1 and kf2 SKIP and kf3 ok (until
D67, below). They are pinned that way in tests/truth/live-rejudge.test.ts.

## 2026-11-03 — D67: the judge reads the panel at launch

The judge no longer matches the reply against a fixed list of hand placements (`LAB_FLOATING_PANELS`, this note's two
regions). Batch-11 floated Gboard to a third place (87,1243 937×792), and the list's miss read as "the IME was not
floating there". Now live.ts reads averi's touchable query once, right after each kf case's launch
(`LabState.imeTouchable`, averi's own `TOUCHABLE_COMMAND`). `live-forms.ts#measuredPanel` reads it with averi's own
`parseTouchableRegion` and admits a panel by averi's own rules (`keyboard-cover.ts#panelsBeyond`), and the replies are
held to that one panel. With no read, a failed read, no `mInputShown=true`, an unreadable region, one that does not hold
the strip, no rect beyond it or several panels, the case is SKIP "no measured panel (…)". kf1 and kf2 also check their premise first
(`gapPremise`): the submit wholly between the panel and the strip. Batch-11's panel covered the submit by 107 px, so they
SKIP naming the cover. kf3 checks that ks's centre lies under the panel.

None of the records above read the region, so every one of them, the -cr runs included, now rejudges as kf1–kf3 SKIP
"no measured panel (no IME region read at launch)". tests/truth/live-forms.test.ts judges their replies against the
region read that day (above): kf1–kf3 are ok there.

Live check (batch-12 ONLY=kf, 2026-11-04, main 1b129afa, averi_lab API 33): PASS in 1 run. The panel was placed first
with `adb shell input swipe` on Gboard's drag handle, slowly (1500 ms per swipe), about 228 px up, then 3–4 s of waiting
before the region was read: for 1–2 s after a drag it reads as almost the whole screen, `(0,66,1080,2220)`. The read at
launch was `SkRegion((87,1015,1024,1807)(0,2088,1080,2220))`, the panel 87,1015 937×792, so the premise held: the
submit (55,1928 970×132) wholly in the gap and ks's centre under the panel. kf1 and kf2 got `fully visible after 0
swipes` (kf2 then `Tapped`, 1 submit, the IME still up); kf3 got no stop, the postcode untouched, and averi's
`scroll_until … failed after 3 swipes … never intersected the 1080x1015 screen above the soft keyboard over
[87,1015][1024,1807]`.

## 2026-11-05 — D69: the judge reads the panel twice; a misquote is a MISMATCH

One read could not tell a panel dragged during the calls from averi reading the device wrong, so a reply quoting
another panel (or none) was SKIP, never a finding. Now live.ts reads averi's touchable query again once a kf case's
calls are done, onto the final state (`state.imeTouchable`, the same `withMeasuredPanel`), and
`live-forms.ts#panelAfterCalls` admits a panel from it by the same `measuredPanel`, beside the launch's strip:
- the second read admits another panel: SKIP "the panel moved (launch A, after B)"; none: SKIP "the panel not measured
  again after the calls (launch A, after: no measured panel (…))". Both are checked before kf1/kf2's premise, before
  any quote and before ok;
- the two reads agree and kf1/kf2's evidence does not quote the panel over ks, or kf3's refusal does not name it:
  MISMATCH "averi quoted keyboard X over ks (or: no panel) — the panel measured at launch and again after the calls is
  P" (kf3: "averi named over [..][..] …"), every distinct panel averi quoted named; an averi call that errored (an
  assert that ran no poll; for kf3, an error that is not averi's own `scroll_until <target> …` verdict, or one whose
  tree read failed, scroll-text.ts#TREE_READ_FAILED) is "a harness fault, not a verdict on the panel over
  ks", as the picker-sheet cases name one; so is a record short of the case's replies (a SKIP with no second read);
  a visible kf3 stop is ok only when it names the panel it was judged above (`, judged above the soft keyboard over
  [l,t][r,b]`);
- no second read (every record before D69): judged as before, the misquote SKIP word for word.

The 3-s `late` re-read reads the app only, so `live-cases.ts#judged` carries the second read onto it
(`lateWithPanel`): a later read cannot turn the MISMATCH into the SKIP of a record with one read. The branches are
pinned on the fu1 record and batch-11's fixture (tests/truth/live-forms.test.ts, "D69"), the second region given per
test; the MISMATCH cannot be provoked on the device without injecting a fault. One adb shell more per kf case.

One parser, one command (D69's second part): the capture's `truth.ts#imePanels` now parses the touchable dump with
averi's own `parseInputShown` and `parseTouchableRegion`, but keeps the harness's own rule (every rect but the band,
never `panelsBeyond`: ground truth must not use the rule it checks); both committed `.ime.json` captures read as
before. `AndroidLab.ime` sends averi's `INPUT_SHOWN_COMMAND` (exported from src/adapters/android.ts), no copy of it.

Live check (the kf block run by hand, 2026-11-05, main 454b7108, averi_lab API 33): PASS. The premise held: the
floating panel at bottom 1807. kf1, kf2 and kf3 all ok. Each record carries both reads, at launch and after the
calls, equal: `(87,1015,1024,1807)` plus the strip. Rejudging the record gives the same verdicts. 42 s against ~41 s
for batch-13's kf block: the second read does not show at this resolution.
