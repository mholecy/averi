import type { ScrollAxis, Stroke, UiNode } from '../adapters/types.js';
import { axisOfEdge, containsPoint, flushEdges } from '../ui-tree/geometry.js';
import type { StandingFacts } from '../ui-tree/standing.js';
import type { CardMove } from './motion-ledger.js';
import { axisOf, type Direction } from './swipe.js';

/**
 * D59: THE AXIS OF A ROOM-GIVER THE TREE DOES NOT TELL, from the call's own evidence. `scroll_until`'s `unfit` stop
 * (scroll-read.ts#unfitAlong) needs the axis its room-giving scroll view scrolls on. Android tells it by class only
 * (adapters/android-tree-dialect.ts's AXIS_BY_CLASS), so a Compose LazyRow, dumped as a plain `android.view.View`, tells none, and a
 * card as wide as such a carousel swung to maxSwipes (ADR 0021's residual 3). Here the axis is taken as the one the
 * call measures along only when the tree and this call's strokes together say so (`inferredAlong`).
 *
 * What it reaches depends on how the source lists the card. A Compose card is listed where it lies, so it can be
 * `clipped` past the carousel's edge and judged. A RecyclerView's (or a ViewPager2's) card is a View child, listed cut
 * flush to the carousel, never `clipped`, so D59 does not reach it. Should a dump ever list one clipped, D59 would
 * apply to it as to any other: that case is backlog D68's slice, not this one.
 *
 * No device call: the strokes are the ones the call sent anyway, and the movements are the ones the motion ledger
 * already records (interact/motion-ledger.ts#cardMoves). A told axis wins: this is asked only where the tree tells none.
 *
 * Pure: no adapter, no clock, no I/O. docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md, the D59 amendment.
 */

/** What a call has shown of the axis of a scroll view the tree tells none of: its direction, and the strokes that moved the judged card (motion-ledger.ts#cardMoves). */
export interface CallMotion {
  readonly direction: Direction;
  readonly moves: readonly CardMove[];
}

/** What `inferredAlong` asks: the read's facts of the target, the axis it is judged along, its scroll views, and the call's motion. */
export type AxisEvidence = Pick<StandingFacts, 'clipped' | 'unknownPast' | 'drawn'> &
  CallMotion & {
    /** The axis the target is judged along (scroll-read.ts#unfitAlong's). */
    readonly along: ScrollAxis;
    /** The room-giving scroll view: the smallest of the target's along `along`. */
    readonly roomGiver: UiNode;
    /** The target's nearest scroll view (geometry.ts#Clips.drawnIn's first `scrollers`), undefined when none. */
    readonly nearest: UiNode | undefined;
  };

/**
 * Whether the room-giver's untold axis is `along` — all four hold:
 * 1. it is the target's nearest scroll view: the view that moves the card itself, not one that holds its holder;
 * 2. the call's direction runs along `along`: the strokes measured are along it;
 * 3. the target is cut on an edge that lies on the room-giver's own edge along `along` (the drawn frame's, within a
 *    pixel), and not at the screen's (`unknownPast`): the room-giver's clip is what cuts it. In the round today,
 *    unfitAlong's own gates imply this one (the drawn frame is the judged frame and spans the room-giver's extent, no
 *    `unknownPast` side). It stays here as defence in depth, so the module answers for all four on its own;
 * 4. earlier in this call a stroke drawn over the room-giver — both its ends inside it — moved the card along `along`
 *    (`CardMove`): measured, not assumed. Without it a row clipped at an untold column's side (a LazyColumn's), under a
 *    sideways call, would read as too wide for a column that never scrolls sideways — where the stuck and the
 *    layout-defect sentences stay theirs (no cross-axis `unfit`).
 */
export function inferredAlong(e: AxisEvidence): boolean {
  const { along, roomGiver, drawn } = e;
  if (drawn === undefined) return false;
  const nearest = e.nearest === roomGiver;
  const directed = axisOf(e.direction) === along;
  // The drawn frame's edges that are the room-giver's own; asked along `along`, flushEdges gives only that axis's.
  const own = flushEdges(drawn, roomGiver.rect, along);
  const cutAtOwn = e.clipped.some((edge) => own.includes(edge)) && !(e.unknownPast ?? []).some((edge) => axisOfEdge(edge) === along);
  const over = (s: Stroke): boolean => containsPoint(roomGiver.rect, s.from) && containsPoint(roomGiver.rect, s.to);
  const measured = e.moves.some((m) => m.along === along && over(m.drawn));
  return nearest && directed && cutAtOwn && measured;
}
