import { describe, expect, it } from 'vitest';
import { durationSchema, parseDuration } from '../../src/util/duration.js';

describe('parseDuration', () => {
  it('parses ms, s, m and passes numbers through', () => {
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('15s')).toBe(15_000);
    expect(parseDuration('1.5s')).toBe(1_500);
    expect(parseDuration('2m')).toBe(120_000);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow('Invalid duration "soon" — use e.g. 500ms, 15s, 2m');
  });

  // A19: a number is ms, and a negative or non-finite one is no duration — refused, not turned into a budget that
  // expires before the first read or never.
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the number %s', (n) => {
    expect(() => parseDuration(n)).toThrow(`Invalid duration ${n} — use e.g. 500ms, 15s, 2m`);
  });
});

describe('durationSchema — the one duration every timeout field parses with (A19)', () => {
  it.each([0, 250, '500ms', '15s', '2m'])('accepts %s and keeps it as written', (v) => {
    expect(durationSchema.parse(v)).toBe(v);
  });

  it.each([
    ['5 sec', 'Invalid duration "5 sec" — use e.g. 500ms, 15s, 2m'],
    ['', 'Invalid duration "" — use e.g. 500ms, 15s, 2m'],
    ['-5s', 'Invalid duration "-5s" — use e.g. 500ms, 15s, 2m'],
    [-5, 'Invalid duration -5 — use e.g. 500ms, 15s, 2m'],
    [Number.POSITIVE_INFINITY, 'Invalid duration Infinity — use e.g. 500ms, 15s, 2m'],
  ])('refuses %j with parseDuration\'s own message', (v, message) => {
    const r = durationSchema.safeParse(v);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([message]);
  });

  // NaN is refused by zod's number type before the duration check sees it (a YAML `.nan`): refused all the same.
  it.each([true, null, Number.NaN])('a value that is no number or string (%s) is refused as a type error', (v) => {
    const r = durationSchema.safeParse(v);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join()).not.toMatch(/Invalid duration/);
  });
});
