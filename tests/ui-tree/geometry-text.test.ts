import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { flatListBarLine, frameText, rectText } from '../../src/ui-tree/geometry.js';

/** geometry.ts's rect spellings, the words every sentence quotes a rect in (backlog D45); a node's name is tests/ui-tree/node-words.test.ts's. */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('the rect spellings a sentence quotes (rectText, frameText)', () => {
  it('rectText `x,y wxh` for a node; frameText `[x,y][x2,y2]` for the keyboard, as dumpsys prints it', () => {
    expect(rectText(rect(24, 780, 354, 44))).toBe('24,780 354x44');
    expect(frameText(rect(0, 1269, 1080, 951))).toBe('[0,1269][1080,2220]');
  });

  it("flatListBarLine: a fifth of the screen down from its top", () => {
    expect(flatListBarLine(rect(0, 0, 402, 874))).toBeCloseTo(174.8, 10);
    expect(flatListBarLine(rect(0, 100, 402, 1000))).toBe(300);
  });
});
