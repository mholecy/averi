import { describe, expect, it } from 'vitest';
import { formatLogExcerpt, LOG_MAX_LINES } from '../../src/run/log-excerpt.js';

describe('formatLogExcerpt', () => {
  const lines = (n: number, prefix = 'line'): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

  it('passes short unfiltered output through with no header', () => {
    expect(formatLogExcerpt(['a', 'b'], undefined)).toBe('a\nb');
  });

  // The counting is the point: a grep that matched nothing must SAY so, or it
  // reads exactly like a quiet device.
  it('reports what the grep matched, including nothing', () => {
    const out = formatLogExcerpt(['ERROR boom', 'info ok'], 'error');
    expect(out).toBe('[grep /error/i matched 1 of 2 lines]\nERROR boom');
    expect(formatLogExcerpt(['info ok'], 'crash')).toBe('[grep /crash/i matched 0 of 1 lines]');
  });

  // One limit, one owner: the get_logs tool's schema default is this same
  // constant (tests/mcp/tool-descriptions.test.ts); until 2026-10-08 the
  // function alone defaulted to 2000.
  it('keeps LOG_MAX_LINES lines when the caller names no budget', () => {
    const out = formatLogExcerpt(lines(LOG_MAX_LINES + 1), undefined).split('\n');
    expect(out[0]).toBe(`[truncated: showing last ${LOG_MAX_LINES} of ${LOG_MAX_LINES + 1} lines]`);
    expect(out).toHaveLength(LOG_MAX_LINES + 1);
  });

  it('keeps the TAIL when truncating and admits it', () => {
    const out = formatLogExcerpt(lines(5), undefined, 2).split('\n');
    expect(out[0]).toBe('[truncated: showing last 2 of 5 lines]');
    expect(out.slice(1)).toEqual(['line 3', 'line 4']);
  });

  it('counts against the filtered set, not the raw one', () => {
    const out = formatLogExcerpt([...lines(3, 'keep'), ...lines(50, 'drop')], 'keep', 2);
    expect(out).toContain('[grep /keep/i matched 3 of 53 lines]');
    expect(out).toContain('[truncated: showing last 2 of 3 lines]');
    expect(out).toContain('keep 2');
    expect(out).not.toContain('drop');
  });
});
