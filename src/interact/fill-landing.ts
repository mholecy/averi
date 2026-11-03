/**
 * Did the fill land? — the one module that judges a field's reading against what it should hold (A2, 2026-11-01).
 * Until then that was judged in four modules by three rules of the earlier text, and D28 and D29 were both bugs of
 * the typing and the verdict judging the same reading differently. Three questions, one answer each:
 * - `landingOf`: did this reading land — exactly, reformatted, or only as the field's placeholder — or is it a masked
 *   reading that proves the field was wrongly said plain? Without clear, the value must be in what was typed past the
 *   earlier text, unless the reading is the value itself (D64; a reading unchanged since typing began holds none, D63).
 * - `tailOf` (and `droppedTail`): is it a strict prefix of what the field should hold — the tail a field dropped?
 * - `differenceOf`: what can be said of a reading that missed, without content?
 * interact/fill-type.ts asks the first two as it types, polls and retypes; it asks the third once, for a typing that
 * missed, and fill.ts throws what comes back. fill.ts asks one more (`needsHeldCount`): whether the field can hold
 * bullets the masked rule must count from — its post-focus re-read's gate. Pure: no device, no wait, no sentence. Its
 * imports are the facts (fill-facts.ts), the character rules of a reformatting field (fill-reformat.ts), the mask
 * characters and the input role.
 */

import { INPUT_ROLE, type UiNode } from '../adapters/types.js';
import { hasBullet, isMaskedValue } from '../ui-tree/masked-value.js';
import { heldText, type Difference, type Reformat } from './fill-facts.js';
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
   * fill.ts skipped the post-focus re-read (`needsHeldCount`; docs/adr/0028-a-fill-re-reads-after-focus-only-where-
   * focus-can-change-the-count.md), the field being said plain, so what it held is unknown and only the typed length
   * passes a masked reading (`landingOf`'s `said-plain`).
   */
  held: number | 'unread';
}

/** What the text rules ask of an Expectation: the value, and the earlier text it is typed after. */
type TextExpectation = Pick<Expectation, 'value' | 'clear' | 'before' | 'placeholder'>;

/**
 * A reading that landed:
 * - `landed`: it shows the value — exactly, or `reformatted` (the field added separators of its own: `reformatOf`);
 * - `placeholder`: it is exactly the field's named placeholder, which is the value too — typed, or an empty field
 *   with the typing dropped; the tree cannot tell (review of the read-back, probe B). Not verified;
 * - `said-plain`: the held count is `'unread'` and the reading is masked, longer than typed — the field its source said
 *   is plain shows bullets after all, and no length of it proves anything but the typed one (two dropped keys under
 *   five autofilled bullets would pass `held + typed` with a `held` of 0). Final: the poll stops on it, as on a landed
 *   reading, and the fill fails `masked-said-plain` (`differenceOf`). A SHORTER masked reading has not landed and the
 *   poll goes on — its keys may still arrive; the timing of both is as it was when fill.ts overrode a landed reading.
 */
export type Landing = { kind: 'landed'; reformatted?: Reformat } | { kind: 'placeholder' } | { kind: 'said-plain' };

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
 * shorter one has not landed), else `placeholder` when it is exactly the named placeholder. Pure.
 */
export function landingOf(observed: string, e: Expectation): Landing | undefined {
  if (!tookText(observed, e)) return undefined;
  const reformatted = landedReformat(observed, e);
  if (reformatted === undefined && !showsExactly(observed, e)) return undefined;
  if (bulletsSaidPlain(observed, e) && observed.length !== e.value.length) return { kind: 'said-plain' };
  if (e.placeholder !== undefined && observed === e.placeholder) return { kind: 'placeholder' };
  return { kind: 'landed', ...(reformatted !== undefined && { reformatted }) };
}

/**
 * A non-input proves it took the text only by CHANGING to show it: a WDA StaticText exposes its label as its value,
 * and "Meno".includes("e") is no fill; a label that changes on focus (`Name` → `Name*`) is no fill either, and the
 * clear's wipe and retype would delete ITS length into the focused field (review 2026-10-08, rounds 1 and 2). An
 * input-like node of another role (an iOS search field reads `other`) shows the typed text, so it still gets the
 * retry. Masked values cannot show it: for them the change alone is the proof, as their length is for inputs. A
 * reformatted reading (the value split by separators) never contains the value, so a non-input never lands one.
 */
