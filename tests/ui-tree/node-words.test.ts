import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { coverName, coverText, labelWords, listedText, nodeText, outsideScrollViewText, quoted } from '../../src/ui-tree/node-words.js';
import { node } from '../helpers/fake.js';

/** ui-tree/node-words.ts: how a sentence names a node, and the A54 rule in every form of it. */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('the forms of a node\'s name (nodeText, coverText, outsideScrollViewText, coverName)', () => {
  const button = { role: 'button', label: 'Continue to summary', identifier: 'continue', rect: rect(24, 780, 354, 44) };

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

  it('coverName: the role and the label quoted, no rect; the role alone without a label, never the id; an empty label quoted', () => {
    const cover = (label: string | null): UiNode => node({ role: 'button', label, identifier: 'id_cover', rect: rect(24, 780, 354, 44) });
    expect(coverName(cover('Sign in'))).toBe('button "Sign in"');
    expect(coverName(cover(null))).toBe('button');
    expect(coverName(cover(''))).toBe('button ""');
  });

  it('quoted keeps the role, label, id and a copy of the rect — never the subtree, nor the value', () => {
    const full = node({ ...button, value: 'v', children: [node({})] });
    const q = quoted(full);
    expect(q).toEqual(button);
    expect(q.rect).not.toBe(full.rect);
  });
});

describe('an input labelled by its own text: said by its length in every form, never quoted (ADR 0043, A54)', () => {
  const OWN = 'hunter2!';
  const input = node({ role: 'textfield', label: OWN, value: OWN, identifier: 'pw', rect: rect(0, 40, 100, 10) });

  it.each([
    ['labelWords', labelWords(input), '<its text, 8 characters>'],
    ['nodeText', nodeText(input), 'textfield <its text, 8 characters> (0,40 100x10)'],
    ['coverText reaching past its rect', coverText(input, rect(0, 0, 100, 60)), 'textfield <its text, 8 characters> (0,40 100x10, reaching 0,0 100x60)'],
    ['outsideScrollViewText', outsideScrollViewText(input), 'outside its scroll view textfield <its text, 8 characters> (0,40 100x10)'],
    ['coverName', coverName(input), 'textfield <its text, 8 characters> at 0,40 100x10'],
    ['listedText', listedText(input, input.label), '<its text, 8 characters> at 0,40 100x10'],
  ])('%s', (_, said, expected) => {
    expect(said).toBe(expected);
  });

  it('a quoted copy keeps the rule by its flag, not the value: the same words, past its read', () => {
    const q = quoted(input);
    expect(q).toEqual({ role: 'textfield', label: OWN, identifier: 'pw', rect: rect(0, 40, 100, 10), ownText: true });
    expect(nodeText(q)).toBe(nodeText(input));
    expect(coverName(q)).toBe(coverName(input));
  });

  it('padded alike: the label and the value equal once trimmed', () => {
    expect(nodeText({ ...input, label: ` ${OWN} ` })).toBe('textfield <its text, 8 characters> (0,40 100x10)');
  });

  it('not the rule: a label the app built around the text, a value no label shows, a non-input whose label is its value, an empty field', () => {
    expect(nodeText({ ...input, label: `Password ${OWN}` })).toBe(`textfield "Password ${OWN}" (0,40 100x10)`);
    expect(nodeText({ ...input, label: 'Password' })).toBe('textfield "Password" (0,40 100x10)');
    expect(nodeText({ ...input, role: 'text' })).toBe(`text "${OWN}" (0,40 100x10)`);
    expect(nodeText({ ...input, label: '', value: '' })).toBe('textfield id:pw (0,40 100x10)');
    expect(quoted({ ...input, role: 'text' })).not.toHaveProperty('ownText');
  });

  it('listedText under `every-label`: every label by its length and rect, `null` for none', () => {
    expect(listedText({ ...input, label: 'Card 4111 1111' }, 'Card 4111 1111', 'every-label')).toBe('<14 characters> at 0,40 100x10');
    expect(listedText({ ...input, label: null }, null, 'every-label')).toBe('null at 0,40 100x10');
  });
});
