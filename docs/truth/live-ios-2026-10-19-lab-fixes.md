<!-- The live golden on iOS, round 7's lab fixes (task T3, branch truth/r7-lab-fixes from truth/round-7 e856afc),
2026-10-19: the averi-lab iPhone 17 simulator (3AB1E82E, iOS 27.0, 402x874), Xcode 27.1 (27A9275), WDA on port 8120
from the lab's own derived data (averi-wda-lab), idb's companion on the simulator (a fresh one: the one left running
since 2026-10-18 18:02 answered every HID event "the dtuhidd connection … has been invalidated", so idb could neither
tap nor type until a companion of this run's own served the simulator). averi = truth/round-7's src (arch/round-23 565bcb9
merged); the lab app built from this branch (Forms.swift's binding fix, Presented.swift's 56-row table, catalog with
sheet-long-list's L). Reproduce (outside the sandbox):
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups forms [--cases b1,b4,p2] [--record <file>]
  node --import tsx scripts/truth/live.ts --udid <lab simulator> --groups visibility --cells sheet-long-list,sheet-long-list-short [--record <file>]
Records (docs/truth/live-records, rejudged by tests/truth/live-rejudge.test.ts): ios-forms-r7-lab-1.json (the forms
group, every case), ios-forms-r7-lab-2…5.json (b1, b4, p2), ios-forms-r7-lab-picker.json (c2–c4), ios-long-list-r7-lab-1.json
and -2.json (the two long-list cells). The previous iOS run: docs/truth/live-ios-2026-10-18-visibility.md. -->

# What round 7's lab fixes measured

## 1. The lab model no longer drops the last typed character

docs/bugs/2026-10-15-lab-ios-swiftui-model-drops-trailing-typed-characters.md (4 of 40 fills at round 6's check).

**Cause — the lab's oracle, not averi, not the app's state.** A diagnostic build logged every write of the field's
binding, every `UITextField.textDidChangeNotification` and every oracle report, and a raw loop (no averi: `idb ui tap`
on the IBAN field, `idb ui text "SK31 1200 0000 1987 4263 7541"`, 3 s, read the state file) reproduced the loss:

```
…088.235 set iban  SK31 1200 0000 1987 4263 754      uikit … 754      report … 754
…088.242 set iban  SK31 1200 0000 1987 4263 7541     uikit … 7541     (no report)
```

The binding received the last keystroke (UIKit and the `@State` both held all 29 characters), but
`.onChange(of: values)` — the one path that reported the dictionary to the oracle — never fired for it: a burst of HID
keystrokes 7 ms apart lost the last change notification, and no later change came to carry it. A submit tapped after
the loss read the full value (`submits[-1].values.iban` = `…7541`, and the oracle then caught up, `dirty`'s onChange
reporting): 5 of 25 raw runs lost the last digit, all five with the full value in the app's state. So `Filled` was
true, and a real app with this binding would submit what the field shows; nothing for averi to fix.

**Fix (Forms.swift#binding).** The binding's setter reports the field itself (`values[tag] = $0; report()`), the
onChange on `values` gone. Raw loop after: 25 of 25 runs with the full value in the oracle.

**Live (averi):** forms `b1`, `b4`, `p2` five times each under idb and WDA (ios-forms-r7-lab-1…5.json): 30 fills, 0
lost. The full forms group (ios-forms-r7-lab-1.json): 46 cases, 38 ok, 8 LOUD, 0 mismatches (as rejudged with this
branch's judges; the run itself printed c2–c4 under idb LOUD, by the judge before §3) — the LOUD ones are b1d and b7
(both sources: `idb ui text` has no keycode for Š or ’, lab note 2026-10-15-lab-ios-type-text-cannot-type-non-ascii),
p5 (both: the secure field iOS clears when typed into again) and WDA's k2 and k3 (`Tapped text:"Transfer details" …
to hide the soft keyboard …, but it is still up`: the keyboard dismissal that did not get the keyboard down — task A4's).

## 2. A table long enough for ADR 0021 decision 4's long-list half

sheet-long-list's UIKit table is 56 rows (was 40), and a target L sits at row 30 with its own identifier
(`lab.sheet-long-list.L`, its frame the app's): content y 1920, whole over the offsets 1172–1920, past one stroke's
carry from the top (≈ 1040 pt under WDA) and wholly before the table's end (offset 2772) — a full final stroke (≈ 2080
from the top) would carry it past its window, so the carry case (live-visibility.ts#CARRY, now `carry:sheet-long-list.L`
asked by id) can fail on a missing cut. 80 rows were tried first: each WDA `/source` then took ~1.7 s and the carry
case's scroll_until timed out at 15 s after 5 swipes; 56 keep the reads near round 6's.

Captured (tests/fixtures/truth/ios-iphone17-ios27: sheet-long-list and sheet-long-list-short, the table shared): golden
1344 → 1350 checks (L's tap, colour and scroll_until under both sources, all green), 230 → 227 mismatches — F's three
idb rows green, the recapture recording F unlisted under idb (TargetTruth.listed), so the contract asks of it what an
unlisted target can meet (struck from presented.known.ts).

**Live (WDA), two runs:** the carry case reads LV6 in both, as expected while task A2's fix is not merged — L's parked
label read above the screen once the table has moved, turned three times, `failed after 6 swipes (maxSwipes) — element
in tree but never intersected the 402x874 viewport (last rect {"x":0,"y":-151,…})`, the app's table at rest at offset
183–266 (L at 1715–1799, below the screen). L's own scroll case the same (R-direction in run 1; in run 2 its turns
merged into one stroke the app logged, read not-reached). Both filed KNOWN as LV6 (live-known.ts); the case is ready
to measure the cut once LV6 is fixed. Under idb, F and L are never in the tree (idb lists the table's labels without
their identifiers, and no row below the fold): `failed after 6 swipes (maxSwipes) — element never appeared in the tree`,
LOUD, filed as that note (NO_ID). sheet-long-list-short unchanged (WDA F reached and tapped in both runs).

## 3. form-picker's c2–c4 on iOS

c2–c4 (a tap on the form beneath the expanded picker sheet) had only run on Android. iOS, both sources, twice
(ios-forms-r7-lab-1.json, ios-forms-r7-lab-picker.json): nothing fired in any run.
- WDA: `ERROR id:"lab.form-picker.name" is under button "Albania" … — a screen is presented over it (a modal or a
  sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped` — ok.
- idb: `ERROR Timed out after 5000ms waiting for element id:"lab.form-picker.name" to appear` — idb lists the
  presented sheet alone and marks nothing (ADR 0018, "iOS unchanged"), so not in the tree is all it can say.

The judge (live-forms.ts#judgeUnderSheet) is now per source: the presented remedy where the source marks the sheet,
the active-window hint on uiautomator, and idb's not-found ok under idb; anything else, or "close it first" twice,
LOUD.
