<!-- The live golden on Android (phase 2b), as scripts/truth/live.ts printed it, 2026-10-16: averi_lab AVD
(emulator-5554, Android 13 / API 33, 1080x2220, gesture navigation, docked Gboard), the Android lab app at
truth/r3-forms-android, src = arch/round-20's (debc9b2). Reproduce (adb outside the sandbox):
  node --import tsx scripts/truth/live.ts --serial emulator-5554 [--shots <dir>]
k5's tap landed on note's 14-px strip below Continue ([55,2126][1025,2140] in the dump after back), in the bar's
padding: the model's focus on note, no submit. LOUD b1d/b7:
docs/bugs/2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii.md (F2A2). -->

# Live golden: 20 cases, 18 ok, 2 loud, 0 mismatches, 0 skipped

## uiautomator
- ok k1 form-keyboard: a tap under the keyboard, no dismissal configured: refused, the focus stays (Android: hidden with back, then tapped — the focus on vs) — Tapped id:"lab.form-keyboard.vs" (the soft keyboard covered id:"lab.form-keyboard.vs"; hidden before tapping)
- ok k4 form-keyboard: a tap on the submit pinned above the keyboard fires it — Tapped id:"lab.form-keyboard.submit"
- ok k3 form-keyboard: a fill under the keyboard with a dismissal (Android: none configured — back hides it) — Filled id:"lab.form-keyboard.note" (11 characters) (the soft keyboard covered id:"lab.form-keyboard.note"; hidden before tapping)
- ok k5 form-keyboard: a tap on note, under the IME and, once back hid it, under the bar dropped to the bottom: never a submit — Tapped id:"lab.form-keyboard.note" (the soft keyboard covered id:"lab.form-keyboard.note"; hidden before tapping)
- ok b1 form-basic: fill, no clear, a name — Filled id:"lab.form-basic.name" (9 characters)
- LOUD b1d form-basic: fill, no clear, a name with diacritics — the app holds "Jan ", not "Jan Šťastný" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text 'Š' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShe
- ok b2 form-basic: type_text without a selector types into the focused field — Typed 6 characters
- ok b3 form-basic: fill, clear, an e-mail — Filled id:"lab.form-basic.email" (23 characters)
- ok b4 form-basic: fill, clear, an IBAN with spaces — Filled id:"lab.form-basic.iban" (29 characters)
- ok b5 form-basic: fill the amount (decimal pad) — Filled id:"lab.form-basic.amount" (7 characters)
- ok b6 form-basic: fill the secure PIN (number pad) — Filled id:"lab.form-basic.pin" (4 characters)
- LOUD b7 form-basic: fill typographic text (’ “ ” – …) — the app holds "O", not "O’Brien “Jr.” – Co…" — field CHANGED (was ""); averi: ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’'
    type_text → ERROR Command failed (exit 255): adb -s emulator-5554 shell input text '’' ⏎ Exception occurred while executing 'text': ⏎ java.lang.NullPointerException: Attempt to get length of null array ⏎ 	at com.android.server.input.InputShellCommand.sendText(InputShellCommand.java:318) ⏎ 	at com.android.server.input.InputShellCommand.runText(InputShellCommand.java:290) ⏎ 	at com.android.server.input.InputShe
- ok p1 form-prefilled: a no-clear fill keeps the prefill — Filled id:"lab.form-prefilled.name" (4 characters)
- ok p2 form-prefilled: a clear fill replaces the prefill — Filled id:"lab.form-prefilled.iban" (29 characters, cleared 29 characters first)
- ok p3 form-prefilled: a clear alone empties the field — Filled id:"lab.form-prefilled.email" (0 characters, cleared 23 characters first)
- ok p4 form-prefilled: a clear fill over a prefill with an NBSP — Filled id:"lab.form-prefilled.amount" (5 characters, cleared 8 characters first)
- ok p5 form-prefilled: a no-clear fill on the prefilled secure PIN keeps it — or averi says it did not — Filled id:"lab.form-prefilled.pin" (1 character)
- ok p6 form-prefilled: a clear fill on the prefilled secure PIN — Filled id:"lab.form-prefilled.pin" (4 characters, cleared 4 characters first)
- ok e1a form-errors: fixing a field drops its error, and its message (Android sets no error: asserted as text) goes from the tree — name: message gone; email: message still read
- ok c1 form-picker: scroll_until a row far down the lazy list, tap it: the value is written back — Element id:"lab.form-picker.country.ST" fully visible after 3 swipes; still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match

