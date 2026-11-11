import type { LabState, Stroke } from '../../scripts/truth/schema.js';

// The live visibility judges' tests' shared states (live-visibility.test.ts, live-visibility-words.test.ts). iOS units:
// the iPhone 17's 402x874 pt, its status band 62 pt.

export const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
export const at = 1;

/** A state of an edges-like cell: T in `page` (the whole screen), its frame `y`, the page at `offset`. */
export function state(over: Partial<LabState> = {}): LabState {
  return {
    cell: 'c',
    ready: true,
    screen: SCREEN,
    scale: 3,
    frames: { T: { x: 51, y: -2, width: 300, height: 64 } },
    events: [],
    safeArea: { top: 62, left: 0, bottom: 34, right: 0 },
    scrollViews: { page: SCREEN },
    offsets: { page: 382 },
    strokes: [],
    ...over,
  };
}
export const stroke = (from: number, to: number, view = 'page'): Stroke => ({ view, from, to, at });

/** T judged in `page` on iOS, the plain stop. */
export const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
/** T whole at y 300, the page at 80 after one stroke closer, the tap fired T: judgeScroll's ok stop. */
export const reached = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)], events: [{ kind: 'tap', tag: 'T', at }] });
