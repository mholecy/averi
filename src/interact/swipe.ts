import type { DeviceAdapter, Rect } from '../adapters/types.js';
import { inferScreenSize } from '../ui-tree/geometry.js';

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Which thing `direction` names. A `swipe:` step names the FINGER's movement
 * (swipe up = finger travels up, revealing content below); the MCP `swipe`
 * tool takes raw from/to coordinates and never comes through here. A
 * `scroll_until:` names where the CONTENT lies (content below the
 * fold is reached by a finger travelling up). Spelled out at every call site
 * because the two tables read as copies of each other with the rows swapped,
 * and the next person to correct one would have broken the other.
 */
export type SwipeMeaning = 'finger' | 'content';

/**
 * The from/to points of a swipe across `box`, 30% of the box either side of
 * centre. Pure; `swipeScreen` and the scroll loop both call it.
 */
export function swipeVector(
  box: Rect,
  direction: Direction,
  meaning: SwipeMeaning,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const dx = Math.round(box.width * 0.3);
  const dy = Math.round(box.height * 0.3);
  const finger = {
    up: { from: { x: cx, y: cy + dy }, to: { x: cx, y: cy - dy } },
    down: { from: { x: cx, y: cy - dy }, to: { x: cx, y: cy + dy } },
    left: { from: { x: cx + dx, y: cy }, to: { x: cx - dx, y: cy } },
    right: { from: { x: cx - dx, y: cy }, to: { x: cx + dx, y: cy } },
  } as const;
  const awayFrom = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
  return meaning === 'finger' ? finger[direction] : finger[awayFrom[direction]];
}

export interface SwipeOptions {
  direction: Direction;
  meaning: SwipeMeaning;
  /** Repeat the same gesture. Default 1. */
  times?: number;
}

/**
 * Swipe across the screen the tree describes, `times` times. Reads the tree
 * once: the gesture does not care what moved.
 *
 * The area is `ui-tree/geometry.ts#inferScreenSize`, anchored at the origin
 * — the one owner of "how big is the screen this tree shows", which handles
 * the iOS synthetic 0×0 root by promoting the screen-shaped child window and
 * excludes off-layout scrims. Until 2026-10-03 this file worked the extent
 * out a third time as the union of the root's children, which is NOT the
 * same computation: the measured WDA sheet (docs/bugs/2026-08-26-png-scale-
 * needs-out-of-tree-screen-size.md) carries a PopoverDismissRegion at
 * {-402,-874} sized 1206x2622 under a 0×0 root, and the union read as an
 * 804x1748 screen — a swipe whose centre is the real screen's bottom-right
 * corner. A root rect not at the origin is not a window for geometry either;
 * both platforms' roots sit at (0,0), so anchoring at the origin loses
 * nothing that was ever measured.
 */
export async function swipeScreen(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'swipe'>,
  opts: SwipeOptions,
): Promise<void> {
  const { width, height } = inferScreenSize(await adapter.uiTree());
  const { from, to } = swipeVector({ x: 0, y: 0, width, height }, opts.direction, opts.meaning);
  const times = opts.times ?? 1;
  for (let i = 0; i < times; i++) await adapter.swipe(from, to);
}
