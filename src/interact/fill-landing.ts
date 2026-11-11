/**
 * Did the fill land? — the one module that judges a field's reading against what it should hold (A2, 2026-11-01).
 * Until then that was judged in four modules by three rules of the earlier text, and D28 and D29 were both bugs of
 * the typing and the verdict judging the same reading differently. One reading, one answer (A9, 2026-11-05: until then
 * fill-type.ts asked five questions of one reading, in an order it had to know):
 * - `readingOf`: the whole answer, for any reading — a landing, or a miss (`not-taken` or `missed`) with what can be
 *   said of it (`NotLanded`): the tail it proves dropped and whether that may be typed again, and the difference,
 *   without content.
 * - `landingOf`: the poll's question, all it needs of up to five readings a round — is this one final? Exactly,
 *   reformatted, only as the field's placeholder, or a masked reading that proves the field was wrongly said plain.
 *   Without clear, the value must be in what was typed past the earlier text, unless the reading is the value itself
 *   and the earlier text or the named placeholder too (D64, D71; a reading unchanged since typing began holds none,
 *   D63). A landing carries how it was reformatted, or that text around the value went unread with the re-read skipped
 *   (`focusUnread`, D64b-3).
 * - `withoutWholeToo`: a difference without its whole-landing hedge, for keys proven typed elsewhere.
 * interact/fill-type.ts polls on the second and goes by the first, and fill.ts throws the difference that comes back.
 * fill.ts asks two more, of the field before its typing, not of a reading — what the masked rule counts from (A28,
 * finishing A2): `postFocusReadOf`, the one read after the focus tap as a table (ADR 0028's gate a row of it, asking
 * `needsHeldCount`: whether the field can hold bullets), and `heldCountOf`, the count that read gives the typing
 * (Expectation.held) and the masked-append warning. Pure: no device, no wait, no sentence. Its imports are the
 * facts (fill-facts.ts), the character rules of a reformatting field (fill-reformat.ts), the mask characters and the
 * input role.
 */

import { INPUT_ROLE, type UiNode } from '../adapters/types.js';
import { hasBullet, isMaskedValue } from '../ui-tree/masked-value.js';
import { heldText, type Difference, type EqualCount, type FocusUnread, type Reformat } from './fill-facts.js';
import { maskTemplate, prefixOf, reformatOf, separatedOf, skeleton } from './fill-reformat.js';

/** What the field should hold after the typing, and what the reading is judged against. */
export interface Expectation {
  /** The value typed; non-empty (an empty fill types nothing and reads nothing back). */
  value: string;
  /** The field was cleared first: it must EQUAL the value. Without, it must show the value after its earlier text. */
  clear: boolean;
  /** What the field showed when typing began (null: nothing) — the text the typing appends to. */
  before: string | null;
  /** The field's named placeholder (UiNode.placeholder): shown while empty, never content (fill-facts.ts#heldText). */
  placeholder: string | undefined;
  /** The matched node is an input (INPUT_ROLE); otherwise it proves it took the text only by changing to show it. */
  isInput: boolean;
  /** The matched node's value when it was resolved, before the focus tap — what a non-input shows of itself. */
  resolvedValue: string | null;
  /**
   * The bullets a masked field held after focus — a masked reading must show these plus the typed length. `'unread'`:
   * fill.ts skipped the post-focus re-read (`postFocusReadOf`; docs/adr/0028-a-fill-re-reads-after-focus-only-where-
   * focus-can-change-the-count.md), the field being said plain, so what it held is unknown and only the typed length
   * passes a masked reading (`landingOf`'s `said-plain`), and what the field holds besides the typing is unknown too:
   * a plain reading that is not exactly the value lands saying so (`Landing`'s `focusUnread`, D64b-3).
   */
  held: number | 'unread';
}

/** What the text rules ask of an Expectation: the value, and the earlier text it is typed after. */
type TextExpectation = Pick<Expectation, 'value' | 'clear' | 'before' | 'placeholder'>;

/**
 * A reading that landed:
 * - `landed`: it shows the value — exactly, or `reformatted` (the field added separators of its own: `reformatOf`);
 *   `focusUnread` (D64b-3, ADR 0028's D64b-3 amendment): the post-focus re-read was skipped and the reading holds the
 *   value among other text, which may not all come from these keys (`textAroundUnread`). Never with `reformatted`: such
 *   a reading holds the typed characters and separators alone, and says so already;
 * - `placeholder`: it is exactly the field's named placeholder, which is the value too — typed, or an empty field
 *   with the typing dropped; the tree cannot tell (review of the read-back, probe B). Not verified;
 * - `said-plain`: the held count is `'unread'` and the reading is masked, longer than typed — the field its source said
 *   is plain shows bullets after all, and no length of it proves anything but the typed one (two dropped keys under
 *   five autofilled bullets would pass `held + typed` with a `held` of 0). Final: the poll stops on it, as on a landed
 *   reading, but no landing: the fill fails with `differs`. A SHORTER masked reading has not landed and the poll goes
 *   on — its keys may still arrive; the timing of both is as it was when fill.ts overrode a landed reading.
 */
