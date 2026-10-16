import type { Platform, SourceKind } from '../corpus.js';
import type { Call, Outcome } from '../differential.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { navigationBandTakes, parseGeometry } from '../../truth/truth.js';
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
 * | the same | `assert {element:{text}, ocr:{text}}` | passes: the screenshot shows the string — read exactly, or equal only under the recognizer's fold (src/verify/ocr-fold.ts: ’ “ ” – — … read as ASCII, Latin combining marks dropped) | docs/bugs/2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-as-straight.md (35321b4) |
 * | its centre in the status band, under the app's chrome, or in (or overlapping) Android's navigation band where the bar takes the tap (three buttons) | `ocr` | fails closed (`rendered text unchecked`): never a PASS and never a reading, which would be of what is drawn over it | docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md (596a379); ADR 0001 |
 * | in or overlapping Android's navigation band under gesture navigation (the app's: the handle drawn over it) | `ocr` | passes (the text drawn whole beneath the handle, read right) or fails closed; never a FAIL on a reading — what the band leaves of the glyphs read as the element's text | docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md (e85bcdf); ADR 0009 |
 *
 * Every row names its element by the string (`text:"…"`), as a test names a label and as ownPartsRows' tap does: a text
 * target's identifier may sit on a node the tree folds into its control (own-parts' L on iOS: the button carries the
 * label, not the text's identifier). A covered target's tree text is not asked: the tree holds it whatever lies over
 * it. Edges' geometries (cut by a scroll view, off the screen) ask nothing here yet.
 */

/** The ocr assert's fail-closed tail (src/verify/fail-closed.ts: `failing closed, rendered text unchecked`). */
const UNCHECKED = /rendered text unchecked/;
/** An ocr reply that read something (src/verify/text-parity.ts#evaluateOcrAssert: `read "…"`). */
const READ = / read "/;

/** An `ocr` reply measured what lies there (a PASS, or a FAIL on a reading) rather than failing closed. */
export const measuredText = (o: Outcome) => passed(o) || (!UNCHECKED.test(o.reply) && READ.test(o.reply));

/** What an assert names its element by: an identifier, or a text target's string (as a test names a label). */
export type ElementSpec = { id: string } | { text: string };

/** The ocr assert on `element`, asked for `text`. */
const ocrCall = (platform: Platform, element: ElementSpec, text: string): Call => ({ tool: 'assert', args: { platform, asserts: [{ element, ocr: { text }, timeout: BUDGET_MS }] } });

/**
 * An ocr row that must fail closed: something is drawn over `element` (`over`: a band, the chrome, the soft keyboard —
 * golden-spec/forms.ts's under-keyboard controls) — a PASS or a reading measured that, not the element. Asked for the
 * element's own string.
 */
export function ocrFailsClosed(platform: Platform, element: ElementSpec, text: string, over: string): Expectation {
  return {
    verb: 'ocr',
    says: `fails closed (${over}): never a reading of what is drawn over it`,
    call: ocrCall(platform, element, text),
    judge: (o) => (passed(o) ? said(o, 'passed on what is drawn over it') : measuredText(o) ? said(o, 'measured the layer over the target as the target') : undefined),
  };
}

/**
 * Why a covered string may be missing from the replayed tree: its capture's tree of that source lists no node carrying
 * it (TargetTruth.textListed, measured from the tree: uiautomator dumps no node the user cannot see — text-under-bar's
 * P, its box listed by its uncovered strip above the button, its string not at all). Only then is a covered `ocr` row's
 * "not found" right; where the tree lists the string (S in the status band) it is no evidence, as everywhere.
 */
export const unseenString = (t: Pick<TargetTruth, 'textListed'>, source: SourceKind | undefined): string | undefined =>
  source !== undefined && t.textListed?.[source] === false ? `the ${source} capture lists no node carrying the string (TargetTruth.textListed): it is wholly under what is drawn over it` : undefined;

export function textRows(platform: Platform, t: TargetTruth, cell: CellTruth | undefined, source?: SourceKind): Expectation[] {
  const text = t.text;
  if (text === undefined) return [];
  const unseen = unseenString(t, source);
  const covered = (e: Expectation): Expectation => classed(unseen === undefined ? e : { ...e, absent: unseen });
  const g = t.geometry ?? 'whole';
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
        judge: passes,
      } satisfies Expectation,
    ].map(classed);
  }
  const { kind, name } = parseGeometry(g);
  if (g === 'status-band') return [covered(ocrFailsClosed(platform, { text }, text, 'the status band over it'))];
  if (kind === 'under-chrome') return [covered(ocrFailsClosed(platform, { text }, text, `${name} over it`))];
  // In the navigation band, or overlapping it (its centre clear): who takes that band is the navigation mode's.
  if ((g === 'nav-band' || g === 'band-overlap:nav') && platform === 'android') {
    const takes = navigationBandTakes(platform, 'nav-band', cell?.navigation);
    if (takes === 'bar') return [covered(ocrFailsClosed(platform, { text }, text, 'the navigation bar over it'))];
    if (takes === 'app') {
      return [
        classed({
          verb: 'ocr',
          says: `the navigation band under ${cell?.navigation} navigation (the app's, the handle over it): passes, or fails closed — never a FAIL on a reading`,
          call: ocrCall(platform, { text }, text),
          judge: (o) => (passed(o) || UNCHECKED.test(o.reply) ? undefined : READ.test(o.reply) ? said(o, 'read what the band leaves of it as its text') : `neither passed nor failed closed: ${first(o)}`),
        }),
      ];
    }
  }
  return [];
}
