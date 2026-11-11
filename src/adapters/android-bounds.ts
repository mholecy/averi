import { zeroRect, type Rect } from './types.js';

/**
 * Android's printed screen rect, `[l,t][r,b]`: the notation the uiautomator dialect (android-tree-dialect.ts) and the
 * window manager's dumps (android-wm.ts) share.
 */

/**
 * A screen rect as Android prints it everywhere — `[l,t][r,b]`, in a
 * uiautomator `bounds` attribute and in an InsetsSource `frame=` alike. ONE
 * pattern for both readers, so parseImeInsets keeps no second copy to test
 * "is this a frame" before parseBounds reads it.
 */
export const BOUNDS_PATTERN = String.raw`\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]`;
export const BOUNDS_RE = new RegExp(BOUNDS_PATTERN);

export function parseBounds(bounds: string | undefined): Rect {
  const m = bounds?.match(BOUNDS_RE);
  if (!m) return zeroRect();
  const [, l, t, r, b] = m.map(Number);
  return { x: l, y: t, width: r - l, height: b - t };
}
