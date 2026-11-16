import { CONTROL_CHAR_RE, controlCharRemedy, inputTextControlFate } from '../adapters/input-text.js';
import { codePoint, refusalOf, type Typeable } from '../adapters/typeable.js';
import type { DeviceAdapter } from '../adapters/types.js';
import { errorMessage } from '../util/error-message.js';
import { withNoteLine } from '../util/note-line.js';

/**
 * Which text averi types, stated ONCE, where text is accepted — and checked
 * before anything is sent to the device.
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
 * Why here and not in the adapter: an adapter's check runs AFTER a fill's
 * focus tap and its clear — a refused value wipes the field and then fails
 * (the device check, row 4b, saw the type_text tool's selector tap go out
 * before such a refusal) — and a check in one adapter lets a value pass on
 * one platform leg and fail on the other. `fillField` refuses before it
 * resolves the field (no keyboard dismissal, no tap, no clear), and a free
 * value typed into whatever is focused goes through `typeIntoFocused`;
 * `type_pin`'s digits, ASCII 0–9 only, are typeable everywhere and skip it.
 * The Android adapter keeps a defensive assert of its own for a caller that
 * bypasses interact/.
 *
 * Then what the adapter can type (D43a, docs/adr/0037-a-value-the-adapter-
 * cannot-type-is-refused-before-any-device-call.md): a character outside
 * its `typeable` set (DeviceAdapter.typeable — printable ASCII on Android
 * and on iOS's idb; on iOS over WDA's tree source also the letters,
 * punctuation and symbols `/wda/keys` types, D43) is refused here too,
 * before any device call. Unrefused, iOS's `idb ui text` fails the whole
 * call with a Python trace AFTER the fill's tap and clear, and Android's
 * `input text` types every character before it and then crashes, the field
 * half-typed. The control check comes first: a control character is a key
 * on every platform, and its remedy (`pressKey`) is its own. An ASCII value
 * pays one regex test more — no device call, no wait.
 *
 * The error names the character by code point, never the value around it:
 * values may be credentials.
 */
/** The short escapes a reader knows on sight; every other refused character is shown as `\uXXXX`. */
const SHORT_ESCAPES: Readonly<Record<string, string>> = { '\n': '\\n', '\t': '\\t', '\r': '\\r' };

/**
 * A refused character as a visible, quoted escape — never the raw character.
 * Not `JSON.stringify`: it escapes C0 but not DEL, so a DEL refusal would
 * print `("", …)` with an invisible U+007F inside the quotes.
 */
function visibleEscape(ch: string): string {
  return `"${SHORT_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`}"`;
}

/** Throws when `value` holds a character typing cannot deliver as text, or one `typeable` refuses (see the module doc). */
export function assertTypeable(value: string, typeable: Typeable): void {
  const match = value.match(CONTROL_CHAR_RE);
  if (match === null) {
    const refusal = refusalOf(value, typeable);
    if (refusal !== undefined) throw new Error(refusal);
    return;
  }
  const ch = match[0];
  const code = codePoint(ch);
  throw new Error(
    `cannot type ${code} (${visibleEscape(ch)}, a control character): it is a key, not text — on Android ` +
      `\`input text\` ${inputTextControlFate(ch)}, on iOS ` +
      `idb types it as a key press. Refused on both platforms before anything was sent. ${controlCharRemedy(ch)}`,
  );
}

/**
 * `assertTypeable` against the adapter's set, its refusal carrying the adapter's claim note line (DeviceAdapter.
 * claimNote, util/note-line.ts) when it has one: after iOS `treeSource: auto` fell back to idb, a value only
 * WebDriverAgent types is refused by idb's set, and the line says why that set applies (A41a). Without a note, the
 * refusal as it was.
 */
export function assertTypeableOn(adapter: DeviceAdapter, value: string): void {
  try {
    assertTypeable(value, adapter.typeable);
  } catch (e) {
    if (adapter.claimNote === undefined) throw e;
    throw new Error(withNoteLine(errorMessage(e), adapter.claimNote), { cause: e });
  }
}

/** Type into whatever is focused, after `assertTypeableOn` — the one path for a caller that has no field to fill. */
export async function typeIntoFocused(adapter: DeviceAdapter, value: string): Promise<void> {
  assertTypeableOn(adapter, value);
  await adapter.typeText(value);
}
