import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { coverText, flatListBarLine, frameText, nodeText, outsideScrollViewText, quoted, rectText } from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';

/** geometry.ts's rect spellings, the words every sentence quotes a rect or a node in (backlog D45). */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('the rect spellings a sentence quotes (rectText, frameText, nodeText, coverText, outsideScrollViewText)', () => {
  const button = { role: 'button', label: 'Continue to summary', identifier: 'continue', rect: rect(24, 780, 354, 44) };

  it('rectText `x,y wxh` for a node; frameText `[x,y][x2,y2]` for the keyboard, as dumpsys prints it', () => {
    expect(rectText(rect(24, 780, 354, 44))).toBe('24,780 354x44');
    expect(frameText(rect(0, 1269, 1080, 951))).toBe('[0,1269][1080,2220]');
  });

  it('nodeText: the role, the label quoted — else the id — and the rect', () => {
    expect(nodeText(button)).toBe('button "Continue to summary" (24,780 354x44)');
    expect(nodeText({ ...button, label: null })).toBe('button id:continue (24,780 354x44)');
    expect(nodeText({ ...button, label: '' })).toBe('button id:continue (24,780 354x44)');
    expect(nodeText({ ...button, label: null, identifier: null })).toBe('button (24,780 354x44)');
  });

  it('coverText: the node alone when it presses its own rect; with where it reaches when that is not its rect', () => {
    const alert = { role: 'container', label: 'Exit confirmation', identifier: null, rect: rect(41, 365, 320, 172) };
    expect(coverText(alert)).toBe('container "Exit confirmation" (41,365 320x172)');
    expect(coverText(alert, rect(41, 365, 320, 172))).toBe('container "Exit confirmation" (41,365 320x172)');
    expect(coverText(alert, rect(0, 0, 402, 874))).toBe('container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874)');
  });

  it('outsideScrollViewText: outside by default, or past one edge', () => {
    const form = { role: 'scrollable', label: null, identifier: 'form', rect: rect(0, 0, 402, 780) };
    expect(outsideScrollViewText(form)).toBe('outside its scroll view scrollable id:form (0,0 402x780)');
    expect(outsideScrollViewText(form, 'below')).toBe('below its scroll view scrollable id:form (0,0 402x780)');
  });

  it('quoted keeps the role, label, id and a copy of the rect — never the subtree', () => {
    const full = node({ ...button, children: [node({})] });
    const q = quoted(full);
    expect(q).toEqual(button);
    expect(q.rect).not.toBe(full.rect);
  });

  it("flatListBarLine: a fifth of the screen down from its top", () => {
    expect(flatListBarLine(rect(0, 0, 402, 874))).toBeCloseTo(174.8, 10);
    expect(flatListBarLine(rect(0, 100, 402, 1000))).toBe(300);
  });
});
