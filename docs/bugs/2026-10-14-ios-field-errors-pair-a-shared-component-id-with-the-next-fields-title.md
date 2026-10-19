# BUG: on iOS a text field's `error` is the NEXT field's title when the design-system field component shares one accessibilityIdentifier — every SWIFT field reports a fake validation message

**Measured 2026-10-14 22:23 UTC** on the iPhone 17 simulator, iOS 27.0. averi = mobile-verify `arch/round-13` @ `d407256`, both tree
sources. The app is mp-native's SWIFT form with no input and no validation shown. The same output is in round-12 trees
(`run12-ios/D2-idb-numpad-2.json`, `D2-idb-qwerty.json`, `F1-after.json`), so this is not new in round 13. It was not reported before.

## Symptom


Every field of the form (`TextFieldWithComponentStyle`) and its floating title (a `text` node) carry the same identifier,
`TextFieldWithComponentStyle`. `attachFieldErrors` (`src/adapters/field-errors.ts`) pairs each field with the nearest same-id text
below it, which is the next field's title. Excerpt from `run13-ios/swift-idb.json` (idb) and `A6-wda-numpad.json` (WDA):

```
textfield id=TextFieldWithComponentStyle 42,289 232x20  error="IBAN*"              ← the amount ("Value*")
textfield id=TextFieldWithComponentStyle 42,357 318x20  error="BIC*"               ← IBAN
textfield id=TextFieldWithComponentStyle 42,425 318x20  error="Payee’s bank name*" ← BIC
textfield id=TextFieldWithComponentStyle 42,493 318x20  error="Payee’s name"       ← Payee’s bank name
textfield id=TextFieldWithComponentStyle 42,817 318x20  error="Payee’s street"     ← Payee’s name
```

The screen shows no error. An element assert with `error:` (`verify/assert.ts`), and anyone reading `ui_snapshot`, sees a validation
message on every field.

## Repro


mp-native → Account Detail → PAY → SWIFT payment. `ui_snapshot` (idb or WDA): each `textfield` has `"error"` = the title of the field
below it.

## Evidence


`run13-ios/swift-idb.json`, `A6-wda-numpad.json`, `B2-idb-numpad.json`. Round 12: `run12-ios/D2-idb-numpad-2.json`.

## Expected


`error` is set only from a validation message: a same-id text below the field that is not itself another field's title. No `error` on
a pristine form.

## Suspected cause


The rule "a same-identifier text BELOW an input is its validation message" (payment spike 2026-08-05) assumes per-field identifiers.
Here one component id is shared by every field. A text that is the title (label) of another same-id field, i.e. the one lying just
above or at the top of a later field, should not count. Alternatively, the pairing could be restricted to texts lying within the field's
own wrapper or within a small distance of its bottom edge.


## Device check (2026-10-14 iOS, re-run at e1384aa)

