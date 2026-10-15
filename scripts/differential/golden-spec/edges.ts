import type { Platform } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { colourFails, fullyRow, landRow, notReachedStill, refusedTap, strokeRow } from './rows.js';

/**
 * The edges family's rows (fixtures/apps/cells/edges.json, phase 3 B2): an open target whose measured geometry puts it
 * at an edge — of the screen, or of its scroll view's clip. The row types are rows.ts's (each citing what decides it);
 * here, which a geometry asks. Nothing for a target with no geometry or a `whole` one.
 *
 * | geometry | rows |
 * |---|---|
 * | off-screen | R-off tap, R-off colour, R-stroke |
 * | outside-scroll-view | R-outside-sv tap, R-outside-sv colour, R-stroke |
 * | sliver | R-sliver tap, R-sliver scroll_until, R-fully |
 * | partly-centre-in | R-land (Tapped inside what shows), R-fully |
 * | centre-out | R-land (refused, or Tapped inside its piece), R-fully |
 */
export function edgeRows(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation[] {
  switch (t.geometry) {
    case 'off-screen':
      return [refusedTap(platform, t, 'R-off'), colourFails(platform, t, 'R-off: nothing of it is on the screen'), strokeRow(platform, t, cell, 'R-off')].map(classed);
    case 'outside-scroll-view':
      return [
        refusedTap(platform, t, 'R-outside-sv'),
        colourFails(platform, t, 'R-outside-sv: fails closed, never measuring the background'),
        strokeRow(platform, t, cell, 'R-outside-sv'),
      ].map(classed);
    case 'sliver':
      return [refusedTap(platform, t, 'R-sliver'), notReachedStill(platform, t, cell, 'R-sliver'), fullyRow(platform, t, cell)].map(classed);
    case 'partly-centre-in':
    case 'centre-out':
      return [landRow(platform, t), fullyRow(platform, t, cell)].map(classed);
    default:
      return [];
  }
}