export type Landing = { kind: 'landed'; reformatted?: Reformat; focusUnread?: FocusUnread } | { kind: 'placeholder' } | { kind: 'said-plain'; differs: { kind: 'masked-said-plain' } };

/**
 * What can be said of a reading that did not land. The two are orthogonal: `Jan` for a typed `Jan Novak` after `Jan`,
 * with clear, is `unchanged` and has a tail to type again; a tail the typing's own gates refuse (the bounds, a reading
 * still moving) still needs its difference.
 */
export interface NotLanded {
  /**
   * The reading is a strict prefix of what the field should hold (`tailOf`): `missing` the rest, what `whereTyped`
   * compares a sibling's gain with. `retypable`: it proves that much dropped, some of the typing there and no whole
   * landing as well (`wholeLandingToo`) — what fill-type.ts may type again, behind its own gates (ADR 0023).
   */
  tail?: { missing: string; retypable: boolean };
  /** What differs, without content (`differenceOf`). */
  differs: Difference;
}

/**
 * The one answer about one reading: a `Landing`, or a miss — `not-taken` when a non-input never took the text
 * (`tookText`), else `missed`. `not-taken` carries a `NotLanded` too: only the first reading of a typing ends on it,
 * and after a retry fill-type.ts goes on from it.
 */
export type Reading = Landing | ({ kind: 'not-taken' } & NotLanded) | ({ kind: 'missed' } & NotLanded);

/**
 * Whether a reading landed, and how; undefined when it did not. The rules:
 * - a non-input proves it took the text only by CHANGING to show it (`tookText`);
 * - a field that reformats as it is typed (D18) lands when it shows what it should hold — its earlier text, unless
 *   cleared, then the value — every typed character in order, separators of its own added (`landedReformat`);
 * - else the reading must show the value exactly (`showsExactly`): with clear the whole reading, without it inside what
 *   was typed past the earlier text (D64); a masked reading by length.
 * D63's rule — without clear, a reading still exactly what the field showed when typing began has not landed, unless it
 * is the value itself — is D64's at its limit: such a reading starts with the earlier text and holds nothing past it.
 * No reading tells the two apart for any Expectation fill.ts builds, through the reformat route either (a reformat
 * needs the whole of the earlier text plus the value), so it is no separate guard.
 * A landed reading is `said-plain` when it shows bullets said plain (`bulletsSaidPlain`) and is longer than typed (a
 * shorter one has not landed), else `placeholder` when it is exactly the named placeholder, else `landed`, carrying
 * how it was reformatted, or that text around the value went unread (`textAroundUnread`). Pure.
 */
export function landingOf(observed: string, e: Expectation): Landing | undefined {
  if (!tookText(observed, e)) return undefined;
  const reformatted = landedReformat(observed, e);
  if (reformatted === undefined && !showsExactly(observed, e)) return undefined;
  if (bulletsSaidPlain(observed, e) && observed.length !== e.value.length) return { kind: 'said-plain', differs: { kind: 'masked-said-plain' } };
  if (e.placeholder !== undefined && observed === e.placeholder) return { kind: 'placeholder' };
  if (reformatted !== undefined) return { kind: 'landed', reformatted };
  return textAroundUnread(observed, e) ? { kind: 'landed', focusUnread: { shows: observed.length } } : { kind: 'landed' };
}

/** The whole answer about any reading (`Reading`). Pure, O(observed × value): `landingOf` is the poll's. */
export function readingOf(observed: string, e: Expectation): Reading {
  const landing = landingOf(observed, e);
  if (landing !== undefined) return landing;
  return { kind: tookText(observed, e) ? 'missed' : 'not-taken', ...notLandedOf(observed, e) };
}

/** What can be said of a reading that did not land (`NotLanded`); whether it is a whole landing too is asked here. */
function notLandedOf(observed: string, e: Expectation): NotLanded {
  const tail = tailOf(observed, e);
  const held = heldText(observed, e.placeholder);
  const heldWhole = wholeLandingToo(held, e); // the raw fact: what keeps a tail from being typed again
  // The hedge is of a reading that took the text: a `not-taken` is never marked (D71 review round 1, n1). D71: the
  // value itself, refused by `showsExactly`, is a whole landing too though no tail of the typing is proven (`-5` after
  // `-`, `1 ` after `1`). `held`, not `observed`: the same here, as a reading that is the named placeholder and the
  // value landed (`showsExactly` compares `observed` with the raw `before` and placeholder, residual 7).
  const wholeToo = tookText(observed, e) && (landedSome(tail) || held === e.value) && heldWhole;
  return {
    ...(tail !== undefined && { tail: { missing: tail.missing, retypable: landedSome(tail) && !heldWhole } }),
    differs: differenceOf(observed, e, tail, wholeToo),
  };
}