export const tookText = (observed: string, e: Pick<Expectation, 'value' | 'isInput' | 'resolvedValue'>): boolean =>
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
 * after `5`). D63 at its limit: a reading still
 * the earlier text holds nothing past it (`unchanged`, a field that refused the keys or never got them). The value
 * itself is excepted: a reading that is both the earlier text and the value cannot be told from a select-all field
 * that retyped it, or a placeholder equal to it — it still lands (ADR 0034's D63 amendment, residual 7). The limit, on
 * the safe side: the caret at the start, with a typing that re-forms the earlier text (`aba` for `ab` after `a`), is
 * refused (ADR 0034's D64 amendment).
 */
function showsExactly(observed: string, e: Expectation): boolean {
  const { value, clear } = e;
  if (isMaskedValue(observed)) return clear ? observed.length === value.length : observed.length >= heldCount(e) + value.length;
  if (clear) return observed === value;
  const held = heldText(observed, e.placeholder);
  return observed === value || priorsOf(held, e).some((prior) => typedPartOf(held, prior).includes(value));
}

/** The bullets the field held after focus, an unread count as none. */
const heldCount = (e: Pick<Expectation, 'held'>): number => (e.held === 'unread' ? 0 : e.held);

/**
 * A masked reading of a field whose held count was never read (`'unread'`: said plain, the re-read skipped) — no length
 * of it but the typed one proves anything. `landingOf`'s `said-plain` and `differenceOf`'s `masked-said-plain`.
 */
const bulletsSaidPlain = (observed: string, e: Pick<Expectation, 'held'>): boolean => e.held === 'unread' && isMaskedValue(observed);

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
export interface Tail {
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
 * definition of a dropped tail: the typing retypes it (`droppedTail`) and the verdict names it (`differenceOf`), so the
 * two judge a prefix alike. Pure.
 */
export function tailOf(observed: string, e: TextExpectation): Tail | undefined {
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
 * The characters the field dropped from the END of the typing (`tailOf`, with some of the typing landed: `landedSome`),
 * or undefined when its reading does not prove that. What fill-type.ts types again (ADR 0023). Pure.
 */
export function droppedTail(observed: string, e: TextExpectation): string | undefined {
  const tail = tailOf(observed, e);
  return landedSome(tail) ? tail.missing : undefined;
}

/**
 * What can be said of a reading that missed the value — ONE classification of the kinds (fill-facts.ts#Difference),
 * first match wins (2026-10-09, the fill-clear deepening; until then fill.ts chose `unchanged`, `masked` and the partly
 * masked `length` in a ternary at the throw, and a helper of its own the rest):
 * 0. `masked-said-plain`: a masked reading where the held count is `'unread'` (`landingOf`'s `said-plain`; one of the
 *    typed length lands, so it never gets here). Before `unchanged`: no reading of a field whose count was never
 *    read says more than that (A2, 2026-11-01; until then fill.ts built this Difference itself).
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
 * Pure, O(observed × value) — run once, for a typing that missed: a PRECONDITION, not checked — a reading that lands
 * (`landingOf`) is never classified, and one `reformatOf` passes (`1 234` for `1234`) would read `separated` here.
 */
export function differenceOf(observed: string, e: Pick<Expectation, keyof TextExpectation | 'held'>): Difference {
  const { value, clear } = e;
  if (bulletsSaidPlain(observed, e)) return { kind: 'masked-said-plain' };
  if (observed === e.before) return { kind: 'unchanged' };
  if (isMaskedValue(observed)) return { kind: 'masked', held: clear ? undefined : heldCount(e) };
  if (hasBullet(observed)) return { kind: 'length' };
  // D28: a reformatted strict prefix with some of the typing in it is a dropped tail, never "transformed".
  const tail = tailOf(observed, e);
  if (landedSome(tail) && tail.reformatted !== undefined) {
    return { kind: 'dropped-tail', landed: tail.landed, dropped: value.length - tail.landed, grouped: tail.reformatted.added > 0 };
  }
  const held = heldText(observed, e.placeholder);
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
  if (typed.length !== value.length) return { kind: 'length' };
  let differ = 0;
  for (let i = 0; i < value.length; i++) if (typed[i] !== value[i]) differ++;
  return { kind: 'same-length', positions: differ };
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
