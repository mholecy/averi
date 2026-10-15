# TRIAGE: intermittently the lab app's SwiftUI model holds one or two characters fewer than were typed, while the field (tree and screenshot) shows them all — averi replies `Filled`; not yet known whether that is the lab app's binding or a risk on real apps

**Found 2026-10-15** by the live golden (scripts/truth/live.ts) on the lab simulator `averi-lab iPhone 17` (3AB1E82E,
iOS 27.0), averi = mobile-verify `truth/forms-ios` on `dda435b`'s `src/`. Status: OPEN, triage — not a confirmed averi
bug, not kept in any KNOWN list (the live golden is not a vitest test).

## Observed

The live golden judges a fill by the app's MODEL (the state file the lab app writes from its `@State`), not by any tree.
In one full run (idb + wda, 40 cases: 31 ok, 8 loud, 1 mismatch) the one mismatch was:

```
wda p2 form-prefilled: a clear fill replaces the prefill
type_text { selector: 'id:"lab.form-prefilled.iban"', text: "CZ65 0800 0000 1920 0014 5399", clear: true }
→ Filled id:"lab.form-prefilled.iban" (29 characters, cleared 29 characters first)
model: "CZ65 0800 0000 1920 0014 539"   (28 characters — the last "9" missing)
```

The same case on idb in the same run was ok; the commit that added the live golden (dd8b7fb) records losses of the last
1–2 characters on wda and idb alike over the day's runs. averi verifies a fill against the tree, and the tree (and the screenshot the run kept,
`wda-p2-*.png` in the session's scratch `shots/`) shows all 29: by what averi can see, `Filled` is true.

Without averi: a throwaway script launched `form-basic` ten times, tapped the e-mail field with a raw `idb ui tap`,
typed `jan.stastny@example.com` with a raw `idb ui text`, waited 3 s and read the model — 1 of 10 runs held a shorter
value. So the loss happens with idb's HID typing alone; it is not something averi's fill adds.

## What is known

- The model lags or loses the END of the typed string, never the middle; reading it again 3 s later (live.ts does)
  does not bring the characters back.
- The field's text (UITextField under SwiftUI's `TextField`) has them all; only the `@State` dictionary the lab app
  binds every field to (Form.swift: one `[String: String]` behind a hand-written `Binding(get:set:)` per field) does not.
- Both tree sources, both with and without averi.

## What is not known

- Whether a real app's form would lose them too. The lab's binding is unusual: every field writes into ONE dictionary
  `@State`, and `.onChange(of: values)` re-reports every field on each keystroke. Rapid HID keystrokes may race that
  write-back; an app with one `@State` (or one `@Published` property) per field may never see it.
- Whether the last keystrokes reach SwiftUI at all (no per-keystroke log in the app), or reach it and are overwritten.

## Next step

Add a cell variant with a plain per-field `@State var iban = ""` bound directly (`TextField(…, text: $iban)`), run the
raw `idb ui text` loop and live.ts's `p2`/`b3`/`b4` on both variants, 20+ times each. If only the dictionary variant
loses characters, it is the lab binding: fix the lab app and close this. If both do, the model can disagree with what
the tree shows after a fill on a real SwiftUI app, and averi's `Filled` (verified against the tree) can be wrong about
what the app will submit — then a bug note for averi (settle before verifying, or re-read after a pause) follows.