/**
 * The Difference without its whole-landing hedge (`wholeToo`): keys proven typed elsewhere are no select-all, so a
 * reply that says where they went must not say that too (fill-type.ts's `elsewhere`). Any other as it was. Pure.
 */
export function withoutWholeToo(d: Difference): Difference {
  if (d.kind !== 'dropped-tail' && d.kind !== 'length') return d;
  const { wholeToo: _hedge, ...rest } = d;
  return rest;
}

/**
 * A non-input proves it took the text only by CHANGING to show it: a WDA StaticText exposes its label as its value,
 * and "Meno".includes("e") is no fill; a label that changes on focus (`Name` → `Name*`) is no fill either, and the
 * clear's wipe and retype would delete ITS length into the focused field (review 2026-10-08, rounds 1 and 2). An
 * input-like node of another role (an iOS search field reads `other`) shows the typed text, so it still gets the
 * retry. Masked values cannot show it: for them the change alone is the proof, as their length is for inputs. A
 * reformatted reading (the value split by separators) never contains the value, so a non-input never lands one.
 */
const tookText = (observed: string, e: Pick<Expectation, 'value' | 'isInput' | 'resolvedValue'>): boolean =>
  e.isInput || (observed !== e.resolvedValue && (isMaskedValue(observed) || observed.includes(e.value)));

/**
 * The reading shows the value as typed.
 *
 * A masked (secure) field shows one bullet per character to uiautomator and WDA alike, so its content can never EQUAL
 * the value — measured 2026-09-17 (finportal login): `typed 16 characters but the field shows 16` on both platforms,
 * for a fill that had landed. Its LENGTH still says whether every keystroke arrived, which is the check that matters on
 * a loaded emulator (dropped characters there surfaced as a backend `invalid_grant`), so a bullets-only reading is
 * compared by count, never by content. The rule detects the SHORT direction only — dropped keystrokes; without `clear`
 * the field must show at least what it held after focus plus what was typed. It cannot tell a correct append from
 * typing onto an autofilled password (both read `held + typed`); that case is fill.ts's `maskedAppend`, not a failure.
 * A held count `'unread'` counts as none (`heldCount`); `landingOf` fails any length but the typed one there.
 *
 * A placeholder is not content: on an empty field showing `Search`, nothing typed must not pass for a typed `ear`. Raw
 * equality first: a value equal to the placeholder is the one reading that cannot be told from it (`landingOf`'s
 * `placeholder`; fill-facts.ts#heldText).
 *
 * D64: without clear, the value must be in what was typed past the earlier text (`typedPartOf`, `differenceOf`'s own
 * notion of the typing), not anywhere in the reading. The whole reading was searched until then, so one that moved but
 * held none of the typing passed whenever the earlier text held the value: a length cap (the lab's date `31.12.202`
 * typed `12` keeps `31.12.2021`), an iOS React Native burst that kept a prefix (`Note: hellohe`), keys that went into
 * another input. Such a reading is now a dropped tail — typed again on iOS — or a miss that names where the keys went.
 * A reading that no longer starts with the earlier text literally is judged whole, as before: an earlier text that
 * vanished (D29), was replaced (select-all), autocorrected, or a caret not at the end. The earlier texts are
 * `priorsOf`'s, as for a reformat (review round 1, M-1): a reading whose letters and digits are exactly the value's and
 * no start of the earlier text's plus the value's is judged as the value alone too (D61) — a field that adds a leading
 * `+` under idb's unnamed `+421` (`+421903123456`), a select-all field that adds a mark (`SK31 ` after `SK3`, `50%`
 * after `5`). D63's rule is this one at its limit (`landingOf`). The value itself is excepted only where it is the
 * earlier text or the named placeholder too: such a reading cannot be told from a select-all field that retyped it, or
 * a placeholder equal to it — it still lands (ADR 0034's D63 amendment, residual 7). D71: any other reading equal to
 * the value is judged as every reading is. Until then it landed however it was reached, so `55` typed after `5` with
 * the second key dropped replied Filled where an append should have left `555` (`1212` after `12` too). A select-all
 * reading whose earlier text is not in it still lands, as the value alone (`priorsOf`); refused are the readings whose
 * letters and digits repeat the earlier text's (`55`/`5`, `1212`/`12`, `1 `/`1`) or whose earlier text has none
 * (`-5`/`-`), a length that is a whole landing too (`notLandedOf`): nothing typed again, the reply naming `clear:
 * true`. Left open: `12` after `1` (the head key dropped) lands as D61's value alone, which idb's unnamed placeholders
 * need (ADR 0034's D71 amendment, residual 11). The limit, on the safe side: a caret not at the end whose typing leaves
 * the reading starting with the earlier text (`aba` for `ab` after `a`) is refused (ADR 0034's D64 amendment, residual
 * 9).
 */
