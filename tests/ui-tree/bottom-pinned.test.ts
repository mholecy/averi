import { describe, expect, it } from 'vitest';
import { rectArea, type Rect, type UiNode } from '../../src/adapters/types.js';
import { bottomPinned, FLAT_LIST_BOTTOM_BAR_FRACTION, type KeyboardBand } from '../../src/ui-tree/draw-order.js';
import { screenOf } from '../../src/ui-tree/geometry.js';
import { walkOf, type Placed } from '../../src/ui-tree/placed.js';
import { isInteractive } from '../../src/ui-tree/selectors.js';
import { androidTrees } from '../helpers/android-trees.js';
import { node } from '../helpers/fake.js';
import { iosTrees } from '../helpers/ios-trees.js';

// PINNED AT THE BOTTOM (ui-tree/draw-order.ts#bottomPinned): an interactive node ending inside a floor's bottom band
// (the screen's bottom, or idb's keyboard top) below which nothing of area listed after its subtree starts — the keys of
// that floor's keyboard left out. Asked of every flat list when its draw order is built, so it reads the later nodes in
// one pass, not once per interactive node.

const SCREEN: Rect = { x: 0, y: 0, width: 402, height: 874 };
const flat = (...children: UiNode[]): UiNode => node({ role: 'other', rect: { x: 0, y: 0, width: 0, height: 0 }, flatList: true, children });
const at = (y: number, height: number, role = 'button', label = 'b'): UiNode => node({ role, label, rect: { x: 24, y, width: 354, height } });

/** The plain definition, asking every later node for every interactive node: the oracle. */
function plainPinned(order: readonly Placed[], screen: Rect, keyboard: Pick<KeyboardBand, 'top' | 'keys'> | undefined): Map<Placed, number> {
  const band = screen.height * FLAT_LIST_BOTTOM_BAR_FRACTION;
  const floors = [{ floor: screen.y + screen.height, keys: new Set<Placed>() as ReadonlySet<Placed> }, ...(keyboard === undefined ? [] : [{ floor: keyboard.top, keys: keyboard.keys }])];
  const pinned = new Map<Placed, number>();
  for (const placed of order) {
    if (!isInteractive(placed.node)) continue;
    const end = placed.node.rect.y + placed.node.rect.height;
    const later = order.slice(placed.end).filter(({ node: n }) => rectArea(n.rect) > 0);
    const on = floors.find(({ floor, keys }) => end <= floor && end >= floor - band && !later.some((p) => !keys.has(p) && p.node.rect.y >= end));
    if (on !== undefined) pinned.set(placed, on.floor);
  }
  return pinned;
}

const byIndex = (pinned: ReadonlyMap<Placed, number>): [number, number][] => [...pinned].map(([p, floor]) => [p.at, floor]);

describe('bottomPinned — the nodes pinned at a flat list’s bottom, with their floor', () => {
  it('a bar listed last inside the bottom band reaches the screen’s bottom; a row followed by one starting below it does not', () => {
    // CONTINUE `24,780 354x44` listed last; a row at 817 followed by a date header at 876 (Account Detail's shape)
    const order = walkOf(flat(at(100, 52), at(817, 52), at(876, 30, 'text', 'date'), at(780, 44, 'button', 'CONTINUE')));
    expect(byIndex(bottomPinned(order, SCREEN, undefined))).toEqual([[4, 874]]);
  });

  it('a node of no area listed after never unpins; one starting exactly at the node’s bottom does', () => {
    const none = walkOf(flat(at(780, 44), node({ role: 'text', label: 'x', rect: { x: 0, y: 860, width: 0, height: 10 } })));
    expect(byIndex(bottomPinned(none, SCREEN, undefined))).toEqual([[1, 874]]);
    const touching = walkOf(flat(at(780, 44), at(824, 10, 'text', 'x')));
    expect(byIndex(bottomPinned(touching, SCREEN, undefined))).toEqual([]);
  });

  it('in a nested tree, what is listed after the node’s SUBTREE counts, not its own descendants', () => {
    // a button whose own child hangs below its bottom (824) is still pinned: the child is no node listed after it
    const bar = node({ role: 'button', label: 'Go', rect: { x: 24, y: 780, width: 354, height: 44 }, children: [at(830, 20, 'text', 'hint')] });
    const order = walkOf(node({ role: 'container', rect: { ...SCREEN }, children: [at(100, 52), bar] }));
    expect(byIndex(bottomPinned(order, SCREEN, undefined))).toEqual([[2, 874]]);
  });

  it('a bar lifted onto the keyboard: its keys, listed after it, are left out, and it reaches the keyboard’s top', () => {
    const order = walkOf(flat(at(300, 52), at(512, 44, 'button', 'CONTINUE'), at(600, 50, 'button', '1'), at(650, 50, 'button', '2')));
    const keys = new Set(order.slice(3));
    expect(byIndex(bottomPinned(order, SCREEN, { top: 589, keys }))).toEqual([[2, 589]]);
    // the screen's floor is asked first: the last key, ending inside the screen's band, is pinned at it
    expect(byIndex(bottomPinned(order, SCREEN, undefined))).toEqual([]);
  });

  it('answers as the plain definition on every committed capture, with and without a keyboard band', async () => {
    const trees = [...(await iosTrees()), ...(await androidTrees())];
    let asked = 0;
    let pinnedSeen = 0;
    let onKeyboard = 0;
    for (const [, tree] of trees) {
      const order = walkOf(tree);
      const screen = screenOf(tree);
      // a keyboard band over the lower third, its keys every node starting in it; and one whose top is a node's bottom
      const cuts = [screen.y + screen.height * 0.67, ...order.slice(-3).map((p) => p.node.rect.y + p.node.rect.height)];
      const keyboards = [undefined, ...cuts.map((top) => ({ top, keys: new Set(order.filter((p) => p.node.rect.y >= top)) }))];
      for (const keyboard of keyboards) {
        const expected = byIndex(plainPinned(order, screen, keyboard));
        expect(byIndex(bottomPinned(order, screen, keyboard))).toEqual(expected);
        asked++;
        pinnedSeen += expected.length;
        onKeyboard += expected.filter(([, floor]) => floor !== screen.y + screen.height).length;
      }
    }
    // the sweep sees both floors pin something
    expect(asked).toBeGreaterThan(400);
    expect(pinnedSeen).toBeGreaterThan(100);
    expect(onKeyboard).toBeGreaterThan(10);
  });

  it('reads each node’s rect a bounded number of times, not once per interactive node before it', () => {
    let reads = 0;
    const counted = (n: UiNode): UiNode => {
      const rect = n.rect;
      return Object.defineProperty(n, 'rect', {
        get: () => {
          reads++;
          return rect;
        },
      });
    };
    const n = 2000;
    const order = walkOf(flat(...Array.from({ length: n }, (_, i) => counted(at(i * 40, 30)))));
    bottomPinned(order, SCREEN, undefined);
    expect(reads).toBeLessThan(n * 8);
  });
});
