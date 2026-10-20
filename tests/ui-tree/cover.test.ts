import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { coverAtPoint, coverClause, drawOrderFound, lastPresented, overlaidCover, type Cover, type CoverGrammar, type CoverOrder } from '../../src/ui-tree/cover.js';
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

describe('coverAtPoint — the cover drawn on top at a point', () => {
  it('the LAST whose REACH holds it: a pinned bar run down to the screen\'s bottom holds a point below its frame', () => {
    const bar = cover('Continue', rect(24, 780, 354, 44), { reach: rect(24, 780, 354, 94) });
    const toast = cover('Toast', rect(0, 700, 402, 120));
    expect(coverAtPoint([bar], { x: 135, y: 850 })).toBe(bar);
    expect(coverAtPoint([bar, toast], { x: 135, y: 800 })).toBe(toast);
    expect(coverAtPoint([toast, bar], { x: 135, y: 800 })).toBe(bar);
    expect(coverAtPoint([bar, toast], { x: 135, y: 600 })).toBeUndefined();
  });

  it("is draw order's own question: exposure's `centreCover` is the record on top at the centre", () => {
    const row = node({ role: 'button', label: 'Row', rect: rect(20, 400, 362, 52) });
    const sheet = node({ role: 'other', label: 'Sheet', rect: rect(0, 380, 402, 494) });
    const tree = node({ role: 'container', rect: rect(0, 0, 402, 874), children: [row, sheet] });
    const seen = drawOrder(tree).exposure(row, rect(0, 0, 402, 874));
    expect(coverAtPoint(seen.covers, { x: 201, y: 426 })?.node).toBe(sheet);
    expect(seen.centreCover).toBe(coverAtPoint(seen.covers, { x: 201, y: 426 }));
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

describe('overlaidCover — the cover the tree shows only by the cut at the target\'s edge', () => {
  it('the node that cut it, pressing where it lies, its order `overlaid` at that edge, no presented surface', () => {
    const button = node({ role: 'button', label: 'Continue', rect: rect(66, 1956, 948, 154) });
    expect(overlaidCover(button, 'bottom')).toEqual({ node: button, reach: rect(66, 1956, 948, 154), order: { kind: 'overlaid', edge: 'bottom' }, presented: false });
    expect(overlaidCover(button, 'top').reach).not.toBe(button.rect);
  });
  it('is no cover the draw order found (`drawOrderFound`); every other order is', () => {
    const button = node({ role: 'button', label: 'Continue', rect: rect(66, 1956, 948, 154) });
    expect(drawOrderFound(overlaidCover(button, 'bottom'))).toBe(false);
    for (const kind of ['drawn', 'untold', 'seenOver'] as const) expect(drawOrderFound(cover('Bar', button.rect, { order: { kind } })), kind).toBe(true);
  });
});

describe('coverClause — one clause per order, in each grammar', () => {
  const w = cover('W', rect(51, 448, 300, 64));
  const continueBar = cover('Continue', rect(24, 780, 354, 44));
  const touch: CoverGrammar = { of: 'touch', centre: { x: 201, y: 480 } };
  const pixel: CoverGrammar = { of: 'pixel', at: '(element 51,470 300x64)' };
  const MAY_RUN_ON = "the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the rest of";
  it.each<[CoverOrder['kind'], Cover, CoverGrammar, string]>([
    ['drawn', w, touch, 'under button "W" (51,448 300x64) at its centre (201,480), drawn over it'],
    ['drawn', w, pixel, 'is drawn over the element (element 51,470 300x64)'],
    ['untold', { ...w, order: { kind: 'untold' } }, touch, 'overlapped by button "W" (51,448 300x64) at its centre (201,480), the two listed in reading order: which is drawn on top is not told'],
    ['untold', { ...w, order: { kind: 'untold' } }, pixel, 'overlaps the element (element 51,470 300x64), the two listed in reading order: which is drawn on top is not told'],
    ['seenOver', { ...w, order: { kind: 'seenOver' } }, touch, 'under button "W" (51,448 300x64) at its centre (201,480), drawn over it as a screenshot shows (the two are listed in reading order)'],
    ['seenOver', { ...w, order: { kind: 'seenOver' } }, pixel, 'is drawn over the element (element 51,470 300x64) as a screenshot shows (the two are listed in reading order)'],
    ['overlaid', overlaidCover(continueBar.node, 'bottom'), touch, `cut at its bottom edge by button "Continue" (24,780 354x44), drawn after it — ${MAY_RUN_ON} it may lie under that button`],
    ['overlaid', overlaidCover(continueBar.node, 'bottom'), pixel, `meets the element's bottom edge (element 51,470 300x64), drawn after it — ${MAY_RUN_ON} the element may lie under that button`],
  ])('%s, %#', (_kind, c, grammar, said) => {
    expect(coverClause(c, grammar)).toBe(said);
  });
  it('the touch grammar names the centre only when given, and the reach where it is not the rect', () => {
    const pinned = cover('Continue', rect(24, 780, 354, 44), { reach: rect(24, 780, 354, 94) });
    expect(coverClause(pinned, { of: 'touch' })).toBe('under button "Continue" (24,780 354x44, reaching 24,780 354x94), drawn over it');
    expect(coverClause({ ...pinned, order: { kind: 'untold' } }, { of: 'touch' })).toBe(
      'overlapped by button "Continue" (24,780 354x44, reaching 24,780 354x94), the two listed in reading order: which is drawn on top is not told',
    );
  });
});