function showsExactly(observed: string, e: Expectation): boolean {
  const { value, clear } = e;
  if (isMaskedValue(observed)) return clear ? observed.length === value.length : observed.length >= heldCount(e) + value.length;
  if (clear) return observed === value;
  const held = heldText(observed, e.placeholder);
  return (observed === value && (observed === e.before || observed === e.placeholder)) || priorsOf(held, e).some((prior) => typedPartOf(held, prior).includes(value));
}

/** The bullets the field held after focus, an unread count as none. */
const heldCount = (e: Pick<Expectation, 'held'>): number => (e.held === 'unread' ? 0 : e.held);

/**
 * A masked reading of a field whose held count was never read (`'unread'`: said plain, the re-read skipped) — no length
 * of it but the typed one proves anything. `landingOf`'s `said-plain` and `differenceOf`'s `masked-said-plain`.
 */
const bulletsSaidPlain = (observed: string, e: Pick<Expectation, 'held'>): boolean => e.held === 'unread' && isMaskedValue(observed);

/**
 * A plain reading that holds the value among other text, in a field whose text after focus was never read (`'unread'`,
 * the re-read skipped): `before` is the pre-tap `''`, so the whole reading was taken for the typing, and what a field
 * inserted on focus cannot be told from it (`+421 ` for a typed `421`, no key landed: ADR 0028's residual 3). Asked of
 * a reading that landed and is no reformat. A masked one is no such reading: it landed by the typed length, and has no
 * text beside the value to speak of (`said-plain` takes every other length).
 */
const textAroundUnread = (observed: string, e: Pick<Expectation, 'value' | 'held'>): boolean => e.held === 'unread' && observed !== e.value && !isMaskedValue(observed);

/** The text the typing lands after: the field's text before the typing (its placeholder aside), or none once cleared. */
const priorText = (e: Pick<Expectation, 'clear' | 'before' | 'placeholder'>): string => (e.clear ? '' : heldText(e.before, e.placeholder));

/**
 * The texts a reading (`held`, its named placeholder aside) is judged after: the earlier text (`priorText`) — and,
 * without clear, when the reading's letters and digits do not START with the earlier text's (`skeleton`), no earlier
 * text as well, tried second: the earlier text VANISHED. Letters and digits, not the text as typed: a field that
 * regroups as it is typed shows an earlier `1,000` as `10,00…` once typed into, and that text is still there (D29
 * review round 1, MAJOR-1) — judged as the value alone, `10,001,000` would pass for a typed `10001000`.
 *
 * D29, measured on the owner's iOS run (SwiftUI lab, form-format's iban, f1 and f7): idb names no placeholder
 * (adapters/types.ts, UiNode.placeholder), so the UIKit field's placeholder `SK00 0000 0000 …` was read as the empty
 * field's value — `before` — and was gone at the first key; judged after it, the field holding `SK31 1200 0000` failed
 * "typed 12 characters but the field shows 14", and a dropped tail there was never typed again (D28). The fallback
 * reaches every source that names no placeholder — idb, and the API 33 uiautomator dump (a classic EditText's hint
 * dumped as its `text`; the Android lab's Compose fields dump no placeholder at all, so the lab is not affected) — and,
 * on both platforms, a field that REPLACES its earlier text on focus (a select-all): the reading cannot tell that from
 * an unnamed placeholder, and both are judged as the value alone.
 *
 * What it adds: a reading whose letters and digits do not start with the earlier text's may pass, or be retyped, as
 * the value alone, under `reformatOf`'s and `prefixOf`'s rules unchanged. A reading that starts with them is judged
 * after the earlier text, never without it. An earlier text with no letters or digits (a `—`, a `-`) keeps the
 * pre-D29 judgment — every reading starts with its empty skeleton — failing safe, as a false mismatch and never a
 * wrong pass: deliberately not loosened (D29 review round 2, MINOR-A).
 *
 * D61: an unnamed placeholder whose letters and digits START the typed value's (idb's `+421`, `421903123456` typed)
 * starts the reading too. No earlier text is tried as well, second, when the reading's letters and digits are EXACTLY
 * the value's and are no start of the earlier text's plus the value's: the reading holds no more than the value, so the
 * earlier text is not in it, and it is no earlier text with a dropped tail of the typing either. `421 903 123 456` after
 * `+421` then lands; a regrouped earlier text still there (`10,001,000` after `1,000`: a start of `1,000` +
 * `10001000`) does not. Equality, not a prefix: a dropped tail under such a placeholder is not typed again — ADR 0034's
 * D61 amendment and residual 6.
 *
 * A MASK TEMPLATE (`maskTemplate`: `_` and separators alone, at least one `_` — `__.__.____`) is tried as no earlier
 * text as well, second, whatever the reading — why, and how it narrows MINOR-A: ADR 0034's D51 amendment.
 *
 * The earlier text is tried FIRST: a reading that is a prefix of the earlier text itself (`SK` of `SK00 …`) is then
 * that earlier text's prefix, nothing of the typing landed, and nothing is typed again; tried second, the same reading
 * would read as two typed characters and retype the rest. Pure.
 */
