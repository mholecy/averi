import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { emptyFrame, framesOnly } from '../../src/ui-tree/placed.js';
import { parseDump } from '../helpers/android-dumps.js';
import { node } from '../helpers/fake.js';
import { iosTrees } from '../helpers/ios-trees.js';

// FRAMES ONLY (ui-tree/placed.ts#framesOnly): every descendant of a node, not the node itself, is an empty frame — a
// bare `container` (`emptyFrame`). Draw order's `structural` frame excuse asks it of every candidate for every target,
// so it answers at the first descendant that is no empty frame, without walking the rest.
const frame = (...children: UiNode[]): UiNode => node({ role: 'container', children });

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
    const unwalked = node({ role: 'container' });
    Object.defineProperty(unwalked, 'children', {
      get: () => {
        throw new Error('walked past the first descendant that is no empty frame');
      },
    });
    expect(framesOnly(frame(frame(node({ role: 'text', label: 'stop' }), unwalked), unwalked))).toBe(false);
  });

  it('asks a child before its own descendants: a child that is no empty frame ends it before its subtree is walked', () => {
    const named = node({ role: 'button', label: 'Go' });
    Object.defineProperty(named, 'children', {
      get: () => {
        throw new Error('walked under a child that is no empty frame');
      },
    });
    expect(framesOnly(frame(named))).toBe(false);
  });

  it('answers as "every node of every child\'s subtree is an empty frame" on every node of the committed captures', async () => {
    const truth = new URL('../fixtures/truth/', import.meta.url);
    const androidDirs = readdirSync(truth)
      .filter((d) => d.startsWith('android'))
      .map((d) => new URL(`${d}/`, truth));
    const android = androidDirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.xml'))
        .map((f): [string, UiNode] => [f, parseDump(readFileSync(new URL(f, dir), 'utf8'))]),
    );
    const trees = [...(await iosTrees()), ...android];
    let asked = 0;
    let falses = 0;
    for (const [, tree] of trees) {
      for (const n of everyNode(tree)) {
        // the definition before the early stop, kept as the migration's oracle — not a second implementation
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
