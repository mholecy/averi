import { describe, expect, it } from 'vitest';
import { emptyFrame, isUnnamedWrapper } from '../../src/ui-tree/placed.js';
import { node } from '../helpers/fake.js';

// AN UNNAMED WRAPPER (ui-tree/placed.ts#isUnnamedWrapper): a structural role with no label, identifier or value — each
// of the three names it. No truth capture lists a structural node named by its value alone, so the shapes are built.
describe('isUnnamedWrapper — a structural role with nothing of its own', () => {
  it('a bare container and a bare other are unnamed wrappers; a bare button is no wrapper', () => {
    expect(isUnnamedWrapper(node({ role: 'container' }))).toBe(true);
    expect(isUnnamedWrapper(node({ role: 'other' }))).toBe(true);
    expect(isUnnamedWrapper(node({ role: 'button' }))).toBe(false);
  });

  it('a label, an identifier or a VALUE alone names it', () => {
    expect(isUnnamedWrapper(node({ role: 'container', label: 'Card' }))).toBe(false);
    expect(isUnnamedWrapper(node({ role: 'container', identifier: 'card' }))).toBe(false);
    expect(isUnnamedWrapper(node({ role: 'other', value: '50%' }))).toBe(false);
  });

  it('emptyFrame narrows it to the container role: a bare other is no empty frame', () => {
    expect(emptyFrame(node({ role: 'container' }))).toBe(true);
    expect(emptyFrame(node({ role: 'other' }))).toBe(false);
    expect(emptyFrame(node({ role: 'container', value: '50%' }))).toBe(false);
  });
});