function priorsOf(held: string, e: Pick<Expectation, 'value' | 'clear' | 'before' | 'placeholder'>): readonly string[] {
  const prior = priorText(e);
  const shown = skeleton(held);
  const notShown = !shown.startsWith(skeleton(prior)); // D29: the earlier text is not in the reading
  const valueAlone = shown === skeleton(e.value) && !skeleton(prior + e.value).startsWith(shown); // D61: the value exactly, no start of the earlier text plus the value
  const vanished = notShown || valueAlone;
  return prior !== '' && (maskTemplate(prior) || vanished) ? [prior, ''] : [prior];
}

/**
 * The first defined `judge(whole, prior)` over `priorsOf(held, e)` — the earlier text first, then none where it
 * vanished (D29) or is a mask template (D51) — `whole` what the field should hold after that earlier text (`prior +
 * value`): how `landedReformat`, `tailOf` and `differenceOf`'s `separated` rule judge a reading alike. Pure.
 */
function overPriors<T>(held: string, e: TextExpectation, judge: (whole: string, prior: string) => T | undefined): T | undefined {
  for (const prior of priorsOf(held, e)) {
    const judged = judge(prior + e.value, prior);
    if (judged !== undefined) return judged;
  }
  return undefined;
}

/**
 * The reading `reformatOf` what the field should hold — its earlier text, unless cleared (or vanished: `priorsOf`,
 * D29), then the value — else undefined. D18, docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md.
 * A masked reading never is one (bullets are no typed characters). Pure.
 */
function landedReformat(observed: string, e: TextExpectation): Reformat | undefined {
  const held = heldText(observed, e.placeholder);
  return overPriors(held, e, (whole) => reformatOf(held, whole));
}

/**
 * A reading that is a strict prefix of what the field should hold (`tailOf`): `missing` the rest, `landed` how many
 * characters of the TYPING the prefix holds (UTF-16 units, as a value's length is counted — 0 when only the field's
 * earlier text is there), `reformatted` when the field reformatted the prefix (separators added, spaces respaced).
 */
interface Tail {
  missing: string;
  landed: number;
  reformatted?: Reformat;
}

/** Some of the typing is in the prefix: a tail the field dropped, not a typing that never reached it. */
const landedSome = (tail: Tail | undefined): tail is Tail => tail !== undefined && tail.landed > 0;

/**
 * What the field is missing of what it should hold (its text before the typing, unless cleared — or vanished, then
 * none: `priorsOf`, D29 — then the value), when its reading is a strict prefix of that — exactly or reformatted
 * (`prefixOf`, D28; ending in an eager trailing mark too, D60) — and shows no bullet: a `Tail`, else undefined. The one
 * definition of a dropped tail: the typing retypes it (`NotLanded.tail`) and the verdict names it (`differenceOf`), so
 * the two judge a prefix alike. Pure.
 */
function tailOf(observed: string, e: TextExpectation): Tail | undefined {
  const held = heldText(observed, e.placeholder);
  if (hasBullet(held) || hasBullet(priorText(e))) return undefined; // the earlier text, `priorsOf`'s first
  return overPriors(held, e, (whole, prior): Tail | undefined => {
    const shown = prefixOf(held, whole);
    if (shown === undefined) return undefined;
    const { prefix, reformatted } = shown;
    return { missing: whole.slice(prefix.length), landed: prefix.length - prior.length, ...(reformatted !== undefined && { reformatted }) };
  });
}

