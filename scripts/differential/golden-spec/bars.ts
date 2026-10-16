import type { Platform } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { isOverlap, parseGeometry } from '../../truth/truth.js';
import { openRows } from './base.js';
import { bandColour, bandTap, colourFails, fullyRow, landRow, notReachedStill, overlapColour, reachedAtOnce } from './rows.js';

/**
 * The band and chrome geometries' rows — a geometry group, named for the bars family (fixtures/apps/cells/bars.json,
 * phase 3 B4) whose cells build them, but asked of an open target of ANY family whose measured centre lies in a system
 * band or under the app's chrome, or whose edge they overlap (golden-spec.ts#expectations picks by geometry). The row
 * types are rows.ts's; here, which a geometry asks. R-stroke (rows.ts) is asked by any family's row that strokes on a
 * cell with chrome (edges.ts). Nothing for a target with no geometry or a `whole` one.
 *
 * | geometry | rows |
 * |---|---|
 * | status-band, nav-band (Android) | R-band tap, R-band colour (in the navigation band under gesture navigation: a PASS on its own colour or a FAIL, rows.ts#bandColour), R-band scroll_until |
 * | nav-band on iOS: the home indicator's band | the open rows (base.ts) — consistency holds it reached and drawn |
 * | under-chrome:<name> | R-under-chrome tap (R-land on its piece), colour, scroll_until |
 * | band-overlap:<band>, chrome-overlap:<name> | R-overlap: tap (R-land at its centre), colour (fails closed only where what it samples is overlapped), scroll_until reached with no swipe, R-fully (a band's: in a scroll view only) |
 *
 * iOS's home-indicator band is no band averi judges (ADR 0009's navigation band is Android's; ADR 0008 is iOS's status
 * band) and none the truth makes one: measured by B4 (truth.ts#navigationBandTakes), a tap there is the app's and fires
 * the target beneath. So a target centred there is asked what an open one is (ADR 0020: the truth outranks a
 * hand-written expectation) — Tapped, its colour, reached at once.
 *
 * R-overlap, a whole target whose centre is clear but whose edge a band or the chrome overlaps past ADR 0002's slack:
 * the tap and the plain stop are centre-based (ADR 0009 N-a), so `Tapped` and reached at once; the colour assert fails
 * closed where what it reads — the sampler's 12 %-inset rect — is overlapped (ADR 0001, ADR 0002), else measures the
 * target; `fully: true` judges the bands as a region of the node (ADR 0009 N-a, `fully`) and any cover as covering
 * (ui-tree/standing.ts#fullyStanding), so it never stops on it where it is. A band's R-fully is asked only of a target
 * in a scroll view: one in none may be a pinned surface the `fully` stop stops on at once (ADR 0009 (b), (c)).
 */
export function barRows(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation[] {
  const g = t.geometry;
  if (g === undefined) return [];
  const { kind, name } = parseGeometry(g);
  // iOS's home-indicator band: the tap is the app's, and consistency holds the target reached and drawn there
  // (truth.ts#navigationBandTakes) — else it is broken and asked nothing.
  if (g === 'nav-band' && platform === 'ios') return openRows(platform, t);
  if (g === 'status-band' || g === 'nav-band') {
    return [bandTap(platform, t), bandColour(platform, t, cell), notReachedStill(platform, t, cell, 'R-band')].map(classed);
  }
  if (kind === 'under-chrome') {
    const chrome = name;
    return [landRow(platform, t), colourFails(platform, t, `R-under-chrome: ${chrome} over it`), notReachedStill(platform, t, cell, `R-under-chrome (${chrome})`)].map(classed);
  }
  if (isOverlap(g)) {
    const band = kind === 'band-overlap';
    return [
      landRow(platform, t),
      overlapColour(platform, t, cell),
      reachedAtOnce(platform, t, cell, `R-overlap (${g})`),
      ...(band && t.scrollView === undefined ? [] : [fullyRow(platform, t, cell)]),
    ].map(classed);
  }
  return [];
}
