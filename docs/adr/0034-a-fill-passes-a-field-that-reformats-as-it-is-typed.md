# 34. A fill passes a field that reformats as it is typed — separators added, nothing else

Status: accepted 2026-10-31 (performance backlog row D18, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's proposal, tightened). Implemented on `perf/d18-reformatting-field`.

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
  no-break or narrow no-break space (`respaced`);
- the only characters added are separators — a space, U+00A0, U+202F, `-`, `/`, and `.` or `,` — never before the
  first expected character (a leading `-` is a sign);
- an added `.` or `,` must be a thousands separator: exactly three digits after it, then no digit — a cents mask that
  shows `125` as `1.25` changed the amount and still fails;
- a separator that was typed must be shown: `12,50` read back as `1250` still fails.

It is a pass, so it is part of `landed`: the poll stops on it and nothing is typed again. A non-input still proves it
took the text only by showing it exactly (`tookText`), and a masked reading never is a reformat. The verdict carries
it (`FillVerdict.reformatted`, beside `retyped`), counts only — a value may be a credential.

## Consequences

- A wrong "ok" is worse than a false mismatch, so the rule is kept tight; its false mismatches, all failing loudly as
  before: a field that MOVES a typed separator (`12 34` regrouped `1 234`), a no-clear fill whose earlier text the
  field regroups (`1 234` + `5` → `12 345`), a no-clear fill typed into the middle of the text, a `.`/`,` grouping that
  is not by thousands (Indian lakh grouping), a field that adds a prefix or suffix (`€`).
- A dropped tail on a reformatting field is not typed again (ADR 0023): only an exact strict prefix proves which
  characters are missing. With `clear` the wipe and retype still runs; without it the fill fails as before. Not seen:
  the drop is iOS React Native's (`idb ui text`), and the iOS check of these fields is the owner's (below).
- `type_text` without a selector, a flow's `type:` and `type_pin` stay blind (no read-back, as designed); they typed
  every character into the reformatting fields.
- The ibanShown case shows the uiautomator dump reads a Compose `VisualTransformation`'s SHOWN text, not the model's:
  the read-back cannot tell a display-only format from a model one — both are the same pass.
- Not device-checked on iOS: the SwiftUI `Forms.swift` change (the binding's setter formats) is source only — this
  sandbox cannot build SwiftUI (swiftc's macro plugin) — and the React Native iOS build was not made either. The owner
  builds both and runs `live.ts --udid … --cases f1,f2,f3,f5,f6,f7,f8,f9` and `--app react-native --cases rf1,rf2,rf3,rf4`.