/**
 * D64 review round 1, m-2: a held reading that has not landed but is explained as a whole landing as well as a dropped
 * tail — its "tail" is not typed again. Typed again, it could leave the field holding content the retype made wrong
 * and the fill end Filled over it (until D64 such readings passed by containment, over the right content). So nothing
 * is typed again and the fill fails — the safe side. Two shapes:
 * - the value at an occurrence that ends past the earlier text, not wholly inside it: `11 ` for `11` after `1` (a
 *   select-all field's `11` with an eager trailing mark, or `1` landed with the mark and `1` dropped — typed again,
 *   `111`); `a1 1` for `1 ` after `a1` (the typing at a caret inside the text);
 * - the value, decorated, and no other letter or digit — `skeleton` equal — though inside the earlier text's span: the
 *   value typed again over itself (residual 7's shape) into a select-all field that adds a mark (`-5-` for `-5` after
 *   `-5`).
 * A value found only inside the earlier text among more of it (`Note: hellohe` for `hello` after `Note: hello`, f16's
 * `31.12.2021`) is no whole landing, and its tail is typed again. `differenceOf` marks every such miss `wholeToo` — a
 * `dropped-tail` where the field grouped the prefix (`11 `, `a1 1`), a `length` where it is exact (`-5-`, `xaa` for
 * `aa` after `xa`) — and its reply names the select-all reading and `clear: true`. Brute-forced (D64 review round 1)
 * over small alphabets: no reading that a select-all field, a caret anywhere in the earlier text, or a leading or
 * trailing mark makes of a whole landing is typed into again.
 */
function wholeLandingToo(held: string, e: TextExpectation): boolean {
  // The first index an occurrence of the value can start at and still end past the earlier text; a negative start is
  // read from 0 by indexOf.
  const firstEndPastPrior = priorText(e).length - e.value.length + 1;
  return held.indexOf(e.value, firstEndPastPrior) !== -1 || (held.includes(e.value) && skeleton(held) === skeleton(e.value));
}

/**
 * What can be said of a reading that missed the value — the classification of the kinds (fill-facts.ts#Difference),
 * first match wins (2026-10-09, the fill-clear deepening; until then fill.ts chose `unchanged`, `masked` and the partly
 * masked `length` in a ternary at the throw, and a helper of its own the rest):
 * 0. `masked-said-plain`: a masked reading that did not land where the held count is `'unread'` (`landingOf`'s
 *    `said-plain`, a longer one without clear, carries this Difference itself and never gets here; one of the typed
 *    length lands). Before `unchanged`: no reading of a field whose count was never read says more than that
 *    (A2, 2026-11-01; until then fill.ts built this Difference itself).
 * 1. `unchanged`: the reading is exactly what the field showed when typing began — whatever it is, bullets included
 *    (probes D and D2 were told "the app transformed the input").
 * 2. `masked`: bullets only, compared by length; `held` without clear.
 * 3. `length` of a PARTLY masked reading (Android's show-the-last-character password field, `•••••t`): its content is
 *    not comparable either (hasBullet: • and ● only — `*` and `·` are ordinary text too).
 * 4. `dropped-tail` (D28): the held text is a strict prefix of what the field should hold, grouped by the field
 *    (`tailOf`), with some of the typing in it — the tail dropped.
 * 5. `separated` (D53): the held text is what the field should hold (`overPriors`, as `landedReformat` and `tailOf`
 *    judge it) with separators alone added (`separatedOf`) — ones the grouping rules refused, since the reading did
 *    not land. Disjoint from `dropped-tail` (all of the typing shown, not a strict prefix) and never `same-length` (it
 *    is longer): it re-words what read `length` — and the contrived `case` whose one case-matching run is of the
 *    earlier text (`x,ABa-b` after `xAB`, `ab` typed), where the typing is all there.
 * 6. Otherwise the HELD text is compared (a named placeholder is no text): with clear the field must EQUAL the value,
 *    so the two are compared whole; without, it must CONTAIN it, so every run of the new text (`typedPartOf`) as long
 *    as the value is compared and the closest one counts — `case` when one differs only in letter case, else
 *    `same-length` when the lengths match, else `length`. Only position-for-position: an inserted or dropped character
 *    is a length difference. Letter case by toLowerCase/toUpperCase of each UTF-16 unit — enough for the measured
 *    auto-capitalisation; a case pair whose forms differ in length (`ß`/`SS`) reads as a plain difference, never as a
 *    pass.
 * `tail` and `wholeToo` are `notLandedOf`'s, asked once for the two answers of a `NotLanded`. Only `readingOf` asks, of
 * a reading that did not land: one `reformatOf` passes (`1 234` for `1234`) would read `separated` here. Pure, O(observed ×
 * value).
 */
