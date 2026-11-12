import { PRINTABLE_ASCII, refusalOf, type Typeable } from './typeable.js';

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
 * What WebDriverAgent's `/wda/keys` types, on top of idb's set: the classes batch-10's gate measured exact (iOS 27.0,
 * iPhone 17 simulator, WDA 16.1.7; form-basic's name field and the RN lab's rn-field), each a Basic Multilingual Plane
 * character:
 * - a letter (`\p{L}`) of the Latin, Greek, Cyrillic or Han script (measured: Šťastný, Žluťoučký kůň, Ångström Øre,
 *   Καλημέρα, Ωμέγα, Ђорђе, Привет мир, 東京, 北京市朝阳区);
 * - a number, punctuation mark or symbol of the Common script (measured: ’ “ ” ‘ – — … € § © ® ™);
 * - NBSP (U+00A0) and the narrow NBSP (U+202F), the two spaces measured beside U+0020.
 * The rest of each class is inferred from its measured members, not measured itself (½ and the other numbers, arrows,
 * box drawing, ∑ ✓ ★, …): ADR 0037's D43 amendment, residual 2.
 * Taken out of it again: an emoji (`\p{Extended_Pictographic}`, measured 1/1 — too thin), except © ® ™, which the
 * gate typed exact; the Halfwidth and Fullwidth Forms (U+FF00–U+FFEF), Latin and Common by script, and the Specials
 * (U+FFF0–U+FFFF: U+FFFC, U+FFFD), Common by script — neither measured. Everything else is refused: outside the BMP, a
 * combining mark (`\p{M}`: a decomposed value's normalisation is not judged), a format character (`\p{Cf}`), private
 * use, unassigned, any other space, a Common letter (µ), and every script not measured (Arabic, Hebrew, Devanagari,
 * Thai, Hangul, kana, …). BMP-only also keeps every count and tail slice of a fill exact in UTF-16 (fill-landing.ts,
 * fill-type.ts).
 */
const WDA_ONLY = [
  '(?![\\p{Extended_Pictographic}\\uFF00-\\uFFFF])(?=[\\u0000-\\uFFFF])(?:',
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
 * The remedy names the WDA tree source only for a value WDA_TYPEABLE takes whole (`widerPath`); for any other (one
 * holding an emoji, or © followed by U+FE0F) there is no path on iOS, and it says so, naming the first character WDA
 * refuses too (`blockedBy`, typeable.ts#refusalOf) — the one to leave out, which may not be the one idb refused first.
 */
export const IDB_TYPEABLE: Typeable = {
  refuses: IDB_REFUSES,
  says: "on iOS averi types only printable ASCII (U+0020–U+007E): `idb ui text` has no key for any other character and fails the whole call",
  otherPath: `A project with \`ios.treeSource: wda\` types it through WebDriverAgent (ADR 0037); otherwise ${BY_HAND}`,
  widerPath: {
    refuses: WDA_REFUSES,
    blockedBy: (char) => `averi has no typing path on iOS for this value (WebDriverAgent's \`/wda/keys\` is not measured for ${char}; ADR 0037): ${BY_HAND}`,
  },
};

/**
 * idb's refusal of `text` (IDB_TYPEABLE, refusalOf) — for a text only WebDriverAgent types that reached a typer after
 * `treeSource: auto` fell back to idb (A41a: adapters/auto-tree-source.ts, IosAdapter.typeText's backstop). Built here
 * once; the fallback wording is for a text idb types, which no caller sends.
 */
export const idbTypingRefusal = (text: string): string =>
  refusalOf(text, IDB_TYPEABLE) ?? `cannot type it: ${IDB_TYPEABLE.says}`;

/** What an IosAdapter over a source that types (IosTreeSource.typeText: WDA's) types — the module doc. */
export const WDA_TYPEABLE: Typeable = {
  refuses: WDA_REFUSES,
  says:
    'on iOS with WebDriverAgent averi types printable ASCII, and through `/wda/keys` the letters of the Latin, Greek, ' +
    'Cyrillic and Han scripts, common punctuation, symbols and numbers, NBSP and U+202F of the Basic Multilingual Plane; ' +
    'an emoji, a combining mark, a format character or any other character is not measured through `/wda/keys`',
  otherPath: 'Use a value without it, or enter it by hand.',
};

/** Which path types `text`: idb for every text idb can type (the empty one too), WebDriverAgent for any other. */
export type TypingPath = 'idb' | 'wda';

export function typingPathOf(text: string): TypingPath {
  return IDB_REFUSES.test(text) ? 'wda' : 'idb';
}
