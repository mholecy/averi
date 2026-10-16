# BUG: on Android `type_text` types the text up to its first non-ASCII character, then fails with adb's Java stack trace — the field is left holding a prefix

Lab note F2A2. **Measured 2026-10-16** on the dedicated `averi_lab` AVD (`emulator-5554`, Android 13 / API 33,
1080x2220, Gboard), averi = mobile-verify `truth/r3-forms-android` on `arch/round-20`'s `src/` (`debc9b2`), through
`scripts/truth/live.ts --serial emulator-5554` (createAveriServer over a real AdapterRegistry, the registry's own
AndroidAdapter), the lab app's `form-basic` cell (fixtures/apps/android/…/Forms.kt, phase 2b). Found by the live
golden; the app's own model of the field (its state file) is the oracle. The iOS counterpart is
`2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md` — there idb refuses before sending anything.

## Observed (measured)

```
type_text { selector: 'id:"lab.form-basic.name"', text: 'Jan Šťastný' }
→ ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š'
  Exception occurred while executing 'text':
  java.lang.NullPointerException: Attempt to get length of null array
  	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318)
  	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) …
app model: name = "Jan "

type_text { selector: 'id:"lab.form-basic.name"', text: 'O’Brien “Jr.” – Co…' }
→ ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’'  … NullPointerException …
app model: name = "O"
```

The run's summary is committed: docs/truth/live-android-2026-10-16.md (both cases LOUD, "field CHANGED (was \"\")").
Every ASCII case of the same run held its value (`Jan Novak`, the e-mail, the IBAN with spaces, `1234.56`, the PIN,
the prefilled cells' clear and no-clear fills: 18 of 20 cases ok).

## Why it matters

A payee's name with a diacritic (`Šťastný`), a typographic apostrophe (`O’Brien`) — a banking form's daily input. The
reply is a raw adb/Java trace with no sentence of averi's own, and it comes AFTER averi has typed the characters before
it: the field is left half-filled (`Jan `), a state the caller did not ask for and the reply does not mention. The
fill contract (docs/verification.md: "a no-clear fill never destroys existing content (it fails loudly instead)") is
kept in letter — the prefix is new content, not lost content — but a later step reading the field, or a retry without
`clear`, sees `Jan ` + its own text.

## Cause (src/adapters/android.ts#typeText; not changed here)

`typeText` sends one `input text <ch>` per character (the bulk-injection race, verification.md). Android's `input text`
maps each character through the virtual keyboard's KeyCharacterMap; a character it has no key events for (`Š`, `ť`,
`’`, `“`, `–`, `…`) yields a null event array, and InputShellCommand.sendText throws. `CONTROL_CHAR_RE` (input-text.ts)
refuses only C0 controls and DEL up front; nothing checks the rest before the first character is sent.

## Expected

Either refused before any device call, as the control characters are (type-text.ts / input-text.ts: name the first
character `input text` cannot type and say nothing was typed), or typed by another route (e.g. a clipboard paste or an
IME broadcast) — the round's to choose. At the least, never a half-typed field with a Java trace for its reason.

## Notes

- Live only (a replayed tree cannot judge typing): `scripts/truth/live.ts` cases `b1d` and `b7` on Android, LOUD (averi
  said it failed; the app holds a prefix). Not a golden row, so no KNOWN entry.
