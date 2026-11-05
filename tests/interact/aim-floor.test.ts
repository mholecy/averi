import { describe, expect, it } from 'vitest';
import { aimFloor, type Carried } from '../../src/interact/aim-floor.js';

/**
 * D68: no swipe can show the rest of a proven cut whole (interact/aim-floor.ts) — when the room left on the match's
 * uncut side is smaller than what a stroke no longer than the next one was measured to carry it in this same call.
 * batch-10 (tests/fixtures/d68-b10-recycler-convergence.json) run 8 after its 6th stroke: C at 81 in a carousel from 66
 * (15 px of room), its six strokes 142, 188, 89, 51, 48 and 48 px carrying it 135, 198, 76, 33, 27 and 27 px.
 */

const RUN_8: Carried[] = [
  { drawn: 142, moved: 135 },
  { drawn: 188, moved: 198 },
  { drawn: 89, moved: 76 },
  { drawn: 51, moved: 33 },
  { drawn: 48, moved: 27 },
  { drawn: 48, moved: 27 },
];
/** batch-10 run 0's last two: 48 px each, carrying 24 and 27. */
const RUN_0_TAIL: Carried[] = [
  { drawn: 48, moved: 24 },
  { drawn: 48, moved: 27 },
];

describe('aimFloor: the stop when the shortest measured stroke would carry the match past the room left', () => {
  it('run 8: 15 px of room, the 48-px strokes carried it 27 — the stop, with what it was judged on', () => {
    expect(aimFloor({ room: 15, next: 48, carried: RUN_8 })).toEqual({ room: 15, drawn: 48, moved: 27 });
  });

  it('the least carry of the strokes no longer than the next is the one judged: run 0, 24 px of room, carried 24 and 27 — no stop (one more could land it within a pixel)', () => {
    expect(aimFloor({ room: 24, next: 48, carried: RUN_0_TAIL })).toBeUndefined();
    expect(aimFloor({ room: 22, next: 48, carried: RUN_0_TAIL })).toEqual({ room: 22, drawn: 48, moved: 24 });
  });

  it('the boundary, within a pixel: room + 1 must be under the carry', () => {
    expect(aimFloor({ room: 25, next: 48, carried: [{ drawn: 48, moved: 27 }] })).toEqual({ room: 25, drawn: 48, moved: 27 });
    expect(aimFloor({ room: 26, next: 48, carried: [{ drawn: 48, moved: 27 }] })).toBeUndefined();
  });

  it('no measured stroke: no stop — as today', () => {
    expect(aimFloor({ room: 0, next: 48, carried: [] })).toBeUndefined();
  });

  it('only strokes no longer than the next (within a pixel) count: a longer one says nothing of a shorter one', () => {
    expect(aimFloor({ room: 15, next: 48, carried: RUN_8.slice(0, 4) })).toBeUndefined();
    expect(aimFloor({ room: 15, next: 48, carried: [{ drawn: 49, moved: 27 }] })).toEqual({ room: 15, drawn: 49, moved: 27 });
    expect(aimFloor({ room: 15, next: 48, carried: [{ drawn: 50, moved: 27 }] })).toBeUndefined();
    expect(aimFloor({ room: 15, next: 60, carried: [{ drawn: 50, moved: 27 }] })).toEqual({ room: 15, drawn: 50, moved: 27 });
  });

  it('of several short ones, the least carry; on a tie, the shorter stroke', () => {
    expect(aimFloor({ room: 10, next: 48, carried: [{ drawn: 48, moved: 27 }, { drawn: 40, moved: 20 }, { drawn: 48, moved: 24 }] })).toEqual({ room: 10, drawn: 40, moved: 20 });
    expect(aimFloor({ room: 10, next: 48, carried: [{ drawn: 48, moved: 20 }, { drawn: 40, moved: 20 }] })).toEqual({ room: 10, drawn: 40, moved: 20 });
    expect(aimFloor({ room: 10, next: 48, carried: [{ drawn: 40, moved: 20 }, { drawn: 48, moved: 20 }] })).toEqual({ room: 10, drawn: 40, moved: 20 });
  });
});
