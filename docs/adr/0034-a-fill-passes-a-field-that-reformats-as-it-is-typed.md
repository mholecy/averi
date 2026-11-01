# 34. A fill passes a field that reformats as it is typed — separators added, nothing else

Status: accepted 2026-10-31 (performance backlog row D18, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's proposal, tightened; tightened again in review round 1 — MAJOR-1 — with the orchestrator's decision on
an added `.` or `,`). Implemented on `perf/d18-reformatting-field`. Amended 2026-10-31 (D28: a reformatted strict
prefix is a dropped tail — the owner's iOS run of D18, the remedy, the diagnosis and the SwiftUI lab fix; implemented
on `fix/d28-reformat-dropped-tail`). Amended 2026-11-01 (D29: an earlier text that vanished — idb's unnamed
placeholder — and rf4's tail, a residual of blind typing; implemented on `fix/d29-placeholder-prior`).

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

`type_pin` (f10, rf5: a flow's tap and `type_pin` of `1234567` into the amount fields; measured 2026-10-31 after
review round 3): both models hold `1 234 567` (no-break spaces) — every digit landed in order, one keystroke a digit,
blind as designed. f1–f3 also asserted the tree's text against the model's (`holdsShown`): equal on Compose.

The forms groups at 56e71bce, every case of `live.ts --groups forms`:
- native: `# Live golden: 42 cases, 37 ok, 2 loud, 0 mismatches (0 not known), 3 skipped` — the 32 cases from before
  D18 and f1–f10; the two LOUD are b1d and b7 (adb's `input text` refuses `Š` and `’`, known), the three skipped kf1–kf3
  (the floating-keyboard cases, Gboard docked);
- React Native: `# Live golden: 11 cases, 11 ok, 0 loud, 0 mismatches (0 not known), 0 skipped` (rn1–rn6, rf1–rf5).

Typing was never garbled: one `input text` per character at 100 ms (D6) lands every character in order in each of
the four fields — the Compose model field puts the cursor at the end on every reformat, the VisualTransformation maps
it, React Native's controlled `TextInput` keeps it at the end; the commit nudge (DPAD left/right) moves nothing. Every
failure was the read-back, and with `clear` it cost a wipe and a retype of the whole value first.

## Decision

**A read-back that shows every character it should, in order, with only separators of the field's own added, has
landed — `reformatted` — and the reply says so: `Filled … (12 characters, the field shows them reformatted: 2
separators added)`.** One pure rule, `fill-reformat.ts#reformatOf(reading, expected)`, where `expected` is the value with
`clear`, else the field's earlier text and the value after it:

- every expected character is shown, in order and unchanged (letter case included); a typed space may be shown as a
  no-break or narrow no-break space (`respaced`); a separator that was typed must be shown: `12,50` read back as
  `1250` still fails;
- the added characters are ONE separator character — a space, U+00A0, U+202F, `-`, `/`, `.` or `,` — and each sits
  between two typed letters or digits: none leading (a `-` there is a sign), trailing, next to another, or after
  typed punctuation (`Hello, world` for `Hello,world` is an edit);
- they cut the typing into groups of two or more characters, but for one single-character group at either end
  (`1 234`, an IBAN's last `1`): `1-5` for `15` or `1/2` for `12` is no grouping;
- an added separator between two LETTERS passes only when the typing is a code — a digit in it and no typed space
  (review round 2: autocorrect's `a lot` for `alot` is no format; an MT IBAN's `MALT MTLC` is);
- an added `.` or `,` must be a thousands separator: not a character the typing holds itself, 1–3 digits before the
  first, not a lone `0` and not after a typed `.` or `,` (`0,12.345` is a fraction), exactly three digits between two
  of them and after the last, then no digit. A cents mask that shows `125` as `1.25`, `0.123` for `0123` or `1234.567`
  for `1234567` still fail.

What the rule cannot tell: `1.234` for `1234` is de-DE's thousands or a three-decimal mask's point. **The
orchestrator's decision (review round 1): an added `.` or `,` in thousands position passes with a ⚠ caveat, not the
aside; elsewhere it fails** (the rule above) — `the field shows them reformatted: 1 separator added — it added '.': check it is a thousands separator,
not a decimal point`. Spaces, `-` and `/` stay in the aside.

It is a pass, so it is part of the landing (`typeAndConfirm`'s `landing`, computed once per reading): the poll stops
on it and nothing is typed again. `tookText` gates it as it gates the exact rule (a non-input must have changed to show
the value itself), and a masked reading never is a reformat. The verdict carries it (`FillVerdict.reformatted`,
beside `retyped`, or the `reformatted-point` caveat), counts only — a value may be a credential.

## Consequences

- A wrong "ok" is worse than a false mismatch, so the rule is kept tight. Its false mismatches, all failing loudly as
  before — for each, type the value as the field shows it:
  - a field that MOVES a typed separator (`12 34` regrouped `1 234`);
  - a no-clear fill whose earlier text the field regroups (`1 234` + `5` → `12 345`), or one typed into the middle of
    the text;
  - a `.`/`,` grouping that is not by thousands (Indian lakh grouping), and a dotted date (`31.12.2026` for
    `31122026`: its `.` groups are no thousands);
  - mixed separators (`+421 900-123-456`: one separator character per reading);
  - an eager trailing mark (`SK31 ` after four characters, `31/`);
  - spaced single characters (`1 2 3 4`: groups of one);
  - a separator outside the set (`12:30` for `1230`), a prefix or a suffix (`€`);
  - a letter split by a separator in prose (`a lot` for `alot` — autocorrect; review round 2, MAJOR-A): between two
    letters a separator passes only in a code, digits and no typed space (an IBAN's `MALT MTLC`).
  Astral letters and digits (`𝐀𝐁𝐂𝐃 1234`) were one until review round 2 (NIT-B): the rule now reads code points on
  both sides, and they pass; an emoji or a symbol is neither letter nor digit, so a separator beside one still fails —
  the safe side.
- **Residual, deliberate (review round 3, MINOR-1):** a split inside a code (`Pass word1`, `user 123name`,
  `jo hn2@x.com`) and any split between a letter and a digit pass as a reformat, said in the reply's aside — no known
  input source inserts a separator there, and a rule tight enough to refuse them would refuse postcodes, number plates
  and IBANs.
- **Residual (review round 1, MINOR-3; a backlog row of its own) — FIXED by D28, see the amendment below: a dropped
  tail on a reformatting field was neither typed again nor reported.** ADR 0023's retype needed the reading to be an
  EXACT strict prefix of what the field should hold, and a reformatted partial reading (`SK31 12` for `SK311200…`)
  was none — so the tail was not retyped, and `reportDroppedTail` was never said, so D24's first-key-alone split
  never started for that app. With `clear` the wipe and retype of the whole value ran instead; without it the fill
  failed. Not seen on Android (no drop); the drop was iOS React Native's (`idb ui text`), seen live in the owner's
  iOS run (rf2, the amendment).
- `type_text` without a selector and a flow's `type:` stay blind (no read-back, as designed); they typed every
  character into the reformatting fields (f6, f8, rf3, rf4). `type_pin` typed every digit too (f10, rf5; "Measured" above).
- The ibanShown case shows the uiautomator dump reads a Compose `VisualTransformation`'s SHOWN text, not the model's:
  the read-back cannot tell a display-only format from a model one — both are the same pass.
- Not device-checked on iOS: the SwiftUI `Forms.swift` change (the binding's setter formats) is source only — this
  sandbox cannot build SwiftUI (swiftc's macro plugin) — and the React Native iOS build was not made either. A
  SwiftUI binding whose setter writes back a DIFFERENT string is a known pitfall: the TextField may keep showing what
  was typed while the model holds the formatted text, so the screen and the model can diverge. f1–f3 therefore assert
  the tree's text against the model's after the fill (`holdsShown` in `scripts/truth/live.ts`): a divergence is a
  MISMATCH even when the fill passed. The owner builds both apps and runs `live.ts --udid … --cases f1,f2,f3,f5,f6,f7,f8,f9,f10` and
  `--app react-native --cases rf1,rf2,rf3,rf4,rf5`.

## Amendment: a reformatted prefix is a dropped tail (2026-10-31, D28)

**Measured** (the owner, iPhone 17 simulator, iOS 27.0, idb; `live.ts` at fc7c80bc):

| case | the app's model | averi said | verdict |
|---|---|---|---|
| rf1 React Native, fill, no clear, IBAN | grouped | Filled (2 separators added) | ok |
| rf2 React Native, fill, clear, `1234567,89` into amount | `1 234 567,` | ERROR … (after one wipe and retype) … shows 10 — as many characters as were typed, 9 differing: the app transformed the input | LOUD |
| rf3 React Native, fill then `type_text` types on | grouped | Typed 8 | ok |
| rf4 React Native, a flow's tap + `type:` | `SK31 1200 0` | (blind) | LOUD |
| rf5 React Native, `type_pin` | grouped | (blind) | ok |
| f1–f3 SwiftUI, fills into iban / amount | `SK31 1200 0000`, `1 234 567,89` | Filled (12 / 10 characters) — exact | MISMATCH: the tree showed `SK3112000000`, `1234567,89` |
| f5–f10 SwiftUI | as typed / grouped | ok | ok |

Three findings:
- **rf2 is the residual above, live.** The first burst dropped `89`; the field grouped what landed (`1 234 567,`). That
  reading is no EXACT prefix, so ADR 0023's tail was not typed and `reportDroppedTail` was not said (D24's
  first-key-alone split never started for the app); the clear's wipe and whole retype ran instead and dropped the
  tail again — and the error blamed a transformation, because the grouped short reading is as long as the value.
  The LOUD verdict was right; the remedy and the diagnosis were wrong.
- **rf4 is a flow's blind `type:`**: no read-back, by design (above). It has none to add: `type:` types into whatever
  has the focus and cannot tell which field that is, so it cannot know what it should hold. What it does get is the
  adapter's typing: once a fill in the same averi session has reported the app's drop (rf2, after this change), every
  later typing into that app — `type:` too — sends its first key alone (ADR 0023's D24/D25 amendments), which is what
  D25 measured to land a burst whole. Accepted, as blind typing is. (D29, below: the split ran in rf4 and the tail
  still dropped — a residual.)
- **f1–f3 are the SwiftUI pitfall predicted above** — a lab-app fidelity bug, not averi's: averi reported what the
  screen showed (`Filled … (12 characters)`, exact), and the screen was not the model.

**Decision.**
- **A reading that is `reformatOf` a strict prefix of what the field should hold, some of the typing in it, is a
  dropped tail** (`fill-reformat.ts#tailOf`, shared by `droppedTail` and `whereTyped`): the tail alone is typed again at
  the end — no wipe — under every condition ADR 0023 sets (`on-return` delivery, a steady reading, the typing provably
  in the field, at most `MAX_TAIL_RETYPES`, again only when a retype moved the field), the drop is reported once it
  landed whole (`reportDroppedTail` → D24's split), and the read-back then passes as `reformatted`. Tight: the prefix
  is exact by typed characters (the same greedy walk as `reformatOf`), only grouping added, and `reformatOf`'s rules
  are judged over the WHOLE typing (its new `typing` parameter): one separator kind, letters split only when the whole
  typing is a code (`a1bc de` for `a1bcde f` is no prefix — the typing holds a space), an added `.`/`,` only as a
  thousands mark the whole typing does not hold itself (`1,234` for `1234,5` is none), no trailing mark
  (`SK31 1200 ` for `SK3112000000`), groups of two or more but one at an end.
- **The caret.** The tail is typed where the caret is. React Native's controlled `TextInput` keeps the caret at the
  end as it regroups (Context above; on iOS rf3's typing on after a reformatting fill landed in order), and averi
  sends nothing to move it. A field that moved the caret elsewhere would put the tail in the middle: the read-back
  then fails (no reformat of the value), the safe side. Android never retypes a tail (`may-arrive-late`), so there
  the change is the diagnosis and the `elsewhere` proof below.
- **The diagnosis.** A mismatch whose reading is such a prefix is `Difference` `dropped-tail` (`fill-verdict.ts#
  differenceOf`, before the case and same-length comparisons): `… but the field shows 10 — the first 8 typed
  characters are there, grouped by the field (separators of its own added), the last 2 did not land: dropped, or
  refused by the field (a length cap, a character it does not take) — not a transformed input; content withheld from
  this error`. A prefix the field only RESPACED (a typed space shown as a no-break space, nothing added — `Jan\u00A0`
  for `Jan Novak`) says `its spaces shown as another kind of space` instead of `grouped by the field` (D28 code
  review; `Difference.grouped`). The reading cannot tell a drop from a refusal (review round 1, MINOR-1: a grouping field with a
  maxLength, an integer-only amount that ignores `,`), so the error names both; on iOS the tail was typed again
  first, so a fill failing the same way twice is a field refusing the rest. An exact prefix keeps its old `length`
  wording.
- **The rules live in a pure leaf** (review round 1, MINOR-2): `reformatOf`, `prefixOf`, `tailOf` and the separator
  sets are `interact/fill-reformat.ts`'s, `reformatOf` and `prefixOf` taking ONE greedy walk (`walk`, D28 code review); the typing (`fill-type.ts`) and the judge (`fill-verdict.ts`) both import
  it, and neither imports the other.
- **Android** (review round 1, NIT-2). No tail is typed again there, but `whereTyped`'s missing text now comes from
  `tailOf` on every platform: an Android clear-fill whose reading is a reformatted prefix, and whose sibling input
  GAINED a part of the missing text, reads `elsewhere` — the typing left the field — and skips the wipe and retype,
  failing loudly instead. Before, such a reading proved nothing (`unproven`) and the wipe and retype ran. The safe
  direction: deletes and a retype sent where the focus went would land in that sibling.
- **The lab (SwiftUI).** `Forms.swift`'s formatting fields are a UIKit field now (`FormattingTextField`, a
  `UIViewRepresentable`): `textField(_:shouldChangeCharactersIn:replacementString:)` applies each key to the field's
  text, formats it, shows it, puts the caret at the end and writes the model in that one call — the screen and the
  model cannot diverge, and a burst cannot leave them a key apart (the trap `binding` documents; an `.onChange` that
  formats a write later was the other option, and is that trap). The focus is reported through the delegate
  (@FocusState cannot follow a representable); no formatting cell focuses programmatically. Source only: this
  sandbox cannot build SwiftUI (`swiftc -parse` passes; typecheck stops at the macro plugin, as before).

**Mutation-checked**: twelve mutants of `tailOf`/`prefixOf`, `reformatOf`'s `typing`, `droppedTail`, `whereTyped`'s
missing text and `differenceOf`'s new branch, each killed by the new tests.

**Not checked on the device.** The owner re-runs, on iOS: `live.ts --udid … --app react-native --cases
rf1,rf2,rf3,rf4,rf5` (rf2 should read `Filled … (10 characters, the last 2 characters typed again after the field
dropped them, the field shows them reformatted: 2 separators added)`, or Filled at once; rf4 runs after rf2 in the
same session and should land through the first-key-alone split), and after rebuilding the lab app `live.ts --udid …
--cases f1,f2,f3,f5,f6,f7,f8,f9,f10` (f1–f3: the tree now shows the model's grouped text). Android is unchanged but for
the diagnosis wording (no retype there); its forms groups need no re-run beyond the usual golden.

## Amendment: an earlier text that vanished, and rf4's tail (2026-11-01, D29)

**Measured** (the owner, iPhone 17 simulator, iOS 27.0, idb; `live.ts` at b768f376, both lab apps rebuilt): f2, f3,
f5, f6, f8, f9, f10 ok — f2 and f3 `Filled … reformatted: 2 separators added`, the tree showing the model's text (the
UIKit lab field works); rf1 and rf2 ok, each `the last character typed again after the field dropped it`
(D28's retype, live); rf3 and rf5 ok. Not ok: **f1 and f7** (MISMATCH: the app held `SK31 1200 0000` /
`CZ65 0800 0000`, averi failed `typed 12 characters but the field shows 14`; f7's first fill `SK3112` failed `typed 6
… shows 7`, its clear said `the field still shows 16 characters … its hint or placeholder`), and **rf4** (LOUD: the
app held `SK31 1200 00`).

- **f1 and f7: the earlier text was an unnamed placeholder.** idb names no placeholder (adapters/types.ts,
  `UiNode.placeholder`), so the UIKit iban field's `SK00 0000 0000 …` (16 characters, fixtures/apps/cells/forms.json)
  is read as the empty field's value — the fill's `before` — and vanishes at the first key. Without clear the reading
  was judged after it (`priorText(intent) + value`): no reformat of that, no prefix of it (so a dropped tail there was
  never typed again, and D24's split never started — the same bug as D28's, one step earlier), and the exact rule
  passed only a value typed with its own spaces (f5, `held.includes(value)`); with clear the earlier text is none, so
  f2 passed. **Decision:** without clear, a reading whose letters and digits do not START with the earlier text's is
  judged after no earlier text as well, second (`fill-reformat.ts#priorsOf`, asked by `reformatAfter` — the typing's
  landing rule — and by `tailOf` — the retype, `whereTyped`'s missing text and the verdict's `dropped-tail`). Letters
  and digits, not the text as typed (review round 1, MAJOR-1): a field that regroups as it is typed shows an earlier
  `1,000` as `10,00…` once typed into, and that text is still there — compared as typed, `10,001,000` passed for a
  typed `10001000` and `100,010` retyped a `5` for `1000105`. `reformatOf`'s and `prefixOf`'s rules are unchanged,
  judged over the value alone; a reading that starts with the earlier text's letters and digits is judged after it,
  never without it. The earlier text is tried first: a reading that is a prefix of it too (`SK` of `SK00 …`) shows
  nothing of the typing landed, and nothing is typed again. An earlier text with no letters or digits (a `—`, a
  `__/__/____` mask) keeps the pre-D29 judgment — a false mismatch, never a wrong pass — deliberately not loosened
  (review round 2, MINOR-A, the owner's decision).
  **Where it reaches** (review round 1, MINOR-2): every source that names no placeholder — idb, and the API 33
  uiautomator dump (a classic EditText's hint dumped as its `text`, android.ts; the Android lab's fields are Compose,
  which dump no placeholder, so the lab is not affected) — and, on both platforms, a field that replaces its earlier
  text on focus (a select-all), which the reading cannot tell from an unnamed placeholder: both are judged as the value
  alone, reformatted or with a dropped tail retyped (on iOS).
  **Mutation-checked**: ten mutants, each killed — no fallback (6 tests fail); no guard (3); the value alone instead of
  both (1); the fallback in `tailOf` only removed (3); in `reformatAfter` only (4); the fallback under clear too (1);
  the guard on the text as typed (1); the guard `includes` instead of a start (1); the order reversed, the value alone
  first (1); fill-type's old landing expression (2).
  **The golden says nothing of this change**: it replays tree reads and never runs a fill, so its `Changed 0` is no
  evidence either way; the unit tests and the owner's device re-run are.
- **rf4 is a residual of blind typing — `fill:` is its remedy.** The companion log shows D24's split ran: the first
  key alone (`S`, one idb `hid` call at 07:19:08.880), the other eleven in one burst at 07:19:09.127 (24 HID frames),
  after rf1/rf2 had reported the app's drop — and the React Native field, reformatting on every keystroke, still
  dropped the last two (`SK31 1200 00`). A flow's `type:` (engine → interact/type-text.ts `typeIntoFocused`) never
  reads back, by design (above): it cannot see the drop, so it cannot type the tail again. **Accepted**: into a field
  that reformats as it is typed, use a flow's `fill:` (or `type_text` with a selector), which reads back and types a
  dropped tail again — rf1 and rf2 pass that way on the same field. scripts/truth/live.ts marks rf4 a known LOUD on
  iOS in a comment (live-known.ts files visibility cases only); skill/references/averi-yaml.md's `type` row says to use
  `fill`.

**Not checked on the device.** The owner re-runs, on iOS: `live.ts --udid … --cases f1,f7` (both should read `Filled …
the field shows them reformatted`: f1 `2 separators added`, f7's fills `1` and `2`).
