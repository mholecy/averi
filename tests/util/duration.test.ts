import { describe, expect, it } from 'vitest';
import { parseDuration } from '../../src/util/duration.js';

describe('parseDuration', () => {
  it('parses ms, s, m and passes numbers through', () => {
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('15s')).toBe(15_000);
    expect(parseDuration('2m')).toBe(120_000);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
  });
});
