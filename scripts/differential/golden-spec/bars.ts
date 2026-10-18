import type { Platform, SourceKind } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { isOverlap, parseGeometry } from '../../truth/truth.js';
import { askedUnlistedBy, isBand, type TargetContract } from '../../truth/target-contract.js';
import { bandColour, colourFails, fullyRow, overlapColour, stopRow, tapRow } from './rows.js';

/**
 * The band and chrome geometries' rows — a geometry group, named for the bars family (fixtures/apps/cells/bars.json,
 * phase 3 B4) whose cells build them, but asked of an open target of ANY family whose measured centre lies in a system
 * band or under the app's chrome, or whose edge they overlap (golden-spec.ts#expectations picks by geometry). The row
 * types are rows.ts's; here, which a geometry asks. R-stroke (rows.ts) is asked by any family's row that strokes on a
 * cell with chrome (edges.ts). Nothing for a target with no geometry or a `whole` one.
 *
 * | geometry | rows |
 * |---|---|
 * | status-band, nav-band (Android's) | R-band tap, R-band colour (in the navigation band under gesture navigation: a PASS on its own colour or a FAIL, rows.ts#bandColour), R-band scroll_until, R-fully (in a scroll view only) |
 * | under-chrome:<name> | R-under-chrome tap (R-land on its piece), colour, scroll_until |
 * | band-overlap:<band>, chrome-overlap:<name> | R-overlap: tap (R-land at its centre), colour (fails closed only where what it samples is overlapped), scroll_until reached with no swipe, R-fully (a band's: in a scroll view only) |
 *
 * What each row asks is the target contract's (`c`, scripts/truth/target-contract.ts#contractOf), which the live
 * golden's cases read too, handed to the row that judges it: the judged geometry, the tap's clause (rows.ts#tapRow), the
 * plain stop's (rows.ts#stopRow) and `fully`'s where it is asked (fullyAsked: a band's, or a band-overlapped target's, in a scroll view only — one in none may be a pinned
 * surface the `fully` stop stops on at once, ADR 0009 (b), (c)). And which band is a band: iOS's home-indicator band is
 * none (target-contract.ts#judgedContext — measured the app's: a tap there fires the target beneath, the target drawn
 * as itself), so a target centred there or overlapping it is judged by what else lies around it — `whole`, the open
 * rows (golden-spec.ts#expectations, base.ts), where nothing does.
 *
 * R-overlap, a whole target whose centre is clear but whose edge a band or the chrome overlaps past ADR 0002's slack:
 * the tap and the plain stop are centre-based (ADR 0009 N-a), so `Tapped` and reached at once; the colour assert fails
 * closed where what it reads — the sampler's 12 %-inset rect — is overlapped (ADR 0001, ADR 0002), else measures the
 * target; `fully: true` judges the bands as a region of the node (ADR 0009 N-a, `fully`) and any cover as covering
 * (ui-tree/standing.ts#fullyStanding), so it never stops on it where it is. A band's R-fully is asked only of a target
 * in a scroll view (fullyAsked, above).
 */
export function barRows(platform: Platform, t: TargetTruth, cell: CellTruth, source: SourceKind, c: TargetContract): Expectation[] {
  const g = c.geometry;
  if (g === undefined) return [];
  // The tap and the stop ask by truth.ts#selectorOf: where the replayed tree does not list the target as asked (a text
  // target's string under the chrome, askedUnlistedBy), a reply that never found it is honest, judged by what it did.
  const absent = askedUnlistedBy(t, source);
  const { kind, name } = parseGeometry(g);
  const fully = c.fully === undefined ? [] : [fullyRow(platform, t, cell, c.fully)];
  if (isBand(g)) {
    return [tapRow(platform, t, c, 'R-band', { absent }), bandColour(platform, t, cell), stopRow(platform, t, cell, 'R-band', c.stop, { absent }), ...fully].map(classed);
  }
  if (kind === 'under-chrome') {
    const chrome = name;
    return [tapRow(platform, t, c, 'R-under-chrome', { absent }), colourFails(platform, t, `R-under-chrome: ${chrome} over it`), stopRow(platform, t, cell, `R-under-chrome (${chrome})`, c.stop, { absent })].map(classed);
  }
  if (isOverlap(g)) {
    return [tapRow(platform, t, c, 'R-overlap', { absent }), overlapColour(platform, t, cell), stopRow(platform, t, cell, `R-overlap (${g})`, c.stop, { absent }), ...fully].map(classed);
  }
  return [];
}
