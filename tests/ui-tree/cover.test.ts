import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { coverAtPoint, coverOf, lastPresented, type Cover } from '../../src/ui-tree/cover.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node } from '../helpers/fake.js';

// The Cover record's queries (ui-tree/cover.ts): what every reader of a target's covers asks of the records draw order
// built, instead of joining parallel lists by membership.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const cover = (label: string, at: Rect, more: Partial<Omit<Cover, 'node'>> = {}): Cover => ({
  node: node({ role: 'button', label, rect: at }),
  reach: at,
  order: { kind: 'drawn' },
  presented: false,
  ...more,
});

describe('coverOf — the record of a node among the covers', () => {
  it('finds the record of the node, by identity, and none for a node that is no cover', () => {
    const bar = cover('Continue', rect(24, 780, 354, 44));
    const peer = cover('W', rect(51, 448, 300, 64), { order: { kind: 'untold' } });
    expect(coverOf([bar, peer], peer.node)).toBe(peer);
    expect(coverOf([bar], node({ role: 'button', label: 'W', rect: rect(51, 448, 300, 64) }))).toBeUndefined();
  });
});

describe('coverAtPoint — the cover drawn on top at a point', () => {
  it('the LAST whose REACH holds it: a pinned bar run down to the screen\'s bottom holds a point below its frame', () => {
    const bar = cover('Continue', rect(24, 780, 354, 44), { reach: rect(24, 780, 354, 94) });
    const toast = cover('Toast', rect(0, 700, 402, 120));
    expect(coverAtPoint([bar], { x: 135, y: 850 })).toBe(bar);
    expect(coverAtPoint([bar, toast], { x: 135, y: 800 })).toBe(toast);
    expect(coverAtPoint([toast, bar], { x: 135, y: 800 })).toBe(bar);
    expect(coverAtPoint([bar, toast], { x: 135, y: 600 })).toBeUndefined();
  });

  it("is draw order's own question: exposure's `coverAt` and `centreCover` name the same node", () => {
    const row = node({ role: 'button', label: 'Row', rect: rect(20, 400, 362, 52) });
    const sheet = node({ role: 'other', label: 'Sheet', rect: rect(0, 380, 402, 494) });
    const tree = node({ role: 'container', rect: rect(0, 0, 402, 874), children: [row, sheet] });
    const seen = drawOrder(tree).exposure(row, rect(0, 0, 402, 874));
    expect(coverAtPoint(seen.covers, { x: 201, y: 426 })?.node).toBe(sheet);
    expect(seen.coverAt({ x: 201, y: 426 })).toBe(sheet);
    expect(seen.centreCover).toBe(sheet);
  });
});

describe('lastPresented — the last cover that is a presented screen\'s surface', () => {
  it('the last flagged, whatever its order; none when no cover is', () => {
    const dim = cover('Dim', rect(0, 0, 402, 874), { presented: true });
    const form = cover('Form', rect(0, 62, 402, 812), { presented: true });
    const control = cover('Close', rect(20, 82, 36, 36));
    expect(lastPresented([dim, form, control])).toBe(form);
    expect(lastPresented([control])).toBeUndefined();
    expect(lastPresented([])).toBeUndefined();
  });
});