function differenceOf(observed: string, e: Pick<Expectation, keyof TextExpectation | 'held'>, tail: Tail | undefined, wholeToo: boolean): Difference {
  const { value, clear } = e;
  // D79: the field's count is the typed one — a `length` then says why that is no match (`EqualCount`)
  const showsTypedCount = observed.length === value.length;
  if (bulletsSaidPlain(observed, e)) return { kind: 'masked-said-plain' };
  if (observed === e.before) return { kind: 'unchanged' };
  if (isMaskedValue(observed)) return { kind: 'masked', held: clear ? undefined : heldCount(e) };
  if (hasBullet(observed)) return showsTypedCount ? { kind: 'length', equal: { why: 'partly-masked' } } : { kind: 'length' };
  const held = heldText(observed, e.placeholder);
  // D28: a reformatted strict prefix with some of the typing in it is a dropped tail, never "transformed".
  if (landedSome(tail) && tail.reformatted !== undefined) {
    const dropped = { kind: 'dropped-tail', landed: tail.landed, dropped: value.length - tail.landed, grouped: tail.reformatted.added > 0 } as const;
    return wholeToo ? { ...dropped, wholeToo: true } : dropped; // D64: said in the reply's wording
  }
  // D53: every typed character there, in order, with separators the rules refused as grouping — never "a length".
  const added = overPriors(held, e, (whole) => separatedOf(held, whole));
  if (added !== undefined) return { kind: 'separated', added };
  const typed = typedPartOf(held, priorText(e));
  let caseOnly: number | undefined; // fewest case-only differing characters over the runs compared
  const starts = clear ? (typed.length === value.length ? [0] : []) : Array.from({ length: Math.max(0, typed.length - value.length + 1) }, (_, i) => i);
  for (const at of starts) {
    let differ = 0;
    let caseAlone = true;
    for (let i = 0; i < value.length && caseAlone; i++) {
      const a = typed[at + i];
      const b = value[i];
      if (a === b) continue;
      differ++;
      caseAlone = a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase();
    }
    if (caseAlone && differ > 0 && (caseOnly === undefined || differ < caseOnly)) caseOnly = differ;
  }
  if (caseOnly !== undefined) return { kind: 'case', positions: caseOnly };
  // an exact strict prefix ends here: its typed part is shorter than the value, so no run is compared
  if (typed.length !== value.length) {
    const d: Difference = wholeToo ? { kind: 'length', wholeToo: true } : { kind: 'length' };
    return showsTypedCount ? { ...d, equal: equalCountOf(held, typed, wholeToo, e) } : d;
  }
  let differ = 0;
  for (let i = 0; i < value.length; i++) if (typed[i] !== value[i]) differ++;
  return { kind: 'same-length', positions: differ };
}

/**
 * Why a `length` of the typed count is no match (D79, fill-facts.ts#EqualCount), of a held reading, its typing
 * (`typedPartOf`) and `differenceOf`'s `wholeToo`: the value itself refused as a whole landing too (D71's refusal; a
 * non-input's own text equal to the value is no such refusal, and reads padded), exactly the named placeholder
 * (nothing held), else padded by the earlier text. Pure.
 */
function equalCountOf(held: string, typed: string, wholeToo: boolean, e: Pick<Expectation, keyof TextExpectation>): EqualCount {
  if (wholeToo && held === e.value) return { why: 'value-itself', appendWouldShow: priorText(e).length + e.value.length };
  if (held === '') return { why: 'placeholder' };
  return { why: 'padded', typedPart: typed.length };
}

/**
 * The typing in a held reading — what `differenceOf` compares, and where `showsExactly` looks for the value without
 * clear (D64): what came AFTER the earlier text (`prior`), when the reading still starts with it LITERALLY (typing
 * appends at the cursor, which the focus tap leaves at the end), else the whole reading — the limit: a run of the old
 * text can then be named as the "transformed" typing.
 *
 * Deliberately not `priorsOf`'s letters-and-digits rule: a skeleton match cannot be sliced back to reading positions
 * (an earlier `1,000` that a regrouping field shows, with `5678` typed, as `10,005,678` starts with `1000` by its
 * letters and digits, but no slice of the reading is the typing), and an earlier text that vanished (D29) is compared
 * whole here as it is there. No input was found where the two rules give another Difference, and a Difference never
 * changes pass or fail — it words the failure. The landing and the wording judge one typing: a reading passes only on
 * the part of it that a miss would name.
 */
function typedPartOf(shown: string, prior: string): string {
  return prior !== '' && shown.startsWith(prior) ? shown.slice(prior.length) : shown;
}

/**
 * Whether the masked rule needs to know what the field held after focus — the post-focus re-read's question
 * (docs/adr/0028-a-fill-re-reads-after-focus-only-where-focus-can-change-the-count.md). Not for an EMPTY input its
 * source says is plain (UiNode.secure `false`; a named placeholder is empty, fill-facts.ts#heldText): it shows its
 * text, not bullets, so the reading compares content, which needs no count — and one that shows bullets after all
 * fails `said-plain` (`landingOf`). Everything else may hold bullets, or gain them on focus (an autofill). Pure.
 */
export const needsHeldCount = (f: Pick<UiNode, 'role' | 'secure' | 'value' | 'placeholder'>): boolean =>
  !(f.role === INPUT_ROLE && f.secure === false && heldText(f.value, f.placeholder) === '');


