# BUG: `type_text` / `fill` reports "Filled … (N characters, cleared first)" when the resolved node exposes no value — nothing was cleared, and on iOS idb nothing was typed

> **Status (2026-10-08):** open — triaged P1 (a silent false success: the reply prints the requested `clear`, and an `undefined` read-back passes as landed); the cited code is unchanged on `c35388a`.

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
