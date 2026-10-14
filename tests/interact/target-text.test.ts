import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
import { coverName, cutRemedy, cutSliverText, pastSideText, revealText, underKeyboardText, untriedSideText } from '../../src/interact/target-text.js';

/**
 * The phrases a cut or a side target is said in, one wording for the tap's
 * refusal, `scroll_until`'s failures, the wait's hint and the picker's skip
 * lines. Each row is the literal those callers quote (their own tests pin
 * them in context: resolve.test, scroll.test, keyboard-in-tree.test).
 */
const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

describe('cutRemedy — the scroll toward where the rest of a cut target lies', () => {
  it.each([
    ['top', 'scroll_until it with direction: up first'],
    ['bottom', 'scroll_until it first'],
    ['left', 'scroll_until it with direction: left first'],
    ['right', 'scroll_until it with direction: right first'],
  ] as const)('cut at its %s edge: %s (down, the default, needs no direction)', (edge, text) => {
    expect(cutRemedy(edge)).toBe(text);
  });
});

describe('pastSideText — where a node read wholly past a side lies', () => {
  it.each([
    ['top', 'clipped out above its scroll container', 'above the viewport'],
    ['bottom', 'clipped out below its scroll container', 'below the viewport'],
    ['left', 'clipped out left of its scroll container', 'left of the viewport'],
    ['right', 'clipped out right of its scroll container', 'right of the viewport'],
  ] as const)('%s: clipped out vs past the viewport', (edge, clipped, viewport) => {
    expect(pastSideText(edge, true)).toBe(clipped);
    expect(pastSideText(edge, false)).toBe(viewport);
  });
});

describe('underKeyboardText — where a target whose centre lies under the soft keyboard stands', () => {
  it('names the centre and the keyboard\'s top edge, in the words the tap\'s refusal and scroll_until\'s presented stop both say', () => {
    expect(underKeyboardText({ x: 201, y: 661 }, 573)).toBe("under the soft keyboard: its centre (201,661) lies below the keyboard's top edge at y 573");
  });
});

describe('revealText and untriedSideText — the direction that brings a side back', () => {
  it('per edge', () => {
    expect(EDGES.map((e) => [revealText(e), untriedSideText(e)])).toEqual([
      ['scroll_until it with direction: "up"', 'if it lies above, try direction: "up"'],
      ['scroll_until it with direction: "down"', 'if it lies below, try direction: "down"'],
      ['scroll_until it with direction: "left"', 'if it lies to the left, try direction: "left"'],
      ['scroll_until it with direction: "right"', 'if it lies to the right, try direction: "right"'],
    ]);
  });
});

describe('coverName — a cover as the picker\'s skip line names it', () => {
  const cover = (label: string | null): UiNode => ({ role: 'button', label, identifier: 'id_cover', value: null, rect: { x: 24, y: 780, width: 354, height: 44 }, children: [] });

  it('with a label: role and the label quoted, no rect', () => {
    expect(coverName(cover('Sign in'))).toBe('button "Sign in"');
  });
  it('without a label: the role alone, never the id', () => {
    expect(coverName(cover(null))).toBe('button');
  });
  it('an empty label is quoted, not skipped', () => {
    expect(coverName(cover(''))).toBe('button ""');
  });
});

describe('cutSliverText — THE sentence for a node cut to a sliver', () => {
  const container = { x: 0, y: 242, width: 1080, height: 1736 };

  it('a cut its own content evidences', () => {
    expect(cutSliverText({ edge: 'bottom', container, depth: 55 }, { x: 66, y: 1924, width: 948, height: 55 }, 65)).toBe(
      "cut at its scroll container's bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across that edge, under the 65 a tap needs",
    );
  });
  it('a cut inherited from what it lies in names that after the container', () => {
    const within = { x: 66, y: 1924, width: 948, height: 55 };
    expect(cutSliverText({ edge: 'bottom', container, depth: 42, within }, { x: 66, y: 1936, width: 948, height: 42 }, 65)).toBe(
      "cut at its scroll container's bottom edge (container 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42 part of it shows, 42 deep across that edge, under the 65 a tap needs",
    );
  });
});