/** What fill.ts knows before its focus tap that decides the one read after it (`postFocusReadOf`). */
export interface FocusFacts {
  /** The value to type; `''`: none (a focus alone, or a clear alone). */
  value: string;
  clear: boolean;
  /** The field as resolved before the tap. */
  field: Pick<UiNode, 'role' | 'secure' | 'value' | 'placeholder'>;
  /** The target is a sole `id` selector (ui-tree/selectors.ts#soleIdOf): it keeps matching while the field's text changes. */
  soleId: boolean;
  /** The adapter types a dropped tail again (fill-type.ts#retypesTail) — a proof (`whereTyped`) the read feeds. */
  retypesTail: boolean;
}

/**
 * What the masked rule counts from (`heldCountOf`): the field as read after the focus tap (`after-focus` — its bullets
 * are the masked-append warning too), the field as resolved before the tap (`before-tap`), or nothing (`unread`:
 * ADR 0028's gate skipped the read).
 */
export type HeldFrom = 'after-focus' | 'before-tap' | 'unread';

/**
 * The fill's one read after the focus tap, and the count it gives the typing (A28: one table where fill.ts had four
 * conditions):
 * - `reads`: the field is read after the tap — for the count (`after-focus`: the pre-tap read is stale for exactly
 *   these fields, an autofill populating a password field on focus, a re-entry screen clearing one), or for what a
 *   clear ALONE deletes (an autofill on focus would otherwise be kept, the one fill shape whose whole point is an empty
 *   field);
 * - `count`: what the masked rule counts from (`HeldFrom`); absent when nothing is typed — no read-back, no count.
 */
export interface PostFocusRead {
  reads: boolean;
  count?: HeldFrom;
}

/**
 * The read after the focus tap (`PostFocusRead`), as a table, first row that holds:
 * | value | clear | the field, the target, the adapter                                              | reads | count         |
 * | none  | yes   | an input                                                                        | yes   | —             |
 * | none  | —     | anything else (a focus alone; a non-input's clear sends no delete)              | no    | —             |
 * | typed | yes   | — (the read-back compares to the value, and wipes and retypes a mismatch)       | no    | `before-tap`  |
 * | typed | no    | no held count needed (`needsHeldCount`), a sole `id`, no tail retype (ADR 0028) | no    | `unread`      |
 * | typed | no    | holds nothing, or bullets alone (fill-facts.ts#heldText)                        | yes   | `after-focus` |
 * | typed | no    | plain content: an append is judged by where the value lies, never by a count   | no    | `before-tap`  |
 * The gate's reasons — what the read feeds and why none of it matters on that row — are ADR 0028's and fill.ts's. Pure.
 */
export function postFocusReadOf(f: FocusFacts): PostFocusRead {
  if (f.value === '') return { reads: f.clear && f.field.role === INPUT_ROLE };
  if (f.clear) return { reads: false, count: 'before-tap' };
  if (!needsHeldCount(f.field) && f.soleId && !f.retypesTail) return { reads: false, count: 'unread' };
  const held = heldText(f.field.value, f.field.placeholder);
  return held === '' || isMaskedValue(held) ? { reads: true, count: 'after-focus' } : { reads: false, count: 'before-tap' };
}

/**
 * What the masked rule counts from (Expectation.held), of where the count comes from (`HeldFrom`) and what the field
 * held then (`held`, fill-facts.ts#heldText: after the read, else before the tap): `'unread'` when the read was skipped;
 * else the bullets it held — and only bullets. A masked field's content reads as bullets on both platforms
 * (2026-09-17), so a plain reading before typing was not its content: an Android password EditText that dumps its hint
 * as `text` while empty (the API 33 rule measured 2026-10-09 on plain EditTexts; on a password field it is inferred, not
 * yet seen on a device). Counted as held, that hint made `typed 6 but the field shows 6 (masked field — compared by
 * length; it held 8 after focus)` of a fill that landed. The cost: a field showing its password in plain text before
 * typing (a "show password" toggle) and masked after is checked against the typed length alone. Not fixed by this: a
 * hinted password field that the source names no placeholder for reads non-empty before the tap, so it is counted
 * `before-tap` and an autofill on focus goes unseen (no masked-append warning).
 *
 * `maskedAppend`: bullets SEEN after focus (`after-focus`) — the length rule cannot see content, so a password typed
 * onto an autofilled one reads as a perfect append (finportal 2026-09-17: backend `invalid_grant`); fill.ts says so
 * where the trace is read (FillResult.maskedAppend). (A28: until then fill.ts derived both; A2 had left them there.)
 * Pure.
 */
export function heldCountOf(from: HeldFrom, held: string): { held: number | 'unread'; maskedAppend?: { held: number } } {
  if (from === 'unread') return { held: 'unread' };
  const bullets = isMaskedValue(held) ? held.length : 0;
  return from === 'after-focus' && bullets > 0 ? { held: bullets, maskedAppend: { held: bullets } } : { held: bullets };
}
