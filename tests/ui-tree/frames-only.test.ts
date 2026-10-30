import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { emptyFrame, framesOnly } from '../../src/ui-tree/placed.js';
import { androidTrees } from '../helpers/android-trees.js';
import { node } from '../helpers/fake.js';
import { iosTrees } from '../helpers/ios-trees.js';

// FRAMES ONLY (ui-tree/placed.ts#framesOnly): every descendant of a node, not the node itself, is an empty frame — a
// bare `container` (`emptyFrame`). Draw order's `structural` frame excuse asks it of every candidate for every target,
// so it answers at the first descendant that is no empty frame, without walking the rest.
const frame = (...children: UiNode[]): UiNode => node({ role: 'container', children });

/** `n`, whose children throw `walked` when read: a node framesOnly must answer without walking under. */
const unwalkable = (n: UiNode, walked: string): UiNode =>
  Object.defineProperty(n, 'children', {
    get: () => {
      throw new Error(walked);
    },
  });

describe('framesOnly — every descendant an empty frame', () => {
  it('a leaf has no descendant: true, whatever its own role', () => {
    expect(framesOnly(node({ role: 'button', label: 'Go' }))).toBe(true);
  });

  it('the node itself is not asked: a named button holding bare frames only is true', () => {
    expect(framesOnly(node({ role: 'button', label: 'Go', children: [frame(frame()), frame()] }))).toBe(true);
  });

  it('one descendant that is no empty frame, however deep, makes it false', () => {
    expect(framesOnly(frame(frame(frame(frame(node({ role: 'text', label: 'deep' }))))))).toBe(false);
    expect(framesOnly(frame(frame(), frame(frame(), frame(node({ role: 'other' })))))).toBe(false);
    expect(framesOnly(frame(frame(), frame(frame(), frame(node({ role: 'container', identifier: 'named' })))))).toBe(false);
  });

  it('stops at the first descendant that is no empty frame: what follows it is never walked', () => {
    const unwalked = unwalkable(node({ role: 'container' }), 'walked past the first descendant that is no empty frame');
    expect(framesOnly(frame(frame(node({ role: 'text', label: 'stop' }), unwalked), unwalked))).toBe(false);
  });

  it('asks a child before its own descendants: a child that is no empty frame ends it before its subtree is walked', () => {
    const named = unwalkable(node({ role: 'button', label: 'Go' }), 'walked under a child that is no empty frame');
    expect(framesOnly(frame(named))).toBe(false);
  });

  it('answers as "every node of every child\'s subtree is an empty frame" on every node of the committed captures', async () => {
    const trees = [...(await iosTrees()), ...(await androidTrees())];
    let asked = 0;
    let falses = 0;
    for (const [, tree] of trees) {
      for (const n of everyNode(tree)) {
        // the plain definition, walking every descendant: the oracle
        const expected = n.children.every((child) => [...everyNode(child)].every(emptyFrame));
        expect(framesOnly(n)).toBe(expected);
        asked++;
        if (!expected) falses++;
      }
    }
    // the sweep asks both answers, many times over
    expect(asked).toBeGreaterThan(1000);
    expect(falses).toBeGreaterThan(100);
    expect(asked - falses).toBeGreaterThan(100);
  });
});
