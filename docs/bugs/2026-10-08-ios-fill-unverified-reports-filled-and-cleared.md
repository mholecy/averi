# BUG: `type_text` / `fill` reports "Filled … (N characters, cleared first)" when the resolved node exposes no value — nothing was cleared, and on iOS idb nothing was typed

> **Status (2026-10-08):** fixed on branch `fix/p1-fill-unverified`; **confirmed fixed on device** (Android emulator and iOS simulator, re-run at `e9e6509`, sections at the end), with two wording fixes after it on `fix/r2-c-fill`: a read-back that does not find the field again (the selector stopped matching and the identity fallback refused — the screen's id set changed while typing, or no single twin) is its own fact, `readBack: 'lost'` with `lost: 'screen-changed' | 'unmatched'`, rendered `NOT verified: the field could not be found again (the screen changed while typing)` (or `(the selector no longer matches it)`) instead of blaming a textfield that "exposes no value", and gets no not-a-textfield `⚠` when the matched node is a textfield; and every count reads `1 character`, never `1 characters` (`interact/fill.ts#charactersText`: typed and cleared counts, the masked-append warning, the read-back errors, and type_text without a selector). What the fix does: `fillField` returns facts (`interact/fill.ts#FillResult`: `cleared` = characters actually deleted, or `unmeasured` on a node that is not a `textfield` — no delete is counted off a label's length; `readBack` `landed`/`no-value`/`not-taken`/`nothing-typed`; `notInput` with the nearest `textfield`, by id and rect only), and the MCP reply and the flow line render them through one wording — an unchecked fill reads `Typed N characters into <selector> — NOT verified: …` (a `⚠ fill` line in a flow), a clear alone on a label included, `cleared M characters first` only when a delete was sent, and a match that is not a `textfield` gets a `⚠` line naming the nearest input unless the read-back saw its value change to show the text (a node that took the text is an input whatever its role). Warned, not refused: a label over its empty field focuses it (the measured `Value*` fill landed). A non-input's value proves the text landed only by changing to show it (a WDA StaticText echoes its label; a label can change on focus, `Name` → `Name*`), and only such a node gets the mismatch retry's wipe. The read-back also finds the field again by role, id and rect when a `value:"…"` selector stops matching, so that workaround is now verified — after typing only while the screen's set of identified nodes is unchanged, and not at all when nothing was read before typing; a next screen with the very same identified nodes and a field at the same rect would still pass (limit). Consequence: a `value:`/`text:` selector on a field that reformats its input (`0.00` → `1000.00`) now fails the read-back where it passed — the read-back compares exactly with `clear` and as a substring without, for every selector, so a reformatting field cannot be filled verified by any selector. Pinned with this note's shapes in tests/interact/fill.test.ts, tests/mcp/tools.test.ts and tests/flow/engine.test.ts.

> **Follow-up (2026-10-08, review m-8, not changed):** the read-back asks the selector BEFORE identity, so a `value:` selector that, once the clear or the typing has changed the chosen field, still matches ANOTHER node (two rows `id:qty value:"1"`, the first picked) reads that other node instead of finding the chosen one by identity. Pre-existing; identity-first would need the moved-field case settled first.

**Measured 2026-10-08 16:30–16:41 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`), SWIFT payment form of PR #6 (branch `feature/swift-payment`), iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`), averi = mobile-verify @ `c35388a` built from source.

## Observed (measured)

Under idb the form's `StyledTextField`s surface as a `textfield` (value = its text, no label) plus a sibling `text` node
with the floating label, both `identifier: "TextFieldWithComponentStyle"`. Selecting the field by its visible label
resolves the `text` node.

The IBAN field held `XX12345` (floating label shrunk to `{x:42, y:351, w:35, h:15}` above the input):

```
16:30:32  type_text { selector: 'text:"IBAN*"', text: "DE89370400440532013000", clear: true }
→ Filled text:"IBAN*" (22 characters, cleared first)                       (2.8 s)

ui_snapshot { filter: "role:textfield" } → "value":"XX12345"   (unchanged)
```

The screenshot shows `XX12345`, no caret, no focus. Reproduced at 16:31:05 with the identical reply and the identical
field value. Nothing was cleared and none of the 22 characters reached any field.

