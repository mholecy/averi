import { CONTROL_CHAR_RE, controlCharRemedy, inputTextControlFate } from '../adapters/input-text.js';
import { firstUntypeable, untypeableRefusal, type Typeable } from '../adapters/typeable.js';
import type { DeviceAdapter } from '../adapters/types.js';

/**
 * Which text averi types, stated ONCE, where text is accepted — and checked
 * before anything is sent to the device (code review of the top-4 pass,
 * 2026-10-07).
 *
 * The rule: no C0 control character (U+0000–U+001F — newline, return, tab,
 * escape, form feed, …) and no DEL (U+007F), on either platform. A control
 * character is a KEY, not text: on Android `input text` may send it as a
 * key event (a newline or a return as ENTER, which submits a form mid-fill —
 * the reason it was refused at all, adb-shell.ts's header); on iOS idb's
 * `ui text` types through HID, where a newline is the Return key too. The
 * deliberate route for a newline or a return is `pressKey('enter')` (the
 * `press_key` tool); there is no tab key, nor one for any other control
 * character (input-text.ts#controlCharRemedy words which).
 *
 * Why here and not in the adapter. Until this review the refusal of `\n`,
 * `\r` and `\t` lived inside the Android adapter's `typeText` only, so:
 * - a fill reached it AFTER its focus tap and its clear — a refused value
 *   wiped the field and then failed, and the device check (row 4b) saw the
 *   type_text tool's selector tap go out before the refusal;
 * - iOS accepted the same characters, so one value passed on one platform
 *   leg and failed on the other;
 * - every other control character (`\v`, `\f`, `\x1b`, …) went to `input
 *   text` unrefused.
 * Now `fillField` refuses before it resolves the field (no keyboard
 * dismissal, no tap, no clear), and the two places that type into whatever
 * is focused — the type_text tool without a selector and the flow's `type:`
 * step — go through `typeIntoFocused`. This CHANGED iOS: a `\n` used to be
 * typed there (as Return); it is refused now, like on Android. The Android
 * adapter keeps a defensive assert of its own for a caller that bypasses
 * interact/.
 *
 * Then what the adapter can type (D43a, docs/adr/0037-a-value-the-adapter-
 * cannot-type-is-refused-before-any-device-call.md): a character outside its
 * `typeable` set (DeviceAdapter.typeable — printable ASCII on both platforms
 * today) is refused here too, by the same callers, before the same nothing.
 * Before it, iOS's `idb ui text` failed the whole call with a Python trace
 * AFTER the fill's tap and clear, and Android's `input text` typed every
 * character before it and then crashed, the field half-typed. The control
 * check comes first: a control character is a key on every platform, and its
 * remedy (`pressKey`) is its own. An ASCII value pays one regex test more —
 * no device call, no wait.
 *
 * The error names the character by code point, never the value around it:
 * values may be credentials.
 */
/** The short escapes a reader knows on sight; every other refused character is shown as `\uXXXX`. */
const SHORT_ESCAPES: Readonly<Record<string, string>> = { '\n': '\\n', '\t': '\\t', '\r': '\\r' };

/**
 * A refused character as a visible, quoted escape — never the raw character.
 * `JSON.stringify` was used until 2026-10-08 and escapes C0 but not DEL, so a
 * DEL refusal printed `("", …)` with an invisible U+007F inside the quotes.
 */
function visibleEscape(ch: string): string {
  return `"${SHORT_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`}"`;
}

/** Throws when `value` holds a character typing cannot deliver as text, or one `typeable` refuses (see the module doc). */
export function assertTypeable(value: string, typeable: Typeable): void {
  const match = value.match(CONTROL_CHAR_RE);
  if (match === null) {
    const untypeable = firstUntypeable(value, typeable);
    if (untypeable !== undefined) throw new Error(untypeableRefusal(untypeable, typeable));
    return;
  }
  const ch = match[0];
  const code = `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  throw new Error(
    `cannot type ${code} (${visibleEscape(ch)}, a control character): it is a key, not text — on Android ` +
      `\`input text\` ${inputTextControlFate(ch)}, on iOS ` +
      `idb types it as a key press. Refused on both platforms before anything was sent. ${controlCharRemedy(ch)}`,
  );
}

/** Type into whatever is focused, after `assertTypeable` — the one path for a caller that has no field to fill. */
export async function typeIntoFocused(adapter: DeviceAdapter, value: string): Promise<void> {
  assertTypeable(value, adapter.typeable);
  await adapter.typeText(value);
}
