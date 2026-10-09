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

## Device check (2026-10-09 Android, re-run at 347e70d)

Measured 11:29–11:40 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd mp-native). Fixtures: Settings search
(`id:open_search_view_edit_text`, hint "Search settings", 15 chars), Google Contacts "Create contact" editor ("Last name", 9 chars;
no resource-ids, selected as `role:textfield label~"^(Q|Probe|Last name)$"` so one selector matches every state), the mp-native SWIFT
form. Keys from the `adb` shim (`keyevent 123` = MOVE_END, `67` = DEL, `112` = FORWARD_DEL; one delete "round" = MOVE_END + N×DEL +
N×FORWARD_DEL).

- **Holds — empty field + value (probe J).** 11:37:17 `type_text { selector: "id:open_search_view_edit_text", text: "wifi", clear: true }`
  → `Filled id:open_search_view_edit_text (4 characters)` (13.5 s). Shim: `tap 540 154`, `keyevent 123`, 15×`67`, 15×`112`, then
  `w` `i` `f` `i`, `21` `22` — ONE round of 15, no "cleared … first". Tree after: `val='wifi'`.
- **Holds — field holding text.** "Last name" holding `Q` (typed by hand): 11:39:39 `type_text { selector: <above>, text: "Probe", clear: true }`
  → `Filled role:textfield label~"^(Q|Probe|Last name)$" (5 characters, cleared 1 character first)` (15.5 s). Shim: `123`, 1×`67`,
  1×`112`, `123`, 9×`67`, 9×`112`, then `P r o b e` — deletes **1 then 9**. Tree after: `val='Probe'`.
- **Holds — clear alone.** Settings search holding `wifi`: 11:37:40 `text: "", clear: true` → `Cleared id:open_search_view_edit_text (19
  deletes sent) — NOT verified: the field still shows 15 characters that the deletes did not change — its hint or placeholder (shown
  while empty), or a field that ignores deletes` (14.2 s; shim 4+4, then 15+15). Again on the now-empty field, 11:37:56 → the same text
  with `(15 deletes sent)` (12.1 s; one round of 15). "Last name" holding `Probe`: 11:40:01 → `Cleared … (14 deletes sent) — NOT
  verified: the field still shows 9 characters that the deletes did not change — …` (14.1 s; 5+5, then 9+9); empty, 11:40:18 → `(9
  deletes sent)`, same wording (11.6 s). The hint showed afterwards each time (`val='Search settings'` / `'Last name'`).
- **Holds — bank SWIFT form regression.** 11:29:17 `type_text { selector: "id:swift_payment.form.bic_input", text: "", clear: true }` on the
  empty BIC → `Filled id:swift_payment.form.bic_input (0 characters)` (6.9 s); shim: `input tap 540 1073` only, no delete.
- **Holds — IBAN clear over a value (handoff j).** IBAN holding `AT611904300234573201` (20 chars, typed by `type_text` at 11:29:32):
  11:29:54 `type_text { selector: "id:swift_payment.form.iban_input", text: "AT611904300234573201", clear: true }` → `Filled
  id:swift_payment.form.iban_input (20 characters, cleared 20 characters first)` (16.7 s). Shim: `tap 540 886`, `123`, 20×`67`, 20×`112`,
  then the 20 characters, `21` `22` — one round of the value's length, no second round. Also 11:32:44 `DE89370400440532013000` over it →
  `Filled … (22 characters, cleared 20 characters first)` (17.1 s).
- **Not reached — masked field, focus missed.** No password field on these fixtures; the focus-miss shape was not produced (unit test "A" only).

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder:
`scratchpad/averi-repo/run5-ios`.

**WDA sends `placeholderValue` — yes.** Contacts "New Contact", Company empty (11:29:50, `curl -s
'http://localhost:8100/source?format=json'`, `run5-ios/wda-src1.json`): 5 `placeholderValue` keys; the fields read
`TextField 'Company' value 'Company' placeholderValue 'Company'`, `'First name'` likewise; the `Notes` TextView has
`placeholderValue: None`.

- **Holds — fill with clear on the empty placeholder field sends no delete:**
  `11:30:16 run_flow fill_company` (`fill: { id: Company, value: "Acme", clear: true }`, scratch `treeSource: wda`) →
  `fill: id:"Company" = Acme` / `done` (11.7 s). Shim: `11:30:23 ui tap 201 523`, `11:30:24 ui text Acme` — no `key-sequence`.
- **Holds — clear holding text:** `11:30:41 run_flow clear_company` (`fill: { id: Company, value: "", clear: true }`) on `Acme` →
  `fill: id:"Company" =  (cleared 4 characters first)` (17.0 s). Shim: `ui tap 201 500`, `ui key-sequence 42 42 42 42`,
  `ui key-sequence 76 76 76 76` — one round of 4, no second round.
- **Holds — clear alone on the empty field (placeholder named by the source):**
  ```
  11:31:18 type_text { platform: ios, selector: "id:Company", text: "", clear: true, configPath: <scratch wda> }   (13.5 s)
  → Focused id:Company — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text; the
    tree cannot tell which
  ```
  Shim: `11:31:27 ui tap 201 500` only, no delete. As a flow step (11:30:58, 13.3 s):
  `⚠ fill: id:"Company" =  — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text;
  the tree cannot tell which` / `done`. Screenshot `run5-ios/img-55-0.png`: Company empty, caret in it.

**iOS idb counterpart of the unchanged-round rule (no placeholder in idb's tree) — Holds**, bank Account Detail search field
(`textfield accounts.detail.search_field value 'Search'` while empty, 6 characters):

```
11:41:21 type_text { selector: "id:accounts.detail.search_field", text: "", clear: true }                            (3.3 s)
→ Cleared id:accounts.detail.search_field (6 deletes sent) — NOT verified: the field still shows 6 characters that the deletes
  did not change — its hint or placeholder (shown while empty), or a field that ignores deletes
  shim: ui tap 175 91, ui key-sequence 42×6, ui key-sequence 76×6
11:41:30 type_text { …search_field, text: "Loan", clear: true }                                                         (3.5 s)
→ Filled id:accounts.detail.search_field (4 characters)
  shim: ui tap 175 91, 42×6, 76×6, ui text Loan          (one round of 6, no "cleared … first")
11:41:33 type_text { …search_field, text: "", clear: true }   (holding Loan)                                            (3.9 s)
→ Cleared id:accounts.detail.search_field (10 deletes sent) — NOT verified: the field still shows 6 characters that the deletes
  did not change — its hint or placeholder (shown while empty), or a field that ignores deletes
  shim: ui tap 175 91, 42×4, 76×4, then 42×6, 76×6     (4 + 6 = 10, as on Android; no third round)
```

Screenshot `run5-ios/img-125-0.png`: the field empty (placeholder "Search").

**Masked field, focus missed — Not reached** (iOS): no password field on the screens in reach (Contacts, bank logged in); the
bank's "Password login" path was not entered, to keep the session.
