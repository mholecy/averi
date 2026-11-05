import type { Rect, ScrollAxis, Stroke, UiNode } from '../adapters/types.js';
import { axisOfEdge, containsPoint, flushEdges, type Edge } from '../ui-tree/geometry.js';
import { axisOf, type Direction } from './swipe.js';

/**
 * D59: THE AXIS OF A ROOM-GIVER THE TREE DOES NOT TELL, from the call's own evidence. `scroll_until`'s `unfit` stop
 * (scroll-read.ts#unfitAlong) needs the axis its room-giving scroll view scrolls on; Android tells it by class only
 * (adapters/android.ts's AXIS_BY_CLASS), so a Compose LazyRow (a plain `android.view.View`), a RecyclerView or a
 * ViewPager2 tells none, and a card as wide as such a carousel swung to maxSwipes (ADR 0021's residual 3). The axis is
 * taken as the one the call measures along only when the tree and this call's strokes together say so (`inferredAlong`).
 * No device call: the strokes are the ones the call sent anyway, the movements the motion ledger already compares
 * (interact/motion-ledger.ts#cardMoves). A told axis wins: this is asked only where the tree tells none.
 *
 * Pure: no adapter, no clock, no I/O. docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md, the D59 amendment.
 */

/** One stroke of the call and the one axis the read after it found the judged card moved along (`cardMoved`): what the motion ledger records of each stroke read. */
export interface CardMove {
  readonly drawn: Stroke;
  readonly along: ScrollAxis;
}

/** How far a card's side must move for a move (`cardMoved`), and how little across for none: a pixel, the sources' rounding (as scroll-read.ts#FIT_ROOM_PX). */
const MOVE_SLACK_PX = 1;

/** How far each side of `before` lies from `after`'s along an axis: the start's and the end's. */
const sideShift = (before: Rect, after: Rect, axis: ScrollAxis): number =>
  axis === 'horizontal'
    ? Math.max(Math.abs(after.x - before.x), Math.abs(after.x + after.width - (before.x + before.width)))
    : Math.max(Math.abs(after.y - before.y), Math.abs(after.y + after.height - (before.y + before.height)));

/**
 * The one axis the same card moved along between two reads — a side of it more than MOVE_SLACK_PX along that axis,
 * neither side more than that across it — or undefined: unmoved, or moved both ways. A side, not the rect's origin: a
 * card uiautomator cuts at the screen's edge keeps its start there while its listed end grows.
 */
export function cardMoved(before: Rect, after: Rect): ScrollAxis | undefined {
  const x = sideShift(before, after, 'horizontal') > MOVE_SLACK_PX;
  const y = sideShift(before, after, 'vertical') > MOVE_SLACK_PX;
  if (x === y) return undefined;
  return x ? 'horizontal' : 'vertical';
}

/** What `inferredAlong` asks: the read's facts of the target, its scroll views, the call's direction, and its recorded movements. */
export interface AxisEvidence {
  /** The axis the target is judged along (scroll-read.ts#unfitAlong's). */
  readonly along: ScrollAxis;
  /** The call's direction. */
  readonly direction: Direction;
  /** The room-giving scroll view: the smallest of the target's along `along`. */
  readonly roomGiver: UiNode;
  /** The target's nearest scroll view (geometry.ts#Clips.drawnIn's first `scrollers`), undefined when none. */
  readonly nearest: UiNode | undefined;
  /** The frame edges the target extends past (ui-tree/standing.ts#StandingFacts `clipped`). */
  readonly clipped: readonly Edge[];
  /** The sides it runs past at the screen's edge, an unknown distance (StandingFacts `unknownPast`). */
  readonly unknownPast: readonly Edge[];
  /** The frame its scroll views draw it in (StandingFacts `drawn`). */
  readonly drawn: Rect;
  /** This call's recorded movements of the judged card (`CardMove`). */
  readonly moves: readonly CardMove[];
}

/**
 * Whether the room-giver's untold axis is `along` — all four hold:
 * 1. it is the target's nearest scroll view: the view that moves the card itself, not one that holds its holder;
 * 2. the call's direction runs along `along`: the strokes measured are along it;
 * 3. the target is cut on an edge along `along` that lies on the room-giver's own edge (within a pixel, the drawn
 *    frame's), and not at the screen's (`unknownPast`): the room-giver's clip is what cuts it;
 * 4. earlier in this call a stroke drawn over the room-giver — both its ends inside it — moved the card along `along`
 *    (`CardMove`): measured, not assumed. Without it a row clipped at an untold column's side (a LazyColumn's), under a
 *    sideways call, would read as too wide for a column that never scrolls sideways — where the stuck and the
 *    layout-defect sentences stay theirs (no cross-axis `unfit`).
 */
export function inferredAlong(e: AxisEvidence): boolean {
  const { along, roomGiver } = e;
  const nearest = e.nearest === roomGiver;
  const directed = axisOf(e.direction) === along;
  const own = flushEdges(e.drawn, roomGiver.rect, along);
  const cutAtOwn = e.clipped.some((edge) => axisOfEdge(edge) === along && own.includes(edge)) && !e.unknownPast.some((edge) => axisOfEdge(edge) === along);
  const over = (s: Stroke): boolean => containsPoint(roomGiver.rect, s.from) && containsPoint(roomGiver.rect, s.to);
  const measured = e.moves.some((m) => m.along === along && over(m.drawn));
  return nearest && directed && cutAtOwn && measured;
}
