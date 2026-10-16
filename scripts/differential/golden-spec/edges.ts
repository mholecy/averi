import type { Platform } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { colourFails, directionRow, fullyRow, landRow, notReachedStill, refusedTap, strokeRow } from './rows.js';

/**
 * The edge geometries' rows — a geometry group, named for the edges family (fixtures/apps/cells/edges.json, phase 3 B2)
 * whose cells build them, but asked of an open target of ANY family whose measured geometry puts it at an edge — of the
 * screen, or of its scroll view's clip (golden-spec.ts#expectations picks by geometry, never by family). The row types
 * are rows.ts's (each citing what decides it); here, which a geometry asks. Nothing for a target with no geometry or a
 * `whole` one.
 *
 * | geometry | rows |
 * |---|---|
 * | off-screen | R-off tap, R-off colour, R-stroke, R-direction (live only: golden.ts never asks it) |
 * | outside-scroll-view | R-outside-sv tap, R-outside-sv colour (asked for the colour the screen shows there: a pass measured the background, #29), R-stroke, R-direction (live only) |
 *
 * On Android the off-screen and outside-scroll-view rows accept a target missing from the tree (notListed).
 * | sliver | R-sliver tap, R-sliver scroll_until, R-fully |
 * | partly-centre-in | R-land (Tapped inside what shows), R-fully |
 * | centre-out | R-land (refused, or Tapped inside its piece), R-fully |
 */
export function edgeRows(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation[] {
  const absent = notListed(platform);
  switch (t.geometry) {
    case 'off-screen':
      return [
        refusedTap(platform, t, 'R-off', absent),
        colourFails(platform, t, 'R-off: nothing of it is on the screen', { absent }),
        strokeRow(platform, t, cell, 'R-off', absent),
        directionRow(platform, t, cell),
      ].map(classed);
    case 'outside-scroll-view':
      return [
        refusedTap(platform, t, 'R-outside-sv', absent),
        colourFails(platform, t, 'R-outside-sv: fails closed, never measuring the background', { expected: t.seen, absent }),
        strokeRow(platform, t, cell, 'R-outside-sv', absent),
        directionRow(platform, t, cell),
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

/**
 * Why an Android target off the screen or outside its scroll view's clip may be missing from the tree: uiautomator
 * dumps only the nodes visible to the user, and Compose marks such a node not visible (docs/bugs/
 * 2026-10-08-ios-tap-off-screen-reported-done.md, its Android part; measured on the lab's edges cells: scroll-bounded's
 * O and F, scroll-top-edge's A are not in the dump). A tap that waits for it, a colour assert that does not find it and
 * a scroll_until that swipes for it are then all averi can answer. iOS's trees list such a node (WDA and idb).
 */
export function notListed(platform: Platform): string | undefined {
  return platform === 'android' ? 'uiautomator dumps no node that is not visible to the user: a target off the screen or outside its scroll view is not in the tree' : undefined;
}
