import type { Platform, SourceKind } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { classed, type Expectation } from './judges.js';
import { askedUnlistedBy, unlistedBy, type TargetContract } from '../../truth/target-contract.js';
import { colourFails, directionRow, fullyRow, stopRow, strokeRow, tapRow } from './rows.js';

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
 * What each row asks is the target contract's (`c`, scripts/truth/target-contract.ts#contractOf — the live golden's
 * cases read the same clauses), handed to the row that judges it: the judged geometry, the tap's clause (rows.ts
 * #tapRow), the plain stop's (rows.ts#stopRow, strokeRow), `fully`'s where it is asked, and whether the target may be missing from the tree — the off-screen and
 * outside-scroll-view rows accept a target missing from the tree where its capture's tree of that source did not list
 * it — as each row asks it: the tap and the stroke by truth.ts#selectorOf (askedUnlistedBy: a text target's string), the
 * colour by its identifier (unlistedBy); R-stroke asks every touch-down inside the target's own scroll view where the truth names one
 * (rows.ts#strokeRow).
 */
export function edgeRows(platform: Platform, t: TargetTruth, cell: CellTruth, source: SourceKind, c: TargetContract): Expectation[] {
  // The tap and the stroke ask by truth.ts#selectorOf (a text target by its string), the colour assert by the identifier.
  const absent = askedUnlistedBy(t, source);
  const nodeAbsent = unlistedBy(t, source);
  const fully = c.fully === undefined ? [] : [fullyRow(platform, t, cell, c.fully)];
  switch (c.geometry) {
    case 'off-screen':
      return [
        tapRow(platform, t, c, 'R-off', { absent }),
        colourFails(platform, t, 'R-off: nothing of it is on the screen', { absent: nodeAbsent }),
        strokeRow(platform, t, cell, 'R-off', c.stop, { absent }),
        directionRow(platform, t, cell),
      ].map(classed);
    case 'outside-scroll-view':
      return [
        tapRow(platform, t, c, 'R-outside-sv', { absent }),
        colourFails(platform, t, 'R-outside-sv: fails closed, never measuring the background', { expected: t.seen, absent: nodeAbsent }),
        strokeRow(platform, t, cell, 'R-outside-sv', c.stop, { absent }),
        directionRow(platform, t, cell),
      ].map(classed);
    case 'sliver':
      return [tapRow(platform, t, c, 'R-sliver'), stopRow(platform, t, cell, 'R-sliver', c.stop), ...fully].map(classed);
    case 'partly-centre-in':
    case 'centre-out':
      return [tapRow(platform, t, c, 'R-land'), ...fully].map(classed);
    default:
      return [];
  }
}
