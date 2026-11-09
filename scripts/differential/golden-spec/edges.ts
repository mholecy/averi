import type { Platform, SourceKind } from '../corpus.js';
import type { AbsentTarget, CellTruth, TargetTruth } from '../../truth/schema.js';
import { directionOf, scrollerListedIn } from '../../truth/truth.js';
import { classed, type Expectation } from './judges.js';
import { ABSENT_STOPS, askedUnlistedBy, unlistedBy, type TargetContract } from '../../truth/target-contract.js';
import { absentFullyRow, colourFails, directionRow, fullyRow, stopRow, strokeRow, tapRow } from './rows.js';

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
 * | (none: CellTruth.absent) | R-absent: R-stroke and R-fully toward AbsentTarget.toward (absentRows) |
 *
 * What each row asks is the target contract's (`c`, scripts/truth/target-contract.ts#contractOf — the live golden's
 * cases read the same clauses), handed to the row that judges it: the judged geometry, the tap's clause (rows.ts
 * #tapRow), the plain stop's (rows.ts#stopRow, strokeRow), `fully`'s where it is asked, and whether the target may be missing from the tree — the off-screen and
 * outside-scroll-view rows accept a target missing from the tree where its capture's tree of that source did not list
 * it — as each row asks it: the tap and the stroke by truth.ts#selectorOf (askedUnlistedBy: a text target's string), the
 * colour by its identifier (unlistedBy); R-stroke asks every touch-down inside the target's own scroll view where the truth names one
 * (rows.ts#strokeRow).
 *
 * A target laid out nowhere (CellTruth.absent: no frame, so no geometry) is asked absentRows' R-absent rows below.
 */
export function edgeRows(platform: Platform, t: TargetTruth, cell: CellTruth, source: SourceKind, c: TargetContract): Expectation[] {
  // The tap and the stroke ask by truth.ts#selectorOf (a text target by its string), the colour assert by the identifier.
  const absent = askedUnlistedBy(t, source);
  const nodeAbsent = unlistedBy(t, source);
  // A framed target its tree does not list: no scroll view asked of its strokes (no `scrollerListed`: why, and the gap
  // it leaves, at rows.ts#StrokeOptions.scrollerListed; backlog D76).
  const stroke = (row: string) => strokeRow(platform, t, cell, row, c.stop, directionOf(t, cell), { absent });
  const fully = c.fully === undefined ? [] : [fullyRow(platform, t, cell, c.fully)];
  switch (c.geometry) {
    case 'off-screen':
      return [
        tapRow(platform, t, c, 'R-off', { absent }),
        colourFails(platform, t, 'R-off: nothing of it is on the screen', { absent: nodeAbsent }),
        stroke('R-off'),
        directionRow(platform, t, cell),
      ].map(classed);
    case 'outside-scroll-view':
      return [
        tapRow(platform, t, c, 'R-outside-sv', { absent }),
        colourFails(platform, t, 'R-outside-sv: fails closed, never measuring the background', { expected: t.seen, absent: nodeAbsent }),
        stroke('R-outside-sv'),
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

/**
 * Whether the replayed tree `tree` lists the target's scroll view (the truth's clip of it) a scroller
 * (truth.ts#scrollerListedIn) — R-stroke then holds the strokes for a target it does not list inside it
 * (rows.ts#strokeRow). False with no tree (a unit test of a row's choice) or no clip in the truth.
 */
function ownScrollerListed(t: Pick<TargetTruth, 'scrollView'>, cell: CellTruth, source: SourceKind, tree: string | undefined): boolean {
  const clip = t.scrollView === undefined ? undefined : cell.scrollViews?.[t.scrollView];
  return tree !== undefined && clip !== undefined && scrollerListedIn(tree, source, clip);
}

/**
 * The rows of a target the app laid out no frame for (CellTruth.absent: the L7 carousels' C at launch, not composed
 * until its carousel scrolls — T6), asked toward where it lies (AbsentTarget.toward; none without it): R-stroke
 * (rows.ts#strokeRow) and R-fully (rows.ts#absentFullyRow) — `fully: true` never "visible", the same strokes. Both
 * accept a reply that never found it where the capture's tree did not list it (askedUnlistedBy), judged by the swipes
 * sent for it: every touch-down inside its scroll view where the replayed tree lists that a scroller (D59b — on the L7
 * carousels a horizontal stroke over the page's vertical axis goes over the carousel of unknown axis, inside its band),
 * along `toward`'s axis (why only an absent target is held to its scroll view: rows.ts#StrokeOptions.scrollerListed;
 * backlog D76). What the contract asks of it is target-contract.ts#ABSENT_STOPS. No tap or colour row: nothing of it is
 * on the screen to tap or measure, and the off-screen rows already ask both of such targets.
 */
export function absentRows(platform: Platform, a: AbsentTarget, cell: CellTruth, source: SourceKind, tree?: string): Expectation[] {
  if (a.toward === undefined) return [];
  const opts = { absent: askedUnlistedBy(a, source), scrollerListed: ownScrollerListed(a, cell, source, tree) };
  return [strokeRow(platform, a, cell, 'R-absent', ABSENT_STOPS.stop, a.toward, opts), absentFullyRow(platform, a, cell, 'R-absent', ABSENT_STOPS.fully, a.toward, opts)].map(classed);
}