Measured 2026-10-14 06:55–07:12 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It
was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-14` @
`e1384aa` (`dist/`, stdio via the HTTP daemon on port 47903, cwd mp-native); `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed
`e1384aa` (read-only). **Daemon restart:** my first call (`c __list` with no second argument) crashed the provided daemon. `call.sh`'s
default `${2:-{\}}` sends the body `{"name":"__list","args":{\}}`, and `daemon.mjs` has no guard around `JSON.parse` (`daemon.out`). I
restarted it the way the Android daemon had been restarted at 06:55:08: `node daemon.mjs run14-ios` from `averi-repo`, `AVERI_PORT=47903`,
`run14-ios/shim` first on `PATH`. The new session connected at 06:55:29. Every later call passed explicit JSON args. Call numbers below
are from that session, and the whole log is in `session.log`. I pinned the device with `select_device` (#2).

mp-native's `averi.yaml` was not touched (default `treeSource: idb`). The scratch configs are in `run14-ios`:
- `cfg-wda.yaml`: copied from `run13-ios`; it differs from mp-native's `averi.yaml` only by `treeSource: wda`.
- `fp-cfg.yaml`: copied from `run13-ios`; `diff` with `~/dev/finportal/app/averi.yaml` is empty (`treeSource: wda`).

The idb shim logged 53 lines to `idb-calls.log`. Lines 17–20 are the `login_pin_ios_here` PIN pad and are not quoted. Lines 7, 24, 28,
32, 36 and 41 are `ui text` from my dummy typing. WDA (port 8100) was started by averi on the first `fp-cfg` call (#5, 06:55:57,
xcodebuild pid 95058). I stopped it at 07:12:23 by killing the xcodebuild; WDA pid 95061 exited and 8100 closed. The keyboard prefs were
**not changed**: `AutomaticMinimizationEnabled = 1` and `HardwareKeyboardLastSeen = 1` before and after, and no item needed the software
keyboard. **One PIN re-login:** the SWIFT form showed "That's an error" at 07:04:37 (`img-52-0.png`). I terminated and launched the app
(no clearState) and saw the PIN prompt ("Enter your PIN to log in", `img-56-0.png`, #57). I read `login_pin_ios_here` in `averi.yaml`: it
has no `requires:`. I ran it once (#58, 07:05:09, `branch: matched state logged_in`). The `login` rung was never run, and nothing
registered. Raw WDA trees were captured session-less with `curl http://127.0.0.1:8100/source?format=json`; `/status` showed `"sessionId" :
null`, WDA 16.1.7. Local pages were served on 127.0.0.1:47905 from 07:11:5x and stopped at 07:12:14. Metro on :8081 (pid 88312) was
left running. I did not touch the Android emulator, adb or port 47901.

**B.1 SWIFT form, fields empty, no validation: holds (idb and WDA).**
- **idb `ui_snapshot` (#63, `B1-idb-swift.txt`) and WDA (#64, `B1-wda-swift.txt`):** 12 `textfield id=TextFieldWithComponentStyle`
  each, and **0** `"error"` keys in either tree. Before the fix, the WDA/idb fields at y 289/357/425/493/817 had `error="IBAN*"`, `"BIC*"`,
  `"Payee’s bank name*"`, `"Payee’s name"`, `"Payee’s street"`.
- **`fill`:**
  - On `id:swift_payment.form.bank_name_input` (WDA, the wrapper), typing "Testbank" (#65) → `Typed 8 characters into
    id:swift_payment.form.bank_name_input — NOT verified: the matched node exposes no value (role container)` followed by `⚠ the matched
    node is role container, not a textfield — … the input overlapping it is textfield id:"TextFieldWithComponentStyle" at 42,500 280x21 —
    select the input itself (role:textfield with its id:, or its current value: when inputs share an id)`. The trees after it had 0
    errors on WDA (#66) and on idb (#67).
  - With a value selector: `Filled role:textfield value:Dummy (5 characters, cleared 5 characters first)` on WDA (#72) and idb (#73).
    The idb tree after it had 0 errors (#74).
  - Cleared with `Cleared role:textfield value:Dummy (5 deletes sent) — NOT verified: the field could not be found again (the selector
    no longer matches it)` (#75). All 12 values were `null` again (#76).
  - #69 (`role:textfield value:Testbank` → "Dummy") correctly said `NOT verified: the field could not be found again (the screen changed
    while typing)`.

**B.2 a real validation message: fails. It is not paired with any field, though it is not mispaired either.**
- **Setup:**
  - IBAN typed "XX12" via `type_text id:swift_payment.form.iban_input` (#77, the same container ⚠).
  - Focus moved with `tap id:swift_payment.form.title` (#78, l.42 `201 84`).
  - The form shows a red "The IBAN you've entered is not valid. Please adjust and try again" under the IBAN field (`img-79-0.png`). No
    CONTINUE, nothing submitted.
- **idb (#80, `B2-idb-iban.txt`) and WDA (#81, `B2-wda-iban.txt`) agree:**
  ```
  text      id=TextFieldWithComponentStyle         'IBAN*'                 42,351 35x15     ← the field's floating title
  textfield id=TextFieldWithComponentStyle         value 'XX12'            42,364 280x20    ← no "error"
  text      id=swift_payment.form.iban_input_error 'The IBAN you've entered is not valid. …'  42,400 310x30
  ```
  - Both trees have **0** `"error"` keys.
  - The message carries its own identifier (`<wrapper id>_error`), so `attachFieldErrors` (same-identifier texts only) pairs it with
    nothing.
  - The round-14 title rule works: `IBAN*` overlaps its field and is not taken as an error. No other field got the message.
  - See NEW `2026-10-14-ios-field-error-with-its-own-identifier-is-never-paired-with-its-field.md`.
- **Cleanup:** `Cleared role:textfield value:XX12 (4 deletes sent) …` (#82), then title tap (#83). The form is pristine (`img-85-0.png`).
