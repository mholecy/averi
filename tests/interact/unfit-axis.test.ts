import { describe, expect, it } from 'vitest';
import type { Rect, Stroke } from '../../src/adapters/types.js';
import { inferredAlong, type AxisEvidence } from '../../src/interact/unfit-axis.js';
import { node } from '../helpers/fake.js';

/**
 * D59: the axis of a room-giving scroll view the tree does not tell, inferred from the call's own evidence
 * (interact/unfit-axis.ts) — each of the four conditions false alone, the inference refused.
 */

const at = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const CAROUSEL = node({ role: 'container', rect: at(66, 380, 948, 234) });
const PAGE = node({ role: 'scrollable', rect: at(0, 0, 1080, 2220) });
/** A stroke drawn over the carousel, content left (the finger moves right). */
const OVER: Stroke = { from: { x: 200, y: 497 }, to: { x: 768, y: 497 } };
/** A stroke drawn over the page, below the carousel. */
const BELOW: Stroke = { from: { x: 200, y: 1110 }, to: { x: 768, y: 1110 } };

/** The batch-9 lazy-free shape: C at 45 (cut 21 px at the carousel's left), the carousel nearest, a left call, a stroke over it that moved C along x. */
const E: AxisEvidence = {
  along: 'horizontal',
  direction: 'left',
  roomGiver: CAROUSEL,
  nearest: CAROUSEL,
  clipped: ['left'],
  unknownPast: [],
  drawn: CAROUSEL.rect,
  moves: [{ drawn: OVER, along: 'horizontal' }],
};

describe('inferredAlong: all four hold, or no axis is inferred', () => {
  it('all four hold: inferred', () => {
    expect(inferredAlong(E)).toBe(true);
    expect(inferredAlong({ ...E, direction: 'right', clipped: ['right'] })).toBe(true);
  });

  it('(1) the room-giver is not the nearest scroll view: refused', () => {
    expect(inferredAlong({ ...E, nearest: PAGE })).toBe(false);
    expect(inferredAlong({ ...E, nearest: undefined })).toBe(false);
  });

  it("(2) the call's direction runs across the axis: refused", () => {
    expect(inferredAlong({ ...E, direction: 'down' })).toBe(false);
    expect(inferredAlong({ ...E, direction: 'up' })).toBe(false);
  });

  it("(3) cut at the screen (unknownPast), not at an edge along the axis, or at an edge that is not the room-giver's: refused", () => {
    expect(inferredAlong({ ...E, unknownPast: ['right'] })).toBe(false);
    expect(inferredAlong({ ...E, clipped: ['top'] })).toBe(false);
    expect(inferredAlong({ ...E, clipped: [] })).toBe(false);
    // The drawn frame's left is an outer view's, 100 px inside the carousel's: the cut is not the carousel's own edge.
    expect(inferredAlong({ ...E, drawn: at(166, 380, 848, 234) })).toBe(false);
    // The right edge is the carousel's, but the card is clipped on the left, where it is not.
    expect(inferredAlong({ ...E, drawn: at(166, 380, 848, 234), clipped: ['right'], direction: 'right' })).toBe(true);
    // unknownPast across the axis says nothing along it.
    expect(inferredAlong({ ...E, unknownPast: ['bottom'] })).toBe(true);
  });

  it('(4) no stroke over the room-giver moved the card along the axis this call: refused', () => {
    expect(inferredAlong({ ...E, moves: [] })).toBe(false);
    expect(inferredAlong({ ...E, moves: [{ drawn: OVER, along: 'vertical' }] })).toBe(false);
    expect(inferredAlong({ ...E, moves: [{ drawn: BELOW, along: 'horizontal' }] })).toBe(false);
    // A stroke that starts over it and ends past it is not over it.
    expect(inferredAlong({ ...E, moves: [{ drawn: { from: OVER.from, to: { x: 1050, y: 497 } }, along: 'horizontal' }] })).toBe(false);
    expect(inferredAlong({ ...E, moves: [{ drawn: { from: { x: 1050, y: 497 }, to: OVER.to }, along: 'horizontal' }] })).toBe(false);
    // Any one such move is enough.
    expect(inferredAlong({ ...E, moves: [{ drawn: BELOW, along: 'horizontal' }, { drawn: OVER, along: 'horizontal' }] })).toBe(true);
  });

  it('no drawn frame (no scroll view told): refused', () => {
    expect(inferredAlong({ ...E, drawn: undefined })).toBe(false);
    expect(inferredAlong({ ...E, unknownPast: undefined })).toBe(true);
  });

  it('vertical: a column the tree does not tell, a down call, a row cut at its bottom, moved along y', () => {
    const column = node({ role: 'container', rect: at(0, 221, 1080, 1933) });
    const down: Stroke = { from: { x: 540, y: 1800 }, to: { x: 540, y: 600 } };
    const v: AxisEvidence = { along: 'vertical', direction: 'down', roomGiver: column, nearest: column, clipped: ['bottom'], unknownPast: [], drawn: column.rect, moves: [{ drawn: down, along: 'vertical' }] };
    expect(inferredAlong(v)).toBe(true);
    expect(inferredAlong({ ...v, direction: 'right' })).toBe(false);
    expect(inferredAlong({ ...v, moves: [{ drawn: down, along: 'horizontal' }] })).toBe(false);
  });
});
