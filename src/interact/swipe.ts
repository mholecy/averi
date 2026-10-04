import type { DeviceAdapter, UiNode } from '../adapters/types.js';

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
  box: { x: number; y: number; width: number; height: number },
  direction: Direction,
  mean: SwipeMeaning,
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
  return mean === 'finger' ? finger[direction] : finger[awayFrom[direction]];
}

/**
 * Swipe across the screen the tree describes, `times` times. The area is the
 * root rect, or the union of its children when the root is the iOS synthetic
 * 0×0 node. Reads the tree once: the gesture does not care what moved.
 */
export async function swipeScreen(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'swipe'>,
  direction: Direction,
  mean: SwipeMeaning,
  times = 1,
): Promise<void> {
  const { from, to } = swipeVector(boundingBox(await adapter.uiTree()), direction, mean);
  for (let i = 0; i < times; i++) await adapter.swipe(from, to);
}

/** Screen area to swipe over: the root rect, or the union of children (iOS synthetic root is 0×0). */
function boundingBox(root: UiNode): UiNode['rect'] {
  if (root.rect.width > 0 && root.rect.height > 0) return root.rect;
  let maxX = 0;
  let maxY = 0;
  for (const c of root.children) {
    maxX = Math.max(maxX, c.rect.x + c.rect.width);
    maxY = Math.max(maxY, c.rect.y + c.rect.height);
  }
  return { x: 0, y: 0, width: maxX, height: maxY };
}
