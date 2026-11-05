import { FIT_ROOM_PX } from './scroll-read.js';

/**
 * D68: NO SWIPE CAN SHOW THE REST OF A PROVEN CUT WHOLE, from the call's own evidence. A `fully: true` match the flush
 * check's probe proved cut at its scroll container's edge (interact/flush-check.ts#ProvenCut) is revealed by strokes
 * toward that edge; each one carries the match's UNCUT side toward the container's same side, and the room left there
 * (flush-check.ts's `roomPast`) is how far it may go before that side leaves the container and is cut in its turn. When
 * a stroke no longer than the next one the course would draw was measured, in this same call, to carry the match more
 * than that room (within FIT_ROOM_PX, the sources' rounding), any further stroke pushes the uncut side out past the
 * container instead of bringing the cut one in — most likely, not surely (a drag's carry varies: 48 px carried 24–28
 * on batch-10's carousel), so no further stroke is sent (`aimFloor`): fewer wasted swipes, and no "raise maxSwipes".
 *
 * Measured, never assumed (batch-10, the lab's RecyclerView carousel, tests/fixtures/d68-b10-recycler-convergence.json):
 * C exactly as wide as the carousel, listed cut flush to it; the reveals travelled half the room each, and short drags
 * carried it less than their length (48 px carried 24–28), so 6 swipes ended 15–28 px short and the reply advised
 * "raise maxSwipes". Run 8: 15 px left, the two 48-px strokes carried it 27 each — the stop.
 *
 * The least carry of the strokes no longer than the next counts (a drag's carry rises with its length: a longer stroke
 * says nothing of a shorter one), so a stroke that could still land the match within a pixel of the container's side
 * is sent: room 24, carries 24 and 27 — no stop. No measured stroke, no stop.
 *
 * Pure: no adapter, no clock, no I/O. docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md, the D68 amendment.
 */

/** One stroke of this call over a proven cut: its drawn length, and how far it carried the match's uncut side toward revealing the cut edge (flush-check.ts#revealedBy's growth). */
export interface StrokeCarry {
  readonly drawn: number;
  readonly moved: number;
}

/** The stop's facts: the `room` left on the match's uncut side, and the stroke judged — its `drawn` length and the px it `moved` the match. */
export interface Overshoot {
  readonly room: number;
  readonly drawn: number;
  readonly moved: number;
}

/** What `aimFloor` asks: the room left, the length of the stroke the course would draw next, and the strokes measured over this cut. */
export interface AimAsk {
  readonly room: number;
  readonly next: number;
  readonly strokes: readonly StrokeCarry[];
}

/**
 * The stop (`Overshoot`) when the least carry of the measured strokes no longer than `next` (within FIT_ROOM_PX) is more
 * than `room` + FIT_ROOM_PX — on a tie of carries the shorter stroke is named — else undefined.
 */
export function aimFloor({ room, next, strokes }: AimAsk): Overshoot | undefined {
  const short = strokes.filter((c) => c.drawn <= next + FIT_ROOM_PX);
  if (short.length === 0) return undefined;
  const least = short.reduce((a, b) => (b.moved < a.moved || (b.moved === a.moved && b.drawn < a.drawn) ? b : a));
  return room + FIT_ROOM_PX < least.moved ? { room, drawn: least.drawn, moved: least.moved } : undefined;
}
