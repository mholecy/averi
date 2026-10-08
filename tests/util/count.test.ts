import { describe, expect, it } from 'vitest';
import { countOf } from '../../src/util/count.js';

describe('countOf', () => {
  it('is singular for exactly one, plural otherwise — zero included', () => {
    expect(countOf(1, 'swipe')).toBe('1 swipe');
    expect(countOf(0, 'character')).toBe('0 characters');
    expect(countOf(2, 'time')).toBe('2 times');
  });
});
