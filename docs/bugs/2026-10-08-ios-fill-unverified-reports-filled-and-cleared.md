# BUG: `type_text` / `fill` reports "Filled … (N characters, cleared first)" when the resolved node exposes no value — nothing was cleared, and on iOS idb nothing was typed

> **Status (2026-10-08):** fixed on branch `fix/p1-fill-unverified`; **confirmed fixed on device** (Android emulator and iOS simulator, re-run at `e9e6509`, sections at the end), with two wording fixes after it on `fix/r2-c-fill`: a read-back that does not find the field again (the selector stopped matching and the identity fallback refused — the screen's id set changed while typing, or no single twin) is its own fact, `readBack: { kind: 'lost', why: 'screen-changed' | 'unmatched' }` (the reason part of the kind since the code review of round 2, so one cannot be set without the other), rendered `NOT verified: the field could not be found again (the screen changed while typing)` (or `(the selector no longer matches it)`) instead of blaming a textfield that "exposes no value", and gets no not-a-textfield `⚠` when the matched node is a textfield — the clear's own read after a delete that does not find the field is no longer counted as an empty field either (a clear alone then reads `lost`, NOT verified — since the code review of round 2 under its own head, `Cleared <selector> (N deletes sent) — NOT verified: …`, and a clear alone that sent no delete `Focused <selector> — NOT verified: …`, where both read `Typed 0 characters into …` — the flow line says the same `(N deletes sent)` for it, `fill.ts#fillClearedText` being the one clause; with a value the read-back decides; review m-1: a field the keyboard moved still held `XX` behind `cleared 7 characters first`); and every count reads `1 character`, never `1 characters` (`interact/fill.ts#charactersText`: typed and cleared counts, the masked-append warning, the read-back errors, and type_text without a selector). What the fix does: `fillField` returns facts (`interact/fill.ts#FillResult`: `cleared` = characters actually deleted, or `unmeasured` on a node that is not a `textfield` — no delete is counted off a label's length; `readBack` of kind `landed`/`no-value`/`not-taken`/`lost`/`nothing-typed`; `notInput` with the nearest `textfield`, by id and rect only), and the MCP reply and the flow line render them through one wording — an unchecked fill reads `Typed N characters into <selector> — NOT verified: …` (a `⚠ fill` line in a flow), a clear alone on a label included, `cleared M characters first` only when a delete was sent, and a match that is not a `textfield` gets a `⚠` line naming the nearest input unless the read-back saw its value change to show the text (a node that took the text is an input whatever its role). Warned, not refused: a label over its empty field focuses it (the measured `Value*` fill landed). A non-input's value proves the text landed only by changing to show it (a WDA StaticText echoes its label; a label can change on focus, `Name` → `Name*`), and only such a node gets the mismatch retry's wipe. The read-back also finds the field again by role, id and rect when a `value:"…"` selector stops matching, so that workaround is now verified — after typing only while the screen's set of identified nodes is unchanged, and not at all when nothing was read before typing; a next screen with the very same identified nodes and a field at the same rect would still pass (limit). Consequence: a `value:`/`text:` selector on a field that reformats its input (`0.00` → `1000.00`) now fails the read-back where it passed — the read-back compares exactly with `clear` and as a substring without, for every selector, so a reformatting field cannot be filled verified by any selector. Pinned with this note's shapes in tests/interact/fill.test.ts, tests/mcp/tools.test.ts and tests/flow/engine.test.ts.

> **Follow-up (2026-10-08, review m-8, not changed):** the read-back asks the selector BEFORE identity, so a `value:` selector that, once the clear or the typing has changed the chosen field, still matches ANOTHER node (two rows `id:qty value:"1"`, the first picked) reads that other node instead of finding the chosen one by identity. Pre-existing; identity-first would need the moved-field case settled first.

> **Follow-up (2026-10-08, bundle C review round 2, not changed):** a clear alone (`value: ""`) whose post-focus read misses a field that read empty before the tap sends no delete and has no read-back, so it is unverified yet said as `Filled … (0 characters)`. Narrow and pre-existing (the clear loop's post-delete miss is fixed: it reads `lost`).

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

## Device check (2026-10-09 Android, re-run at 610660f)

Measured 05:08–05:16 UTC, emulator-5554 (Pixel_3a AVD, Android 13), averi = mobile-verify `fix/keyboard-aware-scroll` @
`610660f` (`dist/`, stdio). The mp-native SWIFT form (amount, IBAN) was NOT reachable (bank app logged out, PIN login not
permitted to this session); stock fixtures instead: Settings search (`id:open_search_view_edit_text`) and the Contacts editor.

- Holds — verified fill by id: `Filled id:open_search_view_edit_text (4 characters)`; singular: `Filled
  id:open_search_view_edit_text (1 character)`; `Typed 1 character into text:"Last name" — NOT verified: …` (no "1 characters").
- Holds — `lost` wording: a selector by the field's hint text stops matching once text replaces it → `Typed 5 characters into
  text:"Last name" — NOT verified: the field could not be found again (the selector no longer matches it)` (the text landed;
  the editor has no ids, so no identity fallback).
- Holds — non-input warning in a flow (scratch config, `fill { text: "Company", value: "Acme", dismissKeyboard: true }`, the
  floating label over the empty Company input): `⚠ fill: text:"Company": the matched node is role text, not a textfield — …
  the input overlapping it is textfield at 132,405 816x176 — select the input itself …` + `⚠ fill: text:"Company" = Acme — NOT
  verified: the matched node exposes no value (role text)`; "Acme" landed in the input.
- **Not reached — the clear-alone wording** (`Cleared <sel> (N deletes sent)` / `Focused <sel> — NOT verified`): on every
  stock EditText the clear throws first, because uiautomator reports an empty field's HINT as its text — `fill: field still
  shows 9 characters after clearing twice` (Contacts `Last name`) / `… 15 characters …` (Settings search), in the MCP reply
  and as the flow line `✗ fill text:"Last name": failed — fill: field still shows 9 characters after clearing twice` (the two
  agree). Filed: [2026-10-09-android-clear-reads-edittext-hint-as-content.md](2026-10-09-android-clear-reads-edittext-hint-as-content.md).
- Not measured: the reformatting `value:` selector (mp-native amount field only).

## Device check (2026-10-09 iOS, re-run at 610660f)

Measured 05:22–05:46 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`). **The mp-native SWIFT form was
not reachable this session**: the bank app was still logged in on the device, but every Hive read came back
`SUBGRAPH_RESPONSE_BODY_EMPTY` from `gds-business` (app log, 07:22–07:45 local — the no-session signature named in mp-native's
`scripts/hive-probe.mjs`), so the SWIFT form, the own-transfer form, the dashboard list and the Transactions tab all rendered
"That's an error"; logging in again was not permitted to this session. Fixtures instead: the bank app's account-detail screen
(search field + error state), the stock Contacts "New Contact" sheet (UIKit form, ~4 pages) and Settings (SwiftUI list).
Software keyboard raised by toggling `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen`
to false and switching apps (`launch_app` bank → `launch_app` Contacts) — a toggle plus focus change alone did not raise it
after a `fill` this time; both prefs restored to 1 at the end. Strokes recorded with an `idb` PATH shim logging every `idb ui
swipe|tap|text` the server sent.

**Holds where measured; the `screen-changed` reason and the reformatting amount were not reachable** (no SWIFT form). One
pre-existing failure shared with Android and one new wording bug, below.

- Holds — verified fills, both sources: idb `type_text id:"First name" "Ann"` → `Filled id:"First name" (3 characters)` (2.1 s);
  WDA `id:"Last name" "Q"` → `Filled id:"Last name" (1 character)` (11.9 s), `id:"Company" "Acme"` → `Filled id:"Company" (4
  characters)` (12.5 s); bank search field under WDA (role `other` there), flow `fill: … value: "Loan"` → `fill:
  id:"accounts.detail.search_field" = Loan` (it showed `Loan`). Singular `1 character` everywhere.
- Holds — `lost` wording (idb, bank search field, no `clear`): `type_text { selector: 'role:textfield value:"Search"', text: "G" }`
  → `Typed 1 character into role:textfield value:"Search" — NOT verified: the field could not be found again (the selector no
  longer matches it)`; again from `value:"G"` + `a` → same sentence; the field read `G`, then `Ga`. Right by the rules: without
  `clear` nothing was read before typing, so identity is not asked and the reason is `unmatched`, not a blame on the node.
  The `(the screen changed while typing)` reason was not reproduced (needs a clear on a field whose screen gains an id while
  typing — the SWIFT IBAN case).
- Holds — clear alone, verified (WDA, Contacts `Notes`, a textfield that exposes no placeholder): `type_text { selector:
  "role:textfield label:Notes", text: "", clear: true }` → `Filled role:textfield label:Notes (0 characters, cleared 5
  characters first)` (19.4 s); field empty after.
- Holds — clear alone on a non-input (idb, the `text 'Notes'` label): `Focused role:text text:Notes — NOT verified: clear sent no
  delete — a role text node's length is not the field's` + `⚠ the matched node is role text, not a textfield — nothing was
  deleted, and the focus is wherever the tap left it; no textfield is on the screen`.
- Not reached: `Cleared <sel> (N deletes sent) — NOT verified` (needs a clear whose read loses the field).
- **Fails (pre-existing, same as Android) — `clear: true` on an empty iOS field with a placeholder**: idb AND WDA report the
  placeholder as the value (`textfield id:Company value 'Company'`, bank `textfield accounts.detail.search_field value
  'Search'`). WDA `type_text id:"First name" "Ann" clear` on `Zed` → `fill: field still shows 10 characters after clearing
  twice` (18.0 s); idb the same on `Ann` → same (2.9 s); idb bank `type_text id:accounts.detail.search_field "Gas" clear` on
  `Loan` → `fill: field still shows 6 characters after clearing twice`; flow `fill { id: Company, value: "Acme", clear: true }` on
  the EMPTY field → `✗ fill id:"Company": failed — fill: field still shows 7 characters after clearing twice`. Each time the
  field was left empty and the value never typed. (The same search field under WDA, role `other`, cleared and filled `Gas`
  fine.) Recorded as the iOS section of
  [2026-10-09-android-clear-reads-edittext-hint-as-content.md](2026-10-09-android-clear-reads-edittext-hint-as-content.md).
- **New — mismatch error with equal counts**: WDA `type_text { selector: "role:textfield label:Notes", text: "hello" }` → after
  35.8 s `fill: typed 5 characters but the field shows 5 (content withheld from this error)`; the field read `Hello`
  (auto-capitalised). Filed: [2026-10-09-fill-mismatch-error-says-equal-counts-when-app-transforms-text.md](2026-10-09-fill-mismatch-error-says-equal-counts-when-app-transforms-text.md).
- Not measured: the reformatting amount with a `value:` selector (mp-native SWIFT amount field only).
- Cost note: WDA fills on the Contacts sheet took 11.9–19.4 s against idb's 2–3 s for the same field (3.5–4 s a WDA read).

## Device check (2026-10-09 iOS bank form, re-run at 610660f)

Measured 05:56–06:08 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native SWIFT
form (`feature/swift-payment`, logged in by the owner-authorised PIN-only `login_pin_ios_here` after a cold relaunch; data
loaded), averi = mobile-verify `fix/keyboard-aware-scroll` `dist/` built at `610660f` (the branch head has since moved to
`57dd6ac`; `dist/` predates those commits — no `fill-verdict.js` in it), stdio, cwd `/Users/mholecy/Finshape/mp-native`.
Scratch configs only (`treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`; mp-native's `averi.yaml`
untouched). Decimal pad raised the round-1 way: `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled` /
`HardwareKeyboardLastSeen` set to NO before a cold relaunch, then a focus TAP (not a fill) on
`id:swift_payment.form.amount_input` → WDA `role:keyboard` `0 572 402 302`; prefs restored to 1 at the end. Strokes and taps
recorded with an `idb` PATH shim.

**Holds; the `screen-changed` reason is reached — and here it is triggered by the field's own clear button, not by a screen
change.** idb unless stated.

- Verified fills: `type_text { selector: 'role:textfield value:"XX12345"', text: "DE89370400440532013000", clear: true }` →
  `Filled role:textfield value:"XX12345" (22 characters, cleared 7 characters first)` (idb 06:03:06, 3.0 s; WDA 06:04:57, 10.7 s).
  Amount: idb `value:"4.2"` + clear + `5.5` → `Filled … (3 characters, cleared 3 characters first)` (06:05:42).
- Reformatting amount with a `value:` selector (blurred `5,50`, raw while focused): idb `role:textfield value:"5,50"` + clear +
  `1000` → `Filled role:textfield value:"5,50" (4 characters, cleared 4 characters first)` (06:06:27; field `1000`, `1 000,00` after
  blur); WDA `value~"000,00"` + clear + `3.10` → `Filled … (4 characters, cleared 8 characters first)` (06:06:33). Verified through
  the identity fallback (the field's rect `42,312 194x20` did not move).
- `(the screen changed while typing)` — reached, 4 times, each time the text landed:
  ```
  06:02:16 type_text { selector: 'text:"Value*"', text: "12.5" }   → Typed 4 characters into text:"Value*" — NOT verified: the
           field could not be found again (the screen changed while typing)  + ⚠ role text, input at 42,296 194x20
  06:02:20 type_text { selector: 'role:textfield value:"12.5"', text: "7.25", clear: true }
           → Typed 4 characters into role:textfield value:"12.5" (cleared 4 characters first) — NOT verified: … (the screen changed while typing)
  06:02:26 (blurred) value:"7,25" + clear + "1000"  → same sentence
  06:04:15 (WDA) value:"3.10" + clear + "4.20"      → same sentence (10.5 s)
  ```
  Mechanism (raw `idb ui describe-all`): every field that holds text shows a clear button, `Button 'icon-cross-circle'` with the
  form's SHARED id `TextFieldWithComponentStyle`. In these four calls the amount was the only filled field, so the clear removed
  the pair `button:TextFieldWithComponentStyle` from `screenSignature` and the typing brought it back; with the IBAN also filled
  (its own clear button keeps the pair in the set) the very same calls verified (the bullets above). By the rule this is right
  (an identified node appeared, refusing is the safe direction), but the screen did not change — the field grew its own
  accessory; the sentence will mislead a reader on any form with per-field clear buttons. (Also, from empty, the textfield's
  rect moves as the floating label settles, `42,289 232x20` → `42,296 194x20`, so identity would miss anyway on a first fill.)
  Possible direction: leave out of the signature nodes inside/overlapping the chosen field's container, or nodes that share the
  chosen field's id.
- Clear alone: `Cleared role:textfield value:"DE89370400440532013000" (22 deletes sent) — NOT verified: the field could not be
  found again (the selector no longer matches it)` (06:03:20) and `Cleared role:textfield value~"000,00" (4 deletes sent) — NOT
  verified: …` (06:03:41); both fields were empty after. Unverified because the emptied field's rect changes (IBAN `42,402 280x20`
  → `42,357 318x20`: the label drops back into it), so no twin — on this form a clear alone cannot be verified.
- Non-input label: idb `text:"IBAN*"` + `XX12345` → `NOT verified: the matched node exposes no value (role text)` + ⚠ naming the
  input at `42,402 280x20`; WDA (06:04:29, 16.8 s) → `NOT verified: the matched node's value does not show the typed text (role
  text) — it is not the field` + the same ⚠. Text landed in IBAN both times.
- Flow `fill: { id: swift_payment.form.amount_input, value: "3.10", clear: true, dismissKeyboard: true }` (WDA, 06:03:53, empty
  field): the two container ⚠ lines as at e9e6509 (`clear sent no delete — a role container node's length is not the field's`);
  `3.10` landed.
- The placeholder-as-value clear failure ([2026-10-09-android-clear-reads-edittext-hint-as-content.md](2026-10-09-android-clear-reads-edittext-hint-as-content.md))
  does NOT hit this form: all 12 empty SwiftUI textfields read `value: null` under idb AND WDA, and every clear above ended
  without `field still shows N characters`.

## Device check (2026-10-09 Android bank form, re-run at 610660f)

Measured 05:58–06:03 UTC, mp-native SWIFT form (logged in by the owner), emulator-5554, averi = mobile-verify
`fix/keyboard-aware-scroll` `dist/` from `610660f` (stdio). Read-backs confirmed with `ui_snapshot` after each call.

- **Holds — verified fills:** amount `12.50` → `Filled id:swift_payment.form.amount_input (5 characters)`; IBAN
  `DE89370400440532013000` → `Filled id:swift_payment.form.iban_input (22 characters)` (15.5 s); value in the tree after.
- **Holds — `clear: true` re-fill:** IBAN → `AT611904300234573201` → `Filled … (20 characters, cleared 22 characters first)`;
  amount `12.50` → `1000` → `Filled … (4 characters, cleared 5 characters first)` (shows `1,000.00` once blurred).
- **Clear alone (empty text):** on the filled IBAN → `Filled id:swift_payment.form.iban_input (0 characters, cleared 20
  characters first)` (field empty after: verified, the read-back decided). On the EMPTY BIC → `Filled
  id:swift_payment.form.bic_input (0 characters)` (6.9 s, no delete sent, field read empty). The `Cleared … (N deletes sent)`
  / `Focused … — NOT verified` heads did not arise: both read-backs found the field.
- **`value:` selector after the reformat — the documented consequence did not arise here:** `type_text { selector:
  'role:textfield value:"1,000.00"', text: "250", clear: true }` → `Filled role:textfield value:"1,000.00" (3 characters,
  cleared 8 characters first)`; the field read `250` while focused (the app reformats on blur, to `250.00`), so the identity
  fallback found it and the exact compare passed. A field that reformats WHILE typing was not available on this form.
- **Holds — flow line = MCP reply** (scratch config, `run_flow`): `fill: id:"swift_payment.form.iban_input" =
  AT611904300234573201 (cleared 22 characters first)`; clear of the empty BIC `fill: id:"swift_payment.form.bic_input" = `
  (nothing else); clear of the filled IBAN `fill: … =  (cleared 20 characters first)`. Same counts as the MCP replies.
- The hint bug ([2026-10-09-android-clear-reads-edittext-hint-as-content.md](2026-10-09-android-clear-reads-edittext-hint-as-content.md))
  did not hit: the empty Compose fields read `text=None` (no placeholder exposed).
