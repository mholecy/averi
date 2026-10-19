import { describe, expect, it } from 'vitest';
import { droppedTail } from '../../src/interact/fill-type.js';

/**
 * What of a typing a field's reading proves dropped — the only text fillField ever types again
 * (docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-text-in-a-react-native-single-line-field.md). The retype
 * itself, its bound and its steadiness rule are pinned through fillField (fill.test.ts), the module's one caller.
 */
const intent = (value: string, before: string | null = null, clear = false, placeholder?: string) => ({ value, before, clear, placeholder });

describe('droppedTail — a strict prefix with some of the typing in it, else nothing', () => {
  it('a prefix of the value: the rest of it', () => {
    expect(droppedTail('Jan', intent('Jan Novak'))).toBe(' Novak');
    expect(droppedTail('SK31 1', intent('SK31 1200'))).toBe('200');
  });

  it('without clear the field should hold its earlier text and the value; with clear the value alone', () => {
    expect(droppedTail('9.9912', intent('12.34', '9.99'))).toBe('.34');
    expect(droppedTail('12', intent('12.34', '9.99', true))).toBe('.34');
  });

  it('nothing of the typing landed, the whole of it, more than it, or other text: nothing', () => {
    expect(droppedTail('9.99', intent('12.34', '9.99'))).toBeUndefined();
    expect(droppedTail('', intent('12.34'))).toBeUndefined();
    expect(droppedTail('12.34', intent('12.34'))).toBeUndefined();
    expect(droppedTail('12.345', intent('12.34'))).toBeUndefined();
    expect(droppedTail('Jan', intent('jan novak'))).toBeUndefined();
    expect(droppedTail('9.812', intent('12.34', '9.99'))).toBeUndefined(); // the earlier text changed
  });

  it('a reading with a bullet (masked) proves no prefix; a placeholder is no content', () => {
    expect(droppedTail('••', intent('12345'))).toBeUndefined();
    expect(droppedTail('•••3', intent('12345'))).toBeUndefined();
    expect(droppedTail('••', intent('••••'))).toBeUndefined(); // even a value of bullets: the reading cannot be told from a mask
    expect(droppedTail('Search', intent('Sea', null, false, 'Search'))).toBeUndefined();
    expect(droppedTail('Se', intent('Sea', 'Search', false, 'Search'))).toBe('a');
  });
});
