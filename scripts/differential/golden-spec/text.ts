import type { Platform, SourceKind } from '../corpus.js';
import type { Call, Outcome } from '../differential.js';
import type { CellTruth, Geometry, TargetTruth } from '../../truth/schema.js';
import { navigationBandTakes, parseGeometry, type AssertElement } from '../../truth/truth.js';
import { failedClosedUnchecked, readingOf, readSomething } from '../../truth/replies.js';
import { askedUnlistedBy, bandNamed } from '../../truth/target-contract.js';
import { BUDGET_MS, classed, first, passed, passes, said, type Expectation } from './judges.js';

/**
 * The text family's rows (fixtures/apps/cells/text.json, phase 4) — asked of a text target (CatalogTarget.text) of ANY
 * family, by its truth: the app's own string, drawn as the app laid it out, read back from the tree and, by the host's
 * recognizer, from the captured screenshot (golden.ts#ocrAvailability: skipped where there is none). P5's sample
 * (docs/plans/2026-10-15-proposal-find-bugs-in-batches.md: typographic quotes and apostrophes, NBSP, dashes, an
 * ellipsis, Slovak and Czech diacritics, amounts with NBSP thousands separators, IBAN groups) are the strings.
 *
 * | truth | verb | expected | decided by |
 * |---|---|---|---|
 * | a text target open and whole (reached, drawn as its box) | `assert {element:{text}, text}` | passes: the tree carries the app's string exactly — the selector finds it by it, the text assert reads it | tools.ts assert `text` (exact, whitespace collapsed); docs/bugs/2026-10-15-android-numeric-character-references-in-uiautomator-attributes-are-not-decoded.md |
 * | the same | `assert {element:{text}, ocr:{text}}` | passes: the screenshot shows the string — read exactly, or only as the recognizer may read the app's copy (src/verify/ocr-fold.ts#readingDifference: ’ “ ” – — … read as ASCII, Latin combining marks dropped; one way, Ľ ľ ď ť read with an apostrophe, Ĺ ĺ as Í í, a grouped number's separator as nothing) | docs/bugs/2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-as-straight.md (35321b4); docs/bugs/2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md (9837ef6); docs/bugs/2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-nothing.md (cb0b7ac); ADR 0025 |
 * | its centre in the status band, under the app's chrome, or in (or overlapping) Android's navigation band where the bar takes the tap (three buttons) | `ocr` | fails closed (`rendered text unchecked`): never a PASS and never a reading, which would be of what is drawn over it | docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md (596a379); ADR 0001 |
 * | in or overlapping Android's navigation band under gesture navigation (the app's: the handle drawn over it; iOS's home-indicator band is no band, target-contract.ts#judgedContext — a string there is judged by what else lies around it) | `ocr` | passes (the text drawn whole beneath the handle, read right) or fails closed; never a FAIL on a reading — what the band leaves of the glyphs read as the element's text | docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md (e85bcdf); ADR 0009 |
 *
 * Every row names its element by the string (`text:"…"`), as a test names a label and as ownPartsRows' tap does: a text
 * target's identifier may sit on a node the tree folds into its control (own-parts' L on iOS: the button carries the
 * label, not the text's identifier). A covered target's tree text is not asked: the tree holds it whatever lies over
 * it. Edges' geometries (cut by a scroll view, off the screen) ask nothing here yet.
 */

/**
 * The open string's `ocr` judge: a PASS is right. A FAIL on a reading is classed BY that reading — `read "…", not the
 * string` — so a known one (lab notes OC1, OC2) is pinned to what the recognizer read: the reading turning empty (a
 * recognizer that died: `failed`, failing closed) or into another wrong reading changes the class and fails the ratchet.
 * Any other FAIL (failing closed, not found) is `failed`.
 */
export const ocrPasses = (o: Outcome): string | undefined => {
  if (passed(o)) return undefined;
  const read = readingOf(o.reply);
  return read === undefined ? `failed: ${first(o)}` : `read ${JSON.stringify(read)}, not the string: ${first(o)}`;
};

