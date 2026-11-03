import { PRINTABLE_ASCII, type Typeable } from './typeable.js';

/**
 * What iOS types, and through which path (D43, docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-
 * device-call.md, the D43 amendment). Pure: no device, no adapter. IosAdapter declares one of the two sets
 * (`typeable`) by its tree source and routes each `typeText` call by `typingPathOf`.
 *
 * - **idb** (`idb ui text`, every project): printable ASCII and `\n`, unchanged since D43a.
 * - **WebDriverAgent** (`POST /session/:id/wda/keys`, a project with `ios.treeSource: wda` only): what idb cannot type
 *   of the set below. idb keeps every text it can type, byte for byte — WDA costs ~300 ms + ~16 ms a character where
 *   idb is flat at ~200 ms (batch-10's G3), so only the text idb refuses pays it.
 */

/** One character `idb ui text` cannot type (IDB_TYPEABLE). */
const IDB_REFUSES = new RegExp(`[^${PRINTABLE_ASCII}\\n]`, 'u');

/**
 * What WebDriverAgent's `/wda/keys` types, on top of idb's set — every class measured exact by batch-10's gate (iOS 27.0,
 * iPhone 17 simulator, WDA 16.1.7; form-basic's name field and the RN lab's rn-field), each a Basic Multilingual Plane
 * character:
 * - a letter (`\p{L}`) of the Latin, Greek, Cyrillic or Han script (Šťastný, Ångström, Łódź, Καλημέρα, Ђорђе, 東京);
 * - a number, punctuation mark or symbol of the Common script (’ “ ” – — … € § ½);
 * - NBSP (U+00A0) and the narrow NBSP (U+202F), the two spaces measured beside U+0020.
 * Taken out of it again: an emoji (`\p{Extended_Pictographic}`, measured 1/1 — too thin), except © ® ™, which the
 * gate typed exact; and the Halfwidth and Fullwidth Forms (U+FF00–U+FFEF), Latin and Common by script but not
 * measured. Everything else is refused: outside the BMP, a combining mark (`\p{M}`: a decomposed value's normalisation
 * is not judged), a format character (`\p{Cf}`), private use, unassigned, any other space, and every script not
 * measured (Arabic, Hebrew, Devanagari, Thai, Hangul, kana, …). BMP-only also keeps every count and tail slice of a
 * fill exact in UTF-16 (fill-landing.ts, fill-type.ts).
 */
const WDA_ONLY = [
  '(?![\\p{Extended_Pictographic}\\uFF00-\\uFFEF])(?=[\\u0000-\\uFFFF])(?:',
  '(?=\\p{L})[\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{Script=Han}]',
  '|(?=\\p{Script=Common})[\\p{N}\\p{P}\\p{S}]',
  '|[\\u00A0\\u202F]',
  ')|[\\u00A9\\u00AE\\u2122]',
].join('');

/** One character neither idb nor `/wda/keys` types — whole (`u`: a pair outside the BMP is one), no state (no `g`). */
const WDA_REFUSES = new RegExp(`(?![${PRINTABLE_ASCII}\\n]|${WDA_ONLY})[\\s\\S]`, 'u');

const BY_HAND = 'use a value without it, or enter it by hand.';

/**
 * What `idb ui text` can type (types.ts#DeviceAdapter.typeable, ADR 0037): printable ASCII and `\n`. idb maps the whole
 * string through its KEY_MAP before it sends anything (fb-idb idb/common/hid.py), and KEY_MAP holds exactly U+0020–U+007E
 * and `\n` (the Return key): any other character fails the whole call — exit 1, a Python trace, nothing typed
 * (docs/bugs/2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md). The `\n` is idb's fact, kept here; interact/
 * refuses it before this set is asked, as a control character (type-text.ts — the Return key is `pressKey('enter')`).
 *
 * The remedy names the WDA tree source only for a character WDA_TYPEABLE takes (`widerPath`); for any other (an emoji)
 * there is no path on iOS, and it says so.
 */
export const IDB_TYPEABLE: Typeable = {
  refuses: IDB_REFUSES,
  says: "on iOS averi types only printable ASCII (U+0020–U+007E): `idb ui text` has no key for any other character and fails the whole call",
  otherPath: `averi has no typing path for it on iOS (WebDriverAgent's \`/wda/keys\` is not measured for it; ADR 0037): ${BY_HAND}`,
  widerPath: {
    refuses: WDA_REFUSES,
    otherPath: `A project with \`ios.treeSource: wda\` types it through WebDriverAgent (ADR 0037); otherwise ${BY_HAND}`,
  },
};

/** What an IosAdapter over a source that types (IosTreeSource.typeText: WDA's) types — the module doc. */
export const WDA_TYPEABLE: Typeable = {
  refuses: WDA_REFUSES,
  says:
    'on iOS with WebDriverAgent averi types printable ASCII, and through `/wda/keys` the letters of the Latin, Greek, ' +
    'Cyrillic and Han scripts, common punctuation, symbols and numbers, NBSP and U+202F of the Basic Multilingual Plane; ' +
    'an emoji, a combining mark, a format character, another space or another script is not measured through `/wda/keys`',
  otherPath: 'Use a value without it, or enter it by hand.',
};

/** Which path types `text`: idb for every text idb can type (the empty one too), WebDriverAgent for any other. */
export type TypingPath = 'idb' | 'wda';

export function typingPathOf(text: string): TypingPath {
  return IDB_REFUSES.test(text) ? 'wda' : 'idb';
}
