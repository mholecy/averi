# BUG: fill says "NOT verified … (the screen changed while typing)" when only the field's own clear button appeared — and on the same form a clear alone can never be verified

**Measured 2026-10-09 06:02–06:06 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt),
averi = mobile-verify `fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`),
default `treeSource: idb` and a scratch `treeSource: wda`, mp-native SWIFT form (SwiftUI, logged in). Noted earlier in
[2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md](2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md)
("Device check (2026-10-09 iOS bank form …)"); filed on its own here.

## Observed (measured)

### 1. The `screen-changed` reason, with no screen change

Each time the text landed in the field (checked by `ui_snapshot` / screenshot):

```
06:02:16 type_text { selector: 'text:"Value*"', text: "12.5" }
         → Typed 4 characters into text:"Value*" — NOT verified: the field could not be found again (the screen changed while typing)
           + ⚠ role text, input at 42,296 194x20
06:02:20 type_text { selector: 'role:textfield value:"12.5"', text: "7.25", clear: true }
         → Typed 4 characters into role:textfield value:"12.5" (cleared 4 characters first) — NOT verified: … (the screen changed while typing)
06:02:26 (blurred) value:"7,25" + clear + "1000"   → same sentence
06:04:15 (WDA) value:"3.10" + clear + "4.20"       → same sentence (10.5 s)
```

Mechanism (raw `idb ui describe-all`): every field that holds text shows a clear button, `Button 'icon-cross-circle'`, and
all of them share the form-wide id `TextFieldWithComponentStyle`. In the four calls the amount was the only filled field:
the clear removed the last `button:TextFieldWithComponentStyle`, typing brought it back, and the pre/post signature differed.
With the IBAN also filled (its own clear button keeps the pair in the set), the very same calls returned `Filled …` verified.

### 2. A clear alone is never verified on this form

```
06:03:20 → Cleared role:textfield value:"DE89370400440532013000" (22 deletes sent) — NOT verified: the field could not be found again (the selector no longer matches it)
06:03:41 → Cleared role:textfield value~"000,00" (4 deletes sent) — NOT verified: …
```

Both fields were empty afterwards. The emptied field's rect moves because the floating label drops back into it (IBAN
`42,402 280x20` → `42,357 318x20`; amount from empty `42,289 232x20` → `42,296 194x20` once a value is in), so the identity
fallback finds no twin. The `value:` selector cannot match an empty field, so nothing can.

## Why (read from the source)

`src/interact/fill.ts#screenSignature` (l. 285–296) is the set of `role:identifier` pairs of every identified node. The
read-back (l. 380–390) refuses the identity fallback when that set changed since typing started, and records
`lostOnLastRead = 'screen-changed'`, rendered at l. 214 as `(the screen changed while typing)`. A node that appears or
disappears as a direct effect of the field gaining or losing text (an accessory of the field itself) changes the set
exactly like a new screen would. The fallback's `sameField` (role, id, rect) needs an unchanged rect, which a floating-label
field does not keep across empty ↔ filled.

## Why it matters

- Refusing is the safe direction, but the sentence sends the reader to look for a navigation that did not happen. Per-field
  clear buttons are a common text-field pattern (`UITextField.clearButtonMode`, design-system fields).
- Whether a fill verifies depends on whether ANOTHER field holds text: the same call is `Filled` or `NOT verified` depending
  on unrelated form state. That is hard to reason about in a flow.
- A clear alone (`clear: true`, empty text) is unverifiable on any floating-label field, so a flow cannot assert a reset by fill.

## Possible fix directions (owner's choice)

- Leave out of `screenSignature` the nodes inside, or overlapping, the matched field's container, or nodes sharing an id
  with a sibling of the field (a repeated id is an accessory, not a screen).
- Compare multisets of pairs only when a pair appears that was never seen on this screen before typing (a clear button that
  was present on another field is not new).
- For the clear alone: allow `sameField` to match by role + identifier + x/width-overlap when the field's id is unique on
  the screen, so a rect that only moved vertically within its container still matches.
- If refused anyway, name it more exactly: `(an identified node appeared or disappeared while typing: button:TextFieldWithComponentStyle)`.

## Repro