Same shape without `clear` at 16:32:45 — `type_text { selector: 'text:"Payee’s bank name"', text: "Credit Lyonnais" }`
→ `Filled text:"Payee’s bank name" (15 characters)`; the field then held `Crédit Agricole Corporate & Investm` (the
app's BIC lookup had filled it), and the reply could not have known either way.

The flow `fill:` step prints the same claim: scratch flow `fill: { text: "Value*", value: "7.25", clear: true,
dismissKeyboard: true }` → `fill: text:"Value*" = 7.25 (cleared)` on a field that was empty before (that time the text
did land, because the label overlapped the empty input).

Selecting the input itself works and is verified: `type_text { selector: 'role:textfield value:"XX12345"', … clear:
true }` → field `DE89370400440532013000` — although there too the read-back cannot re-resolve a node selected by its
old value, so it is unverified as well (it happened to land).

## Why (read from the source)

- `src/interact/fill.ts:152–162`: the clear loop starts from `current?.value?.length ?? 0`; the label node's value is
  `null`, so `existing === 0` and the loop breaks at once — no `clearText` is sent.
- `src/interact/fill.ts:188–190` / `:210–222` `pollValue`: the refetched node's value is `undefined` (null), so after two
  reads it returns `undefined`, and `observed !== undefined && !landed(observed)` is false — "the field withholds its
  text — best effort, nothing to compare" (comment at :189). The call returns success.
- `src/mcp/tools.ts:455` builds the reply with `cleared: clear === true` — the REQUESTED option, not whether anything
  was cleared — and `src/mcp/tool-text.ts:40` prints `, cleared first`. `src/flow/engine.ts:1194` likewise prints
  ` (cleared)` from the option.
- Nothing checks that the resolved node is an input (`role` textfield/securetextfield/searchfield): a `text` label is
  focused-and-typed-into like a field.

## Why it matters

- The tool description promises "then verifies the text landed and retries a dropped clear-fill once"; the reply gives
  no sign that verification was skipped. An agent reads "22 characters, cleared first" and moves on with the old value
  in the field (here: the IBAN that decides SEPA vs SWIFT).
- On iOS idb, selecting a field by its visible label is the natural selector — idb hides the RN/SwiftUI input
  identifiers (the mp-native inputs all share `TextFieldWithComponentStyle`), and the input node carries no label.

## Possible fix directions (owner's choice)

- When the read-back is `undefined`, say so in the reply and trace: `Typed 22 characters into text:"IBAN*" — NOT
  verified: the matched node exposes no value (role text)`; print `cleared first` only when a clear was sent.
- Refuse (or warn on) a fill whose resolved node is not an input role, naming the nearest `textfield` that overlaps it —
  the label and its input share a frame here.
- For the read-back, re-resolve the field by the node chosen at focus time (identity/rect) rather than by the selector,
  so `value:"…"` selectors stay verifiable after the value changes.

## Repro

1. iOS, idb, any SwiftUI/RN form whose text field has a floating label as a separate `text` node.
2. Type something into the field so the label floats (moves off the input's frame).
3. `type_text { selector: 'text:"<label>"', text: "abc", clear: true }` → `Filled … (3 characters, cleared first)`;
   `ui_snapshot { filter: "role:textfield" }` shows the old value.

## Device check (2026-10-08, re-run at e9e6509): Android confirmed

Emulator-5554 (Pixel_3a AVD, Android 13), SWIFT form. EditText fills by `id:` and by `role:textfield value:` read back
and report real deletes: `Filled id:swift_payment.form.amount_input (3 characters, cleared 4 characters first)` (field
held `1000`), `Filled role:textfield value:"1.5" (1 characters, cleared 3 characters first)`, `Filled id:…iban_input (22
characters, cleared 7 characters first)`. Non-input match (the read-only SEPA BIC, a `scrollable`): `Typed 1 characters into
id:swift_payment.form.bic_input — NOT verified: the matched node exposes no value (role scrollable)` + the `⚠ … the
nearest input is textfield id:"swift_payment.form.iban_input"` line. The reformatting-field consequence does not bite on
Android here: the amount field shows the raw text while focused (`1000`) and reformats only on blur (`2` → `2.00`), so
`role:textfield value:"2.00"` + `clear` + `1000` → `Filled … (4 characters, cleared 4 characters first)`, value `1000`.
Nit: "1 characters".


## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:06–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
(`feature/swift-payment`), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). **Confirmed fixed**, one wording nit (default idb unless stated):

- Floating label over a filled field (IBAN held `XX12345`, label at 42,351 35x15):
  `type_text { selector: 'text:"IBAN*"', text: "DE89370400440532013000", clear: true }` → `Typed 22 characters into
  text:"IBAN*" — NOT verified: the matched node exposes no value (role text); clear sent no delete — a role text node's
  length is not the field's` + `⚠ the matched node is role text, not a textfield — … the input overlapping it is textfield
  id:"TextFieldWithComponentStyle" at 42,364 280x20 — select the input itself …`. Field still `XX12345`, no deletes.
- `role:textfield value:` read-back verified when the screen's ids stay put: `role:textfield value:"DE89…"` → same value,
  `clear` → `Filled … (22 characters, cleared 22 characters first)`; DE→BE and BE→DE swaps (4×) → `Filled … (16|22
  characters, cleared 22|16 characters first)`.
- Non-input with a value (read-only SEPA BIC, `other 'BIC*' value 'COBADEFFXXX'`): `type_text id:swift_payment.form.bic_input
  "Q"` → `Typed 1 characters into id:… — NOT verified: the matched node's value does not show the typed text (role other) —
  it is not the field` + the `⚠` naming the IBAN input. Nothing landed anywhere.
- Reformatting amount field: the consequence does not bite here either — the SwiftUI amount field shows the raw text while
  focused and reformats only on blur (`12.5` → `12,50`, `1000` → `1 000,00` with a NBSP). `role:textfield value:"12,50"` +
  clear + `7.25` → `Filled … (4 characters, cleared 5 characters first)`; `value:"7.25"` + clear + `1000` → `Filled …
  (4 characters, cleared 4 characters first)`.
- Nit (wording): when the identity fallback refuses because the screen's id set changed during typing, the reply blames the
  node: `type_text { selector: 'role:textfield value:"XX12345"', text: "DE89370400440532013000", clear: true }` → `Typed 22
  characters into role:textfield value:"XX12345" (cleared 7 characters first) — NOT verified: the matched node exposes no
  value (role textfield)` — yet the field read `DE89370400440532013000` right after (the inline `iban_input_error` went away
  and `iban_notice` appeared, so `screenSignature` changed — refusing is right). Same under `treeSource: wda` (`value:"3.10"`
  → `4.20`, landed as `4,20`; the keyboard's arrival changes the id set). A textfield that just had 7 characters deleted
  plainly exposes a value; say instead "the field could not be found again (the screen changed while typing)".
- Under `treeSource: wda` a fill by the container id (`fill: { id: swift_payment.form.amount_input … }`, a `container`) prints
  both `⚠` lines (not a textfield; NOT verified, no value) although `3.10` landed — correct by the rules, noted for
  mp-native's config.
