import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { inferScreenSize, screenOf } from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';

/**
 * geometry.ts's screen size from a tree, asked directly (backlog D45): the inset window `inferScreenSize` surfaces
 * (`ScreenSize.insetWindow`), the edges of its walk and of its window test, and `screenOf`. The measured shapes and the
 * regressions are tests/ui-tree/geometry.test.ts's.
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const nodeAt = (frame: Rect, ...children: UiNode[]): UiNode => node({ rect: frame, children });
/** A root of no area: idb's synthetic root, uiautomator's multi-window dump, WDA's rect-less sheet root. */
const rectless = (...children: UiNode[]): UiNode => nodeAt(rect(0, 0, 0, 0), ...children);

describe('inferScreenSize — the inset window: screen-shaped in the window\'s position, not at the origin (ScreenSize.insetWindow)', () => {
  it("uiautomator's root laid beside a left nav bar (126,0 2274x1080): the walk answers, unreliable, and the root is offered as the inset window", () => {
    const tree = nodeAt(rect(126, 0, 2274, 1080), nodeAt(rect(126, 0, 2274, 200)), nodeAt(rect(200, 300, 1000, 400)));
    expect(inferScreenSize(tree)).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: rect(126, 0, 2274, 1080) });
  });

  it("a root with area that is no window is never passed over for a child, even a screen-shaped one at the origin", () => {
    const tree = nodeAt(rect(126, 0, 2274, 1080), nodeAt(rect(0, 0, 402, 874)));
    expect(inferScreenSize(tree)).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: rect(126, 0, 2274, 1080) });
  });

  it('an inset root shaped like a bar is no window: nothing offered', () => {
    expect(inferScreenSize(nodeAt(rect(126, 0, 2274, 100)))).toEqual({ width: 2400, height: 100, reliable: false, trustworthyHeight: false });
  });

  it('half a root rect is no rect: the children are asked', () => {
    expect(inferScreenSize(nodeAt(rect(126, 0, 2274, 0), nodeAt(rect(126, 63, 2274, 1017)))).insetWindow).toEqual(rect(126, 63, 2274, 1017));
    expect(inferScreenSize(nodeAt(rect(0, 0, 0, 1080), nodeAt(rect(126, 63, 2274, 1017)))).insetWindow).toEqual(rect(126, 63, 2274, 1017));
  });

  it('a rect-less multi-window dump: the app window below the status bar and beside the nav bar (126,63 2274x1017) is offered; the bar, origin-anchored and bar-shaped, is no window', () => {
    const app = nodeAt(rect(126, 63, 2274, 1017));
    const bar = nodeAt(rect(0, 0, 2400, 63));
    expect(inferScreenSize(rectless(app, bar))).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: rect(126, 63, 2274, 1017) });
  });

  // Each pair is asked in both listing orders: the pick is by size, never by order.
  it.each([
    ['an inset window: the wider wins over the taller', rect(126, 0, 1000, 1000), rect(126, 0, 1100, 800), { width: 1226, height: 1000, reliable: false, trustworthyHeight: false, insetWindow: rect(126, 0, 1100, 800) }],
    ['an inset window: of equal widths, the taller', rect(126, 0, 1000, 900), rect(126, 0, 1000, 1000), { width: 1126, height: 1000, reliable: false, trustworthyHeight: false, insetWindow: rect(126, 0, 1000, 1000) }],
    ['a child window: of equal widths, the taller', rect(0, 0, 402, 800), rect(0, 0, 402, 874), { width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'child' }],
  ])('the candidate picked by size, in either order — %s', (_, loser, winner, size) => {
    expect(inferScreenSize(rectless(nodeAt(loser), nodeAt(winner)))).toEqual(size);
    expect(inferScreenSize(rectless(nodeAt(winner), nodeAt(loser)))).toEqual(size);
  });

  it('a candidate must have area, lie on layout and be screen-shaped', () => {
    expect(inferScreenSize(rectless(nodeAt(rect(126, 0, 1000, 0)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(rect(126, 0, 0, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(rect(126, -5, 1000, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(rect(-5, 10, 1000, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(rect(126, 0, 0, 0)))).insetWindow).toBeUndefined();
    // MAX_SCREEN_ASPECT, 3:1, inclusive: flatter is a bar.
    expect(inferScreenSize(rectless(nodeAt(rect(126, 0, 1002, 334)))).insetWindow).toEqual(rect(126, 0, 1002, 334));
    expect(inferScreenSize(rectless(nodeAt(rect(126, 0, 1003, 334)))).insetWindow).toBeUndefined();
  });

  it('content starting inside a candidate and reaching over 10 % past its right contradicts it; peeking or parked content does not', () => {
    const window = rect(126, 0, 1000, 1000);
    // 1226 is 10 % past: the limit, not past it.
    expect(inferScreenSize(rectless(nodeAt(window), nodeAt(rect(200, 100, 1026, 100)))).insetWindow).toEqual(window);
    expect(inferScreenSize(rectless(nodeAt(window), nodeAt(rect(200, 100, 1027, 100)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(window, nodeAt(rect(1125, 100, 500, 100))))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(nodeAt(window), nodeAt(rect(1126, 100, 1000, 100)))).insetWindow).toEqual(window);
    // Content off layout (a scrim at a negative origin) contradicts nothing.
    expect(inferScreenSize(rectless(nodeAt(window), nodeAt(rect(200, -5, 2000, 100)))).insetWindow).toEqual(window);
  });
});

describe('inferScreenSize — the edges of the walk and of the window test', () => {
  it('a root of no height is no window, though it lies at the origin with a width: its child is', () => {
    expect(inferScreenSize(nodeAt(rect(0, 0, 402, 0), nodeAt(rect(0, 0, 402, 874))))).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'child' });
  });

  it('a guessed window\'s layout may peek up to 10 % past its right edge; past that it contradicts the window', () => {
    const child = rect(0, 0, 300, 400);
    expect(inferScreenSize(rectless(nodeAt(child), nodeAt(rect(200, 100, 130, 50))))).toEqual({ width: 300, height: 400, reliable: true, trustworthyHeight: true, windowLeg: 'child' });
    expect(inferScreenSize(rectless(nodeAt(child), nodeAt(rect(200, 100, 131, 50))))).toEqual({ width: 300, height: 400, reliable: false, trustworthyHeight: false, windowLeg: 'child' });
  });

  it('a walked bar is corroborated by a screen-shaped rect reaching within 10 % of it; one reaching less leaves the width unreliable', () => {
    // The bar also starts inside the screen-shaped rect and runs 10 % past it: it contradicts it as an inset window.
    expect(inferScreenSize(rectless(nodeAt(rect(10, 0, 990, 1000)), nodeAt(rect(0, 0, 1100, 100))))).toEqual({ width: 1100, height: 1000, reliable: true, trustworthyHeight: false });
    expect(inferScreenSize(rectless(nodeAt(rect(10, 0, 990, 1000)), nodeAt(rect(0, 0, 1101, 100))))).toEqual({ width: 1101, height: 1000, reliable: false, trustworthyHeight: false });
  });

  it('a rect a unit above or left of the origin is off layout (a scrim), not part of the walk', () => {
    const content = { width: 386, height: 800, reliable: false, trustworthyHeight: false, insetWindow: rect(16, 0, 370, 800) };
    expect(inferScreenSize(rectless(nodeAt(rect(16, 0, 370, 800)), nodeAt(rect(-1, 0, 2000, 100))))).toEqual(content);
    expect(inferScreenSize(rectless(nodeAt(rect(16, 0, 370, 800)), nodeAt(rect(0, -1, 2000, 100))))).toEqual(content);
  });

  it('a root within ORIGIN_SLACK of the origin is the window; one a unit off is not', () => {
    expect(inferScreenSize(nodeAt(rect(0.5, 0.5, 402, 874)))).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'root' });
    // Off by a unit, the walk answers and the root is offered as an inset window; at x 0 the walk's width is reliable.
    expect(inferScreenSize(nodeAt(rect(1, 0, 402, 874)))).toEqual({ width: 403, height: 874, reliable: false, trustworthyHeight: false, insetWindow: rect(1, 0, 402, 874) });
    expect(inferScreenSize(nodeAt(rect(0, 1, 402, 874)))).toEqual({ width: 402, height: 875, reliable: true, trustworthyHeight: false, insetWindow: rect(0, 1, 402, 874) });
  });

  it("the walk's width is reliable only from a rect at the origin: a unit inset is a content width", () => {
    expect(inferScreenSize(rectless(nodeAt(rect(1, 0, 370, 1200))))).toEqual({ width: 371, height: 1200, reliable: false, trustworthyHeight: false });
    expect(inferScreenSize(rectless(nodeAt(rect(0.5, 0, 370, 1200))))).toEqual({ width: 370.5, height: 1200, reliable: true, trustworthyHeight: false });
  });

  it('an origin-anchored bar reaching furthest, corroborated by a screen-shaped window ending a unit short of it: a reliable width, in either order', () => {
    const bar = nodeAt(rect(0, 0, 2400, 63));
    const app = nodeAt(rect(126, 63, 2273, 1017));
    const size = { width: 2400, height: 1080, reliable: true, trustworthyHeight: false, insetWindow: rect(126, 63, 2273, 1017) };
    expect(inferScreenSize(rectless(bar, app))).toEqual(size);
    expect(inferScreenSize(rectless(app, bar))).toEqual(size);
  });

  it("the walked height is the lowest bottom edge, not the tallest rect's; a scrim above the screen's top is no layout", () => {
    expect(inferScreenSize(rectless(nodeAt(rect(16, 100, 370, 800)), nodeAt(rect(16, 0, 370, 850))))).toEqual({ width: 386, height: 900, reliable: false, trustworthyHeight: false, insetWindow: rect(16, 0, 370, 850) });
    expect(inferScreenSize(rectless(nodeAt(rect(16, 0, 370, 800)), nodeAt(rect(0, -5, 804, 900))))).toEqual({ width: 386, height: 800, reliable: false, trustworthyHeight: false, insetWindow: rect(16, 0, 370, 800) });
  });

});

describe('screenOf — the root\'s rect, or the tree\'s largest when the root has none', () => {
  it("the root's rect when it has area; else the largest by area (idb's synthetic 0x0 root); the empty root when nothing has area", () => {
    expect(screenOf(nodeAt(rect(0, 0, 402, 874), nodeAt(rect(0, 0, 804, 874))))).toEqual(rect(0, 0, 402, 874));
    expect(screenOf(rectless(nodeAt(rect(0, 0, 402, 100)), nodeAt(rect(0, 0, 402, 874), nodeAt(rect(0, 0, 400, 2000))), nodeAt(rect(0, 0, 100, 100))))).toEqual(rect(0, 0, 400, 2000));
    expect(screenOf(rectless(nodeAt(rect(0, 0, 402, 874)), nodeAt(rect(10, 10, 402, 874))))).toEqual(rect(0, 0, 402, 874));
    expect(screenOf(nodeAt(rect(0, 0, 402, 0), nodeAt(rect(0, 0, 402, 874))))).toEqual(rect(0, 0, 402, 874));
    expect(screenOf(rectless())).toEqual(rect(0, 0, 0, 0));
  });
});
