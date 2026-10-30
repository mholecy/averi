import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { androidTrees } from '../helpers/android-trees.js';
import { node } from '../helpers/fake.js';
import { iosTrees } from '../helpers/ios-trees.js';

// EVERY NODE (adapters/types.ts#everyNode): the one tree walk — the root, then each child's subtree in the order
// listed, lazily, so a consumer that stops early never reads what it did not reach.

/** `n`, whose children throw `walked` when read: a node the walk must not look under. */
const unwalkable = (n: UiNode, walked: string): UiNode =>
  Object.defineProperty(n, 'children', {
    get: () => {
      throw new Error(walked);
    },
  });

const ids = (nodes: Iterable<UiNode>): (string | null)[] => [...nodes].map((n) => n.identifier);

/** The plain recursive definition of pre-order: the oracle. */
const preOrder = (n: UiNode): UiNode[] => [n, ...n.children.flatMap(preOrder)];

describe('everyNode — pre-order, the root first', () => {
  it('yields the root and every descendant, pre-order', () => {
    const tree = node({
      identifier: 'root',
      children: [
        node({ identifier: 'a', children: [node({ identifier: 'a1' }), node({ identifier: 'a2', children: [node({ identifier: 'a2i' })] })] }),
        node({ identifier: 'b' }),
        node({ identifier: 'c', children: [node({ identifier: 'c1' })] }),
      ],
    });
    expect(ids(everyNode(tree))).toEqual(['root', 'a', 'a1', 'a2', 'a2i', 'b', 'c', 'c1']);
  });

  it('a leaf yields itself alone; a subtree is walked from the node it is handed, not from the tree\'s root', () => {
    const inner = node({ identifier: 'inner', children: [node({ identifier: 'i1' })] });
    node({ identifier: 'root', children: [node({ identifier: 'before' }), inner, node({ identifier: 'after' })] });
    expect(ids(everyNode(node({ identifier: 'leaf' })))).toEqual(['leaf']);
    expect(ids(everyNode(inner))).toEqual(['inner', 'i1']);
  });

  it('walks a chain deeper than the call stack', () => {
    let tree = node({ identifier: 'bottom' });
    for (let i = 0; i < 20_000; i++) tree = node({ children: [tree] });
    let count = 0;
    let last: UiNode | undefined;
    for (const n of everyNode(tree)) {
      count++;
      last = n;
    }
    expect(count).toBe(20_001);
    expect(last?.identifier).toBe('bottom');
  });

  it('a hole in a children array fails the walk loudly, never ends it there', () => {
    const tree = node({ identifier: 'root', children: [node({ identifier: 'a' }), undefined as unknown as UiNode, node({ identifier: 'b' })] });
    expect(() => [...everyNode(tree)]).toThrow(TypeError);
  });

  it('yields, node for node, what the plain recursive definition lists, on every tree of the committed captures', async () => {
    const trees = [...(await iosTrees()), ...(await androidTrees())];
    let nodes = 0;
    for (const [name, tree] of trees) {
      const walked = [...everyNode(tree)];
      const expected = preOrder(tree);
      expect(walked.length, name).toBe(expected.length);
      expect(walked.every((n, i) => n === expected[i]), name).toBe(true);
      nodes += walked.length;
    }
    // the sweep covers both platforms' corpora, thousands of nodes
    expect(trees.length).toBeGreaterThan(100);
    expect(nodes).toBeGreaterThan(5000);
  });
});

describe('everyNode — lazy', () => {
  it('a consumer that stops at a node never reads its children, nor those of any node listed after it', () => {
    const stop = unwalkable(node({ identifier: 'stop' }), 'read the children of the node the consumer stopped at');
    const later = unwalkable(node({ identifier: 'later' }), 'read the children of a node listed after the stop');
    const laterCousin = unwalkable(node({ identifier: 'cousin' }), 'read the children of a node listed after the stop');
    const tree = node({ identifier: 'root', children: [node({ identifier: 'a', children: [stop, later] }), laterCousin] });
    const seen: (string | null)[] = [];
    for (const n of everyNode(tree)) {
      seen.push(n.identifier);
      if (n === stop) break;
    }
    expect(seen).toEqual(['root', 'a', 'stop']);
  });

  it('reads a node\'s children only once the consumer has had the node: children it replaces then are the ones walked', () => {
    // the fakes drop a keyboard band this way, mid-walk (tests/helpers/fake.ts#dropBand)
    const tree = node({
      identifier: 'root',
      children: [node({ identifier: 'a', children: [node({ identifier: 'dropped' }), node({ identifier: 'kept' })] }), node({ identifier: 'b' })],
    });
    const seen: (string | null)[] = [];
    for (const n of everyNode(tree)) {
      seen.push(n.identifier);
      n.children = n.children.filter((c) => c.identifier !== 'dropped');
    }
    expect(seen).toEqual(['root', 'a', 'kept', 'b']);
  });
});