1. iOS, a SwiftUI form whose text fields show a clear button with a shared accessibility id once they hold text, and a
   floating label (mp-native SWIFT form: Account Detail → PAY → SWIFT).
2. With every other field empty: `type_text { selector: 'role:textfield value:"12.5"', text: "7.25", clear: true }` →
   `NOT verified … (the screen changed while typing)`, though `7.25` is in the field.
3. Fill the IBAN, repeat step 2 → `Filled … (4 characters, cleared 4 characters first)`.
4. `type_text { selector: 'role:textfield value:"<iban>"', text: "", clear: true }` → `Cleared … (22 deletes sent) — NOT verified`.


## Device check (2026-10-13 iOS, re-run at 20307d2)

Measured 2026-10-13 17:10–17:37 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless, the only booted simulator), averi = mobile-verify `arch/round-12` @ `20307d2` (`dist/`, stdio via the HTTP daemon on port
47883, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`); scratch configs in `run12-ios`: `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy), plus `keyboardDismiss` variants `cfg-wda-title.yaml` (`tap: {id: swift_payment.form.title}`),
`cfg-wda-payee.yaml` (`label: "Payee’s name"`), `cfg-wda-iban.yaml` (`label: "IBAN*"`), `cfg-wda-iban-title.yaml` (IBAN*, then the
title), `cfg-wda-contacts.yaml` (`text: "New Contact"`). `idb` PATH shim logging every `idb ui tap|swipe|text|key` (`idb-calls.log`;
PIN-pad lines 7–10 and 34–37 are the two `login_pin_ios_here` runs, not quoted). Positions set by hand with slow `idb ui swipe …
--duration 2.5` drags at x 380 (`manual.log`). The software keyboard was raised by setting `com.apple.keyboard.preferences`
`AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching mp-native (17:18:37); both restored to 1 at
17:36:59. mp-native logged in twice by the owner-approved `login_pin_ios_here` (17:12:19 after Account Detail showed "That's an
error" on every reload; 17:18:49 after the prefs relaunch), never the `login` rung. WDA started by averi on the first `cfg-wda` call
(17:13:44, port 8100) and stopped at 17:37 (xcodebuild killed, port 8100 closed). Local web pages `www/a.html` (link to B) and
`www/b.html` (60 links) served on 127.0.0.1:47891, stopped 17:33:05. Note: the SWIFT form's layout differs from round 8 (at rest
`priority_select 24,681` — clear of CONTINUE — not `24,771`), so the "`priority_select` under CONTINUE" shape was rebuilt with
`payee_country_select` dragged to `24,775`; the handoff's status-band shape `24,-20` was reached by `priority_select` itself.

**F1 capture (round 10) — reproduced, cause measured: the field's own clear button.** idb, SWIFT form, no keyboard (prefs at 1),
`Payee’s name` = `Jan Novak` (filled 17:16:20), `Payee’s street` focused. 17:16:34 `type_text { selector: 'value:"Jan Novak"', text:
"Petr Svoboda", clear: true }` → `Typed 12 characters into value:"Jan Novak" (cleared 9 characters first) — NOT verified: the field
could not be found again (the screen changed while typing)` (3.5 s; l.26 focus `182 423`, l.27 nine `42`, l.28 nine `76`, l.29 `text
Petr Svoboda`). `idb ui describe-all` polled every ~0.35 s through the call (`F1poll/*.json`, 60 reads) plus `F1-before.json` /
`F1-after.json`:
- `171634-82` (before): 38 nodes, 14 distinct identified `type:id` pairs, `Button 'icon-cross-circle' TextFieldWithComponentStyle
  340,406 20x20`, field value `Jan Novak`.
- `171636-311` and `171636-858` (after the clear, before the text): 37 nodes, 13 pairs — the only missing pair is
  `Button:TextFieldWithComponentStyle` (the clear button vanishes with the field emptied; it is the only Button with that id on the form);
  no value.
- `171637-373` on (after typing): 38 nodes, 14 pairs, the clear button back, value `Petr Svoboda`.
Before and after are identical apart from the value; the set changes only inside the fill, between the clear and the retype — exactly
this note's mechanism, now caught live with no keyboard on screen.