/** An `ocr` reply measured what lies there (a PASS, or a FAIL on a reading) rather than failing closed. */
export const measuredText = (o: Outcome) => passed(o) || readSomething(o.reply);

/** The ocr assert on `element`, asked for `text`. */
const ocrCall = (platform: Platform, element: AssertElement, text: string): Call => ({ tool: 'assert', args: { platform, asserts: [{ element, ocr: { text }, timeout: BUDGET_MS }] } });

/**
 * An ocr row that must fail closed: something is drawn over `element` (`over`: a band, the chrome, the soft keyboard —
 * golden-spec/forms.ts's under-keyboard controls) — a PASS or a reading measured that, not the element. Asked for the
 * element's own string.
 */
export function ocrFailsClosed(platform: Platform, element: AssertElement, text: string, over: string): Expectation {
  return {
    verb: 'ocr',
    says: `fails closed (${over}): never a reading of what is drawn over it`,
    call: ocrCall(platform, element, text),
    judge: (o) => (passed(o) ? said(o, 'passed on what is drawn over it') : measuredText(o) ? said(o, 'measured the layer over the target as the target') : undefined),
  };
}

export function textRows(platform: Platform, t: TargetTruth, judged: Geometry | undefined, cell: CellTruth | undefined, source?: SourceKind): Expectation[] {
  const text = t.text;
  if (text === undefined) return [];
  // Asked by its string (`text:"…"`): whether it may be missing as asked is the contract's one rule.
  const unseen = source === undefined ? undefined : askedUnlistedBy(t, source);
  const covered = (e: Expectation): Expectation => classed(unseen === undefined ? e : { ...e, absent: unseen });
  // By the geometry the target contract judges (`judged`, target-contract.ts#contractOf): iOS's home-indicator band is
  // no band — a string there is judged by what else lies around it.
  const g = judged ?? 'whole';
  if (g === 'whole') {
    if (!t.reached) return [];
    return [
      {
        verb: 'text',
        says: `passes: the tree reads ${JSON.stringify(text)}`,
        call: { tool: 'assert', args: { platform, asserts: [{ element: { text }, text, timeout: BUDGET_MS }] } },
        judge: passes,
      } satisfies Expectation,
      {
        verb: 'ocr',
        says: `passes: the screenshot shows ${JSON.stringify(text)} (read exactly, or equal under the recognizer's fold)`,
        call: ocrCall(platform, { text }, text),
        judge: ocrPasses,
      } satisfies Expectation,
    ].map(classed);
  }
  const { kind, name } = parseGeometry(g);
  if (g === 'status-band') return [covered(ocrFailsClosed(platform, { text }, text, 'the status band over it'))];
  if (kind === 'under-chrome') return [covered(ocrFailsClosed(platform, { text }, text, `${name} over it`))];
  // In the navigation band, or overlapping it (its centre clear) — Android's only: the judged geometry never names
  // iOS's home-indicator band. Who takes it is truth.ts#navigationBandTakes', by the navigation mode.
  if (bandNamed(g) === 'nav') {
    const takes = navigationBandTakes(platform, 'nav-band', cell?.navigation);
    if (takes === 'bar') return [covered(ocrFailsClosed(platform, { text }, text, 'the navigation bar over it'))];
    if (takes === 'app') {
      return [
        classed({
          verb: 'ocr',
          says: `the navigation band under ${cell?.navigation} navigation (the app's, the handle over it): passes, or fails closed — never a FAIL on a reading`,
          call: ocrCall(platform, { text }, text),
          judge: (o) => (passed(o) || failedClosedUnchecked(o.reply) ? undefined : readSomething(o.reply) ? said(o, 'read what the band leaves of it as its text') : `neither passed nor failed closed: ${first(o)}`),
        }),
      ];
    }
  }
  return [];
}
