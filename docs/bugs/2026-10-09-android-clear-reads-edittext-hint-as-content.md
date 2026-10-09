# BUG: `type_text`/`fill` with `clear: true` fails on every empty Android EditText that has a hint — uiautomator reports the hint as the node's text, the clear loop counts it as content, sends deletes into an empty field and throws "field still shows N characters after clearing twice"

**Measured 2026-10-09 05:08–05:16 UTC** on emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard), averi =
mobile-verify `fix/keyboard-aware-scroll` @ `610660f` built from source (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`).
Fixtures: stock apps only — Google Contacts "Create contact" editor (`am start -a android.intent.action.INSERT -t
vnd.android.cursor.dir/contact`) and the Settings search field (`com.android.settings`, `id:open_search_view_edit_text`).
Pre-existing (the clear loop is from `c7d7411`), not a regression of the round-2 branches; it did not show on the mp-native
SWIFT form, whose Compose fields do not expose their placeholder as text.

## Observed (measured)

An empty classic `EditText` with a hint is dumped by uiautomator with the hint as `text` — there is no separate `hint`
attribute in the API 33 dump:

```
<node … text="Last name" class="android.widget.EditText" … focused="true" … bounds="[132,1223][948,1383]" />   (field empty, hint shown)
ui_snapshot → textfield 'Last name' value 'Last name'
ui_snapshot → textfield 'Search settings' id open_search_view_edit_text value 'Search settings'                (field empty)
```

Every clear on such a field ends empty, reads the hint back as content and throws (keys from an adb shim on the server's
PATH: `keyevent 123` MOVE_END, `67` DEL, `112` FORWARD_DEL):

```
05:08:57 type_text { selector: 'text:"Q"', text: "Probe", clear: true }          (Last name held "Q")
→ [isError] fill: field still shows 9 characters after clearing twice           (9.5 s; 1 DEL+1 FDEL, then 9 DEL+9 FDEL; "Probe" never typed)
05:10:11 type_text { selector: 'text:"Probe"', text: "", clear: true }           (Last name held "Probe")
→ [isError] fill: field still shows 9 characters after clearing twice           (11.7 s; 14 DEL in all)
05:13:25 run_flow clear_hinted_lastname  (fill { text: "Last name", value: "", clear: true } on the EMPTY field, scratch config)
→ ✗ fill text:"Last name": failed — fill: field still shows 9 characters after clearing twice   (18 DEL sent into an empty field)
Settings search (05:15–05:16, landscape, IME band [0,397][2220,1080]):
→ type_text { selector: "role:textfield", text: "wifi", clear: true }                       → fill: field still shows 15 characters after clearing twice
→ type_text { selector: "id:open_search_view_edit_text", text: "wifi" }                     → Filled id:open_search_view_edit_text (4 characters)
→ type_text { selector: "id:open_search_view_edit_text", text: "x", clear: true }           → fill: field still shows 15 characters after clearing twice
→ type_text { selector: "id:open_search_view_edit_text", text: "", clear: true }            → fill: field still shows 15 characters after clearing twice
```

The field was empty after each failure (dump: `text="Last name"` / `'Search settings'`). So on a stock EditText:
`clear: true` with a value never types the value, and a clear alone is reported as a failure although it succeeded. A fill
without `clear` works (`Filled … (4 characters)`, `(1 character)`), because the read-back is a substring test.

Related wording on the same fixture (no `clear`): a selector by the hint text no longer matches once the text replaces the
hint, and the identity fallback does not find the field (the editor has no resource-ids):
`type_text { selector: 'text:"Last name"', text: "Probe" }` → `Typed 5 characters into text:"Last name" — NOT verified: the
field could not be found again (the selector no longer matches it)` — the text did land. Correct by the r2-c rules.

## Why (read from the source)

`src/interact/fill.ts` clear loop (≈ lines 445–469): `existing = current?.value?.length`, `adapter.clearText(existing)`,
re-read, `left = current?.value?.length`; `left > 0` on the second attempt throws. `value` for an Android node is the
dump's `text`, which for an empty EditText is the hint (`AccessibilityNodeInfo.getText()` returns the hint while
`isShowingHintText()`; uiautomator's dump carries no `hint` attribute on this image). Nothing in `src/` handles hints
(`grep -rn hint src` finds only unrelated poll hints).

## Why it matters

`fill { clear: true }` is the documented way to replace a field's content, and the stock Android widget (Views, Material
`TextInputEditText` without a floating label, the Settings search) shows a hint whenever it is empty — every such clear fails,
after sending up to 2 × (hint length) deletes. The error text ("field still shows 9 characters") sends the reader to look for
content that is not there.

## Possible fix directions (owner's choice)

- Treat a value equal to the pre-focus/placeholder text as empty: remember the field's text when the clear began; if a delete
  round leaves exactly a string the field showed while empty (or equal to its label), stop and count it as empty.
- Ask the device: `dumpsys`/an accessibility read of `isShowingHintText` (uiautomator2 server exposes `hint`/`showingHintText`
  in newer dumps) and map it to an empty value in the Android adapter.
- At minimum, the second-attempt error should say the remaining text equals the field's hint/label and may be a placeholder.

## Repro

1. emulator, `adb shell am start -n com.android.settings/.Settings`, tap the search bar (opens `open_search_view_edit_text`).
2. `type_text { platform: android, selector: "id:open_search_view_edit_text", text: "wifi", clear: true }`
   → `fill: field still shows 15 characters after clearing twice`; the field is empty, "wifi" was never typed.

## iOS (measured 2026-10-09 05:28–05:42 UTC): the same failure through idb and WDA

iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`), averi @ `610660f` (`dist/`, stdio). Both iOS tree sources
report an empty field's PLACEHOLDER as its value — idb `AXValue`, WDA `value`:

