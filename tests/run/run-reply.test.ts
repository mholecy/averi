import { describe, expect, it } from 'vitest';
import { assertSummary } from '../../src/run/run-reply.js';

describe('assertSummary', () => {
  it('reads the same for the assert tool and a verify leg', () => {
    const pass = { description: 'a', pass: true };
    const fail = { description: 'b', pass: false };
    expect(assertSummary([pass, pass])).toBe('All 2 asserts passed');
    expect(assertSummary([pass, fail])).toBe('1/2 asserts FAILED');
    // Vacuously true, and the callers decide whether to print it at all.
    expect(assertSummary([])).toBe('All 0 asserts passed');
  });
});
