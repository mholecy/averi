/**
 * What Android's `input text` does with a control character — `input`'s
 * vocabulary, which adb-shell.ts leaves to its command (its header, "what a
 * COMMAND does with its argument"). One leaf, read by the two refusals that
 * word it: interact/type-text.ts (the user-facing one, before any device
 * call) and android.ts's defensive assert in typeText (code review of round
 * 7: the sentence was written out in both) — and, with it, what to do
 * instead (`controlCharRemedy`, code review of round 7 P2), which both end
 * with. A leaf rather than android.ts
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

/**
 * What to do instead of typing a refused character — the remedy sentence
 * both refusals end with. `pressKey('enter')` is named for a newline and a
 * return only (code review of round 7, P2: a refused U+0007, a tab or an
 * ESC was told to "send the key deliberately — pressKey('enter')", a key
 * that is not theirs and submits the form); a tab is told there is no tab
 * key (`press_key` knows none); any other has no key at all.
 */
export function controlCharRemedy(ch: string): string {
  if (ch === '\n' || ch === '\r') return "Type the text without it and send the key deliberately — pressKey('enter') (the `press_key` tool, `key: enter`).";
  if (ch === '\t') return 'Type the text without it; there is no tab key, so a tab cannot be typed.';
  return 'Type the text without it; there is no key for it, so it cannot be typed.';
}
