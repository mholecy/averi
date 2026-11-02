# BUG (open): under idb, an unlabelled SwiftUI `ProgressView` reads as content, so `ensure_state`'s held "no" (D2) can end on a loading spinner

**Found 2026-11-02** by batch-3 block G (backlog D30, D37) on the lab simulator (`averi-lab iPhone 17`, iOS 27.0,
402x874), main `6b4a44df`. Record `docs/truth/live-records/ios-idb-ensure-d30-1.json`, case `h2`; the raw read of the
spinner `docs/truth/live-records/ios-idb-held-no-spinner-describe-all-d30-1.json` (flat) and
`…-nested-d30-1.json` (nested, a moment later).

> **Status (2026-11-02): open, filed KNOWN** (`scripts/truth/live-known.ts`, `ios idb h2`, held-early on `other`).
> Backlog row D50. Not on WDA or uiautomator: h2 is ok there.

## The screen

`held-no-spinner` (fixtures/apps/ios/AveriLab/Held.swift, catalog `held: { bareMs: 6000, spinnerMs: 4000 }`): a bare
white root for 6 s, then an unlabelled `ProgressView()` alone for 4 s, then Welcome with a Continue button; Continue
shows Home. The live case `h2` asks `ensure_state home` (ladder: `continue`, no wipe ahead).

## Observed (measured)

The app's clock (the record's `late.events`, seconds after the bare phase): spinner at +6.23, Welcome at +10.49,
Continue tapped at +11.42 — **0.92 s after Welcome**, though averi said the screen had held 2.5 s:

```
state home: second look: not detected, the screen held still 2.5 s — running continue before the 20 s window's end
```

The live judge: `MISMATCH (held-early) … Continue tapped 0.92 s after Welcome, though the screen held 2.5 s: the hold
began before Welcome — on what came before it`. The hold began ≥ 1.58 s before Welcome, inside the spinner phase.

The same case is ok under WDA (Continue tapped 3.18 s after Welcome, held 2.487 s; D27 maps WDA's spinner to
`progress`) and under uiautomator (5.22 s after Welcome, held 2.124 s). h1 (no spinner) and h3 are ok under idb.

What idb lists inside the spinner phase (`idb ui describe-all --json` at bare + 7.51 … 7.69 s, the spinner from
+6.36 s by the app's log):

```
type=Application     role=AXApplication     label='AveriLab'  value=None  frame=(0,0 402x874)
type=GenericElement  role=AXGenericElement  label=None  id=None  value='1'  frame=(191,427 20x20)
                     role_description=''  traits=["UpdatesFrequently","Scrollable"]
```

No progress or activity type, role or role description: the spinner is a `GenericElement` (`AXGenericElement`), mapped
to `other`. It carries a value (`'1'`), and src/ui-tree/bare-tree.ts counts a valued `other` that is no wrapper as
content — so the spinner screen is not bare, it holds still (its AX value does not change), and the hold tracker
counts it as a held "no".

## Why it matters

D2's held "no" is meant for a rendered screen that answers no; a loading spinner is not an answer yet. Under idb the
second look can end on one and run the next rung while the app is still loading — here a cheap rung, and Welcome
came 1.58 s later, so the tap still found Continue. With a slower load, the rung would run on the spinner screen.

## Fix direction (needs analysis)

D27 maps WDA's `ActivityIndicator` to `progress`; here no type or role says progress. Mapping `GenericElement` is
too wide. The `UpdatesFrequently` trait is the only hint in the dump. Whether idb exposes it for every spinner, and
whether anything else carries it, still needs checking.
