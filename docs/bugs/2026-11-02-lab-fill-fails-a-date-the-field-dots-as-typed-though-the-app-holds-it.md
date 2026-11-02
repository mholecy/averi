# BUG (fixed, false failure): a fill without clear of `31122026` into a field that dots it fails, though the app holds `31.12.2026`

**Found 2026-11-02** by batch-3 block H (backlog D37) on the lab simulator (`averi-lab iPhone 17`, iOS 27.0) and the
`averi_lab` AVD (API 33), main `6b4a44df`. Records `docs/truth/live-records/ios-idb-forms-d37-1.json`,
`ios-wda-forms-d37-1.json`, `android-forms-d37-1.json`, case `f11`.

> **Status (2026-11-02, D51):** FIXED on `fix/d51-dotted-date-lands` (ADR 0034's D51 amendment, merged 0a34980c),
> device-checked by batch-4 (main 7e6d2d47, `live.ts --groups forms`: docs/truth/live-records/ios-idb-forms-d51-1.json,
> ios-wda-forms-d51-1.json, android-forms-d51-1.json, 4/4 ok each; under idb the empty field reads `__.__.____` as its
> value, no placeholder, as part two assumed). Two causes, both fixed: an added `.`/`,`
> passes as a digit grouping (two or more marks over a digits-only typing, a group between two of them not three
> long: no decimal point, no thousands), and — idb only — the unnamed `__.__.____` read as the field's text before is a
> mask template, tried as no earlier text as well (narrowing D29's MINOR-A). "Why" below is the code before the fix;
> its "not the cause" holds for WDA and uiautomator only — under idb the unnamed mask was a second cause. The three
> live-known.ts entries are struck off; the *-forms-d37-1.json records rejudge f11 not known (the src before the fix).
>
> **Status (2026-11-02): open, filed KNOWN** (`scripts/truth/live-known.ts`, `ios idb f11`, `ios wda f11`,
> `android uiautomator f11`, failed-holds on `refused`). Backlog row D51. ADR 0034 (Consequences) lists a dotted date
> among the rule's deliberate false mismatches. Whether it stays one is that row's analysis.

## The screen

`form-format`'s `date` field (schema.ts#FieldFormat `date`: a `.` after the 2nd and the 4th digit, 8 digits at most,
placeholder `__.__.____`), on SwiftUI and Android.

## Observed (measured)

`type_text id:"lab.form-format.date" text: "31122026"` (no clear), then an assert of `31.12.2026`. Every source gave
the same result:

```
type_text → ERROR fill: typed 8 characters but the field shows 10 (content withheld from this error)
assert    → All 1 asserts passed / PASS  element id:"lab.form-format.date" with text "31.12.2026" exists
app       → date: "31.12.2026", focused
```

The live judge: `MISMATCH (failed-holds) … the app holds "31.12.2026", but averi failed`, under idb, WDA and
uiautomator. f12 (`31.12.2026` typed with its own dots, clear) is `Filled … (10 characters)` everywhere. The phone
cases f13 and f14 are ok everywhere, f13 under idb included.

## Why

src/interact/fill-landing.ts (ADR 0034's `reformatOf`) passes a reading that adds separators of the field's own only
when an added `.` or `,` is a thousands separator. `31.12.2026`'s groups (2, 2, 4) are not thousands, so the rule
fails the reading by design, and the reply is an ERROR. Under idb the `__.__.____` placeholder is also unnamed (D29),
but that is not the cause: WDA and uiautomator name it and fail the same way.

## Why it matters

The reply says the fill failed while the field holds exactly the date asked for. An agent retries, or reports a
failure that did not happen. The remedy the ADR gives works (type the value as the field shows it: f12), but the reply
does not suggest it. A reformat that only inserts separators between the same digits, in order, could land. Whether that
can be allowed without letting a wrong value pass (ADR 0034: "a wrong ok is worse than a false mismatch") needs
analysis.
