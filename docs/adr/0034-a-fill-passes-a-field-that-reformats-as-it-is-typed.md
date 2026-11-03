# 34. A fill passes a field that reformats as it is typed — separators added, nothing else

Status: accepted 2026-10-31 (performance backlog row D18, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's proposal, tightened; tightened again in review round 1 — MAJOR-1 — with the orchestrator's decision on
an added `.` or `,`). Implemented on `perf/d18-reformatting-field`. Amended 2026-10-31 (D28: a reformatted strict
prefix is a dropped tail — the owner's iOS run of D18, the remedy, the diagnosis and the SwiftUI lab fix; implemented
on `fix/d28-reformat-dropped-tail`). Amended 2026-11-01 (D29: an earlier text that vanished — idb's unnamed
placeholder — and rf4's tail, a residual of blind typing; implemented on `fix/d29-placeholder-prior`). Amended
2026-11-01 (D31: the accepted residuals numbered under "Residuals accepted"; rf4's is residual 2, filed in live-known.ts).
Amended 2026-11-02 (D51: an added `.`/`,` that groups digits — a dotted date, a lakh — and a `_` mask template that is
no earlier text, narrowing D29's MINOR-A; residual 4 accepted; implemented on `fix/d51-dotted-date-lands`).
Amended 2026-11-02 (D53: a reading that shows every typed character in order with only separators the rules refuse
fails `separated`, naming the check and the remedy; implemented on `fix/d53-separated`).
Amended 2026-11-02 (D60: a dropped tail that ends in an eager trailing mark is typed again; implemented on
`fix/d60-eager-trailing-tail`).
Amended 2026-11-03 (batch-9: D60's live proof on iOS React Native — the D60 amendment's last paragraph).
Amended 2026-11-03 (D61: an unnamed placeholder whose letters and digits start the value's — idb's `+421` — no longer
turns a correct grouped fill into `length`; D29's pinned `1234 5678` after `1` lands; residual 6 accepted; implemented
on `fix/d61-placeholder-prior`).
Amended 2026-11-03 (D63: without clear, a reading still exactly what the field showed when typing began has not
landed, unless it is the value itself — the exact rule's `includes` no longer passes a reading byte for byte what the
field showed when typing began; residuals 7 and 8 accepted; implemented on `fix/d63-unchanged-reading`).
Amended 2026-11-03 (D64: without clear, the value must be in what was typed past the earlier text, not anywhere in the
reading — a capped, dropped or misdirected typing whose earlier text holds the value no longer passes; D63's guard
folded into the rule; residual 8 (A) closed, residual 9 accepted; implemented on `fix/d64-typed-past-prior`).

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
    `31122026`: its `.` groups are no thousands) (see the D51 amendment below);
  - mixed separators (`+421 900-123-456`: one separator character per reading);
  - an eager trailing mark (`SK31 ` after four characters, `31/`) — on a FULL reading, `separated` since D53; a strict
    prefix that ends in one (`SK31 1200 ` for `SK3112000000`) is a dropped tail, its tail typed again (see the D60
    amendment below);
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
  dropped tail** (`fill-landing.ts#tailOf` since A2, shared by `droppedTail` and `whereTyped`): the tail alone is typed again at
  the end — no wipe — under every condition ADR 0023 sets (`on-return` delivery, a steady reading, the typing provably
  in the field, at most `MAX_TAIL_RETYPES`, again only when a retype moved the field), the drop is reported once it
  landed whole (`reportDroppedTail` → D24's split), and the read-back then passes as `reformatted`. Tight: the prefix
  is exact by typed characters (the same greedy walk as `reformatOf`), only grouping added, and `reformatOf`'s rules
  are judged over the WHOLE typing (its new `typing` parameter): one separator kind, letters split only when the whole
  typing is a code (`a1bc de` for `a1bcde f` is no prefix — the typing holds a space), an added `.`/`,` only as a
  thousands mark the whole typing does not hold itself (`1,234` for `1234,5` is none), no trailing mark
  (`SK31 1200 ` for `SK3112000000` — since D60 this holds for a full reading only: a prefix's trailing mark is judged
  with the next typed character after it, see the D60 amendment below), groups of two or more but one at an end.
- **The caret.** The tail is typed where the caret is. React Native's controlled `TextInput` keeps the caret at the
  end as it regroups (Context above; on iOS rf3's typing on after a reformatting fill landed in order), and averi
  sends nothing to move it. A field that moved the caret elsewhere would put the tail in the middle: the read-back
  then fails (no reformat of the value), the safe side. Android never retypes a tail (`may-arrive-late`), so there
  the change is the diagnosis and the `elsewhere` proof below.
- **The diagnosis.** A mismatch whose reading is such a prefix is `Difference` `dropped-tail` (`fill-landing.ts#
  differenceOf` since A2, before the case and same-length comparisons): `… but the field shows 10 — the first 8 typed
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
  judged after no earlier text as well, second (`fill-landing.ts#priorsOf` since A2, asked by `landedReformat` — the typing's
  landing rule — and by `tailOf` — the retype, `whereTyped`'s missing text and the verdict's `dropped-tail`). Letters
  and digits, not the text as typed (review round 1, MAJOR-1): a field that regroups as it is typed shows an earlier
  `1,000` as `10,00…` once typed into, and that text is still there — compared as typed, `10,001,000` passed for a
  typed `10001000` and `100,010` retyped a `5` for `1000105`. `reformatOf`'s and `prefixOf`'s rules are unchanged,
  judged over the value alone; a reading that starts with the earlier text's letters and digits is judged after it,
  never without it. The earlier text is tried first: a reading that is a prefix of it too (`SK` of `SK00 …`) shows
  nothing of the typing landed, and nothing is typed again. An earlier text with no letters or digits (a `—`, a
  `__/__/____` mask) keeps the pre-D29 judgment — a false mismatch, never a wrong pass — deliberately not loosened
  (review round 2, MINOR-A, the owner's decision; see the D51 amendment below). So does an unnamed placeholder whose
  letters and digits are a prefix of the typed value's (a `+421` placeholder, `421903…` typed): the fallback never
  runs, the old false mismatch.
  This widens ADR 0023's decision 2 in that one case (its header says so).
  **Where it reaches** (review round 1, MINOR-2): every source that names no placeholder — idb, and the API 33
  uiautomator dump (a classic EditText's hint dumped as its `text`, android.ts; the Android lab's fields are Compose,
  which dump no placeholder, so the lab is not affected) — and, on both platforms, a field that replaces its earlier
  text on focus (a select-all), which the reading cannot tell from an unnamed placeholder: both are judged as the value
  alone, reformatted or with a dropped tail retyped (on iOS).
  **Mutation-checked**: ten mutants, each killed — no fallback (6 tests fail); no guard (3); the value alone instead of
  both (1); the fallback in `tailOf` only removed (3); in `landedReformat` only (4); the fallback under clear too (1);
  the guard on the text as typed (1); the guard `includes` instead of a start (1); the order reversed, the value alone
  first (1); fill-type's old landing expression (2).
  **The golden says nothing of this change**: it replays tree reads and never runs a fill, so its `Changed 0` is no
  evidence either way; the unit tests and the owner's device re-run are.
  Since D61 the `+421` case above lands when the reading's letters and digits are exactly the value's: see the D61
  amendment below.
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

## Amendment: the landing rule in one module (2026-11-01, A2)

`landedReformat`, `tailOf`, `landedSome`, `priorText` and `priorsOf` moved from fill-reformat.ts to
`interact/fill-landing.ts`, beside the exact rule (`landingOf`) and the mismatch's classification (`differenceOf`);
`landedReformat`, `landedSome`, `priorText` and `priorsOf` are private there, asked through `landingOf`, `tailOf`
and `droppedTail`. fill-reformat.ts keeps the character rules alone (`reformatOf`, `prefixOf`, `skeleton`). No rule
changed.

- **The literal-start slice is deliberate.** `differenceOf` compares what follows the earlier text when the reading
  starts with it LITERALLY (`typedPartOf`), not `priorsOf`'s letters-and-digits rule: a skeleton match cannot be sliced
  back to reading positions. An earlier `1,000` that a regrouping field shows, with `5678` typed, as `10,005,678`
  starts with `1000` by its letters and digits, but no slice of the reading is the typing — so it is compared whole,
  as a vanished earlier text is. No input was found where the two rules give another `Difference`, and a `Difference`
  never changes pass or fail (mutation-checked: `differenceOf` switched to `priorsOf` kills no test).
- **Residual — the placeholder asymmetry.** A value equal to the named placeholder that the field shows exactly is
  read back `placeholder` (not verified); the same placeholder shown GROUPED for an ungrouped value (`SK00 0000` for
  `SK000000`) is held as empty (`heldText` is exact equality), lands as nothing, and fails `unchanged`. Kept as is.

## Amendment: the residuals numbered, rf4 filed (2026-11-01, D31)

The live golden's KNOWN (scripts/truth/live-known.ts) now files the forms group's cases as it files the visibility
group's: by a fill verdict's class (`holds` in scripts/truth/live-forms.ts: `loud-untouched`, `loud-changed`, `fill-claim`,
`failed-holds`) and the kind of the case's last reply. rf4 is filed there as `ios idb|wda rf4`, `loud-changed` on
`other` (the flow's `flow type_it: done`, no claim), intermittent — the tail it drops differs run to run
(`SK31 1200 00` at D29's, `SK31 1200 0` in D40's docs/truth/live-records/ios-rn-forms-d40-1.json). The D29
amendment's "marks rf4 a known LOUD on iOS in a comment (live-known.ts files visibility cases only)" no longer holds:
the comment is gone, the entry replaces it. The accepted residuals above are numbered below; the dropped tail of
review round 1's MINOR-3, fixed by D28, is none.

## Amendment: a digit grouping by `.` or `,`, and a mask template (2026-11-02, D51)

**Measured** (batch-3 block H, main 6b4a44df; docs/truth/live-records/ios-idb-forms-d37-1.json, ios-wda-forms-d37-1.json,
android-forms-d37-1.json, f11): `31122026` typed without clear into form-format's `date` (dots after the 2nd and 4th
digit; placeholder `__.__.____`). The app held `31.12.2026` and the assert after it passed, but averi replied `ERROR
fill: typed 8 characters but the field shows 10` under idb, WDA and uiautomator. f12 (typed with its dots) was ok.
docs/bugs/2026-11-02-lab-fill-fails-a-date-the-field-dots-as-typed-though-the-app-holds-it.md.

Two causes. Every added `.`/`,` had to be a thousands mark (`thousands`), which `31.12.2026`'s groups are not: that
failed f11 under every source. Under idb a second one: idb names no placeholder, so the field's `__.__.____` is read
as its text before (D29), and without clear the reading was judged against `__.__.____31122026` — `priorsOf` never
fell back to no earlier text, as the template's letters and digits are none (MINOR-A).

**Decision.**
- An added `.` or `,` also passes when it is a **digit grouping** (`fill-reformat.ts#digitGrouping`): a group between
  two of the marks — so two or more marks — that is not three long, over a digits-only typing (`reformatOf`'s
  `typing`, the whole typing for a prefix). One number holds at most one decimal point, so two marks of one kind are
  none; a digits-only typing has no point of its own a mark could stand for. A grouping whose inner groups are all
  three is thousands-shaped and stays `thousands`'s to judge, which keeps `1.234.56` for `123456` and `12.345.67` for
  `1234567` failing. Such a reformat carries no `point` (the reply's aside, no ⚠ caveat: the caveat asks whether the
  mark is a thousands separator rather than a decimal point, and here it is neither). A single added `.`/`,` is
  unchanged: thousands with the caveat, else a failure (`12.34` for `1234`, a cents mask, still fails). Every other
  rule of `reformatOf` is judged first, unchanged. The two paths are disjoint (thousands needs every inner group three
  long, a digit grouping one that is not), so a thousands grouping keeps its caveat whichever is asked first.
- **A mask template is no earlier text** (`fill-reformat.ts#maskTemplate`, asked by `fill-landing.ts#priorsOf`).
  Without clear, an earlier text of `_` and separators alone, at least one `_` (`__.__.____`, `__/__/____`), is tried
  as none as well, second, whatever the reading. **This narrows D29 review round 2's MINOR-A** (the owner's decision
  that an earlier text with no letters or digits keeps the pre-D29 judgment): the `__/__/____` mask it named now falls
  back. Decided by the orchestrator under the owner's standing goals: a fill that worked must not reply ERROR, and a
  text of `_` blanks and separators is a mask, never content a fill appends to. The exact rule already passed a value
  whose earlier text vanished (`showsExactly`'s `includes`, f13 under idb); this gives the reformat and prefix rules
  the same reach for a `_` template, and no other text. A `—`, a `-` or an earlier text of separators alone (no `_`)
  keeps MINOR-A's judgment; the template is still tried first, so a reading that is the template itself shows nothing
  of the typing landed and nothing is typed again.
- Through `prefixOf`, both reach the dropped-tail rule (D28): `31.12.20` of `31122026` is a reformatted prefix, so the
  tail is typed again on iOS. A typing longer than the date field takes (`311220261`) now fails as `dropped-tail …
  refused by the field (a length cap…)`, where it read `length` before — a user-visible wording change, and on iOS one
  retype of the dropped `1` first.
- No reply echoes the shown form (`31.12.2026`): replies stay counts only (a dotted field may hold a birth date or a
  card expiry). The reply is `Filled … (8 characters, the field shows them reformatted: 2 separators added)`.

**Consequences.** The false mismatches above lose the dotted date and the lakh grouping. A `.`/`,` grouping still is
one when it is a single mark that is no thousands, or a thousands shape with a short tail. A mask that shows its
blanks while typed (`31.12.____`) is a false mismatch, as `_` is no separator. A reading that shows every typed
character with only separators the rules refuse still fails with `length`/`same-length` and no remedy named — a
separate backlog row (D53). **Residual 4 (accepted):** a digit grouping by `.`/`,` that no known format uses
(`1,2345,678`, `1.23.456`, `1.23.456.789`) passes as a reformat, said in the aside: the typed digits are all there, in
order, and no reading of two marks makes a decimal of them. So does `12.34.56` for `123456`, a grouping in twos,
while a single `12.34` for `1234` still fails. Whitelisting date shapes (2-2-4, 2-2-2, 4-2-2) was
considered and rejected: arbitrary, leaves the lakh failing, and a partial date would have to match a shape's prefix.

**Live.** The three f11 entries of live-known.ts (`android uiautomator f11`, `ios idb f11`, `ios wda f11`) are struck
off, and the note's live-only exemption with them (tests/truth/lab-notes.test.ts; calibration.json keeps it excluded,
its `why` saying so). The three `*-forms-d37-1.json` records are the src before the fix: tests/truth/live-rejudge.test.ts
reads f11 there not known, exit 1. **The golden says nothing of this change** (it never types).

**Mutation-checked**: twenty-five hand mutants, each killed by the new tests — `digitGrouping` always false; its
`DIGITS.test(typing)` removed, negated, or asked of the shown prefix instead of the whole typing; `.some` → `.every`;
`!== 3` → `=== 3`; the inner-group conjunct removed; `slice(1, -1)` → `slice(1)`, `slice(0, -1)` or the whole
`groups`; `markKind`'s `isPoint` negated, its thousands path removed, a neither passing as `'none'` or as
`'thousands'`, its refusal ignored; `point` set for a grouping, or never; `maskTemplate`'s `includes('_')` removed,
`every` → `some`, `SEPARATORS` → `SPACES`, `_` dropped from its characters, `:` added; `priorsOf` without
`maskTemplate`, with its order reversed, or asking it of the reading. A `groups.length >= 3` conjunct the spec
proposed was dropped as redundant (an inner group exists only with three groups or more; its mutants were
equivalent). `npm run mutate` (cold; a Stryker timeout counts as killed, as Stryker scores it): fill-reformat
94.03 → 94.35 % (floor 92; its two new survivors equivalent — `markKind`'s `'none'` and `'grouping'` emptied:
`reformatOf` tells only `'thousands'` and undefined apart), fill-landing 95.16 → 95.20 % (floor 93); floors unchanged.

**Checked on the device** (batch-4, 2026-11-02, main 7e6d2d47; `live.ts --groups forms`, f11–f14): 4 cases, 4 ok
under idb, WDA and uiautomator (docs/truth/live-records/ios-idb-forms-d51-1.json, ios-wda-forms-d51-1.json,
android-forms-d51-1.json) — f11 reads `Filled id:"lab.form-format.date" (8 characters, the field shows them
reformatted: 2 separators added)`. Part two's premise holds: a describe-all of the empty date field shows
`__.__.____` as its value, no placeholder, so f11 under idb exercises the mask template.

## Amendment: a refused separated reading names the check and the remedy (2026-11-02, D53)

**Context.** Consequences lists the rule's false mismatches — mixed separators (`+421 900-123-456`), an eager trailing
mark (`SK31 `), groups of one (`1 2 3 4`), autocorrect splitting a word (`a lot`) — and a cents mask's `12.34` for
`1234` is a refusal by design (one `.` that is no thousands mark: a decimal point changes the amount). Each says "type
the value as the field shows it", but the reply did not: all of them failed `length`, `typed 4 characters but the
field shows 5 (content withheld from this error)`, which names no remedy (the D51 amendment said `length`/
`same-length`; it is `length` in every case, as an added separator makes the reading longer).

**Decision.**
- `fill-reformat.ts#separatedOf(observed, expected)`: the walk `reformatOf` takes (`walk`) matched every expected
  character, in order and unchanged (a typed space may be shown as another space), and tagged at least one reading
  character as an added separator — of `SEPARATORS`, the D18 set, neither widened nor doubled (`:`, `+`, `(`, `€`,
  `_` stay a `length`). It returns how many were added, every one, not the groups. The grouping rules are not asked:
  the reading did not land, so they refused it.
- A new `Difference` kind, `separated` with `added` (fill-facts.ts; eight kinds), classified by
  `fill-landing.ts#differenceOf` right after `dropped-tail`, over `priorsOf` on the held text as `landedReformat` and
  `tailOf` judge it: the earlier text first, then none when it vanished (D29) or is a mask template (D51). A reading
  equal to a named placeholder is held as empty and stays `length`; bullets stay `masked` or a partly masked
  `length`, which come first. Without clear the count also covers a mark added inside the earlier text the typing
  extends (`a-b1234` after `ab`, `1234` typed: 1 added).
- It only re-words a failure: landing (`landingOf`, `reformatOf`, `prefixOf`) is unchanged, so no reading passes or
  fails differently and nothing new is typed again; with clear the wipe and retype runs first, as before. It is
  disjoint from `dropped-tail` (all of the typing shown, not a strict prefix) and never `same-length` (it is longer).
  It re-words `length` but for one contrived `case`: without clear, where the only run that matches the value but for
  case is of the earlier text (`x,ABa-b` after `xAB`, `ab` typed) — the typing is all there, so `separated` is the
  true word. A PRECONDITION, not a guard: `differenceOf` runs only on a reading that did not land; asked of one
  `reformatOf` passes (`1 234` for `1234`) it would read `separated`, so no second walk checks it.
- The reply, counts only, with the check before the remedy (typing `12.34` into a cents mask passes, and means 12.34):
  `fill: typed 4 characters but the field shows 5 — every typed character is there, in order, with 1 separator added
  (spaces or . , - /) that the fill does not take for the field's grouping (a decimal point or a sign, mixed or
  trailing marks, groups of one, a word split by autocorrect): check the field holds the value you meant — a cents
  mask shows a typed 1234 as 12.34 — and if it does, type the value as the field shows it; content withheld from this
  error`. The causes are alternatives, not a diagnosis: the Difference does not know which applies. The list of marks
  is `SEPARATORS`'s, and a test pins that the two agree. `(after one wipe and retype)` rides on the lengths, as on
  every mismatch.

**Consequences.** Beyond the four shapes it names a leading `-` (a sign), a leading or trailing `.`, `1.2.3.4`, two
adjacent separators and smart punctuation's `Hello, world` for `Hello,world` — all true statements, all still
failures. Out of scope here, backlog row D60: a dropped tail that ends in an eager trailing mark (`SK31 1200 ` of
a full IBAN) was neither typed again (`prefixOf` refused the trailing mark) nor named — it stayed `length`; fixing it
changes the retype, not the wording — done, see the D60 amendment below. No new residual: nothing passes that did
not.

**The golden says nothing of this change** (it never types): 0 changed. Live: no lab format produces a refused
separated reading, and tests/truth/live-rejudge.test.ts re-judges the recorded replies by class and kind, so nothing
changes there either; the reply stays `refused` (it holds no `not found`).

**Mutation-checked**: hand mutants, each killed by the new tests — `separatedOf` with its `matched` check removed or
loosened to `>`, `> 0` → `>= 0`, every added separator counted as one, the code points counted as UTF-16 units;
`differenceOf` without the rule, with the earlier text alone (not `priorsOf`), the value alone (not the earlier text
and the value), the raw reading (not the held text), the rule moved before `unchanged` or after `case`; the reply
counting without `countOf`, a mark dropped from its list, a mark or a space added to `SEPARATORS`. Moved before
`dropped-tail` it is equivalent (the two are disjoint). `npm run mutate` (cold): fill-reformat 94.35 → 94.69 % (floor
92), fill-landing 95.20 → 95.33 % (floor 93), no survivor in the new code; floors unchanged.

## Amendment: a dropped tail that ends in an eager trailing mark is typed again (2026-11-02, D60)

**Context.** D53's amendment left it out of scope: an EAGER field adds its mark once a group is complete, so when it
drops the end of a burst the reading is a strict prefix AND that mark — `SK31 1200 ` for `SK3112000000`, `903 123 `
for `903123456`, `4111 1111 ` for a card, `31.12.` for `31122026`. `prefixOf` refused it: D28 judged a prefix under
`reformatOf`'s rules, and those want every added mark between two typed letters or digits, which a trailing one is
not. So nothing was typed again and the fill failed `length`, naming no remedy; with clear the fill wiped and typed
the whole value again, which rf2 (D28's amendment) showed drops the tail again on iOS. The rule against a trailing
mark guards the PASS path — a trailing addition may be a suffix, a sign or a decimal point waiting for its fraction
(`12.` in a cents mask) — and D28 inherited it for a prefix, where the risk it must guard is another: the retype may
type only characters that are provably missing (ADR 0023).

**Decision.**
- `fill-reformat.ts#prefixOf` alone changes. When the walk's last token is an added separator, the reading is judged
  with the next typed character after it — `next = whole[matched]`, which the strict prefix leaves —
  `reformatOf(held + next, prefix + next, whole)`. Every rule of `reformatOf` then applies to the trailing mark
  unchanged: one kind (`SK31 1200-` is none), never next to another (`SK31 1200  `) or after typed punctuation, never
  before it either (`1 234 ` for `1234,56`: the next typed character is `,`), a typed letter or digit before it (a
  leading mark, an empty prefix, is none), letters split only in a code (`Jan ` for `JanNovak` is none), groups of two
  or more but one at an end (`1 234 ` for `1234567`, `1 2 ` are none), and a `.`/`,` only as a thousands mark or a
  D51 grouping (`31.12.` passes, groups 2, 2, 1; `31.`, `12.` and `1.234.` are none). `reformatted.added` counts it.
- **The typed-mark guard:** the trailing mark is not a character the whole typing holds itself, all spaces one kind —
  as `thousands`' rule. Greedy, the walk takes a typed separator later in the value for an added one: `12/` of
  `1234/56` would retype `34/56`, wrong if the field had dropped `34` from the middle and kept the typed `/`. A typing
  that holds its own separators where the field shows them is an exact prefix anyway (the trailing mark is typed).
  The guard's cost is a field that adds the same kind of mark the typing holds elsewhere: `+421 903 ` for a typed
  `+421 903123456` is refused — a `length`, no tail typed again (with clear, the wipe and the whole retype, as before
  D60) — residual 5 below. Another kind still passes: `+421 903-` for `+421 903123456` (a typed space beside an added
  `-`).
- **Additive in what it accepts.** The branch is reached only where `prefixOf` returned undefined (a trailing added
  mark always failed `reformatOf`), so nothing `prefixOf` accepted, and no pass, changes. Two behaviours change, by
  intent, for the readings it now accepts: on iOS the tail alone is typed again where, with clear, the wipe and the
  whole retype ran; and on Android with clear a sibling that gained part of the tail now reads `elsewhere`, so the
  wipe and retype are skipped (Consequences). The pass rule (`landingOf`, `reformatOf` of the final reading) does not
  move: a FULL reading with a trailing mark (`SK31 1200 0000 `) still fails `separated`, and `SK31 ` for `SK31` still
  does not land.
- No code change in fill-landing.ts: `tailOf`, `droppedTail`, `differenceOf` and `whereTyped` get it through
  `prefixOf` — one definition of a dropped tail, so D28's invariant holds (what is retyped and what is named judge a
  prefix alike; the `tailOf` sweep's prefixes that end in an added mark — an eager field's readings — now agree too,
  over 200 of them).

**Consequences.**
- iOS: the tail alone is typed again under ADR 0023's every condition, then the read-back judges the whole: a field
  that adds no mark at its full length lands `reformatted` and the drop is reported (D24); with clear the tail
  replaces the wipe and the whole retype. An eager field that adds its mark at the end too (`SK31 1200 0000 `) gets
  one retype, then fails `separated` — a full reading, no loop. A capped eager field gets one retype that moves
  nothing, then fails `dropped-tail` (`… refused by the field (a length cap …)`), not reported — ADR 0023's cost.
- Android: nothing is typed again (`may-arrive-late`); the wording changes from `length` to `dropped-tail`, and
  `whereTyped` now has `missing`, so a sibling that gained part of the tail reads `elsewhere` and the clear's wipe is
  skipped — D28's safe direction.
- Without clear `priorsOf`'s order holds: after an earlier `SK31`, `SK31 1200 ` lands 4 of the typing and retypes
  `0000`; after a vanished placeholder (D29) or a mask template (D51, `__.__.____`) the value alone is judged;
  `SK31 ` after `SK31` holds nothing of the typing, so no tail (the D29 rule).
- A caret left before the mark, or a mask that inserts it again, puts the tail where the final rule refuses it
  (`SK31 1200000 `, `SK31 1200  000`): a false mismatch, the safe side (D28's caret argument).
- Nothing passes that did not. The guard keeps `12/` of `1234/56` a `length` (the value's own `/` may be the one
  shown), the safe side, and `+421 903 ` for a typed `+421 903123456` too: residual 5 below. Not in this change:
  `1 2 ` for `1234` reads `same-length`, and `31.` stays a refused prefix (D51's one-mark residual).

**Mutation-checked**: hand mutants, each killed by the new tests — the branch removed, the `-1` check negated or asked
of the token before, the mark taken one character early, the guard removed, asked of the reading instead of the
typing, without the spaces as one kind, `||` → `&&`, or a space typed anywhere refusing every mark; `next` as
`whole[matched ± 1]` (killed by `12 345 ` for `12345,67`) or a fixed character; `prefix + next` → `prefix`,
`held + next` → `held`, the whole typing → `prefix + next` (killed by `ab ` for `abcd12`, a code). The `-1` check
replaced by `true` is equivalent (the guard refuses every typed last character: the typing holds it) — Stryker's one
survivor in the new code. `npm run mutate` (cold): fill-reformat 94.69 → 94.80 % (floor 92), fill-landing 95.33 %
(floor 93, no code change); floors unchanged.

**Golden and live.** The golden never types: 0 changed. Live: no lab format adds an eager mark (`formatted` in
Forms.kt, Forms.swift and rn/src/format.ts joins its groups, no trailing mark), and tests/truth/live-rejudge.test.ts
re-judges the recorded replies by class and kind, unchanged; the forms groups (f1–f14, rf1–rf5) take only the
earlier branches. No device check before merge; a lab format that marks a complete group eagerly, for a live proof on
iOS React Native, is a later batch's.
Since then batch-9 made that live proof: see the next paragraph.

**Proven live** (batch-9, 2026-11-03, main e734fedf, the lab simulator iOS 27.0; L7's `group4eager` in
`react-native/rn-format-eager` and `forms/form-grouped`, live cases rfe1–rfe3, g1 and g2): of the 18 drops React Native
showed on rfe1 and rfe2, 5 kept a part ending on the eager mark, were typed again from it and landed, the app holding
the full value each time — rfe1 on idb ×2 (`SK31 1200 0000 1987 ` kept, the last 8 of 24 characters typed again) and
rfe2 on WDA ×3 (`SK31 1200 ` kept, the last 2 of 10). All 20 rfe1/rfe2 runs were ok. rfe3 (×10) and native g2 (idb,
WDA), a full reading ending in the mark, failed `separated` as this amendment says ("… with 3 separators added …": the
two inner spaces and the eager one); g1 was ok on idb, WDA and uiautomator. On Android g2 passed (`Filled … 2 separators
added`) while the app held `SK31 1200 0000 `: the reading judged there had no trailing space, and whether the dump or
averi drops it is unread.

## Amendment: an unnamed placeholder whose letters and digits start the value's (2026-11-03, D61)

**Context.** batch-9 (2026-11-03, main e734fedf, iOS simulator 27.0), live case g3: `fill(form-grouped, phoneGrouped,
'421903123456')` without clear — format `phone3`, placeholder `+421`. The app held `421 903 123 456`; on idb averi
replied "ERROR fill: typed 12 characters but the field shows 15", after the whole read-back poll (about 4 s). wda and
uiautomator replied `Filled … 3 separators added`; g4 (with clear) and g5 (own spaces) were ok everywhere. idb names no
placeholder (adapters/types.ts, `UiNode.placeholder`): the empty field's `AXValue` is `+421`, read as the field's
value, so the fill's `before` is `+421`. The reading's letters and digits (`421903123456`) START with the earlier
text's (`421`), so `priorsOf` judged it after `+421` alone, as the D29 amendment says ("the fallback never runs, the
old false mismatch"): no reformat of `+421421903123456`, no prefix of it, and `differenceOf` read `length`, naming no
remedy. Not residual 5 (no typed separator, no trailing mark). Nothing in idb's tree tells an empty field showing its
placeholder from a filled one: the type, label, traits and role are the same, only `AXValue` differs.

**Decision.**
- `fill-landing.ts#priorsOf` alone changes. Without clear, no earlier text is tried as well, second, also when the
  reading's letters and digits are EXACTLY the value's — `skeleton(held) === skeleton(value)` — AND they are no start
  of the earlier text's plus the value's — `!skeleton(prior + value).startsWith(skeleton(held))`. The reading then
  holds no more letters and digits than the value, so the earlier text is not in it; and it is no earlier text followed
  by a typing that lost its tail, which the second conjunct excludes. What is left is an earlier text that vanished.
  The order is unchanged: the earlier text first.
- `landedReformat`, `tailOf` and `differenceOf`'s `separated` rule get it through `overPriors`, as they get D29's
  fallback. g3's `421 903 123 456` after `+421` lands `reformatted`, 3 added; g4's reading without clear
  (`+421 903 123 456` for `+421903123456` after `+421`) lands too; `421 903-123-456` after `+421` now reads D53's
  `separated` (3 added), which names a remedy, instead of `length`; so does a full reading with an eager trailing
  mark (`421 903 123 456 ` after `+421`: `separated`, 4 added) — the wording only, never a pass.
- **D29's pinned `1234 5678` after `1` flips, on purpose**, from refused to landing (`reformatted`, 1 added). The exact
  rule already passes the same shape ungrouped — `12345678` after `1`, typed `12345678`, lands by `includes` — so D29's
  guard was stricter on a grouped reading than the exact rule is on a plain one.
- Still refused: D29's MAJOR-1 periodic case (`10,001,000` after `1,000`, typed `10001000`): its letters and digits
  are the value's, but a start of `1000` + `10001000` — the earlier text, regrouped, may still be there. So is an
  earlier text alone regrouped (`1 234` after `1234`, typed `1234`). MINOR-A's dash (`—`) keeps its refusal through the
  same conjunct: with no letters or digits the earlier text's plus the value's skeleton IS the value's.
- **Equality, not a prefix** (B-prefix, deferred): a strict prefix of the value under such a placeholder
  (`421 903 123` after `+421`) is still judged after the earlier text alone — no tail typed again, `length` — residual
  6 below. Widening the rule to a prefix would move ADR 0023's retype ("only provably missing characters") and flip
  D29's `tailOf('1234 5', … '1')`; no live drop under an unnamed prefix placeholder has been seen.

**Consequences.**
- On idb, a fill without clear under an unnamed placeholder whose letters and digits start the value's says Filled
  when the field holds the value grouped, as wda and uiautomator do, on the first read-back instead of after the whole
  poll and an agent's retry.
- The pass it adds is one shape: an earlier text of real content whose letters and digits start the value's, a field
  that dropped keys whose remainder equals the value's tail — the head, or with repeated characters an equal run
  anywhere, as many characters as the earlier text has — and the rest landed grouped. With `1` held and `1100` typed
  without clear, a lost second key leaves `1` + `100`, shown `1,100`: Filled, with the ⚠ point line, where main read
  `same-length`; so does `1,000` after `1`, typed `1000`. The exact rule already accepts the same readings ungrouped
  (`1100` after `1` contains the typed `1100`). No head drop has been measured (ADR 0023's drops are tails, and D24
  sends the first key alone so that the head lands). A select-all field, which replaces the earlier text on focus,
  really holds the value, as D29 already accepts.
- Out of scope: a fill without clear whose reading is unchanged from `before` but already contains the value
  (`Hello world` typed `world`, `+421` typed `421`) passes by the exact rule's `includes` — not this rule; a backlog row
  of its own (D63). Closed by the D63 amendment below.

**Mutation-checked**: hand mutants, each killed — the new disjunct removed (5 tests fail); the second conjunct removed
(5: MAJOR-1, an earlier text alone regrouped, MINOR-A's dash); `===` as `skeleton(value).startsWith(…)`, the prefix
form (2: D29's `1234 5` and residual 6's tail); compared on the text as typed, not the skeleton (5); `skeleton(prior +
value)` as `skeleton(value)` (5); the D29 disjunct's `||` as `&&` (9); the order reversed, no earlier text first (1);
the conjunct's `!` dropped (10). `skeleton(prior) + skeleton(value)` is equivalent (the skeleton distributes over
concatenation). `npm run mutate` (cold): fill-landing 95.33 → 95.52 %
(floor 93; 268 mutants, 12 survived, 4 timeouts — none in the new condition), fill-reformat 94.80 % (floor 92, no code
change); floors unchanged.

**Golden and live.** The golden replays tree reads and never types: Changed 0, which is no evidence either way; the
unit tests are (fill-landing.test.ts's D29 and D61 groups, and fill.test.ts's idb-like `+421` field). Live: g3 on idb
should move from MISMATCH failed-holds to ok (it is not in live-known.ts); f13 passes by the exact rule, g4 runs with
clear, g5 is exact, and wda and uiautomator dump no `+421` as `before`, so nothing else moves. Not checked on the
device: `live.ts --groups forms --cases g3,g4,g5,f13` on idb and wda, a later batch's (g3 should read `Filled … (12
characters, the field shows them reformatted: 3 separators added)`).

## Amendment: a reading unchanged since typing began has not landed (2026-11-03, D63)

**Context.** Found in D61's analysis (2026-11-03); no live record shows it. Without clear, the exact rule
(`fill-landing.ts#showsExactly`) asks only that the reading CONTAIN the value — `observed === value ||
heldText(observed).includes(value)` — and never compares it with `before`. For an input, `tookText` is simply true: its
rule that a reading must change applies to non-inputs alone. So a reading byte for byte what the field showed when
typing began passed as `landed` whenever that earlier text held the value, and `pollValue`, which does not wait
before its first read, stopped there and fill replied Filled, verified:
- a field that refuses the keys while its text holds the value — a length cap, a digits-only filter, a controlled
  input that reverts: the lab's form-format `date` keeps 8 digits (Forms.swift, Forms.kt), so `2026` typed without
  clear after a full `31.12.2026` leaves `31.12.2026`, on both platforms;
- keys that went into another input (an auto-advance, a stolen focus): a landed reading skipped `whereTyped`, so its
  `elsewhere` proof was never asked;
- a source that names no placeholder (idb, the API 33 dump: D29) whose empty field's placeholder holds the value —
  `+421` typed `421`, `SK00 0000 0000 …` typed `0000`, `Search` typed `ear`: the unnamed twin of a case fill.test.ts
  already refused with a named placeholder;
- keys that arrive after the first read (`may-arrive-late`, uiautomator): plausible, unmeasured since the paced typing.

`differenceOf` already had the honest answer for such a reading, its first rule `unchanged` ("the field did not
change: the typing did not reach it, or the field refused it"), never reached because the reading landed first. D61's
`landingOf('+421', … '421' after '+421')` guard was red for this reason and was left to D63.

**Decision.**
- `fill-landing.ts#landingOf` alone changes: right after `tookText`, a reading for which `unchangedSinceTyping` holds
  has not landed — `!clear && observed === before && observed !== value`. It extends `tookText`'s "a non-input proves
  it took the text only by changing" to an input typed without clear, and covers the reformat route and the exact rule
  alike, stated once. Raw equality, as `before` is the raw reading when typing began (for an empty or masked field,
  the post-focus re-read, unless skipped: residual 8 B).
- **The value itself is excepted.** A reading that is both the earlier text and the value cannot be told from a
  select-all field that replaced its text with the typing (the D29 amendment), an unnamed placeholder equal to the value,
  or a named one (`placeholder`, not verified, pinned end to end). It lands as before: residual 7.
- **The poll needs no change.** A reading that has not landed keeps `pollValue` reading (fill-type.ts): keys that arrive
  late land on the first changed reading; a typing that never reaches the field takes the whole poll (5 reads) and ends
  `missed`, `differenceOf` → `unchanged`. `tailOf` finds none of the typing in it, so nothing is typed again; without
  clear nothing is wiped. A typing that went into another input now reaches `whereTyped`, and the miss names that input.
- Not changed: `priorsOf` and D61's condition in it, `showsExactly`, `tailOf`, `differenceOf`, the clear path (a reading
  with clear must equal the value), the masked rule (a masked reading unchanged since typing began already failed by its
  length). No new Difference kind, wording, verdict reason or module. Superseded in form by D64: see the D64
  amendment below.

**Consequences.**
- A fill without clear whose typing changed nothing replies "ERROR fill: typed N characters but the field shows M — the
  field did not change: the typing did not reach it, or the field refused it" instead of a false Filled; f15's date
  should reply so on every source (not yet run on a device). The agent's flow no longer continues on a field it
  believes holds an append it does not hold. skill/references/troubleshooting.md says it.
- No cost on a correct fill whose first reading has changed — every live case's reading differs from its `before`
  (b-, p-, f-, g- and rf-cases fill empty fields or replace idb's placeholder; p1 appends; p5 is masked; p7 is refused
  before the tap). A late-key source loses its premature return: one more `pollMs` and read where the first read predates
  the keys. A typing that changed nothing pays the whole poll (about 4 s on idb, 5 dumps on Android) for an honest error.
- A value typed again into a field that holds it among more text, without clear: a field that takes the keys reads
  `Jan ŠťastnýJan` and still lands by containment; one that refuses them is refused, which is true.

**Mutation-checked**: hand mutants on `unchangedSinceTyping`, each killed but one — the guard line removed (10 tests
fail); the value exception dropped, the strict form (2: D63's value-itself test and fill.test.ts's named `Search` typed
`Search`); `!clear` dropped (1: with clear `1 234` after `1 234`, typed `1234`, still lands reformatted); `observed ===
before` as the reading containing `before` (25); `before` as `resolvedValue` (8); `observed !== value` as `===` (12);
the first `&&` as `||` (72). Equivalent: raw equality as `heldText(observed) === heldText(before)` — the two differ only
where a named placeholder is held as empty against an empty side, and an empty held text contains no non-empty value,
while a reading equal to the value is excepted anyway. `npm run mutate` (cold): fill-landing 95.52 → 95.73 % (floor 93;
281 mutants, 12 survived, 4 timeouts — none in the new guard); every other module's score unchanged; floors unchanged.

**Golden and live.** The golden replays tree reads and never types: Changed 0, which is no evidence either way; the
unit tests are (fill-landing.test.ts's D63 group, fill-type.test.ts's late, lost and elsewhere keys, and fill.test.ts's
prefilled field and idb-like unnamed `Search` placeholder that drop every key). Live: a new case f15 (form-format's
`date`: `31122026` with clear, then `2026` without; judge `refusedUnchanged`, ok only when the last reply says the field
did not change and the app still holds `31.12.2026`) runs after f14 on idb, wda and uiautomator. Before D63 it would
read MISMATCH `fill-claim`; with D63 ok. No existing case's verdict moves; g1 now runs after f15. Not checked on the
device: `live.ts --groups forms --cases f15` on idb, wda and uiautomator, and a regression pass of p1, f13, g3–g5, a
later batch's.

Residuals, stated: residuals 7 and 8 below — the guard is byte equality with `before`, so a reading that moved
without any of the typing, or whose `before` was not what the field showed when typing began, still passes by
containment (residual 8, follow-up D64); the late-key race is unmeasured since the paced typing, so how often a first read
predated the keys, and what D63 now costs there, is not known; a field that commits its accessibility value only on
blur is refused, as it already was when `before` was empty.

## Amendment: without clear, the value must be in the typing past the earlier text (2026-11-03, D64)

**Context.** D63's residual 8 (A), from its review. Without clear, the exact rule (`fill-landing.ts#showsExactly`)
searched the WHOLE reading, earlier text included, for the value — `observed === value ||
heldText(observed).includes(value)`. D63's guard refused only a reading byte for byte equal to `before`, so a reading
that moved but held none of the typing passed whenever the earlier text held the value, and fill-type.ts returned at
once: no `whereTyped`, no tail typed again. The shapes (D64's analysis, pure readings and scripted typings):
- a length cap, deterministic on every source: the lab's form-format `date` keeps 8 digits, so `12` typed without clear
  after `31.12.202` keeps the `1` — `31.12.2021`, which holds `12` only inside `31.12`; `Hello worldwor` for `world`
  after `Hello world` under a 14-character cap;
- an iOS React Native burst that kept a prefix (ADR 0023's drop; D24's first key alone makes the head land):
  `Note: hellohe` for `hello` after `Note: hello` — Filled, and the tail never typed again;
- keys that went into another input: `Hello worldw`, `w` landed and `orld` elsewhere — Filled, the other input never
  named;
- the value found across the seam: `Hello world` for `world` after `Hello wor`, only `ld` landed.
No live or truth record shows it: no live case typed, without clear, a value its field's earlier text holds with only
part of it landing (p1 appends ` Jr.`, which `Jan Šťastný` does not hold; f15 is D63's unchanged reading).

**Decision.**
- `fill-landing.ts#showsExactly` changes: without clear, `observed === value || priorsOf(held, e).some((prior) =>
  typedPartOf(held, prior).includes(value))`, `held` the reading less a named placeholder. `typedPartOf` is
  `differenceOf`'s own notion of the typing: what follows the earlier text when the reading still starts with it
  LITERALLY, else the whole reading. So a reading that starts with the earlier text must hold the value after it; one
  that does not is judged whole, as before — an earlier text that vanished (D29), was replaced (select-all), regrouped
  or autocorrected, or a caret not at the end. The pass rule and the miss's wording now judge one typing.
- **Over `priorsOf`'s earlier texts** (review round 1, M-1), as the reformat route is judged: a reading whose letters
  and digits are exactly the value's and no start of the earlier text's plus the value's is judged as the value alone
  too (D61's `valueAlone`). Judged after the earlier text alone, a field that adds a leading `+` under idb's unnamed
  `+421` (`+421903123456` for `421903123456`) and a select-all field that adds a decoration (`SK31 ` after `SK3`, `abc `
  after `ab`, `50%` after `5`) were refused, where main passed them over the right content.
- **No tail typed again where the reading is a whole landing too** (review round 1, m-2): `droppedTail` returns none
  when the reading holds the value at an occurrence that ends past the earlier text, or holds the value decorated with
  no other letter or digit (`fill-landing.ts#wholeLandingToo`). `11 ` for `11` after `1` is a select-all field's `11`
  with an eager trailing mark as much as a `1` landed with its mark and a `1` dropped; typed again, the field could
  hold `111` and the fill end Filled over it. So nothing is typed again, and the fill fails. Main passed it, over the
  right content; a Filled over content averi changed wrongly is the one outcome not allowed. The same for `a1 1` for `1
  ` after `a1` (a caret inside the text) and `-5-` for `-5` after `-5` (the value typed again over itself into a
  select-all field that adds a mark). A value found only inside the earlier text among more of it (`Note: hellohe`,
  f16's `31.12.2021`) is no whole landing, and its tail is typed again. Brute-forced over small alphabets: no reading a
  whole landing makes — through a select-all field, a caret anywhere in the earlier text, a leading or trailing mark —
  is typed into again.
- **D63's guard is folded into it.** A reading unchanged since typing began starts with the earlier text and holds
  nothing past it, so it holds no non-empty value; the `observed === value` disjunct keeps residual 7's exception,
  and a named placeholder equal to the value stays `placeholder`. No input tells the two apart, through the reformat
  route either (it needs the whole of the earlier text plus the value; separator-only values, mask templates, `1,000`
  and `+421` were tried): with D64's rule, the guard was an equivalent mutant. `unchangedSinceTyping` is removed and
  `landingOf`'s doc says D63's rule is D64's at its limit. Every D63 test stays green, unchanged. D63's Decision is
  superseded in form only: the behaviour it states is unchanged.
- **Residual 8 (A)'s pin flips on purpose** (fill-landing.test.ts, renamed): `Hello worldw` for `world` after `Hello
  world` has not landed, its dropped tail `orld`.
- Not changed: the reformat route (`landedReformat`, `priorsOf` itself, D29's and D61's fallbacks, D51's mask
  template), `tailOf` (eager trailing marks included), `differenceOf` (D53's `separated` among them), the clear path,
  the masked rule, fill-type.ts's poll and retype, fill.ts. No new Difference kind, verdict reason or module; two
  wordings gain a hedge where the reading is a whole landing too and its tail is not typed again (`wholeToo`, from
  `wholeLandingToo`, set by `differenceOf` on every such miss): a `dropped-tail` (a grouped prefix: `11 ` after `1`)
  adds "or the field replaced its text (select-all): fill with `clear: true`" (review round 2), a `length` (an exact
  prefix: `-5-` after `-5`, `55` after `5`) adds "the field may have replaced its text (select-all): fill with `clear:
  true`" (the code review). Neither is said when the typing is proven to have left the field (`elsewhere`): the reply
  names that input instead (round 3). Every other reply byte for byte as before.

**Consequences.**
- Under the append premise (the caret at the end), each newly refused reading is a strict prefix of the earlier text
  plus the value — a dropped tail, never `separated`; a caret elsewhere can make other shapes, which fail with the
  wording `differenceOf` gives them. On iOS (`on-return`)
  the retype ADR 0023 already makes runs where a false landing used to cut it off: `Note: hellohe` → `llo` typed again →
  `Note: hellohello`, landed — a false Filled turned into a repaired fill. A capped field's one retype moves nothing and
  the fill fails by length; keys that went into another input reach `whereTyped`, and the miss names that input. On
  Android (`may-arrive-late`) the poll runs out and the fill fails by length. ADR 0023's "only provably missing
  characters" holds: the tail is a strict prefix's remainder, and none is typed where the reading is a whole landing
  too.
- The cost is paid on failures only: the whole poll (5 reads, about 4 s on idb; 5 dumps, about 11.5 s on Android), plus
  the iOS tail retype's own polls, where the reply was an instant false Filled. No cost on any reading that holds the
  typing past the earlier text — every live case: b-, p-, f-, g-, rf- and rfe-cases fill empty fields or replace idb's
  placeholder; p1 appends what its prefill does not hold; p5 is masked; p7 is refused before the tap.
- Still landing, as before: `Hello worldworld`, `Hello world` after `Hello`, `Jan ŠťastnýJan`, a select-all `world`
  after `Hello world`, f13's `421903123456` and `+421421903123456` after idb's `+421`, a caret mid-text (`Hello
  woworldrld`), an autocorrected earlier text (`Hello world` after `hello `), an eager trailing mark (`SK31 1200 ` after
  nothing or after `Note `), idb's `Search` vanished (`ear`) or kept (`Searchear`), a named `Search` placeholder, the
  caret at the start (`Hello ` typed before `world`, `-` before `5`), and the value alone over `priorsOf`
  (`+421903123456` after `+421`, `SK31 ` after `SK3`, `abc ` after `ab`, `50%` after `5`).
- Refused, on the safe side: a caret not at the end whose typing leaves the reading starting with the earlier text —
  `aba` for `ab` after `a`, `aaba` for `ab` after `aa`, `abab` for `ba` after `ab` (residual 9); and, with nothing typed
  again, a reading that is a whole landing as well as a dropped tail (`11 ` after `1`, `a1 1` after `a1`, `-5-` after
  `-5`).

**Mutation-checked**: hand mutants, run from a copy of the file over fill-landing, fill-type, fill, fill-verdict,
fill-text and live-forms tests (497), each killed but two. On the rule: back to the whole-reading containment (33
tests fail); the raw reading, not `heldText` (2); `.includes` as `.startsWith` (12) and as `.endsWith` (10);
`typedPartOf`'s fallback as `''` (34); its `startsWith` as `includes` (1: the caret at the start, `-5`); the slice one
character back, the overlap form (13); the `observed === value` disjunct dropped (3). On `priorsOf` (M-1): the earlier
text alone (4); `.some` as `.every` (4); the earlier text itself skipped (26). On `wholeLandingToo` (m-2): never (9);
the across-the-seam clause dropped (2); the decorated-value clause dropped (4); an occurrence ending AT the seam
counted (11); one character less of overlap (2); the decorated clause's `includes` dropped (1: a dropped trailing mark,
`12/` kept `12`); its skeleton equality dropped (14); `||` as `&&` (6). On `wholeToo`: never marked on a
`dropped-tail` (2), always marked there (13); never marked on a `length` (3), always marked there (32); marked without
some of the typing landed (3). Equivalent: D63's guard put back (none fail: the fold); `typedPartOf`'s `prior !== ''`
dropped (`startsWith('')` and `slice(0)` give the whole reading); before review round 1, `priorText(e)` as
`heldText(before)` (the clear branch never reached it). `npm run mutate` (cold): fill-landing 95.73 → 95.83 % (floor
93; 288 mutants, 12 survived, 4 timeouts — the same survivors as D63's run, none in the new code); every other
module's score unchanged, fill-verdict's 99.33 % (floor 97) among them; floors unchanged.

**Golden and live.** The golden replays tree reads and never types: Changed 0, which is no evidence either way; the
unit tests are (fill-landing.test.ts's D64 group and the flipped pin, fill-type.test.ts's burst, cap and elsewhere
typings on both deliveries and a whole landing not typed into again, fill.test.ts's prefilled `Hello world` on iOS
and Android fakes). Live: a new case f16
(form-format's `date`: `3112202` with clear, which shows `31.12.202`, then `12` without; judge `refusedCapped`, ok only
when the app holds `31.12.2021`, the first fill passed and the last reply is an error) runs after f15 on idb, wda and
uiautomator. Before D64 it would read MISMATCH `fill-claim`; with D64 ok — on iOS after one tail retype of `2` that moves
nothing. A `loud-changed` there points to the caret landing inside the text, as for f15. f15 stays ok (its unchanged
reading is refused by the folded rule, the same `unchanged` reply); no existing case's verdict moves; g1 now runs after
f16. Not checked on the device: `live.ts --groups forms --cases f15,f16` and a regression pass of p1, f13, g1–g5 on
idb, wda and uiautomator, a later batch's.

Residuals, stated: residual 9 below; residual 8 (A) is closed; residual 8 (B) stays, moved where the skip lives (ADR 0028's D64 amendment,
residual 3; follow-up D64b). Pre-existing, not D64's: a plain dropped tail on Android, and a capped field's on both
platforms, is worded `length` with content withheld and no remedy named — the dropped-tail wording is D28's, for a
grouped prefix only; a candidate follow-up (wording only). The newly refused readings' poll cost is unmeasured on a
device. `wholeLandingToo` (m-2) costs a repair: a real dropped tail whose reading holds the value across the seam is
not typed again and fails — `11 ` for a typed `11` after `1`, or `aaa` for `aa` after `aa`, where one key landed and
one dropped; on small alphabets about 1 % of the dropped-tail readings, the value's head repeating the earlier text's
end. The real-world shape (review round 2): a fill without clear whose digits repeat the field's last ones (`55` typed
after `5`), on iOS only, where a dropped tail is typed again: it fails loudly, by length, and never ends in a wrong
Filled. Remedy: fill with `clear: true`. Every such reply says so, since the typing may all have landed (`wholeToo`:
the `dropped-tail` and `length` hedges above).

## Residuals accepted

1. **A split inside a code, or between a letter and a digit, passes as a reformat** (review round 3, MINOR-1;
   Consequences), said in the reply's aside.
2. **A flow's blind `type:` cannot type again a tail a reformatting field dropped** (D29): no read-back, by design;
   `fill:` is the remedy. Filed in live-known.ts as `ios idb|wda rf4`.
3. **The placeholder asymmetry** (A2's amendment): a named placeholder shown grouped for an ungrouped value is held as
   empty and fails `unchanged`.
4. **A digit grouping by `.`/`,` that no known format uses passes as a reformat** (D51's amendment): `1,2345,678`,
   `1.23.456`, `1.23.456.789` — said in the reply's aside, no ⚠ caveat. Every typed digit is there, in order, and two
   marks cannot be a decimal point. So does `12.34.56` for `123456` (a grouping in twos), though one `12.34` for `1234`
   still fails.
5. **An eager trailing mark of a kind the typing holds itself is no dropped tail** (D60's amendment, the typed-mark
   guard): `+421 903 ` for a typed `+421 903123456`, any space for a space, fails `length` — no tail typed again; with
   clear the wipe and the whole retype run, as before D60. The walk cannot tell the field's mark from the typing's own
   shown after a drop from the middle (`12/` of `1234/56`), so a false mismatch, the safe side. Remedy, for a field
   that regroups the value the way it shows it: type the value without its own separators (`+421903123456`) — the
   field's marks are then all added, and a dropped tail is typed again.
6. **A dropped tail under an unnamed placeholder whose letters and digits start the value's is not typed again**
   (D61's amendment, the equality form): on idb, `421 903 123` for a typed `421903123456` after the empty field's
   `+421` is judged after the placeholder alone — no prefix of `+421421903123456` — and fails `length`, no tail typed
   again. Remedy: fill with `clear: true`, so the earlier text is none and the tail is typed again.
7. **A value typed again into a field that already shows exactly it, without clear, still lands** (D63's amendment, the
   value exception): `421` typed into a field reading `421`, its typing refused or lost, replies Filled — the reading
   cannot be told from a select-all field that retyped it or a placeholder equal to the value. The field does hold the
   value. Remedy, where it matters: fill with `clear: true`.
8. **A reading that holds the value but none of the typing still lands by containment** (D63's amendment, review round
   1, MINOR-1): D63's guard refuses only a reading byte for byte equal to `before`. (A) A reading that moved but holds
   no new typing lands by the value inside the earlier text: `Hello worldw` for a typed `world` after `Hello world`
   (one key landed, the rest went elsewhere) replies Filled — the analysis's option D, the earlier text then the value,
   would close it. (B) On Android, fill.ts skips the post-focus re-read for a sole-id selector on an empty plain field
   and takes `before` as empty; a field that inserts `+421 ` on focus and takes no key reads `+421 `, which contains a
   typed `421`, and replies Filled. Both are pinned as today's behaviour in fill-landing.test.ts. Follow-up: backlog
   row D64. See the D64 amendment below, and ADR 0028's D64 amendment.
9. **A caret not at the end, whose typing leaves the reading starting with the earlier text, is refused** (D64's
   amendment, restated in review round 1): without clear, `ab` typed before an earlier `a` reads `aba`, `ab` typed
   inside `aa` reads `aaba`, `ba` typed inside `ab` reads `abab` — each starts with the earlier text and holds no value
   past it, though the field holds the value. The focus tap leaves the caret at the end (the premise of ADR 0023's
   retype); a caret inside the text that breaks the literal start is judged whole, as before. Remedy: fill with
   `clear: true`.
