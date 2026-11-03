/**
 * Which characters an adapter's `typeText` can type — a per-adapter fact (`DeviceAdapter.typeable`), read by one
 * function (`refusalOf`), which finds the first character it refuses and words the refusal
 * (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md, D43a).
 *
 * A leaf, as input-text.ts is: interact/type-text.ts refuses with it before any device call, and the Android adapter's
 * `typeText` again, defensively, for a caller that bypasses interact/ — neither imports the other for it.
 *
 * Data, not a method: the flow's read hand-off wraps the adapter in a Proxy that makes every method it does not class
 * `reads` an async action (ui-tree/read-handoff.ts#watch), so a synchronous check must not be a method. A declared
 * set is a `fact` there, as `typingDelivery` is.
 */
export interface Typeable {
  /**
   * Matches one character `typeText` cannot type. `u`-flagged, so a character outside the BMP (an emoji) is matched
   * whole, never as half a surrogate pair; no `g` or `y` flag, so a match keeps no state.
   */
  readonly refuses: RegExp;
  /** What the adapter types and why nothing else, completing the refusal's "cannot type U+…: " — one clause, no full stop. */
  readonly says: string;
  /**
   * The remedy the refusal ends with, true for this adapter: whole sentences, ending with a full stop (D43). Where no
   * other typing path of averi takes the character, it says so — and what to do instead.
   */
  readonly otherPath: string;
  /**
   * Another configuration of the same platform that types part of what this one refuses (D43: an iOS project on the
   * idb tree source, whose characters WebDriverAgent's `/wda/keys` may take): `refuses` is that path's own set, and
   * `otherPath` the remedy said for a character it does NOT refuse — in place of the remedy above. Absent: no such path.
   */
  readonly widerPath?: { readonly refuses: RegExp; readonly otherPath: string };
}

/** Printable ASCII (U+0020–U+007E) as the body of a RegExp character class — what Android's `input text` and idb's `ui text` type. */
export const PRINTABLE_ASCII = '\\x20-\\x7e';

/** Every character outside printable ASCII — Android's `refuses`, and the test fake's; iOS's idb adds `\n` (adapters/ios-typing.ts). */
export const NOT_PRINTABLE_ASCII = new RegExp(`[^${PRINTABLE_ASCII}]`, 'u');

/**
 * A character's code point as a refusal names it: `U+0160`, at least four hex digits, a character outside the BMP whole
 * (`U+1F600`, not half a surrogate pair). Both refusals of interact/type-text.ts — a control character's and this
 * module's — word it so.
 */
export const codePoint = (ch: string): string => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The character as the refusal names it: its code point, and the character itself where it is visible (`U+0160 'Š'`)
 * — a letter, a digit, a punctuation mark or a symbol. A space other than U+0020 (NBSP) is said to be one: quoted, it
 * reads as a plain space. Anything else (a combining mark, a zero-width or format character) is its code point alone.
 */
function named(ch: string): string {
  if (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(ch)) return `${codePoint(ch)} '${ch}'`;
  if (/^\p{Zs}$/u.test(ch)) return `${codePoint(ch)} (a space other than U+0020)`;
  return codePoint(ch);
}

/**
 * The refusal of `text` by `typeable`, or undefined when it can type all of it. The refusal names the FIRST character it
 * cannot type (whole: a surrogate pair is one), never the value around it (a value may be a credential); says nothing
 * was sent — true at both places that throw it: before the fill's field is resolved (interact/type-text.ts) and before
 * Android's first `input text` — what the adapter types, and the remedy true for it (`otherPath`, or `widerPath`'s
 * where that path types the character).
 */
export function refusalOf(text: string, typeable: Typeable): string | undefined {
  const ch = text.match(typeable.refuses)?.[0];
  if (ch === undefined) return undefined;
  const wider = typeable.widerPath;
  const remedy = wider !== undefined && !wider.refuses.test(ch) ? wider.otherPath : typeable.otherPath;
  return `cannot type ${named(ch)}: ${typeable.says}. Refused before anything was sent — nothing tapped, cleared or typed. ${remedy}`;
}
