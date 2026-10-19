# BUG: a validation message that carries its own identifier (`<field id>_error`) is never paired with its field — mp-native's SWIFT IBAN error shows on screen but no node has `error`

**Measured 2026-10-14 07:07–07:08 UTC** on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt).
averi = mobile-verify `arch/round-14` @ `e1384aa` (`dist/`, stdio via the HTTP daemon on port 47903), both `treeSource: idb` (default)
and `wda` (scratch). Found during the round-14 device check, item B.2. This is the counterpart of
`2026-10-14-ios-field-errors-pair-a-shared-component-id-with-the-next-fields-title.md`, whose false errors round 14 removed.

## Symptom


mp-native → Account Detail → PAY → SWIFT payment. Type "XX12" into IBAN and move the focus (tap the screen title). The form shows a red
"The IBAN you've entered is not valid. Please adjust and try again" under the field (`img-79-0.png`). Both tree sources list:

```
text      id=TextFieldWithComponentStyle          label 'IBAN*'                                   42,351 35x15
textfield id=TextFieldWithComponentStyle          value 'XX12'                                    42,364 280x20   (no "error")
text      id=swift_payment.form.iban_input_error  label "The IBAN you've entered is not valid. …"  42,400 310x30
```

- WDA also lists the field's wrapper `container id=swift_payment.form.iban_input 24,341 354x52`; idb has no container ids.
- Neither tree has any `"error"` key (`B2-idb-iban.txt` #80, `B2-wda-iban.txt` #81). The message is on screen, but an element assert with
  `error:` on the IBAN field, and anyone reading `ui_snapshot`, sees no validation message.

## Repro


1. mp-native SWIFT form, pristine.
2. `type_text { selector: "id:swift_payment.form.iban_input", text: "XX12" }`, then `tap id:swift_payment.form.title`.
3. `ui_snapshot` (idb or WDA): the message is listed as `text id=swift_payment.form.iban_input_error`, and no textfield carries `error`.

## Evidence


- `run14-ios/session.log` #77–#81
- `B2-idb-iban.txt`, `B2-wda-iban.txt`
- `img-79-0.png`

## Expected


The IBAN `textfield` carries `error: "The IBAN you've entered is not valid. Please adjust and try again"`, and no other field does.

## Suspected cause


`attachFieldErrors` (`src/adapters/field-errors.ts`) pairs only a text whose identifier **equals** the field's. That fits the 2026-08-05
payment-spike convention (title and error share the field's id). mp-native's design-system field instead gives the input and its title
the shared component id `TextFieldWithComponentStyle`, and gives the error the wrapper's id plus `_error`
(`swift_payment.form.iban_input` → `swift_payment.form.iban_input_error`).

Candidates, owner's choice:
- Also pair a text whose identifier is `<id>_error` (or ends in `_error` / `.error`) with the field whose own id, or whose nearest
  identified ancestor's id (WDA), is `<id>`.
- Under idb, which has no container ids, fall back to the nearest text **below** the field and above the next field whose id ends in
  `_error`.

The round-14 title exclusion is fine here: `IBAN*` overlaps its field and is not taken as an error.


## Device check (2026-10-14 iOS, re-run at ebe6822)

Measured 2026-10-14 17:24:17–17:47:35 UTC on the iPhone 17 simulator, iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt). It was the only booted simulator at the start and at the end (`xcrun simctl list devices booted`). averi = mobile-verify `arch/round-16` @ `ebe6822`; `git -C ~/dev/mobile-verify rev-parse --short HEAD` printed `ebe6822` (read-only, detached, no git writes). averi ran through the HTTP daemon on port 47913 (`daemon.mjs`, pid 86016, session connected 17:07:13, server `averi 0.9.0`). Call numbers below come from that session (`session.log`). I pinned the device with `select_device` (#2). Configs in `run16-ios`:
- `cfg-wda.yaml`: copied from `run14-ios`. `diff` with mp-native's `averi.yaml` shows only `treeSource: wda`.
- `fp-cfg.yaml`: copied from `run14-ios`. `diff` with `~/dev/finportal/app/averi.yaml` is empty.
- idb calls used mp-native's own `averi.yaml` (default `treeSource: idb`).

**WDA.** averi started WDA (port 8100) on the first `cfg-wda` call (#6, 17:24:41, WebDriver pid 30539). During #168 (Safari, 17:45:54) averi logged `WDA on port 8100 … stopped answering (The operation was aborted due to timeout) — restarting it once` (`server-stderr.log`). The new xcodebuild started at 17:46:27 (pid 87509, WDA pid 87510). I stopped it at 17:47:3x by killing xcodebuild 87509. Both pids exited, and `lsof -iTCP:8100 -sTCP:LISTEN` was empty.

**Keyboard prefs.** Both were 1 at the start.
- I set `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to 0 at 17:39:50. The read-back at 17:41 showed both at 1 again: the `idb ui text` HID typing at l.52 flips them back. I set them to 0 again at 17:41:52 and relaunched Contacts.
- I restored both to 1 at 17:44:50. They read back as 1 at 17:47:35.

**PIN re-login.** At 17:27 the SWIFT form showed "That's an error" (`img-21-0.png`). I saved its trees, then terminated and launched mp-native without clearState. The screenshot showed "Enter your PIN to log in" (`img-26-0.png`). `login_pin_ios_here` has no `requires:`. I ran it once (#27, `branch: matched state logged_in`). Its PIN-pad lines are shim l.9–12 and are not quoted. I never used the `login` rung, and nothing was registered.

**Metro and the rest.** Metro on :8081 (listener node pid 86170, `metro.pid` 86151) was left running, and Finportal showed no redbox or LogBox toast. A local web server ran on 127.0.0.1:47915 from 17:45:4x and was stopped at 17:47. The shim logged 66 lines to `idb-calls.log`. No Android, adb or port 47911 was touched.

**R15 B.1 IBAN validation shown: holds (idb and WDA).**
- `type_text id:swift_payment.form.iban_input "XX12"` (#38, l.17–18) gave the same container ⚠ as round 14. A title tap followed (#39, l.19).
- The form shows `The IBAN you've entered is not valid. Please adjust and try again` (`img-40-0.png`). Nothing was submitted.
- **WDA (#41, `swift-iban-error-wda.txt`):** exactly 1 `"error"` key:
  `textfield id=TextFieldWithComponentStyle value 'XX12' 42,364 280x21 error="The IBAN you've entered is not valid. Please adjust and try again"`. The message is `text id=swift_payment.form.iban_input_error 42,400 310x31`.
- **idb (#42, `swift-iban-error-idb.txt`):** exactly 1 `"error"` key, the same pair (`42,364 280x20` / text `42,400 310x30`).
- No other field has an error. Cleanup: `Cleared role:textfield value:XX12 (4 deletes sent) — NOT verified: the field could not be found again (the selector no longer matches it)` (#43, l.20–22), then a title tap (#44). The WDA tree then had 0 errors and no `XX12` (#45, `swift-cleared-wda.txt`). The form is pristine (`img-46-0.png`).

**R15 B.2 Pristine SWIFT form: holds.** WDA #31 (`swift-pristine-wda.txt`) and idb #32 (`swift-pristine-idb.txt`) each have 0 `"error"` keys.

**R15 B.3 Account Detail error screen: not reached.** Account Detail never showed an error during the run, and I did not go offline. The SWIFT form's own "That's an error" page did occur on its own (`img-21-0.png`). Its trees, WDA #22 and idb #23, each have 0 `"error"` keys.
