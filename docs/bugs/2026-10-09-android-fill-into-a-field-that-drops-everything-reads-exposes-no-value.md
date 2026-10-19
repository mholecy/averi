# BUG: on Android a `fill` whose text the field drops entirely reads "the matched node exposes no value" — NOT verified, never "did not land", so `optional:` and flows pass over it

> **Status (2026-10-09):** open. Found by the round-6b device check (Android) while running F-1.1, averi `fix/round-6b` @ `5e5a3d1`.
> Related: [2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md](2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md)
> (introduced `no-value`), round 6b item F (an optional fill whose value did not land fails the flow).

## Summary

An Android EditText (Compose TextField) exposes its text as the node's `text` only when it holds some; empty, it exposes none. mp-native's
SWIFT `amount_input` accepts digits only. `fill { id: swift_payment.form.amount_input, value: "abc" }` types three letters, the field drops
them all and stays empty, and the read-back sees no value — which averi reads as "this node withholds its value", not as "empty":

- MCP `type_text` (21:15:47): `Typed 3 characters into id:swift_payment.form.amount_input — NOT verified: the matched node exposes no value
  (role textfield)`.
- Flow inside `optional:` (21:15:14, scratch `cfg-fill-bank`): `⚠ fill: id:"swift_payment.form.amount_input" = abc — NOT verified: the matched
  node exposes no value (role textfield)`, the flow goes on (`done`). Round 6b's F rule (`optional step not skipped: its field is present,
  but its value did not land — …`) never fires, and outside `optional:` the step passes with a ⚠.

The same field with digits exposes them (`IBAN` → `val='AT611904300234573201'`, verified `Filled`), so on Android "no value after typing
N > 0 characters into a `textfield`" means nothing landed.

## Repro

1. mp-native Account Detail → PAY → SWIFT payment (nothing entered).
2. `type_text { platform: android, selector: "id:swift_payment.form.amount_input", text: "xyz" }` → `Typed 3 characters … NOT verified: the
   matched node exposes no value (role textfield)`; `ui_snapshot` → `amount_input lab=None val=None` (empty, as before).
3. Shim: `input tap 540 699`, `input text x`, `y`, `z`, `keyevent 21/22`.

## Where

`src/interact/fill.ts:357–401`: `observed === undefined` falls to `readBack: { kind: 'no-value' }` (line 399) whatever the role and
platform; `fill-verdict.ts:151` renders it as unverified.

## Suggestion

On Android, an EditText/`textfield` that read no value before typing and still reads none after N > 0 typed characters should be
`mismatch` with `shows: 0` (`fill: typed N characters but the field shows 0 …`) — so the F rule fails an optional fill and a plain fill
reports the drop. Keep `no-value` for roles that never carry text (a `text`/`other` label, iOS StaticText).

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**D3 / D4 — Hold.** mp-native SWIFT form.

- **D3.1:** 06:24:37 `type_text { selector: 'id:"swift_payment.form.amount_input"', text: "abc" }` (empty field) → `fill: typed 3 characters
  but the field shows 0 — the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)`
  (19.8 s; shim `input tap 540 699`, `input text a`/`b`/`c`, `keyevent 21`, `keyevent 22`). As `optional: fill` (scratch `cfg-fill-bank`
  `f1_amount_letters`, the field holding `1234.5`) → `optional step not skipped: its field is present, but its value did not land — fill:
  typed 3 characters but the field shows 6 (content withheld from this error)`, `✗ fill id:"swift_payment.form.amount_input": failed — …`,
  the flow failed before its wait.
- **D3.2:** `type_text amount_input "123"` → `Filled id:"swift_payment.form.amount_input" (3 characters)`, field `123`.
- **D4:** `type_text bic_input` with U+0007 → `cannot type U+0007 ("\u0007", a control character): it is a key, not text — … Type the text
  without it; there is no key for it, so it cannot be typed.`; with `\t` → `… there is no tab key, so a tab cannot be typed.`; with `\n` / `\r`
  → `… (a newline into ENTER | a return into ENTER, which submits the form mid-fill) … Type the text without it and send the key deliberately
  — pressKey('enter') (the press_key tool, key: enter).` All 0.0 s, no shim line.
- **R-5.1 (formatting fields) — Holds:** `amount_input "1234.5"` with `clear` → `Filled … (6 characters, cleared 3 characters first)` (the
  field reformats to `1,234.50` on blur — no warning, no "shows 0"); `iban_input "DE89 3704 0044 0532 0130 00"` → `Filled … (27
  characters)`; with `clear`, `"DE89370400440532013000"` → `Filled … (22 characters, cleared 27 characters first)`; `bic_input "abc"` →
  `Filled … (3 characters)`. An Android password field was not reached (Settings' Wi‑Fi is off, "Add network" absent; Wi‑Fi not switched on).
- Unchanged: a label-matched field (`type_text text:"First name" "Zed"` in Contacts) → `Typed 3 characters … — NOT verified: the field could
  not be found again (the selector no longer matches it)`, as round 6b.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

- **D3 on iOS — the rule's honest side holds.** Own-transfer `payment.form.amount_input` (a real textfield): `type_text "123"` → `Filled
  … (3 characters)`. With `"abc", clear` → `fill: typed 3 characters but the field shows 4 (content withheld from this error)` (the field
  takes letters; it ended `babc` after averi's retry); `"xyz", clear` → `fill: field still shows 1 character after clearing twice`;
  `"456", clear` → `Filled … (3 characters, cleared 1 character first)`. The letter handling is the app's (erratic), the replies are
  failures, never "Filled". No iOS field that drops every character was found (the 6b note's own premise: the SWIFT amount takes letters).
- **D3.3 secure field — not measured.** mp-native's password field sits behind Password login's username CONTINUE (the registration path);
  not pressed. Contacts and Settings offer none reachable.
- **D4 — Holds.** `type_text id:Company`: U+0007 → `… Type the text without it; there is no key for it, so it cannot be typed.`; tab →
  `… there is no tab key, so a tab cannot be typed.`; `\n` → `… pressKey('enter') (the `press_key` tool, `key: enter`).` Nothing sent.
- **R-5.1 formatted fields — no "shows 0" for text that landed.** IBAN with spaces by label `IBAN*` → `NOT verified: the matched node
  exposes no value (role text)` (landed as typed); WDA `fill id:swift_payment.form.payee_name_input` (a container) → `NOT verified … role
  container` (landed). A textfield picked by its value: without `clear` → `NOT verified: the field could not be found again (the selector
  no longer matches it)` (Contacts `Company` → `Acme`, landed) — the identity fallback is not asked when typing started with no read
  (`src/interact/fill.ts:172,194`); with `clear` on Contacts → `Filled …` (verified); with `clear` on the SWIFT form (`Jan Novak` → `Petr
  Svoboda`, 06:31:18) → `NOT verified: the field could not be found again (the screen changed while typing)` though only the keyboard
  could have changed — `screenSignature` (`src/interact/fill.ts:85–89`) counts every identified node, and idb's keyboard keys carry ids
  (`shift`, `delete`, `more`, `space`, `Return`, `dictation`). Suspected, not isolated (the software keyboard could not be raised again in
  Contacts without a relaunch) — recorded as an observation.

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

D3 (round 8) holds; scratch flows on the SWIFT form (`cfg-d3.yaml`).
- `fill abc` into `amount_input`, `clear: true` → `fill: typed 3 characters (after typing it once more) but the field shows 0 — the field
  did not change: the typing did not reach it, or the field refused it (content withheld from this error)`.
- Same without `clear` → `fill: typed 3 characters but the field shows 0 — …` (no retry wording).
- `optional:` + clear → `optional step not skipped: its field is present, but its value did not land — fill: typed 3 characters (after
  typing it once more) but the field shows 0 — …`; the flow fails.
- Field held `12`, then `fill abc clear` → `fill: … = 12 (cleared 2 characters first)`, then `(after typing it once more) but the field
  shows 0` (the wipe left it empty, nothing to wipe on the retry).
- A value the field keeps part of: `12.345` → `fill: typed 6 characters (after one wipe and retype) but the field shows 5 (content
  withheld from this error)`; `1a2` → `fill: typed 3 characters (after one wipe and retype) but the field shows 2 (…)`.
- Digits land: `12` → `fill: id:"swift_payment.form.amount_input" = 12`; `1234.50` → `= 1234.50` (R-5.1 formatted amount).
- R-5.1 IBAN: `DE89 3704 0044 0532 0130 00` → `= DE89 3704 0044 0532 0130 00`; `DE89370400440532013000` → `= DE89370400440532013000
  (cleared 27 characters first)`; BIC `deutdeff` → lands. Never "shows 0" for text that landed.
- D4: `type_text "a\u0007b"` → `cannot type U+0007 ("\u0007", a control character): it is a key, not text — … Refused on both platforms
  before anything was sent. Type the text without it; there is no key for it, so it cannot be typed.`; tab → `… there is no tab key, so a
  tab cannot be typed.`; `\n` → `… pressKey('enter') (the press_key tool, key: enter).` No shim line.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**D3 / D4 / F on iOS.**
- R-6.6 / D3 wording on iOS — not reachable: mp-native's iOS amount field accepts letters (`abc` landed; field `val='abc'`), so no `clear`
  mismatch occurs. WDA `type_text id:swift_payment.form.amount_input "abc" clear` (the container id) → `Typed 3 characters into
  id:swift_payment.form.amount_input — NOT verified: the matched node exposes no value (role container); clear sent no delete — a role
  container node's length is not the field's` + `⚠ … the input overlapping it is textfield id:"TextFieldWithComponentStyle" at 42,296
  232x21 — select the input itself …`.
- D4 — Holds (Contacts New Contact, `type_text id:Company`): U+0007 → `… Type the text without it; there is no key for it, so it cannot be
  typed.`; tab → `… there is no tab key, so a tab cannot be typed.`; `\n` → `… pressKey('enter') (the `press_key` tool, `key: enter`).`
  No shim line.
- F1 captures (idb, fill picking its field by VALUE):
  - Without `clear`: amount `value:"abc"` + `12` → `Typed 2 characters into value:"abc" — NOT verified: the field could not be found again
    (the selector no longer matches it)`; Contacts `value:"Zed"` + `ka` → the same. `ui_snapshot` before/after (`F1-*.json`, `F1k-*.json`):
    25/25 and 46/46 nodes, the only difference the field's value. **The keyboard is not in either tree**: idb types through the HID
    keyboard, and the first `idb ui text` of a session hides the software keyboard (and sets `HardwareKeyboardLastSeen` back to 1) —
    every read after any typing has no keys.
  - With `clear`, keyboard up before the call (Contacts card edit, `Middle name` focused, 61 nodes incl. keys) → `Filled value:"M." (2
    characters, cleared 2 characters first)` — verified although the keys left the tree during the fill (42 nodes after).
  - With `clear`, keyboard already hidden, Contacts `value:"Zedka"` → `Petr` → `Filled … (4 characters, cleared 5 characters first)`.
  - With `clear` on the SWIFT form, round 7's shape (10:17:50; `Payee’s street` focused, `Payee’s name` = `Jan Novak` → `Petr Svoboda`)
    → `Typed 12 characters into value:"Jan Novak" (cleared 9 characters first) — NOT verified: the field could not be found again (the
    screen changed while typing)` — reproduced **with no keyboard on screen**. My before/after reads (`F1s-*.json`) differ only in the
    previously focused `Payee’s street` collapsing back (its label `42,178 77x15` → `42,184 103x20`, its field `42,191` → `42,184`) and the
    value; the role:identifier set `screenSignature` (`src/interact/fill.ts:85–89`) hashes is the same in both, so the difference it saw
    is transient inside the fill (between its pre-typing read and its last read), not the keyboard's key list. Answer to F1: not the
    keys; the cause on this SwiftUI form is still open (suspect: a node with an identifier present only while the field is cleared/
    focused — e.g. the field's clear button — not captured).
- F2 / D3.3 secure field: idb does not expose a web view's fields at all (Safari, local page with `<input type=password
  aria-label="Secret field">`: idb lists only Safari's chrome; `type_text label:"Secret field"` → `Timed out after 5000ms`). WDA lists it as
  `textfield` with `value: null`; `type_text label:"Secret field" "hunter2"` → `Filled label:"Secret field" (7 characters)`; with `clear`,
  `"swordfish"` → `Filled … (9 characters, cleared 7 characters first)`; the tree then shows `"value": "•••••••••"`. A native
  `SecureTextField` under idb is still unmeasured (mp-native's is behind the Password-login CONTINUE, the registration path).