```
idb  textfield id:"First name" value 'First name' 36 406 330 22      (Contacts "New Contact", empty)
WDA  textfield id:Company      value 'Company'    36 512 330 22      (same sheet)
idb  textfield id:accounts.detail.search_field value 'Search'        (mp-native account detail, SwiftUI, empty)
```

so every `clear: true` that empties such a field reads the placeholder back as content:

```
05:31:00 run_flow fill { id: Company, value: "Acme", clear: true, dismissKeyboard: true }   (WDA, field EMPTY)
→ ✗ fill id:"Company": failed — fill: field still shows 7 characters after clearing twice                 (15.4 s)
05:31:32 type_text { selector: 'id:"First name"', text: "Ann", clear: true }                (WDA, field held "Zed")
→ fill: field still shows 10 characters after clearing twice                                               (18.0 s)
05:31:50 type_text { selector: 'id:"First name"', text: "Bo", clear: true }                 (idb, field EMPTY after the call above)   
→ fill: field still shows 10 characters after clearing twice                                               (2.9 s)
05:41:38 type_text { selector: "id:accounts.detail.search_field", text: "Gas", clear: true } (idb, field held "Loan")
→ fill: field still shows 6 characters after clearing twice                                                (2.7 s)
```

Each time the field ended empty (`value 'First name'` / `'Search'` again) and the value was never typed. A fill without
`clear` worked on the same fields (`Filled id:"Company" (4 characters)`). Contrast: the same SwiftUI search field read under
WDA is role `other` there, and the flow `fill { id: accounts.detail.search_field, value: "Gas", clear: true }` passed (`= Gas`).
XCUITest exposes a separate `placeholderValue` per element (not checked whether averi's WDA source carries it); an
empty-field check could compare against it. Not seen on the mp-native SWIFT form at e9e6509, whose fields were pre-filled or
read without placeholders.

## Device check (2026-10-09 iOS bank form, re-run at 610660f)

mp-native SWIFT form, iPhone 17 iOS 27.0, `dist/` at `610660f`, 05:56–06:08 UTC: **not hit**. The form's empty SwiftUI
`StyledTextField`s (12 textfields, shared id `TextFieldWithComponentStyle`) read `value: null` under both idb and WDA — no
placeholder as value — and clears of the IBAN (22 deletes) and the amount ended empty without `field still shows N characters
after clearing twice`. The failure needs a field whose tree exposes its placeholder (Contacts, the account-detail search field).

## Device check (2026-10-09 Android bank form, re-run at 610660f)

06:00–06:03 UTC, mp-native SWIFT form (Compose). Does not reproduce there: the empty `bic_input` / `iban_input` read with no
text (`textfield None … None`; placeholders `BIC*`, `IBAN*` on screen), and `clear: true` with empty text on the empty BIC →
`Filled id:swift_payment.form.bic_input (0 characters)` in 6.9 s, no delete sent (same through a flow `fill`). Compose
`TextField` placeholders are not reported as the node's text; the bug stays specific to classic `EditText` hints.
