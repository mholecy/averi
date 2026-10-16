import type { Platform, SourceKind } from '../corpus.js';
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
 * | sliver | R-sliver tap, R-sliver scroll_until, R-fully |
 * | partly-centre-in | R-land (Tapped inside what shows), R-fully |
 * | centre-out | R-land (refused, or Tapped inside its piece), R-fully |
 *
 * The off-screen and outside-scroll-view rows accept a target missing from the tree where its capture's tree of that
 * source did not list it (notListed); R-stroke asks every touch-down inside the target's own scroll view where the truth
 * names one (rows.ts#strokeRow).
 */
export function edgeRows(platform: Platform, t: TargetTruth, cell: CellTruth, source: SourceKind): Expectation[] {
  const absent = notListed(t, source);
  switch (t.geometry) {
    case 'off-screen':
      return [
        refusedTap(platform, t, 'R-off', { absent }),
        colourFails(platform, t, 'R-off: nothing of it is on the screen', { absent }),
        strokeRow(platform, t, cell, 'R-off', { absent }),
        directionRow(platform, t, cell),
      ].map(classed);
    case 'outside-scroll-view':
      return [
        refusedTap(platform, t, 'R-outside-sv', { absent }),
        colourFails(platform, t, 'R-outside-sv: fails closed, never measuring the background', { expected: t.seen, absent }),
        strokeRow(platform, t, cell, 'R-outside-sv', { absent }),
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
 * Why a target off the screen or outside its scroll view's clip may be missing from the replayed tree: the capture's
 * tree of that source did not list it (TargetTruth.listed, truth.ts#listedIn) — uiautomator dumps no node not visible
 * to the user, so scroll-bounded's O and F and scroll-top-edge's A are not in the Android dump (docs/bugs/
 * 2026-10-08-ios-tap-off-screen-reported-done.md, its Android part). A tap that waits for it, a colour assert that
 * does not find it and a scroll_until that swipes for it are then all averi can answer. A target the tree lists, or a
 * capture that did not record it, is held to be in the tree.
 */
export function notListed(t: Pick<TargetTruth, 'listed'>, source: SourceKind): string | undefined {
  return t.listed?.[source] === false ? `the capture's ${source} tree does not list it` : undefined;
}
