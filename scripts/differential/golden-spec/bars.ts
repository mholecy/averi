import type { Platform } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { bandTap, colourFails, landRow, notReachedStill } from './rows.js';

/**
 * The bars family's rows (fixtures/apps/cells/bars.json, phase 3 B4): an open target whose measured centre lies in a
 * system band or under the app's chrome. The row types are rows.ts's; here, which a geometry asks. R-stroke (rows.ts)
 * is asked by any family's row that strokes on a cell with chrome (edges.ts). Nothing for a target with no geometry or
 * a `whole` one.
 *
 * | geometry | rows |
 * |---|---|
 * | status-band, nav-band | R-band tap, R-band colour, R-band scroll_until |
 * | under-chrome:<name> | R-under-chrome tap (R-land on its piece), colour, scroll_until |
 */
export function barRows(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation[] {
  const g = t.geometry;
  if (g === 'status-band' || g === 'nav-band') {
    return [bandTap(platform, t), colourFails(platform, t, `R-band: the ${g === 'status-band' ? 'status' : 'navigation'} band over it`), notReachedStill(platform, t, cell, 'R-band')].map(classed);
  }
  if (g !== undefined && g.startsWith('under-chrome:')) {
    const chrome = g.slice('under-chrome:'.length);
    return [landRow(platform, t), colourFails(platform, t, `R-under-chrome: ${chrome} over it`), notReachedStill(platform, t, cell, `R-under-chrome (${chrome})`)].map(classed);
  }
  return [];
}
