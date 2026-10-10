/**
 * What Android's `input text` does with a control character — `input`'s
 * vocabulary, which adb-shell.ts leaves to its command (its header, "what a
 * COMMAND does with its argument"). One leaf, read by the two refusals that
 * word it: interact/type-text.ts (the user-facing one, before any device
 * call) and android.ts's defensive assert in typeText (code review of round
 * 7: the sentence was written out in both). A leaf rather than android.ts
 * itself so interact/ does not import the Android adapter for a sentence.
 */

/**
 * Every C0 control character (U+0000–U+001F) and DEL (U+007F): a key, not text.
 * Also the refusal rule on BOTH platforms — type-text.ts applies it under iOS
 * too, before any device call — which is why it is read from here.
 */
export const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * What `input text` may do with a refused character. ENTER is named for a
 * newline and a return only (round 7, 2026-10-09: a refused U+0007 was told
 * "a newline into ENTER"); any other is sent as a key event.
 */
export function inputTextControlFate(ch: string): string {
  if (ch === '\n' || ch === '\r') {
    return `may turn it into a key event (${ch === '\n' ? 'a newline' : 'a return'} into ENTER, which submits the form mid-fill)`;
  }
  return 'may send it as a key event';
}
