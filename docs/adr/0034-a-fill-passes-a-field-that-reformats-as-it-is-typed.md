# 34. A fill passes a field that reformats as it is typed — separators added, nothing else

Status: accepted 2026-10-31 (performance backlog row D18, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's proposal, tightened; tightened again in review round 1 — MAJOR-1 — with the orchestrator's decision on
an added `.` or `,`). Implemented on `perf/d18-reformatting-field`.

## Context

- A fill's read-back (`interact/fill-type.ts#typeAndConfirm`, `landed`) passes a field that shows EXACTLY the value
  with `clear`, or holds it inside its text without. A banking form's IBAN field groups what is typed in fours, its
  amount field groups the thousands: the user types `SK3112000000`, the field shows `SK31 1200 0000`. No lab field
  did that until D18 (Forms.kt, Forms.swift and the React Native `useField` took the text as typed), so averi's typing
  pace (D6, ADR 0023's D24/D25) and the read-back were unproven there.
- The lab now has such fields (`form-format` in the forms family, `rn-format` in the react-native one;
  `FieldFormat` in `scripts/truth/schema.ts`): `iban` (the model reformatted on every change, the cursor put at the end —
  a Compose `TextFieldValue`), `amount` (thousands by a no-break space), and on Compose `ibanShown` (a
  `VisualTransformation`: only the screen grouped, the model as typed); React Native's `onChangeText` reformats.

## Measured (2026-10-31, averi_lab AVD API 33, live.ts against the app's model; before = main 036a1050)

| case | the app's model | before | after |
|---|---|---|---|
| f1 fill, no clear, `SK3112000000` into iban | `SK31 1200 0000` | ERROR typed 12 … shows 14 | Filled (reformatted: 2 separators added) |
| f2 the same with clear | same | ERROR, after a wipe and retype | Filled, nothing typed again |
| f3 clear, `1234567,89` into amount | `1 234 567,89` (NBSP) | ERROR, after a wipe and retype | Filled (2 separators added) |
| f4 clear, ibanShown (VisualTransformation) | `SK3112000000` | ERROR — uiautomator reads the SHOWN text | Filled (2 separators added) |
| f5 no clear, `SK31 1200 0000` typed with its spaces | same | Filled | Filled |
| f6 fill `SK31`, then `type_text` with no selector `12000000` | `SK31 1200 0000` | Typed 8 (blind) | same |
| f7 fill, a clear alone, a fill | `CZ65 0800 0000` | the clear: ok (7 deleted); both fills ERROR | all three ok |
| f8 a flow's tap + `type:` | `SK31 1200 0000` | ok (blind) | same |
| f9 a flow's `fill:` with clear | same | ERROR | ok |
| rf1–rf2 React Native, as f1 and f3 | grouped | ERROR | Filled |
| rf3–rf4 React Native, `type_text` / `type:` | grouped | ok (blind) | same |

`type_pin` (f10, rf5: a flow's tap and `type_pin` of `1234567` into the amount fields): NOT YET MEASURED — the cases
are written; their run, and the forms groups' summary lines, follow once the device is free.

Typing was never garbled: one `input text` per character at 100 ms (D6) lands every character in order in each of
the four fields — the Compose model field puts the cursor at the end on every reformat, the VisualTransformation maps
it, React Native's controlled `TextInput` keeps it at the end; the commit nudge (DPAD left/right) moves nothing. Every
failure was the read-back, and with `clear` it cost a wipe and a retype of the whole value first.

## Decision

**A read-back that shows every character it should, in order, with only separators of the field's own added, has
landed — `reformatted` — and the reply says so: `Filled … (12 characters, the field shows them reformatted: 2
separators added)`.** One pure rule, `fill-type.ts#reformatOf(reading, expected)`, where `expected` is the value with
`clear`, else the field's earlier text and the value after it:

- every expected character is shown, in order and unchanged (letter case included); a typed space may be shown as a
  no-break or narrow no-break space (`respaced`); a separator that was typed must be shown: `12,50` read back as
  `1250` still fails;
- the added characters are ONE separator character — a space, U+00A0, U+202F, `-`, `/`, `.` or `,` — and each sits
  between two typed letters or digits: none leading (a `-` there is a sign), trailing, next to another, or after
  typed punctuation (`Hello, world` for `Hello,world` is an edit);
- they cut the typing into groups of two or more characters, but for one single-character group at either end
  (`1 234`, an IBAN's last `1`): `1-5` for `15` or `1/2` for `12` is no grouping;
- an added `.` or `,` must be a thousands separator: not a character the typing holds itself, 1–3 digits before the
  first and not a lone `0`, exactly three digits between two of them and after the last, then no digit. A cents mask
  that shows `125` as `1.25`, `0.123` for `0123` or `1234.567` for `1234567` still fail.

What the rule cannot tell: `1.234` for `1234` is de-DE's thousands or a three-decimal mask's point. **The
orchestrator's decision (review round 1): a reformat whose added separator is `.` or `,` passes with a ⚠ caveat, not
the aside** — `the field shows them reformatted: 1 separator added — it added '.': check it is a thousands separator,
not a decimal point`. Spaces, `-` and `/` stay in the aside.

It is a pass, so it is part of the landing (`typeAndConfirm`'s `landing`, computed once per reading): the poll stops
on it and nothing is typed again. `tookText` gates it as it gates the exact rule (a non-input must have changed to show
the value itself), and a masked reading never is a reformat. The verdict carries it (`FillVerdict.reformatted`,
beside `retyped`, or the `reformatted-point` caveat), counts only — a value may be a credential.

## Consequences

- A wrong "ok" is worse than a false mismatch, so the rule is kept tight; its false mismatches, all failing loudly as
  before: a field that MOVES a typed separator (`12 34` regrouped `1 234`), a no-clear fill whose earlier text the
  field regroups (`1 234` + `5` → `12 345`), a no-clear fill typed into the middle of the text, a `.`/`,` grouping that
  is not by thousands (Indian lakh grouping), a field that adds a prefix or suffix (`€`).
- **Residual (review round 1, MINOR-3; a backlog row of its own): a dropped tail on a reformatting field is neither
  typed again nor reported.** ADR 0023's retype needs the reading to be an EXACT strict prefix of what the field
  should hold, and a reformatted partial reading (`SK31 12` for `SK311200…`) is none — so the tail is not retyped,
  and `reportDroppedTail` is never said, so D24's first-key-alone split never starts for that app. With `clear` the
  wipe and retype of the whole value still runs; without it the fill fails as before. Not seen on Android (no drop);
  the drop is iOS React Native's (`idb ui text`), and the iOS check of these fields is the owner's (below).
- `type_text` without a selector and a flow's `type:` stay blind (no read-back, as designed); they typed every
  character into the reformatting fields (f6, f8, rf3, rf4). `type_pin`: see the measurement below.
- The ibanShown case shows the uiautomator dump reads a Compose `VisualTransformation`'s SHOWN text, not the model's:
  the read-back cannot tell a display-only format from a model one — both are the same pass.
- Not device-checked on iOS: the SwiftUI `Forms.swift` change (the binding's setter formats) is source only — this
  sandbox cannot build SwiftUI (swiftc's macro plugin) — and the React Native iOS build was not made either. A
  SwiftUI binding whose setter writes back a DIFFERENT string is a known pitfall: the TextField may keep showing what
  was typed while the model holds the formatted text, so the screen and the model can diverge. f1–f3 therefore assert
  the tree's text against the model's after the fill (`holdsShown` in `scripts/truth/live.ts`): a divergence is a MISMATCH even when the
  fill passed. The owner builds both apps and runs `live.ts --udid … --cases f1,f2,f3,f5,f6,f7,f8,f9,f10` and
  `--app react-native --cases rf1,rf2,rf3,rf4,rf5`.
