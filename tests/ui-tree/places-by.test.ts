import { describe, expect, it } from 'vitest';
import { everyNode } from '../../src/adapters/types.js';
import { placesBy, walkOf } from '../../src/ui-tree/placed.js';
import { androidTrees } from '../helpers/android-trees.js';
import { node } from '../helpers/fake.js';
import { iosTrees } from '../helpers/ios-trees.js';

// EVERY PLACE OF A NODE in the walk (ui-tree/placed.ts#placesBy): built once beside the walk, so draw order and the
// presentation module look a node's places up instead of filtering the whole walk for each question.

describe('placesBy — every place of each node in the walk, in walk order', () => {
  it('a node object laid at several places has them all, first to last; a node not in the walk has none', () => {
    const shared = node({ role: 'text', label: 'shared' });
    const a = node({ role: 'container', children: [shared] });
    const tree = node({ role: 'container', children: [a, shared, node({ role: 'container', children: [shared] })] });
    const order = walkOf(tree);
    const places = placesBy(order);
    expect(places.get(shared)?.map((p) => p.at)).toEqual([2, 3, 5]);
    expect(places.get(tree)?.map((p) => p.at)).toEqual([0]);
    expect(places.get(node({ role: 'text' }))).toBeUndefined();
  });

  it('answers as filtering the walk for the node, for every node of the committed captures', async () => {
    const trees = [...(await iosTrees()), ...(await androidTrees())];
    let asked = 0;
    for (const [, tree] of trees) {
      const order = walkOf(tree);
      const places = placesBy(order);
      for (const n of everyNode(tree)) {
        expect(places.get(n)).toEqual(order.filter((p) => p.node === n));
        asked++;
      }
    }
    expect(asked).toBeGreaterThan(1000);
  });
});
